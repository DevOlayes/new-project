create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target_type text not null default 'system',
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_admin_user_id_idx
  on public.admin_audit_log (admin_user_id, created_at desc);

alter table public.admin_audit_log enable row level security;

revoke all on table public.admin_audit_log from anon, authenticated;
grant select, insert on table public.admin_audit_log to service_role;

comment on table public.admin_audit_log is
  'Audit trail for privileged FLEXAR AI administrative actions. Access is restricted to the service role.';
