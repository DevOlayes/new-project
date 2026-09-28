import { Component, useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { getTelegramWebApp, isTelegramMiniApp } from "./lib/telegram";
import { getAccountData } from "./lib/data";

const nav = [["home","⌂","Home"],["trade","✦","AI Trade"],["activity","◷","Activity"],["wallet","▣","Wallet"],["profile","◉","Profile"]];

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
  const [installNotice, setInstallNotice] = useState(false);
  const [notificationPrompt, setNotificationPrompt] = useState(false);
  const [notificationAsked, setNotificationAsked] = useState(false);
  const [assetPrices, setAssetPrices] = useState({USDT:1,TON:1.41,BTC:83928.34,SOL:119.79,BNB:770.09});
  const [rewardBusy, setRewardBusy] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [aiEngineActive, setAiEngineActive] = useState(() => {
    try { return sessionStorage.getItem("flexa_ai_engine_active") === "true"; } catch { return false; }
  });
  const [globalNotice, setGlobalNotice] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [tradeSuccess, setTradeSuccess] = useState(null);

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
    const dayKey = new Date().toISOString().slice(0,10);
    const installed = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone;
    if (!installed && installPrompt === null) {
      try {
        if (localStorage.getItem("flexar_install_dismissed") !== dayKey) setInstallNotice(true);
      } catch {}
    }
    const timer = window.setTimeout(() => {
      try {
        if (!notificationAsked && localStorage.getItem("flexar_notification_dismissed") !== dayKey) setNotificationPrompt(true);
      } catch {}
    }, 45000);
    return () => window.clearTimeout(timer);
  }, [installPrompt, notificationAsked]);

  useEffect(() => {
    let cancelled=false;
    const loadAssetPrices=async()=>{
      try{
        const response=await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cthe-open-network%2Csolana%2Cbinancecoin&vs_currencies=usd");
        if(!response.ok) return;
        const data=await response.json();
        if(!cancelled) setAssetPrices({
          USDT:1,
          BTC:Number(data?.bitcoin?.usd||0),
          TON:Number(data?.["the-open-network"]?.usd||0),
          SOL:Number(data?.solana?.usd||0),
          BNB:Number(data?.binancecoin?.usd||0)
        });
      }catch{}
    };
    loadAssetPrices();
    const timer=window.setInterval(loadAssetPrices,60000);
    return()=>{cancelled=true;window.clearInterval(timer);};
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
            setAuthError(sessionError.message || "Could not establish your FLEXAR AI session.");
            setLoading(false);
          } else {
            setAuthError("");
          }
        }
      } else {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;
        if (error) {
          setAuthError(error.message || "Could not restore your FLEXAR AI session.");
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
      setAuthError(error.message || "Could not load your FLEXAR AI account.");
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
        setGlobalNotice("FLEXAR AI is scanning, but there is no fresh high-quality opportunity right now. Try again when the next signal is ready.");
        setPage("trade");
        return;
      }

      try { sessionStorage.setItem("flexa_open_ai_trade", "true"); } catch {}
      setPage("trade");
      setGlobalNotice("FLEXAR AI is active. Your AI-selected opportunity is ready.");
    } catch(error) {
      // If the backend rejected the start, release the lock so the user can retry.
      setAiEngineActive(false);
      try { sessionStorage.removeItem("flexa_ai_engine_active"); } catch {}
      setGlobalNotice(error.message || "The AI engine could not start.");
    } finally {
      setAiScanning(false);
    }
  }

  async function installFLEXAR() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  useEffect(() => {
    const handleTradeStarted = async (event) => {
      await refreshAccount();
      setTradeSuccess(event.detail || null);
    };
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
  if (!inMiniApp && !user) return <Landing market={market} showAuth={showAuth} setShowAuth={setShowAuth} installPrompt={installPrompt} installFLEXAR={installFLEXAR} />;
  if (!user && loading) return <div className="loading-screen"><img className="loader-logo" src="/flexa-symbol.webp" alt="FLEXAR AI" /><strong>Connecting your FLEXAR AI account…</strong><span>Loading your account data…</span></div>;
  if (!user) return <div className="auth-screen"><div className="auth-card"><div className="brand"><img className="brand-symbol" src="/flexa-symbol.webp" alt="FLEXAR AI" /><div><strong>FLEXAR AI</strong><small>AI TRADES</small></div></div><h1>Connect your Telegram account</h1><p>Open FLEXAR AI from the Telegram Mini App so Telegram can securely identify your account.</p>{authError && <div className="error-banner">{authError}</div>}<span className="auth-hint">No separate password is required.</span></div></div>;

  const notifications = account.notifications || [];
  const unreadNotifications = notifications.filter((item) => !item.is_read).length;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img className="brand-symbol" src="/flexa-symbol.webp" alt="FLEXAR AI" /><div><strong>FLEXAR AI</strong><small>AI Trades</small></div></div><button type="button" className="icon-button notification-button" onClick={() => setShowNotifications(true)} aria-label="Open notifications"><span className="bell-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></span>{unreadNotifications > 0 && <b className="notification-dot">{unreadNotifications > 9 ? "9+" : unreadNotifications}</b>}</button></header>
    <main className="content">
      {authError && <div className="error-banner">{authError}</div>}
      <AppErrorBoundary page={page}>
        <div key={page} className="page-transition" aria-live="polite">
          {page === "home" && <Home account={account} loading={loading} setPage={setPage} claimReward={claimReward} rewardBusy={rewardBusy} startAiScan={startAiScan} aiScanning={aiScanning} aiEngineActive={aiEngineActive} />}
          {page === "trade" && <Trade account={account} startAiScan={startAiScan} aiScanning={aiScanning} aiEngineActive={aiEngineActive} />}
          {page === "activity" && <Activity account={account} />}
          {page === "wallet" && <Wallet account={account} refreshAccount={refreshAccount} assetPrices={assetPrices} setPage={setPage} />}
          {page === "profile" && <Profile user={user} profile={profile} signOut={signOut} />}
        </div>
      </AppErrorBoundary>
    </main>
    <nav className="bottom-nav" aria-label="Primary navigation">{nav.map(([id, icon, label]) => <button type="button" key={id} className={page === id ? "nav active" : "nav"} onClick={() => setPage(id)}><span>{icon}</span><small>{label}</small></button>)}{profile?.is_admin&&<button type="button" className={page==="admin"?"nav active":"nav"} onClick={()=>setPage("admin")}><span>◆</span><small>Admin</small></button>}</nav>
    {showNotifications && <NotificationPanel notifications={notifications} onClose={() => setShowNotifications(false)} />}
    {tradeSuccess && <TradeSuccessModal trade={tradeSuccess} onClose={() => setTradeSuccess(null)} onViewActive={() => { setTradeSuccess(null); setPage("activity"); }} />}
  </div>;
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unexpected page error." };
  }

  componentDidCatch(error) {
    console.error("FLEXAR page error:", error);
  }

  render() {
    if (this.state.hasError) {
      return <section className="empty-state page-error-state">
        <strong>This page hit an unexpected error.</strong>
        <p>The rest of FLEXAR is still protected. Reload this page to try again.</p>
        <small>{this.state.message}</small>
        <button type="button" className="landing-cta" onClick={() => window.location.reload()}>Reload FLEXAR →</button>
      </section>;
    }
    return this.props.children;
  }
}

