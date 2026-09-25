# Flexa AI

> Mobile-first AI trading web application built with React + JavaScript, Supabase, GitHub and Cloudflare.

## Product direction

Flexa AI is the web interface for the existing Nexora AI Trades product experience. The goal is to preserve useful Nexora workflows while giving them a polished, mobile-app-like web experience.

Core interfaces: Flexa AI Web App, Flexa AI Telegram Mini App, and Telegram notification bot. All interfaces should use the same account and backend data.

## Permanent stack

- React + JavaScript/JSX
- Vite
- Supabase for PostgreSQL, Auth and supporting backend services
- GitHub as the source of truth
- Cloudflare for deployment, HTTPS and CDN
- Telegram for identity connection, Mini App access and notifications

Do not introduce TypeScript, TSX or Next.js unless the project direction is explicitly changed.

## UX principles

- Mobile-first and app-like rather than desktop-dashboard-first
- Dark background with restrained neon green accents
- Bottom navigation on mobile
- Clear cards, compact information hierarchy and touch-friendly controls
- Avoid unnecessary animation, dependencies and visual clutter
- Keep important actions obvious: Trade, Deposit, Withdraw, Activity and Profile

## Supported wallet routes

| Asset | Network |
| --- | --- |
| TON | TON |
| USDT | TRC-20 |

Model assets and networks separately so additional supported routes can be added later.

## Security requirements

- Never expose Supabase service-role or secret keys in browser code.
- Telegram Mini App identity must be verified server-side using Telegram signed initialization data.
- Telegram connection is an account identity/onboarding mechanism; it is not automatically regulatory KYC.
- Client code must never be trusted to set wallet balances, trade settlement results, admin roles or withdrawal status.
- All exposed Supabase tables require RLS.
- Financial operations need server-side validation, idempotency, audit records and rate limits.
- Withdrawal processing must verify destination, network and transaction state before settlement.

## Current frontend

The first frontend foundation is intentionally small. It establishes navigation and the visual system before connecting live data.

Current pages: Home, AI Trade, Activity, Wallet and Profile.

The frontend is connected to the live Supabase account, market-opportunity and wallet data model. Real-money trading, deposits and withdrawals remain disabled until their server-side financial flows are implemented and verified.

## Backend model

Initial Supabase entities: `profiles`, `wallets`, `wallet_transactions`, `trades`, `referrals`, `notifications`, and `app_settings`.

Balances and settlement should eventually be ledger-driven and server-controlled rather than directly editable by the browser.

## BUILD OS

1. **Inspect first** — read existing code and preserve working functionality before changing structure.
2. **Build small** — make one coherent feature at a time and avoid unnecessary abstraction.
3. **Comment meaningful logic** — especially security boundaries, integrations and non-obvious business rules.
4. **Verify before claiming** — verify affected files, database behavior or build paths before reporting success.
5. **Keep GitHub authoritative** — Cloudflare should deploy from GitHub rather than becoming a second source of truth.
6. **Protect production money flows** — trading, deposits and withdrawals must be server-side and auditable before real funds are enabled.

## Deployment

Cloudflare can deploy the Vite static frontend from GitHub. A custom domain is optional and can be connected later without changing the application architecture.

## Development rule

Do not add complexity simply because a feature can be abstracted. Flexar should remain understandable to one developer working from a mobile device.


## Current deployment

Cloudflare has a working Workers URL for the current frontend:

`https://new-project.mails4olayes.workers.dev/`

The same public URL is intended to serve two experiences:
- normal browser: Flexar public landing page
- Telegram Mini App: Flexar authenticated app shell

Cloudflare supports React + Vite deployment to a `workers.dev` URL and later migration to a custom domain. citeturn0search0turn0search4

## Telegram integration plan

The Telegram Web App SDK is loaded from Telegram's official script. The Mini App will use `Telegram.WebApp.initData` for authentication. Telegram explicitly warns that `initDataUnsafe` must not be trusted; raw `initData` must be validated server-side before account identity is accepted. citeturn0search2

Planned flow:

