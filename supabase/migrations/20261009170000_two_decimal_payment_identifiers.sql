-- Use human-readable two-decimal payment identifiers (10.01, 10.02, 10.03 USDT).
-- The original requested/package amount remains the amount credited; extra cents identify the order.
create or replace function public.create_payment_order(
  p_user_id uuid, p_purpose text, p_base_amount numeric, p_credits integer default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare candidate numeric(24,6); offset_units bigint := 1; order_id uuid; expires_at_value timestamptz;
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
  values(p_user_id,p_purpose,p_base_amount,candidate,p_credits,expires_at_value) returning id into order_id;
  return jsonb_build_object('ok',true,'order_id',order_id,'purpose',p_purpose,'base_amount',p_base_amount,'payment_amount',candidate,'credits',p_credits,'status','pending','created_at',now(),'expires_at',expires_at_value);
end;
$$;
revoke all on function public.create_payment_order(uuid,text,numeric,integer) from public, anon, authenticated;
grant execute on function public.create_payment_order(uuid,text,numeric,integer) to service_role;