function TradeSuccessModal({ trade, onClose, onViewActive }) {
  const direction = trade.direction === "down" ? "DOWN" : "UP";
  return <div className="trade-success-backdrop" onClick={onClose}>
    <section className="trade-success-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="trade-success-title">
      <div className="trade-success-icon">✓</div>
      <small className="trade-success-eyebrow">TRADE CONFIRMED</small>
      <h2 id="trade-success-title">Your trade is active.</h2>
      <p>Your trade was placed successfully and is now being tracked by FLEXAR AI.</p>
      <div className="trade-success-details">
        <div><span>MARKET</span><strong>{trade.symbol || "—"}</strong></div>
        <div><span>DIRECTION</span><strong className={direction === "UP" ? "green" : "red"}>{direction === "UP" ? "↗ UP" : "↘ DOWN"}</strong></div>
        <div><span>STAKE</span><strong>$ {Number(trade.stake || 0).toFixed(2)} USDT</strong></div>
        <div><span>DURATION</span><strong>{trade.duration || "—"} min</strong></div>
      </div>
      <button type="button" className="trade-success-primary" onClick={onViewActive}>View active trade →</button>
      <button type="button" className="trade-success-secondary" onClick={onClose}>Continue trading</button>
    </section>
  </div>;
}
function NotificationPanel({ notifications, onClose }) {
  return <div className="notification-backdrop" onClick={onClose}>
    <aside className="notification-panel" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Notifications">
      <div className="notification-panel-head"><div><small>FLEXA AI</small><h2>Notifications</h2></div><button type="button" className="auth-close" onClick={onClose} aria-label="Close notifications">×</button></div>
      <div className="notification-list">
        {notifications.length ? notifications.slice(0, 20).map((item) => <article className={item.is_read ? "notification-item" : "notification-item unread"} key={item.id || item.created_at}>
          <span className="notification-mark">•</span><div><strong>{item.title || item.type || "Account update"}</strong><p>{item.message || item.body || "You have a new FLEXAR AI update."}</p><small>{item.created_at ? new Date(item.created_at).toLocaleString() : "Just now"}</small></div>
        </article>) : <div className="empty-state"><strong>No notifications yet</strong><p>Important account and trading updates will appear here.</p></div>}
      </div>
    </aside>
  </div>;
}

