import { Component, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { getTelegramWebApp, isTelegramMiniApp } from "./lib/telegram";
import { getAccountData } from "./lib/data";

const nav = [["home","⌂","Home"],["trade","✦","AI Trade"],["activity","◷","Activity"],["referral","↗","Referral"],["profile","◉","Profile"]];

const ONBOARDING_COUNTRY_CODES = "AF,AX,AL,DZ,AS,AD,AO,AI,AQ,AG,AR,AM,AW,AU,AT,AZ,BS,BH,BD,BB,BY,BE,BZ,BJ,BM,BT,BO,BQ,BA,BW,BV,BR,IO,BN,BG,BF,BI,CV,KH,CM,CA,KY,CF,TD,CL,CN,CX,CC,CO,KM,CG,CD,CK,CR,CI,HR,CU,CW,CY,CZ,DK,DJ,DM,DO,EC,EG,SV,GQ,ER,EE,SZ,ET,FK,FO,FJ,FI,FR,GF,PF,TF,GA,GM,GE,DE,GH,GI,GR,GL,GD,GP,GU,GT,GG,GN,GW,GY,HT,HM,VA,HN,HK,HU,IS,IN,ID,IR,IQ,IE,IM,IL,IT,JM,JP,JE,JO,KZ,KE,KI,KP,KR,KW,KG,LA,LV,LB,LS,LR,LY,LI,LT,LU,MO,MG,MW,MY,MV,ML,MT,MH,MQ,MR,MU,YT,MX,FM,MD,MC,MN,ME,MS,MA,MZ,MM,NA,NR,NP,NL,NC,NZ,NI,NE,NG,NU,NF,MK,MP,NO,OM,PK,PW,PS,PA,PG,PY,PE,PH,PN,PL,PT,PR,QA,RE,RO,RU,RW,BL,SH,KN,LC,MF,PM,VC,WS,SM,ST,SA,SN,RS,SC,SL,SG,SX,SK,SI,SB,SO,ZA,GS,SS,ES,LK,SD,SR,SJ,SE,CH,SY,TW,TJ,TZ,TH,TL,TG,TK,TO,TT,TN,TR,TM,TC,TV,UG,UA,AE,GB,US,UM,UY,UZ,VU,VE,VN,VG,VI,WF,EH,YE,ZM,ZW".split(",");
const ONBOARDING_COUNTRIES = ONBOARDING_COUNTRY_CODES.map((code) => ({
  code,
  name: new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code,
  flag: code.replace(/./g, (char) => String.fromCodePoint(char.charCodeAt(0) + 127397)),
})).sort((a, b) => a.name.localeCompare(b.name));


const FLEXAR_APP_URL = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, "");

export default function App() {
  const [inMiniApp, setInMiniApp] = useState(false);
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [onboardingState, setOnboardingState] = useState(null);
  const EMPTY_ACCOUNT = { wallets: [], trades: [], transactions: [], notifications: [], opportunities: [], rewards: [], referrals: [], markets: [], plans: [], subscriptions: [], tradingAccess: null, error: null };
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [market, setMarket] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installNotice, setInstallNotice] = useState(false);
  const [notificationPrompt, setNotificationPrompt] = useState(false);
  const [aiActivationOpen, setAiActivationOpen] = useState(false);
  const [notificationAsked, setNotificationAsked] = useState(false);
  const [assetPrices, setAssetPrices] = useState({USDT:1,TON:1.41,BTC:83928.34,SOL:119.79,BNB:770.09});
  const [rewardBusy, setRewardBusy] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [aiEngineActive, setAiEngineActive] = useState(false);
  const [globalNotice, setGlobalNotice] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const [walletAction, setWalletAction] = useState("");
  const [tradeSuccess, setTradeSuccess] = useState(null);
  const notificationSeenRef = useRef(null);
  const opportunitySeenRef = useRef(null);

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
    const refreshAiCredits = async () => {
      if (!supabase || !user) return;
      const { data } = await supabase.from("profiles").select("ai_credits,ai_credits_used").eq("id", user.id).maybeSingle();
      if (data) setProfile((current) => current ? { ...current, ...data } : current);
    };
    window.addEventListener("flexar-ai-credits-updated", refreshAiCredits);
    return () => window.removeEventListener("flexar-ai-credits-updated", refreshAiCredits);
  }, [user]);

  useEffect(() => {
    const openNotifications = () => setShowNotifications(true);
    const notificationsResolved = () => {
      setNotificationPrompt(false);
      setNotificationAsked(true);
    };
    window.addEventListener("flexar-notifications-resolved", notificationsResolved);
    const requestNotifications = (event) => {
      const mode = event?.detail?.mode === "autopilot" ? "Autopilot" : "Manual approval";
      setGlobalNotice(`${mode} enabled. FLEXAR AI is now looking for a qualifying setup.`);
      if (typeof Notification === "undefined" || Notification.permission !== "granted") {
        setNotificationPrompt(true);
      }
    };
    window.addEventListener("flexar-open-notifications", openNotifications);
    window.addEventListener("flexar-request-notifications", requestNotifications);
    return () => {
      window.removeEventListener("flexar-open-notifications", openNotifications);
      window.removeEventListener("flexar-request-notifications", requestNotifications);
      window.removeEventListener("flexar-notifications-resolved", notificationsResolved);
    };
  }, []);

  async function enableNotifications() {
    setNotificationAsked(true);
    try { localStorage.setItem("flexar_notification_dismissed", new Date().toISOString().slice(0,10)); } catch {}
    if (typeof Notification === "undefined") {
      setNotificationPrompt(false);
      setGlobalNotice("Device notifications are not available in this browser. FLEXAR in-app notifications remain available.");
      return;
    }
    try {
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      setNotificationPrompt(false);
      if (permission === "granted") {
        setGlobalNotice("Notifications enabled. FLEXAR will alert you about AI setups and trade updates.");
        new Notification("FLEXAR AI notifications enabled", { body: "You will be alerted when an AI setup or trade update needs your attention." });
      } else {
        setGlobalNotice("Notifications are off. You can enable them later from your browser or device settings.");
      }
    } catch {
      setNotificationPrompt(false);
    }
  }

  function dismissNotificationPrompt() {
    setNotificationPrompt(false);
    setNotificationAsked(true);
    try { localStorage.setItem("flexar_notification_dismissed", new Date().toISOString().slice(0,10)); } catch {}
  }

  useEffect(() => {
    if (!user) return;
    const activeTradeExists = (account.trades || []).some((trade) => trade.status === "active");
    if (!aiEngineActive && !activeTradeExists) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await getAccountData();
        if (!cancelled) setAccount(result);
      } catch {}
    };
    const timer = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user, aiEngineActive, account.trades?.some((trade) => trade.status === "active")]);

  useEffect(() => {
    const latest = (account.opportunities || []).filter((item) => ["scheduled", "open"].includes(item.status)).sort((a,b) => new Date(b.entry_window_start || b.created_at || 0) - new Date(a.entry_window_start || a.created_at || 0))[0];
    if (!latest) return;
    const key = latest.id || latest.created_at || latest.symbol;
    if (opportunitySeenRef.current === null) {
      opportunitySeenRef.current = key;
      return;
    }
    if (opportunitySeenRef.current === key) return;
    opportunitySeenRef.current = key;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("FLEXAR AI setup available", {
        body: modeForNotification(account) === "autopilot"
          ? "Autopilot is monitoring the qualifying setup."
          : "A qualifying AI trade is ready for your review."
      });
    }
  }, [account.opportunities]);

  useEffect(() => {
    const latest = (account.notifications || [])[0];
    if (!latest) return;
    const key = latest.id || latest.created_at || latest.title;
    if (notificationSeenRef.current === null) {
      notificationSeenRef.current = key;
      return;
    }
    if (notificationSeenRef.current === key) return;
    notificationSeenRef.current = key;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(latest.title || "FLEXAR AI update", {
        body: latest.message || latest.body || "You have a new FLEXAR AI account or trade update."
      });
    }
  }, [account.notifications]);

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
        setOnboardingState(null);
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
        .select("id,display_name,telegram_username,avatar_url,referral_code,is_admin,onboarding_completed,onboarding_step,country_code,trading_experience,onboarding_goals,trading_style,ai_preference,ai_credits,ai_credits_used,ai_trading_enabled,ai_trade_mode,ai_autopilot_stake")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;
      setProfile(profileData || null);
      setAiEngineActive(Boolean(profileData?.ai_trading_enabled));
      setOnboardingState(profileData ? {
        completed: Boolean(profileData.onboarding_completed),
        step: Math.min(3, Math.max(0, Number(profileData.onboarding_step || 0))),
        countryCode: profileData.country_code || "",
        experience: profileData.trading_experience || "",
        goals: Array.isArray(profileData.onboarding_goals) ? profileData.onboarding_goals : [],
        style: profileData.trading_style || "",
        aiPreference: profileData.ai_preference || "",
      } : null);

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

  async function startAiScan(silent = false) {
    if (!supabase || aiScanning) return;
    const notify = (message) => { if (!silent) setGlobalNotice(message); };
    const availableCredits = Number(profile?.ai_credits ?? 0);
    if (availableCredits < 1.5) {
      notify("Your AI credits are finished. Buy 5 AI credits for $8 to continue.");
      setPage("trade");
      return;
    }
    setAiScanning(true);
    setAiEngineActive(true);
    notify("");
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
        if (error?.status === 402 || error?.context?.status === 402) {
          setAiEngineActive(false);
          notify("Your AI credits are finished. Buy 5 AI credits for $8 to continue.");
          setPage("trade");
          return;
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);

      const created = (data?.results || []).filter((item) => item?.status === "created");
      const alreadyExists = (data?.results || []).filter((item) => item?.status === "already_exists");
      if (data?.credits_remaining !== undefined) setProfile((current) => current ? { ...current, ai_credits: Number(data.credits_remaining) } : current);
      await refreshAccount();

      if (!created.length && !alreadyExists.length) {
        notify("FLEXAR AI is active. It is monitoring the market and will surface the next qualifying setup automatically.");
      } else {
        try { sessionStorage.setItem("flexa_open_ai_trade", "true"); } catch {}
        notify("FLEXAR AI found a qualifying opportunity. Review the setup below.");
      }
      setPage("trade");
    } catch(error) {
      setAiEngineActive(false);
      notify(error.message || "The AI engine could not start.");
    } finally {
      setAiScanning(false);
    }
  }

  async function stopAiEngine() {
    setAiEngineActive(false);
    setAiScanning(false);
    try { await supabase?.rpc("set_ai_trading_mode", { p_mode: profile?.ai_trade_mode || "manual", p_enabled: false, p_stake: Number(profile?.ai_autopilot_stake || 25) }); } catch {}
    try {
      sessionStorage.removeItem("flexa_ai_auto_opportunity_id");
    } catch {}
    setGlobalNotice("FLEXAR AI has been stopped. Any active trades will continue to be managed until they close.");
  }

  async function installFLEXAR() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  useEffect(() => {
    if (!globalNotice) return;
    const timer = window.setTimeout(() => setGlobalNotice(""), 1500);
    return () => window.clearTimeout(timer);
  }, [globalNotice]);

  useEffect(() => {
    const handleTradeStarted = async (event) => {
      await refreshAccount();
      setTradeSuccess(event.detail || null);
    };
    window.addEventListener("flexa-trade-started", handleTradeStarted);
    return () => window.removeEventListener("flexa-trade-started", handleTradeStarted);
  }, [refreshAccount]);

  useEffect(() => {
    if (!aiEngineActive || aiScanning || !supabase) return;
    let cancelled = false;

    const pollAiEngine = async () => {
      if (cancelled) return;
      try {
        const { data, error } = await supabase.functions.invoke("opportunity-engine", {
          body: { source: "user", requested_at: new Date().toISOString() }
        });
        if (cancelled || error || data?.error) return;

        const created = (data?.results || []).some((item) => ["created", "already_exists"].includes(item?.status));
        if (data?.credits_remaining !== undefined) setProfile((current) => current ? { ...current, ai_credits: Number(data.credits_remaining) } : current);
        if (created) {
          await refreshAccount();
          if (!cancelled) {
            try { sessionStorage.setItem("flexa_open_ai_trade", "true"); } catch {}
            setGlobalNotice("FLEXAR AI found a qualifying opportunity. Review the setup below.");
          }
        }
      } catch {}
    };

    const timer = window.setInterval(pollAiEngine, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [aiEngineActive, aiScanning, refreshAccount]);

  useEffect(() => {
    if (!aiEngineActive || aiScanning) return;
    const live = (account.opportunities || []).filter((item) => ["scheduled", "open"].includes(item.status));
    if (!live.length) return;
    const latestEnd = Math.max(...live.map((item) => new Date(item.entry_window_end || 0).getTime()).filter(Number.isFinite));
    if (!Number.isFinite(latestEnd) || latestEnd <= Date.now()) return;
    const timer = setTimeout(() => {
      refreshAccount();
    }, Math.max(1000, latestEnd - Date.now() + 1500));
    return () => clearTimeout(timer);
  }, [account.opportunities, aiEngineActive, aiScanning, refreshAccount]);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setAccount(EMPTY_ACCOUNT);
    setAiEngineActive(false);
  }

  if (profile?.is_admin && page === "admin") return <AdminDashboard onExit={() => setPage("home")} />;
  if (!inMiniApp && !user) return <Landing market={market} showAuth={showAuth} setShowAuth={setShowAuth} installPrompt={installPrompt} installFLEXAR={installFLEXAR} />;
  if (!user && loading) return <div className="loading-screen"><img className="loader-logo" src="/flexar-public-logo.webp" alt="FLEXAR AI" /><strong>Connecting your FLEXAR AI account…</strong><span>Loading your account data…</span></div>;
  if (!user) return <div className="auth-screen"><div className="auth-card"><div className="brand"><img className="brand-symbol" src="/flexar-public-logo.webp" alt="FLEXAR AI" /><div><strong>FLEXAR AI</strong><small>AI TRADES</small></div></div><h1>Connect your Telegram account</h1><p>Open FLEXAR AI from the Telegram Mini App so Telegram can securely identify your account.</p>{authError && <div className="error-banner">{authError}</div>}<span className="auth-hint">No separate password is required.</span></div></div>;
  if (user && profile && onboardingState && !onboardingState.completed) return <Onboarding profile={profile} initialState={onboardingState} onComplete={(next) => { setOnboardingState({...next, completed:true}); setProfile((current) => ({...(current || {}), onboarding_completed:true, onboarding_step:4, country_code:next.countryCode, trading_experience:next.experience, onboarding_goals:next.goals, trading_style:next.style, ai_preference:next.aiPreference})); setPage("home"); }} />;

  const notifications = account.notifications || [];
  const unreadNotifications = notifications.filter((item) => !item.is_read).length;

  return <div className="app-shell">
    <header className="topbar"><img className="app-wordmark" src="/flexar-public-logo.webp" alt="FLEXAR AI" /></header>
    <main className="content">
      {authError && <div className="error-banner">{authError}</div>}
      <AppErrorBoundary page={page}>
        <div key={page} className="page-transition" aria-live="polite">
          {page === "home" && <Home account={account} profile={profile} setPage={setPage} onWalletAction={setWalletAction} claimReward={claimReward} rewardBusy={rewardBusy} startAiScan={startAiScan} aiScanning={aiScanning} aiEngineActive={aiEngineActive} />}
          {page === "trade" && <Trade account={account} profile={profile} startAiScan={startAiScan} aiScanning={aiScanning} aiEngineActive={aiEngineActive} onOpenCredits={() => setPage("ai-credits")} onActivationChange={(open) => { setAiActivationOpen(open); if (open) setGlobalNotice(""); }} onStopAi={stopAiEngine} />}
          {page === "ai-credits" && <AICreditsPage profile={profile} account={account} onBack={() => setPage("trade")} refreshAccount={refreshAccount} />}
          {page === "activity" && <Activity account={account} setPage={setPage} />}
          {page === "activity-trades" && <ActivityDetailPage account={account} type="trades" onBack={() => setPage("activity")} />}
          {page === "activity-transactions" && <ActivityDetailPage account={account} type="transactions" onBack={() => setPage("activity")} />}
          {page === "referral" && <Referral account={account} profile={profile} />}
          {page === "profile" && <Profile user={user} profile={profile} signOut={signOut} />}
        </div>
      </AppErrorBoundary>
    </main>
    <nav className="bottom-nav" aria-label="Primary navigation">{nav.map(([id, icon, label]) => <button type="button" key={id} className={(page === id || (id === "activity" && page.startsWith("activity-"))) ? "nav active" : "nav"} onClick={() => setPage(id)}><span>{icon}</span><small>{label}</small></button>)}{profile?.is_admin&&<button type="button" className={page==="admin"?"nav active":"nav"} onClick={()=>setPage("admin")}><span>◆</span><small>Admin</small></button>}</nav>
    {notificationPrompt && !aiActivationOpen && <NotificationPromptModal onEnable={enableNotifications} onDismiss={dismissNotificationPrompt} />}
    {showNotifications && <NotificationPanel notifications={notifications} onClose={() => setShowNotifications(false)} />}
    {walletAction && <WalletActions action={walletAction} onClose={() => setWalletAction("")} account={account} refreshAccount={refreshAccount} assetPrices={assetPrices} />}
    {globalNotice && !aiActivationOpen && <div className="global-notice" role="status" onClick={() => setGlobalNotice("")}>{globalNotice}</div>}
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
      <p>Your position is now being managed by FLEXAR AI with adaptive protection and a safety timeout.</p>
      <div className="trade-success-details">
        <div><span>MARKET</span><strong>{trade.symbol || "—"}</strong></div>
        <div><span>DIRECTION</span><strong className={direction === "UP" ? "green" : "red"}>{direction === "UP" ? "↗ UP" : "↘ DOWN"}</strong></div>
        <div><span>STAKE</span><strong>$ {Number(trade.stake || 0).toFixed(2)} USDT</strong></div>
        <div><span>TAKE PROFIT</span><strong>{trade.takeProfitPrice ? Number(trade.takeProfitPrice).toLocaleString(undefined,{maximumFractionDigits:6}) : "AUTO"}</strong></div><div><span>STOP LOSS</span><strong>{trade.stopLossPrice ? Number(trade.stopLossPrice).toLocaleString(undefined,{maximumFractionDigits:6}) : "AUTO"}</strong></div><div><span>BREAK-EVEN</span><strong>{trade.breakEvenPrice ? Number(trade.breakEvenPrice).toLocaleString(undefined,{maximumFractionDigits:6}) : "AUTO"}</strong></div>
      </div>
      <button type="button" className="trade-success-primary" onClick={onViewActive}>View active trade →</button>
      <button type="button" className="trade-success-secondary" onClick={onClose}>Continue trading</button>
    </section>
  </div>;
}
function modeForNotification(account) {
  try { return sessionStorage.getItem("flexa_ai_mode") || "manual"; } catch { return "manual"; }
}

