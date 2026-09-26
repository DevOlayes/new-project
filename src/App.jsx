import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { getTelegramWebApp, isTelegramMiniApp } from "./lib/telegram";
import { getAccountData } from "./lib/data";

const nav = [["home","⌂","Home"],["trade","↗","Trade"],["activity","◷","Activity"],["wallet","▣","Wallet"],["profile","◉","Profile"]];

const FLEXA_APP_URL = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, "");

export default function App() {
  const [inMiniApp, setInMiniApp] = useState(false);
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const EMPTY_ACCOUNT = { wallets: [], trades: [], transactions: [], notifications: [], opportunities: [], rewards: [], referrals: [], markets: [], plans: [], subscriptions: [], tradingAccess: null, error: null };
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [market, setMarket] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [rewardBusy, setRewardBusy] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [aiEngineActive, setAiEngineActive] = useState(() => {
    try { return sessionStorage.getItem("flexa_ai_engine_active") === "true"; } catch { return false; }
  });
  const [globalNotice, setGlobalNotice] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);

  const refreshAccount = useCallback(async () => {
    if (!supabase || !user) return;
    setLoading(true);
    try {
      const result = await getAccountData();
      setAccount(result);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Keep market polling and auth subscription independent from user state.
  // The previous implementation depended on refreshAccount, which depended on
  // the user object. Every auth refresh recreated the effect, re-subscribed,
  // and called getClaims again. That could create a render/auth loop and make
  // the whole authenticated UI feel frozen.
  useEffect(() => {
    let cancelled = false;
    const loadMarket = () => fetch("https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data) {
          setMarket({ price: Number(data.lastPrice), change: Number(data.priceChangePercent) });
        }
      })
      .catch(() => {});
    loadMarket();
    const timer = setInterval(loadMarket, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);

    const miniApp = getTelegramWebApp();
    setInMiniApp(isTelegramMiniApp());
    if (miniApp) {
      miniApp.ready();
      miniApp.expand();
    }

    if (!supabase) {
      setLoading(false);
      return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    }

    let mounted = true;

    const { data: authSubscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      setUser(session?.user || null);

      if (event === "SIGNED_OUT") {
        setProfile(null);
        setAccount(EMPTY_ACCOUNT);
        setLoading(false);
      }
    });

    // Supabase emits INITIAL_SESSION after the client restores an existing
    // session. This is the single initial auth source; don't run getClaims in
    // the same effect because doing both creates duplicate state updates.
    const initialize = async () => {
      if (miniApp?.initData) {
        const { data, error } = await supabase.functions.invoke("telegram-auth", {
          body: { initData: miniApp.initData },
        });

        if (!mounted) return;

        if (error || data?.error) {
          setAuthError(data?.error || error?.message || "Telegram authentication failed.");
          setLoading(false);
        } else if (data?.session?.access_token && data?.session?.refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });
          if (sessionError) {
            setAuthError(sessionError.message || "Could not establish your Flexa AI session.");
            setLoading(false);
          } else {
            setAuthError("");
          }
        }
      } else {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (error) {
          setAuthError(error.message || "Could not restore your Flexa AI session.");
        }
        if (!data?.session) setLoading(false);
      }
    };

    initialize();

    return () => {
      mounted = false;
      authSubscription.subscription.unsubscribe();
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      if (!loading) setAccount(EMPTY_ACCOUNT);
      return;
    }

    let cancelled = false;

    const loadAccount = async () => {
      setLoading(true);

      const onboarding = await supabase.functions.invoke("account-onboarding", {
        body: {
          referral_code:
            new URLSearchParams(window.location.search).get("ref") ||
            localStorage.getItem("flexa_referral_code") ||
            "",
        },
      });

      if (cancelled) return;

      if (onboarding.error || onboarding.data?.error) {
        setAuthError(onboarding.data?.error || onboarding.error?.message || "");
      } else {
        setAuthError("");
      }

      // Read the profile after onboarding so first-time users do not race
      // the profile upsert and get stuck with an empty profile/admin state.
      const { data: profileData } = await supabase.from("profiles")
        .select("display_name,telegram_username,avatar_url,referral_code,is_admin")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;
      setProfile(profileData || null);

      const result = await getAccountData();
      if (cancelled) return;
      setAccount(result);
      setLoading(false);
    };

    loadAccount().catch((error) => {
      if (cancelled) return;
      setAuthError(error.message || "Could not load your Flexa AI account.");
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function claimReward() {
    if (!supabase || rewardBusy) return;
    setRewardBusy(true);
    setAuthError("");
    try {
      const { data, error } = await supabase.functions.invoke("account-onboarding", { body: { action: "claim" } });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Could not claim your welcome reward.");
      await refreshAccount();
    } catch (error) {
      setAuthError(error.message || "Could not claim your welcome reward.");
    } finally {
      setRewardBusy(false);
    }
  }

  async function startAiScan() {
    if (!supabase || aiScanning || aiEngineActive) return;
    // Lock the control immediately on the user's click. The engine is now considered
    // active while the opportunity window it creates is still alive.
    setAiScanning(true);
    setAiEngineActive(true);
    try { sessionStorage.setItem("flexa_ai_engine_active", "true"); } catch {}
    setGlobalNotice("");
    try {
      const { data, error } = await supabase.functions.invoke("opportunity-engine", {
        body: { source: "user", requested_at: new Date().toISOString() }
      });
      if (error) {
        let message = error.message || "The AI engine could not start.";
        try {
          const payload = await error.context?.json?.();
          message = payload?.error || payload?.message || message;
        } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);

      const created = (data?.results || []).filter((item) => item?.status === "created");
      const alreadyExists = (data?.results || []).filter((item) => item?.status === "already_exists");
      await refreshAccount();

      if (!created.length && !alreadyExists.length) {
        setAiEngineActive(false);
        try { sessionStorage.removeItem("flexa_ai_engine_active"); } catch {}
        setGlobalNotice("Flexa AI is scanning, but there is no fresh high-quality opportunity right now. Try again when the next signal is ready.");
        setPage("trade");
        return;
      }

      setPage("trade");
      setGlobalNotice("Flexa AI is active. Your AI-selected opportunity is ready.");
    } catch(error) {
      // If the backend rejected the start, release the lock so the user can retry.
      setAiEngineActive(false);
      try { sessionStorage.removeItem("flexa_ai_engine_active"); } catch {}
      setGlobalNotice(error.message || "The AI engine could not start.");
    } finally {
      setAiScanning(false);
    }
  }

  async function installFlexa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  useEffect(() => {
    const handleTradeStarted = () => refreshAccount();
    window.addEventListener("flexa-trade-started", handleTradeStarted);
    return () => window.removeEventListener("flexa-trade-started", handleTradeStarted);
  }, [refreshAccount]);

  useEffect(() => {
    if (!aiEngineActive || aiScanning) return;
    const live = (account.opportunities || []).filter((item) => ["scheduled", "open"].includes(item.status));
    if (!live.length) return;
    const latestEnd = Math.max(...live.map((item) => new Date(item.entry_window_end || 0).getTime()).filter(Number.isFinite));
    if (!Number.isFinite(latestEnd) || latestEnd <= Date.now()) return;
    const timer = setTimeout(() => {
      setAiEngineActive(false);
      try { sessionStorage.removeItem("flexa_ai_engine_active"); } catch {}
      refreshAccount();
    }, Math.max(1000, latestEnd - Date.now() + 1500));
    return () => clearTimeout(timer);
  }, [account.opportunities, aiEngineActive, aiScanning, refreshAccount]);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setAccount(EMPTY_ACCOUNT);
    setAiEngineActive(false);
    try { sessionStorage.removeItem("flexa_ai_engine_active"); } catch {}
  }

  if (profile?.is_admin && page === "admin") return <AdminDashboard onExit={() => setPage("home")} />;
  if (!inMiniApp && !user) return <Landing market={market} showAuth={showAuth} setShowAuth={setShowAuth} installPrompt={installPrompt} installFlexa={installFlexa} />;
  if (!user && loading) return <div className="loading-screen"><img className="loader-logo" src="/flexa-symbol.webp" alt="Flexa AI" /><strong>Connecting your Flexa AI account…</strong><span>Loading your account data…</span></div>;
  if (!user) return <div className="auth-screen"><div className="auth-card"><div className="brand"><img className="brand-symbol" src="/flexa-symbol.webp" alt="Flexa AI" /><div><strong>Flexa AI</strong><small>AI TRADES</small></div></div><h1>Connect your Telegram account</h1><p>Open Flexa AI from the Telegram Mini App so Telegram can securely identify your account.</p>{authError && <div className="error-banner">{authError}</div>}<span className="auth-hint">No separate password is required.</span></div></div>;

  const notifications = account.notifications || [];
  const unreadNotifications = notifications.filter((item) => !item.is_read).length;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img className="brand-symbol" src="/flexa-symbol.webp" alt="Flexa AI" /><div><strong>Flexa AI</strong><small>AI Trades</small></div></div><button type="button" className="icon-button notification-button" onClick={() => setShowNotifications(true)} aria-label="Open notifications"><span className="bell-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></span>{unreadNotifications > 0 && <b className="notification-dot">{unreadNotifications > 9 ? "9+" : unreadNotifications}</b>}</button></header>
    <main className="content">
      {authError && <div className="error-banner">{authError}</div>}
      <div key={page} className="page-transition" aria-live="polite">
        {page === "home" && <Home account={account} loading={loading} setPage={setPage} claimReward={claimReward} rewardBusy={rewardBusy} startAiScan={startAiScan} aiScanning={aiScanning} aiEngineActive={aiEngineActive} />}
        {page === "trade" && <Trade account={account} />}
        {page === "activity" && <Activity account={account} />}
        {page === "wallet" && <Wallet account={account} refreshAccount={refreshAccount} />}
        {page === "profile" && <Profile user={user} profile={profile} signOut={signOut} />}
      </div>
    </main>
    <nav className="bottom-nav" aria-label="Primary navigation">{nav.map(([id, icon, label]) => <button type="button" key={id} className={page === id ? "nav active" : "nav"} onClick={() => setPage(id)}><span>{icon}</span><small>{label}</small></button>)}{profile?.is_admin&&<button type="button" className={page==="admin"?"nav active":"nav"} onClick={()=>setPage("admin")}><span>◆</span><small>Admin</small></button>}</nav>
    {showNotifications && <NotificationPanel notifications={notifications} onClose={() => setShowNotifications(false)} />}
  </div>;
}

