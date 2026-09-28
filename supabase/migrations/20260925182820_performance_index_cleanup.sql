-- Performance cleanup: remove duplicate market lookup indexes and add covering indexes for foreign keys.
drop index if exists public.market_candles_symbol_interval_time_idx;
drop index if exists public.market_features_lookup_idx;

create index if not exists profiles_referred_by_idx
  on public.profiles (referred_by);

create index if not exists referral_rewards_referred_user_idx
  on public.referral_rewards (referred_user_id);

create index if not exists trades_reward_id_idx
  on public.trades (reward_id);

create index if not exists trades_wallet_id_idx
  on public.trades (wallet_id);

create index if not exists user_rewards_campaign_id_idx
  on public.user_rewards (campaign_id);

create index if not exists user_subscriptions_plan_id_idx
  on public.user_subscriptions (plan_id);

create index if not exists wallet_transactions_wallet_id_idx
  on public.wallet_transactions (wallet_id);