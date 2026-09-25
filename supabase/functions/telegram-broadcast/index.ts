import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

const admin = createClient(url, serviceKey);

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !publishableKey) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const auth = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await auth.auth.getUser(token);
  if (!userData.user) return Response.json({ error: "Invalid session" }, { status: 401 });

  const { data: adminProfile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!adminProfile?.is_admin) return Response.json({ error: "Admin access required." }, { status: 403 });
  if (!botToken) return Response.json({ error: "TELEGRAM_BOT_TOKEN is not configured." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 4096) return Response.json({ error: "Message must be 1-4096 characters." }, { status: 400 });

  const { data: subscribers, error } = await admin
    .from("profiles")
    .select("id,telegram_user_id")
    .eq("telegram_bot_access_granted", true)
    .eq("telegram_notifications_enabled", true)
    .not("telegram_user_id", "is", null);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;

  for (const subscriber of subscribers ?? []) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: subscriber.telegram_user_id, text: message }),
    }).catch(() => null);

    if (response?.ok) sent += 1;
    else failed += 1;
  }

  return Response.json({ ok: true, total: subscribers?.length ?? 0, sent, failed });
});