# FLEXAR Supabase → Cloudflare D1 Migration Audit — Checkpoint 1
Date: 2026-11-24
Repository: DevOlayes/new-project
Branch: audit/supabase-to-d1-inventory
Status: documentation checkpoint only. No production database, deployment, live data or runtime configuration changed.

## Executive finding
FLEXAR is deeply Supabase-dependent. The React frontend uses @supabase/supabase-js; src/App.jsx (~260 KB) directly accesses Supabase Auth, Storage, Edge Functions, table queries and RPC. src/lib/data.js also accesses Supabase. Current wrangler.jsonc configures static assets/build/observability but no D1 binding or Worker API entrypoint. This is a backend architecture migration, not a database-only replacement.

## Repository evidence
- package.json: @supabase/supabase-js 2.117.1; Vite/React; build/deploy via Wrangler.
- src/lib/supabase.js: Supabase URL/publishable key fallback, client and diagnostics fetch.
- src/lib/data.js: account queries via Supabase client.
- src/App.jsx: auth/session, email signup/login, Google OAuth, signout, profiles, Edge Function invokes, identity-document Storage upload/removal, RPC set_ai_trading_mode.
- wrangler.jsonc: static SPA assets, build and observability; no D1 binding or Worker API entry.
- Migration files and function source are present; the entire SQL schema and live catalog are not yet fully audited.

## Edge Functions inventory (20)
account-onboarding; adaptive-learning; admin-control; ai-credits; deposit-requests; diagnostic-ingest; execute-trade; identity-verification; market-features; market-ingest; opportunity-engine; opportunity-evaluator; performance-dataset; request-withdrawal; settle-trades; swap-assets; telegram-auth; telegram-broadcast; telegram-login; wallet-info.

## Tables / objects surfaced in inspected function sources (not a complete schema)
profiles; wallets; wallet_transactions; trades; ai_opportunities; opportunity_evaluation_dataset; market_instruments; subscription_plans; user_subscriptions; user_rewards; referrals; referral_rewards; reward_campaigns; app_settings; adaptive_model_weights; deposit_requests; payment_orders; client_diagnostic_events; ai_credit_transactions; model_performance_stats; admin_audit_log; identity_verifications.

Observed RPCs: create_payment_order; complete_payment_order_verified; expire_incomplete_payment_requests; admin_review_withdrawal; admin_adjust_wallet; frontend also invokes set_ai_trading_mode. Further objects may exist in migrations or elsewhere.

## Migration map
- Supabase Postgres schema, functions, triggers and RPC → D1/SQLite versioned migrations plus Worker service logic. Rewrite PostgreSQL-specific SQL, types, sequences, constraints and routines; test transaction semantics.
- 20 Supabase Edge Functions → Cloudflare Workers/API routes. Port Deno/runtime dependencies, auth, validation, CORS, secrets and service contracts.
- Supabase Auth → identity-provider decision needed. D1 is not an auth service. Preserve identity IDs and account access; evaluate temporary retention or migration to an external/Cloudflare-compatible identity system before attempting replacement.
- Supabase Storage (identity-documents) → private R2 buckets with Worker-mediated authorization, upload constraints and retention; no public access by default.
- Supabase Realtime → Workers/WebSockets or Durable Objects, or polling depending on verified use; usage remains unconfirmed.
- Diagnostics/client events → Workers and D1 or Analytics Engine for high-volume telemetry, with privacy/rate limits/retention.
- Supabase secrets/service role → Worker secrets, least privilege and rotation; never copy secrets to source.
- Static SPA → keep Cloudflare asset hosting and route APIs through Worker services.
- Telegram auth/bot flows → Workers; verify HMAC, replay/time-window protections and user mapping.
- Wallet/payment/trade/reward ledger → D1, transactionally designed, idempotent, auditable and reconciled. Highest-risk area.

## Priority risks
Critical: wallet/balance mutations, payments/deposit verification, withdrawal requests, trade execution/settlement, AI-credit charging, admin adjustments, authorization, idempotency and audit logs.
High: referrals/rewards/onboarding claims, identity verification/document access and admin controls.
Medium: market metadata, diagnostics, learning datasets, opportunity presentation, notifications.

## D1 considerations
D1 is SQLite-based; Postgres schema/data cannot be imported unchanged. Use versioned migrations, local/staging tests, indexes and batched writes. Consider D1 size/query limits and single-threaded execution. Represent financial quantities with exact integer units or rigorously validated decimal strings, never floating-point balance math. Replace RLS with explicit Worker authorization checks. Critical mutations require transactions, constraints, idempotency, reconciliation and auditable state transitions.

## Phases / gates
1. Complete audit: every migration, full-source search, live catalog, RLS/policies, triggers, functions, views, extensions, storage policies, realtime and volumes.
2. Architecture/threat model: auth decision, Worker/API layout, R2 permissions, D1 model, secrets, rollback.
3. Isolated D1 staging scaffold, no production switch.
4. Schema conversion and migration tests.
5. Port Worker services and frontend API layer; remove browser direct database access.
6. Data transfer rehearsal; reconcile row counts, relationships, unique constraints, hashes where practical and financial balances.
7. Functional/security/load testing: auth, wallets, trades, payments, rewards, referrals, admin, identity documents, Telegram, AI, failure paths and concurrency.
8. Production gate: backup, tested rollback, observability, reconciliation and explicit approval. Keep Supabase intact until post-cutover verification and retention decision.

