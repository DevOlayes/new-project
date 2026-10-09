import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const text = (value: unknown, max: number, fallback = "") =>
  typeof value === "string" ? value.slice(0, max) : fallback;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "POST required" });
  try {
    const raw = await req.text();
    if (raw.length > 48_000) return json(413, { ok: false, error: "Payload too large" });
    const body = JSON.parse(raw);
    if (!Array.isArray(body?.events) || body.events.length < 1 || body.events.length > 15) {
      return json(400, { ok: false, error: "Expected 1–15 diagnostic events" });
    }
    const allowedLevels = new Set(["info", "warning", "error"]);
    const rows = body.events.map((event: Record<string, unknown>) => ({
      event_time: text(event.timestamp, 40, new Date().toISOString()),
      diagnostic_id: text(event.diagnosticId, 80, crypto.randomUUID()),
      session_id: text(event.sessionId, 80, "unknown"),
      level: allowedLevels.has(String(event.level)) ? String(event.level) : "error",
      source: text(event.source, 40, "client"),
      event_name: text(event.eventName, 100, "unknown_event"),
      message: text(event.message, 1200, "No message supplied"),
      stack: text(event.stack, 5000) || null,
      page_path: text(event.pagePath, 300) || null,
      request_path: text(event.requestPath, 300) || null,
      http_status: Number.isInteger(event.httpStatus) ? Number(event.httpStatus) : null,
      duration_ms: Number.isFinite(event.durationMs) ? Math.max(0, Math.min(600000, Number(event.durationMs))) : null,
      browser_family: text(event.browserFamily, 80) || null,
      metadata: event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata : {},
    }));
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      console.error(JSON.stringify({ tag: "FLEXAR_DIAG_INGEST", error: "Missing Supabase server configuration" }));
      return json(503, { ok: false, error: "Diagnostic storage is not configured" });
    }
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.from("client_diagnostic_events").insert(rows);
    if (error) {
      console.error(JSON.stringify({ tag: "FLEXAR_DIAG_INGEST", error: error.message, code: error.code, eventCount: rows.length }));
      return json(500, { ok: false, error: "Could not store diagnostic events" });
    }
    return json(200, { ok: true, accepted: rows.length });
  } catch (error) {
    console.error(JSON.stringify({ tag: "FLEXAR_DIAG_INGEST", error: error instanceof Error ? error.message : String(error) }));
    return json(400, { ok: false, error: "Invalid diagnostic payload" });
  }
});
