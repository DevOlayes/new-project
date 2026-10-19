create or replace function public.create_payment_order(
  p_user_id uuid,
  p_purpose text,
  p_base_amount numeric,
  p_credits integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  expires_at_value := now() + interval '30 minutes';
  insert into public.payment_orders(user_id,purpose,base_amount,payment_amount,credits,expires_at)
  values(p_user_id,p_purpose,p_base_amount,candidate,p_credits,expires_at_value)
  returning id into order_id;

  return jsonb_build_object(
    'ok',true,'order_id',order_id,'purpose',p_purpose,'base_amount',p_base_amount,
    'payment_amount',candidate,'credits',p_credits,'status','pending',
    'created_at',now(),'expires_at',expires_at_value
  );
end;
$function$;

create or replace function public.expire_incomplete_payment_requests()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
          'expiry_reason', 'no_transfer_confirmed_within_30_minutes',
          'expired_at', now(),
          'order_expires_at', expires_at
        )
  where status = 'pending'
    and expires_at <= now()
    and tx_hash is null;
  get diagnostics payment_count = row_count;

  update public.deposit_requests
  set status = 'incomplete',
      admin_note = coalesce(admin_note, 'Automatically marked incomplete after 30 minutes without a transaction hash.')
  where status = 'pending'
    and created_at <= now() - interval '30 minutes'
    and tx_hash is null;
  get diagnostics deposit_count = row_count;

  return jsonb_build_object(
    'payment_orders_marked_incomplete', payment_count,
    'deposit_requests_marked_incomplete', deposit_count,
    'processed_at', now()
  );
end;
$function$;
