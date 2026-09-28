import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ids = {
  BTC: "bitcoin",
  TON: "the-open-network",
  SOL: "solana",
  BNB: "binancecoin",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: cors });

  try {
    const body = await req.json();
    const fromAsset = String(body?.from_asset || "").toUpperCase();
    const toAsset = String(body?.to_asset || "").toUpperCase();
    const amount = Number(body?.amount);

    if (!["TON","USDT","BTC","SOL","BNB"].includes(fromAsset) || !["TON","USDT","BTC","SOL","BNB"].includes(toAsset)) {
      throw new Error("Unsupported asset");
    }
    if (fromAsset === toAsset) throw new Error("Choose two different assets");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount");

    const prices: Record<string, number> = { USDT: 1 };
    const needed = [fromAsset, toAsset].filter((asset, index, list) => asset !== "USDT" && list.indexOf(asset) === index);
    if (needed.length) {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=" +
        needed.map(asset => ids[asset as keyof typeof ids]).join(",") +
        "&vs_currencies=usd",
        { headers: { "Accept": "application/json" } }
      );
      if (!response.ok) throw new Error("Live market quote unavailable");
      const data = await response.json();
      for (const asset of needed) {
        const price = Number(data?.[ids[asset as keyof typeof ids]]?.usd);
        if (!Number.isFinite(price) || price <= 0) throw new Error("Live price unavailable for " + asset);
        prices[asset] = price;
      }
    }

    const rate = prices[fromAsset] / prices[toAsset];
    const { data, error } = await supabase.rpc("swap_assets", {
      p_from_asset: fromAsset,
      p_to_asset: toAsset,
      p_amount: amount,
      p_rate: rate,
    });
    if (error) throw new Error(error.message || "Swap failed");

    return new Response(JSON.stringify(data), { status: 200, headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Swap failed" }), { status: 400, headers: cors });
  }
});
