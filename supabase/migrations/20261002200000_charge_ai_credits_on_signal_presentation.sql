-- FLEXAR AI credits are consumed when an AI opportunity is actually presented to a signed-in user.
-- The reference makes presentation charging idempotent so repeated polling cannot double-charge.
create or replace function public.consume_ai_credit_for_opportunity(
  p_user_id uuid,
  p_opportunity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reference text := 'AI_OPPORTUNITY_' || p_opportunity_id::text || '_' || p_user_id::text;
  v_existing public.ai_credit_transactions%rowtype;
  v_credits numeric(12,2);
begin
  if p_user_id is null or p_opportunity_id is null then
    return jsonb_build_object('ok',false,'reason','missing_reference');
  end if;

  select * into v_existing
  from public.ai_credit_transactions
  where user_id=p_user_id and reference=v_reference
  limit 1;

  if found then
    return jsonb_build_object(
      'ok',true,
      'already_charged',true,
      'credits_remaining',coalesce((select ai_credits from public.profiles where id=p_user_id),0),
      'consumed',0
    );
  end if;

  update public.profiles
    set ai_credits=ai_credits-1.5,
        ai_credits_used=ai_credits_used+1.5,
        updated_at=now()
  where id=p_user_id and ai_credits>=1.5
  returning ai_credits into v_credits;

  if v_credits is null then
    return jsonb_build_object(
      'ok',false,
      'reason','insufficient_credits',
      'credits',coalesce((select ai_credits from public.profiles where id=p_user_id),0)
    );
  end if;

  insert into public.ai_credit_transactions(user_id,type,credits,reference,metadata)
  values(
    p_user_id,'consume',1.5,v_reference,
    jsonb_build_object(
      'reason','FLEXAR AI opportunity presented',
      'opportunity_id',p_opportunity_id
    )
  );

  return jsonb_build_object(
    'ok',true,
    'already_charged',false,
    'credits_remaining',v_credits,
    'consumed',1.5,
    'reference',v_reference
  );
end;
$function$;

create or replace function public.refund_ai_credit_for_opportunity(
  p_user_id uuid,
  p_opportunity_id uuid,
  p_reason text default 'AI trade execution failed after signal presentation'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reference text := 'AI_OPPORTUNITY_' || p_opportunity_id::text || '_' || p_user_id::text;
  v_refund_reference text := 'AI_REFUND_' || v_reference;
  v_charge public.ai_credit_transactions%rowtype;
  v_existing public.ai_credit_transactions%rowtype;
  v_credits numeric(12,2);
begin
  select * into v_charge
  from public.ai_credit_transactions
  where user_id=p_user_id and reference=v_reference and type='consume'
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','no_matching_charge');
  end if;

  select * into v_existing
  from public.ai_credit_transactions
  where user_id=p_user_id and reference=v_refund_reference
  limit 1;

  if found then
    return jsonb_build_object(
      'ok',true,
      'already_refunded',true,
      'credits_remaining',coalesce((select ai_credits from public.profiles where id=p_user_id),0)
    );
  end if;

  update public.profiles
    set ai_credits=ai_credits+1.5,
        ai_credits_used=greatest(ai_credits_used-1.5,0),
        updated_at=now()
  where id=p_user_id
  returning ai_credits into v_credits;

  insert into public.ai_credit_transactions(user_id,type,credits,reference,metadata)
  values(
    p_user_id,'adjustment',1.5,v_refund_reference,
    jsonb_build_object(
      'reason',p_reason,
      'original_reference',v_reference,
      'opportunity_id',p_opportunity_id
    )
  );

  return jsonb_build_object('ok',true,'already_refunded',false,'credits_remaining',v_credits,'refunded',1.5);
end;
$function$;

revoke all on function public.consume_ai_credit_for_opportunity(uuid,uuid) from public, anon, authenticated;
revoke all on function public.refund_ai_credit_for_opportunity(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.consume_ai_credit_for_opportunity(uuid,uuid) to service_role;
grant execute on function public.refund_ai_credit_for_opportunity(uuid,uuid,text) to service_role;
