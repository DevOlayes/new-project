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

  async function startAiScan() { if (!supabase || aiScanning) return; setAiScanning(true); setGlobalNotice(""); try { const { data, error } = await supabase.functions.invoke("opportunity-engine",{body:{source:"user",requested_at:new Date().toISOString()}}); if(error||data?.error) throw new Error(data?.error||error?.message||"The AI engine could not start."); await refreshAccount(); setPage("trade"); setGlobalNotice("AI scan complete. Flexa is reviewing the latest qualifying setup."); } catch(error){setGlobalNotice(error.message||"The AI engine could not start.");} finally{setAiScanning(false);} }

  async function installFlexa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); setAccount(EMPTY_ACCOUNT); }

  if (profile?.is_admin && page === "admin") return <AdminDashboard onExit={() => setPage("home")} />;
  if (!inMiniApp && !user) return <Landing market={market} showAuth={showAuth} setShowAuth={setShowAuth} installPrompt={installPrompt} installFlexa={installFlexa} />;
  if (!user && loading) return <div className="loading-screen"><img className="loader-logo" src="/flexa-symbol.webp" alt="Flexa AI" /><strong>Connecting your Flexa AI account…</strong><span>Loading your account data…</span></div>;
  if (!user) return <div className="auth-screen"><div className="auth-card"><div className="brand"><img className="brand-symbol" src="/flexa-symbol.webp" alt="Flexa AI" /><div><strong>Flexa AI</strong><small>AI TRADES</small></div></div><h1>Connect your Telegram account</h1><p>Open Flexa AI from the Telegram Mini App so Telegram can securely identify your account.</p>{authError && <div className="error-banner">{authError}</div>}<span className="auth-hint">No separate password is required.</span></div></div>;

  const notifications = account.notifications || [];
  const unreadNotifications = notifications.filter((item) => !item.is_read).length;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><img className="brand-symbol" src="/flexa-symbol.webp" alt="Flexa AI" /><div><strong>Flexa AI</strong><small>AI Trades</small></div></div><button type="button" className="icon-button notification-button" onClick={() => setShowNotifications(true)} aria-label="Open notifications"><span aria-hidden="true">♢</span>{unreadNotifications > 0 && <b className="notification-dot">{unreadNotifications > 9 ? "9+" : unreadNotifications}</b>}</button></header>
    <main className="content">
      {authError && <div className="error-banner">{authError}</div>}
      <div key={page} className="page-transition" aria-live="polite">
        {page === "home" && <Home account={account} loading={loading} setPage={setPage} claimReward={claimReward} rewardBusy={rewardBusy} startAiScan={startAiScan} aiScanning={aiScanning} />}
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

function Home({ account, loading, setPage, claimReward, rewardBusy, startAiScan, aiScanning }) {
  const active = account.trades.filter((trade) => trade.status === "active");
  const unread = account.notifications.filter((item) => !item.is_read).length;
  const opportunities = account.opportunities || [];
  const bestPair = getBestPerformingPair(account.trades);

  return <>
    <section className="balance-hero home-balance">
      <div><small>TOTAL AVAILABLE</small><strong>{Number(account.wallets.find((item) => item.asset === "USDT")?.available_balance || 0).toLocaleString(undefined,{maximumFractionDigits:2})} <em>USDT</em></strong><span className="balance-caption">Available trading balance</span></div>
      <div className="balance-actions"><button type="button" onClick={() => setPage("wallet")}>Wallet</button></div>
    </section>

    <section className="ai-start-card">
      <div className="ai-start-copy"><small>FLEXA AI ENGINE</small><h1>Let AI find<br /><span>the opportunity.</span></h1><p>Start the AI trading center to review the strongest market setup currently available.</p></div>
      <button type="button" className="start-ai-button" onClick={startAiScan} disabled={aiScanning}><span>{aiScanning ? "Scanning…" : "Start AI"}</span><b>{aiScanning ? "◌" : "→"}</b></button>
      <div className="engine-status"><i /> Engine ready</div>
    </section>

    <section className="home-insights">
      <article className="home-insight-card"><small>BEST PERFORMING PAIR</small><strong>{bestPair ? bestPair[0] : "—"}</strong><span>{bestPair ? `${bestPair[1] >= 0 ? "+" : ""}${bestPair[1].toFixed(2)} USDT realized` : "Complete a trade to see performance"}</span></article>
      <article className="home-insight-card"><small>ACTIVE TRADES</small><strong>{loading ? "…" : active.length}</strong><span>{unread ? `${unread} unread alert${unread === 1 ? "" : "s"}` : "No unread alerts"}</span></article>
    </section>

    {account.rewards?.find((r) => ["available","active"].includes(r.status)) && <RewardBanner reward={account.rewards.find((r) => ["available","active"].includes(r.status))} onClaim={claimReward} busy={rewardBusy} />}

    <section className="home-opportunities">
      <div className="section-heading"><div><small>AI OPPORTUNITIES</small><h2>Ready to review</h2></div><button type="button" onClick={() => setPage("trade")}>Trading center →</button></div>
      {opportunities.length ? <div className="opportunity-list">{opportunities.slice(0,2).map((item) => <OpportunityCard key={item.id} item={item} setPage={setPage} />)}</div> : <div className="empty-state opportunity-empty"><strong>{loading ? "Preparing the AI feed" : "No opportunity is ready yet"}</strong><p>{loading ? "The engine is loading the latest market state." : "Your home stays clean until Flexa AI has a setup ready for review."}</p></div>}
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
function Activity({ account }) {
  const trades=account.trades||[];
  const wins=trades.filter(t=>t.status==="won").length;
  const losses=trades.filter(t=>t.status==="lost").length;
  const profit=trades.reduce((sum,t)=>sum+Number(t.result_amount||0)-Number(t.stake||0),0);
  return <div className="activity-page"><section className="intro"><small>ACTIVITY CENTER</small><h1>Everything that happened.</h1><p>Your trade outcomes and wallet events are kept together so you can follow every change to your account.</p></section><section className="activity-stats"><div><small>TRADES</small><strong>{trades.length}</strong></div><div><small>WINS</small><strong>{wins}</strong></div><div><small>LOSSES</small><strong>{losses}</strong></div><div><small>NET</small><strong className={profit>=0?"green":"red"}>{profit>=0?"+":""}{profit.toFixed(2)}</strong></div></section><section className="activity-section"><div className="section-heading"><div><small>TRADE HISTORY</small><h2>Recent trades</h2></div></div>{trades.length?<div className="timeline">{trades.map(t=><div className="timeline-row" key={t.id}><div className="timeline-dot" /><div className="timeline-main"><div><strong>{t.asset}</strong><span className={t.direction==="up"?"green":"red"}>{t.direction.toUpperCase()}</span></div><small>{new Date(t.opened_at).toLocaleString()} · {Math.round(Number(t.duration_seconds||0)/60)} min</small></div><div className="timeline-value"><strong className={t.status==="won"?"green":t.status==="lost"?"red":""}>{t.status==="won"?"+":""}{Number(t.result_amount??t.potential_payout??t.stake).toFixed(2)}</strong><small>{t.status.toUpperCase()}</small></div></div>)}</div>:<div className="empty-state"><strong>No trades yet</strong><p>Your AI trade history will appear here.</p></div>}</section><section className="activity-section"><div className="section-heading"><div><small>WALLET LEDGER</small><h2>Recent transactions</h2></div></div><ActivityRows account={{...account,trades:[]}} /></section></div>;
