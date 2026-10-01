-- AI credits are consumed only when an AI trade is successfully opened.
-- The existing private.execute_trade function is replaced on the database during deployment.

CREATE OR REPLACE FUNCTION private.execute_trade(p_user_id uuid, p_opportunity_id uuid, p_stake numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  opp public.ai_opportunities%rowtype;
  wallet public.wallets%rowtype;
  reward public.user_rewards%rowtype;
  profile public.profiles%rowtype;
  trade_id uuid; funding text; transaction_wallet_id uuid; cfg jsonb; risk_profile text;
  stop_pct numeric; target_pct numeric; break_even_pct numeric; trail_pct numeric; max_hold_seconds integer;
  take_profit_price numeric; stop_loss_price numeric; break_even_price numeric; closes_at timestamptz;
  active_count integer; same_market_count integer; credit_result jsonb;
begin
  if p_stake<=0 then raise exception 'Stake must be greater than zero'; end if;
  select * into opp from public.ai_opportunities where id=p_opportunity_id and status in ('scheduled','open') for update;
  if not found then raise exception 'This AI opportunity is no longer available'; end if;
  if now()<opp.entry_window_start or now()>opp.entry_window_end then raise exception 'This opportunity is outside its entry window'; end if;
  select * into profile from public.profiles where id=p_user_id for update;
  if not found then raise exception 'Account not found'; end if;
  if not exists(select 1 from public.user_subscriptions s where s.user_id=p_user_id and s.status in ('active','past_due','trialing') and coalesce(s.ends_at,'infinity'::timestamptz)>now())
     and profile.created_at+interval '14 days'<=now() then raise exception 'Trading access has expired'; end if;
  select count(*) into active_count from public.trades where user_id=p_user_id and status='active';
  if active_count>=2 then raise exception 'FLEXAR allows a maximum of 2 active trades at once'; end if;
  select count(*) into same_market_count from public.trades where user_id=p_user_id and status='active' and coalesce(metadata->>'market_symbol','')=opp.symbol;
  if same_market_count>0 then raise exception 'An active FLEXAR position already exists for this market'; end if;
  cfg:=private.flexar_risk_config(profile.trading_style);
  risk_profile:=cfg->>'risk_profile'; stop_pct:=(cfg->>'stop_pct')::numeric; target_pct:=(cfg->>'target_pct')::numeric;
  break_even_pct:=(cfg->>'break_even_pct')::numeric; trail_pct:=(cfg->>'trail_pct')::numeric; max_hold_seconds:=(cfg->>'max_hold_seconds')::integer;
  if opp.direction='up' then take_profit_price:=opp.entry_price*(1+target_pct); stop_loss_price:=opp.entry_price*(1-stop_pct); break_even_price:=opp.entry_price*(1+break_even_pct);
  else take_profit_price:=opp.entry_price*(1-target_pct); stop_loss_price:=opp.entry_price*(1+stop_pct); break_even_price:=opp.entry_price*(1-break_even_pct); end if;
  select * into reward from public.user_rewards where user_id=p_user_id and status='active' and expires_at>now() and remaining_reward>=p_stake order by created_at asc limit 1 for update;
  if found then funding:='reward';
  else
    select * into wallet from public.wallets where user_id=p_user_id and asset='USDT' and network='TRC-20' for update;
    if not found or wallet.available_balance<p_stake then raise exception 'Insufficient USDT balance or reward credit'; end if;
    funding:='cash';
  end if;
  select id into transaction_wallet_id from public.wallets where user_id=p_user_id and asset='USDT' and network='TRC-20' limit 1;
  if transaction_wallet_id is null then raise exception 'USDT wallet not found'; end if;
  credit_result:=public.consume_ai_credit(p_user_id);
  if coalesce((credit_result->>'ok')::boolean,false) is not true then raise exception 'Insufficient AI credits. 1.5 credits are required to open an AI trade'; end if;
  closes_at:=now()+make_interval(secs=>max_hold_seconds);
  insert into public.trades(user_id,wallet_id,asset,direction,stake,duration_seconds,payout_rate,status,entry_price,current_price,potential_payout,opened_at,closes_at,funding_source,reward_id,unrealized_pnl,risk_profile,initial_stop_loss_price,initial_take_profit_price,break_even_price,trailing_stop_price,max_favorable_price,max_adverse_price,metadata)
  values(p_user_id,case when funding='cash' then wallet.id else null end,'USDT',opp.direction,p_stake,max_hold_seconds,0,'active',opp.entry_price,opp.entry_price,p_stake,now(),closes_at,funding,case when funding='reward' then reward.id else null end,0,risk_profile,stop_loss_price,take_profit_price,break_even_price,null,opp.entry_price,opp.entry_price,jsonb_build_object('opportunity_id',opp.id,'engine',opp.model_version,'market_symbol',opp.symbol,'trade_mode','ai','position_model','flexar-position-v2','risk_profile',risk_profile,'stop_loss_price',stop_loss_price,'take_profit_price',take_profit_price,'break_even_price',break_even_price,'trail_pct',trail_pct,'hard_target',(cfg->>'hard_target')::boolean,'max_hold_seconds',max_hold_seconds,'entry_price',opp.entry_price))
  returning id into trade_id;
  if funding='cash' then
    update public.wallets set available_balance=available_balance-p_stake,locked_balance=locked_balance+p_stake,updated_at=now() where id=wallet.id;
    insert into public.wallet_transactions(user_id,wallet_id,type,direction,amount,status,reference,metadata,completed_at) values(p_user_id,wallet.id,'trade_lock','debit',p_stake,'completed','trade_lock_'||trade_id,jsonb_build_object('trade_id',trade_id,'trade_mode','ai','market_symbol',opp.symbol,'position_model','flexar-position-v2'),now());
  else
    update public.user_rewards set remaining_reward=remaining_reward-p_stake where id=reward.id;
    insert into public.wallet_transactions(user_id,wallet_id,type,direction,amount,status,reference,metadata,completed_at) values(p_user_id,transaction_wallet_id,'bonus','debit',p_stake,'completed','reward_trade_'||trade_id,jsonb_build_object('trade_id',trade_id,'reward_id',reward.id,'trade_mode','ai','market_symbol',opp.symbol,'position_model','flexar-position-v2'),now());
  end if;
  update public.ai_opportunities set status='open',updated_at=now() where id=opp.id;
  return jsonb_build_object('trade_id',trade_id,'funding_source',funding,'stake',p_stake,'position_model','flexar-position-v2','max_hold_seconds',max_hold_seconds,'closes_at',closes_at,'opportunity_id',opp.id,'symbol',opp.symbol,'direction',opp.direction,'risk_profile',risk_profile,'take_profit_price',take_profit_price,'stop_loss_price',stop_loss_price,'break_even_price',break_even_price,'trail_pct',trail_pct);
end; $function$

