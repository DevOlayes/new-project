import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const publishableKey = publishableKeys.default || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const admin = createClient(url, serviceKey);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json"
};
const PACKAGES: Record<number, { price: number; bonus: number }> = {
  20: { price: 10, bonus: 0 },
  45: { price: 15, bonus: 0 },
  80: { price: 25, bonus: 0 },
  140: { price: 40, bonus: 0 },
  230: { price: 60, bonus: 0 },
  320: { price: 80, bonus: 0 },
  420: { price: 100, bonus: 0 },
  550: { price: 125, bonus: 0 },
  700: { price: 150, bonus: 0 }
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: cors });
  if (req.method !== "POST") return respond({ error: "POST required." }, 405);

  const suppliedKey = req.headers.get("apikey") || "";
  if (!publishableKey || suppliedKey !== publishableKey) {
    return respond({ error: "Unauthorized request key." }, 401);
  }

  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return respond({ error: "Please sign in again before buying AI credits." }, 401);

  const { data: authData, error: authError } = await admin.auth.getUser(bearer);
  const userId = authData?.user?.id;
  if (authError || !userId) {
    return respond({ error: "Your session could not be verified. Please sign out and sign in again." }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return respond({ error: "Invalid purchase request." }, 400);
  }
  if (body.action !== "buy") return respond({ error: "Unsupported action." }, 400);

  const credits = Number(body.credits);
  const plan = PACKAGES[credits];
  if (!plan || Number(body.price_usd) !== plan.price) {
    return respond({ error: "This AI credit package is not available.", code: "invalid_package" }, 400);
  }

  const { data, error } = await admin.rpc("purchase_ai_credits", {
    p_user_id: userId,
    p_credits: credits,
    p_price_usd: plan.price
  });
  if (error) {
    console.error("purchase_ai_credits RPC failed:", error.message);
    return respond({ error: "The wallet purchase could not be processed. Please try again or contact support.", code: "purchase_processing_failed" }, 500);
  }
  if (!data?.ok) {
    const message = data?.reason === "insufficient_wallet_balance"
      ? "You need at least $" + plan.price + " USDT in your FLEXAR wallet to buy this package."
      : data?.reason === "invalid_package"
        ? "This AI credit package is not available."
        : "The wallet purchase could not be completed.";
    return respond({ error: message, code: data?.reason || "purchase_failed" }, 402);
  }
  return respond(data);
});