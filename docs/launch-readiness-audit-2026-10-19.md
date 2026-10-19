# Flexar AI launch-readiness audit — 2026-10-19

## Scope and safety

This is a read-only audit of GitHub `main`, the connected Supabase project, and the deployed Edge Functions. No production code, database records, secrets, or deployment settings were changed during the audit.

Branch created for remediation work: `launch-readiness-2026-10-19`.

## Current baseline

- Frontend: React 19 + Vite 7; deploy script builds and deploys to Cloudflare Workers.
- Backend: Supabase Auth, PostgreSQL, Row Level Security, Edge Functions, and scheduled jobs.
- Integrations: Telegram auth/notifications, USDT deposit flows, market data, and an MT5 gateway integration.
- GitHub build verification workflow runs `bun install` and `bun run build`; it does not currently run automated functional or security tests.
- Last reviewed successful build workflow: https://github.com/DevOlayes/new-project/actions/runs/38881677486
- Production Worker: https://new-project.mails4olayes.workers.dev/

## Findings requiring remediation

### P0 — GitHub/deployment drift

The deployed Supabase Edge Function source does not exactly match repository source for multiple functions, including market ingestion/features, opportunity engine, adaptive learning, account onboarding, Telegram login/auth, trading, wallet, and withdrawal-related functions. The live project also has a deployed `mt5-gateway` function not present in the repository. The live migration history is not fully represented by repository migration files.

**Risk:** deploying repository code blindly may roll back live fixes or change production behavior.

**Required action:** export/reconcile the live implementation and migration history with version-controlled source; identify intended production version per function; only deploy reviewed diffs.

### P0 — Withdrawal lifecycle appears incomplete

The current deployed `request-withdrawal` function authenticates the user, blocks admin/test accounts, validates request fields, and calls the private `request_withdrawal` database function. The reviewed repository did not contain a clear complete admin review / payout / finalization workflow.

**Risk:** users may be able to request withdrawals without a supported, auditable completion/rejection process.

**Required action:** trace the full withdrawal state machine, ensure funds are reserved exactly once, add authorized review and explicit completion/rejection paths, and test ledger invariants before enabling real-money withdrawals. Do not invent a payout integration or mark payouts complete without provider confirmation.

### P1 — Admin UI/backend action mismatch

The frontend invokes an `adjust_wallet` action, but the reviewed `admin-control` Edge Function does not implement that action.

**Risk:** admin wallet adjustments may fail or produce misleading UI behavior.

**Required action:** either implement the action with strict server-side admin authorization, idempotency, ledger entries, audit metadata and bounds, or remove/disable the UI control until it is supported. Never change balances directly from the client.

### P1 — Security and test coverage

The connected Supabase security advisor reported items needing review, including leaked-password protection disabled and a database function with a mutable search path. The public `diagnostic-ingest` endpoint accepts bounded batches but has no application-level authentication or explicit rate limit in its handler.

**Required action:** review advisories individually, set safe function search paths where appropriate, decide and configure password protection, and add abuse controls to diagnostic ingestion without collecting secrets or sensitive form data.

### P1 — No automated end-to-end release gate

The existing CI verifies a production Vite build only. It does not exercise authentication, onboarding, deposits, wallet ledger, credit purchases, manual trading, autopilot, settlement, withdrawals, or Telegram flows.

**Required action:** add appropriate automated tests and a documented mobile/Telegram smoke-test checklist. Keep production deployment separate from branch validation.

### P2 — Engine-version label mismatch

The admin UI labels the engine `opportunity-v2`, while the live opportunity engine identifies itself as `opportunity-v3`.

**Required action:** use a single source of truth for the deployed engine version so operators see accurate status.

## Remediation started on branch

The draft PR now includes:
- a database RPC for atomic, bounded, audited, idempotent admin USDT/TRC-20 balance adjustments;
- admin UI/API wiring for that adjustment;
- an explicit manual withdrawal review flow: pending → processing after approval, pending → cancelled with a refund on rejection, and processing → completed only after an operator records an external payout transaction hash;
- a draft withdrawal-review interface in the admin transactions panel.