function NotificationPromptModal({ onEnable, onDismiss }) {
  return <div className="notification-permission-backdrop" onClick={onDismiss}>
    <section className="notification-permission-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="notification-permission-title">
      <div className="notification-permission-icon"><img src="/flexa-symbol.webp" alt="" /></div>
      <small>FLEXAR AI ALERTS</small>
      <h2 id="notification-permission-title">Stay ahead of your AI trades.</h2>
      <p>FLEXAR is watching for a qualifying setup. Enable notifications so you know when a manual review is ready or when an autopilot trade has an important update or outcome.</p>
      <button type="button" className="notification-permission-primary" onClick={onEnable}>Enable notifications →</button>
      <button type="button" className="notification-permission-secondary" onClick={onDismiss}>Not now</button>
    </section>
  </div>;
}

function NotificationPanel({ notifications, onClose }) {
  return <div className="notification-backdrop" onClick={onClose}>
    <aside className="notification-panel" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Notifications">
      <div className="notification-panel-head"><div><small>FLEXAR AI</small><h2>Notifications</h2></div><button type="button" className="auth-close" onClick={onClose} aria-label="Close notifications">×</button></div>
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
    <header className="landing-topbar"><img className="landing-wordmark" src="/flexar-public-logo.webp" alt="FLEXAR AI" /></header>
    <main className="landing-content">
      <section className="landing-hero"><div className="eyebrow">AI-POWERED MARKET OPPORTUNITIES</div><h1>Let the AI find<br /><span>the trade.</span></h1><p>FLEXAR AI continuously studies market conditions and surfaces simplified trading opportunities, so you do not need to understand complex charts before every trade.</p><div className="landing-actions"><button className="landing-cta" onClick={() => setShowAuth(true)}>Get started <b>→</b></button>{installPrompt && <button className="install-cta" onClick={installFLEXAR}>Install FLEXAR AI</button>}<div className="landing-trust">Free account · Google or Telegram · No FLEXAR AI password</div><span className="hero-status"><i /> Market data connected</span></div></section>
      <section className="landing-terminal"><div className="terminal-top"><div><small>LIVE MARKET</small><strong>BTC / USDT</strong></div><span className={change >= 0 ? "green" : "red"}>{change == null ? "—" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}</span></div><Chart /><div className="terminal-bottom"><strong>{price == null ? "Loading…" : "$" + price.toLocaleString(undefined,{maximumFractionDigits:2})}</strong><span>PUBLIC MARKET DATA</span></div><div className="floating-card float-card-a">AI OPPORTUNITY <b>SCANNING</b></div><div className="floating-card float-card-b">AI WINDOW <b>QUALIFYING SETUP</b></div></section>
      <section className="welcome-campaign"><div><span className="eyebrow">NEW USER CAMPAIGN</span><h2>Claim your <b>$50</b> welcome reward.</h2><p>Use the reward to trade. The reward itself cannot be withdrawn; only eligible profit generated from it can be withdrawn before the 12-day deadline.</p></div><span className="campaign-badge">12 DAYS</span></section><section className="opportunity-preview"><div><div className="eyebrow">AI OPPORTUNITY FEED</div><h2>Users do not hunt for trades. FLEXAR AI finds them.</h2></div><div className="opportunity-demo"><div><span>BTC / USDT</span><strong>AI opportunity detected</strong></div><b>UP ↗</b><small>RISK MANAGED · REVIEW READY</small></div></section>
      <section className="landing-section"><div className="eyebrow">HOW FLEXAR WORKS</div><h2>Simple on the surface. Intelligent underneath.</h2><div className="landing-steps"><LandingStep n="01" title="Scan" text="Market data is continuously collected and analyzed across supported markets."/><LandingStep n="02" title="Select" text="The engine filters signals and turns stronger setups into user-friendly opportunities."/><LandingStep n="03" title="Trade" text="You review the opportunity, choose your stake and confirm when ready." /></div></section>
      <section className="landing-section"><div className="feature-row"><LandingFeature title="AI-first trading" text="The system does the heavy market analysis before presenting an opportunity."/><LandingFeature title="Real market data" text="Charts and future signals are designed around real market pricing, not invented demo prices."/><LandingFeature title="Transparent activity" text="Trades, balances and wallet events remain connected to your account ledger." /></div></section>
    </main>{showAuth && <AuthModal onClose={() => setShowAuth(false)} />}</div>;
}
function AuthModal({ onClose }) {
  const [mode, setMode] = useState("signup");
  const [error, setError] = useState("");
  return <div className="auth-modal-backdrop" onClick={onClose}><div className="auth-modal" onClick={(event) => event.stopPropagation()}><button className="auth-close" onClick={onClose} aria-label="Close">×</button><img className="auth-modal-icon" src="/flexa-symbol.webp" alt="FLEXAR AI" /><div className="eyebrow">WELCOME TO FLEXAR AI</div><h2>{mode === "signup" ? "Start in seconds." : "Welcome back."}</h2><p>{mode === "signup" ? "Create your FLEXAR AI account with Google or Telegram." : "Sign in with the same account you used before."}</p><AuthOptions setAuthError={setError} authError={error} /><button className="auth-mode-toggle" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Already have an account? Sign in" : "New to FLEXAR AI? Create an account"}</button><small className="auth-legal">By continuing, you agree to use FLEXAR AI responsibly and follow applicable terms.</small></div></div>;
}

