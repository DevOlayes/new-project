create table if not exists public.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset text not null default 'USDT' check (asset = 'USDT'),
  network text not null default 'TRC-20' check (network = 'TRC-20'),
  amount numeric(24,8) not null check (amount > 0),
  tx_hash text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint deposit_requests_tx_hash_unique unique (tx_hash)
);
create index if not exists deposit_requests_user_created_idx on public.deposit_requests(user_id, created_at desc);
create index if not exists deposit_requests_status_created_idx on public.deposit_requests(status, created_at desc);
alter table public.deposit_requests enable row level security;
drop policy if exists "Users can view their own deposit requests" on public.deposit_requests;
create policy "Users can view their own deposit requests" on public.deposit_requests for select to authenticated using (auth.uid() = user_id);
revoke all on public.deposit_requests from anon, authenticated;
grant select on public.deposit_requests to authenticated;
grant select, insert, update, delete on public.deposit_requests to service_role;
create or replace function public.review_usdt_deposit(p_request_id uuid, p_admin_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.deposit_requests%rowtype; w public.wallets%rowtype; next_balance numeric(24,8);
begin
  if p_decision not in ('approve','reject') then raise exception 'Invalid decision'; end if;
  if not exists (select 1 from public.profiles where id = p_admin_id and is_admin = true) then raise exception 'Forbidden'; end if;
  select * into r from public.deposit_requests where id = p_request_id for update;
  if not found then raise exception 'Deposit request not found'; end if;
  if r.status <> 'pending' then raise exception 'This deposit request has already been reviewed'; end if;
  if p_decision = 'reject' then
    update public.deposit_requests set status='rejected', admin_note=p_note, reviewed_by=p_admin_id, reviewed_at=now() where id=r.id;
    return jsonb_build_object('ok',true,'status','rejected');
  end if;
  select * into w from public.wallets where user_id=r.user_id and asset='USDT' and network='TRC-20' for update;
  if not found then raise exception 'User USDT TRC-20 wallet not found'; end if;
  next_balance := w.available_balance + r.amount;
  update public.wallets set available_balance=next_balance, updated_at=now() where id=w.id;
  insert into public.wallet_transactions(user_id,wallet_id,type,direction,amount,status,reference,metadata)
  values(r.user_id,w.id,'deposit','credit',r.amount,'completed','deposit_'||r.id::text,jsonb_build_object('tx_hash',r.tx_hash,'network','TRC-20','reviewed_by',p_admin_id));
  update public.deposit_requests set status='approved', admin_note=p_note, reviewed_by=p_admin_id, reviewed_at=now() where id=r.id;
  return jsonb_build_object('ok',true,'status','approved','available_balance',next_balance);
end;
$$;
revoke all on function public.review_usdt_deposit(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_usdt_deposit(uuid,uuid,text,text) to service_role;