These changes are on `launch-readiness-2026-10-19` only. They have not been merged, the SQL migrations have not been applied to Supabase, and production behavior has not been tested. The withdrawal completion action records an operator-attested external payout; it does not send funds or verify the chain transaction itself. Controlled integration testing and an operational payout procedure are still required.

## Central wallet and ledger architecture direction

The intended operating model is a centralized financial service with one authoritative internal ledger, while each user retains a separate logical wallet balance. A central treasury wallet (or a controlled set of wallets by asset/network) holds the actual on-chain funds. These are related but distinct layers: the internal ledger tracks who is owed what; the treasury holds the assets that back those liabilities.

The live schema inventory includes:
- `public.wallets`: per-user logical wallet balances, including available and locked amounts;
- `public.wallet_transactions`: user-facing transaction and accounting records;
- `public.deposit_requests` and `public.payment_orders`: deposit/payment workflow records.

No explicit treasury/central-wallet database table was found in this inventory. That does not prove no external treasury wallet exists; it means the source of truth for treasury addresses, signing authority, and balance reconciliation still needs to be documented and verified.

Required design controls:
- Keep each asset and network distinct; do not combine USDT on TRC-20 with TON or another network as if they were the same asset.
- Route deposits, withdrawals, swaps, trade locks/settlement, and admin corrections through authenticated server-side operations and a consistent ledger.
- Credit deposits only after the correct chain/provider verification and duplicate/replay checks.
- For a withdrawal, reserve the user's balance, keep the request pending for admin review, record the rejection reason and an explicit refund ledger credit if rejected, or complete it only after the external payout has been sent and independently verified.
- Reconcile treasury balances against internal user liabilities, pending/locked withdrawals, fees, and platform reserves on a regular schedule.
- Do not describe the manual payout workflow as automatic on-chain execution. A payout provider/transaction-signing integration and chain confirmation checks are separate future work.

Additional high-priority gap: the currently deployed `private.request_withdrawal` function does not accept a client idempotency key. It reserves funds transactionally, but a repeated submission can create more than one pending withdrawal if sufficient balance remains. Add request-level idempotency and test concurrent/retried submissions before enabling real-money withdrawals.

## Branch changes added during follow-up

- Withdrawal history now exposes the saved administrator review reason, destination, and transaction hash in the expandable transaction details.
- A cancelled withdrawal is labelled as cancelled/refunded rather than looking like a completed debit.
- The rejection migration now creates a separate `withdrawal_refund` credit ledger entry in the same database transaction as the balance refund, so the refund is explicitly visible for reconciliation.
- The Wrangler `previews` configuration was added after the Cloudflare preview build failed because the config did not contain the required block. GitHub's frontend build verification passed after the initial config fix; the latest SQL/UI follow-up still needs a fresh build result.

These additions remain on the draft branch. No migration has been applied to production, and none of the new database functions has been validated against a non-production database yet.

## Release sequence

1. Preserve the current production state and capture a baseline.
2. Reconcile deployed Edge Function code and database migrations with GitHub.
3. Resolve the withdrawal lifecycle and admin wallet action before enabling real-money operations.
4. Review and remediate applicable security advisories; add tests and abuse controls.
5. Run build, targeted tests, and mobile/Telegram smoke tests.
6. Review the diff and deployment plan; deploy only after critical checks pass.
7. Verify production health and document rollback steps.

## Go/no-go criteria

Do not enable real-money withdrawals or advertise end-to-end real-money trading until:
- the deployed backend is reproducible from reviewed source;
- wallet/ledger operations are atomic, idempotent, and auditable;
- deposit verification cannot be spoofed or replayed;
- manual and automated trade settlement paths pass tests;
- withdrawal request, review, payout confirmation, rejection, and refund paths pass tests;
- critical security advisories are reviewed and addressed or explicitly accepted;
- the live deployment passes the agreed smoke tests.

## Important limitation

This audit establishes code and configuration discrepancies; it does not certify the financial system, execute a real deposit or payout, or prove the full user journey works in production. All financial flow testing should use a controlled test account and test funds until sign-off.
