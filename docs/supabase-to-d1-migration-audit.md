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
