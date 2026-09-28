-- Stage 5: Performance Analytics & Learning Dataset Engine
-- Raw opportunity outcomes remain in ai_opportunities.
-- This table stores an immutable, normalized evaluation example for analysis/future model training.

create table if not exists public.opportunity_evaluation_dataset (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null unique references public.ai_opportunities(id) on delete cascade,
  symbol text not null,
  direction text not null check (direction in ('up','down')),
  duration_seconds integer not null check (duration_seconds > 0),
  model_version text not null,
  signal_score numeric not null check (signal_score >= 0 and signal_score <= 1),
  entry_window_start timestamptz not null,
  entry_window_end timestamptz not null,
  entry_price numeric not null,
  exit_price numeric not null,
  outcome text not null check (outcome in ('won','lost','void')),
  outcome_label smallint null check (outcome_label in (0,1)),
  price_change_pct numeric not null,
  feature_snapshot jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists opportunity_evaluation_dataset_model_idx
  on public.opportunity_evaluation_dataset (model_version, evaluated_at desc);

create index if not exists opportunity_evaluation_dataset_symbol_idx
  on public.opportunity_evaluation_dataset (symbol, evaluated_at desc);

alter table public.opportunity_evaluation_dataset enable row level security;

revoke all on public.opportunity_evaluation_dataset from anon, authenticated;
grant select on public.opportunity_evaluation_dataset to authenticated;

drop policy if exists "authenticated users can view evaluation dataset"
  on public.opportunity_evaluation_dataset;

create policy "authenticated users can view evaluation dataset"
on public.opportunity_evaluation_dataset
for select
to authenticated
using (true);

create or replace view public.ai_opportunity_performance
with (security_invoker = true)
as
select
  model_version,
  symbol,
  direction,
  count(*) filter (where outcome in ('won','lost'))::bigint as decided_count,
  count(*) filter (where outcome = 'won')::bigint as wins,
  count(*) filter (where outcome = 'lost')::bigint as losses,
  count(*) filter (where outcome = 'void')::bigint as voids,
  round(
    100.0 * count(*) filter (where outcome = 'won')
    / nullif(count(*) filter (where outcome in ('won','lost')), 0),
    2
  ) as win_rate_pct,
  round(avg(signal_score), 4) as avg_signal_score,
  round(avg(price_change_pct), 6) as avg_price_change_pct,
  min(evaluated_at) as first_evaluated_at,
  max(evaluated_at) as last_evaluated_at
from public.opportunity_evaluation_dataset
group by model_version, symbol, direction;

revoke all on public.ai_opportunity_performance from anon, authenticated;
grant select on public.ai_opportunity_performance to authenticated;

create or replace view public.ai_opportunity_performance_overall
with (security_invoker = true)
as
select
  model_version,
  count(*) filter (where outcome in ('won','lost'))::bigint as decided_count,
  count(*) filter (where outcome = 'won')::bigint as wins,
  count(*) filter (where outcome = 'lost')::bigint as losses,
  count(*) filter (where outcome = 'void')::bigint as voids,
  round(
    100.0 * count(*) filter (where outcome = 'won')
    / nullif(count(*) filter (where outcome in ('won','lost')), 0),
    2
  ) as win_rate_pct,
  round(avg(signal_score), 4) as avg_signal_score,
  round(avg(price_change_pct), 6) as avg_price_change_pct,
  min(evaluated_at) as first_evaluated_at,
  max(evaluated_at) as last_evaluated_at
from public.opportunity_evaluation_dataset
group by model_version;