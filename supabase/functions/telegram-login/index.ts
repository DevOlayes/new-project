import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function hmac(keyBytes, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(message),
    ),
  );
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

// Telegram Login Widget uses a different signature derivation from Mini Apps.
// secret_key = SHA256(bot_token)
// hash = HMAC-SHA256(data_check_string, secret_key)
async function verifyTelegramLogin(telegramUser, botToken) {
  if (!telegramUser?.id || !telegramUser?.auth_date || !telegramUser?.hash) {
    throw new Error("Invalid Telegram login data.");
  }

  const authDate = Number(telegramUser.auth_date);
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86400) {
    throw new Error("Telegram login data has expired.");
  }

  const receivedHash = String(telegramUser.hash);
  const fields = Object.entries(telegramUser)
    .filter(([key]) => key !== "hash" && telegramUser[key] !== undefined && telegramUser[key] !== null)
    .map(([key, value]) => `${key}=${value}`)
    .sort();

  const dataCheckString = fields.join("\n");
  const secretKey = await sha256(new TextEncoder().encode(botToken));
  const calculatedHash = toHex(await hmac(secretKey, dataCheckString));

  if (!safeEqual(calculatedHash, receivedHash)) {
    throw new Error("Telegram login signature is invalid.");
  }

  return telegramUser;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabaseKeys() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");

  return {
    secretKey:
      secretKeys.default ||
      Deno.env.get("SUPABASE_SECRET_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      "",
    publishableKey:
      publishableKeys.default ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
      Deno.env.get("SUPABASE_ANON_KEY") ||
      "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const telegramUser = await verifyTelegramLogin(
      body?.telegram_user,
      Deno.env.get("TELEGRAM_BOT_TOKEN") || "",
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const { secretKey, publishableKey } = getSupabaseKeys();

    if (!supabaseUrl || !secretKey || !publishableKey) {
      throw new Error("Supabase server credentials are not configured.");
    }

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const client = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const telegramId = String(telegramUser.id);
    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("id")
      .eq("telegram_user_id", telegramId)
      .maybeSingle();

    if (profileLookupError) throw profileLookupError;

    const email = `telegram_${telegramId}@flexa.invalid`;
    const password = `${crypto.randomUUID()}-${crypto.randomUUID()}`;

    let authUser;
    if (existingProfile?.id) {
      const { data, error } = await admin.auth.admin.updateUserById(existingProfile.id, {
        password,
        email_confirm: true,
      });
      if (error) throw error;
      authUser = data.user;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      authUser = data.user;
    }

    const displayName =
      [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(" ") ||
      telegramUser.username ||
      "Flexa AI user";

    const profileUpdate = {
      id: authUser.id,
      telegram_user_id: telegramId,
      telegram_username: telegramUser.username || null,
      display_name: displayName,
      avatar_url: telegramUser.photo_url || null,
      referral_code: `TG${telegramId}`,
      telegram_bot_access_granted: telegramUser.allows_write_to_pm === true,
      telegram_notifications_enabled: true,
      telegram_connected_at: new Date().toISOString(),
      last_login_provider: "telegram",
    };

    const { error: profileError } = await admin
      .from("profiles")
      .upsert(profileUpdate, { onConflict: "id" });
    if (profileError) throw profileError;

    const { error: walletError } = await admin
      .from("wallets")
      .upsert(
        [
          { user_id: authUser.id, asset: "TON", network: "TON" },
          { user_id: authUser.id, asset: "USDT", network: "TRC-20" },
        ],
        { onConflict: "user_id,asset,network" },
      );
    if (walletError) throw walletError;

    const { data: sessionData, error: sessionError } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (sessionError || !sessionData.session) {
      throw sessionError || new Error("Supabase session could not be created.");
    }

    return json({
      ok: true,
      user: {
        id: authUser.id,
        telegram_id: telegramId,
        username: telegramUser.username || null,
        display_name: displayName,
      },
      session: sessionData.session,
    });
  } catch (error) {
    console.error("telegram-login failed:", error);
    return json(
      { error: error instanceof Error ? error.message : "Telegram login failed." },
      400,
    );
  }
});
