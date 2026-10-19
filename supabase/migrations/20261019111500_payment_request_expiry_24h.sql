-- Keep payment requests available for investigation while removing stale unpaid requests from pending queues.
alter table public.payment_orders
  drop constraint if exists payment_orders_status_check;
alter table public.payment_orders
  add constraint payment_orders_status_check
  check (status = any (array['pending'::text, 'paid'::text, 'incomplete'::text]));

alter table public.deposit_requests
  drop constraint if exists deposit_requests_status_check;
alter table public.deposit_requests
  add constraint deposit_requests_status_check
  check (status = any (array['pending'::text, 'approved'::text, 'rejected'::text, 'incomplete'::text]));

alter table public.payment_orders
  drop constraint if exists payment_orders_verification_status_check;
alter table public.payment_orders
  add constraint payment_orders_verification_status_check
  check (verification_status = any (array['pending'::text, 'verified'::text, 'legacy_unattributed'::text, 'manual_review'::text, 'incomplete'::text]));

-- Move existing pending orders onto the same 24-hour deadline.
update public.payment_orders
set expires_at = created_at + interval '24 hours'
where status = 'pending';

create or replace function public.create_payment_order(
  p_user_id uuid,
  p_purpose text,
  p_base_amount numeric,
  p_credits integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  candidate numeric(24,6);
  offset_units bigint := 1;
  order_id uuid;
  expires_at_value timestamptz;
begin
  if p_user_id is null then raise exception 'Authenticated user is required'; end if;
  if p_purpose not in ('ai_credits','wallet_deposit') then raise exception 'Invalid payment purpose'; end if;
  if p_base_amount is null or p_base_amount <= 0 or p_base_amount <> round(p_base_amount, 2) then raise exception 'Enter an amount with no more than 2 decimal places'; end if;
  if p_purpose='ai_credits' and (p_credits is null or p_credits not in (20,45,80,140,230,320,420,550,700)) then raise exception 'Invalid AI credit package'; end if;
  if p_purpose='wallet_deposit' and p_credits is not null then raise exception 'Wallet deposits cannot include AI credits'; end if;
  perform pg_advisory_xact_lock(hashtext('flexar_unique_payment_amounts'));
  loop
    candidate := p_base_amount + (offset_units::numeric / 100);
    exit when not exists (select 1 from public.payment_orders where payment_amount = candidate);
    offset_units := offset_units + 1;
    if offset_units > 1000000 then raise exception 'Could not allocate a unique payment amount. Please retry.'; end if;
  end loop;
  expires_at_value := now() + interval '24 hours';
  insert into public.payment_orders(user_id,purpose,base_amount,payment_amount,credits,expires_at)
  values(p_user_id,p_purpose,p_base_amount,candidate,p_credits,expires_at_value) returning id into order_id;
  return jsonb_build_object('ok',true,'order_id',order_id,'purpose',p_purpose,'base_amount',p_base_amount,'payment_amount',candidate,'credits',p_credits,'status','pending','created_at',now(),'expires_at',expires_at_value);
end;
$function$;

create or replace function public.complete_payment_order_verified(
  p_order_id uuid,
  p_tx_hash text,
  p_block_number bigint,
  p_verified_amount numeric,
  p_sender_address text,
  p_recipient_address text,
  p_token_contract text,
  p_block_timestamp_ms bigint,
  p_verification_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  result jsonb;
  sender text := trim(coalesce(p_sender_address,''));
  recipient text := trim(coalesce(p_recipient_address,''));
  contract text := trim(coalesce(p_token_contract,''));
begin
  if p_order_id is null then raise exception 'Payment order is required'; end if;
  if sender !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' then raise exception 'Verified sender address is invalid'; end if;
  if recipient <> 'TCdC3RcYQXqWkhxP4zEyu4Bts3h9nEK44a' then raise exception 'Payment recipient does not match the configured FLEXAR wallet'; end if;
  if lower(contract) <> lower('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') then raise exception 'Token contract is not the configured TRC-20 USDT contract'; end if;
  if p_block_timestamp_ms is null or p_block_timestamp_ms <= 0 then raise exception 'Verified block timestamp is required'; end if;
  if exists (
    select 1 from public.payment_orders
    where id = p_order_id
      and to_timestamp(p_block_timestamp_ms::numeric / 1000) > expires_at
  ) then
    raise exception 'Payment was sent after this request expired; manual review is required';
  end if;

  result := public.complete_payment_order(p_order_id,p_tx_hash,p_block_number,p_verified_amount);

  update public.payment_orders
  set sender_address=sender,
      recipient_address=recipient,
      token_contract=contract,
      verified_amount=p_verified_amount,
      block_timestamp=to_timestamp(p_block_timestamp_ms::numeric / 1000),
      verification_status='verified',
      verification_details=coalesce(p_verification_details,'{}'::jsonb)
  where id=p_order_id and status='paid';

  if not found then raise exception 'Payment was completed but verification details could not be saved'; end if;

  return result || jsonb_build_object(
    'sender_address',sender,
    'recipient_address',recipient,
    'token_contract',contract,
    'verified_amount',p_verified_amount,
    'verification_status','verified'
  );
end;
$function$;

create or replace function public.expire_incomplete_payment_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  payment_count integer := 0;
  deposit_count integer := 0;
begin
  update public.payment_orders
  set status = 'incomplete',
      verification_status = 'incomplete',
      verification_details = coalesce(verification_details, '{}'::jsonb)
        || jsonb_build_object(
          'expiry_reason', 'no_transfer_confirmed_within_24_hours',
          'expired_at', now()
        )
  where status = 'pending'
    and created_at <= now() - interval '24 hours'
    and tx_hash is null;
  get diagnostics payment_count = row_count;

  update public.deposit_requests
  set status = 'incomplete',
      admin_note = coalesce(admin_note, 'Automatically marked incomplete after 24 hours without a transaction hash.')
  where status = 'pending'
    and created_at <= now() - interval '24 hours'
    and tx_hash is null;
  get diagnostics deposit_count = row_count;

  return jsonb_build_object(
    'payment_orders_marked_incomplete', payment_count,
    'deposit_requests_marked_incomplete', deposit_count,
    'processed_at', now()
  );
end;
$function$;

revoke all on function public.expire_incomplete_payment_requests() from public, anon, authenticated;
grant execute on function public.expire_incomplete_payment_requests() to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'flexar-payment-request-expiry-every-15-minutes';

select cron.schedule(
  'flexar-payment-request-expiry-every-15-minutes',
  '*/15 * * * *',
  'select public.expire_incomplete_payment_requests();'
);
