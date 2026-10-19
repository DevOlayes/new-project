-- Remove only auto-created, empty TON ledger placeholders. Never delete a wallet
-- with a balance or any linked transaction history. Explicit future swaps can
-- create an optional TON ledger wallet when a customer chooses that asset.
delete from public.wallets w
where w.asset = 'TON'
  and coalesce(w.available_balance, 0) = 0
  and coalesce(w.locked_balance, 0) = 0
  and not exists (
    select 1 from public.wallet_transactions t where t.wallet_id = w.id
  );
