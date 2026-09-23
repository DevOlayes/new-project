import { supabase } from "./supabase";

// All account reads are protected by Supabase RLS and are scoped to auth.uid().
export async function getAccountData() {
  if (!supabase) return { wallets: [], trades: [], transactions: [], notifications: [], error: new Error("Supabase is not configured.") };
  const [wallets, trades, transactions, notifications] = await Promise.all([
    supabase.from("wallets").select("id,asset,network,available_balance,locked_balance,updated_at").order("asset"),
    supabase.from("trades").select("id,asset,direction,stake,duration_seconds,payout_rate,status,entry_price,exit_price,potential_payout,result_amount,opened_at,closes_at,settled_at").order("opened_at",{ascending:false}).limit(25),
    supabase.from("wallet_transactions").select("id,type,direction,amount,status,reference,tx_hash,network_fee,created_at,wallet_id").order("created_at",{ascending:false}).limit(25),
    supabase.from("notifications").select("id,type,title,message,is_read,created_at").order("created_at",{ascending:false}).limit(20),
  ]);
  return { wallets: wallets.data || [], trades: trades.data || [], transactions: transactions.data || [], notifications: notifications.data || [], error: wallets.error || trades.error || transactions.error || notifications.error };
}