function NotificationPanel({ notifications, onClose }) {
  return <div className="notification-backdrop" onClick={onClose}>
    <aside className="notification-panel" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Notifications">
      <div className="notification-panel-head"><div><small>FLEXA AI</small><h2>Notifications</h2></div><button type="button" className="auth-close" onClick={onClose} aria-label="Close notifications">×</button></div>
      <div className="notification-list">
        {notifications.length ? notifications.slice(0, 20).map((item) => <article className={item.is_read ? "notification-item" : "notification-item unread"} key={item.id || item.created_at}>
          <span className="notification-mark">•</span><div><strong>{item.title || item.type || "Account update"}</strong><p>{item.message || item.body || "You have a new Flexa AI update."}</p><small>{item.created_at ? new Date(item.created_at).toLocaleString() : "Just now"}</small></div>
        </article>) : <div className="empty-state"><strong>No notifications yet</strong><p>Important account and trading updates will appear here.</p></div>}
      </div>
    </aside>
  </div>;
}

function Landing({ market, showAuth, setShowAuth, installPrompt, installFlexa }) {
  const price = market?.price;
  const change = market?.change;
  return <div className="landing"><div className="landing-orb orb-one" /><div className="landing-orb orb-two" />
    <header className="landing-topbar"><img className="landing-wordmark" src="/flexa-wordmark.svg" alt="Flexa AI" /><span className="live-chip">● WEB PLATFORM</span></header>
    <main className="landing-content">
      <section className="landing-hero"><div className="eyebrow">AI-POWERED MARKET OPPORTUNITIES</div><h1>Let the AI find<br /><span>the trade.</span></h1><p>Flexa AI continuously studies market conditions and surfaces simplified trading opportunities, so you do not need to understand complex charts before every trade.</p><div className="landing-actions"><button className="landing-cta" onClick={() => setShowAuth(true)}>Get started <b>→</b></button>{installPrompt && <button className="install-cta" onClick={installFlexa}>Install Flexa AI</button>}<div className="landing-trust">Free account · Google or Telegram · No Flexa AI password</div><span className="hero-status"><i /> Market data connected</span></div></section>
      <section className="landing-terminal"><div className="terminal-top"><div><small>LIVE MARKET</small><strong>BTC / USDT</strong></div><span className={change >= 0 ? "green" : "red"}>{change == null ? "—" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}</span></div><Chart /><div className="terminal-bottom"><strong>{price == null ? "Loading…" : "$" + price.toLocaleString(undefined,{maximumFractionDigits:2})}</strong><span>PUBLIC MARKET DATA</span></div><div className="floating-card float-card-a">AI OPPORTUNITY <b>SCANNING</b></div><div className="floating-card float-card-b">NEXT WINDOW <b>60 MIN</b></div></section>
      <section className="welcome-campaign"><div><span className="eyebrow">NEW USER CAMPAIGN</span><h2>Claim your <b>$50</b> welcome reward.</h2><p>Use the reward to trade. The reward itself cannot be withdrawn; only eligible profit generated from it can be withdrawn before the 12-day deadline.</p></div><span className="campaign-badge">12 DAYS</span></section><section className="opportunity-preview"><div><div className="eyebrow">AI OPPORTUNITY FEED</div><h2>Users do not hunt for trades. Flexa AI finds them.</h2></div><div className="opportunity-demo"><div><span>BTC / USDT</span><strong>AI opportunity detected</strong></div><b>UP ↗</b><small>60 MIN · REVIEW READY</small></div></section>
      <section className="landing-section"><div className="eyebrow">HOW FLEXAR WORKS</div><h2>Simple on the surface. Intelligent underneath.</h2><div className="landing-steps"><LandingStep n="01" title="Scan" text="Market data is continuously collected and analyzed across supported markets."/><LandingStep n="02" title="Select" text="The engine filters signals and turns stronger setups into user-friendly opportunities."/><LandingStep n="03" title="Trade" text="You review the opportunity, choose your stake and confirm when ready." /></div></section>
      <section className="landing-section"><div className="feature-row"><LandingFeature title="AI-first trading" text="The system does the heavy market analysis before presenting an opportunity."/><LandingFeature title="Real market data" text="Charts and future signals are designed around real market pricing, not invented demo prices."/><LandingFeature title="Transparent activity" text="Trades, balances and wallet events remain connected to your account ledger." /></div></section>
    </main>{showAuth && <AuthModal onClose={() => setShowAuth(false)} />}</div>;
}
function AuthModal({ onClose }) {
  const [mode, setMode] = useState("signup");
  const [error, setError] = useState("");
  return <div className="auth-modal-backdrop" onClick={onClose}><div className="auth-modal" onClick={(event) => event.stopPropagation()}><button className="auth-close" onClick={onClose} aria-label="Close">×</button><img className="auth-modal-icon" src="/flexa-symbol.webp" alt="Flexa AI" /><div className="eyebrow">WELCOME TO FLEXA AI</div><h2>{mode === "signup" ? "Start in seconds." : "Welcome back."}</h2><p>{mode === "signup" ? "Create your Flexa AI account with Google or Telegram." : "Sign in with the same account you used before."}</p><AuthOptions setAuthError={setError} authError={error} /><button className="auth-mode-toggle" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Already have an account? Sign in" : "New to Flexa AI? Create an account"}</button><small className="auth-legal">By continuing, you agree to use Flexa AI responsibly and follow applicable terms.</small></div></div>;
}

