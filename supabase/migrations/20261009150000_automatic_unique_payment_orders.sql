create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('ai_credits','wallet_deposit')),
  base_amount numeric(24,6) not null check (base_amount > 0),
  payment_amount numeric(24,6) not null unique check (payment_amount > 0),
  credits integer,
  status text not null default 'pending' check (status in ('pending','paid')),
  tx_hash text unique,
  block_number bigint,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  paid_at timestamptz,
  constraint payment_orders_purpose_fields_check check (
    (purpose = 'ai_credits' and credits is not null and credits > 0) or
    (purpose = 'wallet_deposit' and credits is null)
  )
);
create index if not exists payment_orders_user_created_idx on public.payment_orders(user_id, created_at desc);
create index if not exists payment_orders_pending_created_idx on public.payment_orders(status, created_at) where status='pending';
alter table public.payment_orders enable row level security;
drop policy if exists "Users can view their own payment orders" on public.payment_orders;
create policy "Users can view their own payment orders" on public.payment_orders for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.payment_orders from anon, authenticated;
grant select on public.payment_orders to authenticated;
grant select, insert, update, delete on public.payment_orders to service_role;

create or replace function public.create_payment_order(
  p_user_id uuid, p_purpose text, p_base_amount numeric, p_credits integer default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare candidate numeric(24,6); offset_units bigint := 1; order_id uuid; expires_at_value timestamptz;
begin
  if p_user_id is null then raise exception 'Authenticated user is required'; end if;
  if p_purpose not in ('ai_credits','wallet_deposit') then raise exception 'Invalid payment purpose'; end if;
  if p_base_amount is null or p_base_amount <= 0 or p_base_amount <> round(p_base_amount, 6) then raise exception 'Invalid payment amount'; end if;
  if p_purpose='ai_credits' and (p_credits is null or p_credits not in (20,45,80,140,230,320,420,550,700)) then raise exception 'Invalid AI credit package'; end if;
  if p_purpose='wallet_deposit' and p_credits is not null then raise exception 'Wallet deposits cannot include AI credits'; end if;
  perform pg_advisory_xact_lock(hashtext('flexar_unique_payment_amounts'));
  loop
    candidate := p_base_amount + (offset_units::numeric / 1000000);
    exit when not exists (select 1 from public.payment_orders where payment_amount = candidate);
    offset_units := offset_units + 1;
    if offset_units > 1000000 then raise exception 'Could not allocate a unique payment amount. Please retry.'; end if;
  end loop;
  expires_at_value := now() + interval '30 minutes';
  insert into public.payment_orders(user_id,purpose,base_amount,payment_amount,credits,expires_at)
  values(p_user_id,p_purpose,p_base_amount,candidate,p_credits,expires_at_value) returning id into order_id;
  return jsonb_build_object('ok',true,'order_id',order_id,'purpose',p_purpose,'base_amount',p_base_amount,
    'payment_amount',candidate,'credits',p_credits,'status','pending','created_at',now(),'expires_at',expires_at_value);
end;
$$;

create or replace function public.complete_payment_order(
  p_order_id uuid, p_tx_hash text, p_block_number bigint, p_verified_amount numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.payment_orders%rowtype; w public.wallets%rowtype; next_balance numeric(24,8); normalized_hash text := lower(trim(p_tx_hash));
begin
  if p_order_id is null then raise exception 'Payment order is required'; end if;
  if normalized_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid transaction hash'; end if;
  if p_block_number is null or p_block_number <= 0 then raise exception 'Solidified block verification is required'; end if;
  if p_verified_amount is null or p_verified_amount <= 0 then raise exception 'Invalid verified amount'; end if;
  select * into o from public.payment_orders where id=p_order_id for update;
  if not found then raise exception 'Payment order not found'; end if;
  if o.status='paid' then raise exception 'This payment order has already been completed'; end if;
  if o.payment_amount <> p_verified_amount then raise exception 'Verified transfer does not match this payment order'; end if;
  if exists (select 1 from public.payment_orders where tx_hash=normalized_hash and id<>o.id) then raise exception 'This transaction has already been claimed'; end if;
  if o.purpose='wallet_deposit' then
    select * into w from public.wallets where user_id=o.user_id and asset='USDT' and network='TRC-20' for update;
    if not found then raise exception 'User USDT TRC-20 wallet not found'; end if;
    next_balance := coalesce(w.available_balance,0) + o.base_amount;
    update public.wallets set available_balance=next_balance,updated_at=now() where id=w.id;
    insert into public.wallet_transactions(user_id,wallet_id,type,direction,amount,status,reference,metadata)
    values(o.user_id,w.id,'deposit','credit',o.base_amount,'completed','payment_order_'||o.id::text,
      jsonb_build_object('tx_hash',normalized_hash,'network','TRC-20','verification','solidified_tron_receipt','block_number',p_block_number,'payment_amount',o.payment_amount,'payment_order_id',o.id));
  else
    update public.profiles set ai_credits=coalesce(ai_credits,0)+o.credits,updated_at=now() where id=o.user_id;
    if not found then raise exception 'User profile not found'; end if;
    next_balance := null;
  end if;
  update public.payment_orders set status='paid',tx_hash=normalized_hash,block_number=p_block_number,paid_at=now() where id=o.id;
  return jsonb_build_object('ok',true,'status','paid','purpose',o.purpose,'base_amount',o.base_amount,
    'payment_amount',o.payment_amount,'credits',o.credits,'available_balance',next_balance,'tx_hash',normalized_hash,'block_number',p_block_number,'order_id',o.id);
exception when unique_violation then raise exception 'This transaction has already been claimed or credited';
end;
$$;
revoke all on function public.create_payment_order(uuid,text,numeric,integer) from public, anon, authenticated;
grant execute on function public.create_payment_order(uuid,text,numeric,integer) to service_role;
revoke all on function public.complete_payment_order(uuid,text,bigint,numeric) from public, anon, authenticated;
grant execute on function public.complete_payment_order(uuid,text,bigint,numeric) to service_role;
