-- Adds an explicit manual-review lifecycle for withdrawal requests.
-- "Complete" only records a payout after an operator has sent and verified it externally.
-- This function does not send cryptocurrency or call a payout provider.

create or replace function private.admin_review_withdrawal(
  p_admin_user_id uuid,
  p_transaction_id uuid,
  p_action text,
  p_reason text,
  p_tx_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tx public.wallet_transactions%rowtype;
  v_wallet public.wallets%rowtype;
  v_action text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_tx_hash text := pg_catalog.btrim(coalesce(p_tx_hash, ''));
begin
  if p_admin_user_id is null or p_transaction_id is null then
    raise exception 'Admin and withdrawal transaction are required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_admin_user_id and p.is_admin is true
  ) then
    raise exception 'Forbidden: admin access required';
  end if;

  if v_action not in ('approve', 'reject', 'complete') then
    raise exception 'Action must be approve, reject or complete';
  end if;

  if pg_catalog.length(v_reason) < 3 or pg_catalog.length(v_reason) > 500 then
    raise exception 'A reason or payout note between 3 and 500 characters is required';
  end if;

  select * into v_tx
  from public.wallet_transactions wt
  where wt.id = p_transaction_id
    and wt.type = 'withdrawal'
    and wt.direction = 'debit'
  for update;

  if not found then
    raise exception 'Withdrawal request not found';
  end if;

  if v_action = 'approve' then
    if v_tx.status <> 'pending' then
      raise exception 'Only pending withdrawals can be approved';
    end if;

    update public.wallet_transactions
    set status = 'processing',
        metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'reviewed_by', p_admin_user_id,
          'reviewed_at', pg_catalog.now(),
          'review_action', 'approve',
          'review_reason', v_reason,
          'payout_method', 'manual_external'
        )
    where id = v_tx.id;

  elsif v_action = 'reject' then
    if v_tx.status <> 'pending' then
      raise exception 'Only pending withdrawals can be rejected; processing payouts require reconciliation first';
    end if;

    select * into v_wallet
    from public.wallets w
    where w.id = v_tx.wallet_id
      and w.user_id = v_tx.user_id
    for update;

    if not found or v_wallet.locked_balance < v_tx.amount then
      raise exception 'Wallet locked balance is inconsistent; manual reconciliation is required';
    end if;

    update public.wallets
    set locked_balance = locked_balance - v_tx.amount,
        available_balance = available_balance + v_tx.amount,
        updated_at = pg_catalog.now()
    where id = v_wallet.id;

    update public.wallet_transactions
    set status = 'cancelled',
        metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'reviewed_by', p_admin_user_id,
          'reviewed_at', pg_catalog.now(),
          'review_action', 'reject',
          'review_reason', v_reason,
          'refund_status', 'returned_to_available_balance'
        )
    where id = v_tx.id;

  else
    if v_tx.status <> 'processing' then
      raise exception 'Only approved processing withdrawals can be completed';
    end if;

    if pg_catalog.length(v_tx_hash) < 8 or pg_catalog.length(v_tx_hash) > 200 then
      raise exception 'A valid external payout transaction hash is required';
    end if;

    if exists (
      select 1 from public.wallet_transactions wt
      where pg_catalog.lower(coalesce(wt.tx_hash, '')) = pg_catalog.lower(v_tx_hash)
        and wt.id <> v_tx.id
    ) then
      raise exception 'This payout transaction hash is already recorded';
    end if;

    if exists (
      select 1 from public.payment_orders po
      where pg_catalog.lower(coalesce(po.tx_hash, '')) = pg_catalog.lower(v_tx_hash)
    ) or exists (
      select 1 from public.deposit_requests dr
      where pg_catalog.lower(dr.tx_hash) = pg_catalog.lower(v_tx_hash)
    ) then
      raise exception 'This transaction hash has already been used for a deposit';
    end if;

    select * into v_wallet
    from public.wallets w
    where w.id = v_tx.wallet_id
      and w.user_id = v_tx.user_id
    for update;

    if not found or v_wallet.locked_balance < v_tx.amount then
      raise exception 'Wallet locked balance is inconsistent; manual reconciliation is required';
    end if;

    update public.wallets
    set locked_balance = locked_balance - v_tx.amount,
        updated_at = pg_catalog.now()
    where id = v_wallet.id;

    update public.wallet_transactions
    set status = 'completed',
        tx_hash = v_tx_hash,
        completed_at = pg_catalog.now(),
        metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'reviewed_by', p_admin_user_id,
          'payout_completed_by', p_admin_user_id,
          'payout_completed_at', pg_catalog.now(),
          'payout_tx_hash', v_tx_hash,
          'review_action', 'complete',
          'review_reason', v_reason,
          'payout_method', 'manual_external',
          'payout_confirmation', 'operator_attested'
        )
    where id = v_tx.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'transaction_id', v_tx.id,
    'action', v_action,
    'status', case when v_action = 'approve' then 'processing' when v_action = 'reject' then 'cancelled' else 'completed' end,
    'amount', v_tx.amount,
    'tx_hash', case when v_action = 'complete' then v_tx_hash else null end
  );
end;
$function$;

revoke all on function private.admin_review_withdrawal(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function private.admin_review_withdrawal(uuid, uuid, text, text, text) to service_role;
