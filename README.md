# Flexar

> Mobile-first AI trading web application built with React + JavaScript, Supabase, GitHub and Cloudflare.

## Product direction

Flexar is the web interface for the existing Nexora AI Trades product experience. The goal is to preserve useful Nexora workflows while giving them a polished, mobile-app-like web experience.

Core interfaces: Flexar Web App, Flexar Telegram Mini App, and Telegram notification bot. All interfaces should use the same account and backend data.

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

The current UI uses sample values only. It is not yet a live trading engine and must not be presented as one.

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

Do not commit Telegram bot tokens, Supabase secret keys, or service-role keys to GitHub.

## Important current state

The landing page and Telegram Web App shell are now in place. Live Telegram authentication is deliberately not enabled until the bot token is rotated and stored as a server-side secret. Wallet and trade values in the shell remain demo values until live database queries and server-controlled trading flows are implemented.
