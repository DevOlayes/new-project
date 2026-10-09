create or replace function public.complete_payment_order(
  p_order_id uuid, p_tx_hash text, p_block_number bigint, p_verified_amount numeric
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  o public.payment_orders%rowtype;
  w public.wallets%rowtype;
  next_balance numeric(24,8);
  normalized_hash text := lower(trim(p_tx_hash));
begin
  if p_order_id is null then raise exception 'Payment order is required'; end if;
  if normalized_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid transaction hash'; end if;
  if p_block_number is null or p_block_number <= 0 then raise exception 'Solidified block verification is required'; end if;
  if p_verified_amount is null or p_verified_amount <= 0 then raise exception 'Invalid verified amount'; end if;

  select * into o from public.payment_orders where id=p_order_id for update;
  if not found then raise exception 'Payment order not found'; end if;
  if o.status='paid' then raise exception 'This payment order has already been completed'; end if;
  if o.payment_amount <> p_verified_amount then raise exception 'Verified transfer does not match this payment order'; end if;
  if exists (select 1 from public.payment_orders where tx_hash=normalized_hash and id<>o.id) then
    raise exception 'This transaction has already been claimed';
  end if;
  if exists (select 1 from public.deposit_requests where lower(tx_hash)=normalized_hash) then
    raise exception 'This transaction has already been submitted or credited';
  end if;

  if o.purpose='wallet_deposit' then
    select * into w from public.wallets where user_id=o.user_id and asset='USDT' and network='TRC-20' for update;
    if not found then raise exception 'User USDT TRC-20 wallet not found'; end if;
    next_balance := coalesce(w.available_balance,0) + o.base_amount;
    update public.wallets set available_balance=next_balance,updated_at=now() where id=w.id;
    insert into public.wallet_transactions(user_id,wallet_id,type,direction,amount,status,reference,metadata)
    values(o.user_id,w.id,'deposit','credit',o.base_amount,'completed','payment_order_'||o.id::text,
      jsonb_build_object('tx_hash',normalized_hash,'network','TRC-20','verification','solidified_tron_receipt',
        'block_number',p_block_number,'payment_amount',o.payment_amount,'payment_order_id',o.id));
  else
    update public.profiles set ai_credits=coalesce(ai_credits,0)+o.credits,updated_at=now() where id=o.user_id;
    if not found then raise exception 'User profile not found'; end if;
    next_balance := null;
  end if;

  update public.payment_orders set status='paid',tx_hash=normalized_hash,block_number=p_block_number,paid_at=now() where id=o.id;
  return jsonb_build_object('ok',true,'status','paid','purpose',o.purpose,'base_amount',o.base_amount,
    'payment_amount',o.payment_amount,'credits',o.credits,'available_balance',next_balance,
    'tx_hash',normalized_hash,'block_number',p_block_number,'order_id',o.id);
exception when unique_violation then raise exception 'This transaction has already been claimed or credited';
end;
$$;
revoke all on function public.complete_payment_order(uuid,text,bigint,numeric) from public, anon, authenticated;
grant execute on function public.complete_payment_order(uuid,text,bigint,numeric) to service_role;