function AuthOptions({ setAuthError, authError }) {
  const [busy, setBusy] = useState("");

  async function continueWithGoogle() {
    if (!supabase) { setAuthError("Supabase is not configured in this build."); return; }
    setBusy("google"); setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${FLEXA_APP_URL}/` }
    });
    if (error) { setBusy(""); setAuthError(error.message || "Google sign-in could not start."); }
  }

  function loadTelegramLoginSdk() {
    if (window.Telegram?.Login) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-flexa-telegram-login-sdk="true"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("Telegram login library could not load.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-login.js?1";
      script.async = true;
      script.dataset.flexaTelegramLoginSdk = "true";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Telegram login library could not load."));
      document.head.appendChild(script);
    });
  }

  async function continueWithTelegram() {
    if (!supabase) { setAuthError("Supabase is not configured in this build."); return; }

    // Telegram Client IDs are public identifiers, so keep a source fallback for the production build.
    // The environment variable can still override this value in other deployments.
    const clientId = Number(import.meta.env.VITE_TELEGRAM_CLIENT_ID || 8897849997);
    if (!clientId) {
      setAuthError("Telegram login is not configured yet.");
      return;
    }

    setBusy("telegram");
    setAuthError("");

    try {
      // The SDK is preloaded in index.html so this call stays inside the user's click gesture.
      if (!window.Telegram?.Login?.auth) {
        throw new Error("Telegram login library is not ready. Please try again.");
      }

      window.Telegram.Login.auth(
        {
          client_id: clientId,
          scope: ["profile", "write"],
          lang: "en",
        },
        async (result) => {
          if (!result || result.error) {
            setBusy("");
            setAuthError(result?.error || "Telegram login was cancelled or failed.");
            return;
          }

          if (!result.id_token) {
            setBusy("");
            setAuthError("Telegram did not return a verified login token.");
            return;
          }

          try {
            const { data, error } = await supabase.functions.invoke("telegram-login", {
              body: { id_token: result.id_token },
            });
            if (error || data?.error) throw new Error(data?.error || error?.message || "Telegram login failed.");
            if (!data?.session?.access_token || !data?.session?.refresh_token) {
              throw new Error("Telegram login returned no session.");
            }

            const { error: sessionError } = await supabase.auth.setSession({
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
            });
            if (sessionError) throw sessionError;
          } catch (error) {
            setAuthError(error.message || "Telegram login failed.");
          } finally {
            setBusy("");
          }
        },
      );
    } catch (error) {
      setBusy("");
      setAuthError(error.message || "Telegram login could not start.");
    }
  }

  return <div className="auth-options">
    <button type="button" className="auth-provider google" onClick={continueWithGoogle} disabled={!!busy}>
      <span className="provider-mark google-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img" aria-label="Google">
          <path fill="#4285F4" d="M21.35 12.27c0-.72-.06-1.42-.18-2.09H12v3.95h5.24a4.48 4.48 0 0 1-1.94 2.94v2.44h3.14c1.84-1.69 2.91-4.18 2.91-7.24Z"/>
          <path fill="#34A853" d="M12 21.7c2.63 0 4.84-.87 6.45-2.36l-3.14-2.44c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.52A9.75 9.75 0 0 0 12 21.7Z"/>
          <path fill="#FBBC05" d="M6.54 13.79a5.87 5.87 0 0 1 0-3.58V7.69H3.3a9.75 9.75 0 0 0 0 8.62l3.24-2.52Z"/>
          <path fill="#EA4335" d="M12 6.18c1.43 0 2.72.49 3.73 1.46l2.8-2.8C16.84 3.2 14.63 2.3 12 2.3a9.75 9.75 0 0 0-8.7 5.39l3.24 2.52C7.31 7.9 9.46 6.18 12 6.18Z"/>
        </svg>
      </span>
      <span>{busy === "google" ? "Connecting Google…" : "Continue with Google"}</span><b>→</b>
    </button>

    <button className="auth-provider telegram" type="button" onClick={continueWithTelegram} disabled={!!busy}>
      <span className="provider-mark telegram-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img" aria-label="Telegram">
          <path fill="currentColor" d="M21.5 3.5 18.3 20c-.24 1.17-.88 1.46-1.78.91l-4.92-3.63-2.37 2.28c-.26.26-.48.48-.98.48l.35-5.02 9.14-8.26c.4-.35-.09-.55-.62-.2L5.81 13.9.98 12.38c-1.05-.33-1.07-1.05.22-1.56L20.1 3.03c.88-.33 1.65.2 1.4.47Z"/>
        </svg>
      </span>
      <span>{busy === "telegram" ? "Connecting Telegram…" : "Continue with Telegram"}</span><b>→</b>
    </button>

    {authError && <div className="error-banner">{authError}</div>}
  </div>;
}
function LandingStep({n,title,text}) { return <article className="landing-step"><span>{n}</span><strong>{title}</strong><p>{text}</p></article>; }
function LandingFeature({title,text}) { return <article className="landing-feature"><b>✦</b><strong>{title}</strong><p>{text}</p></article>; }

function LandingCard({ title, text }) { return <article className="landing-card"><span>✦</span><strong>{title}</strong><p>{text}</p></article>; }

function getBestPerformingPair(trades) {
  const settled = (trades || []).filter((trade) => ["won", "lost"].includes(trade.status));
  if (!settled.length) return null;
  const totals = settled.reduce((map, trade) => {
    const symbol = trade.asset || "Unknown";
    map[symbol] = (map[symbol] || 0) + (Number(trade.result_amount || 0) - Number(trade.stake || 0));
    return map;
  }, {});
  return Object.entries(totals).sort((a, b) => b[1] - a[1])[0] || null;
}

function Home({ account, loading, setPage, claimReward, rewardBusy, startAiScan, aiScanning, aiEngineActive }) {
  const active = account.trades.filter((trade) => trade.status === "active");
  const unread = account.notifications.filter((item) => !item.is_read).length;
  const opportunities = account.opportunities || [];
  const bestPair = getBestPerformingPair(account.trades);
  const usdtBalance = Number(account.wallets.find((item) => item.asset === "USDT")?.available_balance || 0);
  const reward = account.rewards?.find((r) => ["available", "active"].includes(r.status));
  const rewardRemaining = Number(reward?.remaining_reward || 0);
  const rewardProfit = Number(reward?.profit_withdrawable || 0);

  return <>
    <section className="balance-hero home-balance">
      <div>
        <small>AVAILABLE BALANCE</small>
        <strong>{usdtBalance.toLocaleString(undefined,{maximumFractionDigits:2})} <em>USDT</em></strong>
        <span className="balance-caption">
          {reward?.status === "active"
            ? `Your deposited wallet funds. Welcome bonus is shown separately below.`
            : "Your deposited wallet balance"}
        </span>
      </div>
      <div className="balance-actions">
        <button type="button" onClick={() => setPage("wallet")}>Wallet</button>
      </div>
    </section>

    {reward && <section className="home-reward-card">
      <div>
        <small>{reward.status === "active" ? "WELCOME CREDIT ACTIVE" : "YOUR $50 WELCOME CREDIT"}</small>
        <strong>${Number(reward.reward_amount || 50).toFixed(0)}</strong>
        <span>{reward.status === "active" ? `${rewardRemaining.toFixed(2)} credit remaining · profit can become eligible for withdrawal` : "Claim it here before you start trading."}</span>
      </div>
      {reward.status === "active"
        ? <button type="button" className="reward-active-button" onClick={() => setPage("trade")}>Trade with credit →</button>
        : <button type="button" onClick={claimReward} disabled={rewardBusy}>{rewardBusy ? "Claiming…" : "Claim $50 →"}</button>}
    </section>}

    <section className="ai-start-card">
      <div className="ai-start-copy">
        <small>FLEXA AI ENGINE</small>
        <h1>{aiEngineActive ? <>AI is <span>working.</span></> : <>Let AI find<br /><span>the opportunity.</span></>}</h1>
        <p>{aiEngineActive
          ? "Flexa AI is already active. You cannot start another scan while the current opportunity window is active."
          : "Start the AI trading center and Flexa will find the strongest qualifying market setup for you."}</p>
      </div>
      <button type="button" className={aiEngineActive ? "start-ai-button active" : "start-ai-button"} onClick={startAiScan} disabled={aiScanning || aiEngineActive}>
        <span>{aiScanning ? "Scanning…" : aiEngineActive ? "ENGINE ACTIVE" : "Start AI"}</span>
        <b>{aiScanning ? "◌" : aiEngineActive ? "●" : "→"}</b>
      </button>
      <div className="engine-status"><i /> {aiScanning ? "Analyzing market conditions…" : aiEngineActive ? "Engine active · monitoring opportunity" : "Engine ready"}</div>
    </section>

    <section className="home-insights">
      <article className="home-insight-card"><small>BEST PERFORMING PAIR</small><strong>{bestPair ? bestPair[0] : "—"}</strong><span>{bestPair ? `${bestPair[1] >= 0 ? "+" : ""}${bestPair[1].toFixed(2)} USDT realized` : "Complete a trade to see performance"}</span></article>
      <article className="home-insight-card"><small>ACTIVE TRADES</small><strong>{loading ? "…" : active.length}</strong><span>{unread ? `${unread} unread alert${unread === 1 ? "" : "s"}` : "No unread alerts"}</span></article>
    </section>

    <section className="home-opportunities">
      <div className="section-heading"><div><small>AI OPPORTUNITIES</small><h2>{opportunities.length ? "AI-selected trades" : "Waiting for AI"}</h2></div><button type="button" onClick={() => setPage("trade")}>Trading center →</button></div>
      {opportunities.length ? <div className="opportunity-list">{opportunities.slice(0,2).map((item) => <OpportunityCard key={item.id} item={item} setPage={setPage} />)}</div> : <div className="empty-state opportunity-empty"><strong>{loading ? "Preparing the AI feed" : "No AI trade is ready yet"}</strong><p>{loading ? "Flexa is loading the latest market state." : "Start the AI engine when you are ready. You will be shown the direction and stake before anything is confirmed."}</p></div>}
    </section>

    <section className="home-activity-head"><div><small>ACCOUNT ACTIVITY</small><h2>Recent activity</h2></div><button type="button" onClick={() => setPage("activity")}>View all →</button></section>
    <ActivityRows account={account} />
  </>;
}

function RewardBanner({ reward, onClaim, busy }) {
  const daysLeft = Math.max(0, Math.ceil((new Date(reward.expires_at) - Date.now()) / 86400000));
  const expired = new Date(reward.expires_at).getTime() <= Date.now();
  const claimed = reward.status === "active";
  const remaining = Number(reward.remaining_reward || 0);
  const withdrawable = Number(reward.profit_withdrawable || 0);
  return <section className="reward-banner"><div className="reward-glow" /><div className="reward-copy"><small>{claimed ? "REWARD CREDIT ACTIVE" : "WELCOME REWARD"}</small><strong>${Number(reward.reward_amount || 50).toFixed(0)} <span>TRADE CREDIT</span></strong><p>{expired ? "This welcome reward has expired." : claimed ? "$"+remaining.toFixed(2)+" credit remaining · $"+withdrawable.toFixed(2)+" eligible profit." : "Use within "+daysLeft+" days. The reward itself is non-withdrawable; eligible profit can be withdrawn before expiry."}</p></div>{claimed ? <div className="reward-state"><b>ACTIVE</b><span>{daysLeft}d left</span></div> : <button onClick={onClaim} disabled={busy || expired}>{expired ? "Expired" : busy ? "Claiming…" : "Claim reward →"}</button>}</section>;
}function Profile({ user, profile, signOut }) {
  const name=profile?.display_name||"Flexa AI user";
  const initials=name.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  const referral=profile?.referral_code||"—";
  return <div className="profile-page"><section className="profile-hero-card"><div className="profile-avatar">{initials}</div><div className="profile-identity"><small>FLEXA AI ACCOUNT</small><h1>{name}</h1><span>{profile?.telegram_username ? "@"+profile.telegram_username : user?.email || "Connected account"}</span></div><span className="verified-pill">● VERIFIED</span></section><section className="profile-section"><div className="profile-section-head"><div><small>ACCOUNT</small><h2>Account details</h2></div></div><div className="profile-row"><span>Identity</span><strong>{profile?.telegram_username ? "Telegram connected" : "Google connected"}</strong></div><div className="profile-row"><span>Security</span><strong>Protected by Supabase Auth</strong></div><div className="profile-row"><span>Trading access</span><strong>AI trading enabled</strong></div></section><section className="referral-card"><div><small>REFERRAL NETWORK</small><h2>Invite & earn</h2><p>Your referral code is ready. Rewards are credited when a referred user completes the qualifying activity.</p></div><div className="referral-code"><span>{referral}</span><button onClick={()=>navigator.clipboard?.writeText(referral)}>Copy</button></div></section><section className="profile-section"><div className="profile-section-head"><div><small>PREFERENCES</small><h2>Settings</h2></div></div><div className="profile-row"><span>Notifications</span><strong>App + Telegram</strong></div><div className="profile-row"><span>Market alerts</span><strong>Enabled</strong></div></section><button className="signout-button" onClick={signOut}>Sign out of Flexa AI</button></div>;
}function Wallet({ account, refreshAccount }) {
  const [modal, setModal] = useState("");
  const [walletInfo, setWalletInfo] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const reward=account.rewards?.find((r)=>["available","active"].includes(r.status));
  const usdt=account.wallets.find(w=>w.asset==="USDT");
  const total=Number(usdt?.available_balance||0)+Number(reward?.profit_withdrawable||0);

  async function openDeposit() {
    setNotice("");
    setModal("deposit");
    if (walletInfo) return;
    const { data, error } = await supabase.functions.invoke("wallet-info");
    if (error || data?.error) {
      setNotice(data?.error || error?.message || "Could not load deposit details.");
      return;
    }
    setWalletInfo(data);
  }

  async function submitWithdrawal(event) {
    event.preventDefault();
    setNotice("");
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setNotice("Enter a valid withdrawal amount.");
      return;
    }
    if (!address.trim()) {
      setNotice("Enter the destination wallet address.");
      return;
    }
    setBusy(true);
    try {
      const wallet = account.wallets.find((item) => item.asset === selectedAsset);
      const { data, error } = await supabase.functions.invoke("request-withdrawal", {
        body: {
          asset: selectedAsset,
          network: wallet?.network,
          amount: numericAmount,
          address: address.trim(),
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Withdrawal request failed.");
      setAmount("");
      setAddress("");
      setModal("");
      setNotice("Withdrawal request submitted. Your funds are now locked while the request is reviewed.");
      await refreshAccount();
    } catch (error) {
      setNotice(error.message || "Withdrawal request failed.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="wallet-page">
    <section className="wallet-hero"><div><small>PORTFOLIO VALUE</small><strong>${total.toLocaleString(undefined,{maximumFractionDigits:2})} <em>USDT</em></strong><span>Cash balance + eligible reward profit</span></div><div className="wallet-orbit">◎</div></section>
    <div className="wallet-actions">
      <button onClick={openDeposit}>＋ Deposit</button>
      <button className="secondary" onClick={()=>{setNotice("");setModal("withdraw");}}>↗ Withdraw</button>
    </div>
    {reward&&<section className="wallet-reward"><div><small>FLEXA WELCOME CREDIT</small><strong>${Number(reward.remaining_reward||0).toFixed(2)} <span>REMAINING</span></strong><p>{reward.status==="available"?"Claim it on Home to activate your trade credit.":"Trade credit is active. Profit generated from it becomes eligible wallet profit."}</p></div><span className="credit-pill">{reward.status.toUpperCase()}</span></section>}
    <section className="asset-section"><div className="section-heading"><div><small>ASSETS</small><h2>Your balances</h2></div></div><div className="asset-list">{account.wallets.map(wallet=><div className="asset-row" key={wallet.id}><div className="asset-icon">{wallet.asset==="USDT"?"₮":"T"}</div><div><strong>{wallet.asset}</strong><small>{wallet.network}</small></div><b>{Number(wallet.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:4})}</b></div>)}</div></section>
    <section className="asset-section"><div className="section-heading"><div><small>RECENT</small><h2>Wallet activity</h2></div></div><ActivityRows account={{...account,trades:[]}} /></section>
    {notice&&<div className="notice" role="status">{notice}</div>}
    {modal==="deposit"&&<div className="auth-modal-backdrop" onClick={()=>setModal("")}><div className="auth-modal" onClick={e=>e.stopPropagation()}>
      <button className="auth-close" onClick={()=>setModal("")} aria-label="Close">×</button>
      <div className="eyebrow">DEPOSIT</div><h2>Fund your wallet.</h2>
      <p>Send funds only on the network shown below. Deposits are credited after the transaction is verified.</p>
      <div className="wallet-network-list">
        {Object.entries(walletInfo?.deposit_addresses||{}).map(([asset, info])=><div className="wallet-address-card" key={asset}><strong>{asset}</strong><small>{info?.network || "Network"}</small><code>{info?.address || "Deposit address is being configured."}</code>{info?.address&&<button type="button" onClick={()=>navigator.clipboard?.writeText(info.address)}>Copy address</button>}</div>)}
        {!walletInfo && <div className="empty-state"><strong>Loading deposit details…</strong></div>}
        {walletInfo && !Object.keys(walletInfo.deposit_addresses||{}).length && <div className="empty-state"><strong>Deposit addresses are not configured yet.</strong><p>The wallet screen is working; an admin must add the receiving addresses before deposits can be credited.</p></div>}
      </div>
    </div></div>}
    {modal==="withdraw"&&<div className="auth-modal-backdrop" onClick={()=>setModal("")}><div className="auth-modal" onClick={e=>e.stopPropagation()}>
      <button className="auth-close" onClick={()=>setModal("")} aria-label="Close">×</button>
      <div className="eyebrow">WITHDRAW</div><h2>Send funds out.</h2><p>Withdrawal requests are processed server-side. Your balance is locked when the request is accepted.</p>
      <form onSubmit={submitWithdrawal} className="wallet-form">
        <label>Asset<select value={selectedAsset} onChange={e=>setSelectedAsset(e.target.value)}><option value="USDT">USDT</option><option value="TON">TON</option></select></label>
        <label>Amount<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" /></label>
        <label>Destination address<input value={address} onChange={e=>setAddress(e.target.value)} placeholder="Paste wallet address" autoComplete="off" /></label>
        <button className="landing-cta" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit withdrawal →"}</button>
      </form>
    </div></div>}
  </div>;
}
function OpportunityCard({ item, setPage }) {
  const score = Math.round(Number(item.signal_score || 0) * 100);
  const direction = item.direction === "down" ? "DOWN" : "UP";
  return <article className="opportunity-card ai-opportunity-card">
    <div className="ai-opportunity-label">FLEXA AI SELECTED</div>
    <div className="opp-top">
      <div><small>{item.symbol}</small><strong>AI trade suggestion</strong></div>
      <span className={direction === "UP" ? "green" : "red"}>{direction === "UP" ? "↗ UP" : "↘ DOWN"}</span>
    </div>
    <div className="ai-opportunity-direction">
      <span>AI expects the market to move</span>
      <strong className={direction === "UP" ? "green" : "red"}>{direction}</strong>
    </div>
    <div className="opp-meta"><span>{Math.round(item.duration_seconds / 60)} min</span><span>{score}% signal</span><span>{item.status.toUpperCase()}</span></div>
    <button onClick={() => setPage("trade")}>See my AI trade →</button>
  </article>;
}
function ActivityRows({ account }) {
  const items = [...account.trades.map((t) => ({date:t.opened_at,text:t.asset+" · "+t.direction.toUpperCase()+" · "+t.status,value:t.result_amount ?? t.potential_payout ?? t.stake})), ...account.transactions.map((t) => ({date:t.created_at,text:t.type.replace("_"," ")+" · "+t.status,value:t.amount}))].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8);
  if (!items.length) return <div className="empty-state"><strong>No activity yet</strong><p>Your trades and wallet transactions will appear here.</p></div>;
  return <div className="list">{items.map((item,index)=><div className="row" key={item.date+index}><span>{item.text}</span><strong className="green">{Number(item.value||0).toLocaleString(undefined,{maximumFractionDigits:4})}</strong></div>)}</div>;
}

function Trade({ account }) {
  const [amount,setAmount] = useState("25");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  const opportunity = account.opportunities?.find((item) => {
    if (!["scheduled","open"].includes(item.status)) return false;
    const end = new Date(item.entry_window_end || 0).getTime();
    const start = new Date(item.entry_window_start || 0).getTime();
    const now = Date.now();
    return Number.isFinite(end) && end > now && Number.isFinite(start) && start <= now;
  }) || null;
  const dir = opportunity?.direction === "down" ? "DOWN" : "UP";
  const duration = opportunity ? String(Math.round(opportunity.duration_seconds / 60)) : "60";
  const usdt = account.wallets.find((item) => item.asset === "USDT");
  const reward = account.rewards?.find((item) => item.status === "active");
  const walletBalance = Number(usdt?.available_balance || 0);
  const bonusBalance = Number(reward?.remaining_reward || 0);
  const rewardProfit = Number(reward?.profit_withdrawable || 0);
  const numericAmount = Number(amount);
  const tradingFunds = walletBalance + bonusBalance;
  const canTrade = Boolean(account.tradingAccess?.has_access) && tradingFunds >= numericAmount;

  function updateAmount(value) {
    if (value === "" || /^\d*(\.\d{0,2})?$/.test(value)) setAmount(value);
  }

  async function confirmTrade() {
    if (!supabase || busy || !opportunity || !canTrade || numericAmount <= 0) return;
    setBusy(true);
    setNotice("");
    try {
      const { data, error } = await supabase.functions.invoke("execute-trade", {
        body: { opportunity_id: opportunity.id, stake: numericAmount }
      });
      if (error) {
        let message = error.message || "The trade could not be started.";
        try {
          const payload = await error.context?.json?.();
          message = payload?.error || payload?.message || message;
        } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      setNotice(`Trade started: ${dir} ${numericAmount.toFixed(2)} USDT for ${duration} minutes.`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      // Refresh the ledger so the user immediately sees the new active trade and
      // the updated available balance.
      window.dispatchEvent(new CustomEvent("flexa-trade-started"));
    } catch (error) {
      setNotice(error.message || "The trade could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section className="intro">
      <small>AI TRADE CENTER</small>
      <h1>{opportunity ? "Your trade is ready." : "Waiting for the next AI trade."}</h1>
      <p>{opportunity ? "You do not need to choose the market direction. Flexa AI has already selected the direction for this opportunity." : "Flexa AI will show you the direction, duration and stake before you confirm a trade."}</p>
    </section>

    {opportunity ? <section className={dir === "UP" ? "ai-trade-decision up" : "ai-trade-decision down"}>
      <div className="ai-decision-head"><div><small>FLEXA AI DECISION</small><strong>{opportunity.symbol}</strong></div><span>● READY</span></div>
      <div className="ai-direction-block"><small>THE AI SAYS</small><strong>{dir === "UP" ? "↗ UP" : "↘ DOWN"}</strong><p>Flexa AI expects this market to move <b>{dir}</b> during the selected {duration}-minute window.</p></div>
      <div className="ai-decision-grid">
        <div><small>ENTRY PRICE</small><strong>{opportunity.entry_price ? Number(opportunity.entry_price).toLocaleString(undefined,{maximumFractionDigits:6}) : "—"}</strong></div>
        <div><small>DURATION</small><strong>{duration} min</strong></div>
        <div><small>SIGNAL</small><strong>{Math.round(Number(opportunity.signal_score || 0) * 100)}%</strong></div>
      </div>
      <div className="ai-no-choice">Direction is selected by Flexa AI. Your only choice here is how much you want to stake.</div>
    </section> : null}

    <section className="trade-market">
      <div className="market-head"><div><small>{opportunity?.symbol || account.markets?.[0]?.display_symbol || "MARKET"}</small><strong>{opportunity?.entry_price ? Number(opportunity.entry_price).toLocaleString(undefined,{maximumFractionDigits:6}) : "—"}</strong><span className={dir === "UP" ? "green" : "red"}>{opportunity ? dir : "SCANNING"}</span></div><span className="live-badge">● LIVE MARKET</span></div>
      <Chart /><div className="chart-selector"><span className="active">1m</span><span>5m</span><span>15m</span><span>1h</span></div>
    </section>

    <section className="card trade-ticket">
      <div className="trade-balance">
        <span>TRADING FUNDS</span>
        <strong>{tradingFunds.toLocaleString(undefined,{maximumFractionDigits:4})} USDT</strong>
        <small>Wallet {walletBalance.toFixed(2)} USDT · Welcome bonus {bonusBalance.toFixed(2)} USDT</small>
      </div>
      <div className="trade-funds-breakdown">
        <div><span>MAIN BALANCE</span><strong>{walletBalance.toFixed(2)} USDT</strong><small>Deposited funds</small></div>
        <div><span>WELCOME BONUS</span><strong>{bonusBalance.toFixed(2)} USDT</strong><small>Non-withdrawable bonus</small></div>
        {rewardProfit > 0 && <div><span>ELIGIBLE PROFIT</span><strong>{rewardProfit.toFixed(2)} USDT</strong><small>Reward profit available</small></div>}
      </div>
      <div className="stake-heading"><div><small>YOUR STAKE</small><strong>How much do you want to use?</strong></div><span>USDT</span></div>
      <div className="stake-presets">{["10","25","50","100"].map((v)=><button type="button" key={v} className={amount===v ? "selected" : "choice"} onClick={()=>setAmount(v)} disabled={busy}>${v}</button>)}</div>
      <label className="custom-amount-label">Or enter your own amount</label>
      <div className="amount-input-wrap"><span>$</span><input inputMode="decimal" value={amount} onChange={e=>updateAmount(e.target.value)} placeholder="0.00" aria-label="Custom trade amount" disabled={busy} /></div>
      <div className="trade-summary"><span>YOUR TRADE</span><strong><b className={dir === "UP" ? "green" : "red"}>{dir === "UP" ? "↗ UP" : "↘ DOWN"}</b> · {duration} min · ${amount || "0"}</strong></div>
      <button className="full trade-confirm-button" disabled={busy || !canTrade || !opportunity || numericAmount <= 0} onClick={confirmTrade}>
        {busy ? "Starting trade…" : opportunity ? `Confirm ${dir} trade →` : "Waiting for AI opportunity…"}
      </button>
      {notice&&<div className="notice" role="status">{notice}</div>}
      {!account.tradingAccess?.has_access&&<div className="subscription-lock"><b>Your trading access has ended.</b><span>Choose a Flexa Pro plan to continue using the trading engine.</span><button className="secondary" onClick={()=>setNotice("Subscription checkout is not connected yet.")}>View plans</button></div>}
      {!usdt&&<p className="helper">Connect Telegram to initialize your wallet.</p>}
      {usdt&&account.tradingAccess?.has_access&&!canTrade&&numericAmount>0&&<p className="helper">Your stake is higher than your combined trading funds. Your main balance and welcome bonus remain separate.</p>}
      <p className="demo-note">The AI direction, duration and your stake are shown again before confirmation.</p>
    </section>
  </>;
}

function Chart() {
  // Lightweight SVG chart so the landing/trading UI never depends on a missing chart library.
  // Replace the data points with live market candles when the market-data service is connected.
  const points = "0,122 34,116 68,126 102,92 136,100 170,78 204,88 238,61 272,72 306,48 340,56 374,31 408,42 442,20";
  return <div className="chart-wrap" aria-label="Market price chart">
    <svg viewBox="0 0 442 150" preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(124,255,156,.24)" />
          <stop offset="100%" stopColor="rgba(124,255,156,0)" />
        </linearGradient>
      </defs>
      <path d={`M 0 122 L 34 116 L 68 126 L 102 92 L 136 100 L 170 78 L 204 88 L 238 61 L 272 72 L 306 48 L 340 56 L 374 31 L 408 42 L 442 20 L 442 150 L 0 150 Z`} fill="url(#chartFill)" />
      <polyline points={points} fill="none" stroke="#7cff9c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="0" y1="128" x2="442" y2="128" stroke="rgba(124,255,156,.08)" />
      <line x1="0" y1="82" x2="442" y2="82" stroke="rgba(124,255,156,.08)" />
      <line x1="0" y1="36" x2="442" y2="36" stroke="rgba(124,255,156,.08)" />
    </svg>
  </div>;
}


function Activity({ account }) {
  const trades=account.trades||[];
  const wins=trades.filter(t=>t.status==="won").length;
  const losses=trades.filter(t=>t.status==="lost").length;
  const profit=trades.reduce((sum,t)=>sum+Number(t.result_amount||0)-Number(t.stake||0),0);
  return <div className="activity-page"><section className="intro"><small>ACTIVITY CENTER</small><h1>Everything that happened.</h1><p>Your trade outcomes and wallet events are kept together so you can follow every change to your account.</p></section><section className="activity-stats"><div><small>TRADES</small><strong>{trades.length}</strong></div><div><small>WINS</small><strong>{wins}</strong></div><div><small>LOSSES</small><strong>{losses}</strong></div><div><small>NET</small><strong className={profit>=0?"green":"red"}>{profit>=0?"+":""}{profit.toFixed(2)}</strong></div></section><section className="activity-section"><div className="section-heading"><div><small>TRADE HISTORY</small><h2>Recent trades</h2></div></div>{trades.length?<div className="timeline">{trades.map(t=><div className="timeline-row" key={t.id}><div className="timeline-dot" /><div className="timeline-main"><div><strong>{t.asset}</strong><span className={t.direction==="up"?"green":"red"}>{t.direction.toUpperCase()}</span></div><small>{new Date(t.opened_at).toLocaleString()} · {Math.round(Number(t.duration_seconds||0)/60)} min</small></div><div className="timeline-value"><strong className={t.status==="won"?"green":t.status==="lost"?"red":""}>{t.status==="won"?"+":""}{Number(t.result_amount??t.potential_payout??t.stake).toFixed(2)}</strong><small>{t.status.toUpperCase()}</small></div></div>)}</div>:<div className="empty-state"><strong>No trades yet</strong><p>Your AI trade history will appear here.</p></div>}</section><section className="activity-section"><div className="section-heading"><div><small>WALLET LEDGER</small><h2>Recent transactions</h2></div></div><ActivityRows account={{...account,trades:[]}} /></section></div>;

}