## Audit limitations
Selective GitHub tree/source inspection only. Full migration SQL review, live Supabase catalog, RLS, storage policies, secrets, logs, realtime config and data volume inspection remain outstanding. Their absence from this checkpoint must not be interpreted as absence in production.

Checkpoint document only; no production changes.


## Phase 2: Live Supabase inspection (read-only) — 2026-11-24
The connected Supabase project named **flexar** (ref `kuwpxpninjdvmkqkaxoi`) was confirmed `ACTIVE_HEALTHY`. Live database introspection was performed using read-only calls; no writes or schema changes were made.

### Live schema counts and approximate row counts
27 public tables surfaced by the live listing (all RLS-enabled):
- profiles (2); wallets (2); wallet_transactions (1,340); trades (670); referrals (0); notifications (0); app_settings (12); market_candles (1,144,945); ai_opportunities (1,766); market_features (541,709); opportunity_evaluation_dataset (100); reward_campaigns (1); user_rewards (2); referral_rewards (0); market_instruments (10); opportunity_decision_snapshots (0); model_performance_stats (80); adaptive_model_weights (20); subscription_plans (1); user_subscriptions (0); mt5_connections (0); ai_credit_transactions (669); ai_training_funds (1); deposit_requests (0); payment_orders (2); client_diagnostic_events (419); admin_audit_log (0); identity_verifications (0).

**Data-volume implication:** market_candles (~1.145M) and market_features (~542K) already dominate the measured data volume. These two datasets need separate transfer, retention, indexing, chunking and reconciliation strategies; they should not be treated like transactional tables or imported in one large batch.

### Live migration history
The live Supabase migration registry returned **41 migration entries**. Repository migration files must be compared against this live registry to identify drift, missing files and chronology mismatches.

### Live Edge Functions
All repository functions were observed active in the live function listing, with versions and JWT verification settings. The live listing also surfaced **mt5-gateway**, which was not in the repository's initial function inventory; its source and repository/deployment relationship must be investigated. The live inventory therefore needs reconciliation rather than assuming the repo list is exhaustive.

### Storage
Live storage inspection confirmed one private bucket, `identity-documents`:
- private bucket
- 10 MiB maximum object size
- allowed types: JPEG, PNG, WEBP and PDF
- policies permit authenticated users to upload and view objects within their own user-ID folder

Target: private R2 bucket and Worker-mediated access; migration must preserve folder ownership boundaries, type/size validation and authorization.

### Realtime
The inspected database publication table listing returned null. This is not a definitive account-wide proof that no realtime feature is used; frontend source and project configuration need further verification.

### Active scheduled database jobs
Live pg_cron inspection surfaced 9 active jobs:
- market-ingest: every minute
- opportunity-engine: every minute
- opportunity-evaluator: every minute
- performance-dataset: every 5 minutes
- adaptive-learning: every 5 minutes (offset schedule)
- payment-request expiry: every 15 minutes
- position manager: every minute
- autopilot engine: every minute
- market-features: scheduled job currently every 3 minutes (job name says every minute; actual schedule must be treated as authoritative)

These scheduled functions are a critical migration dependency. They need Cloudflare Cron Triggers and/or durable orchestration, with concurrency protection, retry semantics, monitoring and idempotency.

### Security advisor findings — recorded, not remediated
- RLS-enabled tables with no policies: admin_audit_log, client_diagnostic_events, identity_verifications (advisor severity INFO; privileged access may be intentionally service-only, but verify that configuration and backend-only access remain intact).
- Mutable search_path warning: private.touch_mt5_connection.
- SECURITY DEFINER functions exposed to authenticated users flagged by advisor: execute_trade, set_ai_trading_mode and swap_assets. Their authorization and exposure must be reviewed and migrated as backend-controlled operations where appropriate.
- Leaked-password protection currently disabled in Supabase Auth (advisor finding).

### Performance advisor findings
- 3 unindexed foreign keys: ai_credit_transactions.user_id; deposit_requests.reviewed_by; identity_verifications.reviewed_by.
- 1 duplicate-index finding on wallets user/asset/network uniqueness.
- 23 unused-index findings (advisor output); do not remove indexes blindly—usage windows and production query workload must be considered.
- RLS auth initialization-plan warning for a deposit_requests policy.

### Important exposure note
The live pg_cron job definitions include a publishable Supabase credential embedded in scheduled request headers. This was not reproduced in this audit document. Publishable credentials are not equivalent to service-role secrets, but using them as cron authentication is not a robust secret boundary. Replace this with a dedicated, rotatable secret and proper endpoint authentication during migration. Treat the credential as exposed to the extent it is present in repository/database configuration and rotate or replace as part of the security plan; do not publish secret values in logs or documentation.

### Phase 2 limitations
Read-only project introspection established tables, approximate row counts, migration registry, active function listing, storage bucket/policies, pg_cron jobs, policies and advisor findings. The complete per-table columns/constraints, every policy/function/trigger body, every function's source and live configuration, realtime settings, external integrations, and migration file-vs-registry comparison remain to be audited. The initial catalog query output was truncated, so the raw complete function inventory should be queried in smaller groups before final sign-off.