```
Telegram user
  -> Flexar Mini App
  -> Telegram.WebApp.initData
  -> Supabase Edge Function
  -> validate Telegram signature
  -> create/link Flexar account
  -> Supabase session/profile
  -> app
```

## Environment configuration

The browser uses the Supabase project URL and publishable key. Supabase's current React documentation uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. citeturn0search3turn0search5

Do not commit Telegram bot tokens, Telegram Client Secrets, Supabase secret keys, or service-role keys to GitHub.

Website Telegram login also requires `VITE_TELEGRAM_CLIENT_ID` in the Cloudflare build environment and the same Client ID as the server-side `TELEGRAM_CLIENT_ID` secret in Supabase Edge Functions. Telegram's current Login flow requires the website origin to be registered under the bot's Allowed URLs in @BotFather. citeturn1search0

## Important current state

The landing page and Telegram Web App shell are now in place. Website Telegram login uses Telegram's current Login library with a custom Flexa-styled button; the legacy hidden iframe widget is no longer used. The server verifies Telegram OIDC ID-token signatures before creating/linking a Supabase account. Wallet and trade values in the shell remain demo values until live database queries and server-controlled trading flows are implemented.


## Authentication and communication channels

### Website authentication

Normal website visitors use:
- Google: Supabase's built-in Google provider.
- Telegram: Telegram's current Login library. The visible button is native Flexa UI; Telegram opens its authentication popup and returns an OIDC ID token. The `telegram-login` Edge Function verifies the token signature and claims before creating/linking the Supabase account and returning a Supabase session.

The website Telegram login must remain a browser authentication flow. It is separate from the Telegram Mini App.

### Telegram subscriber connection

Telegram website login requests bot-access permission. When Telegram grants that permission, the profile stores:
- `telegram_user_id`
- `telegram_bot_access_granted`
- `telegram_notifications_enabled`
- `telegram_connected_at`

The `telegram-broadcast` Edge Function is admin-protected and sends messages only to eligible profiles. The bot token remains a Supabase server secret.

### Google email

Google authentication provides the user's email to Supabase Auth. Account onboarding synchronizes that email into `profiles.email` for future email delivery.

Email broadcast consent is separate:
- `email_marketing_opt_in` defaults to false.
- Future broadcast UI can explicitly enable/disable email updates.

### Two Telegram experiences

1. **Website login:** browser -> Flexa Telegram button -> Telegram Login popup -> server-side OIDC verification -> Supabase session -> Flexa AI web app.
2. **Telegram Mini App:** Telegram -> Flexa AI Mini App -> server-side `initData` verification -> Supabase session -> app.

These flows must remain separate.

## Market Intelligence — Stage 6B

The market engine now monitors **10 supported pairs**:
- Crypto: BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT, DOGE/USDT
- Forex: EUR/USD, GBP/USD, USD/JPY, AUD/USD

Crypto market candles are sourced from Binance spot data. Forex candles use Yahoo Finance intraday data and are normalized into the same candle/feature pipeline. Forex is treated as a market-data source for the AI opportunity engine; source availability and freshness are checked before a signal can be produced.

### Performance and adaptive-learning layer

The engine now records:
- immutable opportunity decision snapshots
- feature/scoring context at signal-generation time
- settled opportunity evaluation rows
- model performance statistics by symbol and timeframe
- adaptive timeframe weights per symbol/model version
- confidence-floor adjustments with conservative guardrails

The adaptive layer is **not autonomous ML retraining**. It is a controlled feedback system: once enough labelled outcomes exist, recent performance can adjust the weighting of the existing signal components. Model changes should still be validated before any future ML model replaces the deterministic engine.

### Current engine flow

```
Market Sources
  -> Market Candles
  -> Market Features
  -> AI Opportunity Engine
  -> Decision Snapshot
  -> Opportunity Evaluation
  -> Performance Dataset
  -> Adaptive Weights
  -> Next Opportunity Engine Run
```

The Admin dashboard foundation is now connected to the production telemetry model and includes operational views for users, transactions, trades, opportunities, markets, adaptive profiles, subscriptions and settings.
