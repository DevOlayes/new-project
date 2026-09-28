-- Wallet funding rails: browser-safe deposit information and atomic withdrawal requests.
-- Deposit addresses are configured through public.app_settings by an administrator.
-- Withdrawals are created server-side and atomically move funds into locked_balance.

insert into public.app_settings(key,value,updated_at)
values(
  'deposit_addresses',
  '{"TON":{"network":"TON","address":null},"USDT":{"network":"TRC-20","address":null}}'::jsonb,
  now()
)
on conflict (key) do nothing;

create or replace function private.request_withdrawal(
  p_user_id uuid,
  p_asset text,
  p_network text,
  p_amount numeric,
  p_address text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  w wallets%rowtype;
  tx wallet_transactions%rowtype;
begin
  if p_user_id is null then raise exception 'User is required'; end if;
  if p_asset not in ('TON','USDT') then raise exception 'Unsupported asset'; end if;
  if p_network not in ('TON','TRC-20') then raise exception 'Unsupported network'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Withdrawal amount must be greater than zero'; end if;
  if p_address is null or length(trim(p_address)) < 8 then raise exception 'A valid destination address is required'; end if;

  select *
  into w
  from wallets
  where user_id = p_user_id
    and asset = p_asset
    and network = p_network
  for update;

  if not found then raise exception 'Wallet is not available'; end if;
  if w.available_balance < p_amount then raise exception 'Insufficient available balance'; end if;

  insert into wallet_transactions(
    user_id,wallet_id,type,direction,amount,status,reference,metadata
  )
  values(
    p_user_id,w.id,'withdrawal','debit',p_amount,'pending',
    'withdraw_' || gen_random_uuid()::text,
    jsonb_build_object(
      'asset',p_asset,
      'network',p_network,
      'destination_address',trim(p_address),
      'requires_admin_review',true
    )
  )
  returning * into tx;

  update wallets
  set available_balance = available_balance - p_amount,
      locked_balance = locked_balance + p_amount,
      updated_at = now()
  where id = w.id;

  return jsonb_build_object(
    'transaction_id',tx.id,
    'reference',tx.reference,
    'status',tx.status,
    'asset',p_asset,
    'network',p_network,
    'amount',tx.amount,
    'locked_balance',w.locked_balance + p_amount,
    'remaining_available_balance',w.available_balance - p_amount
  );
end;
$function$;

revoke all on function private.request_withdrawal(uuid,text,text,numeric,text) from public;
revoke all on function private.request_withdrawal(uuid,text,text,numeric,text) from anon;
revoke all on function private.request_withdrawal(uuid,text,text,numeric,text) from authenticated;
grant execute on function private.request_withdrawal(uuid,text,text,numeric,text) to service_role;
