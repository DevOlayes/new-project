alter table public.payment_orders
  add column if not exists payment_attempted_at timestamptz;

create index if not exists payment_orders_purpose_status_attempted_idx
  on public.payment_orders(purpose, status, payment_attempted_at);

update public.payment_orders
set payment_attempted_at = created_at
where payment_attempted_at is null
  and tx_hash is not null;
