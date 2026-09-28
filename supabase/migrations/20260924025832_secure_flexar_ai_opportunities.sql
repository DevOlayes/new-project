-- Recovered migration: secure AI opportunity reads.
-- The remote migration history records this version as applied.
-- This file reconstructs the security change from the current remote schema.

alter table if exists public.ai_opportunities enable row level security;

revoke all on public.ai_opportunities from anon, authenticated;
grant select on public.ai_opportunities to authenticated;

drop policy if exists "authenticated_read_ai_opportunities" on public.ai_opportunities;

create policy "authenticated_read_ai_opportunities"
on public.ai_opportunities
for select
to authenticated
using (status in ('scheduled','open','settled'));
