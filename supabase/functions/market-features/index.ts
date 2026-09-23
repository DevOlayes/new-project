import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Stage 2: Market Feature Engine.
// Converts normalized candles into descriptive numerical features.
// This stage does not generate trade signals or tell users what to trade.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLISHABLE_KEYS = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const SUPABASE_SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ENGINE_KEY = PUBLISHABLE_KEYS.default;
const SERVICE_KEY = SUPABASE_SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !ENGINE_KEY || !SERVICE_KEY) {
  throw new Error("Supabase server configuration is missing.");
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const INTERVALS = ["1m", "5m", "15m", "1h"];
const SOURCE = "binance_spot";
const LOOKBACK = 120;

function ema(values: number[], period: number) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    value = (values[i] - value) * multiplier + value;
  }

  return value;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;

  const relativeStrength = avgGain / avgLoss;
  return 100 - (100 / (1 + relativeStrength));
}

function atr(rows: any[], period = 14) {
  if (rows.length <= period) return null;

  const ranges = [];

  for (let i = 1; i < rows.length; i++) {
    const previousClose = Number(rows[i - 1].close_price);
    const high = Number(rows[i].high_price);
    const low = Number(rows[i].low_price);

    ranges.push(
      Math.max(
        high - low,
        Math.abs(high - previousClose),
        Math.abs(low - previousClose),
      ),
    );
  }

  if (ranges.length < period) return null;

  let value = ranges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < ranges.length; i++) {
    value = ((value * (period - 1)) + ranges[i]) / period;
  }

  return value;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  return Math.sqrt(variance);
}

function clamp(value: number, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

async function calculate(symbol: string, interval: string) {
  const { data: candles, error } = await admin
    .from("market_candles")
    .select(
      "symbol,interval,open_time,open_price,high_price,low_price,close_price,volume,source",
    )
    .eq("symbol", symbol)
    .eq("interval", interval)
    .eq("source", SOURCE)
    .order("open_time", { ascending: false })
    .limit(LOOKBACK);

  if (error) {
    throw new Error(`Failed to read candles: ${error.message}`);
  }

  if (!candles || candles.length < 60) {
    return { symbol, interval, rows: 0, reason: "insufficient_candles" };
  }

  // Reverse the newest-first database result so all calculations run
  // chronologically from oldest candle to newest candle.
  const rows = [...candles].reverse();

  const closes = rows.map((row) => Number(row.close_price));
  const volumes = rows.map((row) => Number(row.volume));

  const latest = rows[rows.length - 1];
  const latestClose = Number(latest.close_price);

  const returnFor = (period: number) =>
    closes.length > period
      ? (latestClose / closes[closes.length - 1 - period]) - 1
      : null;

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(rows, 14);

  const recentReturns: number[] = [];

  for (let i = Math.max(1, closes.length - 20); i < closes.length; i++) {
    recentReturns.push((closes[i] / closes[i - 1]) - 1);
  }

  const volatility20 = standardDeviation(recentReturns);

  const recentVolume = volumes.slice(-20);
  const avgVolume20 =
    recentVolume.reduce((a, b) => a + b, 0) / recentVolume.length;

  const volumeChange20 =
    avgVolume20 > 0
      ? (volumes[volumes.length - 1] / avgVolume20) - 1
      : null;

  // Descriptive trend score:
  // positive = stronger upward structure, negative = stronger downward structure.
  // It is intentionally not a trade signal.
  const trendScore =
    ema9 !== null && ema21 !== null && ema50 !== null
      ? clamp(
          ((ema9 - ema21) / latestClose) * 40 +
            ((ema21 - ema50) / latestClose) * 20,
        )
      : null;

  // Descriptive momentum score based on short and medium returns.
  const return5 = returnFor(5);
  const return15 = returnFor(15);

  const momentumScore =
    return5 !== null && return15 !== null
      ? clamp(return5 * 50 + return15 * 25)
      : null;

  // Position of the latest close inside the recent 20-candle range.
  const recentHigh = Math.max(
    ...rows.slice(-20).map((row) => Number(row.high_price)),
  );
  const recentLow = Math.min(
    ...rows.slice(-20).map((row) => Number(row.low_price)),
  );
  const range = recentHigh - recentLow;

  const structureScore =
    range > 0
      ? clamp(((latestClose - recentLow) / range) * 2 - 1)
      : null;

  const featureRow = {
    symbol,
    interval,
    candle_open_time: latest.open_time,
    source: SOURCE,
    close_price: latestClose,
    return_1: returnFor(1),
    return_5: return5,
    return_15: return15,
    ema_9: ema9,
    ema_21: ema21,
    ema_50: ema50,
    rsi_14: rsi14,
    atr_14: atr14,
    volatility_20: volatility20,
    volume_change_20: volumeChange20,
    trend_score: trendScore,
    momentum_score: momentumScore,
    structure_score: structureScore,
  };

  const { error: upsertError } = await admin
    .from("market_features")
    .upsert(featureRow, {
      onConflict: "symbol,interval,candle_open_time,source",
      ignoreDuplicates: false,
    });

  if (upsertError) {
    throw new Error(`Feature upsert failed: ${upsertError.message}`);
  }

  return {
    symbol,
    interval,
    rows: 1,
    candle_open_time: latest.open_time,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (req.headers.get("x-flexar-engine-key") !== ENGINE_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = [];

    for (const symbol of SYMBOLS) {
      for (const interval of INTERVALS) {
        results.push(await calculate(symbol, interval));
      }
    }

    return Response.json({
      ok: true,
      engine: "flexar-market-feature-engine",
      datasets: results,
      calculated_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});
