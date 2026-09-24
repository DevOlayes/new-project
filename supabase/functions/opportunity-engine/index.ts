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

const SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const VERSION = "opportunity-v1";
const DURATION_SECONDS = 3600;

function clamp(value: number, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function number(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function timeframeAlignment(values: number[]) {
  if (!values.length) return 0;
  const positive = values.filter((v) => v > 0.08).length;
  const negative = values.filter((v) => v < -0.08).length;
  return Math.max(positive, negative) / values.length;
}

function featureStrength(row: Record<string, unknown>) {
  const trend = number(row.trend_score);
  const momentum = number(row.momentum_score);
  const structure = number(row.structure_score);

  // This is an opportunity score, not a prediction model.
  return clamp(trend * 0.45 + momentum * 0.35 + structure * 0.20);
}

function volatilityQuality(row: Record<string, unknown>) {
  const v = Math.abs(number(row.volatility_20));
  if (!v) return 0.5;

  // Prefer ordinary, tradeable conditions and reduce weight for extreme volatility.
  if (v < 0.001) return 0.35;
  if (v <= 0.008) return 1;
  if (v <= 0.015) return 0.65;
  return 0.25;
}

function volumeQuality(row: Record<string, unknown>) {
  const change = number(row.volume_change_20);
  if (change >= 0) return Math.min(1, 0.65 + change * 0.25);
  return Math.max(0.2, 0.65 + change * 0.5);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST required" }, { status: 405 });
  }

  const authorization = req.headers.get("authorization") ?? "";
  const suppliedKey = req.headers.get("apikey") ?? authorization.replace(/^Bearer\s+/i, "");
  if (!suppliedKey || ![PUBLISHABLE_KEY, ...PUBLISHABLE_KEYS].includes(suppliedKey)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startsAt = new Date(now.getTime() + 60 * 60 * 1000);
  startsAt.setSeconds(0, 0);

  const closesAt = new Date(startsAt.getTime() + DURATION_SECONDS * 1000);
  const results: Record<string, unknown>[] = [];

  for (const symbol of SYMBOLS) {
    const { data: rows, error } = await supabase
      .from("market_features")
      .select("*")
      .eq("symbol", symbol)
      .in("interval", ["1m", "5m", "15m", "1h"])
      .order("candle_open_time", { ascending: false })
      .limit(80);

    if (error) throw error;

    const latest: Record<string, Record<string, unknown>> = {};
    for (const row of rows ?? []) {
      const interval = String(row.interval);
      if (!latest[interval]) latest[interval] = row;
    }

    const required = ["1m", "5m", "15m", "1h"];
    if (required.some((interval) => !latest[interval])) {
      results.push({ symbol, status: "insufficient_features" });
      continue;
    }

    const features = required.map((interval) => latest[interval]);
    const directionalScores = features.map(featureStrength);
    const combined = clamp(
      directionalScores[0] * 0.15 +
      directionalScores[1] * 0.20 +
      directionalScores[2] * 0.25 +
      directionalScores[3] * 0.40
    );

    const alignment = timeframeAlignment(directionalScores);
    const volatility = (
      volatilityQuality(latest["1m"]) * 0.15 +
      volatilityQuality(latest["5m"]) * 0.20 +
      volatilityQuality(latest["15m"]) * 0.25 +
      volatilityQuality(latest["1h"]) * 0.40
    );
    const volume = (
      volumeQuality(latest["1m"]) * 0.15 +
      volumeQuality(latest["5m"]) * 0.20 +
      volumeQuality(latest["15m"]) * 0.25 +
      volumeQuality(latest["1h"]) * 0.40
    );

    const absSignal = Math.abs(combined);
    const confidence = clamp(
      absSignal * 0.55 +
      alignment * 0.25 +
      volatility * 0.10 +
      volume * 0.10,
      0,
      1
    );

    // Require agreement across timeframes and a meaningful combined signal.
    if (absSignal < 0.25 || alignment < 0.75 || confidence < 0.62) {
      results.push({
        symbol,
        status: "no_high_quality_opportunity",
        signal: Number(combined.toFixed(4)),
        confidence: Number(confidence.toFixed(4)),
      });
      continue;
    }

    const direction = combined > 0 ? "up" : "down";
    const entryPrice = number(latest["1m"].close_price);

    const reason = [
      `${Math.round(alignment * 100)}% timeframe alignment`,
      `trend/momentum/structure agreement`,
      `volatility quality ${Math.round(volatility * 100)}%`,
      `volume quality ${Math.round(volume * 100)}%`,
    ].join(" • ");

    const snapshot = {
      generated_at: now.toISOString(),
      direction,
      combined_signal: Number(combined.toFixed(6)),
      timeframe_alignment: Number(alignment.toFixed(6)),
      volatility_quality: Number(volatility.toFixed(6)),
      volume_quality: Number(volume.toFixed(6)),
      features: Object.fromEntries(
        required.map((interval) => [
          interval,
          {
            candle_open_time: latest[interval].candle_open_time,
            close_price: latest[interval].close_price,
            trend_score: latest[interval].trend_score,
            momentum_score: latest[interval].momentum_score,
            structure_score: latest[interval].structure_score,
            volatility_20: latest[interval].volatility_20,
            volume_change_20: latest[interval].volume_change_20,
          },
        ])
      ),
    };

    const { data: existing } = await supabase
      .from("ai_opportunities")
      .select("id")
      .eq("symbol", symbol)
      .eq("entry_window_start", startsAt.toISOString())
      .eq("model_version", VERSION)
      .limit(1);

    if (existing?.length) {
      results.push({ symbol, status: "already_exists" });
      continue;
    }

    const { data, error: insertError } = await supabase
      .from("ai_opportunities")
      .insert({
        symbol,
        direction,
        duration_seconds: DURATION_SECONDS,
        entry_window_start: startsAt.toISOString(),
        entry_window_end: closesAt.toISOString(),
        signal_score: Number(confidence.toFixed(6)),
        model_version: VERSION,
        status: "scheduled",
        entry_price: entryPrice,
        metadata: {
          reason,
          engine: VERSION,
          signal: Number(combined.toFixed(6)),
          timeframe_alignment: Number(alignment.toFixed(6)),
          volatility_quality: Number(volatility.toFixed(6)),
          volume_quality: Number(volume.toFixed(6)),
          feature_snapshot: snapshot,
        },
      })
      .select("id, symbol, direction, entry_window_start, entry_window_end, signal_score")
      .single();

    if (insertError) throw insertError;
    results.push({ symbol, status: "created", opportunity: data });
  }

  return Response.json({
    engine: VERSION,
    generated_at: now.toISOString(),
    target_start: startsAt.toISOString(),
    target_close: closesAt.toISOString(),
    results,
  });
});