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
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_CONTRACT_HEX = "a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PACKAGES: Record<number, { price: number }> = {
  20:{price:10},45:{price:15},80:{price:25},140:{price:40},230:{price:60},
  320:{price:80},420:{price:100},550:{price:125},700:{price:150}
};
const corsHeaders = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...corsHeaders, "Content-Type":"application/json" }
});

function parseAmountUnits(value: unknown): bigint | null {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  try { return BigInt(whole) * 1000000n + BigInt((fraction + "000000").slice(0,6)); }
  catch { return null; }
}
function normalizedContract(value: unknown): string {
  const raw = String(value || "").trim();
  if (raw.toLowerCase() === USDT_CONTRACT.toLowerCase()) return USDT_CONTRACT_HEX;
  let v = raw.toLowerCase().replace(/^0x/,"");
  if (v.startsWith("41") && v.length === 42) v = v.slice(2);
  return v;
}
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
  let zeros = 0;
  for (const char of address) { if (char === "1") zeros++; else break; }
  hex = "00".repeat(zeros) + hex;
  const payload = hex.slice(0,-8).toLowerCase();
  if (payload.length !== 42 || !payload.startsWith("41")) throw new Error("Invalid configured TRON address");
  return payload;
}
async function tronPost(path: string, body: Record<string, unknown>): Promise<{response:Response;body:any}> {
  const headers: Record<string,string> = {"Content-Type":"application/json","Accept":"application/json"};
  if (TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_API_KEY;
  const response = await fetch("https://api.trongrid.io" + path, {method:"POST",headers,body:JSON.stringify(body)});
  const result = await response.json().catch(()=>({}));
  return {response,body:result};
}
async function getOrder(orderId: string, userId: string) {
  return await admin.from("payment_orders")
    .select("id,user_id,purpose,base_amount,payment_amount,credits,status,created_at,expires_at,tx_hash")
    .eq("id",orderId).eq("user_id",userId).maybeSingle();
}
async function createOrder(userId: string, body: Record<string,unknown>) {
  const purpose = String(body.purpose || "");
  let baseAmount: number;
  let credits: number | null = null;
  if (purpose === "ai_credits") {
    credits = Number(body.credits);
    const plan = PACKAGES[credits];
    if (!plan) return json({error:"This AI credit package is not available."},400);
    baseAmount = plan.price;
  } else if (purpose === "wallet_deposit") {
    const units = parseAmountUnits(body.amount);
    if (units === null || units <= 0n || units > 1000000000000000n) {
      return json({error:"Enter a valid USDT deposit amount with up to 6 decimal places."},400);
    }
    baseAmount = Number(units) / 1000000;
    credits = null;
  } else return json({error:"Unsupported payment purpose."},400);

  const {data,error} = await admin.rpc("create_payment_order",{
    p_user_id:userId,p_purpose:purpose,p_base_amount:baseAmount,p_credits:credits
  });
  if (error || !data?.ok) {
    console.error("create_payment_order failed",error?.message || "no order returned");
    return json({error:"FLEXAR could not create your payment request. Please try again."},500);
  }
  return json({...data,deposit_address:DEPOSIT_ADDRESS,network:"TRC-20",token:"USDT"});
}
async function confirmOrder(orderId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({error:"Select a valid payment request."},400);
  const {data:order,error:orderError} = await getOrder(orderId,userId);
  if (orderError || !order) return json({error:"Payment request not found."},404);
  if (order.status === "paid") return json({error:"This payment has already been completed.",status:"paid"},409);
  const expectedUnits = parseAmountUnits(order.payment_amount);
  if (expectedUnits === null) return json({error:"Payment request amount is invalid."},500);

  const createdMs = new Date(order.created_at).getTime();
  const params = new URLSearchParams({
    only_confirmed:"true",
    limit:"200",
    order_by:"block_timestamp,desc",
    min_timestamp:String(Math.max(0,createdMs - 5000)),
    contract_address:USDT_CONTRACT
  });
  const headers: Record<string,string> = {"Accept":"application/json"};
  if (TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = TRONGRID_API_KEY;
  let history:any;
  try {
    const response = await fetch("https://api.trongrid.io/v1/accounts/" + DEPOSIT_ADDRESS + "/transactions/trc20?" + params.toString(),{headers});
    history = await response.json().catch(()=>({}));
    if (response.status===429 || response.status===403 || !response.ok) {
      return json({error:"The TRON verification service is temporarily busy. Your balance has not changed; please try Confirm Payment again shortly."},503);
    }
  } catch {
    return json({error:"Could not reach TRON to check your payment. Your balance has not changed; please retry."},503);
  }

  const transfers = Array.isArray(history?.data) ? history.data : [];
  const candidates = transfers.filter((item:any) => {
    const contract = String(item?.token_info?.address || item?.contract_address || "");
    const to = String(item?.to || "");
    const value = String(item?.value || "");
    const timestamp = Number(item?.block_timestamp || 0);
    return normalizedContract(contract) === USDT_CONTRACT_HEX &&
      to === DEPOSIT_ADDRESS && /^\d+$/.test(value) &&
      BigInt(value) === expectedUnits && timestamp >= createdMs;
  });
  if (candidates.length === 0) {
    return json({ok:false,status:"pending",message:"Payment not detected yet. Make sure you sent the exact amount shown using USDT on the TRC-20 network, then try again."},202);
  }
  if (candidates.length > 1) {
    return json({error:"More than one matching transfer was found. FLEXAR has not credited anything to avoid assigning a payment to the wrong account. Please contact support."},409);
  }

  const transfer = candidates[0];
  const txHash = String(transfer?.transaction_id || transfer?.txID || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(txHash)) return json({error:"The matching transfer has an invalid transaction reference. Please retry shortly."},503);
  let transaction:any,receiptInfo:any;
  try {
    const [txResult,receiptResult] = await Promise.all([
      tronPost("/walletsolidity/gettransactionbyid",{value:txHash}),
      tronPost("/walletsolidity/gettransactioninfobyid",{value:txHash})
    ]);
    if ([txResult,receiptResult].some(x=>x.response.status===429||x.response.status===403||!x.response.ok)) {
      return json({error:"TRON finality verification is temporarily busy. Please retry shortly."},503);
    }
    transaction=txResult.body; receiptInfo=receiptResult.body;
  } catch {
    return json({error:"Could not verify the transfer's final TRON receipt. Please retry shortly."},503);
  }
  const transactionId=String(transaction?.txID||transaction?.txid||"").toLowerCase();
  const receiptId=String(receiptInfo?.id||receiptInfo?.txID||"").toLowerCase();
  const blockNumber=Number(receiptInfo?.blockNumber||0);
  if (transactionId!==txHash || receiptId!==txHash || !Number.isSafeInteger(blockNumber) || blockNumber<=0) {
    return json({error:"The payment is detected but not yet finally confirmed. Please wait a little and try again."},202);
  }
  if (String(receiptInfo?.receipt?.result||"").toUpperCase()!=="SUCCESS") {
    return json({error:"The transfer did not execute successfully on TRON. No balance was credited."},400);
  }

  let recipientHex:string;
  try { recipientHex=base58PayloadHex(DEPOSIT_ADDRESS).slice(2); }
  catch { return json({error:"Deposit verification configuration error."},500); }
  const logs=Array.isArray(receiptInfo?.log)?receiptInfo.log:(Array.isArray(receiptInfo?.logs)?receiptInfo.logs:[]);
  let verifiedUnits=0n;
  for (const log of logs) {
    const topics=Array.isArray(log?.topics)?log.topics.map((x:unknown)=>String(x).toLowerCase().replace(/^0x/,"")):[];
    if (normalizedContract(log?.address)!==USDT_CONTRACT_HEX || topics[0]!==TRANSFER_TOPIC || topics.length<3) continue;
    if (topics[2].slice(-40)!==recipientHex) continue;
    const raw=String(log?.data||"").replace(/^0x/,"");
    if (!/^[a-f0-9]+$/i.test(raw)) continue;
    try { verifiedUnits += BigInt("0x"+raw); } catch {}
  }
  if (verifiedUnits!==expectedUnits) {
    return json({error:"The final transaction receipt does not match the exact payment amount for this request. No balance was changed."},409);
  }

  const verifiedAmount=Number(verifiedUnits)/1000000;
  const {data:result,error:completeError}=await admin.rpc("complete_payment_order",{
    p_order_id:order.id,p_tx_hash:txHash,p_block_number:blockNumber,p_verified_amount:verifiedAmount
  });
  if (completeError) {
    const message=String(completeError.message||"");
    if (/already been completed|already been claimed|already been credited|already been claimed or credited/i.test(message)) {
      return json({error:"This payment or transaction has already been processed. FLEXAR will not credit it twice."},409);
    }
    console.error("complete_payment_order failed",message);
    return json({error:"The transfer was verified, but account crediting failed. Please contact support and do not send another payment."},500);
  }
  return json({ok:true,...result});
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"POST required"},405);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!publishableKey||!serviceKey) return json({error:"Payment service is temporarily unavailable."},503);
  const auth=createClient(SUPABASE_URL,publishableKey,{global:{headers:{Authorization:"Bearer "+token}}});
  const {data:{user},error:authError}=await auth.auth.getUser(token);
  if(authError||!user) return json({error:"Please sign in again to continue."},401);
  const body=await req.json().catch(()=>({}));
  if(body.action==="list"){
    const {data,error}=await admin.from("payment_orders")
      .select("id,purpose,base_amount,payment_amount,credits,status,tx_hash,created_at,expires_at,paid_at")
      .eq("user_id",user.id).order("created_at",{ascending:false}).limit(30);
    if(error) return json({error:"Could not load payment history."},500);
    return json({ok:true,requests:data||[]});
  }
  if(body.action==="create") return await createOrder(user.id,body);
  if(body.action==="confirm") return await confirmOrder(String(body.order_id||""),user.id);
  return json({error:"Unsupported payment action."},400);
});