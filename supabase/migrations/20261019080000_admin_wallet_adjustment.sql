-- Adds an atomic, auditable admin wallet adjustment with request-level idempotency.
-- The service-role-only RPC re-checks admin status inside the database and never permits negative balances.

create or replace function private.admin_adjust_wallet(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_asset text,
  p_network text,
  p_amount numeric,
  p_direction text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_wallet public.wallets%rowtype;
  v_existing public.wallet_transactions%rowtype;
  v_reference text;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if p_admin_user_id is null or p_user_id is null then
    raise exception 'Admin and target user are required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_admin_user_id and p.is_admin is true
  ) then
    raise exception 'Forbidden: admin access required';
  end if;

  if p_asset is distinct from 'USDT' or p_network is distinct from 'TRC-20' then
    raise exception 'Only USDT on TRC-20 is supported for admin adjustments';
  end if;

  if p_direction is null or p_direction not in ('credit', 'debit') then
    raise exception 'Direction must be credit or debit';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> pg_catalog.round(p_amount, 8) then
    raise exception 'Amount must be greater than zero, at most 1000000 USDT, and have no more than 8 decimal places';
  end if;

  if p_request_id is null then
    raise exception 'Request ID is required';
  end if;

  if pg_catalog.length(v_reason) < 3 or pg_catalog.length(v_reason) > 300 then
    raise exception 'Reason must be between 3 and 300 characters';
  end if;

  v_reference := 'admin_wallet_adjustment_' || p_request_id::text;

  select * into v_existing
  from public.wallet_transactions wt
  where wt.reference = v_reference
  for update;

  if found then
    if v_existing.user_id <> p_user_id
       or v_existing.direction <> p_direction
       or v_existing.amount <> p_amount
       or coalesce(v_existing.metadata->>'admin_user_id', '') <> p_admin_user_id::text
       or coalesce(v_existing.metadata->>'reason', '') <> v_reason
       or coalesce(v_existing.metadata->>'asset', '') <> p_asset
       or coalesce(v_existing.metadata->>'network', '') <> p_network then
      raise exception 'Request ID has already been used for a different adjustment';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'transaction_id', v_existing.id,
      'reference', v_reference,
      'user_id', p_user_id,
      'asset', p_asset,
      'network', p_network,
      'amount', p_amount,
      'direction', p_direction,
      'idempotent_replay', true
    );
  end if;

  select * into v_wallet
  from public.wallets w
  where w.user_id = p_user_id and w.asset = p_asset and w.network = p_network
  for update;

  if not found then
    raise exception 'Target wallet not found';
  end if;

  if p_direction = 'debit' and v_wallet.available_balance < p_amount then
    raise exception 'Insufficient available balance for this debit';
  end if;

  if p_direction = 'credit' then
    update public.wallets
      set available_balance = available_balance + p_amount,
          updated_at = pg_catalog.now()
    where id = v_wallet.id;
  else
    update public.wallets
      set available_balance = available_balance - p_amount,
          updated_at = pg_catalog.now()
    where id = v_wallet.id;
  end if;

  insert into public.wallet_transactions (
    user_id, wallet_id, type, direction, amount, status, reference,
    network_fee, metadata, completed_at
  ) values (
    p_user_id, v_wallet.id, 'adjustment', p_direction, p_amount, 'completed',
    v_reference, 0,
    pg_catalog.jsonb_build_object(
      'source', 'admin_wallet_adjustment',
      'admin_user_id', p_admin_user_id,
      'reason', v_reason,
      'request_id', p_request_id,
      'asset', p_asset,
      'network', p_network
    ),
    pg_catalog.now()
  )
  returning * into v_existing;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'transaction_id', v_existing.id,
    'reference', v_reference,
    'user_id', p_user_id,
    'asset', p_asset,
    'network', p_network,
    'amount', p_amount,
    'direction', p_direction,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function private.admin_adjust_wallet(uuid, uuid, text, text, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function private.admin_adjust_wallet(uuid, uuid, text, text, numeric, text, text, uuid) to service_role;
