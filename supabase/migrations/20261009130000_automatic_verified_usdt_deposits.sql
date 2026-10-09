create or replace function public.credit_verified_usdt_deposit(
  p_user_id uuid, p_amount numeric, p_tx_hash text, p_block_number bigint
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w public.wallets%rowtype;
  existing_request public.deposit_requests%rowtype;
  deposit_id uuid;
  next_balance numeric(24,8);
  normalized_hash text := lower(trim(p_tx_hash));
begin
  if p_user_id is null then raise exception 'Authenticated user is required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid verified amount'; end if;
  if normalized_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid transaction hash'; end if;
  if p_block_number is null or p_block_number <= 0 then raise exception 'Solidified block verification is required'; end if;
  select * into existing_request from public.deposit_requests where tx_hash=normalized_hash for update;
  if found then
    if existing_request.user_id <> p_user_id then raise exception 'This transaction hash has already been claimed by another account'; end if;
    if existing_request.status='approved' then raise exception 'This transaction hash has already been credited'; end if;
    if existing_request.status='rejected' then raise exception 'This transaction hash was rejected and cannot be reused'; end if;
    update public.deposit_requests set amount=p_amount,status='approved',admin_note='Automatically verified against a successful solidified TRON USDT transfer',reviewed_at=now() where id=existing_request.id;
    deposit_id:=existing_request.id;
  else
    insert into public.deposit_requests(user_id,asset,network,amount,tx_hash,status,admin_note,reviewed_at)
    values(p_user_id,'USDT','TRC-20',p_amount,normalized_hash,'approved','Automatically verified against a successful solidified TRON USDT transfer',now())
    returning id into deposit_id;
  end if;
  select * into w from public.wallets where user_id=p_user_id and asset='USDT' and network='TRC-20' for update;
  if not found then raise exception 'User USDT TRC-20 wallet not found'; end if;
  next_balance:=coalesce(w.available_balance,0)+p_amount;
  update public.wallets set available_balance=next_balance,updated_at=now() where id=w.id;
  insert into public.wallet_transactions(user_id,wallet_id,type,direction,amount,status,reference,metadata)
  values(p_user_id,w.id,'deposit','credit',p_amount,'completed','deposit_'||deposit_id::text,jsonb_build_object('tx_hash',normalized_hash,'network','TRC-20','verification','solidified_tron_receipt','block_number',p_block_number));
  return jsonb_build_object('ok',true,'status','approved','amount',p_amount,'available_balance',next_balance,'tx_hash',normalized_hash,'block_number',p_block_number);
exception when unique_violation then raise exception 'This transaction hash has already been credited or submitted';
end;
$$;
