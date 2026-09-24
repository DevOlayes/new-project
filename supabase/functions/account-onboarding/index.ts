import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const admin = createClient(url, serviceKey);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || !publishableKey) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const authClient = createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Invalid session" }, { status: 401 });

  const user = userData.user;
  const body = await req.json().catch(() => ({}));
  const referralCode = typeof body.referral_code === "string" ? body.referral_code.trim().toUpperCase() : "";

  const { data: campaign, error: campaignError } = await admin
    .from("reward_campaigns")
    .select("id,code,reward_amount,expiry_days,profit_cap")
    .eq("code", "WELCOME_50").eq("active", true).single();
  if (campaignError || !campaign) return Response.json({ error: "Welcome campaign is unavailable." }, { status: 503 });

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Flexa AI user";
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;

  let referredBy: string | null = null;
  if (referralCode) {
    const { data: referrer } = await admin.from("profiles").select("id,referral_code").eq("referral_code", referralCode).maybeSingle();
    if (referrer && referrer.id !== user.id) referredBy = referrer.id;
  }

  await admin.from("profiles").upsert({
    id: user.id,
    display_name: displayName,
    avatar_url: avatarUrl,
    referred_by: referredBy,
  }, { onConflict: "id" });

  for (const wallet of [
    { user_id: user.id, asset: "TON", network: "TON" },
    { user_id: user.id, asset: "USDT", network: "TRC-20" },
  ]) {
    await admin.from("wallets").upsert(wallet, { onConflict: "user_id,asset,network", ignoreDuplicates: true });
  }

  const { data: existingReward } = await admin
    .from("user_rewards").select("id,status,expires_at,remaining_reward,profit_withdrawable,profit_cap")
    .eq("user_id", user.id).eq("campaign_id", campaign.id).maybeSingle();

  let reward = existingReward;
  if (!existingReward) {
    const expiresAt = new Date(Date.now() + Number(campaign.expiry_days) * 86400000).toISOString();
    const { data: created, error: rewardError } = await admin.from("user_rewards").insert({
      user_id: user.id,
      campaign_id: campaign.id,
      reward_amount: campaign.reward_amount,
      remaining_reward: campaign.reward_amount,
      profit_cap: campaign.profit_cap,
      status: "available",
      expires_at: expiresAt,
    }).select("id,status,expires_at,remaining_reward,profit_withdrawable,profit_cap").single();
    if (rewardError) return Response.json({ error: "Could not provision welcome reward." }, { status: 500 });
    reward = created;
  }

  if (referredBy) {
    const { data: referral } = await admin.from("referrals").upsert({
      referrer_id: referredBy,
      referred_user_id: user.id,
      reward_amount: 0,
      status: "pending",
    }, { onConflict: "referred_user_id", ignoreDuplicates: true }).select("id").maybeSingle();

    if (referral?.id) {
      await admin.from("referral_rewards").upsert({
        referral_id: referral.id,
        referrer_id: referredBy,
        referred_user_id: user.id,
        reward_amount: 0,
        status: "pending",
      }, { onConflict: "referral_id", ignoreDuplicates: true });
    }
  }

  return Response.json({
    ok: true,
    user_id: user.id,
    brand: "Flexa AI",
    reward,
    referral_attached: Boolean(referredBy),
    message: "Account provisioned. Welcome reward is ready to claim.",
  });
});