function AuthOptions({ setAuthError, authError }) {
  const [busy, setBusy] = useState("");

  async function continueWithGoogle() {
    if (!supabase) { setAuthError("Supabase is not configured in this build."); return; }
    setBusy("google"); setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${FLEXAR_APP_URL}/` }
    });
    if (error) { setBusy(""); setAuthError(error.message || "Google sign-in could not start."); }
  }

  function continueWithTelegram() {
    const botUsername = "flexarxbot";
    setBusy("telegram");
    setAuthError("");
    const miniAppLink = `https://t.me/${botUsername}?startapp=login&mode=fullscreen`;
    window.location.href = miniAppLink;
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
function Onboarding({ profile, initialState, onComplete }) {
  const [step, setStep] = useState(Math.min(3, Math.max(0, Number(initialState?.step || 0))));
  const [countryCode, setCountryCode] = useState(initialState?.countryCode || "");
  const [experience, setExperience] = useState(initialState?.experience || "");
  const [goals, setGoals] = useState(Array.isArray(initialState?.goals) ? initialState.goals : []);
  const [style, setStyle] = useState(initialState?.style || "");
  const [aiPreference, setAiPreference] = useState(initialState?.aiPreference || "");
  const [countrySearch, setCountrySearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedCountry = ONBOARDING_COUNTRIES.find((item) => item.code === countryCode);
  const filteredCountries = ONBOARDING_COUNTRIES.filter((item) =>
    !countrySearch.trim() || item.name.toLowerCase().includes(countrySearch.trim().toLowerCase()) || item.code.toLowerCase().includes(countrySearch.trim().toLowerCase())
  );

  const progress = Math.min(100, Math.max(0, ((step + 1) / 4) * 100));
  const displayName = profile?.display_name?.split(" ")[0] || "there";

  async function save(patch, nextStep) {
    if (!supabase) return false;
    setBusy(true); setError("");
    const { error: saveError } = await supabase.from("profiles").update({ ...patch, onboarding_step: nextStep }).eq("id", profile.id);
    setBusy(false);
    if (saveError) { setError(saveError.message || "Could not save your onboarding progress."); return false; }
    return true;
  }

  async function next() {
    if (step === 0 && !countryCode) { setError("Select your country to continue."); return; }
    if (step === 1 && !experience) { setError("Choose the option that best describes your experience."); return; }
    if (step === 2 && !goals.length) { setError("Choose at least one goal."); return; }
    if (step === 3 && (!style || !aiPreference)) { setError("Choose your trading style and AI preference."); return; }

    const patch = step === 0 ? { country_code: countryCode }
      : step === 1 ? { trading_experience: experience }
      : step === 2 ? { onboarding_goals: goals }
      : { trading_style: style, ai_preference: aiPreference, onboarding_completed: true };
    const nextStep = step + 1;
    if (!await save(patch, nextStep)) return;
    if (step === 3) onComplete({ countryCode, experience, goals, style, aiPreference });
    else setStep(nextStep);
  }

  function back() { if (step > 0) { setError(""); setStep(step - 1); } }
  function toggleGoal(goal) { setGoals((current) => current.includes(goal) ? current.filter((item) => item !== goal) : [...current, goal]); }

  const stepCopy = [
    { label: "COUNTRY", title: "Where are you based?", text: "Choose your country so FLEXAR can tailor your account experience." },
    { label: "EXPERIENCE", title: "How familiar are you with trading?", text: "This helps FLEXAR keep the experience at the right level for you." },
    { label: "YOUR GOAL", title: "What do you want FLEXAR to help you do?", text: "Pick everything that matches what you want from the platform." },
    { label: "PREFERENCES", title: "Almost ready. How should FLEXAR work for you?", text: "Set your preferred risk style and how much control you want over AI trades." },
  ][step];

  return <div className="onboarding-screen">
    <div className="onboarding-glow onboarding-glow-a" /><div className="onboarding-glow onboarding-glow-b" />
    <div className="onboarding-shell">
      <header className="onboarding-header"><img src="/flexar-public-logo.webp" alt="FLEXAR AI" /><span>ACCOUNT SETUP</span></header>
      <div className="onboarding-progress-head"><small>STEP {String(Math.min(step + 1, 4)).padStart(2,"0")} / 04</small><strong>{stepCopy.label}</strong></div>
      <div className="onboarding-progress"><span style={{width:`${progress}%`}} /></div>
      <main className="onboarding-card">
        <div className="onboarding-intro"><span className="onboarding-kicker">WELCOME, {displayName.toUpperCase()}</span><h1>{stepCopy.title}</h1><p>{stepCopy.text}</p></div>
        {step === 0 && <div className="onboarding-country"><div className="onboarding-selected-country">{selectedCountry ? <><span className="country-flag">{selectedCountry.flag}</span><div><strong>{selectedCountry.name}</strong><small>Selected country</small></div></> : <><span className="country-placeholder">◎</span><div><strong>Select your country</strong><small>Your country will be saved to your FLEXAR profile.</small></div></>}</div><div className="country-search-wrap"><span>⌕</span><input value={countrySearch} onChange={(e) => setCountrySearch(e.target.value)} placeholder="Search countries" aria-label="Search countries" /></div><div className="country-list">{filteredCountries.slice(0, 80).map((country) => <button type="button" key={country.code} className={country.code === countryCode ? "country-option selected" : "country-option"} onClick={() => { setCountryCode(country.code); setCountrySearch(""); setError(""); }}><span>{country.flag}</span><strong>{country.name}</strong><small>{country.code}</small>{country.code === countryCode && <b>✓</b>}</button>)}</div>{filteredCountries.length > 80 && <small className="country-list-note">Keep typing to narrow the list.</small>}</div>}
        {step === 1 && <div className="onboarding-choice-grid">{[["new","I’m completely new","Keep things simple and guided."],["basics","I understand the basics","I know the core ideas and want a smoother workflow."],["experienced","I’m experienced","I’m comfortable reading markets and managing trades."],["professional","Professional","I trade actively and want a focused experience."]].map(([value,title,text]) => <button type="button" key={value} className={experience===value?"onboarding-choice selected":"onboarding-choice"} onClick={() => {setExperience(value);setError("");}}><span>{value===experience?"✓":""}</span><strong>{title}</strong><small>{text}</small></button>)}</div>}
        {step === 2 && <div className="onboarding-choice-grid goals">{[["ai","Let AI find opportunities"],["growth","Grow my trading balance"],["learn","Learn while I trade"],["efficient","Trade more efficiently"],["explore","Explore AI-powered trading"]].map(([value,title]) => <button type="button" key={value} className={goals.includes(value)?"onboarding-choice selected":"onboarding-choice"} onClick={() => {toggleGoal(value);setError("");}}><span>{goals.includes(value)?"✓":""}</span><strong>{title}</strong><small>Save this preference to personalize your FLEXAR journey.</small></button>)}</div>}
        {step === 3 && <div className="onboarding-preferences"><div><small>TRADING STYLE</small><div className="preference-row">{[["conservative","Conservative","Prioritize controlled exposure."],["balanced","Balanced","A middle-ground approach."],["growth","Growth","Accept more movement for upside." ]].map(([value,title,text]) => <button type="button" key={value} className={style===value?"preference-card selected":"preference-card"} onClick={() => {setStyle(value);setError("");}}><b>{title}</b><span>{text}</span></button>)}</div></div><div><small>AI CONTROL</small><div className="preference-row two">{[["manual","Review every trade","FLEXAR prepares the setup; you confirm it."],["autopilot","Let FLEXAR execute automatically","FLEXAR can execute qualifying setups within your limits."]].map(([value,title,text]) => <button type="button" key={value} className={aiPreference===value?"preference-card selected":"preference-card"} onClick={() => {setAiPreference(value);setError("");}}><b>{title}</b><span>{text}</span></button>)}</div><small className="onboarding-footnote">You can change these preferences later.</small></div></div>}
        {error && <div className="error-banner onboarding-error">{error}</div>}
        <div className="onboarding-actions">{step>0 ? <button type="button" className="onboarding-back" onClick={back} disabled={busy}>← Back</button> : <span />}{step<3 ? <button type="button" className="onboarding-next" onClick={next} disabled={busy}>{busy?"Saving…":"Continue →"}</button> : <button type="button" className="onboarding-next" onClick={next} disabled={busy}>{busy?"Finishing…":"Enter FLEXAR AI →"}</button>}</div>
      </main>
    </div>
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

function RewardCountdown({ reward }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, new Date(reward?.expires_at || 0).getTime() - now);
  if (!remaining) return <small className="reward-expiry expired">EXPIRED</small>;
  const totalMinutes = Math.ceil(remaining / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return <small className={days < 2 ? "reward-expiry urgent" : "reward-expiry"}>Expires in {days}d {hours}h {minutes}m</small>;
}
function Home({ account, profile, setPage, onWalletAction, claimReward, rewardBusy, startAiScan, aiScanning, aiEngineActive }) {
  const active=account.trades.filter(t=>t.status==="active"), opportunities=account.opportunities||[], unread=account.notifications.filter(i=>!i.is_read).length;
  const usdtBalance=Number(account.wallets.find(i=>i.asset==="USDT")?.available_balance||0), reward=account.rewards?.find(r=>["available","active"].includes(r.status)&&Number(r.remaining_reward||0)>0);
  const displayName=profile?.display_name||profile?.telegram_username||"Your account", initials=displayName.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"F";
  const assets=[["BTC","Bitcoin","https://cdn.simpleicons.org/bitcoin"],["USDT","Tether USD","https://cdn.simpleicons.org/tether"],["TON","Gram","https://cdn.simpleicons.org/ton"],["SOL","Solana","https://cdn.simpleicons.org/solana"],["BNB","BNB","https://cdn.simpleicons.org/binance"]].map(([asset,label,icon])=>({asset,label,icon,wallet:account.wallets.find(w=>w.asset===asset)}));
  const activeTrade=active[0], activeMarket=activeTrade?.metadata?.market_symbol||activeTrade?.asset||"—", activeDirection=String(activeTrade?.direction||"").toUpperCase();
  return <div className="flexar-home minimal-home">
    <section className="home-account">
      <div className="home-profile-line">
        <div className="avatar-orb" aria-label={`${displayName} avatar`}><span>{initials}</span><i/></div>
        <div><small>WELCOME BACK</small><strong>{displayName}</strong></div>
        <button type="button" className="home-profile-button notification-button" onClick={()=>window.dispatchEvent(new CustomEvent("flexar-open-notifications"))} aria-label="Open notifications">
          <span className="bell-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></span>
          {unread>0&&<b className="notification-dot">{unread>9?"9+":unread}</b>}
        </button>
      </div>
      <div className="home-balance">
        <img className="balance-watermark" src="/flexa-symbol.webp" alt="" aria-hidden="true" />
        <div className="balance-content">
          <small>AVAILABLE BALANCE</small>
          <div><strong><b className="balance-currency">$</b>{usdtBalance.toLocaleString(undefined,{maximumFractionDigits:2})}</strong><span>USDT</span></div>
        </div>
      </div>
    </section>
    <section className="home-ai-cta"><div><small>FLEXAR AI</small><h2>{aiEngineActive?"AI is watching the markets.":opportunities.length?"Your AI opportunity is ready.":"Find your next trade with AI."}</h2><p>{aiScanning?"Scanning supported markets for a qualifying setup.":aiEngineActive?"FLEXAR will surface a qualifying setup when its signal rules are met.":"Let FLEXAR analyze the market first, then choose how FLEXAR should trade for you."}</p></div><button type="button" onClick={()=>setPage("trade")} disabled={aiScanning}>{aiScanning?"Scanning…":aiEngineActive||opportunities.length?"Trade with AI →":"Start FLEXAR AI →"}</button></section>
    <section className="home-funding-actions" aria-label="Funding actions"><button type="button" onClick={()=>onWalletAction("deposit")}><span>↓</span><strong>Deposit</strong></button><button type="button" onClick={()=>onWalletAction("withdraw")}><span>↗</span><strong>Withdraw</strong></button><button type="button" onClick={()=>onWalletAction("swap")}><span>⇄</span><strong>Swap</strong></button></section>
    {reward&&<section className="home-reward-row"><div><small>{reward.status==="active"?"WELCOME CREDIT ACTIVE":"WELCOME CREDIT"}</small><strong>{"$"+Number(reward.remaining_reward||0).toFixed(2)} <span>remaining</span></strong><RewardCountdown reward={reward}/></div><button type="button" onClick={reward.status==="active"?()=>setPage("trade"):claimReward} disabled={rewardBusy}>{reward.status==="active"?"Use credit":rewardBusy?"Claiming…":"Claim"}</button></section>}
    <section className="home-section portfolio-preview"><div className="home-section-title"><div><small>PORTFOLIO</small><h2>My assets</h2></div><span className="home-section-note">5 assets</span></div><div className="home-asset-list">{assets.map(item=><div className="home-asset-row" key={item.asset}><span className={"home-asset-icon asset-"+item.asset.toLowerCase()}><img src={item.icon} alt="" loading="lazy"/></span><div><strong>{item.label}</strong><small>{item.asset==="TON"?"GRAM":item.asset}</small></div><b>{Number(item.wallet?.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:6})} {item.asset==="TON"?"GRAM":item.asset}</b></div>)}</div></section>
    <section className="home-section home-ai-card"><div className="home-section-title"><div><small>AI SIGNAL</small><h2>{opportunities.length?"Signal ready":"Waiting for a setup"}</h2></div><span className={aiEngineActive?"home-live":""}><i/> {aiEngineActive?"LIVE":"READY"}</span></div>{opportunities.length?<div className="home-signal-row"><div><strong>{opportunities[0].symbol}</strong><small>{opportunities[0].direction==="down"?"↘ DOWN":"↗ UP"} · {Math.round(Number(opportunities[0].signal_score||0)*100)}% confidence</small></div><button type="button" onClick={()=>setPage("trade")}>Review →</button></div>:<div className="home-ai-empty"><p>{aiScanning?"Scanning supported markets…":"No setup is being presented yet. Start the AI engine when you are ready."}</p><button type="button" onClick={()=>setPage("trade")}>Open AI Trade</button></div>}</section>
    {activeTrade&&<section className="home-active-row"><div><small>ACTIVE TRADE</small><strong>{activeMarket}</strong><span className={activeDirection==="UP"?"green":"red"}>{activeDirection}</span></div><button type="button" onClick={()=>setPage("activity")}>Monitor →</button></section>}
    <section className="home-section home-activity"><div className="home-section-title"><div><small>ACTIVITY</small><h2>Recent activity</h2></div><button type="button" onClick={()=>setPage("activity")}>View all</button></div><ActivityRows account={account}/></section>
  </div>;
}
function RewardBanner({ reward, onClaim, busy }) {
  const daysLeft = Math.max(0, Math.ceil((new Date(reward.expires_at) - Date.now()) / 86400000));
  const expired = new Date(reward.expires_at).getTime() <= Date.now();
  const claimed = reward.status === "active";
  const remaining = Number(reward.remaining_reward || 0);
  const withdrawable = Number(reward.profit_withdrawable || 0);
  return <section className="reward-banner"><div className="reward-glow" /><div className="reward-copy"><small>{claimed ? "REWARD CREDIT ACTIVE" : "WELCOME REWARD"}</small><strong>${Number(reward.reward_amount || 50).toFixed(0)} <span>TRADE CREDIT</span></strong><p>{expired ? "This welcome reward has expired." : claimed ? "$"+remaining.toFixed(2)+" credit remaining · $"+withdrawable.toFixed(2)+" eligible profit." : "Use within "+daysLeft+" days. The reward itself is non-withdrawable; eligible profit can be withdrawn before expiry."}</p></div>{claimed ? <div className="reward-state"><b>ACTIVE</b><span>{daysLeft}d left</span></div> : <button onClick={onClaim} disabled={busy || expired}>{expired ? "Expired" : busy ? "Claiming…" : "Claim reward →"}</button>}</section>;
}
function Profile({ user, profile, signOut }) {
  const name=profile?.display_name||profile?.telegram_username||"FLEXAR AI user",initials=name.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  const [notifications,setNotifications]=useState(()=>{try{return localStorage.getItem("flexar_pref_notifications")!=="off"}catch{return true}}),[marketAlerts,setMarketAlerts]=useState(()=>{try{return localStorage.getItem("flexar_pref_market_alerts")!=="off"}catch{return true}});
  const setPref=(key,value,setter)=>{setter(value);try{localStorage.setItem(key,value?"on":"off")}catch{}};
  return <div className="profile-page"><section className="profile-hero-card"><div className="avatar-orb profile-avatar" aria-label={`${name} avatar`}><span>{initials}</span><i/></div><div className="profile-identity"><small>FLEXAR AI ACCOUNT</small><h1>{name}</h1><span>{profile?.telegram_username?"@"+profile.telegram_username:user?.email||"Connected account"}</span></div><span className="verified-pill">● VERIFIED</span></section>
    <section className="profile-section"><div className="profile-section-head"><div><small>ACCOUNT</small><h2>Account details</h2></div></div><div className="profile-row"><span>Identity</span><strong>{profile?.telegram_username?"Telegram connected":"Google connected"}</strong></div><div className="profile-row"><span>Email</span><strong>{user?.email||"Not provided"}</strong></div><div className="profile-row"><span>Trading</span><strong>AI trading enabled</strong></div></section>
    <section className="profile-section settings-card"><div className="profile-section-head"><div><small>PREFERENCES</small><h2>Settings</h2></div></div><button className="setting-row" onClick={()=>setPref("flexar_pref_notifications",!notifications,setNotifications)}><span><strong>Notifications</strong><small>Account and trade updates</small></span><b className={notifications?"toggle on":"toggle"}><i/></b></button><button className="setting-row" onClick={()=>setPref("flexar_pref_market_alerts",!marketAlerts,setMarketAlerts)}><span><strong>Market alerts</strong><small>AI opportunity notifications</small></span><b className={marketAlerts?"toggle on":"toggle"}><i/></b></button><div className="setting-row static"><span><strong>Sign-in security</strong><small>Managed by Supabase Auth</small></span><b>Protected</b></div></section>
    <section className="profile-section profile-support"><div className="profile-section-head"><div><small>ACCOUNT SUPPORT</small><h2>Need help?</h2></div></div><p>Use the support channel connected to your FLEXAR account for account, funding or trading questions.</p></section><button className="signout-button" onClick={signOut}>Sign out of FLEXAR AI</button>
  </div>;
}
function WalletActions({ action, onClose, account, refreshAccount, assetPrices = {} }) {
  const [walletInfo,setWalletInfo]=useState(null),[selectedAsset,setSelectedAsset]=useState("USDT"),[swapFrom,setSwapFrom]=useState("USDT"),[swapTo,setSwapTo]=useState("BTC"),[swapAmount,setSwapAmount]=useState(""),[amount,setAmount]=useState(""),[address,setAddress]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  useEffect(()=>{if(action==="deposit"&&!walletInfo){supabase?.functions.invoke("wallet-info").then(({data,error})=>{if(error||data?.error)setNotice(data?.error||error?.message||"Could not load deposit details.");else setWalletInfo(data)})}},[action,walletInfo]);
  const supported=[["BTC","Bitcoin","BTC","Internal",Number(assetPrices.BTC||0),"https://cdn.simpleicons.org/bitcoin"],["USDT","Tether USD","USDT","TRC-20",1,"https://cdn.simpleicons.org/tether"],["TON","Gram","GRAM","TON",Number(assetPrices.TON||0),"https://cdn.simpleicons.org/ton"],["SOL","Solana","SOL","Internal",Number(assetPrices.SOL||0),"https://cdn.simpleicons.org/solana"],["BNB","BNB","BNB","Internal",Number(assetPrices.BNB||0),"https://cdn.simpleicons.org/binance"]].map(([asset,label,symbol,network,price,icon])=>({asset,label,symbol,network,price,icon}));
  const balances=supported.map(asset=>({...asset,wallet:account.wallets.find(w=>w.asset===asset.asset)})),fromAsset=balances.find(i=>i.asset===swapFrom)||balances[1],toAsset=balances.find(i=>i.asset===swapTo)||balances[0],numericSwap=Number(swapAmount||0);
  const receiveQuote=numericSwap>0&&fromAsset.price>0&&toAsset.price>0?numericSwap*fromAsset.price/toAsset.price:0;
  async function submitSwap(e){e.preventDefault();setNotice("");if(!Number.isFinite(numericSwap)||numericSwap<=0)return setNotice("Enter a valid amount.");if(swapFrom===swapTo)return setNotice("Choose two different assets.");if(numericSwap>Number(fromAsset.wallet?.available_balance||0))return setNotice("Insufficient available balance.");setBusy(true);try{const {data,error}=await supabase.functions.invoke("swap-assets",{body:{from_asset:swapFrom,to_asset:swapTo,amount:numericSwap}});if(error||data?.error)throw new Error(data?.error||error?.message||"Swap failed.");await refreshAccount();onClose()}catch(error){setNotice(error.message||"Swap failed.")}finally{setBusy(false)}}
  async function submitWithdrawal(e){e.preventDefault();setNotice("");const numericAmount=Number(amount);if(!Number.isFinite(numericAmount)||numericAmount<=0)return setNotice("Enter a valid withdrawal amount.");if(!address.trim())return setNotice("Enter the destination wallet address.");setBusy(true);try{const wallet=account.wallets.find(item=>item.asset===selectedAsset);const {data,error}=await supabase.functions.invoke("request-withdrawal",{body:{asset:selectedAsset,network:wallet?.network,amount:numericAmount,address:address.trim()}});if(error||data?.error)throw new Error(data?.error||error?.message||"Withdrawal request failed.");await refreshAccount();onClose()}catch(error){setNotice(error.message||"Withdrawal request failed.")}finally{setBusy(false)}}
  return <div className="auth-modal-backdrop" onClick={onClose}><div className="wallet-action-modal" onClick={e=>e.stopPropagation()}><button className="auth-close" onClick={onClose} aria-label="Close">×</button>
    {action==="deposit"&&<><div className="eyebrow">DEPOSIT</div><h2>Fund your FLEXAR wallet.</h2><p>Send only on the network shown for each asset. Deposits are credited after verification.</p><div className="wallet-network-list">{Object.entries(walletInfo?.deposit_addresses||{}).map(([asset,info])=><div className="wallet-address-card" key={asset}><strong>{asset==="TON"?"GRAM":asset}</strong><small>{info?.network||"Network"}</small><code>{info?.address||"Deposit address is being configured."}</code>{info?.address&&<button type="button" onClick={()=>navigator.clipboard?.writeText(info.address)}>Copy address</button>}</div>)}{!walletInfo&&<div className="empty-state"><strong>Loading deposit details…</strong></div>}</div></>}
    {action==="withdraw"&&<><div className="eyebrow">WITHDRAW</div><h2>Withdraw funds</h2><p>Move supported assets from your FLEXAR wallet to an external destination.</p><div className="withdrawal-balance-card"><div><small>AVAILABLE BALANCE</small><strong>{Number(balances.find(a=>a.asset===selectedAsset)?.wallet?.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:6})}</strong></div><span>{balances.find(a=>a.asset===selectedAsset)?.symbol||selectedAsset}</span></div><form className="withdrawal-form" onSubmit={submitWithdrawal}><label>Asset<select value={selectedAsset} onChange={e=>setSelectedAsset(e.target.value)}>{balances.filter(a=>["USDT","TON"].includes(a.asset)&&Number(a.wallet?.available_balance||0)>0).map(a=><option key={a.asset} value={a.asset}>{a.symbol}</option>)}</select></label><label>Amount<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></label><label>Destination wallet address<textarea value={address} onChange={e=>setAddress(e.target.value)} placeholder="Paste the destination address"/></label><div className="withdrawal-note"><span>●</span><span>Double-check the destination address and network before submitting. Withdrawals are sent to the address you provide.</span></div><button className="withdrawal-submit" disabled={busy}>{busy?"Submitting…":"Review withdrawal →"}</button></form></>}
    {action==="swap"&&<><div className="eyebrow">PORTFOLIO SWAP</div><h2>Swap between your assets.</h2><p>Internal portfolio conversion uses current market reference prices and updates both balances atomically.</p><form onSubmit={submitSwap}><div className="swap-box"><small>You pay</small><div><input inputMode="decimal" value={swapAmount} onChange={e=>setSwapAmount(e.target.value)} placeholder="0.00"/><select value={swapFrom} onChange={e=>setSwapFrom(e.target.value)}>{balances.map(a=><option key={a.asset} value={a.asset}>{a.symbol}</option>)}</select></div><span>Available {Number(fromAsset.wallet?.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:6})} {fromAsset.symbol}</span></div><button type="button" className="swap-flip" onClick={()=>{setSwapFrom(swapTo);setSwapTo(swapFrom)}}>↓</button><div className="swap-box"><small>You receive</small><div><strong>{receiveQuote.toLocaleString(undefined,{maximumFractionDigits:8})}</strong><select value={swapTo} onChange={e=>setSwapTo(e.target.value)}>{balances.map(a=><option key={a.asset} value={a.asset}>{a.symbol}</option>)}</select></div><span>1 {fromAsset.symbol} ≈ {(fromAsset.price/toAsset.price||0).toLocaleString(undefined,{maximumFractionDigits:8})} {toAsset.symbol}</span></div><button className="swap-submit" disabled={busy}>{busy?"Swapping…":"Swap now →"}</button></form></>}
    {notice&&<div className="notice" role="status">{notice}</div>}
  </div></div>;
}
function Referral({ account, profile }) {
  const [info, setInfo] = useState("");
  const code=profile?.referral_code||"—";
  const link=code==="—"?"":window.location.origin+"/?ref="+encodeURIComponent(code);
  const referrals=account.referrals||[];
  const claimBonus=referrals.reduce((sum,item)=>sum+Number(item.referral_rewards?.[0]?.claim_bonus_amount||0),0);
  const depositCommission=referrals.reduce((sum,item)=>sum+Number(item.referral_rewards?.[0]?.deposit_commission_amount||0),0);
  const earned=referrals.reduce((sum,item)=>sum+Number(item.reward_amount||0),0);
  const copy=async value=>{if(!value)return;try{await navigator.clipboard.writeText(value)}catch{}};
  const infoContent={
    claim:{eyebrow:"$2 REWARD CLAIM BONUS",title:"Earn $2 when they claim.",body:"When someone joins FLEXAR through your referral and successfully claims the $50 promotional reward, you receive a one-time $2 referral bonus. Claiming the $50 reward is separate from making a deposit."},
    deposit:{eyebrow:"10% DEPOSIT COMMISSION",title:"Earn from referred deposits.",body:"You earn 10% when a referred user makes a qualifying deposit. This commission is tied to their deposit activity — it is not triggered by simply claiming the $50 promotional reward."},
    campaign:{eyebrow:"$50 PROMOTIONAL REWARD",title:"The reward has an expiry.",body:"The $50 promotional reward is time-limited. Users should claim and use it before the expiry shown in their account. The reward itself is non-withdrawable; eligible profit rules are shown in FLEXAR."}
  };
  return <div className="referral-page">
    <section className="referral-hero referral-catalyst">
      <div className="referral-catalyst-copy"><small>AFFILIATE NETWORK</small><h1>Grow FLEXAR.<br/><span>Earn with every referral.</span></h1><p>Share your personal FLEXAR link and earn when your referred users take qualifying actions.</p></div>
      <div className="referral-earning-strip">
        <article><div><strong>$2</strong><span>per referred user</span></div><button type="button" className="referral-info-button" onClick={()=>setInfo("claim")} aria-label="Explain the $2 referral bonus">ⓘ</button><p>When they claim the <b>$50 reward</b>.</p></article>
        <article><div><strong>10%</strong><span>of qualifying deposits</span></div><button type="button" className="referral-info-button" onClick={()=>setInfo("deposit")} aria-label="Explain the 10 percent deposit commission">ⓘ</button><p>When a referred user <b>makes a deposit</b>.</p></article>
      </div>
      <div className="referral-link-box"><span>{link||"Your referral link will appear here."}</span><button onClick={()=>copy(link)} disabled={!link}>Share link →</button></div>
    </section>

    <section className="referral-stats"><div><small>PEOPLE REFERRED</small><strong>{referrals.length}</strong></div><div><small>REWARD CLAIMS</small><strong>{referrals.filter(item=>Number(item.referral_rewards?.[0]?.claim_bonus_amount||0)>0).length}</strong></div><div><small>EARNED</small><strong>{"$"+earned.toFixed(2)}</strong></div></section>

    <section className="referral-incentive referral-campaign-card">
      <div className="referral-incentive-copy"><small>WHY REFER</small><h2>One referral can create more than one earning event.</h2><p>Your referred user can trigger the <b>$2 reward-claim bonus</b> by claiming the $50 promotional reward, and can also generate <b>10% commission on qualifying deposits</b>. These are separate actions.</p><button type="button" className="referral-banner-cta" onClick={()=>copy(link)} disabled={!link}>Share your FLEXAR link →</button></div>
      <div className="referral-incentive-metrics"><div><span>CLAIM BONUS</span><strong>{"$"+claimBonus.toFixed(2)}</strong><small>from $50 reward claims</small></div><div><span>DEPOSIT COMMISSION</span><strong>{"$"+depositCommission.toFixed(2)}</strong><small>from referred deposits</small></div></div>
    </section>

    <section className="referral-section referral-explainer-grid">
      <button type="button" className="referral-explainer-card" onClick={()=>setInfo("claim")}><div><span>$2</span><strong>Reward claim</strong><p>Earn when your referred user claims their $50 promotional reward.</p></div><b>ⓘ</b></button>
      <button type="button" className="referral-explainer-card" onClick={()=>setInfo("deposit")}><div><span>10%</span><strong>Qualifying deposit</strong><p>Earn when your referred user makes a qualifying deposit.</p></div><b>ⓘ</b></button>
      <button type="button" className="referral-explainer-card" onClick={()=>setInfo("campaign")}><div><span>$50</span><strong>Promotional reward</strong><p>The reward is time-limited, so referred users should watch their expiry.</p></div><b>ⓘ</b></button>
    </section>

    <section className="referral-section"><div className="section-heading"><div><small>YOUR CODE</small><h2>{code}</h2></div><button className="asset-swap-link" onClick={()=>copy(code)}>Copy code</button></div><p>Use your code anywhere you promote FLEXAR. Your link automatically attributes new registrations to your network.</p></section>
    <section className="referral-section referral-steps"><div><span>01</span><div><strong>Share</strong><p>Post your referral link to your community, content or private network.</p></div></div><div><span>02</span><div><strong>Activate</strong><p>Your referred user joins and takes a qualifying action.</p></div></div><div><span>03</span><div><strong>Earn</strong><p>Your eligible referral earnings are credited to your FLEXAR wallet.</p></div></div></section>
    <section className="referral-section"><div className="section-heading"><div><small>NETWORK ACTIVITY</small><h2>Your referrals</h2></div></div>{referrals.length?<div className="list">{referrals.map((item,index)=><div className="row" key={item.id||index}><span>Referral {index+1}<small>{Number(item.referral_rewards?.[0]?.claim_bonus_amount||0)>0?"$2 claim bonus · ":""}{Number(item.referral_rewards?.[0]?.deposit_commission_amount||0)>0?"10% deposit commission · ":""}{item.status}</small></span><strong className="green">{"$"+Number(item.reward_amount||0).toFixed(2)}</strong></div>)}</div>:<div className="empty-state"><strong>Your network is empty.</strong><p>Share your link to start building your FLEXAR affiliate network.</p></div>}</section>
    {info&&<ReferralInfoModal type={info} content={infoContent[info]} onClose={()=>setInfo("")}/>}
  </div>;
}
function ReferralInfoModal({ content, onClose }) {
  return <div className="referral-info-backdrop" onClick={onClose}><section className="referral-info-modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true"><button type="button" className="auth-close" onClick={onClose} aria-label="Close">×</button><small>{content.eyebrow}</small><h2>{content.title}</h2><p>{content.body}</p><button type="button" className="referral-info-close" onClick={onClose}>Got it</button></section></div>;
}

function AdminDashboard({ onExit }) {
  const [data,setData]=useState(null), [tab,setTab]=useState("overview"), [busy,setBusy]=useState(false), [error,setError]=useState("");
  const load=useCallback(async()=>{if(!supabase)return;setBusy(true);const result=await supabase.functions.invoke("admin-control",{body:{action:"overview"}});setBusy(false);if(result.error||result.data?.error)setError(result.data?.error||result.error?.message||"Could not load admin data.");else{setError("");setData(result.data);}},[]);
  useEffect(()=>{load();},[load]);
  async function act(action,payload={}){setBusy(true);const result=await supabase.functions.invoke("admin-control",{body:{action,...payload}});setBusy(false);if(result.error||result.data?.error){setError(result.data?.error||result.error?.message||"Action failed.");return false;}await load();return true;}
  if(!data)return <div className="admin-shell"><header className="admin-header"><div><small>FLEXA AI CONTROL CENTER</small><h1>Admin Dashboard</h1></div></header><div className="admin-card">{error||"Loading control center…"}</div></div>;
  const users=data.users||[], tx=data.transactions||[], trades=data.trades||[], opp=data.opportunities||[], markets=data.markets||[], plans=data.plans||[], subs=data.subscriptions||[], learning=data.learning||[], adaptive=data.adaptive||[], wallets=data.wallets||[];
  const won=learning.filter(x=>x.outcome==="won").length, lost=learning.filter(x=>x.outcome==="lost").length;
  const money=tx.filter(x=>x.direction==="credit"&&x.status==="completed").reduce((s,x)=>s+Number(x.amount||0),0);
  const tabs=[["overview","Overview"],["users","Users"],["wallets","Wallets"],["transactions","Transactions"],["trading","Trading"],["markets","Markets"],["ai","AI Engine"],["subscriptions","Subscriptions"],["settings","Settings"]];
  return <div className="admin-shell"><header className="admin-header"><div><small>FLEXA AI CONTROL CENTER</small><h1>Admin Dashboard</h1><p>Users, money flow, trading, AI intelligence and product controls.</p></div><button className="secondary" onClick={onExit}>Exit admin</button></header>
  <div className="admin-tabs">{tabs.map(t=><button key={t[0]} className={tab===t[0]?"active":""} onClick={()=>setTab(t[0])}>{t[1]}</button>)}</div>{error&&<div className="admin-alert">{error}</div>}
  {tab==="overview"&&<><div className="admin-kpis"><Kpi label="Users" value={users.length}/><Kpi label="Transactions" value={tx.length}/><Kpi label="Trading records" value={trades.length}/><Kpi label="AI opportunities" value={opp.length}/><Kpi label="Learning rows" value={learning.length}/><Kpi label="Credit volume" value={money.toFixed(2)}/></div><div className="admin-grid"><AdminPanel title="Engine health"><p>Markets: <b>{markets.filter(x=>x.active).length}/{markets.length}</b> active</p><p>Adaptive profiles: <b>{adaptive.length}</b></p><p>Learning outcomes: <b>{won} wins / {lost} losses</b></p><p>Model: <b>opportunity-v2</b></p></AdminPanel><AdminPanel title="Recent activity">{tx.slice(0,8).map(x=><div className="admin-row" key={x.id}><span>{x.type}</span><b>{x.direction} {Number(x.amount).toFixed(2)}</b></div>)}</AdminPanel></div></>}
  {tab==="users"&&<AdminTable title="Users" columns={["Name","Email","Provider","Joined","Admin"]}>{users.map(x=><div className="admin-row" key={x.id}><span>{x.display_name||x.telegram_username||"User"}<small>{x.id.slice(0,8)}…</small></span><span>{x.email||"—"}</span><span>{x.last_login_provider||"—"}</span><span>{new Date(x.created_at).toLocaleDateString()}</span><button className="mini-action" onClick={()=>act("set_user_admin",{user_id:x.id,is_admin:!x.is_admin})}>{x.is_admin?"Remove":"Make admin"}</button></div>)}</AdminTable>}
  {tab==="wallets"&&<AdminWallets wallets={wallets} users={users} onAction={act}/>}
  {tab==="transactions"&&<AdminTable title="Financial activity" columns={["Type","Direction","Amount","Status","Time"]}>{tx.map(x=><div className="admin-row" key={x.id}><span>{x.type}</span><span>{x.direction}</span><span>{Number(x.amount).toFixed(4)}</span><span>{x.status}</span><span>{new Date(x.created_at).toLocaleString()}</span></div>)}</AdminTable>}
  {tab==="trading"&&<AdminTable title="Trading activity" columns={["Asset","Direction","Stake","Status","Result","Opened"]}>{trades.map(x=><div className="admin-row" key={x.id}><span>{x.asset}</span><span>{x.direction}</span><span>{Number(x.stake).toFixed(2)}</span><span>{x.status}</span><span>{x.result_amount??"—"}</span><span>{new Date(x.opened_at).toLocaleString()}</span></div>)}</AdminTable>}
  {tab==="markets"&&<AdminTable title="Market controls" columns={["Pair","Type","Source","Active","Tradable"]}>{markets.map(x=><div className="admin-row" key={x.symbol}><span><b>{x.display_symbol}</b><small>{x.symbol}</small></span><span>{x.market_type}</span><span>{x.source}</span><button className="mini-action" onClick={()=>act("update_market",{symbol:x.symbol,active:!x.active})}>{x.active?"Disable":"Enable"}</button><button className="mini-action" onClick={()=>act("update_market",{symbol:x.symbol,tradable:!x.tradable})}>{x.tradable?"Tradable":"Locked"}</button></div>)}</AdminTable>}
  {tab==="ai"&&<><AdminTable title="Latest AI opportunities" columns={["Pair","Direction","Confidence","Status","Outcome"]}>{opp.slice(0,50).map(x=><div className="admin-row" key={x.id}><span>{x.symbol}</span><span>{x.direction}</span><span>{Math.round(Number(x.signal_score)*100)}%</span><span>{x.status}</span><span>{x.outcome||"pending"}</span></div>)}</AdminTable><AdminTable title="Adaptive model profiles" columns={["Pair","Samples","Weights","Floor"]}>{adaptive.map(x=><div className="admin-row" key={x.id}><span>{x.symbol}</span><span>{x.sample_size}</span><span>{JSON.stringify(x.weights)}</span><span>{x.confidence_floor}</span></div>)}</AdminTable></>}
  {tab==="subscriptions"&&<><div className="admin-kpis"><Kpi label="Plans" value={plans.length}/><Kpi label="Active subscriptions" value={subs.filter(x=>x.status==="active").length}/><Kpi label="Trials" value={subs.filter(x=>x.status==="trialing").length}/></div><AdminTable title="Plans" columns={["Plan","Monthly","Quarterly","Annual","Trial","Status"]}>{plans.map(x=><div className="admin-row" key={x.id}><span><b>{x.name}</b><small>{x.code}</small></span><span>${x.monthly_price}</span><span>${x.quarterly_price}</span><span>${x.annual_price}</span><span>{x.trial_days} days</span><button className="mini-action" onClick={()=>act("update_plan",{id:x.id,patch:{active:!x.active}})}>{x.active?"Active":"Off"}</button></div>)}</AdminTable><AdminTable title="Recent subscriptions" columns={["User","Status","Cycle","Ends"]}>{subs.slice(0,50).map(x=><div className="admin-row" key={x.id}><span>{x.user_id.slice(0,8)}…</span><span>{x.status}</span><span>{x.billing_cycle}</span><span>{x.ends_at?new Date(x.ends_at).toLocaleDateString():"—"}</span></div>)}</AdminTable></>}
  {tab==="settings"&&<AdminSettings settings={data.settings} onSave={act}/>} {busy&&<div className="admin-busy">Updating…</div>}</div>;
}
function Kpi({label,value}){return <div className="admin-kpi"><small>{label}</small><strong>{value}</strong></div>}
function AdminPanel({title,children}){return <section className="admin-card"><div className="admin-section-title"><h2>{title}</h2></div>{children}</section>}
function AdminTable({title,columns,children}){return <section className="admin-card"><div className="admin-section-title"><h2>{title}</h2></div><div className="admin-table-head">{columns.map(x=><span key={x}>{x}</span>)}</div>{children}</section>}
function AdminWallets({wallets,users,onAction}){
  const [userId,setUserId]=useState(users.find(x=>x.is_admin)?.id||"");
  const [amount,setAmount]=useState("");
  const [direction,setDirection]=useState("credit");
  const [reason,setReason]=useState("Admin wallet adjustment");
  const selected=(wallets||[]).filter(w=>w.user_id===userId);
  async function submit(e){e.preventDefault();const value=Number(amount);if(!userId||!Number.isFinite(value)||value<=0)return;const ok=await onAction("adjust_wallet",{user_id:userId,asset:"USDT",network:"TRC-20",amount:value,direction,reason});if(ok)setAmount("");}
  return <><section className="admin-card"><div className="admin-section-title"><div><h2>Wallet controls</h2><p className="helper">Server-side wallet adjustments are recorded in the ledger. Admin/test accounts cannot withdraw.</p></div></div>
    <form className="admin-setting" onSubmit={submit}><label>User</label><select value={userId} onChange={e=>setUserId(e.target.value)}>{users.map(u=><option key={u.id} value={u.id}>{u.display_name||u.email||u.id.slice(0,8)}{u.is_admin?" · ADMIN":""}</option>)}</select><label>Amount USDT</label><input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="5000"/><label>Action</label><select value={direction} onChange={e=>setDirection(e.target.value)}><option value="credit">Credit available balance</option><option value="debit">Debit available balance</option></select><label>Reason</label><input value={reason} onChange={e=>setReason(e.target.value)}/><button className="mini-action" type="submit">Apply adjustment</button></form></section>
    <AdminTable title="Wallet balances" columns={["User","Asset","Network","Available","Locked"]}>{wallets.map(w=><div className="admin-row" key={w.id}><span>{users.find(u=>u.id===w.user_id)?.display_name||w.user_id.slice(0,8)+"…"}</span><span>{w.asset}</span><span>{w.network}</span><span>{Number(w.available_balance).toFixed(4)}</span><span>{Number(w.locked_balance).toFixed(4)}</span></div>)}</AdminTable></>;
}
function AdminSettings({settings,onSave}){const [values,setValues]=useState(Object.fromEntries((settings||[]).map(x=>[x.key,JSON.stringify(x.value)])));return <AdminPanel title="Application controls"><p className="helper">Central product settings can be changed here without rebuilding the frontend.</p>{Object.entries(values).map(([key,value])=><div className="admin-setting" key={key}><label>{key}</label><input value={value} onChange={e=>setValues({...values,[key]:e.target.value})}/><button className="mini-action" onClick={()=>{try{onSave("update_setting",{key,value:JSON.parse(value)})}catch{}}}>Save</button></div>)}</AdminPanel>}

function OpportunityCard({ item, setPage }) {
  const score = Math.round(Number(item.signal_score || 0) * 100);
  const direction = item.direction === "down" ? "DOWN" : "UP";
  return <article className="opportunity-card ai-opportunity-card">
    <div className="ai-opportunity-label">FLEXAR AI SELECTED</div>
    <div className="opp-top">
      <div><small>{item.symbol}</small><strong>AI trade suggestion</strong></div>
      <span className={direction === "UP" ? "green" : "red"}>{direction === "UP" ? "↗ UP" : "↘ DOWN"}</span>
    </div>
    <div className="ai-opportunity-direction">
      <span>AI expects the market to move</span>
      <strong className={direction === "UP" ? "green" : "red"}>{direction}</strong>
    </div>
    <div className="opp-meta"><span>{score}% signal</span><span>Risk managed</span><span>{item.status.toUpperCase()}</span></div>
    <button onClick={() => { try { sessionStorage.setItem("flexa_open_ai_trade", "true"); } catch {} setPage("trade"); }}>Trade this AI setup →</button>
  </article>;
}
function money(value, digits=2) {
  return Number(value||0).toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
function signedMoney(value) {
  const n=Number(value||0);
  return `${n>=0?"+":"−"}$${money(Math.abs(n))}`;
}
function transactionLabel(type) {
  return String(type||"transaction").replace(/_/g," ").replace(/\\b\\w/g,(m)=>m.toUpperCase());
}
function ActivityRows({ account, limit=8 }) {
  const items=[...(account.transactions||[])].slice(0,limit);
  if(!items.length) return <div className="empty-state"><strong>No wallet activity yet</strong><p>Your deposits, trade movements, withdrawals and other wallet activity will appear here.</p></div>;
  return <div className="activity-ledger-list">{items.map((item)=>{
    const amount=Number(item.amount||0);
    const pnl=item.metadata?.pnl!==undefined?Number(item.metadata.pnl):null;
    const isCredit=item.direction==="credit";
    const isTradeReturn=["trade_profit","trade_loss"].includes(item.type);
    const title=isTradeReturn?(item.type==="trade_profit"?"Trade settled":"Trade loss"):transactionLabel(item.type);
    const primary=isTradeReturn&&pnl!==null?signedMoney(pnl):`${isCredit?"+":"−"}$${money(amount)}`;
    const detail=isTradeReturn&&pnl!==null?`Capital returned · ${new Date(item.created_at).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}`:`${item.status||"completed"} · ${new Date(item.created_at).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}`;
    return <div className="activity-ledger-row" key={item.id}>
      <div className={isCredit?"activity-ledger-icon credit":"activity-ledger-icon debit"}>{isCredit?"↑":"↓"}</div>
      <div className="activity-ledger-main"><strong>{title}</strong><small>{detail}</small></div>
      <div className="activity-ledger-value"><strong className={pnl!==null?(pnl>=0?"green":"red"):(isCredit?"green":"red")}>{primary}</strong>{isTradeReturn&&pnl!==null&&<small>NET P&L</small>}</div>
    </div>;
  })}</div>;
}


function TradeHistoryCard({ trade:t }) {
  const pnl=t.status==="active"?Number(t.unrealized_pnl||0):Number(t.result_amount||0)-Number(t.stake||0);
  const returned=t.status==="active"?null:Number(t.result_amount||0);
  return <article className="trade-history-card"><div className="trade-history-head"><div><strong>{t.metadata?.market_symbol||t.asset}</strong><span className={t.direction==="up"?"green":"red"}>{t.direction==="up"?"↗ LONG":"↘ SHORT"}</span></div><span className={t.status==="won"?"trade-status win":t.status==="lost"?"trade-status loss":"trade-status live"}>{t.status==="won"?"WON":t.status==="lost"?"LOSS":"ACTIVE"}</span></div><div className="trade-history-main"><div><small>CAPITAL</small><strong>{"$"+money(t.stake)}</strong></div><div><small>LEVERAGE</small><strong>{Number(t.leverage||1).toFixed(0)}×</strong></div><div className="trade-history-pnl"><small>{t.status==="active"?"LIVE P&L":"NET P&L"}</small><strong className={pnl>=0?"green":"red"}>{signedMoney(pnl)}</strong></div></div><div className="trade-history-footer"><span>{new Date(t.opened_at).toLocaleDateString()} · {new Date(t.opened_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span>{returned!==null&&<span>Returned {"$"+money(returned)}</span>}<span>{t.risk_profile?String(t.risk_profile).toUpperCase():"RISK MANAGED"}</span></div></article>;
}

function ActivityDetailPage({ account, type, onBack }) {
  const isTrades=type==="trades";
  const items=isTrades?(account.trades||[]):(account.transactions||[]);
  return <div className="activity-page activity-detail-page">
    <button type="button" className="activity-back-button" onClick={onBack}>← Back to Activity</button>
    <section className="intro activity-intro"><div className="activity-intro-copy"><small>{isTrades?"TRADE HISTORY":"WALLET LEDGER"}</small><h1>{isTrades?"Recent trades.":"Recent transactions."}</h1><p>{isTrades?"Review every trade, including active positions and completed results.":"Review every wallet movement, deposit, withdrawal and trade settlement."}</p></div><div className="activity-intro-watermark" aria-hidden="true" /></section>
    <section className="activity-section"><div className="section-heading"><div><small>{isTrades?"ALL TRADES":"ALL TRANSACTIONS"}</small><h2>{isTrades?"Trade history":"Transaction history"}</h2></div><span className="activity-section-count">{items.length}</span></div>{isTrades?(items.length?<div className="trade-history-list">{items.map(t=><TradeHistoryCard key={t.id} trade={t}/>)}</div>:<div className="empty-state"><strong>No trades yet</strong><p>Your completed and active trades will appear here.</p></div>):<ActivityRows account={{...account,trades:[]}}/>}</section>
  </div>;
}

function PairIcon({ symbol, cryptoIcons = {} }) {
  if (symbol === "XRPUSDT") {
    return <span className="market-icon pair-icon crypto-pair xrp-pair" aria-label="XRP">
      <img src="/xrp.svg" alt="XRP" />
    </span>;
  }
  const cryptoIcon = cryptoIcons[symbol];
  if (cryptoIcon) return <span className="market-icon pair-icon crypto-pair"><img src={cryptoIcon} alt="" loading="lazy" /></span>;
  const forex = {
    EURUSD: ["🇪🇺", "🇺🇸"],
    GBPUSD: ["🇬🇧", "🇺🇸"],
    USDJPY: ["🇺🇸", "🇯🇵"],
    AUDUSD: ["🇦🇺", "🇺🇸"],
  }[symbol];
  if (!forex) return <span className="market-icon pair-icon"><b>{symbol?.slice(0,3) || "FX"}</b></span>;
  return <span className="market-icon pair-icon forex-pair" aria-label={symbol}>
    <span>{forex[0]}</span><i>{forex[1]}</i>
  </span>;
}

const AI_CREDIT_PLANS = [{credits:5,price:8,bonus:0},{credits:10,price:15,bonus:1},{credits:20,price:28,bonus:3},{credits:30,price:40,bonus:5},{credits:50,price:62,bonus:10},{credits:75,price:85,bonus:20},{credits:100,price:100,bonus:30}];

function AICreditsPage({ profile, onBack, refreshAccount }) {
  const [busyPlan,setBusyPlan]=useState(0),[notice,setNotice]=useState("");
  const balance=Number(profile?.ai_credits||0);
  async function buy(plan){if(!supabase||busyPlan)return;setBusyPlan(plan.credits);setNotice("");try{const {data,error}=await supabase.functions.invoke("ai-credits",{body:{action:"buy",credits:plan.credits,price_usd:plan.price}});if(error||data?.error)throw new Error(data?.error||error?.message||"Could not buy AI credits.");setNotice(`${Number(data.credits_added||plan.credits+plan.bonus)} AI credits added. Your balance is now ${Number(data.credits_remaining||0).toFixed(1)}.`);window.dispatchEvent(new CustomEvent("flexar-ai-credits-updated"));await refreshAccount()}catch(error){setNotice(error.message||"Could not buy AI credits.")}finally{setBusyPlan(0)}}
  return <div className="ai-credits-page"><button type="button" className="ai-credits-back" onClick={onBack}>← Back to AI Trading</button><section className="ai-credits-hero"><div><small>FLEXAR AI ACCESS</small><h1>AI Credits</h1><p>Power more AI market scans with discounted packages and bonus credits.</p></div><div className="ai-credits-balance"><small>YOUR BALANCE</small><strong>{balance.toFixed(1)}</strong><span>credits remaining</span></div></section>{notice&&<div className="notice ai-credits-notice" role="status">{notice}</div>}<section className="ai-credit-plans"><div className="ai-credits-section-head"><div><small>CHOOSE A PACKAGE</small><h2>More credits. Better value.</h2></div><span>1 AI trade = 1.5 credits</span></div><div className="ai-credit-plan-grid">{AI_CREDIT_PLANS.map(plan=>{const total=plan.credits+plan.bonus,regular=plan.credits*8/5,discount=regular>plan.price?Math.round((1-plan.price/regular)*100):0;return <article className={plan.credits===50?"ai-credit-plan featured":"ai-credit-plan"} key={plan.credits}>{plan.credits===50&&<div className="ai-plan-badge">POPULAR</div>}<div className="ai-plan-top"><span>{plan.credits} credits</span>{discount>0&&<b>Save {discount}%</b>}</div><strong className="ai-plan-price">${plan.price}</strong><span className="ai-plan-total">{total} total credits {plan.bonus>0&&<em>+{plan.bonus} bonus</em>}</span><span className="ai-plan-run-count">Up to {Math.floor(total/1.5)} full AI scans</span><button type="button" onClick={()=>buy(plan)} disabled={Boolean(busyPlan)}>{busyPlan===plan.credits?"Processing…":`Buy ${total} credits →`}</button></article>})}</div></section><section className="ai-credits-note"><strong>How credits work</strong><p>Each time FLEXAR AI opens a trade, 1.5 credits are consumed. Your credits stay available until you use them, so larger packages give you more trading capacity at a lower effective cost.</p></section></div>;
}

function Trade({ account, profile, startAiScan, aiScanning, aiEngineActive, onOpenCredits, onActivationChange, onStopAi }) {
  const [amount,setAmount]=useState("25"),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const [mode,setMode]=useState(()=>{try{return sessionStorage.getItem("flexa_ai_mode")||"manual"}catch{return "manual"}});
  const [modeOpen,setModeOpen]=useState(false),[aiCreditInfo,setAiCreditInfo]=useState(false),[activationMode,setActivationMode]=useState("");
  const [autoStake,setAutoStake]=useState(()=>{try{return sessionStorage.getItem("flexa_ai_auto_stake")||"25"}catch{return "25"}});
  const [autoBusy,setAutoBusy]=useState(false),[detailsExpanded,setDetailsExpanded]=useState(false),[selectedOpportunityId,setSelectedOpportunityId]=useState("");
  const [autoTradeOpportunityId,setAutoTradeOpportunityId]=useState(()=>{try{return sessionStorage.getItem("flexa_ai_auto_opportunity_id")||""}catch{return ""}});
  const availableOpportunities=(aiEngineActive?(account.opportunities||[]):[]).filter(item=>["scheduled","open"].includes(item.status)).filter(item=>{const end=new Date(item.entry_window_end||0).getTime(),start=new Date(item.entry_window_start||0).getTime(),now=Date.now();return Number.isFinite(end)&&end>now&&Number.isFinite(start)&&start<=now});
  const opportunities=availableOpportunities.slice(0,2);
  const selectedOpportunity=opportunities.find(item=>item.id===selectedOpportunityId)||opportunities[0]||null;
  const opportunity=mode==="autopilot"?(opportunities[0]||null):selectedOpportunity;
  const direction=opportunity?.direction==="down"?"DOWN":"UP",score=Math.round(Number(opportunity?.signal_score||0)*100),symbol=opportunity?.symbol||"—",price=Number(opportunity?.entry_price||0);
  const riskStyle=String(profile?.trading_style||"balanced").toLowerCase();
  const risk={conservative:{stop:.003,target:.006,breakEven:.003,maxHoldHours:4},balanced:{stop:.0045,target:.009,breakEven:.004,maxHoldHours:6},growth:{stop:.007,target:.012,breakEven:.006,maxHoldHours:8}}[riskStyle]||{stop:.0045,target:.009,breakEven:.004,maxHoldHours:6};
  const previewTakeProfit=price>0?price*(direction==="UP"?1+risk.target:1-risk.target):0;
  const previewStopLoss=price>0?price*(direction==="UP"?1-risk.stop:1+risk.stop):0;
  const activeTrades=(account.trades||[]).filter((trade)=>trade.status==="active");
  const activeTrade=activeTrades.find((trade)=>opportunity&&String(trade.metadata?.opportunity_id||"")===String(opportunity.id))||null;
  const activeTradeCount=activeTrades.length;
  const canOpenAnotherTrade=activeTradeCount<2;
  const usdt=account.wallets.find(item=>item.asset==="USDT"),reward=account.rewards?.find(item=>item.status==="active"),walletBalance=Number(usdt?.available_balance||0),bonusBalance=Number(reward?.remaining_reward||0),numericAmount=Number(amount),tradingFunds=walletBalance+bonusBalance,canTrade=Boolean(account.tradingAccess?.has_access)&&tradingFunds>=numericAmount&&canOpenAnotherTrade;
  useEffect(()=>{if(profile?.ai_trade_mode)setMode(profile.ai_trade_mode);if(profile?.ai_autopilot_stake)setAutoStake(String(profile.ai_autopilot_stake))},[profile?.ai_trade_mode,profile?.ai_autopilot_stake]);
  useEffect(()=>setDetailsExpanded(false),[opportunity?.id]);
  const cryptoIcons={BTCUSDT:"https://cdn.simpleicons.org/bitcoin",ETHUSDT:"https://cdn.simpleicons.org/ethereum",SOLUSDT:"https://cdn.simpleicons.org/solana",BNBUSDT:"https://cdn.simpleicons.org/binance",XRPUSDT:"https://cdn.simpleicons.org/xrp",DOGEUSDT:"https://cdn.simpleicons.org/dogecoin"},marketType=symbol.includes("USD")&&!symbol.includes("USDT")?"FOREX":"CRYPTO";
  function updateAmount(value){if(value===""||/^\d*(\.\d{0,2})?$/.test(value))setAmount(value)}
  async function chooseMode(nextMode){
    const requestedStake=Number(autoStake);
    if(nextMode==="autopilot"&&(!Number.isFinite(requestedStake)||requestedStake<=0)){
      setNotice("Set a valid Autopilot stake limit first.");
      return;
    }
    const stake=nextMode==="autopilot"?String(requestedStake):"";
    setMode(nextMode);
    setNotice("");
    try{
      sessionStorage.setItem("flexa_ai_mode",nextMode);
      if(nextMode==="autopilot") sessionStorage.setItem("flexa_ai_auto_stake",stake);
    }catch{}
    const { error: modeError } = await supabase.rpc("set_ai_trading_mode",{p_mode:nextMode,p_enabled:true,p_stake:requestedStake});
    if(modeError){setNotice(modeError.message||"Could not save the AI trading mode.");return;}
    setModeOpen(false);
    setActivationMode(nextMode);
    onActivationChange?.(true);
    if(!opportunity) startAiScan(true);
  }
  async function confirmAiTrade(){if(!supabase||busy||!canTrade||numericAmount<=0||!opportunity)return;setBusy(true);setNotice("");try{const {data,error}=await supabase.functions.invoke("execute-trade",{body:{mode:"ai",opportunity_id:opportunity.id,stake:numericAmount}});if(error){let message=error.message||"The AI trade could not be started.";try{const payload=await error.context?.json?.();message=payload?.error||payload?.message||message}catch{}throw new Error(message)}if(data?.error)throw new Error(data.error);const tradeResult=data?.trade||data||{};window.dispatchEvent(new CustomEvent("flexa-trade-started",{detail:{tradeId:tradeResult.trade_id||null,symbol:tradeResult.symbol||symbol,direction:tradeResult.direction||opportunity.direction,stake:Number(tradeResult.stake??numericAmount),maxHoldSeconds:Number(tradeResult.max_hold_seconds||0),fundingSource:tradeResult.funding_source||null,takeProfitPrice:tradeResult.take_profit_price||null,stopLossPrice:tradeResult.stop_loss_price||null,breakEvenPrice:tradeResult.break_even_price||null,trailingStopPrice:tradeResult.trailing_stop_price||null,riskProfile:tradeResult.risk_profile||riskStyle}}))}catch(error){setNotice(error.message||"The AI trade could not be started.") }finally{setBusy(false)}}
  useEffect(()=>{ if(mode!=="autopilot") setAutoBusy(false); },[mode]);
  return <div className="ai-trade-page"><section className="ai-page-hero compact"><div className="ai-hero-copy"><div className="engine-kicker"><span className="engine-pulse"/> FLEXAR AI TRADING BOT</div><h1>Start FLEXAR AI<br/><span>trading bot.</span></h1><p>Choose how FLEXAR should work for you: review every AI trade yourself, or let the bot execute within the stake limit you set.</p><div className="ai-credit-compact"><span className="ai-credit-label">AI CREDITS</span><strong>{Number(profile?.ai_credits||0).toFixed(0)}</strong><span className="ai-credit-unit">remaining</span><button type="button" className="ai-credit-info-button" onClick={()=>setAiCreditInfo(true)} aria-label="About FLEXAR AI credits">ⓘ</button>{Number(profile?.ai_credits||0)<=3&&<button type="button" className="ai-credit-add-button" onClick={onOpenCredits}>Add credits</button>}</div>{!opportunity&&<button type="button" className="ai-start-button hero-start" onClick={()=>setModeOpen(true)} disabled={aiScanning}>{aiScanning?"Scanning…":"Start FLEXAR AI trading bot →"}</button>}</div><div className="ai-engine-controls"><div className={aiEngineActive?"ai-engine-state active":"ai-engine-state"}><span className="engine-status-dot"/><div><small>BOT</small><strong>{aiEngineActive?"RUNNING":"STANDBY"}</strong></div></div>{aiEngineActive&&<button type="button" className="ai-stop-button" onClick={onStopAi}>Stop AI</button>}</div></section>
    {!opportunity?<><section className="ai-status-panel"><div><small>AI BOT STATUS</small><h2>{aiScanning?"Scanning the markets…":aiEngineActive?"FLEXAR is watching for a qualifying setup.":"Ready for your first AI setup."}</h2><p>{aiScanning?"Comparing live market conditions across supported instruments.":aiEngineActive?(mode==="autopilot"?"Autopilot is enabled. A qualifying setup will execute within your selected stake limit.":"Manual approval is enabled. You will review each AI trade before capital is used."):"The trading workspace is ready. Start the bot above and choose how FLEXAR should handle the next qualifying setup."}</p></div><span className={aiEngineActive?"status-pill live":"status-pill"}>{aiEngineActive?"LIVE":"READY"}</span></section><section className="ai-workspace-preview"><div className="workspace-preview-head"><div><small>TRADING WORKSPACE</small><h2>AI setup monitor</h2></div><span>10 MARKETS</span></div><div className="workspace-preview-grid"><div><small>MARKET</small><strong>BTC / USDT</strong><span>CRYPTO · LIVE</span></div><div><small>SIGNAL</small><strong>Waiting</strong><span>AI will surface the setup</span></div><div><small>POSITION</small><strong>{activeTradeCount}/2 ACTIVE</strong><span>FLEXAR manages open risk</span></div><div><small>STAKE</small><strong>{autoStake} USDT</strong><span>{mode==="autopilot"?"Autopilot limit":"Manual approval"}</span></div></div></section></>:<section className={activeTrade?"ai-trade-decision active":"ai-trade-decision"}><div className="decision-head"><div><small>{activeTrade?"AI TRADE · ACTIVE":"AI SIGNAL · READY FOR REVIEW"}</small><h2>{symbol}</h2><span>{direction==="UP"?"↗ LONG":"↘ SHORT"} · {score}% SIGNAL</span></div><div className="signal-score-large"><strong>{score}%</strong><small>CONFIDENCE</small></div></div><div className="decision-market-row"><div className="market-identity"><PairIcon symbol={symbol} cryptoIcons={cryptoIcons}/><div><strong>{symbol}</strong><small>{marketType}</small></div></div><div className={direction==="UP"?"signal-direction up":"signal-direction down"}>{direction==="UP"?"↗ UP":"↘ DOWN"}</div></div><div className="signal-level-grid compact-levels"><div><small>ENTRY</small><strong>{price.toLocaleString(undefined,{maximumFractionDigits:6})}</strong></div><div><small>INITIAL TARGET</small><strong>{previewTakeProfit?previewTakeProfit.toLocaleString(undefined,{maximumFractionDigits:6}):"AUTO"}</strong></div><div><small>INITIAL STOP</small><strong>{previewStopLoss?previewStopLoss.toLocaleString(undefined,{maximumFractionDigits:6}):"AUTO"}</strong></div><div><small>MAX HOLD</small><strong>{risk.maxHoldHours} H</strong></div></div><p className="ai-risk-preview-copy"><b>{riskStyle[0].toUpperCase()+riskStyle.slice(1)} risk:</b> the stop can move to break-even after the configured profit trigger, then trail the market so profitable trades can continue beyond the initial target.</p><div className="ai-mode-strip"><span>{mode==="autopilot"?"AUTOPILOT ACTIVE":"MANUAL APPROVAL"}</span><button type="button" onClick={()=>setModeOpen(true)}>Change mode</button></div><div className="active-ai-trade-summary"><div className="panel-heading"><div><small>POSITION STATUS</small><h3>Trade is active</h3></div><span className="capital-badge live">LIVE</span></div><div className="active-ai-metrics"><div><small>CAPITAL</small><strong>$ {Number(activeTrade?.stake||0).toFixed(2)}</strong></div><div><small>LIVE PROFIT</small><strong className={Number(activeTrade?.unrealized_pnl||0)>=0?"green":"red"}>{Number(activeTrade?.unrealized_pnl||0)>=0?"+":"−"}$ {Math.abs(Number(activeTrade?.unrealized_pnl||0)).toFixed(2)}</strong></div><div><small>LEVERAGE</small><strong>{Number(activeTrade?.leverage||1).toFixed(0)}×</strong></div><div><small>CONFIDENCE</small><strong>{Number(activeTrade?.metadata?.confidence_percent||score).toFixed(0)}%</strong></div></div><div className="active-ai-status"><span>ENTRY {Number(activeTrade?.entry_price||price).toLocaleString(undefined,{maximumFractionDigits:6})}</span><span>INITIAL TARGET {Number(activeTrade?.initial_take_profit_price||previewTakeProfit).toLocaleString(undefined,{maximumFractionDigits:6})}</span><span>INITIAL STOP {Number(activeTrade?.initial_stop_loss_price||previewStopLoss).toLocaleString(undefined,{maximumFractionDigits:6})}</span><span>MAX HOLD {risk.maxHoldHours} H</span></div><p className="active-ai-live-copy">FLEXAR is managing this position. Live profit updates as the market moves.</p></div><div className="decision-capital"><div className="panel-heading"><div><small>STAKE</small><h3>Choose your capital</h3></div><span className="capital-badge">USDT</span></div><div className="capital-summary"><div><small>AVAILABLE</small><strong>{tradingFunds.toLocaleString(undefined,{maximumFractionDigits:4})} USDT</strong></div><span>Wallet {walletBalance.toFixed(2)} · Bonus {bonusBalance.toFixed(2)} · {activeTradeCount}/2 active</span></div><div className="stake-presets">{["10","25","50","100"].map(v=><button type="button" key={v} className={amount===v?"selected":"choice"} onClick={()=>setAmount(v)} disabled={busy||!canOpenAnotherTrade}>$ {v}</button>)}</div><div className="amount-input-wrap"><span>$</span><input inputMode="decimal" value={amount} onChange={e=>updateAmount(e.target.value)} placeholder="0.00" aria-label="AI trade stake" disabled={busy||!canOpenAnotherTrade}/><small>USDT</small></div>{mode==="autopilot"?<div className="autopilot-notice">{autoBusy?"Autopilot is executing this qualifying setup…":activeTradeCount>=2?"Two positions are already active. FLEXAR will wait for an opening before taking another.":"Autopilot is enabled for this bot. Manual approval is not required for qualifying setups within your stake limit."}</div>:<button className="ai-approve-button decision-approve" disabled={busy||!canTrade||numericAmount<=0} onClick={confirmAiTrade}>{busy?"Opening AI trade…":activeTradeCount>=2?"Two positions already active":"Approve AI Trade →"}</button>}{notice&&<div className="notice" role="status">{notice}</div>}{!account.tradingAccess?.has_access&&<div className="subscription-lock"><b>Your trading access has ended.</b><span>Choose a FLEXAR Pro plan to continue trading.</span></div>}{account.tradingAccess?.has_access&&!canTrade&&numericAmount>0&&activeTradeCount<2&&<p className="helper">Your stake is higher than your available trading funds.</p>}</div></section>}
    {aiCreditInfo&&<div className="referral-info-backdrop" onClick={()=>setAiCreditInfo(false)}><section className="referral-info-modal ai-credit-info-modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true"><small>FLEXAR AI CREDITS</small><h2>How AI credits work</h2><p>Opening an AI trade uses <b>1.5 credits</b>. Your remaining credits stay available until used.</p><p>Need more? Larger packages include discounted pricing and bonus credits.</p><button type="button" onClick={()=>setAiCreditInfo(false)}>Got it</button></section></div>}
    {modeOpen&&<div className="auth-modal-backdrop ai-mode-backdrop" onClick={()=>setModeOpen(false)}><section className="wallet-action-modal ai-mode-modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-mode-title"><small>FLEXAR AI TRADING BOT</small><h2 id="ai-mode-title">How should FLEXAR trade?</h2><p>Choose how much control you want over each AI opportunity.</p><button type="button" className={mode==="manual"?"ai-mode-option selected":"ai-mode-option"} onClick={()=>chooseMode("manual")}><span><b>Manual approval</b><small>Review every AI setup and approve the trade yourself.</small></span><i>{mode==="manual"?"✓":"→"}</i></button><div className={mode==="autopilot"?"ai-mode-option selected":"ai-mode-option"} onClick={()=>setMode("autopilot")}><span><b>Autopilot</b><small>FLEXAR can execute a qualifying AI trade automatically using your stake limit.</small><label>Stake limit<input inputMode="decimal" value={autoStake} onChange={e=>{setAutoStake(e.target.value);try{sessionStorage.setItem("flexa_ai_auto_stake",e.target.value)}catch{}}} onClick={e=>e.stopPropagation()} /><em>USDT</em></label></span><i>{mode==="autopilot"?"✓":"→"}</i><button type="button" className="ai-mode-activate" onClick={e=>{e.stopPropagation();chooseMode("autopilot")}}>Enable Autopilot</button></div><small className="ai-mode-note">You can switch modes later. Autopilot only runs after you explicitly enable it and set a stake limit.</small></section></div>}

    {activationMode&&<div className="auth-modal-backdrop ai-activation-backdrop" onClick={()=>{setActivationMode("");onActivationChange?.(false)}}><section className="wallet-action-modal ai-activation-modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-activation-title">
      <div className="ai-activation-icon">✓</div>
      <small>FLEXAR AI ACTIVATED</small>
      <h2 id="ai-activation-title">{activationMode==="autopilot"?"Autopilot is active":"Manual approval is active"}</h2>
      <p>{activationMode==="autopilot"?"FLEXAR will automatically enter qualifying AI trades using the stake limit you approved.":"FLEXAR will find qualifying AI setups and pause for your approval before capital is used."}</p>
      <div className="ai-activation-summary">
        <div><span>MODE</span><strong>{activationMode==="autopilot"?"AUTOPILOT":"MANUAL APPROVAL"}</strong></div>
        {activationMode==="autopilot"&&<div><span>STAKE PER TRADE</span><strong>{Number(autoStake||0).toLocaleString(undefined,{maximumFractionDigits:2})} USDT</strong></div>}
        <div><span>AI CREDITS</span><strong>1.5 credits per trade</strong></div>
      </div>
      <div className="ai-activation-guidance">
        <strong>{activationMode==="autopilot"?"What happens next":"What you need to do"}</strong>
        <p>{activationMode==="autopilot"?"FLEXAR keeps monitoring the market and will execute qualifying setups within your approved stake limit.":"When FLEXAR finds a setup, review the market, direction and stake, then approve the trade when you are ready."}</p>
      </div>
      {typeof Notification!=="undefined"&&Notification.permission!=="granted"?<div className="ai-activation-notification">
        <div><strong>Stay notified</strong><p>Enable device notifications so FLEXAR can alert you when a setup or trade update needs your attention.</p></div>
        <button type="button" onClick={async()=>{try{const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;if(permission==="granted"){window.dispatchEvent(new CustomEvent("flexar-notifications-resolved"));onActivationChange?.(false);setActivationMode("");} }catch{}}}>Enable notifications</button>
      </div>:<div className="ai-activation-notification enabled"><div><strong>Notifications enabled</strong><p>FLEXAR can alert you about qualifying setups and trade updates.</p></div></div>}
      <button type="button" className="ai-activation-primary" onClick={()=>{setActivationMode("");onActivationChange?.(false)}}>Continue →</button>
    </section></div>}
    <section className="ai-markets-panel compact-markets"><div className="panel-heading"><div><small>SUPPORTED MARKETS</small><h2>Markets FLEXAR AI watches</h2><p>Crypto uses the original asset marks. Forex pairs use clear currency identifiers.</p></div></div><div className="market-grid">{["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","EURUSD","GBPUSD","USDJPY","AUDUSD"].map(item=><div className="market-chip" key={item}><PairIcon symbol={item} cryptoIcons={cryptoIcons}/><div><strong>{item}</strong><small>{item.includes("USD")&&!item.includes("USDT")?"Forex":"Crypto"}</small></div></div>)}</div></section><p className="engine-disclaimer">{mode==="autopilot"?"FLEXAR AI monitors qualifying setups and can execute within your configured stake limit.":"FLEXAR AI finds the setup. You review it and approve the capital."}</p>
  </div>;
}
function Chart() {
  const points="0,122 34,116 68,126 102,92 136,100 170,78 204,88 238,61 272,72 306,48 340,56 374,31 408,42 442,20";
  return <div className="chart-wrap" aria-label="Market price chart"><svg viewBox="0 0 442 150" preserveAspectRatio="none" role="img"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(124,255,156,.24)" /><stop offset="100%" stopColor="rgba(124,255,156,0)" /></linearGradient></defs><path d={`M 0 122 L 34 116 L 68 126 L 102 92 L 136 100 L 170 78 L 204 88 L 238 61 L 272 72 L 306 48 L 340 56 L 374 31 L 408 42 L 442 20 L 442 150 L 0 150 Z`} fill="url(#chartFill)" /><polyline points={points} fill="none" stroke="#7cff9c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><line x1="0" y1="128" x2="442" y2="128" stroke="rgba(124,255,156,.08)" /><line x1="0" y1="82" x2="442" y2="82" stroke="rgba(124,255,156,.08)" /><line x1="0" y1="36" x2="442" y2="36" stroke="rgba(124,255,156,.08)" /></svg></div>;
}

function Activity({ account, setPage }) {
  const trades=account.trades||[];
  const activeTrades=trades.filter(t=>t.status==="active");
  const wins=trades.filter(t=>t.status==="won").length;
  const losses=trades.filter(t=>t.status==="lost").length;
  const netProfit=trades.reduce((sum,t)=>sum+(t.status==="active"?Number(t.unrealized_pnl||0):Number(t.result_amount||0)-Number(t.stake||0)),0);
  const recentTrades=trades.slice(0,3);
  const recentTransactions=(account.transactions||[]).slice(0,3);
  return <div className="activity-page">
    <section className="intro activity-intro"><div className="activity-intro-copy"><small>ACTIVITY CENTER</small><h1>Track every move.</h1><p>See active positions, trade results and wallet movements without having to decode the numbers.</p></div><div className="activity-intro-watermark" aria-hidden="true" /></section>
    {activeTrades.length>0&&<section className="active-trades-card activity-feature-card"><div className="section-heading"><div><small>LIVE NOW · {activeTrades.length}/2 POSITIONS</small><h2>Active trades</h2></div><span className="live-badge">● ACTIVE</span></div><div className="activity-live-grid">{activeTrades.map(t=>{const pnl=Number(t.unrealized_pnl||0),entry=Number(t.entry_price||0),current=Number(t.current_price||0);return <article className="activity-live-trade" key={t.id}><div className="activity-trade-top"><div><strong>{t.metadata?.market_symbol||t.asset}</strong><span className={t.direction==="up"?"green":"red"}>{t.direction==="up"?"↗ LONG":"↘ SHORT"}</span></div><b className={pnl>=0?"green":"red"}>{signedMoney(pnl)}</b></div><div className="activity-trade-capital"><span>CAPITAL <strong>{"$"+money(t.stake)}</strong></span><span>LEVERAGE <strong>{Number(t.leverage||1).toFixed(0)}×</strong></span><span>ENTRY <strong>{entry?entry.toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</strong></span><span>NOW <strong>{current?current.toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</strong></span></div><div className="active-risk-row"><span>Target {t.initial_take_profit_price?Number(t.initial_take_profit_price).toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</span><span>Stop {t.trailing_stop_price?Number(t.trailing_stop_price).toLocaleString(undefined,{maximumFractionDigits:6}):t.initial_stop_loss_price?Number(t.initial_stop_loss_price).toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</span><span>Break-even {t.break_even_price?Number(t.break_even_price).toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</span></div><small className="activity-live-caption">Unrealized P&L · updates with the market</small></article>})}</div></section>}
    <section className="activity-stats activity-kpi-card"><div><span className="activity-stat-icon">↗</span><div><small>TRADES</small><strong>{trades.length}</strong></div></div><div><span className="activity-stat-icon">✓</span><div><small>WINS</small><strong>{wins}</strong></div></div><div><span className="activity-stat-icon">×</span><div><small>LOSSES</small><strong>{losses}</strong></div></div><div><span className="activity-stat-icon net" aria-hidden="true">Σ</span><div className="activity-stat-copy net-copy"><small>NET P&L</small><strong className={netProfit>=0?"green":"red"}>{signedMoney(netProfit)}</strong></div></div></section>
    <section className="activity-section"><div className="section-heading"><div><small>TRADE HISTORY</small><h2>Recent trades</h2></div><button type="button" className="activity-expand-button" onClick={()=>setPage("activity-trades")}>View all <span>→</span></button></div>{recentTrades.length?<div className="trade-history-list">{recentTrades.map(t=><TradeHistoryCard key={t.id} trade={t}/>)}</div>:<div className="empty-state"><strong>No trades yet</strong><p>Your completed and active trades will appear here.</p></div>}</section>

    <section className="activity-section"><div className="section-heading"><div><small>WALLET LEDGER</small><h2>Recent transactions</h2></div><button type="button" className="activity-expand-button" onClick={()=>setPage("activity-transactions")}>View all <span>→</span></button></div><ActivityRows account={{...account,trades:[]}} limit={3}/></section>
  </div>;
}