function Landing({ market, showAuth, setShowAuth, installPrompt, installFLEXAR }) {
  const price = market?.price;
  const change = market?.change;
  return <div className="landing"><div className="landing-orb orb-one" /><div className="landing-orb orb-two" />
    <header className="landing-topbar"><img className="landing-wordmark" src="/flexa-wordmark.svg" alt="FLEXAR AI" /><span className="live-chip">● WEB PLATFORM</span></header>
    <main className="landing-content">
      <section className="landing-hero"><div className="eyebrow">AI-POWERED MARKET OPPORTUNITIES</div><h1>Let the AI find<br /><span>the trade.</span></h1><p>FLEXAR AI continuously studies market conditions and surfaces simplified trading opportunities, so you do not need to understand complex charts before every trade.</p><div className="landing-actions"><button className="landing-cta" onClick={() => setShowAuth(true)}>Get started <b>→</b></button>{installPrompt && <button className="install-cta" onClick={installFLEXAR}>Install FLEXAR AI</button>}<div className="landing-trust">Free account · Google or Telegram · No FLEXAR AI password</div><span className="hero-status"><i /> Market data connected</span></div></section>
      <section className="landing-terminal"><div className="terminal-top"><div><small>LIVE MARKET</small><strong>BTC / USDT</strong></div><span className={change >= 0 ? "green" : "red"}>{change == null ? "—" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}</span></div><Chart /><div className="terminal-bottom"><strong>{price == null ? "Loading…" : "$" + price.toLocaleString(undefined,{maximumFractionDigits:2})}</strong><span>PUBLIC MARKET DATA</span></div><div className="floating-card float-card-a">AI OPPORTUNITY <b>SCANNING</b></div><div className="floating-card float-card-b">NEXT WINDOW <b>60 MIN</b></div></section>
      <section className="welcome-campaign"><div><span className="eyebrow">NEW USER CAMPAIGN</span><h2>Claim your <b>$50</b> welcome reward.</h2><p>Use the reward to trade. The reward itself cannot be withdrawn; only eligible profit generated from it can be withdrawn before the 12-day deadline.</p></div><span className="campaign-badge">12 DAYS</span></section><section className="opportunity-preview"><div><div className="eyebrow">AI OPPORTUNITY FEED</div><h2>Users do not hunt for trades. FLEXAR AI finds them.</h2></div><div className="opportunity-demo"><div><span>BTC / USDT</span><strong>AI opportunity detected</strong></div><b>UP ↗</b><small>60 MIN · REVIEW READY</small></div></section>
      <section className="landing-section"><div className="eyebrow">HOW FLEXAR WORKS</div><h2>Simple on the surface. Intelligent underneath.</h2><div className="landing-steps"><LandingStep n="01" title="Scan" text="Market data is continuously collected and analyzed across supported markets."/><LandingStep n="02" title="Select" text="The engine filters signals and turns stronger setups into user-friendly opportunities."/><LandingStep n="03" title="Trade" text="You review the opportunity, choose your stake and confirm when ready." /></div></section>
      <section className="landing-section"><div className="feature-row"><LandingFeature title="AI-first trading" text="The system does the heavy market analysis before presenting an opportunity."/><LandingFeature title="Real market data" text="Charts and future signals are designed around real market pricing, not invented demo prices."/><LandingFeature title="Transparent activity" text="Trades, balances and wallet events remain connected to your account ledger." /></div></section>
    </main>{showAuth && <AuthModal onClose={() => setShowAuth(false)} />}</div>;
}
function AuthModal({ onClose }) {
  const [mode, setMode] = useState("signup");
  const [error, setError] = useState("");
  return <div className="auth-modal-backdrop" onClick={onClose}><div className="auth-modal" onClick={(event) => event.stopPropagation()}><button className="auth-close" onClick={onClose} aria-label="Close">×</button><img className="auth-modal-icon" src="/flexa-symbol.webp" alt="FLEXAR AI" /><div className="eyebrow">WELCOME TO FLEXA AI</div><h2>{mode === "signup" ? "Start in seconds." : "Welcome back."}</h2><p>{mode === "signup" ? "Create your FLEXAR AI account with Google or Telegram." : "Sign in with the same account you used before."}</p><AuthOptions setAuthError={setError} authError={error} /><button className="auth-mode-toggle" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Already have an account? Sign in" : "New to FLEXAR AI? Create an account"}</button><small className="auth-legal">By continuing, you agree to use FLEXAR AI responsibly and follow applicable terms.</small></div></div>;
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
  const rewardOriginal = Number(reward?.reward_amount || 50);
  const rewardUsed = Math.max(0, rewardOriginal - rewardRemaining);
  const rewardProfit = Number(reward?.profit_withdrawable || 0);
  const activeTrade = active[0];
  const activeMarket = activeTrade?.metadata?.market_symbol || activeTrade?.asset || "—";
  const activeDirection = String(activeTrade?.direction || "").toUpperCase();
  const activeCloses = activeTrade?.closes_at ? new Date(activeTrade.closes_at) : null;
  const activeMinutes = activeCloses ? Math.max(0, Math.ceil((activeCloses.getTime() - Date.now()) / 60000)) : 0;
  const bonusUsedPct = rewardOriginal ? Math.min(100, (rewardUsed / rewardOriginal) * 100) : 0;

  return <div className="flexar-home">
    <section className="flexar-home-hero">
      <div className="flexar-home-identity">
        <small>FLEXAR AI · INTELLIGENCE TERMINAL</small>
        <h1>Your capital.<br /><span>AI in control.</span></h1>
        <p>One place to monitor your wallet, discover high-conviction opportunities and decide how FLEXAR AI should execute them.</p>
      </div>
      <div className="flexar-balance-orbit">
        <small>AVAILABLE BALANCE</small>
        <strong>{usdtBalance.toLocaleString(undefined,{maximumFractionDigits:2})}</strong>
        <span>USDT</span>
        <i>{active.length ? active.length + " active trade" + (active.length > 1 ? "s" : "") : "No active trades"}</i>
      </div>
    </section>

    <section className="flexar-home-actions">
      <button className="primary" type="button" onClick={() => setPage("trade")}><span>↗</span><b>AI Trade</b><small>Find a setup</small></button>
      <button type="button" onClick={() => setPage("wallet")}><span>＋</span><b>Deposit</b><small>Fund wallet</small></button>
      <button type="button" onClick={() => setPage("wallet")}><span>↗</span><b>Withdraw</b><small>Move funds</small></button>
      <button type="button" onClick={() => setPage("activity")}><span>◷</span><b>History</b><small>Track results</small></button>
    </section>

    {reward && <section className="flexar-bonus-panel">
      <div className="bonus-main">
        <div className="bonus-badge">BONUS</div>
        <div>
          <small>{reward.status === "active" ? "WELCOME CREDIT · ACTIVE" : "WELCOME CREDIT · READY"}</small>
          <h2>&#36;{rewardRemaining.toFixed(2)} <em>remaining</em></h2>
          <p>{reward.status === "active"
            ? "You have used $" + rewardUsed.toFixed(2) + " of your $" + rewardOriginal.toFixed(2) + " trading credit."
            : "Claim your $" + rewardOriginal.toFixed(2) + " trading credit before it expires."}</p>
        </div>
      </div>
      <div className="bonus-progress">
        <div className="bonus-progress-head"><span>Credit used</span><b>{bonusUsedPct.toFixed(0)}%</b></div>
        <div className="bonus-track"><span style={{width: bonusUsedPct + "%"}} /></div>
        <div className="bonus-values"><span>&#36;{rewardUsed.toFixed(2)} used</span><span>&#36;{rewardOriginal.toFixed(2)} issued</span></div>
      </div>
      <div className="bonus-profit">
        <small>PROFIT MOVED TO WALLET</small>
        <strong>&#36;{rewardProfit.toFixed(2)}</strong>
        <span>{reward.status === "active" ? "Bonus principal cannot be reused once spent." : "Claim to activate."}</span>
      </div>
      {reward.status === "active"
        ? <button className="bonus-action" type="button" onClick={() => setPage("trade")}>Use remaining →</button>
        : <button className="bonus-action" type="button" onClick={claimReward} disabled={rewardBusy}>{rewardBusy ? "Claiming…" : "Claim bonus →"}</button>}
    </section>}

    <section className="flexar-home-grid">
      <div className="flexar-ai-pulse">
        <div className="home-section-head">
          <div><small>FLEXAR AI ENGINE</small><h2>{aiEngineActive ? "Machine is watching." : "Let the machine find the trade."}</h2></div>
          <span className={aiEngineActive ? "live" : ""}><i /> {aiEngineActive ? "LIVE" : "READY"}</span>
        </div>
        <div className="ai-pulse-body">
          <div className="pulse-ring"><span>AI</span></div>
          <div className="pulse-copy">
            <strong>{aiScanning ? "Scanning markets…" : aiEngineActive ? "Monitoring the active opportunity window" : opportunities.length ? "A signal is waiting for your approval" : "Start the engine when you want a fresh signal"}</strong>
            <p>{aiEngineActive ? "FLEXAR evaluates crypto, forex and supported market feeds before presenting a trade. Nothing is executed without your configured permission." : "The engine looks for selective setups instead of flooding you with trade ideas."}</p>
            <button type="button" onClick={() => setPage("trade")}>Open AI Trade →</button>
          </div>
        </div>
        <div className="ai-pulse-metrics"><span><b>24/7</b> market watch</span><span><b>1</b> strongest signal</span><span><b>AI</b> risk controls</span></div>
      </div>

      <aside className="flexar-home-side">
        <div className="home-side-card">
          <small>PORTFOLIO SIGNAL</small>
          <strong>{bestPair ? bestPair[0] : "—"}</strong>
          <span>{bestPair ? (bestPair[1] >= 0 ? "+" : "") + bestPair[1].toFixed(2) + " USDT realized" : "Complete a trade to build your performance view."}</span>
        </div>
        <div className="home-side-card">
          <small>ACTIVE TRADES</small>
          <strong>{loading ? "…" : active.length}</strong>
          <span>{activeTrade ? activeMarket + " · " + activeDirection + " · " + activeMinutes + "m remaining" : unread ? unread + " unread alert" + (unread === 1 ? "" : "s") : "Your account is clear."}</span>
        </div>
      </aside>
    </section>

    {activeTrade && <section className="flexar-active-strip">
      <div className="active-symbol"><span>{activeMarket.slice(0,1)}</span><div><small>ACTIVE POSITION</small><strong>{activeMarket}</strong></div></div>
      <div><small>DIRECTION</small><b className={activeDirection === "UP" ? "up" : "down"}>{activeDirection}</b></div>
      <div><small>STAKE</small><b>&#36;{Number(activeTrade.stake || 0).toFixed(2)}</b></div>
      <div><small>STATUS</small><b>MONITORING</b></div>
      <button type="button" onClick={() => setPage("activity")}>View trade →</button>
    </section>}

    <section className="flexar-opportunity-panel">
      <div className="home-section-head">
        <div><small>AI OPPORTUNITY FEED</small><h2>{opportunities.length ? "A signal is ready." : "Waiting for the next setup."}</h2></div>
        <button type="button" onClick={() => setPage("trade")}>AI Trade →</button>
      </div>
      {opportunities.length
        ? <div className="opportunity-list">{opportunities.slice(0,1).map(item => <OpportunityCard key={item.id} item={item} setPage={setPage} />)}</div>
        : <div className="flexar-opportunity-empty"><div>◎</div><p>{loading ? "Loading the latest market intelligence…" : "No qualifying opportunity is currently available. FLEXAR will surface one when the engine finds the right conditions."}</p></div>}
    </section>

    <section className="flexar-home-footer-grid">
      <div><small>ACCOUNT ACTIVITY</small><h2>Recent movement</h2><ActivityRows account={account} /></div>
      <div className="flexar-home-note"><small>HOW FLEXAR WORKS</small><h2>Signal first.<br />Execution second.</h2><p>FLEXAR AI studies the market, surfaces the setup early, then lets you choose the execution route: native FLEXAR trading, connected MT5, or a signal you copy elsewhere.</p><button type="button" onClick={() => setPage("trade")}>Explore AI Trade →</button></div>
    </section>
  </div>;
}

