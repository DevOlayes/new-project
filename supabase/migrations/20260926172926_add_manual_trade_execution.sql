-- Recovered migration: manual trade execution and authenticated RPC wrapper.

create or replace function private.execute_manual_trade(
  p_user_id uuid,
  p_symbol text,
  p_direction text,
  p_duration_seconds integer,
  p_stake numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  cash_wallet wallets%rowtype;
  reward user_rewards%rowtype;
  trade_id uuid;
  funding text;
  transaction_wallet_id uuid;
  payout_rate numeric := 0.80;
  entry_price numeric;
  closes_at timestamptz;
  normalized_symbol text := upper(trim(p_symbol));
  normalized_direction text := lower(trim(p_direction));
begin
  if p_stake <= 0 then raise exception 'Stake must be greater than zero'; end if;
  if normalized_direction not in ('up','down') then raise exception 'Direction must be UP or DOWN'; end if;
  if p_duration_seconds not in (900,1800,3600) then raise exception 'Duration must be 15, 30, or 60 minutes'; end if;
  if normalized_symbol not in ('BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','EURUSD','GBPUSD','USDJPY','AUDUSD') then
    raise exception 'Unsupported market';
  end if;

  if not exists(select 1 from profiles where id=p_user_id) then
    raise exception 'Account not found';
  end if;

  if exists(
    select 1
    from user_subscriptions s
    where s.user_id=p_user_id
      and s.status in ('active','past_due','trialing')
      and coalesce(s.ends_at,'infinity'::timestamptz)>now()
  ) then
    null;
  elsif exists(
    select 1 from profiles p
    where p.id=p_user_id and p.created_at+interval '14 days'>now()
  ) then
    null;
  else
    raise exception 'Trading access has expired';
  end if;

  select mf.close_price
  into entry_price
  from market_features mf
  where mf.symbol=normalized_symbol
    and mf.interval='1m'
    and mf.candle_open_time>now()-interval '3 minutes'
  order by mf.candle_open_time desc
  limit 1;

  if entry_price is null then
    raise exception 'Live market price is temporarily unavailable for this market';
  end if;

  select *
  into reward
  from user_rewards
  where user_id=p_user_id
    and status='active'
    and expires_at>now()
    and remaining_reward>=p_stake
  order by created_at asc
  limit 1
  for update;

  if found then
    funding:='reward';
  else
    select *
    into cash_wallet
    from wallets
    where user_id=p_user_id and asset='USDT' and network='TRC-20'
    for update;

    if not found or cash_wallet.available_balance<p_stake then
      raise exception 'Insufficient USDT balance or reward credit';
    end if;

    funding:='cash';
  end if;

  select id
  into transaction_wallet_id
  from wallets
  where user_id=p_user_id and asset='USDT' and network='TRC-20'
  limit 1;

  if transaction_wallet_id is null then
    raise exception 'USDT wallet not found';
  end if;

  closes_at:=now()+make_interval(secs=>p_duration_seconds);

  insert into trades(
    user_id,wallet_id,asset,direction,stake,duration_seconds,payout_rate,status,
    entry_price,potential_payout,opened_at,closes_at,funding_source,reward_id,metadata
  )
  values(
    p_user_id,
    case when funding='cash' then cash_wallet.id else null end,
    'USDT',
    normalized_direction,
    p_stake,
    p_duration_seconds,
    payout_rate,
    'active',
    entry_price,
    p_stake*(1+payout_rate),
    now(),
    closes_at,
    funding,
    case when funding='reward' then reward.id else null end,
    jsonb_build_object(
      'trade_mode','manual',
      'market_symbol',normalized_symbol,
      'market_source','market_features_1m'
    )
  )
  returning id into trade_id;

  if funding='cash' then
    update wallets
    set available_balance=available_balance-p_stake,
        locked_balance=locked_balance+p_stake,
        updated_at=now()
    where id=cash_wallet.id;

    insert into wallet_transactions(
      user_id,wallet_id,type,direction,amount,status,reference,metadata,completed_at
    )
    values(
      p_user_id,cash_wallet.id,'trade_lock','debit',p_stake,'completed',
      'trade_lock_'||trade_id,
      jsonb_build_object(
        'trade_id',trade_id,
        'trade_mode','manual',
        'market_symbol',normalized_symbol
      ),
      now()
    );
  else
    update user_rewards
    set remaining_reward=remaining_reward-p_stake
    where id=reward.id;

    insert into wallet_transactions(
      user_id,wallet_id,type,direction,amount,status,reference,metadata,completed_at
    )
    values(
      p_user_id,transaction_wallet_id,'bonus','debit',p_stake,'completed',
      'reward_trade_'||trade_id,
      jsonb_build_object(
        'trade_id',trade_id,
        'reward_id',reward.id,
        'trade_mode','manual',
        'market_symbol',normalized_symbol
      ),
      now()
    );
  end if;

  return jsonb_build_object(
    'trade_id',trade_id,
    'funding_source',funding,
    'stake',p_stake,
    'payout_rate',payout_rate,
    'potential_payout',p_stake*(1+payout_rate),
    'closes_at',closes_at,
    'symbol',normalized_symbol,
    'direction',normalized_direction
  );
end;
$function$;

revoke all on function private.execute_manual_trade(uuid,text,text,integer,numeric) from public;
revoke all on function private.execute_manual_trade(uuid,text,text,integer,numeric) from anon;
revoke all on function private.execute_manual_trade(uuid,text,text,integer,numeric) from authenticated;
grant execute on function private.execute_manual_trade(uuid,text,text,integer,numeric) to service_role;

create or replace function public.execute_manual_trade(
  p_user_id uuid,
  p_symbol text,
  p_direction text,
  p_duration_seconds integer,
  p_stake numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized';
  end if;

  return private.execute_manual_trade(
    p_user_id,
    p_symbol,
    p_direction,
    p_duration_seconds,
    p_stake
  );
end;
$function$;

revoke all on function public.execute_manual_trade(uuid,text,text,integer,numeric) from anon;
grant execute on function public.execute_manual_trade(uuid,text,text,integer,numeric) to authenticated;
grant execute on function public.execute_manual_trade(uuid,text,text,integer,numeric) to service_role;
