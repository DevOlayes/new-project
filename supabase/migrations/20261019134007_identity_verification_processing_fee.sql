create or replace function public.submit_identity_verification(
  p_user_id uuid,
  p_legal_name text,
  p_country_code text,
  p_id_type text,
  p_id_number_hash text,
  p_id_document_path text,
  p_face_scan_path text,
  p_duplicate_flag boolean,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_profile public.profiles%rowtype;
  v_existing public.identity_verifications%rowtype;
  v_saved public.identity_verifications%rowtype;
  v_reference text;
begin
  if p_user_id is null or p_request_id is null then
    return jsonb_build_object('ok',false,'reason','missing_reference');
  end if;
  v_reference := 'IDENTITY_VERIFICATION:' || p_user_id::text || ':' || p_request_id::text;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','profile_missing'); end if;

  if exists (select 1 from public.ai_credit_transactions where user_id=p_user_id and reference=v_reference and type='consume') then
    select * into v_saved from public.identity_verifications where user_id=p_user_id;
    return jsonb_build_object('ok',true,'already_processed',true,'charged',false,'credits_remaining',v_profile.ai_credits,
      'verification',jsonb_build_object('status',v_saved.status,'duplicate_flag',v_saved.duplicate_flag,'submitted_at',v_saved.submitted_at));
  end if;

  select * into v_existing from public.identity_verifications where user_id=p_user_id for update;
  if found and v_existing.status='approved' then return jsonb_build_object('ok',false,'reason','already_approved','credits',v_profile.ai_credits); end if;
  if found and v_existing.status='pending' then return jsonb_build_object('ok',false,'reason','already_pending','credits',v_profile.ai_credits); end if;
  if coalesce(v_profile.ai_credits,0)<5 then return jsonb_build_object('ok',false,'reason','insufficient_credits','credits',coalesce(v_profile.ai_credits,0),'required_credits',5); end if;

  update public.profiles set ai_credits=ai_credits-5, ai_credits_used=ai_credits_used+5, updated_at=now()
  where id=p_user_id returning * into v_profile;

  insert into public.ai_credit_transactions(user_id,type,credits,amount_usd,reference,metadata)
  values(p_user_id,'consume',5,0,v_reference,jsonb_build_object('reason','Identity verification processing fee','request_id',p_request_id,'country_code',p_country_code));

  insert into public.identity_verifications(user_id,legal_name,country_code,id_type,id_number_hash,id_document_path,face_scan_path,status,duplicate_flag,duplicate_reviewed,review_notes,consent_at,submitted_at,reviewed_at,reviewed_by,updated_at)
  values(p_user_id,p_legal_name,p_country_code,p_id_type,p_id_number_hash,p_id_document_path,p_face_scan_path,'pending',coalesce(p_duplicate_flag,false),false,null,now(),now(),null,null,now())
  on conflict(user_id) do update set legal_name=excluded.legal_name,country_code=excluded.country_code,id_type=excluded.id_type,id_number_hash=excluded.id_number_hash,id_document_path=excluded.id_document_path,face_scan_path=excluded.face_scan_path,status='pending',duplicate_flag=excluded.duplicate_flag,duplicate_reviewed=false,review_notes=null,consent_at=excluded.consent_at,submitted_at=excluded.submitted_at,reviewed_at=null,reviewed_by=null,updated_at=now()
  returning * into v_saved;

  return jsonb_build_object('ok',true,'already_processed',false,'charged',true,'credits_charged',5,'credits_remaining',v_profile.ai_credits,
    'verification',jsonb_build_object('status',v_saved.status,'duplicate_flag',v_saved.duplicate_flag,'submitted_at',v_saved.submitted_at));
end;
$function$;

revoke all on function public.submit_identity_verification(uuid,text,text,text,text,text,text,boolean,uuid) from public, anon, authenticated;
grant execute on function public.submit_identity_verification(uuid,text,text,text,text,text,text,boolean,uuid) to service_role;
