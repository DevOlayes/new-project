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
