import { supabase } from "./supabase";

// Account reads stay scoped by Supabase RLS; market instruments are public read-only metadata.
export async function getAccountData() {
  if (!supabase) {
    return {
      wallets: [], trades: [], transactions: [], notifications: [], opportunities: [],
      rewards: [], referrals: [], markets: [], error: new Error("Supabase is not configured.")
    };
  }

  const [wallets, trades, transactions, notifications, opportunities, rewards, referrals, markets, plans, subscriptions, access] = await Promise.all([
    supabase.from("wallets").select("id,asset,network,available_balance,locked_balance,updated_at").order("asset"),
    supabase.from("trades").select("id,asset,direction,stake,duration_seconds,payout_rate,status,entry_price,exit_price,potential_payout,result_amount,opened_at,closes_at,settled_at").order("opened_at",{ascending:false}).limit(25),
    supabase.from("wallet_transactions").select("id,type,direction,amount,status,reference,tx_hash,network_fee,created_at,wallet_id").order("created_at",{ascending:false}).limit(25),
    supabase.from("notifications").select("id,type,title,message,is_read,created_at").order("created_at",{ascending:false}).limit(20),
    // Never surface expired opportunities to the trade ticket. The engine can retain
    // historical rows in the database, but only an opportunity whose entry window
    // is still open should be selectable for a new trade.
    supabase.from("ai_opportunities")
      .select("id,symbol,direction,duration_seconds,entry_window_start,entry_window_end,signal_score,model_version,status,entry_price,metadata,created_at")
      .in("status",["scheduled","open"])
      .gt("entry_window_end",new Date().toISOString())
      .order("entry_window_end",{ascending:true})
      .limit(12),
    supabase.from("user_rewards").select("id,reward_amount,remaining_reward,profit_earned,profit_withdrawable,profit_cap,status,claimed_at,expires_at,completed_at").order("created_at",{ascending:false}).limit(10),
    supabase.from("referrals").select("id,referred_user_id,reward_amount,status,created_at,rewarded_at").order("created_at",{ascending:false}).limit(20),
    supabase.from("market_instruments").select("symbol,display_symbol,market_type,source,base_asset,quote_asset,active,tradable").eq("active",true).order("market_type").order("symbol"),
    supabase.from("subscription_plans").select("id,code,name,description,monthly_price,quarterly_price,annual_price,currency,trial_days,features").eq("active",true).order("monthly_price"),
    supabase.from("user_subscriptions").select("id,plan_id,billing_cycle,status,trial_started_at,trial_ends_at,starts_at,ends_at,auto_renew,payment_provider").order("created_at",{ascending:false}).limit(5),
    supabase.rpc("get_trading_access"),
  ]);

  return {
    wallets: wallets.data || [],
    trades: trades.data || [],
    transactions: transactions.data || [],
    notifications: notifications.data || [],
    opportunities: opportunities.data || [],
    rewards: rewards.data || [],
    referrals: referrals.data || [],
    markets: markets.data || [],
    plans: plans.data || [],
    subscriptions: subscriptions.data || [],
    tradingAccess: access.data?.[0] || null,
    error: wallets.error || trades.error || transactions.error || notifications.error || opportunities.error || rewards.error || referrals.error || markets.error || plans.error || subscriptions.error || access.error
  };
}