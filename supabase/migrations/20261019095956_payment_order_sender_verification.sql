alter table public.payment_orders
  add column if not exists sender_address text,
  add column if not exists recipient_address text,
  add column if not exists token_contract text,
  add column if not exists verified_amount numeric(24,6),
  add column if not exists block_timestamp timestamptz,
  add column if not exists verification_status text not null default 'pending',
  add column if not exists verification_details jsonb not null default '{}'::jsonb;

alter table public.payment_orders
  drop constraint if exists payment_orders_verification_status_check;
alter table public.payment_orders
  add constraint payment_orders_verification_status_check
  check (verification_status in ('pending','verified','legacy_unattributed','manual_review'));

update public.payment_orders
set verification_status='legacy_unattributed'
where status='paid' and verification_status='pending';

create index if not exists payment_orders_ai_credit_paid_at_idx
  on public.payment_orders (paid_at desc)
  where purpose='ai_credits' and status='paid';

create index if not exists payment_orders_ai_credit_user_idx
  on public.payment_orders (user_id,created_at desc)
  where purpose='ai_credits';

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
set search_path to 'public'
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

revoke all on function public.complete_payment_order_verified(uuid,text,bigint,numeric,text,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.complete_payment_order_verified(uuid,text,bigint,numeric,text,text,text,bigint,jsonb) to service_role;
