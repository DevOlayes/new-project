import { supabase } from "./supabase";
import { reportDiagnosticError } from "./diagnostics";

// Account reads stay scoped by Supabase RLS; market instruments are public read-only metadata.
let accountDataInFlight = null;

// Multiple UI refresh paths can fire together (active-trade polling, AI
// opportunity updates, and user actions). Share one in-flight snapshot so a
// slow request cannot multiply into overlapping sets of 11 database reads.
async function fetchAccountData() {
  if (!supabase) {
    return {
      wallets: [], trades: [], transactions: [], notifications: [], opportunities: [],
      rewards: [], referrals: [], markets: [], error: new Error("Supabase is not configured.")
    };
  }

  const queryStarted = performance.now();
  const timed = (name, query) => {
    const started = performance.now();
    return Promise.resolve(query).then((result) => {
      const durationMs = Math.round(performance.now() - started);
      if (result?.error || durationMs >= 5000) reportDiagnosticError(result?.error || new Error("Account query took " + durationMs + "ms"), "account_data:" + name);
      return result;
    }).catch((error) => { reportDiagnosticError(error, "account_data:" + name); throw error; });
  };

  const [wallets, trades, transactions, notifications, opportunities, rewards, referrals, markets, plans, subscriptions, access] = await Promise.all([
    timed("wallets", supabase.from("wallets").select("id,asset,network,available_balance,locked_balance,updated_at").order("asset")),
    timed("trades", supabase.from("trades").select("id,asset,direction,stake,duration_seconds,payout_rate,status,entry_price,current_price,exit_price,potential_payout,result_amount,unrealized_pnl,risk_profile,leverage,initial_stop_loss_price,initial_take_profit_price,break_even_price,trailing_stop_price,exit_reason,opened_at,closes_at,settled_at,metadata").order("opened_at",{ascending:false}).limit(25)),
    timed("transactions", supabase.from("wallet_transactions").select("id,type,direction,amount,status,reference,tx_hash,network_fee,created_at,wallet_id,metadata").order("created_at",{ascending:false}).limit(25)),
    timed("notifications", supabase.from("notifications").select("id,type,title,message,is_read,created_at").order("created_at",{ascending:false}).limit(20)),
    timed("opportunities", // Never surface expired opportunities to the trade ticket. The engine can retain
    // historical rows in the database, but only an opportunity whose entry window
    // is still open should be selectable for a new trade.
    supabase.from("ai_opportunities")
      .select("id,symbol,direction,duration_seconds,entry_window_start,entry_window_end,signal_score,model_version,status,entry_price,metadata,created_at")
      .in("status",["scheduled","open"])
      .gt("entry_window_end",new Date().toISOString())
      .order("entry_window_end",{ascending:true})
      .limit(12)),
    timed("rewards", supabase.from("user_rewards").select("id,reward_amount,remaining_reward,profit_earned,profit_withdrawable,profit_cap,status,claimed_at,expires_at,completed_at").order("created_at",{ascending:false}).limit(10)),
    timed("referrals", supabase.from("referrals").select("id,referred_user_id,reward_amount,status,created_at,rewarded_at,referral_rewards(claim_bonus_amount,deposit_commission_amount,reward_amount,status,qualification_reason)").order("created_at",{ascending:false}).limit(20)),
    timed("markets", supabase.from("market_instruments").select("symbol,display_symbol,market_type,source,base_asset,quote_asset,active,tradable").eq("active",true).order("market_type").order("symbol")),
    timed("plans", supabase.from("subscription_plans").select("id,code,name,description,monthly_price,quarterly_price,annual_price,currency,trial_days,features").eq("active",true).order("monthly_price")),
    timed("subscriptions", supabase.from("user_subscriptions").select("id,plan_id,billing_cycle,status,trial_started_at,trial_ends_at,starts_at,ends_at,auto_renew,payment_provider").order("created_at",{ascending:false}).limit(5)),
    timed("trading_access", supabase.rpc("get_trading_access"))
  
  ]);

  const totalDurationMs = Math.round(performance.now() - queryStarted);
  if (totalDurationMs >= 8000) reportDiagnosticError(new Error("Full account data load took " + totalDurationMs + "ms"), "account_data:total");

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

export function getAccountData() {
  if (accountDataInFlight) return accountDataInFlight;
  accountDataInFlight = fetchAccountData().finally(() => {
    accountDataInFlight = null;
  });
  return accountDataInFlight;
}