function RewardBanner({ reward, onClaim, busy }) {
  const daysLeft = Math.max(0, Math.ceil((new Date(reward.expires_at) - Date.now()) / 86400000));
  const expired = new Date(reward.expires_at).getTime() <= Date.now();
  const claimed = reward.status === "active";
  const remaining = Number(reward.remaining_reward || 0);
  const withdrawable = Number(reward.profit_withdrawable || 0);
  return <section className="reward-banner"><div className="reward-glow" /><div className="reward-copy"><small>{claimed ? "REWARD CREDIT ACTIVE" : "WELCOME REWARD"}</small><strong>${Number(reward.reward_amount || 50).toFixed(0)} <span>TRADE CREDIT</span></strong><p>{expired ? "This welcome reward has expired." : claimed ? "$"+remaining.toFixed(2)+" credit remaining · $"+withdrawable.toFixed(2)+" eligible profit." : "Use within "+daysLeft+" days. The reward itself is non-withdrawable; eligible profit can be withdrawn before expiry."}</p></div>{claimed ? <div className="reward-state"><b>ACTIVE</b><span>{daysLeft}d left</span></div> : <button onClick={onClaim} disabled={busy || expired}>{expired ? "Expired" : busy ? "Claiming…" : "Claim reward →"}</button>}</section>;
}function Profile({ user, profile, signOut }) {
  const name=profile?.display_name||"FLEXAR AI user";
  const initials=name.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  const referral=profile?.referral_code||"—";
  return <div className="profile-page"><section className="profile-hero-card"><div className="profile-avatar">{initials}</div><div className="profile-identity"><small>FLEXA AI ACCOUNT</small><h1>{name}</h1><span>{profile?.telegram_username ? "@"+profile.telegram_username : user?.email || "Connected account"}</span></div><span className="verified-pill">● VERIFIED</span></section><section className="profile-section"><div className="profile-section-head"><div><small>ACCOUNT</small><h2>Account details</h2></div></div><div className="profile-row"><span>Identity</span><strong>{profile?.telegram_username ? "Telegram connected" : "Google connected"}</strong></div><div className="profile-row"><span>Security</span><strong>Protected by Supabase Auth</strong></div><div className="profile-row"><span>Trading access</span><strong>AI trading enabled</strong></div></section><section className="referral-card"><div><small>REFERRAL NETWORK</small><h2>Invite & earn</h2><p>Your referral code is ready. Rewards are credited when a referred user completes the qualifying activity.</p></div><div className="referral-code"><span>{referral}</span><button onClick={()=>navigator.clipboard?.writeText(referral)}>Copy</button></div></section><section className="profile-section"><div className="profile-section-head"><div><small>PREFERENCES</small><h2>Settings</h2></div></div><div className="profile-row"><span>Notifications</span><strong>App + Telegram</strong></div><div className="profile-row"><span>Market alerts</span><strong>Enabled</strong></div></section><button className="signout-button" onClick={signOut}>Sign out of FLEXAR AI</button></div>;
}function Wallet({ account, refreshAccount, assetPrices = {}, setPage }) {
  const [modal, setModal] = useState("");
  const [walletInfo, setWalletInfo] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState("USDT");
  const [swapFrom, setSwapFrom] = useState("USDT");
  const [swapTo, setSwapTo] = useState("BTC");
  const [swapAmount, setSwapAmount] = useState("");
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [swapBusy, setSwapBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const reward=account.rewards?.find((r)=>["available","active"].includes(r.status) && Number(r.remaining_reward||0)>0);
  const supported=[
    {asset:"BTC",label:"Bitcoin",symbol:"BTC",network:"Internal",price:Number(assetPrices.BTC||0),icon:"₿"},
    {asset:"USDT",label:"Tether USD",symbol:"USDT",network:"TRC-20",price:1,icon:"₮"},
    {asset:"TON",label:"Gram",symbol:"GRAM",network:"TON",price:Number(assetPrices.TON||0),icon:"G"},
    {asset:"SOL",label:"Solana",symbol:"SOL",network:"Internal",price:Number(assetPrices.SOL||0),icon:"S"},
    {asset:"BNB",label:"BNB",symbol:"BNB",network:"Internal",price:Number(assetPrices.BNB||0),icon:"B"},
  ];
  const balances=supported.map(asset=>({...asset,wallet:account.wallets.find(w=>w.asset===asset.asset)}));
  const portfolioValue=balances.reduce((sum,item)=>sum + Number(item.wallet?.available_balance||0)*Number(item.price||0),0);
  const fromAsset=balances.find(item=>item.asset===swapFrom)||balances[1];
  const toAsset=balances.find(item=>item.asset===swapTo)||balances[0];
  const numericSwap=Number(swapAmount||0);
  const receiveQuote=numericSwap>0 && fromAsset.price>0 && toAsset.price>0 ? (numericSwap*fromAsset.price/toAsset.price) : 0;

  async function openDeposit() {
    setNotice(""); setModal("deposit");
    if (walletInfo) return;
    const { data, error } = await supabase.functions.invoke("wallet-info");
    if (error || data?.error) setNotice(data?.error || error?.message || "Could not load deposit details.");
    else setWalletInfo(data);
  }

  async function submitSwap(event) {
    event.preventDefault();
    setNotice("");
    if (!Number.isFinite(numericSwap) || numericSwap <= 0) return setNotice("Enter a valid amount to swap.");
    if (swapFrom === swapTo) return setNotice("Choose two different assets.");
    if (numericSwap > Number(fromAsset.wallet?.available_balance||0)) return setNotice("Insufficient available balance.");
    setSwapBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("swap-assets", { body:{from_asset:swapFrom,to_asset:swapTo,amount:numericSwap} });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Swap failed.");
      setSwapAmount(""); setModal("");
      setNotice("Swap completed. Your portfolio has been updated.");
      await refreshAccount();
    } catch (error) { setNotice(error.message || "Swap failed."); }
    finally { setSwapBusy(false); }
  }

  async function submitWithdrawal(event) {
    event.preventDefault();
    setNotice("");
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setNotice("Enter a valid withdrawal amount.");
    if (!address.trim()) return setNotice("Enter the destination wallet address.");
    setBusy(true);
    try {
      const wallet = account.wallets.find((item) => item.asset === selectedAsset);
      const { data, error } = await supabase.functions.invoke("request-withdrawal", {
        body:{asset:selectedAsset,network:wallet?.network,amount:numericAmount,address:address.trim()}
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Withdrawal request failed.");
      setAmount(""); setAddress(""); setModal("");
      setNotice("Withdrawal request submitted. Your funds are now locked while the request is reviewed.");
      await refreshAccount();
    } catch (error) { setNotice(error.message || "Withdrawal request failed."); }
    finally { setBusy(false); }
  }

  return <div className="wallet-page">
    <section className="wallet-hero">
      <div><small>PORTFOLIO VALUE</small><strong>\${portfolioValue.toLocaleString(undefined,{maximumFractionDigits:2})} <em>USDT</em></strong><span>Live value of available balances · bonus principal excluded</span></div>
      <div className="wallet-orbit">◎</div>
    </section>
    <div className="wallet-actions">
      <button onClick={openDeposit}>＋ Deposit</button>
      <button className="secondary" onClick={()=>{setNotice("");setModal("withdraw");}}>↗ Withdraw</button>
      <button className="secondary" onClick={()=>{setNotice("");setModal("swap");}}>⇄ Swap</button>
    </div>

    {reward&&<section className="wallet-reward"><div><small>FLEXAR WELCOME CREDIT</small><strong>\${Number(reward.remaining_reward||0).toFixed(2)} <span>REMAINING</span></strong><p>Trading credit only. It is not included in your portfolio balance and cannot be reused after it is spent.</p></div><span className="credit-pill">{reward.status.toUpperCase()}</span></section>}

    <section className="asset-section">
      <div className="section-heading"><div><small>PORTFOLIO</small><h2>Your assets</h2></div><button className="asset-swap-link" onClick={()=>setModal("swap")}>Swap assets ↗</button></div>
      <div className="asset-list">
        {balances.map(wallet=><div className="asset-row" key={wallet.asset}>
          <div className={"asset-icon asset-"+wallet.asset.toLowerCase()}>{wallet.icon}</div>
          <div><strong>{wallet.label}</strong><small>{wallet.symbol} · {wallet.asset==="TON"?"TON network":wallet.network}</small></div>
          <div className="asset-balance"><b>{Number(wallet.wallet?.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:6})} {wallet.symbol}</b><small>\${(Number(wallet.wallet?.available_balance||0)*wallet.price).toLocaleString(undefined,{maximumFractionDigits:2})}</small></div>
        </div>)}
      </div>
    </section>

    <section className="asset-section">
      <div className="section-heading"><div><small>FUNDING ROUTES</small><h2>Deposit availability</h2></div></div>
      <div className="funding-routes"><div><b>USDT</b><span>TRC-20 deposit</span></div><div><b>GRAM</b><span>TON network deposit</span></div><p>BTC, SOL and BNB are portfolio assets created through swaps. Direct deposits for those assets are not enabled.</p></div>
    </section>

    <section className="asset-section"><div className="section-heading"><div><small>RECENT</small><h2>Wallet activity</h2></div></div><ActivityRows account={{...account,trades:[]}} /></section>
    {notice&&<div className="notice" role="status">{notice}</div>}

    {modal==="swap"&&<div className="auth-modal-backdrop" onClick={()=>setModal("")}><div className="swap-modal" onClick={e=>e.stopPropagation()}>
      <button className="auth-close" onClick={()=>setModal("")} aria-label="Close">×</button>
      <div className="eyebrow">PORTFOLIO SWAP</div><h2>Move value between assets.</h2><p>Swap is internal to FLEXAR. The quote uses current market reference prices and the conversion is applied atomically to your portfolio.</p>
      <form onSubmit={submitSwap}>
        <div className="swap-box"><small>You pay</small><div><input inputMode="decimal" value={swapAmount} onChange={e=>setSwapAmount(e.target.value)} placeholder="0.00"/><select value={swapFrom} onChange={e=>setSwapFrom(e.target.value)}>{balances.map(a=><option key={a.asset} value={a.asset}>{a.symbol}</option>)}</select></div><span>Available {Number(fromAsset.wallet?.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:6})} {fromAsset.symbol}</span></div>
        <button type="button" className="swap-flip" onClick={()=>{setSwapFrom(swapTo);setSwapTo(swapFrom);}}>↓</button>
        <div className="swap-box"><small>You receive</small><div><strong>{receiveQuote.toLocaleString(undefined,{maximumFractionDigits:8})}</strong><select value={swapTo} onChange={e=>setSwapTo(e.target.value)}>{balances.map(a=><option key={a.asset} value={a.asset}>{a.symbol}</option>)}</select></div><span>1 {fromAsset.symbol} ≈ {(fromAsset.price/toAsset.price||0).toLocaleString(undefined,{maximumFractionDigits:8})} {toAsset.symbol}</span></div>
        <button className="swap-submit" disabled={swapBusy}>{swapBusy?"Swapping…":"Swap now ↗"}</button>
      </form>
    </div></div>}

    {modal==="deposit"&&<div className="auth-modal-backdrop" onClick={()=>setModal("")}><div className="auth-modal" onClick={e=>e.stopPropagation()}>
      <button className="auth-close" onClick={()=>setModal("")} aria-label="Close">×</button>
      <div className="eyebrow">DEPOSIT</div><h2>Fund your wallet.</h2><p>Send funds only on the network shown below. Deposits are credited after the transaction is verified.</p>
      <div className="wallet-network-list">{Object.entries(walletInfo?.deposit_addresses||{}).map(([asset,info])=><div className="wallet-address-card" key={asset}><strong>{asset==="TON"?"GRAM":asset}</strong><small>{info?.network||"Network"}</small><code>{info?.address||"Deposit address is being configured."}</code>{info?.address&&<button type="button" onClick={()=>navigator.clipboard?.writeText(info.address)}>Copy address</button>}</div>)}{!walletInfo&&<div className="empty-state"><strong>Loading deposit details…</strong></div>}</div>
    </div></div>}

    {modal==="withdraw"&&<div className="auth-modal-backdrop" onClick={()=>setModal("")}><div className="auth-modal" onClick={e=>e.stopPropagation()}>
      <button className="auth-close" onClick={()=>setModal("")} aria-label="Close">×</button><div className="eyebrow">WITHDRAW</div><h2>Move funds out.</h2>
      <form onSubmit={submitWithdrawal}><label>Asset<select value={selectedAsset} onChange={e=>setSelectedAsset(e.target.value)}>{balances.filter(a=>Number(a.wallet?.available_balance||0)>0).map(a=><option key={a.asset} value={a.asset}>{a.symbol}</option>)}</select></label><label>Amount<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></label><label>Destination address<textarea value={address} onChange={e=>setAddress(e.target.value)} /></label><button className="primary" disabled={busy}>{busy?"Submitting…":"Submit withdrawal"}</button></form>
    </div></div>}
  </div>;
}


