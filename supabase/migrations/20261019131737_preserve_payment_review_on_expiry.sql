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
      verification_status = case
        when verification_status = 'needs_review' then 'needs_review'
        else 'incomplete'
      end,
      verification_details = coalesce(verification_details, '{}'::jsonb)
        || jsonb_build_object(
          'expiry_reason', case
            when coalesce(verification_details, '{}'::jsonb) ? 'manual_submission'
              then 'manual_submission_requires_review'
            else 'no_transfer_confirmed_within_30_minutes'
          end,
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
