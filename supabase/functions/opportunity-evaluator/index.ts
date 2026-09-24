import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const PUBLISHABLE_KEYS_RAW = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}";
let PUBLISHABLE_KEYS: string[] = [];
try {
  const parsed = JSON.parse(PUBLISHABLE_KEYS_RAW);
  PUBLISHABLE_KEYS = Object.values(parsed).filter((value) => typeof value === "string") as string[];
} catch {
  PUBLISHABLE_KEYS = [];
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function isAuthorized(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const suppliedKey =
    req.headers.get("apikey") ??
    authorization.replace(/^Bearer\s+/i, "");

  return [PUBLISHABLE_KEY, ...PUBLISHABLE_KEYS].includes(suppliedKey);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST required" }, { status: 405 });
  }

  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const results: Record<string, unknown>[] = [];

  // Step 1: Open opportunities when their entry window begins.
  const { data: scheduled, error: scheduledError } = await supabase
    .from("ai_opportunities")
    .select("id, symbol, direction, entry_window_start, entry_window_end, metadata")
    .eq("status", "scheduled")
    .lte("entry_window_start", now.toISOString())
    .limit(50);

  if (scheduledError) throw scheduledError;

  for (const opportunity of scheduled ?? []) {
    const { data: candle, error: candleError } = await supabase
      .from("market_candles")
      .select("open_time, close_price")
      .eq("symbol", opportunity.symbol)
      .eq("interval", "1m")
      .lte("open_time", opportunity.entry_window_start)
      .order("open_time", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (candleError) throw candleError;

    if (!candle) {
      results.push({
        id: opportunity.id,
        symbol: opportunity.symbol,
        action: "waiting_for_entry_price",
      });
      continue;
    }

    // Conditional update makes the transition idempotent if two runs overlap.
    const { data: opened, error: openError } = await supabase
      .from("ai_opportunities")
      .update({
        status: "open",
        entry_price: candle.close_price,
        updated_at: now.toISOString(),
        metadata: {
          ...(opportunity.metadata && typeof opportunity.metadata === "object"
            ? opportunity.metadata
            : {}),
          entry_price_source: "market_candles",
          entry_price_candle_time: candle.open_time,
          entry_opened_at: now.toISOString(),
        },
      })
      .eq("id", opportunity.id)
      .eq("status", "scheduled")
      .is("entry_price", null)
      .select("id, symbol, direction, entry_price, entry_window_start, entry_window_end")
      .maybeSingle();

    if (openError) throw openError;

    results.push({
      id: opportunity.id,
      symbol: opportunity.symbol,
      action: opened ? "opened" : "already_opened",
      entry_price: opened?.entry_price ?? candle.close_price,
    });
  }

  // Step 2: Settle opportunities whose duration has completed.
  const { data: openOpportunities, error: openError } = await supabase
    .from("ai_opportunities")
    .select("id, symbol, direction, entry_price, entry_window_end, metadata")
    .eq("status", "open")
    .lte("entry_window_end", now.toISOString())
    .limit(50);

  if (openError) throw openError;

  for (const opportunity of openOpportunities ?? []) {
    const { data: candle, error: candleError } = await supabase
      .from("market_candles")
      .select("open_time, close_price")
      .eq("symbol", opportunity.symbol)
      .eq("interval", "1m")
      .lte("open_time", opportunity.entry_window_end)
      .order("open_time", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (candleError) throw candleError;

    if (!candle || opportunity.entry_price == null) {
      results.push({
        id: opportunity.id,
        symbol: opportunity.symbol,
        action: "waiting_for_exit_price",
      });
      continue;
    }

    const entryPrice = Number(opportunity.entry_price);
    const exitPrice = Number(candle.close_price);
    const priceChangePct =
      entryPrice === 0 ? 0 : ((exitPrice - entryPrice) / entryPrice) * 100;

    let outcome: "won" | "lost" | "void";
    if (exitPrice === entryPrice) {
      outcome = "void";
    } else if (opportunity.direction === "up") {
      outcome = exitPrice > entryPrice ? "won" : "lost";
    } else {
      outcome = exitPrice < entryPrice ? "won" : "lost";
    }

    const existingMetadata =
      opportunity.metadata && typeof opportunity.metadata === "object"
        ? opportunity.metadata
        : {};

    const settlementMetadata = {
      ...existingMetadata,
      exit_price_source: "market_candles",
      exit_price_candle_time: candle.open_time,
      settled_at: now.toISOString(),
      price_change_pct: Number(priceChangePct.toFixed(6)),
    };

    // Conditional update makes settlement idempotent.
    const { data: settled, error: settleError } = await supabase
      .from("ai_opportunities")
      .update({
        status: "settled",
        exit_price: exitPrice,
        outcome,
        updated_at: now.toISOString(),
        metadata: settlementMetadata,
      })
      .eq("id", opportunity.id)
      .eq("status", "open")
      .select("id, symbol, direction, entry_price, exit_price, outcome")
      .maybeSingle();

    if (settleError) throw settleError;

    results.push({
      id: opportunity.id,
      symbol: opportunity.symbol,
      action: settled ? "settled" : "already_settled",
      outcome,
      entry_price: entryPrice,
      exit_price: exitPrice,
      price_change_pct: Number(priceChangePct.toFixed(6)),
    });
  }

  return Response.json({
    engine: "opportunity-evaluation-v1",
    processed_at: now.toISOString(),
    results,
  });
});