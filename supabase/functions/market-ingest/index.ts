import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Stage 1 market ingestion.
// The browser is never the market-data source of truth.
// This server-side function fetches public Binance spot candles and stores
// normalized rows in Supabase for the future analysis engine.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLISHABLE_KEYS = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const SUPABASE_SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");

const SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE_KEYS.default;
const SUPABASE_SECRET_KEY = SUPABASE_SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Supabase server configuration is missing.");
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const INTERVALS = ["1m", "5m", "15m", "1h"];
const SOURCE = "binance_spot";
const LIMIT = 500;

async function fetchCandles(symbol: string, interval: string) {
  const url = new URL("https://data-api.binance.vision/api/v3/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(LIMIT));

  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Binance returned HTTP ${response.status} for ${symbol} ${interval}.`);
  }

  const rows = await response.json();

  return rows.map((row: unknown[]) => ({
    symbol,
    interval,
    open_time: new Date(Number(row[0])).toISOString(),
    open_price: Number(row[1]),
    high_price: Number(row[2]),
    low_price: Number(row[3]),
    close_price: Number(row[4]),
    volume: Number(row[5]),
    source: SOURCE,
  }));
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // The publishable key is intentionally used only as a lightweight
    // service-to-service gate here; it is not a secret and is safe to expose
    // in the browser. The endpoint only ingests public market data.
    const providedKey = req.headers.get("x-flexar-engine-key");
    if (!providedKey || providedKey !== SUPABASE_PUBLISHABLE_KEY) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const results = [];
    let totalRows = 0;

    for (const symbol of SYMBOLS) {
      for (const interval of INTERVALS) {
        const candles = await fetchCandles(symbol, interval);

        const { error } = await admin
          .from("market_candles")
          .upsert(candles, {
            onConflict: "symbol,interval,open_time,source",
            ignoreDuplicates: false,
          });

        if (error) {
          throw new Error(`Database upsert failed for ${symbol} ${interval}: ${error.message}`);
        }

        totalRows += candles.length;
        results.push({ symbol, interval, rows: candles.length });
      }
    }

    return Response.json({
      ok: true,
      source: SOURCE,
      total_rows_processed: totalRows,
      datasets: results,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
});
