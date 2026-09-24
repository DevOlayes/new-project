import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const PUBLISHABLE_KEYS_RAW = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}";

let PUBLISHABLE_KEYS: string[] = [];
try {
  const parsed = JSON.parse(PUBLISHABLE_KEYS_RAW);
  PUBLISHABLE_KEYS = Object.values(parsed).filter(
    (value) => typeof value === "string",
  ) as string[];
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

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST required" }, { status: 405 });
  }

  if (!isAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Settled opportunities are copied into a stable, normalized dataset.
  // The original ai_opportunities row remains the source of truth for the outcome.
  const { data: opportunities, error } = await supabase
    .from("ai_opportunities")
    .select(
      "id, symbol, direction, duration_seconds, model_version, signal_score, entry_window_start, entry_window_end, entry_price, exit_price, outcome, metadata",
    )
    .eq("status", "settled")
    .not("outcome", "is", null)
    .order("updated_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  const results: Record<string, unknown>[] = [];

  for (const opportunity of opportunities ?? []) {
    // The unique opportunity_id constraint makes repeated cron runs safe.
    const { data: existing, error: existingError } = await supabase
      .from("opportunity_evaluation_dataset")
      .select("id")
      .eq("opportunity_id", opportunity.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) continue;

    if (opportunity.entry_price == null || opportunity.exit_price == null) {
      results.push({
        opportunity_id: opportunity.id,
        action: "skipped_missing_prices",
      });
      continue;
    }

    const metadata =
      opportunity.metadata &&
      typeof opportunity.metadata === "object"
        ? opportunity.metadata as Record<string, unknown>
        : {};

    // The opportunity engine stores the pre-trade feature snapshot here.
    // Keeping that snapshot immutable prevents post-outcome data leakage into training.
    const featureSnapshot =
      metadata.feature_snapshot &&
      typeof metadata.feature_snapshot === "object"
        ? metadata.feature_snapshot
        : {};

    const entryPrice = number(opportunity.entry_price);
    const exitPrice = number(opportunity.exit_price);

    const calculatedPriceChange =
      entryPrice === 0
        ? 0
        : ((exitPrice - entryPrice) / entryPrice) * 100;

    const priceChangePct =
      typeof metadata.price_change_pct === "number"
        ? metadata.price_change_pct
        : calculatedPriceChange;

    // Binary learning labels are only assigned to decided outcomes.
    // A void result stays null instead of being treated as a win or loss.
    const outcomeLabel =
      opportunity.outcome === "won"
        ? 1
        : opportunity.outcome === "lost"
          ? 0
          : null;

    const { error: insertError } = await supabase
      .from("opportunity_evaluation_dataset")
      .insert({
        opportunity_id: opportunity.id,
        symbol: opportunity.symbol,
        direction: opportunity.direction,
        duration_seconds: opportunity.duration_seconds,
        model_version: opportunity.model_version,
        signal_score: opportunity.signal_score,
        entry_window_start: opportunity.entry_window_start,
        entry_window_end: opportunity.entry_window_end,
        entry_price: entryPrice,
        exit_price: exitPrice,
        outcome: opportunity.outcome,
        outcome_label: outcomeLabel,
        price_change_pct: Number(priceChangePct.toFixed(8)),
        feature_snapshot: featureSnapshot,
        source_metadata: {
          engine: metadata.engine ?? null,
          reason: metadata.reason ?? null,
          combined_signal: metadata.signal ?? metadata.combined_signal ?? null,
          timeframe_alignment: metadata.timeframe_alignment ?? null,
          volatility_quality: metadata.volatility_quality ?? null,
          volume_quality: metadata.volume_quality ?? null,
        },
        evaluated_at: now.toISOString(),
      });

    if (insertError) {
      // Two overlapping runs can see the same source row. The unique key
      // makes the second insert harmless; other database errors still surface.
      if (insertError.code === "23505") continue;
      throw insertError;
    }

    results.push({
      opportunity_id: opportunity.id,
      action: "dataset_row_created",
      outcome: opportunity.outcome,
    });
  }

  return Response.json({
    engine: "performance-dataset-v1",
    processed_at: now.toISOString(),
    settled_scanned: opportunities?.length ?? 0,
    dataset_rows_created: results.filter(
      (result) => result.action === "dataset_row_created",
    ).length,
    results,
  });
});