import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const publishableKey = publishableKeys.default || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const TRONGRID_API_KEY = Deno.env.get("TRONGRID_API_KEY") || "";
const admin = createClient(SUPABASE_URL, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const DEPOSIT_ADDRESS = "TCdC3RcYQXqWkhxP4zEyu4Bts3h9nEK44a";
const USDT_CONTRACT_HEX = "a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" }
});

function base58PayloadHex(address: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const char of address) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Invalid configured TRON address");
    number = number * 58n + BigInt(digit);
  }
  let hex = number.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  let leadingZeros = 0;
  for (const char of address) { if (char === "1") leadingZeros++; else break; }
  hex = "00".repeat(leadingZeros) + hex;
  const payload = hex.slice(0, -8).toLowerCase();
  if (payload.length !== 42 || !payload.startsWith("41")) throw new Error("Invalid configured TRON address");
  return payload;
}
function parseAmountUnits(value: unknown): bigint | null {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  try { return BigInt(whole) * 1000000n + BigInt((fraction + "000000").slice(0, 6)); }
  catch { return null; }
}
function normalizedContract(address: unknown): string {
  let value = String(address || "").toLowerCase().replace(/^0x/, "");
  if (value.startsWith("41") && value.length === 42) value = value.slice(2);
  return value;
}
async function tronPost(path: string, txHash: string): Promise<{ response: Response; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Accept": "application/json" };
  if (TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_API_KEY;
  const response = await fetch("https://api.trongrid.io" + path, {
    method: "POST", headers, body: JSON.stringify({ value: txHash })
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !publishableKey || !serviceKey) return json({ error: "Deposit verification is temporarily unavailable. Please try again later." }, 503);
  const auth = createClient(SUPABASE_URL, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user) return json({ error: "Please sign in again to submit a deposit." }, 401);
  const body = await req.json().catch(() => ({}));

  if (body.action === "list") {
    const { data, error } = await admin.from("deposit_requests")
      .select("id,amount,tx_hash,status,admin_note,created_at,reviewed_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    if (error) return json({ error: "Could not load deposit history." }, 500);
    return json({ ok: true, requests: data || [] });
  }

  const txHash = String(body.tx_hash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(txHash)) {
    return json({ error: "Enter a valid 64-character TRON transaction hash (TXID)." }, 400);
  }
  const submittedUnits = parseAmountUnits(body.amount);
  if (submittedUnits === null || submittedUnits <= 0n) {
    return json({ error: "Enter the exact USDT amount sent, using up to 6 decimal places." }, 400);
  }
  if (submittedUnits > 1000000000000000n) return json({ error: "Deposit amount is above the supported limit." }, 400);

  let transaction: any, receiptInfo: any;
  try {
    const [transactionResult, receiptResult] = await Promise.all([
      tronPost("/walletsolidity/gettransactionbyid", txHash),
      tronPost("/walletsolidity/gettransactioninfobyid", txHash)
    ]);
    if (transactionResult.response.status === 429 || transactionResult.response.status === 403 ||
        receiptResult.response.status === 429 || receiptResult.response.status === 403 ||
        !transactionResult.response.ok || !receiptResult.response.ok) {
      return json({ error: "The TRON verification service is temporarily busy. Your balance has not changed; please retry shortly." }, 503);
    }
    transaction = transactionResult.body;
    receiptInfo = receiptResult.body;
  } catch {
    return json({ error: "Could not reach the TRON network to verify this transaction. Your balance has not changed; please retry." }, 503);
  }

  const transactionId = String(transaction?.txID || transaction?.txid || "").toLowerCase();
  const receiptId = String(receiptInfo?.id || receiptInfo?.txID || "").toLowerCase();
  const blockNumber = Number(receiptInfo?.blockNumber || 0);
  if (!transactionId || transactionId !== txHash || !receiptId || receiptId !== txHash || !Number.isSafeInteger(blockNumber) || blockNumber <= 0) {
    return json({ error: "This transaction is not yet confirmed on TRON. Wait for confirmation, then submit the same TXID again." }, 425);
  }
  if (String(receiptInfo?.receipt?.result || "").toUpperCase() !== "SUCCESS") {
    return json({ error: "This transaction did not execute successfully on TRON. No balance was credited." }, 400);
  }

  let recipientHex: string;
  try { recipientHex = base58PayloadHex(DEPOSIT_ADDRESS).slice(2); }
  catch { return json({ error: "Deposit verification configuration error." }, 500); }

  const logs = Array.isArray(receiptInfo?.log) ? receiptInfo.log : (Array.isArray(receiptInfo?.logs) ? receiptInfo.logs : []);
  let verifiedUnits = 0n;
  for (const log of logs) {
    const topics = Array.isArray(log?.topics) ? log.topics.map((x: unknown) => String(x).toLowerCase().replace(/^0x/, "")) : [];
    if (normalizedContract(log?.address) !== USDT_CONTRACT_HEX || topics[0] !== TRANSFER_TOPIC || topics.length < 3) continue;
    if (topics[2].slice(-40) !== recipientHex) continue;
    const rawData = String(log?.data || "").replace(/^0x/, "");
    if (!/^[a-f0-9]+$/i.test(rawData)) continue;
    try { verifiedUnits += BigInt("0x" + rawData); } catch { /* ignore malformed event */ }
  }
  if (verifiedUnits <= 0n) {
    return json({ error: "This TXID does not contain a successful USDT TRC-20 transfer to FLEXAR's deposit address. Check the network, token and recipient." }, 400);
  }
  if (verifiedUnits !== submittedUnits) {
    const actual = (Number(verifiedUnits) / 1000000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    return json({ error: `The confirmed transfer amount is ${actual} USDT, which does not match the amount entered. Use the exact on-chain amount.` }, 400);
  }

  const actualAmount = Number(verifiedUnits) / 1000000;
  const { data: credit, error: creditError } = await admin.rpc("credit_verified_usdt_deposit", {
    p_user_id: user.id,
    p_amount: actualAmount,
    p_tx_hash: txHash,
    p_block_number: blockNumber
  });
  if (creditError) {
    const message = String(creditError.message || "");
    if (/already been credited or submitted|duplicate key/i.test(message)) {
      return json({ error: "This transaction hash has already been credited or claimed. Each on-chain transfer can only fund one account." }, 409);
    }
    return json({ error: "The transaction was verified, but FLEXAR could not update your wallet. Please contact support with this TXID; do not submit a different transaction." }, 500);
  }
  return json({ ok: true, verified: true, status: "approved", amount: actualAmount, available_balance: credit?.available_balance, tx_hash: txHash, block_number: blockNumber });
});