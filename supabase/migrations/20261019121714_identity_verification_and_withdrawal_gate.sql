alter table public.profiles
  add column if not exists risk_profile text
  check (risk_profile is null or risk_profile in ('conservative','balanced','growth'));

create table if not exists public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  legal_name text not null check (char_length(trim(legal_name)) between 2 and 160),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  id_type text not null check (id_type in ('passport','national_id','drivers_license','voters_card','residence_permit')),
  id_number_hash text not null check (id_number_hash ~ '^[a-f0-9]{64}$'),
  id_document_path text not null,
  face_scan_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','resubmission_required')),
  duplicate_flag boolean not null default false,
  duplicate_reviewed boolean not null default false,
  review_notes text,
  consent_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists identity_verifications_status_submitted_idx
  on public.identity_verifications(status, submitted_at desc);
create index if not exists identity_verifications_id_hash_idx
  on public.identity_verifications(id_number_hash);

alter table public.identity_verifications enable row level security;
revoke all on public.identity_verifications from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-documents', 'identity-documents', false, 10485760,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Users upload their own identity documents" on storage.objects;
create policy "Users upload their own identity documents"
on storage.objects for insert to authenticated
with check (bucket_id='identity-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users view their own identity documents" on storage.objects;
create policy "Users view their own identity documents"
on storage.objects for select to authenticated
using (bucket_id='identity-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- Submitted identity files are retained for the admin review process and cannot be deleted by the user.

create or replace function private.request_withdrawal(
  p_user_id uuid, p_asset text, p_network text, p_amount numeric, p_address text, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_wallet public.wallets%rowtype;
  v_tx public.wallet_transactions%rowtype;
  v_reference text;
  v_address text := pg_catalog.btrim(coalesce(p_address,''));
begin
  if p_user_id is null then raise exception 'User is required'; end if;
  if p_request_id is null then raise exception 'A withdrawal request ID is required'; end if;
  if not exists (
    select 1 from public.identity_verifications iv
    where iv.user_id = p_user_id and iv.status = 'approved'
  ) then
    raise exception 'Identity verification must be approved by FLEXAR before you can withdraw';
  end if;
  if not ((p_asset='USDT' and p_network='TRC-20') or (p_asset='TON' and p_network='TON')) then raise exception 'Unsupported asset/network combination'; end if;
  if p_amount is null or p_amount<=0 or p_amount>1000000 or p_amount<>pg_catalog.round(p_amount,8) then raise exception 'Withdrawal amount must be positive, at most 1000000, and have no more than 8 decimal places'; end if;
  if pg_catalog.length(v_address)<8 or pg_catalog.length(v_address)>200 then raise exception 'A valid destination address is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  v_reference:='withdraw_request_'||p_request_id::text;
  select * into v_tx from public.wallet_transactions wt where wt.type='withdrawal' and wt.reference=v_reference for update;
  if found then
    if v_tx.user_id<>p_user_id or v_tx.amount<>p_amount or coalesce(v_tx.metadata->>'asset','')<>p_asset or coalesce(v_tx.metadata->>'network','')<>p_network or coalesce(v_tx.metadata->>'destination_address','')<>v_address or coalesce(v_tx.metadata->>'request_id','')<>p_request_id::text then raise exception 'Request ID has already been used for a different withdrawal'; end if;
    select * into v_wallet from public.wallets w where w.id=v_tx.wallet_id and w.user_id=v_tx.user_id;
    if not found then raise exception 'Wallet for existing withdrawal is unavailable; reconciliation required'; end if;
    return pg_catalog.jsonb_build_object('transaction_id',v_tx.id,'reference',v_tx.reference,'status',v_tx.status,'asset',p_asset,'network',p_network,'amount',v_tx.amount,'locked_balance',v_wallet.locked_balance,'remaining_available_balance',v_wallet.available_balance,'idempotent_replay',true);
  end if;
  select * into v_wallet from public.wallets w where w.user_id=p_user_id and w.asset=p_asset and w.network=p_network for update;
  if not found then raise exception 'Wallet is not available'; end if;
  if v_wallet.available_balance<p_amount then raise exception 'Insufficient available balance'; end if;
  insert into public.wallet_transactions(user_id,wallet_id,type,direction,amount,status,reference,metadata)
  values(p_user_id,v_wallet.id,'withdrawal','debit',p_amount,'pending',v_reference,pg_catalog.jsonb_build_object('asset',p_asset,'network',p_network,'destination_address',v_address,'requires_admin_review',true,'request_id',p_request_id::text)) returning * into v_tx;
  update public.wallets set available_balance=available_balance-p_amount,locked_balance=locked_balance+p_amount,updated_at=pg_catalog.now() where id=v_wallet.id returning * into v_wallet;
  return pg_catalog.jsonb_build_object('transaction_id',v_tx.id,'reference',v_tx.reference,'status',v_tx.status,'asset',p_asset,'network',p_network,'amount',v_tx.amount,'locked_balance',v_wallet.locked_balance,'remaining_available_balance',v_wallet.available_balance,'idempotent_replay',false);
end;
$function$;
