import { Component, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./lib/supabase";
import { getTelegramWebApp } from "./lib/telegram";
import { getAccountData } from "./lib/data";
import { reportDiagnosticError } from "./lib/diagnostics";

const nav = [["home","⌂","Home"],["trade","✦","AI Trade"],["activity","◷","Activity"],["referral","↗","Referral"],["profile","◉","Profile"]];

const ONBOARDING_COUNTRY_CODES = "AF,AX,AL,DZ,AS,AD,AO,AI,AQ,AG,AR,AM,AW,AU,AT,AZ,BS,BH,BD,BB,BY,BE,BZ,BJ,BM,BT,BO,BQ,BA,BW,BV,BR,IO,BN,BG,BF,BI,CV,KH,CM,CA,KY,CF,TD,CL,CN,CX,CC,CO,KM,CG,CD,CK,CR,CI,HR,CU,CW,CY,CZ,DK,DJ,DM,DO,EC,EG,SV,GQ,ER,EE,SZ,ET,FK,FO,FJ,FI,FR,GF,PF,TF,GA,GM,GE,DE,GH,GI,GR,GL,GD,GP,GU,GT,GG,GN,GW,GY,HT,HM,VA,HN,HK,HU,IS,IN,ID,IR,IQ,IE,IM,IL,IT,JM,JP,JE,JO,KZ,KE,KI,KP,KR,KW,KG,LA,LV,LB,LS,LR,LY,LI,LT,LU,MO,MG,MW,MY,MV,ML,MT,MH,MQ,MR,MU,YT,MX,FM,MD,MC,MN,ME,MS,MA,MZ,MM,NA,NR,NP,NL,NC,NZ,NI,NE,NG,NU,NF,MK,MP,NO,OM,PK,PW,PS,PA,PG,PY,PE,PH,PN,PL,PT,PR,QA,RE,RO,RU,RW,BL,SH,KN,LC,MF,PM,VC,WS,SM,ST,SA,SN,RS,SC,SL,SG,SX,SK,SI,SB,SO,ZA,GS,SS,ES,LK,SD,SR,SJ,SE,CH,SY,TW,TJ,TZ,TH,TL,TG,TK,TO,TT,TN,TR,TM,TC,TV,UG,UA,AE,GB,US,UM,UY,UZ,VU,VE,VN,VG,VI,WF,EH,YE,ZM,ZW".split(",");
const ONBOARDING_COUNTRIES = ONBOARDING_COUNTRY_CODES.map((code) => ({
  code,
  name: new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code,
  flag: code.replace(/./g, (char) => String.fromCodePoint(char.charCodeAt(0) + 127397)),
})).sort((a, b) => a.name.localeCompare(b.name));



const ID_DOCUMENT_TYPES = {
  NG:[["national_id","National Identity Number (NIN) Card"],["passport","International Passport"],["drivers_license","Driver's Licence"],["voters_card","Voter's Card"],["residence_permit","Residence Permit"]],
  US:[["national_id","State-issued Photo ID"],["passport","U.S. Passport"],["drivers_license","Driver's License"],["residence_permit","Permanent Resident Card"]],
  GB:[["national_id","National Identity Document"],["passport","UK Passport"],["drivers_license","Photocard Driving Licence"],["residence_permit","Biometric Residence Permit / eVisa"]],
  CA:[["national_id","Provincial or Territorial Photo ID"],["passport","Canadian Passport"],["drivers_license","Provincial or Territorial Driver's Licence"],["residence_permit","Permanent Resident Card"]],
  IN:[["national_id","Aadhaar Card"],["passport","Indian Passport"],["drivers_license","Driving Licence"],["voters_card","Voter ID Card"]],
  GH:[["national_id","Ghana Card"],["passport","Ghanaian Passport"],["drivers_license","Driver's Licence"],["voters_card","Voter ID Card"]],
  KE:[["national_id","Kenyan National ID"],["passport","Kenyan Passport"],["drivers_license","Driving Licence"],["residence_permit","Alien Card / Residence Permit"]],
  ZA:[["national_id","South African Identity Document"],["passport","South African Passport"],["drivers_license","Driving Licence"],["residence_permit","Permanent Residence Permit"]],
  AU:[["national_id","State or Territory Photo ID"],["passport","Australian Passport"],["drivers_license","Driver Licence"],["residence_permit","Permanent Visa / Residence Document"]],
  NZ:[["national_id","Kiwi Access Card / Photo ID"],["passport","New Zealand Passport"],["drivers_license","Driver Licence"],["residence_permit","Residence Visa"]],
  PH:[["national_id","Philippine National ID (PhilSys)"],["passport","Philippine Passport"],["drivers_license","Driver's Licence"],["voters_card","Voter's ID"]],
  PK:[["national_id","CNIC / NICOP"],["passport","Pakistani Passport"],["drivers_license","Driving Licence"],["residence_permit","Residence Permit"]],
  BD:[["national_id","National Identity Card (NID)"],["passport","Bangladeshi Passport"],["drivers_license","Driving Licence"],["voters_card","Voter ID Card"]],
  BR:[["national_id","National Identity Card (CIN / RG)"],["passport","Brazilian Passport"],["drivers_license","CNH Driver's Licence"],["residence_permit","Residence Permit"]],
  MX:[["national_id","INE Voter Credential"],["passport","Mexican Passport"],["drivers_license","Driver's Licence"],["residence_permit","Residence Card"]],
  DE:[["national_id","Personalausweis (National ID)"],["passport","German Passport"],["drivers_license","EU Driving Licence"],["residence_permit","Aufenthaltstitel (Residence Permit)"]],
  FR:[["national_id","Carte nationale d'identité"],["passport","French Passport"],["drivers_license","Permis de conduire"],["residence_permit","Titre de séjour"]],
  ES:[["national_id","DNI (National Identity Document)"],["passport","Spanish Passport"],["drivers_license","Permiso de conducir"],["residence_permit","TIE (Residence Card)"]],
  IT:[["national_id","Carta d'identità"],["passport","Italian Passport"],["drivers_license","Patente di guida"],["residence_permit","Permesso di soggiorno"]],
  NL:[["national_id","Nederlandse identiteitskaart"],["passport","Dutch Passport"],["drivers_license","Rijbewijs"],["residence_permit","Verblijfsdocument"]],
  IE:[["national_id","Public Services Card / National ID"],["passport","Irish Passport"],["drivers_license","Driving Licence"],["residence_permit","Irish Residence Permit"]],
  JP:[["national_id","My Number Card"],["passport","Japanese Passport"],["drivers_license","Driver's Licence"],["residence_permit","Residence Card"]],
  KR:[["national_id","Resident Registration Card"],["passport","South Korean Passport"],["drivers_license","Driver's Licence"],["residence_permit","Residence Card"]],
  SG:[["national_id","NRIC / FIN"],["passport","Singapore Passport"],["drivers_license","Driving Licence"],["residence_permit","Long-Term Pass"]],
  AE:[["national_id","Emirates ID"],["passport","UAE Passport"],["drivers_license","UAE Driving Licence"],["residence_permit","UAE Residence Visa"]],
  SA:[["national_id","National ID (Hawiya)"],["passport","Saudi Passport"],["drivers_license","Saudi Driving Licence"],["residence_permit","Iqama (Residence ID)"]],
  EG:[["national_id","Egyptian National ID"],["passport","Egyptian Passport"],["drivers_license","Driving Licence"],["residence_permit","Residence Permit"]],
  TZ:[["national_id","NIDA National ID"],["passport","Tanzanian Passport"],["drivers_license","Driving Licence"],["voters_card","Voter ID"]],
  UG:[["national_id","National Identification Card"],["passport","Ugandan Passport"],["drivers_license","Driving Permit"],["voters_card","Voter's Card"]],
  RW:[["national_id","Rwandan National ID"],["passport","Rwandan Passport"],["drivers_license","Driving Licence"],["residence_permit","Residence Permit"]],
  CM:[["national_id","National Identity Card"],["passport","Cameroonian Passport"],["drivers_license","Driving Licence"],["voters_card","Voter's Card"]],
  ID:[["national_id","KTP (National Identity Card)"],["passport","Indonesian Passport"],["drivers_license","SIM (Driving Licence)"],["residence_permit","Stay Permit"]],
  MY:[["national_id","MyKad"],["passport","Malaysian Passport"],["drivers_license","Driving Licence"],["residence_permit","Residence Pass"]],
  TH:[["national_id","Thai National ID Card"],["passport","Thai Passport"],["drivers_license","Driving Licence"],["residence_permit","Residence Certificate"]],
  TR:[["national_id","Turkish Identity Card"],["passport","Turkish Passport"],["drivers_license","Driving Licence"],["residence_permit","Residence Permit"]],
  CH:[["national_id","Swiss Identity Card"],["passport","Swiss Passport"],["drivers_license","Driving Licence"],["residence_permit","Residence Permit"]],
  RU:[["national_id","Internal Passport / National ID"],["passport","International Passport"],["drivers_license","Driving Licence"],["residence_permit","Residence Permit"]],
  UA:[["national_id","Ukrainian Identity Card"],["passport","Ukrainian Passport"],["drivers_license","Driving Licence"],["residence_permit","Residence Permit"]]
};
const DEFAULT_ID_DOCUMENT_TYPES = [["national_id","National identity card"],["passport","Passport"],["drivers_license","Driver's licence"],["voters_card","Voter's card"],["residence_permit","Residence permit"]];

const FLEXAR_APP_URL = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, "");

const withTimeout = (promise, ms, message = "Request timed out") =>
  new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });

export default function App() {
  
  const [page, setPage] = useState(() => { const route=window.location.pathname.split("/").filter(Boolean).join("/"); return route==="admin"?"admin":route==="identity-verification"?"identity-verification":route==="profile"?"profile":"home"; });
  const [aiCreditsReturnPage, setAiCreditsReturnPage] = useState("trade");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dashboardTourOpen, setDashboardTourOpen] = useState(false);
  const [dashboardTourStep, setDashboardTourStep] = useState(0);

  // Close the desktop navigation drawer whenever a destination changes.
  // Mobile keeps its existing interaction.
  useEffect(() => {
    if (window.matchMedia("(min-width: 760px)").matches && sidebarOpen) setSidebarOpen(false);
  }, [page]);
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
  const tradeNotificationStateRef = useRef(null);

  function startDashboardTour() {
    setDashboardTourStep(0);
    setDashboardTourOpen(true);
  }
  function finishDashboardTour() {
    setDashboardTourOpen(false);
    try { if (user?.id) localStorage.setItem(`flexar_dashboard_tour_completed_${user.id}`, "1"); } catch {}
  }

  useEffect(() => {
    if (!user?.id || loading || page !== "home" || !profile?.onboarding_completed || dashboardTourOpen) return;
    let completed = false;
    try { completed = localStorage.getItem(`flexar_dashboard_tour_completed_${user.id}`) === "1"; } catch { completed = true; }
    if (completed) return;
    const timer = window.setTimeout(() => { setDashboardTourStep(0); setDashboardTourOpen(true); }, 900);
    return () => window.clearTimeout(timer);
  }, [user?.id, loading, page, profile?.onboarding_completed, dashboardTourOpen]);

  useEffect(() => {
    const syncAdminRoute = () => { const route=window.location.pathname.split("/").filter(Boolean).join("/"); setPage(route==="admin"?"admin":route==="identity-verification"?"identity-verification":route==="profile"?"profile":"home"); };
    window.addEventListener("popstate", syncAdminRoute);
    return () => window.removeEventListener("popstate", syncAdminRoute);
  }, []);

  useEffect(() => {
    if (profile && !profile.is_admin && page === "admin") {
      window.history.replaceState({}, "", "/");
      setPage("home");
    }
  }, [profile, page]);

  const refreshAccount = useCallback(async ({ silent = false } = {}) => {
    if (!supabase || !user) return;
    if (!silent) setLoading(true);
    try {
      const result = await getAccountData();
      setAccount(result);
    } finally {
      if (!silent) setLoading(false);
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
        setGlobalNotice("Notifications enabled. FLEXAR will alert you about important trade and account events.");
      } else {
        setGlobalNotice("Notifications are off. You can enable them later from your browser or device settings.");
      }
    } catch {
      setNotificationPrompt(false);
    }
  }

  function showFlexarNotification(title, body, eventKey = "") {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (eventKey) {
      try {
        const key = "flexar_notification_event_" + eventKey;
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {}
    }
    const options = {
      body,
      icon: "/flexa-symbol.webp",
      badge: "/flexa-symbol.webp",
      tag: eventKey || "flexar-ai-trade-update",
      renotify: false,
      data: { url: window.location.origin }
    };
    try {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "FLEXAR_NOTIFICATION", title, options });
        return;
      }
    } catch {}
    try { new Notification(title, options); } catch {}
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
      // Avoid background-tab database traffic; refresh when the user returns.
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const result = await getAccountData();
        if (!cancelled) setAccount(result);
      } catch {}
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const timer = window.setInterval(poll, 15000);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [user, aiEngineActive, account.trades?.some((trade) => trade.status === "active")]);

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
    const type = String(latest.type || "").toLowerCase();
    if (!["trade_opened","trade_profit","trade_loss","trade_won","trade_lost","deposit_completed","withdrawal_completed","withdrawal_failed"].includes(type)) return;
    showFlexarNotification(latest.title || "FLEXAR AI update", latest.message || latest.body || "You have an important FLEXAR account update.", "db-" + key);
  }, [account.notifications]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      tradeNotificationStateRef.current = null;
      return;
    }
    const trades = account.trades || [];
    const snapshot = new Map(trades.map((trade) => [trade.id, trade.status]));
    if (tradeNotificationStateRef.current === null) {
      tradeNotificationStateRef.current = snapshot;
      return;
    }

    const previous = tradeNotificationStateRef.current;
    trades.forEach((trade) => {
      const oldStatus = previous.get(trade.id);
      const market = trade.metadata?.market_symbol || trade.asset || "AI trade";
      const direction = String(trade.direction || "").toUpperCase();
      const side = direction ? " · " + direction : "";
      if (oldStatus === undefined && trade.status === "active") {
        showFlexarNotification("FLEXAR AI · Trade opened", market + side + " is now active. Stake: $" + Number(trade.stake || 0).toFixed(2) + " USDT.", "trade-open-" + trade.id);
      } else if (oldStatus === "active" && (trade.status === "won" || trade.status === "lost")) {
        const pnl = Number(trade.result_amount || 0) - Number(trade.stake || 0);
        const outcome = trade.status === "won" ? "Profit secured" : "Trade closed at a loss";
        showFlexarNotification("FLEXAR AI · " + outcome, market + side + " · " + (pnl >= 0 ? "+" : "") + "$" + pnl.toFixed(2) + " USDT realized.", "trade-close-" + trade.id);
      }
    });
    tradeNotificationStateRef.current = snapshot;
  }, [account.trades, loading, user]);

  useEffect(() => {
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);

    const miniApp = getTelegramWebApp();
    if (miniApp) {
      miniApp.ready();
      miniApp.expand();
    }

    if (!supabase) {
      setLoading(false);
      return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    }

    let mounted = true;

    let authFallbackTimer = null;
    let initialAuthResolved = false;
    const clearAuthFallback = () => {
      // Remember resolution even if the auth event arrives before the timer
      // has been assigned below. This helper is also used during cleanup, so
      // it must not update React state.
      initialAuthResolved = true;
      if (authFallbackTimer !== null) {
        window.clearTimeout(authFallbackTimer);
        authFallbackTimer = null;
      }
    };
    const clearStaleConnectionWarning = () => {
      if (!mounted) return;
      setAuthError((current) =>
        current === "Connection is taking longer than expected. Please refresh and try again."
          ? ""
          : current
      );
    };

    const { data: authSubscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      setUser(session?.user || null);
      if (event === "INITIAL_SESSION" && !miniApp?.initData) {
        clearAuthFallback();
        clearStaleConnectionWarning();
      }

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
      const { data, error } = await withTimeout(
          supabase.auth.getSession(),
          12000,
          "Session restore timed out. Please check your connection and try again."
        );
        if (!mounted) return;
        clearAuthFallback();
        clearStaleConnectionWarning();
        if (error) {
          setAuthError(error.message || "Could not restore your FLEXAR AI session.");
        }
        if (!data?.session) setLoading(false);
    };

    initialize().catch((error) => {
      if (!mounted) return;
      clearAuthFallback();
      clearStaleConnectionWarning();
      setAuthError(error?.message || "Could not restore your FLEXAR AI session.");
      setLoading(false);
    });

    if (!initialAuthResolved) {
      authFallbackTimer = window.setTimeout(() => {
        authFallbackTimer = null;
        if (mounted && !initialAuthResolved) {
          const timeoutError = new Error("Initial authentication state was not resolved within 15 seconds.");
          reportDiagnosticError(timeoutError, "auth:initial_session_timeout");
          setAuthError((current) => current || "Connection is taking longer than expected. Please refresh and try again.");
          setLoading(false);
        }
      }, 15000);
    }

    return () => {
      clearAuthFallback();
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

      let onboarding = { data: null, error: null };
      try {
        onboarding = await withTimeout(supabase.functions.invoke("account-onboarding", {
          body: {
            referral_code:
              new URLSearchParams(window.location.search).get("ref") ||
              localStorage.getItem("flexa_referral_code") ||
              "",
          },
        }), 10000, "Account setup is taking too long.");
      } catch (error) {
        onboarding = { data: null, error };
      }

      if (cancelled) return;

      if (onboarding.error || onboarding.data?.error) {
        setAuthError(onboarding.data?.error || onboarding.error?.message || "");
      } else {
        setAuthError("");
      }

      // Read the profile after onboarding so first-time users do not race
      // the profile upsert and get stuck with an empty profile/admin state.
      let profileData = null;
      try {
        const profileResult = await withTimeout(
          supabase.from("profiles")
            .select("id,display_name,username,email,last_login_provider,telegram_username,avatar_url,referral_code,is_admin,onboarding_completed,onboarding_step,country_code,trading_experience,onboarding_goals,trading_style,risk_profile,ai_preference,ai_credits,ai_credits_used,ai_trading_enabled,ai_trade_mode,ai_autopilot_stake")
            .eq("id", user.id)
            .maybeSingle(),
          10000,
          "Profile loading timed out."
        );
        profileData = profileResult.data || null;
        if (profileResult.error) setAuthError(profileResult.error.message || "Could not load your profile.");
      } catch (error) {
        setAuthError(error?.message || "Could not load your profile.");
      }

      if (cancelled) return;
      setProfile(profileData || null);
      setAiEngineActive(Boolean(profileData?.ai_trading_enabled));
      setOnboardingState(profileData ? {
        completed: Boolean(profileData.onboarding_completed),
        step: Math.min(4, Math.max(0, Number(profileData.onboarding_step || 0))),
        countryCode: profileData.country_code || "",
        experience: profileData.trading_experience || "",
        goals: Array.isArray(profileData.onboarding_goals) ? profileData.onboarding_goals : [],
        style: profileData.trading_style || "",
        aiPreference: profileData.ai_preference || "",
      } : null);

      let result;
      try {
        result = await withTimeout(
          getAccountData(),
          12000,
          "Account data is taking too long to load. Please refresh in a moment."
        );
      } catch (error) {
        result = { ...EMPTY_ACCOUNT, error };
        setAuthError(error?.message || "Could not load your FLEXAR AI account.");
      }
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
      notify("Your AI credits are running low. Buy a package to continue using FLEXAR AI.");
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
          notify("Your AI credits are running low. Buy a package to continue using FLEXAR AI.");
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

        const created = (data?.results || []).some((item) => item?.status === "created");
        if (data?.credits_remaining !== undefined) setProfile((current) => current ? { ...current, ai_credits: Number(data.credits_remaining) } : current);
        if (created) {
          await refreshAccount({ silent: true });
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
      refreshAccount({ silent: true });
    }, Math.max(1000, latestEnd - Date.now() + 1500));
    return () => clearTimeout(timer);
  }, [account.opportunities, aiEngineActive, aiScanning, refreshAccount]);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setAccount(EMPTY_ACCOUNT);
    setAiEngineActive(false);
  }

  if (profile?.is_admin && page === "admin") return <AdminDashboard onExit={() => { window.history.pushState({}, "", "/"); setPage("home"); }} />;
  const navigateToIdentityVerification = () => { window.history.pushState({}, "", "/identity-verification"); setPage("identity-verification"); };
  if (!user && loading) return <div className="loading-screen"><img className="loader-logo" src="/flexar-public-logo.webp" alt="FLEXAR AI" /><strong>Connecting your FLEXAR AI account…</strong><span>Loading your account data…</span></div>;
  if (!user) return <Landing market={market} showAuth={showAuth} setShowAuth={setShowAuth} installPrompt={installPrompt} installFLEXAR={installFLEXAR} />;
  if (user && loading) {
    return <div className="flexar-loading-screen" role="status" aria-live="polite">
      <div className="flexar-loading-mark"><img src="/flexa-symbol.webp" alt="FLEXAR AI" /><span className="flexar-loading-ring"/></div>
      <strong>FLEXAR AI</strong>
      <span>Syncing your account…</span>
      <i className="flexar-loading-bar"><b/></i>
    </div>;
  }
  if (!user && loading) return <div className="loading-screen"><img className="loader-logo" src="/flexar-public-logo.webp" alt="FLEXAR AI" /><strong>Connecting your FLEXAR AI account…</strong><span>Loading your account data…</span></div>;
  if (user && profile && onboardingState && !onboardingState.completed) return <Onboarding profile={profile} initialState={onboardingState} onComplete={(next) => { setOnboardingState({...next, completed:true}); setProfile((current) => ({...(current || {}), onboarding_completed:true, onboarding_step:4, country_code:next.countryCode, trading_experience:next.experience, onboarding_goals:next.goals, trading_style:next.style, ai_preference:next.aiPreference})); setPage("home"); }} />;

  const notifications = account.notifications || [];
  const unreadNotifications = notifications.filter((item) => !item.is_read).length;

  return <div className={sidebarOpen ? "app-shell sidebar-open" : "app-shell"}>
    <header className="topbar"><button type="button" className="sidebar-toggle" aria-label={sidebarOpen ? "Close side menu" : "Open side menu"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}><span aria-hidden="true">{sidebarOpen ? "×" : "☰"}</span></button><img className="app-wordmark" src="/flexar-public-logo.webp" alt="FLEXAR AI" /></header>
    <main className="content" onClickCapture={(event) => {
      if (window.matchMedia("(min-width: 760px)").matches && sidebarOpen &&
          event.target instanceof Element && event.target.closest("button,a,[role='button']")) {
        setSidebarOpen(false);
      }
    }}>
      {authError && <div className="error-banner">{authError}</div>}
      <AppErrorBoundary page={page}>
        <div key={page} className="page-transition" aria-live="polite">
          {page === "home" && <Home account={account} profile={profile} setPage={setPage} onWalletAction={setWalletAction} claimReward={claimReward} rewardBusy={rewardBusy} startAiScan={startAiScan} aiScanning={aiScanning} aiEngineActive={aiEngineActive} onStartTour={startDashboardTour} />}
          {page === "trade" && <Trade account={account} profile={profile} startAiScan={startAiScan} aiScanning={aiScanning} aiEngineActive={aiEngineActive} onOpenCredits={() => { setAiCreditsReturnPage("trade"); setPage("ai-credits"); }} onActivationChange={(open) => { setAiActivationOpen(open); if (open) setGlobalNotice(""); }} onStopAi={stopAiEngine} />}
          {page === "ai-credits" && <AICreditsPage profile={profile} account={account} onBack={() => setPage(aiCreditsReturnPage)} refreshAccount={refreshAccount} />}
          {page === "activity" && <Activity account={account} setPage={setPage} />}
          {page === "activity-trades" && <ActivityDetailPage account={account} type="trades" onBack={() => setPage("activity")} />}
          {page === "activity-transactions" && <ActivityDetailPage account={account} type="transactions" onBack={() => setPage("activity")} />}
          {page === "referral" && <Referral account={account} profile={profile} />}
          {page === "profile" && <Profile user={user} profile={profile} signOut={signOut} onVerifyIdentity={navigateToIdentityVerification} />}
          {page === "identity-verification" && <IdentityVerificationPage user={user} profile={profile} onBack={() => { window.history.pushState({}, "", "/profile"); setPage("profile"); }} onOpenCredits={() => { setAiCreditsReturnPage("identity-verification"); setPage("ai-credits"); }} onSubmitted={(data) => { setProfile(current => current ? {...current, ai_credits:data?.credits_remaining ?? Math.max(0,Number(current.ai_credits||0)-5)} : current); window.dispatchEvent(new Event("flexar-ai-credits-updated")); }} />}
        </div>
      </AppErrorBoundary>
    </main>
    <nav className="bottom-nav" data-tour="navigation" aria-label="Primary navigation" onClickCapture={(event) => {
      if (
        window.matchMedia("(min-width: 760px)").matches &&
        event.target instanceof Element &&
        event.target.closest("button.nav")
      ) setSidebarOpen(false);
    }}><div className="sidebar-menu-head"><span>FLEXAR AI</span><button type="button" className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close side menu">×</button></div>{nav.map(([id, icon, label]) => <button type="button" key={id} className={(page === id || (id === "activity" && page.startsWith("activity-"))) ? "nav active" : "nav"} onClick={() => { setPage(id); if (window.matchMedia("(min-width: 760px)").matches) setSidebarOpen(false); }}><span>{icon}</span><small>{label}</small></button>)}</nav>
    {notificationPrompt && !aiActivationOpen && <NotificationPromptModal onEnable={enableNotifications} onDismiss={dismissNotificationPrompt} />}
    {showNotifications && <NotificationPanel notifications={notifications} onClose={() => setShowNotifications(false)} />}
    {walletAction && <WalletActions action={walletAction} onClose={() => setWalletAction("")} onVerification={() => { setWalletAction(""); navigateToIdentityVerification(); }} account={account} refreshAccount={refreshAccount} assetPrices={assetPrices} />}
    {globalNotice && !aiActivationOpen && <div className="global-notice" role="status" onClick={() => setGlobalNotice("")}>{globalNotice}</div>}
    {tradeSuccess && <TradeSuccessModal trade={tradeSuccess} onClose={() => setTradeSuccess(null)} onViewActive={() => { setTradeSuccess(null); setPage("activity"); }} />}
    <DashboardTour open={dashboardTourOpen} stepIndex={dashboardTourStep} page={page} setPage={setPage} onBack={() => setDashboardTourStep((step) => Math.max(0, step - 1))} onNext={() => setDashboardTourStep((step) => Math.min(DASHBOARD_TOUR_STEPS.length - 1, step + 1))} onFinish={finishDashboardTour} />
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
      <section className="landing-hero"><div className="eyebrow">AI-POWERED MARKET OPPORTUNITIES</div><h1>Let the AI find<br /><span>the trade.</span></h1><p>FLEXAR AI continuously studies market conditions and surfaces simplified trading opportunities, so you do not need to understand complex charts before every trade.</p><div className="landing-actions"><button className="landing-cta" onClick={() => setShowAuth(true)}>Get started <b>→</b></button>{installPrompt && <button className="install-cta" onClick={installFLEXAR}>Install FLEXAR AI</button>}<div className="landing-trust">Free account · Email or Google · Your account, your control</div><span className="hero-status"><i /> Market data connected</span></div></section>
      <section className="landing-terminal"><div className="terminal-top"><div><small>LIVE MARKET</small><strong>BTC / USDT</strong></div><span className={change >= 0 ? "green" : "red"}>{change == null ? "—" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}</span></div><Chart /><div className="terminal-bottom"><strong>{price == null ? "Loading…" : "$" + price.toLocaleString(undefined,{maximumFractionDigits:2})}</strong><span>PUBLIC MARKET DATA</span></div><div className="floating-card float-card-a">AI OPPORTUNITY <b>SCANNING</b></div><div className="floating-card float-card-b">AI WINDOW <b>QUALIFYING SETUP</b></div></section>
      <section className="welcome-campaign"><div><span className="eyebrow">NEW USER CAMPAIGN</span><h2>Claim your <b>$50</b> welcome reward.</h2><p>Use the reward to trade. The reward itself cannot be withdrawn; only eligible profit generated from it can be withdrawn before the 12-day deadline.</p></div><span className="campaign-badge">12 DAYS</span></section><section className="opportunity-preview"><div><div className="eyebrow">AI OPPORTUNITY FEED</div><h2>Users do not hunt for trades. FLEXAR AI finds them.</h2></div><div className="opportunity-demo"><div><span>BTC / USDT</span><strong>AI opportunity detected</strong></div><b>UP ↗</b><small>RISK MANAGED · REVIEW READY</small></div></section>
      <section className="landing-section"><div className="eyebrow">HOW FLEXAR WORKS</div><h2>Simple on the surface. Intelligent underneath.</h2><div className="landing-steps"><LandingStep n="01" title="Scan" text="Market data is continuously collected and analyzed across supported markets."/><LandingStep n="02" title="Select" text="The engine filters signals and turns stronger setups into user-friendly opportunities."/><LandingStep n="03" title="Trade" text="You review the opportunity, choose your stake and confirm when ready." /></div></section>
      <section className="landing-section"><div className="feature-row"><LandingFeature title="AI-first trading" text="The system does the heavy market analysis before presenting an opportunity."/><LandingFeature title="Real market data" text="Charts and future signals are designed around real market pricing, not invented demo prices."/><LandingFeature title="Transparent activity" text="Trades, balances and wallet events remain connected to your account ledger." /></div></section>
    </main>{showAuth && <AuthModal onClose={() => setShowAuth(false)} />}</div>;
}
function AuthModal({onClose}){const [mode,setMode]=useState("signup"),[error,setError]=useState(""),[notice,setNotice]=useState("");return <div className="auth-modal-backdrop" onClick={onClose}><div className="auth-modal" onClick={e=>e.stopPropagation()}><button className="auth-close" onClick={onClose} aria-label="Close">×</button><img className="auth-modal-icon" src="/flexa-symbol.webp" alt="FLEXAR AI"/><div className="eyebrow">WELCOME TO FLEXAR AI</div><h2>{mode==="signup"?"Create your account.":"Welcome back."}</h2><p>{mode==="signup"?"Register with your name, username, email and password, or continue with Google.":"Sign in with email and password, or continue with Google."}</p><AuthOptions mode={mode} setAuthError={setError} authError={error} notice={notice} setNotice={setNotice}/><button className="auth-mode-toggle" type="button" onClick={()=>{setMode(mode==="signup"?"login":"signup");setError("");setNotice("");}}>{mode==="signup"?"Already have an account? Sign in":"New to FLEXAR AI? Create an account"}</button><small className="auth-legal">By continuing, you agree to use FLEXAR AI responsibly and follow applicable terms.</small></div></div>;}
function AuthOptions({mode,setAuthError,authError,notice,setNotice}){const [busy,setBusy]=useState(""),[fullName,setFullName]=useState(""),[username,setUsername]=useState(""),[email,setEmail]=useState(""),[password,setPassword]=useState("");async function submit(e){e.preventDefault();if(!supabase){setAuthError("Supabase is not configured.");return;}const em=email.trim().toLowerCase(),un=username.trim().replace(/^@/,""),name=fullName.trim();if(mode==="signup"&&(!name||name.length>100)){setAuthError("Enter your name (up to 100 characters).");return;}if(mode==="signup"&&!/^[A-Za-z0-9_]{3,24}$/.test(un)){setAuthError("Username must be 3–24 letters, numbers or underscores.");return;}if(password.length<8){setAuthError("Password must be at least 8 characters.");return;}setBusy("email");setAuthError("");setNotice("");try{if(mode==="signup"){const {data,error}=await supabase.auth.signUp({email:em,password,options:{data:{username:un,full_name:name}}});if(error)throw error;setNotice(data.session?"Account created and signed in.":"Check your email to confirm your account, then sign in.");}else{const {error}=await supabase.auth.signInWithPassword({email:em,password});if(error)throw error;}}catch(err){setAuthError(err?.message||"Authentication failed.");}finally{setBusy("");}}async function google(){if(!supabase){setAuthError("Supabase is not configured.");return;}setBusy("google");setAuthError("");const {error}=await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:`${FLEXAR_APP_URL}/`}});if(error){setBusy("");setAuthError(error.message||"Google sign-in could not start.");}}return <div className="auth-options"><form className="auth-email-form" onSubmit={submit}>{mode==="signup"&&<label>Full name<input autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)} maxLength={100} placeholder="Your name" required/></label>}{mode==="signup"&&<label>Username<input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} minLength={3} maxLength={24} placeholder="e.g. dike_w" required/></label>}<label>Email address<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required/></label><label>Password<input type="password" autoComplete={mode==="signup"?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} minLength={8} placeholder="At least 8 characters" required/></label><button className="auth-provider auth-email-submit" type="submit" disabled={!!busy}>{busy==="email"?"Please wait…":mode==="signup"?"Create account":"Sign in"}<b>→</b></button></form><div className="auth-divider"><span>OR</span></div><button type="button" className="auth-provider google" onClick={google} disabled={!!busy}><span className="provider-mark google-mark">G</span><span>{busy==="google"?"Connecting Google…":"Continue with Google"}</span><b>→</b></button>{notice&&<div className="auth-success" role="status">{notice}</div>}{authError&&<div className="error-banner" role="alert">{authError}</div>}</div>;}
function Onboarding({ profile, initialState, onComplete }) {
  const [step, setStep] = useState(Math.min(4, Math.max(0, Number(initialState?.step || 0))));
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

  const progress = Math.min(100, Math.max(0, ((step + 1) / 5) * 100));
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
    if (step === 3 && !style) { setError("Choose the risk style that best fits you."); return; }
    if (step === 4 && !aiPreference) { setError("Choose how much control you want over AI trades."); return; }
    const patch = step === 0 ? { country_code: countryCode }
      : step === 1 ? { trading_experience: experience }
      : step === 2 ? { onboarding_goals: goals }
      : step === 3 ? { trading_style: style, risk_profile: style }
      : { ai_preference: aiPreference, onboarding_completed: true };
    const nextStep = step + 1;
    if (!await save(patch, nextStep)) return;
    if (step === 4) onComplete({ countryCode, experience, goals, style, aiPreference });
    else setStep(nextStep);
  }

  function back() { if (step > 0) { setError(""); setStep(step - 1); } }
  function toggleGoal(goal) { setGoals((current) => current.includes(goal) ? current.filter((item) => item !== goal) : [...current, goal]); }

  const stepCopy = [
    { label: "COUNTRY", title: "Where are you based?", text: "Choose your country so FLEXAR can tailor your account experience." },
    { label: "EXPERIENCE", title: "How familiar are you with trading?", text: "This helps FLEXAR keep the experience at the right level for you." },
    { label: "YOUR GOAL", title: "What do you want FLEXAR to help you do?", text: "Pick everything that matches what you want from the platform." },
    { label: "RISK PROFILE", title: "How do you prefer to manage risk?", text: "This is a preference for personalization, not a guarantee of returns." },
    { label: "AI CONTROL", title: "How much control do you want over AI trades?", text: "Choose whether to review each setup or enable automated execution within your limits." },
  ][step];

  return <div className="onboarding-screen">
    <div className="onboarding-glow onboarding-glow-a" /><div className="onboarding-glow onboarding-glow-b" />
    <div className="onboarding-shell">
      <header className="onboarding-header"><img src="/flexar-public-logo.webp" alt="FLEXAR AI" /><span>ACCOUNT SETUP</span></header>
      <div className="onboarding-progress-head"><small>STEP {String(Math.min(step + 1, 5)).padStart(2,"0")} / 05</small><strong>{stepCopy.label}</strong></div>
      <div className="onboarding-progress"><span style={{width:`${progress}%`}} /></div>
      <main className="onboarding-card">
        <div className="onboarding-intro"><span className="onboarding-kicker">WELCOME, {displayName.toUpperCase()}</span><h1>{stepCopy.title}</h1><p>{stepCopy.text}</p></div>
        {step === 0 && <div className="onboarding-country"><div className="onboarding-selected-country">{selectedCountry ? <><span className="country-flag">{selectedCountry.flag}</span><div><strong>{selectedCountry.name}</strong><small>Selected country</small></div></> : <><span className="country-placeholder">◎</span><div><strong>Select your country</strong><small>Your country will be saved to your FLEXAR profile.</small></div></>}</div><div className="country-search-wrap"><span>⌕</span><input value={countrySearch} onChange={(e) => setCountrySearch(e.target.value)} placeholder="Search countries" aria-label="Search countries" /></div><div className="country-list">{filteredCountries.slice(0, 80).map((country) => <button type="button" key={country.code} className={country.code === countryCode ? "country-option selected" : "country-option"} onClick={() => { setCountryCode(country.code); setCountrySearch(""); setError(""); }}><span>{country.flag}</span><strong>{country.name}</strong><small>{country.code}</small>{country.code === countryCode && <b>✓</b>}</button>)}</div>{filteredCountries.length > 80 && <small className="country-list-note">Keep typing to narrow the list.</small>}</div>}
        {step === 1 && <div className="onboarding-choice-grid">{[["new","I’m completely new","Keep things simple and guided."],["basics","I understand the basics","I know the core ideas and want a smoother workflow."],["experienced","I’m experienced","I’m comfortable reading markets and managing trades."],["professional","Professional","I trade actively and want a focused experience."]].map(([value,title,text]) => <button type="button" key={value} className={experience===value?"onboarding-choice selected":"onboarding-choice"} onClick={() => {setExperience(value);setError("");}}><span>{value===experience?"✓":""}</span><strong>{title}</strong><small>{text}</small></button>)}</div>}
        {step === 2 && <div className="onboarding-choice-grid goals">{[["ai","Let AI find opportunities"],["growth","Grow my trading balance"],["learn","Learn while I trade"],["efficient","Trade more efficiently"],["explore","Explore AI-powered trading"]].map(([value,title]) => <button type="button" key={value} className={goals.includes(value)?"onboarding-choice selected":"onboarding-choice"} onClick={() => {toggleGoal(value);setError("");}}><span>{goals.includes(value)?"✓":""}</span><strong>{title}</strong><small>Save this preference to personalize your FLEXAR journey.</small></button>)}</div>}
        {step === 3 && <div className="onboarding-preferences"><div><small>TRADING RISK STYLE</small><div className="preference-row">{[["conservative","Conservative","Prefer lower exposure and a more cautious approach."],["balanced","Balanced","Prefer a middle-ground approach to risk."],["growth","Growth","Comfortable with larger market swings and higher risk."]].map(([value,title,text]) => <button type="button" key={value} className={style===value?"preference-card selected":"preference-card"} onClick={() => {setStyle(value);setError("");}}><b>{title}</b><span>{text}</span></button>)}</div><small className="onboarding-footnote">This personalizes guidance; it does not guarantee results.</small></div></div>}
        {step === 4 && <div className="onboarding-preferences"><div><small>AI CONTROL</small><div className="preference-row two">{[["manual","Review every trade","FLEXAR prepares the setup; you confirm it."],["autopilot","Let FLEXAR execute automatically","FLEXAR can execute qualifying setups within your limits."]].map(([value,title,text]) => <button type="button" key={value} className={aiPreference===value?"preference-card selected":"preference-card"} onClick={() => {setAiPreference(value);setError("");}}><b>{title}</b><span>{text}</span></button>)}</div><small className="onboarding-footnote">You can change these preferences later.</small></div></div>}
        {error && <div className="error-banner onboarding-error">{error}</div>}
        <div className="onboarding-actions">{step>0 ? <button type="button" className="onboarding-back" onClick={back} disabled={busy}>← Back</button> : <span />}{step<4 ? <button type="button" className="onboarding-next" onClick={next} disabled={busy}>{busy?"Saving…":"Continue →"}</button> : <button type="button" className="onboarding-next" onClick={next} disabled={busy}>{busy?"Finishing…":"Enter FLEXAR AI →"}</button>}</div>
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

const DASHBOARD_TOUR_STEPS = [
  { page: "home", selector: '[data-tour="balance"]', eyebrow: "STEP 1 OF 6 · YOUR DASHBOARD", title: "Your balances at a glance", body: "Available balance shows funds currently available in your wallet. Portfolio value and open P&L can change while positions are active. Promotional bonus funds are tracked separately from withdrawable funds." },
  { page: "home", selector: '[data-tour="ai-cta"]', eyebrow: "STEP 2 OF 6 · FLEXAR AI", title: "Start with the AI workspace", body: "Open AI Trade to review market opportunities and choose manual approval or Autopilot. AI signals are estimates, not promises of profit." },
  { page: "home", selector: '[data-tour="funding"]', eyebrow: "STEP 3 OF 6 · WALLET ACTIONS", title: "Manage your funds", body: "Deposit, withdraw, and swap from here. Withdrawal eligibility depends on verified identity, eligible funds, the minimum threshold, and security review." },
  { page: "home", selector: '[data-tour="signal"]', eyebrow: "STEP 4 OF 6 · AI SIGNALS", title: "Understand a signal before acting", body: "Signals show a market, direction, and model score. A higher score is not a guarantee; review the setup, position size, and downside risk before committing funds." },
  { page: "home", selector: '[data-tour="navigation"]', eyebrow: "STEP 5 OF 6 · NAVIGATION", title: "Find the main areas", body: "Use the navigation to reach Home, AI Trade, Activity, Referral, and Profile. Activity helps you review closed trades, open P&L, and account transactions." },
  { page: "trade", selector: '[data-tour="trade-hero"]', eyebrow: "STEP 6 OF 6 · AI TRADE", title: "Choose how FLEXAR works for you", body: "Manual approval lets you review a setup before a trade is opened. Autopilot works within your configured stake limit. Both modes remain exposed to market risk, so use a stake you can afford to lose." }
];

function DashboardTour({ open, stepIndex, page, setPage, onBack, onNext, onFinish }) {
  const [spotlight, setSpotlight] = useState(null);
  const step = DASHBOARD_TOUR_STEPS[stepIndex];
  useEffect(() => {
    if (!open || !step) { setSpotlight(null); return; }
    if (page !== step.page) { setPage(step.page); return; }
    let target = null;
    const updateSpotlight = () => {
      target = document.querySelector(step.selector);
      if (!target) { setSpotlight(null); return; }
      const rect = target.getBoundingClientRect();
      setSpotlight({ top: Math.max(8, rect.top - 6), left: Math.max(8, rect.left - 6), width: Math.min(window.innerWidth - 16, rect.width + 12), height: Math.min(window.innerHeight - 16, rect.height + 12) });
    };
    const timer = window.setTimeout(() => {
      target = document.querySelector(step.selector);
      target?.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
      updateSpotlight();
    }, 180);
    window.addEventListener("resize", updateSpotlight);
    window.addEventListener("scroll", updateSpotlight, true);
    const handleKey = (event) => { if (event.key === "Escape") onFinish(); };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", updateSpotlight);
      window.removeEventListener("scroll", updateSpotlight, true);
      window.removeEventListener("keydown", handleKey);
      setSpotlight(null);
    };
  }, [open, stepIndex, page, step, setPage, onFinish]);
  if (!open || !step) return null;
  return createPortal(<div className="dashboard-tour-layer">
    <div className="dashboard-tour-scrim" />
    {spotlight && <div className="dashboard-tour-spotlight" aria-hidden="true" style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }} />}
    <section className="dashboard-tour-card" role="dialog" aria-modal="true" aria-labelledby="dashboard-tour-title">
      <div className="dashboard-tour-progress"><span style={{ width: ((stepIndex + 1) / DASHBOARD_TOUR_STEPS.length * 100) + "%" }} /></div>
      <small className="dashboard-tour-eyebrow">{step.eyebrow}</small>
      <h2 id="dashboard-tour-title">{step.title}</h2>
      <p>{step.body}</p>
      <div className="dashboard-tour-footer">
        <button type="button" className="dashboard-tour-skip" onClick={onFinish}>Skip tour</button>
        <div className="dashboard-tour-actions">
          {stepIndex > 0 && <button type="button" className="dashboard-tour-back" onClick={onBack}>Back</button>}
          {stepIndex < DASHBOARD_TOUR_STEPS.length - 1
            ? <button type="button" className="dashboard-tour-next" onClick={onNext}>Next <span aria-hidden="true">→</span></button>
            : <button type="button" className="dashboard-tour-next" onClick={onFinish}>Finish tour <span aria-hidden="true">✓</span></button>}
        </div>
      </div>
    </section>
  </div>, document.body);
}

function Home({ account, profile, setPage, onWalletAction, claimReward, rewardBusy, startAiScan, aiScanning, aiEngineActive, onStartTour }) {
  const active=account.trades.filter(t=>t.status==="active"), opportunities=account.opportunities||[], unread=account.notifications.filter(i=>!i.is_read).length;
  const usdtBalance=Number(account.wallets.find(i=>i.asset==="USDT")?.available_balance||0), reward=account.rewards?.find(r=>["available","active"].includes(r.status)&&Number(r.remaining_reward||0)>0);
  const displayName=profile?.display_name||profile?.telegram_username||"Your account", initials=displayName.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"F";
  const assets=[["BTC","Bitcoin","https://cdn.simpleicons.org/bitcoin"],["USDT","Tether USD","https://cdn.simpleicons.org/tether"],["TON","Gram","https://cdn.simpleicons.org/ton"],["SOL","Solana","https://cdn.simpleicons.org/solana"],["BNB","BNB","https://cdn.simpleicons.org/binance"]].map(([asset,label,icon])=>({asset,label,icon,wallet:account.wallets.find(w=>w.asset===asset)})).filter(item=>item.asset==="USDT"||Number(item.wallet?.available_balance||0)!==0||Number(item.wallet?.locked_balance||0)!==0);
  const activeTrade=active[0], activePnl=active.reduce((sum,trade)=>sum+Number(trade.unrealized_pnl||0),0),activeCapital=active.reduce((sum,trade)=>sum+Number(trade.stake||0),0),portfolioValue=usdtBalance+activeCapital+activePnl,activeReturn=activeCapital>0?(activePnl/activeCapital)*100:0,activeMarket=activeTrade?.metadata?.market_symbol||activeTrade?.asset||"—", activeDirection=String(activeTrade?.direction||"").toUpperCase();
  return <div className="flexar-home minimal-home">
    <section className="home-account">
      <div className="home-profile-line" data-tour="profile-line">
        <div className="avatar-orb" aria-label={`${displayName} avatar`}><span>{initials}</span><i/></div>
        <div><small>WELCOME BACK</small><strong>{displayName}</strong></div>
        <button type="button" className="home-profile-button notification-button" onClick={()=>window.dispatchEvent(new CustomEvent("flexar-open-notifications"))} aria-label="Open notifications">
          <span className="bell-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></span>
          {unread>0&&<b className="notification-dot">{unread>9?"9+":unread}</b>}
        </button>
        <button type="button" className="home-profile-button tour-help-button" onClick={onStartTour} aria-label="Start dashboard tour" title="Dashboard tour">?</button>
      </div>
      <div className="home-balance" data-tour="balance">
        <img className="balance-watermark" src="/flexa-symbol.webp" alt="" aria-hidden="true" />
        <div className="balance-content">
          <small>AVAILABLE BALANCE</small>
          <div><strong><b className="balance-currency">$</b>{usdtBalance.toLocaleString(undefined,{maximumFractionDigits:2})}</strong><span>USDT</span></div>
          <div className="home-balance-growth">
            <span><small>PORTFOLIO VALUE</small><strong className={activePnl>=0?"green":"red"}>$ {portfolioValue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></span>
            <span><small>OPEN P&L</small><strong className={activePnl>=0?"green":"red"}>{signedMoney(activePnl)}</strong></span>
            <span><small>RETURN</small><strong className={activeReturn>=0?"green":"red"}>{activeReturn>=0?"+":""}{activeReturn.toFixed(2)}%</strong></span>
          </div>
        </div>
      </div>
    </section>
    <section className="home-ai-cta" data-tour="ai-cta"><div><small>FLEXAR AI</small><h2>{aiEngineActive?"AI is watching the markets.":opportunities.length?"Your AI opportunity is ready.":"Find your next trade with AI."}</h2><p>{aiScanning?"Scanning supported markets for a qualifying setup.":aiEngineActive?"FLEXAR will surface a qualifying setup when its signal rules are met.":"Let FLEXAR analyze the market first, then choose how FLEXAR should trade for you."}</p></div><button type="button" onClick={()=>setPage("trade")} disabled={aiScanning}>{aiScanning?"Scanning…":aiEngineActive||opportunities.length?"Trade with AI →":"Start FLEXAR AI →"}</button></section>
    <section className="home-funding-actions" data-tour="funding" aria-label="Funding actions"><button type="button" onClick={()=>onWalletAction("deposit")}><span>↓</span><strong>Deposit</strong></button><button type="button" onClick={()=>onWalletAction("withdraw")}><span>↗</span><strong>Withdraw</strong></button><button type="button" onClick={()=>onWalletAction("swap")}><span>⇄</span><strong>Swap</strong></button></section>
    {reward&&<section className="home-reward-row"><div><small>{reward.status==="active"?"WELCOME CREDIT ACTIVE":"WELCOME CREDIT"}</small><strong>{"$"+Number(reward.remaining_reward||0).toFixed(2)} <span>remaining</span></strong><RewardCountdown reward={reward}/></div><button type="button" onClick={reward.status==="active"?()=>setPage("trade"):claimReward} disabled={rewardBusy}>{reward.status==="active"?"Use credit":rewardBusy?"Claiming…":"Claim"}</button></section>}
    <section className="home-section portfolio-preview"><div className="home-section-title"><div><small>PORTFOLIO</small><h2>My assets</h2></div><span className="home-section-note">{assets.length} asset{assets.length===1?"":"s"}</span></div><div className="home-asset-list">{assets.map(item=><div className="home-asset-row" key={item.asset}><span className={"home-asset-icon asset-"+item.asset.toLowerCase()}><img src={item.icon} alt="" loading="lazy"/></span><div><strong>{item.label}</strong><small>{item.asset==="TON"?"GRAM":item.asset}</small></div><b>{Number(item.wallet?.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:6})} {item.asset==="TON"?"GRAM":item.asset}</b></div>)}</div></section>
    <section className="home-section home-ai-card" data-tour="signal"><div className="home-section-title"><div><small>AI SIGNAL</small><h2>{opportunities.length?"Signal ready":"Waiting for a setup"}</h2></div><span className={aiEngineActive?"home-live":""}><i/> {aiEngineActive?"LIVE":"READY"}</span></div>{opportunities.length?<div className="home-signal-row"><div><strong>{opportunities[0].symbol}</strong><small>{opportunities[0].direction==="down"?"↘ DOWN":"↗ UP"} · {Math.round(Number(opportunities[0].signal_score||0)*100)}% confidence</small></div><button type="button" onClick={()=>setPage("trade")}>Review →</button></div>:<div className="home-ai-empty"><p>{aiScanning?"Scanning supported markets…":"No setup is being presented yet. Start the AI engine when you are ready."}</p><button type="button" onClick={()=>setPage("trade")}>Open AI Trade</button></div>}</section>
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
function Profile({ user, profile, signOut, onVerifyIdentity }) {
  const name=profile?.display_name||profile?.username||profile?.telegram_username||"FLEXAR AI user",initials=name.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  const [notifications,setNotifications]=useState(()=>{try{return localStorage.getItem("flexar_pref_notifications")!=="off"}catch{return true}}),[marketAlerts,setMarketAlerts]=useState(()=>{try{return localStorage.getItem("flexar_pref_market_alerts")!=="off"}catch{return true}});
  const [verification,setVerification]=useState(null),[verificationLoading,setVerificationLoading]=useState(true),[verificationError,setVerificationError]=useState("");
  const setPref=(key,value,setter)=>{setter(value);try{localStorage.setItem(key,value?"on":"off")}catch{}};
  useEffect(()=>{let active=true;(async()=>{if(!supabase||!user?.id){if(active)setVerificationLoading(false);return;}try{const {data,error}=await supabase.functions.invoke("identity-verification",{body:{action:"status"}});if(active){if(!error&&!data?.error)setVerification(data?.verification||null);else setVerificationError(data?.error||error?.message||"Could not load verification status.");}}catch(e){if(active)setVerificationError(e?.message||"Could not load verification status.");}finally{if(active)setVerificationLoading(false);}})();return()=>{active=false};},[user?.id]);
  const rawVerificationStatus=verification?.status;
  const verificationStatus=rawVerificationStatus==="approved"?"approved":rawVerificationStatus==="pending"?"pending":rawVerificationStatus==="rejected"?"rejected":rawVerificationStatus==="resubmission_required"?"resubmission_required":"not_started";
  const statusLabel=verificationLoading?"Checking status…":verificationStatus==="approved"?"Identity verified":verificationStatus==="pending"?"Pending review":verificationStatus==="rejected"?"Submission declined":verificationStatus==="resubmission_required"?"More information required":"Identity not verified";
  const countryName=code=>ONBOARDING_COUNTRIES.find(item=>item.code===code)?.name||code||"Not set";
  return <div className="profile-page">
    <section className="profile-hero-card"><div className="avatar-orb profile-avatar" aria-label={name+" avatar"}><span>{initials}</span><i/></div><div className="profile-identity"><small>FLEXAR AI ACCOUNT</small><h1>{name}</h1><span>{profile?.telegram_username?"@"+profile.telegram_username:user?.email||"Connected account"}</span></div><span className={"identity-status-pill "+(verificationLoading?"checking":verificationStatus==="approved"?"approved":verificationStatus==="pending"?"pending":"unverified")}>{verificationLoading?"● CHECKING STATUS":verificationStatus==="approved"?"● IDENTITY VERIFIED":verificationStatus==="pending"?"● PENDING REVIEW":"● IDENTITY NOT VERIFIED"}</span>{verificationStatus!=="approved"&&<button type="button" className="profile-verify-cta" onClick={onVerifyIdentity}>{verificationStatus==="pending"?"View verification status":"Verify identity →"}</button>}</section>
    <section className="profile-section"><div className="profile-section-head"><div><small>ACCOUNT</small><h2>Account details</h2></div></div><div className="profile-row"><span>Identity</span><strong>{profile?.last_login_provider==="google"?"Google connected":"Email and password"}</strong></div><div className="profile-row"><span>Email</span><strong>{user?.email||"Not provided"}</strong></div><div className="profile-row"><span>Country</span><strong>{countryName(profile?.country_code)}</strong></div><div className="profile-row"><span>Risk profile</span><strong>{profile?.risk_profile||profile?.trading_style||"Not set"}</strong></div><div className="profile-row"><span>Trading</span><strong>AI trading enabled</strong></div></section>
    <section className="profile-section profile-identity-summary"><div className="profile-section-head"><div><small>WITHDRAWAL SECURITY</small><h2>Identity verification</h2></div><span className={"identity-status-pill "+(verificationLoading?"checking":verificationStatus==="approved"?"approved":verificationStatus==="pending"?"pending":"unverified")}>{statusLabel}</span></div>
      <p>Verify your identity with a government-issued ID and a camera face scan. Make sure your details are accurate; your submission is subject to manual review before withdrawals are available.</p>
      {verificationStatus==="approved"&&<div className="auth-success" role="status">Your identity verification is complete. You can initiate withdrawals.</div>}
      {verificationStatus==="pending"&&<div className="notice" role="status">Your submission has been received and is pending review. You can check its status here. Withdrawals remain unavailable while the review is in progress.{verification?.duplicate_flag?" Your submission may require additional checks.":""}</div>}
      {verificationStatus==="rejected"&&<div className="error-banner" role="status">Your previous submission was declined. Review the note and submit corrected information.</div>}
      {verificationStatus==="resubmission_required"&&<div className="notice" role="status">More information is needed. Open identity verification to submit clearer or corrected details.</div>}
      {verification?.review_notes&&<div className="profile-row"><span>Review note</span><strong>{verification.review_notes}</strong></div>}
      {verificationError&&<div className="error-banner" role="alert">{verificationError}</div>}
      {verificationStatus!=="approved"&&<button type="button" className="mini-action" onClick={onVerifyIdentity}>{verificationStatus==="pending"?"View verification status":"Open identity verification →"}</button>}
    </section>
    <section className="profile-section settings-card"><div className="profile-section-head"><div><small>PREFERENCES</small><h2>Settings</h2></div></div><button className="setting-row" onClick={()=>setPref("flexar_pref_notifications",!notifications,setNotifications)}><span><strong>Notifications</strong><small>Account and trade updates</small></span><b className={notifications?"toggle on":"toggle"}><i/></b></button><button className="setting-row" onClick={()=>setPref("flexar_pref_market_alerts",!marketAlerts,setMarketAlerts)}><span><strong>Market alerts</strong><small>AI opportunity notifications</small></span><b className={marketAlerts?"toggle on":"toggle"}><i/></b></button><div className="setting-row static"><span><strong>Sign-in security</strong><small>Managed by Supabase Auth</small></span><b>Protected</b></div></section>
    <section className="profile-section profile-support"><div className="profile-section-head"><div><small>ACCOUNT SUPPORT</small><h2>Need help?</h2></div></div><p>Use the support channel connected to your FLEXAR account for account, funding or trading questions.</p></section><button className="signout-button" onClick={signOut}>Sign out of FLEXAR AI</button>
  </div>;
}

function IdentityVerificationPage({ user, profile, onBack, onOpenCredits, onSubmitted }) {
  const [verification,setVerification]=useState(null),[verificationLoading,setVerificationLoading]=useState(true);
  const [legalName,setLegalName]=useState(profile?.display_name||""),[countryCode,setCountryCode]=useState(profile?.country_code||"NG"),[idType,setIdType]=useState("national_id"),[idNumber,setIdNumber]=useState("");
  const [idFile,setIdFile]=useState(null),[faceFile,setFaceFile]=useState(null),[consent,setConsent]=useState(false),[verificationBusy,setVerificationBusy]=useState(false),[verificationError,setVerificationError]=useState(""),[feeModalOpen,setFeeModalOpen]=useState(false);
  const idOptions=ID_DOCUMENT_TYPES[countryCode]||DEFAULT_ID_DOCUMENT_TYPES;
  useEffect(()=>{let active=true;(async()=>{if(!supabase||!user?.id){if(active)setVerificationLoading(false);return;}try{const {data,error}=await supabase.functions.invoke("identity-verification",{body:{action:"status"}});if(active&&!error&&!data?.error){setVerification(data?.verification||null);if(data?.verification?.legal_name)setLegalName(data.verification.legal_name);if(data?.verification?.country_code){setCountryCode(data.verification.country_code);setIdType(data.verification.id_type||"national_id");}}else if(active)setVerificationError(data?.error||error?.message||"Could not load verification status.");}catch(e){if(active)setVerificationError(e?.message||"Could not load verification status.");}finally{if(active)setVerificationLoading(false);}})();return()=>{active=false};},[user?.id]);
  const rawStatus=verification?.status;
  const status=rawStatus==="approved"?"approved":rawStatus==="pending"?"pending":rawStatus==="rejected"?"rejected":rawStatus==="resubmission_required"?"resubmission_required":"not_started";
  const statusLabel=verificationLoading?"Checking status…":status==="approved"?"Identity verified":status==="pending"?"Pending review":status==="rejected"?"Submission declined":status==="resubmission_required"?"More information required":"Ready to verify";
  async function handleFormSubmit(e){
    e.preventDefault();setVerificationError("");
    if(!user?.id||!supabase)return setVerificationError("Identity verification is unavailable right now.");
    if(!legalName.trim()||!idNumber.trim()||!idFile||!faceFile)return setVerificationError("Complete every field and provide both your government ID and face scan.");
    if(!faceFile.type.startsWith("image/"))return setVerificationError("Your face scan must be an image captured with the camera.");
    for(const file of [idFile,faceFile])if(file.size>10*1024*1024)return setVerificationError("Each file must be 10 MB or smaller.");
    if(!consent)return setVerificationError("Confirm consent before submitting your identity documents.");
    if(!idOptions.some(([value])=>value===idType))return setVerificationError("Select a valid identity document type for your country.");
    setFeeModalOpen(true);
  }
  async function confirmSubmit(){
    setVerificationError("");setVerificationBusy(true);const uploaded=[];const requestId=crypto.randomUUID();
    try{
      const extension=file=>file.type==="application/pdf"?"pdf":file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
      const upload=async(file,label)=>{const path=user.id+"/"+crypto.randomUUID()+"-"+label+"."+extension(file);const {error}=await supabase.storage.from("identity-documents").upload(path,file,{contentType:file.type,upsert:false});if(error)throw new Error(error.message||"Could not upload identity file.");uploaded.push(path);return path;};
      const idPath=await upload(idFile,"government-id");const facePath=await upload(faceFile,"face-scan");
      const {data,error}=await supabase.functions.invoke("identity-verification",{body:{action:"submit",legal_name:legalName,country_code:countryCode,id_type:idType,id_number:idNumber,id_document_path:idPath,face_scan_path:facePath,consent:true,credits_confirmed:true,request_id:requestId}});
      if(error||data?.error){const err=new Error(data?.error||error?.message||"Could not submit identity verification.");err.code=data?.code||data?.reason;err.credits=data?.credits;throw err;}
      setVerification(data.verification||{status:"pending",submitted_at:new Date().toISOString()});setIdNumber("");setIdFile(null);setFaceFile(null);setConsent(false);setFeeModalOpen(false);onSubmitted?.(data);window.dispatchEvent(new Event("flexar-ai-credits-updated"));
    }catch(e){
      if(uploaded.length)try{await supabase.storage.from("identity-documents").remove(uploaded)}catch{}
      if(e?.code==="insufficient_credits"||/5 AI credits|insufficient.*credit/i.test(e?.message||"")){setFeeModalOpen(false);setVerificationError(e?.message||"You need 5 AI credits to process identity verification. Please get more AI credits and try again.");}
      else setVerificationError(e?.message||"Could not submit identity verification.");
    }finally{setVerificationBusy(false);}
  }
  return <div className="identity-page">
    <button type="button" className="identity-back-button" onClick={onBack}><span aria-hidden="true">←</span> Back to profile</button>
    <section className="identity-page-hero"><div className="identity-hero-copy"><span className="identity-eyebrow"><i/> ACCOUNT PROTECTION</span><h1>Identity verification</h1><p>Confirm your identity to help protect your account and unlock withdrawals after manual review.</p><div className="identity-trust-points"><span><b>01</b> Government ID</span><span><b>02</b> Camera face scan</span><span><b>03</b> Manual review</span></div></div><div className="identity-hero-mark" aria-hidden="true"><div className="identity-shield"><span>✓</span></div><i className="identity-orbit orbit-one"/><i className="identity-orbit orbit-two"/></div></section>
    <div className="identity-page-layout"><section className="identity-form-card">
      <div className="identity-form-heading"><div><small>YOUR DETAILS</small><h2>Complete your identity profile</h2><p>Enter your information exactly as it appears on your official document.</p></div><span className={"identity-status-pill "+(status==="approved"?"approved":status==="pending"?"pending":"unverified")}>{statusLabel}</span></div>
      {verificationLoading&&<div className="identity-loading-line">Checking your current verification status…</div>}
      {status==="approved"&&<div className="identity-status-panel success"><span>✓</span><div><strong>Identity verified</strong><p>Your identity review is complete. You can initiate withdrawals.</p></div></div>}
      {status==="pending"&&<div className="identity-status-panel pending"><span>◷</span><div><strong>Pending review</strong><p>Your submission has been received and is being reviewed manually. You can return to your profile; the status will remain pending until the review is complete.</p>{verification?.duplicate_flag&&<small>Additional identity checks may be required.</small>}</div></div>}
      {status==="rejected"&&<div className="identity-status-panel warning"><span>!</span><div><strong>Submission declined</strong><p>Review the note below and submit accurate, corrected information.</p>{verification?.review_notes&&<small>{verification.review_notes}</small>}</div></div>}
      {status==="resubmission_required"&&<div className="identity-status-panel warning"><span>!</span><div><strong>More information needed</strong><p>Please provide clearer or corrected details and documents.</p>{verification?.review_notes&&<small>{verification.review_notes}</small>}</div></div>}
      {verificationError&&<div className="error-banner" role="alert">{verificationError}{/5 AI credits|insufficient.*credit/i.test(verificationError)&&<button type="button" className="identity-inline-link" onClick={onOpenCredits}>Get AI credits →</button>}</div>}
      {status!=="approved"&&status!=="pending"&&<form className="identity-form" onSubmit={handleFormSubmit}>
        <div className="identity-form-section-title"><span>01</span><div><strong>Personal information</strong><small>Use your legal details, not a nickname.</small></div></div>
        <div className="identity-fields-grid">
          <label className="identity-field identity-field-wide"><span>Full legal name <i>*</i></span><input value={legalName} onChange={e=>setLegalName(e.target.value)} autoComplete="name" maxLength={160} required placeholder="As printed on your government ID"/><small>Enter your first, middle (if applicable), and last name.</small></label>
          <label className="identity-field"><span>Country of residence <i>*</i></span><div className="identity-select-wrap"><select value={countryCode} onChange={e=>{const next=e.target.value;setCountryCode(next);setIdType((ID_DOCUMENT_TYPES[next]||DEFAULT_ID_DOCUMENT_TYPES)[0]?.[0]||"national_id");}} required>{ONBOARDING_COUNTRIES.map(c=><option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select><span aria-hidden="true">⌄</span></div><small>Document options update for your selected country.</small></label>
          <label className="identity-field"><span>Government ID type <i>*</i></span><div className="identity-select-wrap"><select value={idType} onChange={e=>setIdType(e.target.value)} required>{idOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><span aria-hidden="true">⌄</span></div><small>Select the document you will upload.</small></label>
          <label className="identity-field identity-field-wide"><span>Government ID number <i>*</i></span><input value={idNumber} onChange={e=>setIdNumber(e.target.value)} autoComplete="off" maxLength={80} required placeholder="Enter the number shown on your document"/><small>Your ID number is stored as a one-way keyed hash for duplicate screening.</small></label>
        </div>
        <div className="identity-form-section-title identity-documents-title"><span>02</span><div><strong>Identity documents</strong><small>Upload clear, readable files. Each file must be 10 MB or less.</small></div></div>
        <div className="identity-upload-grid">
          <label className={"identity-upload-card "+(idFile?"has-file":"")}><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setIdFile(e.target.files?.[0]||null)} required/><span className="identity-upload-icon">▧</span><span className="identity-upload-title">Government-issued ID <i>*</i></span><span className="identity-upload-description">{idFile?idFile.name:"Upload the front or main page of your ID"}</span><span className="identity-upload-action">{idFile?"Choose a different file":"Browse files"}</span><small>JPG, PNG, WEBP or PDF</small></label>
          <label className={"identity-upload-card "+(faceFile?"has-file":"")}><input type="file" accept="image/*" capture="user" onChange={e=>setFaceFile(e.target.files?.[0]||null)} required/><span className="identity-upload-icon">◎</span><span className="identity-upload-title">Camera face scan <i>*</i></span><span className="identity-upload-description">{faceFile?faceFile.name:"Take a clear, well-lit photo of your face"}</span><span className="identity-upload-action">{faceFile?"Choose a different photo":"Open camera / upload"}</span><small>Image only · no filters</small></label>
        </div>
        <label className="identity-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/><span><strong>Consent to identity review</strong><small>I confirm these details and documents belong to me. I consent to secure storage and manual identity and duplicate-account review. I understand withdrawals remain unavailable while my submission is under review.</small></span></label>
        <div className="identity-submit-row"><div><small>PROCESSING FEE</small><strong>5 AI credits</strong><span>Charged only when the submission is accepted.</span></div><button type="submit" className="identity-submit-button" disabled={verificationBusy||verificationLoading}>{verificationBusy?"Submitting securely…":"Submit identity verification"} <span>→</span></button></div>
      </form>}
    </section><aside className="identity-sidebar"><section className="identity-side-card identity-fee-card"><span className="identity-side-icon">✦</span><small>VERIFICATION FEE</small><strong>5 <em>AI credits</em></strong><p>Identity verification processing costs 5 AI credits. You’ll confirm the fee before anything is submitted.</p><div className="identity-credit-balance"><span>Your current balance</span><strong>{Number(profile?.ai_credits||0).toLocaleString(undefined,{maximumFractionDigits:2})} credits</strong></div></section><section className="identity-side-card"><small>WHAT HAPPENS NEXT?</small><ol className="identity-process-list"><li><span>1</span><div><strong>Submit your details</strong><p>Complete the form and upload both documents.</p></div></li><li><span>2</span><div><strong>Manual review</strong><p>Our team checks the information and document clarity.</p></div></li><li><span>3</span><div><strong>Status update</strong><p>Your profile will show pending review until a decision is made.</p></div></li></ol></section><p className="identity-privacy-note">Your ID number is not stored in plain text. Face scans are reviewed manually; FLEXAR does not run automated facial recognition.</p></aside></div>
    {feeModalOpen&&<div className="identity-fee-backdrop" onClick={()=>{if(!verificationBusy)setFeeModalOpen(false);}}><section className="identity-fee-modal" role="dialog" aria-modal="true" aria-labelledby="identity-fee-title" onClick={e=>e.stopPropagation()}><button type="button" className="identity-fee-close" onClick={()=>setFeeModalOpen(false)} disabled={verificationBusy} aria-label="Close">×</button><span className="identity-modal-emblem">✦</span><small>CONFIRM PROCESSING FEE</small><h2 id="identity-fee-title">Submit identity verification?</h2><p>Processing your identity verification costs <strong>5 AI credits</strong>. The credits will be deducted when your submission is accepted for review.</p><div className="identity-fee-breakdown"><span>Processing fee<strong>5 AI credits</strong></span><span>Current balance<strong>{Number(profile?.ai_credits||0).toLocaleString(undefined,{maximumFractionDigits:2})} credits</strong></span><span>Balance after submission<strong>{Math.max(0,Number(profile?.ai_credits||0)-5).toLocaleString(undefined,{maximumFractionDigits:2})} credits</strong></span></div>{Number(profile?.ai_credits||0)<5?<><div className="identity-insufficient-note">You need at least 5 AI credits to process this verification. Add credits to continue.</div><button type="button" className="identity-submit-button" onClick={onOpenCredits}>Get AI credits →</button></>:<div className="identity-modal-actions"><button type="button" className="identity-cancel-button" onClick={()=>setFeeModalOpen(false)} disabled={verificationBusy}>Go back</button><button type="button" className="identity-submit-button" onClick={confirmSubmit} disabled={verificationBusy}>{verificationBusy?"Submitting securely…":"Confirm & submit"} <span>→</span></button></div>}<small className="identity-modal-footnote">Your documents will be reviewed manually. A successful submission will appear as Pending review in your profile.</small></section></div>}
  </div>;
}
function WalletActions({ action, onClose, onVerification, account, refreshAccount, assetPrices = {} }) {
  const [walletInfo,setWalletInfo]=useState(null),[selectedAsset,setSelectedAsset]=useState("USDT"),[swapFrom,setSwapFrom]=useState("USDT"),[swapTo,setSwapTo]=useState("BTC"),[swapAmount,setSwapAmount]=useState(""),[amount,setAmount]=useState(""),[address,setAddress]=useState(""),[withdrawalRequestId,setWithdrawalRequestId]=useState(""),[depositAmount,setDepositAmount]=useState(""),[depositHash,setDepositHash]=useState(""),[depositRequests,setDepositRequests]=useState([]),[paymentOrder,setPaymentOrder]=useState(null),[busy,setBusy]=useState(false),[depositChecking,setDepositChecking]=useState(false),[depositMatchIssue,setDepositMatchIssue]=useState(""),[depositClockNow,setDepositClockNow]=useState(Date.now()),[notice,setNotice]=useState(""),[withdrawalVerification,setWithdrawalVerification]=useState(null);
  const depositCheckLock=useRef(false);
  useEffect(()=>{if(action==="withdraw"){setWithdrawalVerification(null);supabase?.functions.invoke("identity-verification",{body:{action:"status"}}).then(({data,error})=>{if(error||data?.error)setWithdrawalVerification("unavailable");else setWithdrawalVerification(data?.verification?.status||"not_started")}).catch(()=>setWithdrawalVerification("unavailable"));}},[action]);
  useEffect(()=>{if(action==="deposit"&&!walletInfo){supabase?.functions.invoke("wallet-info").then(({data,error})=>{if(error||data?.error)setNotice(data?.error||error?.message||"Could not load deposit details.");else setWalletInfo(data)})}},[action,walletInfo]);
  useEffect(()=>{if(action==="deposit"){supabase?.functions.invoke("deposit-requests",{body:{action:"list"}}).then(({data,error})=>{if(!error&&!data?.error){const deposits=(data?.requests||[]).filter(item=>item.purpose==="wallet_deposit");setDepositRequests(deposits);const pending=deposits.find(item=>["pending","incomplete"].includes(item.status));if(pending)setPaymentOrder(current=>current||({...pending,order_id:pending.id}));}})}},[action]);
  const supported=[["BTC","Bitcoin","BTC","Internal",Number(assetPrices.BTC||0),"https://cdn.simpleicons.org/bitcoin"],["USDT","Tether USD","USDT","TRC-20",1,"https://cdn.simpleicons.org/tether"],["TON","Gram","GRAM","TON",Number(assetPrices.TON||0),"https://cdn.simpleicons.org/ton"],["SOL","Solana","SOL","Internal",Number(assetPrices.SOL||0),"https://cdn.simpleicons.org/solana"],["BNB","BNB","BNB","Internal",Number(assetPrices.BNB||0),"https://cdn.simpleicons.org/binance"]].map(([asset,label,symbol,network,price,icon])=>({asset,label,symbol,network,price,icon}));
  const balances=supported.map(asset=>({...asset,wallet:account.wallets.find(w=>w.asset===asset.asset)})),fromAsset=balances.find(i=>i.asset===swapFrom)||balances[1],toAsset=balances.find(i=>i.asset===swapTo)||balances[0],numericSwap=Number(swapAmount||0);
  const receiveQuote=numericSwap>0&&fromAsset.price>0&&toAsset.price>0?numericSwap*fromAsset.price/toAsset.price:0;
  async function submitSwap(e){e.preventDefault();setNotice("");if(!Number.isFinite(numericSwap)||numericSwap<=0)return setNotice("Enter a valid amount.");if(swapFrom===swapTo)return setNotice("Choose two different assets.");if(numericSwap>Number(fromAsset.wallet?.available_balance||0))return setNotice("Insufficient available balance.");setBusy(true);try{const {data,error}=await supabase.functions.invoke("swap-assets",{body:{from_asset:swapFrom,to_asset:swapTo,amount:numericSwap}});if(error||data?.error)throw new Error(data?.error||error?.message||"Swap failed.");await refreshAccount();onClose()}catch(error){setNotice(error.message||"Swap failed.")}finally{setBusy(false)}}
  async function submitDeposit(e){e.preventDefault();setNotice("");const numericAmount=Number(depositAmount);if(!Number.isFinite(numericAmount)||numericAmount<=0)return setNotice("Enter a valid USDT deposit amount.");setBusy(true);try{const {data,error}=await supabase.functions.invoke("deposit-requests",{body:{action:"create",purpose:"wallet_deposit",amount:depositAmount.trim()}});if(error||data?.error)throw new Error(data?.error||error?.message||"Could not create a deposit request.");setPaymentOrder(data);setDepositHash("");setDepositMatchIssue("");setDepositClockNow(Date.now());setNotice("");const {data:history}=await supabase.functions.invoke("deposit-requests",{body:{action:"list"}});setDepositRequests((history?.requests||[]).filter(item=>item.purpose==="wallet_deposit"))}catch(error){setNotice(error.message||"Could not create a deposit request.")}finally{setBusy(false)}}
  const checkDepositPayment=useCallback(async({silent=false,txHash=""}={})=>{const order=paymentOrder;if(!order?.order_id||depositCheckLock.current)return null;depositCheckLock.current=true;setDepositChecking(true);if(!silent)setNotice("");try{const {data,error}=await supabase.functions.invoke("deposit-requests",{body:{action:txHash?"submit_hash":"confirm",order_id:order.order_id,...(txHash?{tx_hash:txHash}:{}),...(!txHash&&!silent?{manual_check:true}:{})}});if(data?.ok){setNotice(Number(data.base_amount||order.base_amount).toFixed(2)+" USDT has been verified and credited to your FLEXAR wallet.");setPaymentOrder(null);setDepositAmount("");setDepositHash("");setDepositMatchIssue("");await refreshAccount();const {data:history}=await supabase.functions.invoke("deposit-requests",{body:{action:"list"}});setDepositRequests((history?.requests||[]).filter(item=>item.purpose==="wallet_deposit"));return data;}if(data?.needs_review){setDepositMatchIssue("needs_review");if(!silent)setNotice(data.message||"Your payment has been flagged for review. Your balance has not changed.");return data;}if(data?.needs_hash||data?.status==="ambiguous"){setDepositMatchIssue("ambiguous");if(!silent)setNotice(data.message||"More than one transfer may match. Submit your transaction hash after the payment window.");return data;}if(!silent)setNotice(data?.message||data?.error||error?.message||"Payment not detected yet. FLEXAR will keep checking automatically.");return data;}catch(error){if(!silent)setNotice(error?.message||"Could not check the blockchain right now.");return null;}finally{depositCheckLock.current=false;setDepositChecking(false)}},[paymentOrder,refreshAccount]);
  async function confirmDepositPayment(){return checkDepositPayment({silent:false});}
  async function submitDepositHash(e){e.preventDefault();const hash=depositHash.trim().replace(/^0x/i,"");if(!/^[a-fA-F0-9]{64}$/.test(hash)){setNotice("Enter the transaction hash from your wallet or exchange.");return;}await checkDepositPayment({silent:false,txHash:hash});}
  useEffect(()=>{if(action!=="deposit"||!paymentOrder?.order_id||paymentOrder.status==="paid")return;setDepositClockNow(Date.now());const timer=window.setInterval(()=>{setDepositClockNow(Date.now());if(!depositCheckLock.current)void checkDepositPayment({silent:true});},15000);return()=>window.clearInterval(timer)},[action,paymentOrder?.order_id,paymentOrder?.status,checkDepositPayment]);
  const depositExpiryMs=paymentOrder?.expires_at?new Date(paymentOrder.expires_at).getTime():new Date(paymentOrder?.created_at||Date.now()).getTime()+30*60*1000;
  const depositWindowExpired=Boolean(paymentOrder)&&depositClockNow>=depositExpiryMs;
  const depositSecondsRemaining=Math.max(0,Math.floor((depositExpiryMs-depositClockNow)/1000));
  const depositCountdown=String(Math.floor(depositSecondsRemaining/60)).padStart(2,"0")+":"+String(depositSecondsRemaining%60).padStart(2,"0");
  async function copyDepositAddress(){const value=walletInfo?.deposit_addresses?.USDT?.address||"";try{await navigator.clipboard?.writeText(value);setNotice("USDT wallet address copied.")}catch{setNotice("Copy is unavailable in this browser. Press and hold the address to copy it.")}}
  async function copyDepositAmount(){const value=Number(paymentOrder?.payment_amount||0).toFixed(2);try{await navigator.clipboard?.writeText(value);setNotice("Exact USDT payment amount copied.")}catch{setNotice("Copy is unavailable in this browser. Copy the exact amount shown above.")}}
  async function submitWithdrawal(e){e.preventDefault();setNotice("");const numericAmount=Number(amount);if(!Number.isFinite(numericAmount)||numericAmount<=0)return setNotice("Enter a valid withdrawal amount.");if(!address.trim())return setNotice("Enter the destination wallet address.");const requestId=withdrawalRequestId||crypto.randomUUID();if(!withdrawalRequestId)setWithdrawalRequestId(requestId);setBusy(true);try{const wallet=account.wallets.find(item=>item.asset==="USDT");const {data,error}=await supabase.functions.invoke("request-withdrawal",{body:{asset:"USDT",network:"TRC-20",amount:numericAmount,address:address.trim(),request_id:requestId}});if(error||data?.error)throw new Error(data?.error||error?.message||"Withdrawal request failed.");setWithdrawalRequestId("");await refreshAccount();onClose()}catch(error){setNotice(error.message||"Withdrawal request failed. Retry without changing the request details to avoid duplicate submissions.")}finally{setBusy(false)}}
  return <div className="auth-modal-backdrop" onClick={onClose}><div className="wallet-action-modal" onClick={e=>e.stopPropagation()}><button className="auth-close" onClick={onClose} aria-label="Close">×</button>
    {action==="deposit"&&<><div className="wallet-flow-heading"><span className="wallet-flow-icon"><img src="https://cdn.simpleicons.org/tether" alt="USDT logo"/></span><div><div className="eyebrow">ADD FUNDS</div><h2>Deposit USDT</h2><p>Send USDT on TRON only. Select the TRC-20 network in your sending wallet.</p></div></div><div className="wallet-stepper"><span className={paymentOrder?"complete":"current"}><b>1</b> Amount</span><i/><span className={paymentOrder?"current":""}><b>2</b> Transfer</span><i/><span><b>3</b> Verify</span></div><div className="wallet-network-list"><div className="wallet-address-card wallet-network-featured"><div className="wallet-asset-title"><img src="https://cdn.simpleicons.org/tether" alt="USDT logo"/><span><strong>Tether (USDT)</strong><small>TRON network · TRC-20</small></span><b className="wallet-network-pill">SUPPORTED</b></div><p>Only send USDT using the TRC-20 network. Sending another asset or using another network may result in permanent loss.</p>{walletInfo?.deposit_addresses?.USDT?.address?<><code>{walletInfo.deposit_addresses.USDT.address}</code><div className="wallet-address-actions"><button type="button" onClick={copyDepositAddress}>Copy address</button><span>Use this address for USDT TRC-20 only</span></div></>:<div className="wallet-address-loading">{walletInfo?"USDT deposit address is not available right now.":"Loading your secure deposit address…"}</div>}</div><div className="wallet-address-card wallet-network-coming"><img src="https://cdn.simpleicons.org/ton" alt="TON logo"/><span><strong>TON network</strong><small>Deposits coming soon</small></span><b>COMING SOON</b></div></div>{paymentOrder?<section className="deposit-payment-step"><div className="deposit-step-title"><span>STEP 2 · PAYMENT REQUEST</span><h3>Send your exact payment</h3><p>Scan the QR code or copy the address. Flexar links this request to your account automatically — you do not need to enter an order number.</p></div><div className="deposit-qr-card">{walletInfo?.deposit_addresses?.USDT?.address?<img className="deposit-qr-code" src={"https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data="+encodeURIComponent(walletInfo.deposit_addresses.USDT.address)} alt="QR code for FLEXAR USDT TRC-20 deposit address"/>:<div className="deposit-qr-placeholder">QR code unavailable</div>}<small>USDT · TRON · TRC-20</small></div><div className="deposit-payment-amount"><small>SEND EXACTLY</small><strong>{Number(paymentOrder.payment_amount).toFixed(2)} <span>USDT</span></strong><p>{Number(paymentOrder.base_amount).toFixed(2)} USDT will be credited after verification. Send the exact amount shown.</p></div><div className="deposit-payment-actions"><button type="button" className="deposit-copy-button" onClick={copyDepositAddress}>Copy deposit address</button><button type="button" className="deposit-copy-button secondary" onClick={copyDepositAmount}>Copy exact amount</button></div><div className="deposit-auto-status" role="status"><span className={"deposit-auto-indicator "+(depositMatchIssue==="needs_review"?"review":"")}></span><div><strong>{depositMatchIssue==="needs_review"?"Payment needs review":depositChecking?"Checking the TRON blockchain…":"Automatic verification is active"}</strong><small>{depositWindowExpired?"30-minute payment window ended. If you paid, submit your transaction hash below.":"Payment window · "+depositCountdown+" remaining. Flexar checks automatically every 15 seconds."}</small></div><span className="deposit-auto-live">{depositMatchIssue==="needs_review"?"REVIEW":depositChecking?"CHECKING":"LIVE"}</span></div><button type="button" className="withdrawal-submit" disabled={depositChecking||busy} onClick={confirmDepositPayment}>{depositChecking?"Checking blockchain…":"Check payment now →"}</button>{depositWindowExpired&&<form className="deposit-hash-form" onSubmit={submitDepositHash}><div><strong>Still waiting for your deposit?</strong><p>Paste the transaction hash from your wallet or exchange. Flexar will check it directly against confirmed TRON data.</p></div><label>Transaction hash<input value={depositHash} onChange={e=>setDepositHash(e.target.value)} placeholder="Paste the transaction ID (hash)" autoComplete="off" spellCheck={false} maxLength={66} required/></label><button type="submit" disabled={depositChecking||busy||!depositHash.trim()}>{depositChecking?"Verifying transaction…":"Submit transaction hash →"}</button></form>}{depositMatchIssue==="needs_review"&&<div className="notice" role="status">Your transfer needs manual review. Your balance has not changed. Please keep the transaction hash available and contact FLEXAR support if requested.</div>}{depositWindowExpired&&!["needs_review","ambiguous"].includes(depositMatchIssue)&&<button type="button" className="deposit-new-request-button" onClick={()=>{setPaymentOrder(null);setDepositHash("");setDepositMatchIssue("");setNotice("Only start a new request if you did not send the previous payment.");}}>I didn’t send this payment — start a new request</button>}<p className="deposit-safety-note">Use USDT on TRON (TRC-20) only. Your balance changes only after the transaction is verified and safely matched.</p></section>:<form className="withdrawal-form deposit-amount-form" onSubmit={submitDeposit}><label>How much USDT would you like to deposit?<div className="deposit-amount-input"><span>$</span><input inputMode="decimal" value={depositAmount} onChange={e=>setDepositAmount(e.target.value)} placeholder="0.00" step="0.01" min="0.01" required/><b>USDT</b></div></label><div className="deposit-minimum-hint"><span>✓</span><p>Network <strong>TRON (TRC-20)</strong><br/>Your requested amount is credited after confirmation.</p></div><button className="withdrawal-submit" disabled={busy}>{busy?"Preparing secure payment…":"Continue to payment →"}</button></form>}{notice&&<div className="notice" role="status">{notice}</div>}<section className="deposit-history"><div className="deposit-history-head"><h3>Deposit activity</h3><span>{depositRequests.length} requests</span></div>{depositRequests.length?depositRequests.map(item=><div className="admin-row" key={item.id}><span>{Number(item.base_amount).toFixed(2)} USDT<small>{item.tx_hash?item.tx_hash.slice(0,14)+"…":"Awaiting transfer"}</small></span><b>{item.verification_status==="needs_review"?"NEEDS REVIEW":item.status==="pending"&&!item.payment_attempted_at?"AWAITING PAYMENT":item.status.toUpperCase()}</b></div>):<div className="empty-state">Your deposit history will appear here.</div>}</section></>}
    {action==="withdraw"&&withdrawalVerification!=="approved"&&<section className="profile-section" style={{marginTop:20}}><div className="eyebrow">WITHDRAWAL SECURITY</div><h2>Verify your identity first</h2><p>{withdrawalVerification===null?"Checking your identity verification status…":withdrawalVerification==="pending"?"Your documents are under manual review. Please ensure your details and documents are accurate; you can initiate a withdrawal once the review is complete.":withdrawalVerification==="unavailable"?"We could not check verification status. Please open your profile and retry before withdrawing.":"Submit a valid government-issued ID and a clear camera face scan. Make sure all information is accurate, as your details and documents are subject to manual review before you can initiate a withdrawal."}</p><button type="button" className="withdrawal-submit" disabled={withdrawalVerification===null} onClick={onVerification}>{withdrawalVerification==="pending"?"View verification status":"Open identity verification →"}</button></section>}{action==="withdraw"&&withdrawalVerification==="approved"&&<><div className="wallet-flow-heading"><span className="wallet-flow-icon"><img src="https://cdn.simpleicons.org/tether" alt="USDT logo"/></span><div><div className="eyebrow">WITHDRAW</div><h2>Withdraw USDT</h2><p>Withdrawals are available only to an external USDT wallet on TRON (TRC-20).</p></div></div><div className="withdrawal-network-banner"><span className="network-status-dot"/><div><strong>USDT · TRC-20 only</strong><small>Confirm your receiving wallet supports the TRON network before continuing.</small></div><img src="https://cdn.simpleicons.org/tether" alt="USDT logo"/></div><div className="withdrawal-balance-card"><div><small>AVAILABLE USDT BALANCE</small><strong>{Number(balances.find(a=>a.asset==="USDT")?.wallet?.available_balance||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6})}</strong></div><span>USDT</span></div><form className="withdrawal-form" onSubmit={submitWithdrawal}><label>Withdrawal amount<div className="withdrawal-amount-input"><span>$</span><input inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);setWithdrawalRequestId("");}} placeholder="0.00" min="0.01" step="0.01" required/><b>USDT</b></div></label><button type="button" className="withdrawal-max-button" onClick={()=>{setAmount(String(Number(balances.find(a=>a.asset==="USDT")?.wallet?.available_balance||0)));setWithdrawalRequestId("");}}>Use available balance</button><label>TRC-20 destination address<textarea value={address} onChange={e=>{setAddress(e.target.value);setWithdrawalRequestId("");}} placeholder="Paste your USDT TRC-20 wallet address" autoComplete="off" spellCheck={false} required/></label><div className="withdrawal-network-warning"><span>!</span><p><strong>Network check required</strong>Paste a USDT receiving address that supports TRC-20 (TRON). Do not use an ERC-20, TON, or other network address. Transfers to the wrong network may be irreversible.</p></div><button className="withdrawal-submit" disabled={busy}>{busy?"Submitting request…":"Review withdrawal →"}</button></form></>}
    {action==="swap"&&<><div className="eyebrow">PORTFOLIO SWAP</div><h2>Swap between your assets.</h2><p>Internal portfolio conversion uses current market reference prices and updates both balances atomically.</p><form onSubmit={submitSwap}><div className="swap-box"><small>You pay</small><div><input inputMode="decimal" value={swapAmount} onChange={e=>setSwapAmount(e.target.value)} placeholder="0.00"/><AssetSelector assets={balances} value={swapFrom} onChange={setSwapFrom} label="Asset to swap from"/></div><span>Available {Number(fromAsset.wallet?.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:6})} {fromAsset.symbol}</span></div><button type="button" className="swap-flip" onClick={()=>{setSwapFrom(swapTo);setSwapTo(swapFrom)}}>↓</button><div className="swap-box"><small>You receive</small><div><strong>{receiveQuote.toLocaleString(undefined,{maximumFractionDigits:8})}</strong><AssetSelector assets={balances} value={swapTo} onChange={setSwapTo} label="Asset to receive"/></div><span>1 {fromAsset.symbol} ≈ {(fromAsset.price/toAsset.price||0).toLocaleString(undefined,{maximumFractionDigits:8})} {toAsset.symbol}</span></div><button className="swap-submit" disabled={busy}>{busy?"Swapping…":"Swap now →"}</button></form></>}
    {notice&&<div className="notice" role="status">{notice}</div>}
  </div></div>;
}

function AssetSelector({ assets, value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const selectorRef = useRef(null);
  const menuRef = useRef(null);
  const selected = assets.find((asset) => asset.asset === value) || assets[0];

  const updatePosition = () => {
    const rect = selectorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.max(1, Math.min(280, viewportWidth - 24));
    const left = Math.max(12, Math.min(rect.right - width, viewportWidth - width - 12));
    const below = Math.max(0, viewportHeight - rect.bottom - 16);
    const above = Math.max(0, rect.top - 16);
    const expectedHeight = Math.min(300, assets.length * 54 + (assets.length > 4 ? 34 : 12));
    const showBelow = below >= Math.min(expectedHeight, 160) || below >= above;
    const available = Math.max(48, (showBelow ? below : above) - 8);
    const maxHeight = Math.max(48, Math.min(300, available));
    const top = showBelow ? Math.max(8, Math.min(rect.bottom + 7, viewportHeight - maxHeight - 8)) : Math.max(8, rect.top - Math.min(maxHeight, expectedHeight) - 7);
    setMenuPosition({ position: "fixed", left, top, width, maxHeight });
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event) => {
      if (!selectorRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeEscape = (event) => { if (event.key === "Escape") setOpen(false); };
    const handleScroll = (event) => {
      if (menuRef.current && event.target !== menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    };
    updatePosition();
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, assets.length]);

  if (!selected) return null;
  const menu = open && menuPosition ? createPortal(
    <div ref={menuRef} style={menuPosition} className="asset-selector-menu" role="listbox" aria-label={label} onWheel={(event) => event.stopPropagation()} onTouchMove={(event) => event.stopPropagation()}>
      {assets.length > 4 && <div className="asset-selector-scroll-hint"><span>SCROLL TO VIEW ASSETS</span><span aria-hidden="true">↕</span></div>}
      {assets.map((asset) => <button type="button" role="option" aria-selected={asset.asset === value} key={asset.asset} className={asset.asset === value ? "asset-selector-option selected" : "asset-selector-option"} onClick={() => { onChange(asset.asset); setOpen(false); }}>
        <img src={asset.icon} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
        <span><strong>{asset.label}</strong><small>{asset.symbol}{asset.network && asset.network !== "Internal" ? " · " + asset.network : ""}</small></span>
        {asset.asset === value && <b aria-hidden="true">✓</b>}
      </button>)}
    </div>, document.body
  ) : null;

  return <div className="asset-selector" ref={selectorRef}>
    <button type="button" className="asset-selector-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => { if (open) { setOpen(false); return; } updatePosition(); setOpen(true); }}>
      <img src={selected.icon} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
      <span><strong>{selected.symbol}</strong><small>{selected.label}</small></span>
      <i aria-hidden="true">{open ? "⌃" : "⌄"}</i>
    </button>
    {menu}
  </div>;
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
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [remoteSearch, setRemoteSearch] = useState({query:"",users:[],wallets:[]});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [editingUser, setEditingUser] = useState(null);

  const load = useCallback(async () => {
    if (!supabase) { setError("Admin data service is not configured."); return; }
    setBusy(true);
    try {
      const result = await supabase.functions.invoke("admin-control", { body: { action: "overview" } });
      if (result.error || result.data?.error) setError(result.data?.error || result.error?.message || "Could not load admin data.");
      else {
        const verificationResult = await supabase.functions.invoke("admin-control", { body: { action: "list_identity_verifications" } });
        if (verificationResult.error || verificationResult.data?.error) {
          setData({...result.data,identityVerifications:[]});
          setError(verificationResult.data?.error || verificationResult.error?.message || "Could not load identity verification queue.");
        } else {
          setData({...result.data,identityVerifications:verificationResult.data?.verifications||[]});
          setError("");
        }
        setLastUpdated(new Date());
      }
    } catch (loadError) { setError(loadError?.message || "Could not load admin data."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const query=search.trim();
    if(query.length<2){setRemoteSearch({query:"",users:[],wallets:[]});return;}
    let cancelled=false;
    const timer=window.setTimeout(async()=>{
      try{
        const result=await supabase.functions.invoke("admin-control",{body:{action:"search_users",query}});
        if(!cancelled&&!result.error&&!result.data?.error)setRemoteSearch({query,users:result.data?.users||[],wallets:result.data?.wallets||[]});
      }catch{}
    },250);
    return ()=>{cancelled=true;window.clearTimeout(timer);};
  },[search]);
  const lookupUsers=useCallback(async(query)=>{
    const result=await supabase.functions.invoke("admin-control",{body:{action:"search_users",query}});
    if(result.error||result.data?.error)throw new Error(result.data?.error||result.error?.message||"Could not search accounts.");
    return result.data||{users:[],wallets:[]};
  },[]);

  async function act(action, payload = {}) {
    if (!supabase) { setError("Admin data service is not configured."); return false; }
    setBusy(true);
    try {
      const result = await supabase.functions.invoke("admin-control", { body: { action, ...payload } });
      if (result.error || result.data?.error) { setError(result.data?.error || result.error?.message || "Action failed."); return false; }
      setError("");
      await load();
      return true;
    } catch (actionError) { setError(actionError?.message || "Action failed."); return false; }
    finally { setBusy(false); }
  }

  if (!data) return <div className="admin-shell">
    <header className="admin-header"><div><small>FLEXAR AI · OPERATIONS</small><h1>Admin Dashboard</h1><p>Secure platform operations and monitoring.</p></div><button className="secondary" type="button" onClick={onExit}>Exit admin</button></header>
    {error && <div className="admin-alert" role="alert">{error}</div>}
    <div className="admin-card admin-loading-card">{busy ? "Loading platform data…" : "Platform data is not available."}<button className="mini-action" type="button" onClick={() => void load()}>Retry</button></div>
  </div>;

  const remoteMatches=search.trim().length>=2&&remoteSearch.query===search.trim();
  const allUsers=(remoteMatches?remoteSearch.users:data.users)||[], users=allUsers.filter(item=>!item.is_admin&&!item.is_deleted), administrators=allUsers.filter(item=>item.is_admin&&!item.is_deleted), tx=data.transactions||[], trades=data.trades||[], opp=data.opportunities||[];
  const markets=data.markets||[], plans=data.plans||[], subs=data.subscriptions||[], learning=data.learning||[];
  const adaptive=data.adaptive||[], wallets=(remoteMatches?remoteSearch.wallets:data.wallets)||[], deposits=data.depositRequests||[];
  const paymentOrders=data.paymentOrders||[], walletDepositOrders=paymentOrders.filter(item=>item.purpose==="wallet_deposit"), aiCreditOrders=data.aiCreditOrders||[], diagnostics=data.diagnostics||[], credits=data.creditTransactions||[];
  const rewards=data.rewards||[], referrals=data.referrals||[], modelStats=data.modelStats||[], audit=data.audit||[];
  const q=search.trim().toLowerCase();
  const matches=(...values)=>!q||values.some(value=>String(value??"").toLowerCase().includes(q));
  const userName=(id)=>{const u=allUsers.find(item=>item.id===id);return u?.display_name||u?.username||u?.telegram_username||u?.email||(id?String(id).slice(0,8)+"…":"Unknown user");};
  const userEmail=(id)=>users.find(item=>item.id===id)?.email||"Email not available";
  const money=(value,digits=2)=>Number(value||0).toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const counts=data.counts||{};
  const won=learning.filter(item=>item.outcome==="won").length, lost=learning.filter(item=>item.outcome==="lost").length;
  const pendingWithdrawals=tx.filter(item=>item.type==="withdrawal"&&["pending","processing"].includes(item.status)).length;
  const pendingDeposits=walletDepositOrders.filter(item=>["pending","incomplete"].includes(item.status)&&(item.payment_attempted_at||item.verification_status==="needs_review")).length+deposits.filter(item=>item.status==="pending").length;
  const aiPaidOrders=aiCreditOrders.filter(item=>item.status==="paid");
  const aiCreditRevenue=aiPaidOrders.reduce((sum,item)=>sum+Number(item.base_amount||0),0);
  const pendingAiCreditOrders=aiCreditOrders.filter(item=>["pending","incomplete"].includes(item.status)&&(item.payment_attempted_at||item.verification_status==="needs_review")).length;
  const availableTotal=wallets.filter(item=>item.asset==="USDT").reduce((sum,item)=>sum+Number(item.available_balance||0),0);
  const lockedTotal=wallets.filter(item=>item.asset==="USDT").reduce((sum,item)=>sum+Number(item.locked_balance||0),0);
  const navGroups=[{label:"Workspace",items:[["overview","Overview","⌂"]]},{label:"Accounts & funds",items:[["users","Users","♙"],["verification","Identity verification","✓"],["wallets","Wallets","◈"]]},{label:"Payments",items:[["aiPurchases","AI credit purchases","✦"],["deposits","Deposits","↓"],["withdrawals","Withdrawals","↑"],["transactions","Wallet ledger","≋"]]},{label:"Trading & intelligence",items:[["trading","Trading activity","↗"],["ai","AI engine","✧"],["markets","Market controls","⌁"],["credits","AI credit ledger","◉"]]},{label:"Plans & growth",items:[["subscriptions","Subscriptions","▣"],["rewards","Rewards & referrals","♧"]]},{label:"System",items:[["health","System health","⌘"],["audit","Audit log","☷"],["settings","Settings","⚙"],["administrators","Administrators","♙"]]}];
  const activeNavItem=navGroups.flatMap(group=>group.items).find(([id])=>id===tab);
  const sectionDescriptions={
    overview:"A live snapshot of platform activity, financial queues, and system health.",
    users:"Search, edit and manage customer accounts. Administrator access is managed separately.",
    verification:"Review government ID and camera face-scan submissions before enabling withdrawals.",
    wallets:"Review wallet balances and make audited balance adjustments.",
    aiPurchases:"Track AI credit orders, payment evidence, sender wallets, and credit delivery.",
    deposits:"Review wallet deposit payments and submitted deposit claims separately from purchases.",
    withdrawals:"Review withdrawal requests and record payout outcomes.",
    transactions:"Inspect wallet movements and financial references across the platform.",
    trading:"Review recent trading activity and position outcomes.",
    ai:"Monitor the AI engine and its operational configuration.",
    markets:"Control which markets are enabled and tradable.",
    credits:"Audit AI credit grants, purchases, and adjustments.",
    subscriptions:"Manage plan access, subscription status, and billing cycles.",
    rewards:"Review reward allocations and referral activity.",
    health:"Investigate diagnostics, client errors, and platform warnings.",
    audit:"Review administrator actions and their recorded context.",
    settings:"Manage platform-level settings and operational preferences.", administrators:"Manage administrator accounts separately from customers."
  };

  return <div className="admin-shell"><div className="admin-layout" data-admin-section={tab}>
    <aside className="admin-sidebar"><div className="admin-sidebar-brand"><img src="/flexa-symbol.webp" alt=""/><span><strong>FLEXAR AI</strong><small>ADMIN CONSOLE</small></span></div><div className="admin-sidebar-identity"><span className="admin-sidebar-avatar">A</span><span><strong>Operations</strong><small>Secure administrator</small></span><i/></div><nav className="admin-sidebar-nav" aria-label="Admin navigation">{navGroups.map(group=><div className="admin-nav-group" key={group.label}><small className="admin-nav-label">{group.label}</small>{group.items.map(([id,label,glyph])=><button type="button" key={id} className={tab===id?"active":""} aria-current={tab===id?"page":undefined} onClick={()=>setTab(id)}><span className="admin-nav-glyph">{glyph}</span><span>{label}</span>{id==="aiPurchases"&&pendingAiCreditOrders>0&&<b className="admin-nav-count">{pendingAiCreditOrders}</b>}</button>)}</div>)}</nav><div className="admin-sidebar-footer"><span className="admin-live-dot"/><span><strong>Operations service</strong><small>Protected admin session</small></span></div></aside><main className="admin-main">
    <header className="admin-header">
      <div className="admin-page-heading"><small>FLEXAR AI <span>/</span> OPERATIONS <span>/</span> {activeNavItem?.[1]||"Overview"}</small><h1>{activeNavItem?.[1]||"Overview"}</h1><p>{sectionDescriptions[tab]||"Manage FLEXAR AI platform operations."}</p><span className="admin-updated">{lastUpdated ? "Live data refreshed "+lastUpdated.toLocaleTimeString() : "Loading live data"}</span></div>
      <div className="admin-header-actions"><button className="secondary" type="button" disabled={busy} onClick={()=>void load()}>{busy?"Refreshing…":"↻ Refresh data"}</button><button className="secondary" type="button" onClick={onExit}>Exit admin</button></div>
    </header>
    <div className="admin-toolbar"><label htmlFor="admin-global-search">Search loaded records</label><input id="admin-global-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search users, IDs, transactions, assets, errors…"/>{search&&<button type="button" className="mini-action" onClick={()=>setSearch("")}>Clear</button>}</div>
    {error&&<div className="admin-alert" role="alert">{error}</div>}
    {Array.isArray(data.errors)&&data.errors.length>0&&<details className="admin-data-warning"><summary>Some data sources could not be loaded ({data.errors.length})</summary><ul>{data.errors.map((message,index)=><li key={index}>{message}</li>)}</ul></details>}

    {tab==="overview"&&<>
      <div className="admin-kpis">
        <Kpi label="Active customers" value={users.length}/>
        <Kpi label="Wallet transactions" value={counts.transactions??tx.length}/>
        <Kpi label="Trading records" value={counts.trades??trades.length}/>
        <Kpi label="Pending withdrawals" value={pendingWithdrawals}/>
        <Kpi label="Pending AI purchases" value={pendingAiCreditOrders}/>
        <Kpi label="Pending deposits" value={pendingDeposits}/>
        <Kpi label="AI credit purchases" value={data.counts?.aiCreditOrders??aiCreditOrders.length}/>
        <Kpi label="AI credit revenue" value={money(aiCreditRevenue)+" USDT"}/>
        <Kpi label="Active markets" value={markets.filter(item=>item.active).length+"/"+markets.length}/>
        <Kpi label="Available wallet total" value={money(availableTotal)+" USDT"}/>
        <Kpi label="Locked wallet total" value={money(lockedTotal)+" USDT"}/>
      </div>
      <div className="admin-grid">
        <AdminPanel title="Action required">
          <button type="button" className="admin-quick-link" onClick={()=>setTab("withdrawals")}><span><strong>Withdrawal queue</strong><small>Requests awaiting review or payout confirmation</small></span><b>{pendingWithdrawals} →</b></button>
          <button type="button" className="admin-quick-link" onClick={()=>setTab("deposits")}><span><strong>Deposit requests</strong><small>Review submitted deposits and reconciliation notes</small></span><b>{pendingDeposits} pending →</b></button>
          <button type="button" className="admin-quick-link" onClick={()=>setTab("aiPurchases")}><span><strong>AI credit purchases</strong><small>Identify buyers, match transfers, and check verification</small></span><b>{pendingAiCreditOrders} pending →</b></button>
          <button type="button" className="admin-quick-link" onClick={()=>setTab("health")}><span><strong>System diagnostics</strong><small>Client errors and recent warnings</small></span><b>{diagnostics.filter(item=>item.level==="error").length} errors →</b></button>
        </AdminPanel>
        <AdminPanel title="AI and market health">
          <div className="admin-summary-line"><span>Enabled markets</span><strong>{markets.filter(item=>item.active).length} / {markets.length}</strong></div>
          <div className="admin-summary-line"><span>Tradable markets</span><strong>{markets.filter(item=>item.tradable).length}</strong></div>
          <div className="admin-summary-line"><span>Adaptive profiles</span><strong>{adaptive.length}</strong></div>
          <div className="admin-summary-line"><span>Evaluation outcomes</span><strong>{won} wins / {lost} losses</strong></div>
          <div className="admin-summary-line"><span>Model performance rows</span><strong>{modelStats.length}</strong></div>
        </AdminPanel>
        <AdminPanel title="Recent financial activity">
          {tx.slice(0,8).map(item=><div className="admin-activity-row" key={item.id}><span><strong>{item.type?.replace(/_/g," ")||"Transaction"}</strong><small>{userName(item.user_id)} · {item.status||"—"}</small></span><b>{item.direction==="credit"?"+":"−"}{money(item.amount)} USDT</b></div>)}
          {!tx.length&&<p>No wallet transactions in the latest data window.</p>}
          <button type="button" className="admin-text-link" onClick={()=>setTab("transactions")}>View transaction ledger →</button>
        </AdminPanel>
        <AdminPanel title="Recent system events">
          {diagnostics.slice(0,6).map(item=><div className="admin-activity-row" key={item.id}><span><strong>{item.event_name||item.source||"Diagnostic event"}</strong><small>{item.message||item.page_path||"No message"} · {item.created_at?new Date(item.created_at).toLocaleString():"—"}</small></span><b className={"admin-level-"+(item.level||"info")}>{item.level||"info"}</b></div>)}
          {!diagnostics.length&&<p>No diagnostic events available.</p>}
          <button type="button" className="admin-text-link" onClick={()=>setTab("health")}>Open system health →</button>
        </AdminPanel>
      </div>
    </>}

    {tab==="verification"&&<AdminIdentityVerifications verifications={data.identityVerifications||[]} onAction={act} busy={busy}/>}
    {tab==="users"&&<>
      <AdminTable title={"Customers · "+users.length+" active (latest records loaded)"} columns={["User","Email / username","Provider","Joined","Access"]} emptyMessage="No users match your search.">
        {users.filter(item=>matches(item.id,item.display_name,item.username,item.email,item.last_login_provider)).map(item=><div className="admin-row" key={item.id}><span><strong>{item.display_name||item.telegram_username||"User"}</strong><small>{item.id}</small></span><span>{item.email||"—"}<small>{item.username?"@"+item.username:"Username not set"}</small></span><span>{item.last_login_provider||"—"}</span><span>{item.created_at?new Date(item.created_at).toLocaleString():"—"}</span><span><b>{"Customer"}</b><button type="button" className="mini-action" disabled={busy} onClick={()=>setEditingUser(item)}>Edit user</button> <button type="button" className="mini-action danger-action" disabled={busy} onClick={()=>{if(window.confirm("Remove this user from the active customer list? Sign-in will be blocked, and wallet, payment, referral and trading history will be preserved for audit integrity."))void act("delete_user",{user_id:item.id});}}>Delete user</button></span></div>)}
      </AdminTable>
      <p className="admin-note">Customer accounts can be edited or deactivated here. Deactivation preserves wallet, payment and trading history. Administrator privileges are managed only in the Administrators section.</p>
    </>}

    {tab==="users"&&editingUser&&<AdminUserEditor user={editingUser} onClose={()=>setEditingUser(null)} onSave={async patch=>{const ok=await act("update_user",{user_id:editingUser.id,patch});if(ok)setEditingUser(null);return ok;}}/>}
    {tab==="wallets"&&<AdminWallets wallets={wallets.filter(item=>!allUsers.some(u=>u.id===item.user_id&&u.is_admin)&&matches(item.user_id,item.asset,item.network,userName(item.user_id),userEmail(item.user_id)))} users={users} onAction={act} search={search} lookupUsers={lookupUsers} busy={busy}/>}

    {tab==="deposits"&&<>
      <div className="admin-kpis"><Kpi label="Deposit requests" value={deposits.length}/><Kpi label="Awaiting review" value={pendingDeposits}/><Kpi label="Incomplete after 30 minutes" value={deposits.filter(item=>item.status==="incomplete").length}/><Kpi label="Approved" value={deposits.filter(item=>item.status==="approved").length}/></div>
      <AdminPanel title="Deposit review"><p>Only wallet deposit submissions appear here. Unsubmitted requests move to Incomplete after 30 minutes. Valid transfers with an ambiguous match are flagged for review; their verification evidence stays attached to the order.</p></AdminPanel>
      <AdminTable title="Pending wallet deposit payments" columns={["User / account","Payment amount","Base deposit","Status","Order / expiry"]} emptyMessage="No pending wallet deposit payments.">
        {walletDepositOrders.filter(item=>item.status==="pending"&&(item.payment_attempted_at||item.verification_status==="needs_review")&&matches(item.id,item.user_id,item.payment_amount,item.base_amount,item.tx_hash,item.verification_details?.manual_submission?.tx_hash)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{userEmail(item.user_id)}</small><small>{item.user_id}</small></span><span>{money(item.payment_amount,6)} USDT</span><span>{money(item.base_amount,2)} USDT</span><span><b className={"admin-status "+(item.verification_status==="needs_review"?"status-pending":"status-pending")}>{item.verification_status==="needs_review"?"Needs review":"Pending"}</b><small>{(item.verification_status||"pending").replace(/_/g," ")}</small></span><span><small>{item.id}</small><small>Expires {item.expires_at?new Date(item.expires_at).toLocaleString():"—"}</small><small>{item.verification_details?.manual_submission?.tx_hash?"Submitted hash: "+item.verification_details.manual_submission.tx_hash.slice(0,14)+"…":item.tx_hash?"Transaction recorded":"Awaiting transfer"}</small><small>{item.verification_details?.manual_submission?.reason?.replace(/_/g," ")||""}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Open wallet payment requests · awaiting user check" columns={["User / account","Payment amount","Base deposit","Status","Order / expiry"]} emptyMessage="No open wallet payment requests.">
        {walletDepositOrders.filter(item=>item.status==="pending"&&!item.payment_attempted_at&&item.verification_status!=="needs_review"&&matches(item.id,item.user_id,item.payment_amount,item.base_amount)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{userEmail(item.user_id)}</small><small>{item.user_id}</small></span><span>{money(item.payment_amount,6)} USDT</span><span>{money(item.base_amount,2)} USDT</span><span><b className="admin-status status-pending">Open request</b><small>Not counted as an attempt</small></span><span><small>{item.id}</small><small>Expires {item.expires_at?new Date(item.expires_at).toLocaleString():"—"}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Incomplete wallet deposit payments" columns={["User / account","Payment amount","Base deposit","Status","Order / created"]} emptyMessage="No incomplete wallet deposit payments.">
        {walletDepositOrders.filter(item=>item.status==="incomplete"&&matches(item.id,item.user_id,item.payment_amount,item.base_amount,item.tx_hash,item.verification_details?.manual_submission?.tx_hash)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{userEmail(item.user_id)}</small><small>{item.user_id}</small></span><span>{money(item.payment_amount,6)} USDT</span><span>{money(item.base_amount,2)} USDT</span><span><b className={"admin-status "+(item.verification_status==="needs_review"?"status-pending":"status-expired")}>{item.verification_status==="needs_review"?"Needs review":"Incomplete"}</b><small>{(item.verification_status||"incomplete").replace(/_/g," ")}</small></span><span><small>{item.id}</small><small>Created {item.created_at?new Date(item.created_at).toLocaleString():"—"}</small><small>{item.verification_details?.manual_submission?.tx_hash?"Submitted hash: "+item.verification_details.manual_submission.tx_hash.slice(0,14)+"…":item.tx_hash?"Transaction reference recorded — investigate":"No transfer confirmed within 30 minutes"}</small><small>{item.verification_details?.manual_submission?.reason?.replace(/_/g," ")||""}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Completed wallet deposit payments" columns={["User / account","Payment amount","Base deposit","Verification","Transaction / paid"]} emptyMessage="No completed wallet deposit payments.">
        {walletDepositOrders.filter(item=>item.status==="paid"&&matches(item.id,item.user_id,item.payment_amount,item.base_amount,item.tx_hash,item.sender_address)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{userEmail(item.user_id)}</small><small>{item.user_id}</small></span><span>{money(item.payment_amount,6)} USDT</span><span>{money(item.base_amount,2)} USDT</span><span><b className={"admin-status "+(item.verification_status==="verified"?"status-completed":"status-pending")}>{(item.verification_status||"pending").replace(/_/g," ")}</b><small>{item.sender_address||"Sender not recorded"}</small></span><span>{item.tx_hash?<a href={"https://tronscan.org/#/transaction/"+encodeURIComponent(item.tx_hash)} target="_blank" rel="noreferrer">View transaction ↗</a>:"No transaction hash"}<small>{item.paid_at?new Date(item.paid_at).toLocaleString():"—"}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Pending deposit requests" columns={["User","Asset / network","Amount","Status","Review notes / hash"]} emptyMessage="There are no pending deposit requests.">
        {deposits.filter(item=>item.status==="pending"&&matches(item.id,item.user_id,item.asset,item.network,item.amount,item.tx_hash,item.admin_note)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{item.user_id}</small></span><span>{item.asset||"USDT"} · {item.network||"—"}</span><span>{money(item.amount,6)} USDT</span><span><b className="admin-status status-pending">Pending review</b><small>{item.created_at?new Date(item.created_at).toLocaleString():"—"}</small></span><span>{item.tx_hash?<a href={"https://tronscan.org/#/transaction/"+encodeURIComponent(item.tx_hash)} target="_blank" rel="noreferrer">View transaction ↗</a>:"No transaction hash"}<small>{item.admin_note||"No review note"}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Incomplete deposit requests · 30-minute expiry" columns={["User","Asset / network","Amount","Status","Created / notes"]} emptyMessage="No incomplete deposit requests.">
        {deposits.filter(item=>item.status==="incomplete"&&matches(item.id,item.user_id,item.asset,item.network,item.amount,item.admin_note)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{item.user_id}</small></span><span>{item.asset||"USDT"} · {item.network||"—"}</span><span>{money(item.amount,6)} USDT</span><span><b className="admin-status status-expired">Incomplete</b></span><span><small>{item.created_at?new Date(item.created_at).toLocaleString():"—"}</small><small>{item.admin_note||"No transaction hash submitted within 30 minutes."}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Reviewed deposit history" columns={["User","Asset / network","Amount","Status","Review notes / hash"]} emptyMessage="No reviewed deposit requests.">
        {deposits.filter(item=>!["pending","incomplete"].includes(item.status)&&matches(item.id,item.user_id,item.asset,item.network,item.amount,item.status,item.tx_hash,item.admin_note)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{item.user_id}</small></span><span>{item.asset||"USDT"} · {item.network||"—"}</span><span>{money(item.amount,6)} USDT</span><span><b className={"admin-status "+(item.status==="approved"?"status-completed":"status-expired")}>{item.status||"—"}</b></span><span>{item.tx_hash?<a href={"https://tronscan.org/#/transaction/"+encodeURIComponent(item.tx_hash)} target="_blank" rel="noreferrer">View transaction ↗</a>:"No transaction hash"}<small>{item.admin_note||"No review note"}</small></span></div>)}
      </AdminTable>
    </>}
    {tab==="withdrawals"&&<AdminWithdrawals transactions={tx.filter(item=>matches(item.id,item.user_id,item.status,item.tx_hash,item.amount,item.metadata?.destination_address))} onAction={act} userName={userName}/>}
    {tab==="transactions"&&<AdminTable title="Wallet ledger · latest records" columns={["User","Type","Direction","Amount","Status","Created"]} emptyMessage="No transactions match your search.">
      {tx.filter(item=>matches(item.id,item.user_id,item.type,item.direction,item.status,item.tx_hash,item.reference,item.amount)).map(item=><div className="admin-row" key={item.id}><span>{userName(item.user_id)}<small>{item.user_id}</small></span><span>{item.type||"—"}<small>{item.reference||""}</small></span><span>{item.direction||"—"}</span><span>{money(item.amount,6)} USDT</span><span>{item.status||"—"}<small>{item.tx_hash?"TX "+item.tx_hash.slice(0,12)+"…":""}</small></span><span>{item.created_at?new Date(item.created_at).toLocaleString():"—"}</span></div>)}
    </AdminTable>}

    {tab==="trading"&&<AdminPanel title="Trading activity by customer"><p>Summaries keep the overview readable. Expand a customer to inspect their most recent trades; the full underlying trade history remains available in the database.</p>{(()=>{const filtered=trades.filter(item=>matches(item.id,item.user_id,item.asset,item.direction,item.status,item.stake,item.result_amount,userName(item.user_id)));const groups=Object.values(filtered.reduce((acc,item)=>{(acc[item.user_id]||(acc[item.user_id]={user_id:item.user_id,items:[]})).items.push(item);return acc;},{})).sort((x,y)=>y.items.length-x.items.length);return groups.length?groups.map(group=>{const active=group.items.filter(t=>t.status==="active").length,wins=group.items.filter(t=>t.status==="won").length,losses=group.items.filter(t=>t.status==="lost").length,volume=group.items.reduce((sum,t)=>sum+Number(t.stake||0),0);return <details className="admin-referral-tree" key={group.user_id}><summary><span><strong>{userName(group.user_id)}</strong><small>{group.items.length} trades · {active} active · {wins} wins / {losses} losses</small></span><span><strong>{money(volume)} USDT volume</strong><small>Most recent: {group.items[0]?.opened_at?new Date(group.items[0].opened_at).toLocaleString():"—"}</small></span></summary><div className="admin-record-details"><div className="admin-table-head" style={{"--admin-columns":6}}>{["Asset","Direction","Stake","Status","Result","Opened"].map(x=><span key={x}>{x}</span>)}</div>{group.items.slice(0,10).map(t=><div className="admin-row" key={t.id}><span>{t.asset||"—"}<small>{t.id}</small></span><span>{t.direction||"—"}</span><span>{money(t.stake)} USDT</span><span>{t.status||"—"}</span><span>{t.result_amount==null?"Pending":money(t.result_amount)+" USDT"}</span><span>{t.opened_at?new Date(t.opened_at).toLocaleString():"—"}</span></div>)}{group.items.length>10&&<small>Showing 10 most recent of {group.items.length} loaded trades for this customer.</small>}</div></details>;}):<div className="admin-empty-row">No trades match your search.</div>;})()}</AdminPanel>}
    {tab==="markets"&&<AdminTable title="Market controls" columns={["Market","Type / source","Status","Trading access"]} emptyMessage="No markets match your search.">
      {markets.filter(item=>matches(item.symbol,item.display_symbol,item.market_type,item.source)).map(item=><div className="admin-row" key={item.symbol}><span><strong>{item.display_symbol||item.symbol}</strong><small>{item.symbol}</small></span><span>{item.market_type||"—"}<small>{item.source||"—"}</small></span><span><b>{item.active?"Enabled":"Disabled"}</b><button type="button" className="mini-action" disabled={busy} onClick={()=>void act("update_market",{symbol:item.symbol,active:!item.active})}>{item.active?"Disable market":"Enable market"}</button></span><span><b>{item.tradable?"Tradable":"Locked"}</b><button type="button" className="mini-action" disabled={busy} onClick={()=>void act("update_market",{symbol:item.symbol,tradable:!item.tradable})}>{item.tradable?"Lock trading":"Allow trading"}</button></span></div>)}
    </AdminTable>}

    {tab==="ai"&&<>
      <AdminPanel title="AI evaluation snapshot"><div className="admin-summary-line"><span>Evaluation wins</span><strong>{won}</strong></div><div className="admin-summary-line"><span>Evaluation losses</span><strong>{lost}</strong></div><div className="admin-summary-line"><span>Evaluation rows loaded</span><strong>{learning.length}</strong></div><p className="admin-note">Evaluation history is not a guarantee of future performance.</p></AdminPanel>
      <AdminTable title="AI opportunities" columns={["Market","Direction","Confidence","Status / outcome","Model / created"]} emptyMessage="No AI opportunities match your search.">
        {opp.filter(item=>matches(item.id,item.symbol,item.direction,item.status,item.outcome,item.model_version)).map(item=><div className="admin-row" key={item.id}><span><strong>{item.symbol}</strong><small>{item.id}</small></span><span>{item.direction||"—"}</span><span>{Math.round(Number(item.signal_score||0)*100)}%</span><span>{item.status||"—"}<small>{item.outcome||"Pending outcome"}</small></span><span>{item.model_version||"—"}<small>{item.created_at?new Date(item.created_at).toLocaleString():"—"}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Adaptive model profiles" columns={["Market","Samples","Confidence floor","Weights","Calculated"]} emptyMessage="No adaptive profiles match your search.">
        {adaptive.filter(item=>matches(item.symbol,item.model_version,item.sample_size,JSON.stringify(item.weights))).map(item=><div className="admin-row" key={item.id}><span>{item.symbol}<small>{item.model_version||"—"}</small></span><span>{item.sample_size??0}</span><span>{item.confidence_floor??"—"}</span><span className="admin-wrap-cell">{JSON.stringify(item.weights)}</span><span>{item.calculated_at?new Date(item.calculated_at).toLocaleString():"—"}</span></div>)}
      </AdminTable>
      <AdminTable title="Model performance history" columns={["Model","Market / interval","Samples","Wins / losses","Win rate"]} emptyMessage="No model performance data available.">
        {modelStats.filter(item=>matches(item.model_version,item.symbol,item.interval)).map(item=><div className="admin-row" key={item.id}><span>{item.model_version}</span><span>{item.symbol}<small>{item.interval}</small></span><span>{item.sample_size}</span><span>{item.wins} / {item.losses}</span><span>{money(item.win_rate,2)}%</span></div>)}
      </AdminTable>
    </>}

    {tab==="aiPurchases"&&<>
      <div className="admin-kpis"><Kpi label="AI credit orders" value={data.counts?.aiCreditOrders??aiCreditOrders.length}/><Kpi label="Paid orders" value={aiPaidOrders.length}/><Kpi label="Payment attempts" value={pendingAiCreditOrders}/><Kpi label="Open requests" value={aiCreditOrders.filter(item=>item.status==="pending"&&!item.payment_attempted_at&&item.verification_status!=="needs_review").length}/><Kpi label="Incomplete after 30 minutes" value={aiCreditOrders.filter(item=>item.status==="incomplete").length}/><Kpi label="Verified package revenue" value={money(aiCreditRevenue)+" USDT"}/></div>
      <AdminPanel title="Payment identity and verification"><p>Every order is tied to the signed-in FLEXAR account and its unique expected amount. Verified records include the sender wallet, recipient, USDT contract, transfer amount, transaction hash and confirmed block receipt. The sender address identifies the wallet used, not the real-world owner. Orders without a verified transfer after 30 minutes leave the pending queue. Any submitted hash or review reason remains attached to the incomplete order for investigation.</p></AdminPanel>
      <AdminTable title="Pending AI credit purchases" columns={["Buyer / account","Package","Payment","Verification","Order / expiry"]} emptyMessage="There are no pending AI credit purchases.">
        {aiCreditOrders.filter(item=>item.status==="pending"&&(item.payment_attempted_at||item.verification_status==="needs_review")&&matches(item.id,item.user_id,userName(item.user_id),userEmail(item.user_id),item.payment_amount,item.credits,item.tx_hash,item.verification_details?.manual_submission?.tx_hash)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{userEmail(item.user_id)}</small><small>{item.user_id}</small></span><span>{item.credits||"—"} credits<small>Package {money(item.base_amount)} USDT</small></span><span>{money(item.payment_amount,2)} USDT<small className="admin-status status-pending">Pending</small></span><span><small>{item.verification_status||"pending"}</small><small>{item.verification_details?.manual_submission?.tx_hash?"Submitted hash: "+item.verification_details.manual_submission.tx_hash.slice(0,14)+"…":item.tx_hash?"Transaction reference recorded":"Awaiting transfer"}</small><small>{item.verification_details?.manual_submission?.reason?.replace(/_/g," ")||""}</small></span><span><small>{item.id}</small><small>Created {item.created_at?new Date(item.created_at).toLocaleString():"—"}</small><small>{item.expires_at?"Expires "+new Date(item.expires_at).toLocaleString():"—"}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Open AI credit requests · awaiting user check" columns={["Buyer / account","Package","Payment","Status","Order / expiry"]} emptyMessage="No open AI credit payment requests.">
        {aiCreditOrders.filter(item=>item.status==="pending"&&!item.payment_attempted_at&&item.verification_status!=="needs_review"&&matches(item.id,item.user_id,userName(item.user_id),userEmail(item.user_id),item.payment_amount,item.credits)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{userEmail(item.user_id)}</small><small>{item.user_id}</small></span><span>{item.credits||"—"} credits<small>Package {money(item.base_amount)} USDT</small></span><span>{money(item.payment_amount,2)} USDT</span><span><b className="admin-status status-pending">Open request</b><small>Not counted as an attempt</small></span><span><small>{item.id}</small><small>Expires {item.expires_at?new Date(item.expires_at).toLocaleString():"—"}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Incomplete AI credit purchases · 30-minute expiry" columns={["Buyer / account","Package","Payment","Status","Order / created"]} emptyMessage="No incomplete AI credit purchases.">
        {aiCreditOrders.filter(item=>item.status==="incomplete"&&matches(item.id,item.user_id,userName(item.user_id),userEmail(item.user_id),item.payment_amount,item.credits,item.tx_hash,item.verification_details?.manual_submission?.tx_hash)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{userEmail(item.user_id)}</small><small>{item.user_id}</small></span><span>{item.credits||"—"} credits<small>Package {money(item.base_amount)} USDT</small></span><span>{money(item.payment_amount,2)} USDT</span><span><b className={"admin-status "+(item.verification_status==="needs_review"?"status-pending":"status-expired")}>{item.verification_status==="needs_review"?"Needs review":"Incomplete"}</b><small>{(item.verification_status||"incomplete").replace(/_/g," ")}</small></span><span><small>{item.id}</small><small>Created {item.created_at?new Date(item.created_at).toLocaleString():"—"}</small><small>{item.verification_details?.manual_submission?.tx_hash?"Submitted hash: "+item.verification_details.manual_submission.tx_hash.slice(0,14)+"…":item.tx_hash?"Transaction recorded — investigate":"No transaction recorded"}</small><small>{item.verification_details?.manual_submission?.reason?.replace(/_/g," ")||""}</small></span></div>)}
      </AdminTable>
      <AdminTable title="Completed and reviewed purchase history" columns={["Buyer / account","Package","Payment","Verification","Sender wallet / transaction","Order / paid"]} emptyMessage="No completed or reviewed purchase records.">
        {aiCreditOrders.filter(item=>!["pending","incomplete"].includes(item.status)&&matches(item.id,item.user_id,userName(item.user_id),userEmail(item.user_id),item.status,item.payment_amount,item.credits,item.tx_hash,item.sender_address,item.verification_status)).map(item=><div className="admin-row" key={item.id}><span><strong>{userName(item.user_id)}</strong><small>{userEmail(item.user_id)}</small><small>{item.user_id}</small></span><span>{item.credits||"—"} credits<small>Package {money(item.base_amount)} USDT</small></span><span>{money(item.payment_amount,2)} USDT<small className={"admin-status status-"+(item.status||"unknown")}>{item.status||"unknown"}</small></span><span><b className={"admin-status "+(item.verification_status==="verified"?"status-completed":item.verification_status==="legacy_unattributed"?"status-expired":"status-pending")}>{(item.verification_status||"pending").replace(/_/g," ")}</b><small>{item.block_number?"Block "+item.block_number:"No verified block recorded"}</small><small>{item.block_timestamp?new Date(item.block_timestamp).toLocaleString():""}</small></span><span>{item.sender_address?<code className="admin-wallet-address">{item.sender_address}</code>:<small>Sender not recorded</small>}{item.tx_hash?<a href={"https://tronscan.org/#/transaction/"+encodeURIComponent(item.tx_hash)} target="_blank" rel="noreferrer">View transaction ↗<small>{item.tx_hash}</small></a>:<small>Awaiting transaction</small>}</span><span><small>{item.id}</small><small>Created {item.created_at?new Date(item.created_at).toLocaleString():"—"}</small><small>{item.paid_at?"Paid "+new Date(item.paid_at).toLocaleString():"—"}</small></span></div>)}
      </AdminTable>
    </>}
    {tab==="credits"&&<AdminPanel title="AI credit ledger by customer"><p>Credits are grouped by account to keep the dashboard compact. Expand a customer to review the latest individual ledger entries.</p>{(()=>{const filtered=credits.filter(item=>matches(item.id,item.user_id,item.type,item.reference,item.credits,item.amount_usd,userName(item.user_id)));const groups=Object.values(filtered.reduce((acc,item)=>{(acc[item.user_id]||(acc[item.user_id]={user_id:item.user_id,items:[]})).items.push(item);return acc;},{})).sort((x,y)=>y.items.length-x.items.length);return groups.length?groups.map(group=>{const creditTotal=group.items.reduce((sum,x)=>sum+Number(x.credits||0),0),paidTotal=group.items.reduce((sum,x)=>sum+Number(x.amount_usd||0),0);return <details className="admin-referral-tree" key={group.user_id}><summary><span><strong>{userName(group.user_id)}</strong><small>{group.items.length.toLocaleString()} ledger entries · latest {group.items[0]?.created_at?new Date(group.items[0].created_at).toLocaleString():"—"}</small></span><span><strong>{money(creditTotal,2)} credits</strong><small>{money(paidTotal)} USD recorded</small></span></summary><div className="admin-record-details"><div className="admin-table-head" style={{"--admin-columns":5}}>{["Type","Credits","Amount","Reference","Time"].map(x=><span key={x}>{x}</span>)}</div>{group.items.slice(0,20).map(item=><div className="admin-row" key={item.id}><span>{item.type||"—"}<small>{item.id}</small></span><span>{money(item.credits,2)}</span><span>{item.amount_usd==null?"—":"$"+money(item.amount_usd)}</span><span>{item.reference||"—"}</span><span>{item.created_at?new Date(item.created_at).toLocaleString():"—"}</span></div>)}{group.items.length>20&&<small>Showing 20 most recent of {group.items.length} loaded entries for this customer.</small>}</div></details>;}):<div className="admin-empty-row">No AI credit transactions match your search.</div>;})()}</AdminPanel>}
    {tab==="subscriptions"&&<>
      <AdminGrantSubscription users={users} plans={plans} onAction={act}/>
      <div className="admin-kpis"><Kpi label="Plans" value={plans.length}/><Kpi label="Active subscriptions" value={subs.filter(item=>item.status==="active").length}/><Kpi label="Trials" value={subs.filter(item=>item.status==="trialing").length}/></div>
      <AdminTable title="Plans and pricing" columns={["Plan","Pricing","Trial","Status"]} emptyMessage="No plans available.">
        {plans.map(item=><div className="admin-row" key={item.id}><span><strong>{item.name}</strong><small>{item.code} · {item.description||""}</small></span><span>{"Monthly $"+money(item.monthly_price)}<small>{"Quarterly $"+money(item.quarterly_price)+" · Annual $"+money(item.annual_price)}</small></span><span>{item.trial_days} days</span><span><b>{item.active?"Active":"Inactive"}</b><button type="button" className="mini-action" disabled={busy} onClick={()=>void act("update_plan",{id:item.id,patch:{active:!item.active}})}>{item.active?"Deactivate":"Activate"}</button></span></div>)}
      </AdminTable>
      <AdminTable title="Subscriptions" columns={["User","Plan","Status / cycle","Period","Action"]} emptyMessage="No subscriptions found.">
        {subs.filter(item=>matches(item.user_id,item.status,item.billing_cycle,item.payment_reference)).map(item=><div className="admin-row" key={item.id}><span>{userName(item.user_id)}<small>{item.user_id}</small></span><span>{plans.find(plan=>plan.id===item.plan_id)?.name||item.plan_id}</span><span>{item.status}<small>{item.billing_cycle} · {item.auto_renew?"Auto-renew":"No auto-renew"}</small></span><span>{item.starts_at?new Date(item.starts_at).toLocaleDateString():"—"} – {item.ends_at?new Date(item.ends_at).toLocaleDateString():"—"}</span><span>{["active","trialing","past_due"].includes(item.status)&&<button type="button" className="mini-action" disabled={busy} onClick={()=>{if(window.confirm("Cancel this subscription for "+userName(item.user_id)+"?"))void act("cancel_subscription",{subscription_id:item.id});}}>Cancel subscription</button>}</span></div>)}
      </AdminTable>
    </>}

    {tab==="rewards"&&<>
      <div className="admin-kpis"><Kpi label="Reward records" value={rewards.length}/><Kpi label="Referral records" value={referrals.length}/><Kpi label="Referrer accounts" value={new Set(referrals.map(x=>x.referrer_id)).size}/><Kpi label="Reward value issued" value={money(rewards.reduce((sum,item)=>sum+Number(item.reward_amount||0),0))+" USDT"}/></div>
      <AdminTable title="User rewards" columns={["User","Reward","Profit","Withdrawable","Status / expiry"]} emptyMessage="No rewards match your search.">
        {rewards.filter(item=>matches(item.user_id,item.status,item.reward_amount,userName(item.user_id))).map(item=><div className="admin-row" key={item.id}><span>{userName(item.user_id)}<small>{item.user_id}</small></span><span>{money(item.reward_amount)} USDT</span><span>{money(item.profit_earned)} USDT</span><span>{money(item.profit_withdrawable)} USDT</span><span>{item.status||"—"}<small>{item.expires_at?new Date(item.expires_at).toLocaleString():"No expiry recorded"}</small></span></div>)}
      </AdminTable>
      <AdminPanel title="Referral network tree"><p>Each referrer is a parent node. Expand a person to see the users attributed to their referral link, reward status and network contribution.</p>
        {(()=>{const filtered=referrals.filter(item=>matches(item.id,item.referrer_id,item.referred_user_id,item.status,item.reward_amount,userName(item.referrer_id),userName(item.referred_user_id)));const groups=Object.values(filtered.reduce((acc,item)=>{(acc[item.referrer_id]||(acc[item.referrer_id]={referrer_id:item.referrer_id,children:[]})).children.push(item);return acc;},{})).sort((x,y)=>y.children.length-x.children.length);return groups.length?groups.map(group=>{const total=group.children.reduce((sum,x)=>sum+Number(x.reward_amount||0),0),paid=group.children.filter(x=>x.status==="paid"||x.status==="rewarded").length;return <details className="admin-referral-tree" key={group.referrer_id}><summary><span><strong>↳ {userName(group.referrer_id)}</strong><small>{group.children.length} referred users · {paid} rewarded</small></span><span><strong>{money(total)} USDT</strong><small>Referral rewards</small></span></summary><div className="admin-referral-children">{group.children.map(item=><div className="admin-referral-child" key={item.id}><span><strong>{userName(item.referred_user_id)}</strong><small>{item.referred_user_id}</small></span><span>{item.status||"Pending"}<small>{item.created_at?new Date(item.created_at).toLocaleDateString():"—"}</small></span><span><strong>{money(item.reward_amount)} USDT</strong><small>{item.rewarded_at?"Rewarded "+new Date(item.rewarded_at).toLocaleDateString():"Not rewarded"}</small></span></div>)}</div></details>;}):<div className="admin-empty-row">No referrals match your search.</div>;})()}
      </AdminPanel>
    </>}    {tab==="health"&&<>
      <AdminPanel title="Diagnostic events"><p>Use these events to investigate client errors and slow requests. Diagnostic metadata can contain user-provided text; treat it as untrusted log content.</p></AdminPanel>
      <AdminTable title="Recent diagnostics" columns={["Severity","Event / source","Message","Request","Time"]} emptyMessage="No diagnostics match your search.">
        {diagnostics.filter(item=>matches(item.id,item.level,item.source,item.event_name,item.message,item.page_path,item.request_path,item.browser_family)).map(item=><div className="admin-row" key={item.id}><span><b className={"admin-level-"+(item.level||"info")}>{item.level||"info"}</b></span><span>{item.event_name||"—"}<small>{item.source||"—"} · {item.diagnostic_id||"—"}</small></span><span className="admin-wrap-cell">{item.message||"—"}<small>{item.stack||""}</small></span><span>{item.request_path||item.page_path||"—"}<small>{item.http_status?"HTTP "+item.http_status:""}{item.duration_ms?" · "+item.duration_ms+" ms":""}</small></span><span>{item.created_at?new Date(item.created_at).toLocaleString():"—"}<small>{item.browser_family||""}</small></span></div>)}
      </AdminTable>
    </>}

    {tab==="audit"&&<AdminTable title="Administrator audit log · latest actions" columns={["Administrator","Action","Target","Details","Time"]} emptyMessage="No audit entries are available yet.">
      {audit.filter(item=>matches(item.admin_user_id,item.action,item.target_type,item.target_id,JSON.stringify(item.details))).map(item=><div className="admin-row" key={item.id}><span>{userName(item.admin_user_id)}<small>{item.admin_user_id}</small></span><span>{item.action}</span><span>{item.target_type||"—"}<small>{item.target_id||"—"}</small></span><span className="admin-wrap-cell">{JSON.stringify(item.details||{})}</span><span>{item.created_at?new Date(item.created_at).toLocaleString():"—"}</span></div>)}
    </AdminTable>}

    {tab==="settings"&&<AdminSettings settings={data.settings} onSave={act}/>}
    {tab==="administrators"&&<AdminAdministrators users={administrators} allUsers={allUsers.filter(item=>!item.is_deleted)} currentAdminId={data.currentAdminId} busy={busy} onAction={act} userName={userName}/>}
    {busy&&<div className="admin-busy" role="status">Updating platform data…</div>}
    </main></div>
  </div>;
}
function AdminIdentityVerifications({verifications,onAction,busy}){
  const [notes,setNotes]=useState({});
  const rows=verifications||[];
  async function review(row,action){
    const note=String(notes[row.id]||"").trim();
    if((action!=="approve"||row.duplicate_flag)&&note.length<3)return;
    const ok=await onAction("review_identity_verification",{verification_id:row.id,review_action:action,reason:note});
    if(ok)setNotes(current=>({...current,[row.id]:""}));
  }
  return <><AdminPanel title={"Identity verification queue · "+rows.filter(x=>x.status==="pending").length+" pending"}>
    <p>Review the legal name, country, government ID and face scan. Approval is the only action that unlocks withdrawals. Duplicate-ID flags require an explicit review note before approval. Private document links expire after 10 minutes.</p>
  </AdminPanel>
  <AdminTable title="Identity submissions" columns={["Applicant","Government identity","Documents","Status / duplicate screening","Admin review"]} emptyMessage="No identity submissions yet.">
    {rows.map(row=><div className="admin-row" key={row.id}>
      <span><strong>{row.profile?.display_name||row.legal_name||"Applicant"}</strong><small>{row.profile?.email||row.user_id}</small><small>{row.user_id}</small><small>Submitted {row.submitted_at?new Date(row.submitted_at).toLocaleString():"—"}</small></span>
      <span>{row.legal_name}<small>{ONBOARDING_COUNTRIES.find(c=>c.code===row.country_code)?.flag||""} {ONBOARDING_COUNTRIES.find(c=>c.code===row.country_code)?.name||row.country_code}</small><small>{({national_id:"National ID",passport:"Passport",drivers_license:"Driver licence",voters_card:"Voter card",residence_permit:"Residence permit"})[row.id_type]||row.id_type}</small></span>
      <span>{row.id_document_url?<a href={row.id_document_url} target="_blank" rel="noreferrer">Open government ID ↗</a>:<small>Document unavailable</small>}{row.face_scan_url?<a href={row.face_scan_url} target="_blank" rel="noreferrer">Open face scan ↗</a>:<small>Face scan unavailable</small>}</span>
      <span><strong>{row.status}</strong>{row.duplicate_flag?<small style={{color:"#f0b35b"}}>Possible duplicate government ID {row.duplicate_reviewed?"· reviewed":"· review required"}</small>:<small>No matching ID number found</small>}{row.review_notes&&<small>Note: {row.review_notes}</small>}</span>
      <span className="admin-withdrawal-actions">{["pending","rejected","resubmission_required"].includes(row.status)?<><input value={notes[row.id]||""} onChange={e=>setNotes(current=>({...current,[row.id]:e.target.value}))} placeholder={row.duplicate_flag?"Required duplicate review note":"Review note"}/><button className="mini-action" type="button" disabled={busy||(row.duplicate_flag&&String(notes[row.id]||"").trim().length<3)} onClick={()=>review(row,"approve")}>Approve identity</button><button className="mini-action" type="button" disabled={busy||String(notes[row.id]||"").trim().length<3} onClick={()=>review(row,"resubmission_required")}>Request clearer details</button><button className="mini-action danger-action" type="button" disabled={busy||String(notes[row.id]||"").trim().length<3} onClick={()=>review(row,"reject")}>Reject</button></>:<small>Reviewed {row.reviewed_at?new Date(row.reviewed_at).toLocaleString():""}</small>}</span>
    </div>)}
  </AdminTable>
  <p className="admin-note">Duplicate screening compares a one-way hash of the government ID number; the raw number is not stored. Face scans are reviewed manually, without automated facial recognition.</p>
  </>;
}

function AdminUserEditor({user,onClose,onSave}){const [name,setName]=useState(user.display_name||""),[username,setUsername]=useState(user.username||""),[email,setEmail]=useState(user.email||""),[busy,setBusy]=useState(false);async function submit(e){e.preventDefault();setBusy(true);try{await onSave({display_name:name.trim(),username:username.trim().replace(/^@/,""),email:email.trim().toLowerCase()});}finally{setBusy(false);}}return <div className="auth-modal-backdrop admin-modal-backdrop" onClick={onClose}><section className="auth-modal admin-editor-modal" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><button className="auth-close" type="button" onClick={onClose} aria-label="Close">×</button><div className="eyebrow">CUSTOMER ACCOUNT</div><h2>Edit user</h2><p>Identity changes are separate from audited wallet adjustments.</p><form className="auth-email-form" onSubmit={submit}><label>Display name<input value={name} onChange={e=>setName(e.target.value)} maxLength={100} required/></label><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} pattern="[A-Za-z0-9_]{3,24}" minLength={3} maxLength={24} required/></label><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><div className="admin-modal-actions"><button className="secondary" type="button" onClick={onClose}>Cancel</button><button className="mini-action" type="submit" disabled={busy}>{busy?"Saving…":"Save changes"}</button></div></form></section></div>;}
function AdminAdministrators({users,allUsers,currentAdminId,busy,onAction,userName}){const [target,setTarget]=useState(""),[filter,setFilter]=useState("");const candidates=allUsers.filter(x=>!x.is_admin&&!x.is_deleted&&[x.display_name,x.username,x.email,x.id].some(v=>String(v||"").toLowerCase().includes(filter.toLowerCase())));async function add(){const chosen=allUsers.find(x=>x.id===target);if(!chosen||!window.confirm("Grant administrator access to "+(chosen.display_name||chosen.email||chosen.id)+"?"))return;if(await onAction("set_admin_access",{user_id:target,is_admin:true})){setTarget("");setFilter("");}}return <div className="admin-stack"><section className="admin-card"><div className="admin-section-title"><div><h2>Administrator access</h2><p>Customer management cannot grant admin privileges.</p></div><span className="admin-table-count">{users.length} admins</span></div></section><section className="admin-card"><div className="admin-section-title"><div><h2>Add an administrator</h2><p>Select an existing active customer account.</p></div></div><div className="admin-admin-add"><input value={filter} onChange={e=>{setFilter(e.target.value);setTarget("");}} placeholder="Find by name, username or email"/><select value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose account…</option>{candidates.map(x=><option key={x.id} value={x.id}>{x.display_name||x.username||x.email} · {x.email||x.id.slice(0,8)}</option>)}</select><button className="mini-action" type="button" disabled={busy||!target} onClick={add}>Grant admin access</button></div></section><AdminTable title="Current administrators" columns={["Administrator","Email / username","Joined","Access"]} emptyMessage="No active administrators.">{users.map(x=><div className="admin-row" key={x.id}><span><strong>{x.display_name||x.username||"Administrator"}</strong><small>{x.id}</small></span><span>{x.email||"—"}<small>{x.username?"@"+x.username:"Username not set"}</small></span><span>{x.created_at?new Date(x.created_at).toLocaleDateString():"—"}</span><span>{x.id===currentAdminId?<b>Current session</b>:<button type="button" className="mini-action danger-action" disabled={busy} onClick={()=>{if(window.confirm("Remove administrator access from "+userName(x.id)+"?"))void onAction("set_admin_access",{user_id:x.id,is_admin:false});}}>Remove admin</button>}</span></div>)}</AdminTable></div>;}

function AdminGrantSubscription({users,plans,onAction}){
  const [userId,setUserId]=useState("");
  const [planId,setPlanId]=useState(plans.find(item=>item.active)?.id||plans[0]?.id||"");
  const [cycle,setCycle]=useState("monthly");
  const [days,setDays]=useState("30");
  async function submit(event){
    event.preventDefault();
    const parsedDays=Number(days);
    if(!userId||!planId||!Number.isInteger(parsedDays)||parsedDays<1||parsedDays>365)return;
    if(!window.confirm("Grant this subscription for "+parsedDays+" days to the selected user?"))return;
    const ok=await onAction("grant_subscription",{user_id:userId,plan_id:planId,billing_cycle:cycle,days:parsedDays});
    if(ok)setUserId("");
  }
  return <section className="admin-card"><div className="admin-section-title"><h2>Grant subscription access</h2></div><form className="admin-grant-form" onSubmit={submit}>
    <label>User<select value={userId} onChange={event=>setUserId(event.target.value)} required><option value="">Choose user…</option>{users.map(item=><option key={item.id} value={item.id}>{item.display_name||item.telegram_username||item.email||item.id.slice(0,8)}</option>)}</select></label>
    <label>Plan<select value={planId} onChange={event=>setPlanId(event.target.value)} required>{plans.map(item=><option key={item.id} value={item.id}>{item.name}{item.active?"":" (inactive)"}</option>)}</select></label>
    <label>Billing cycle<select value={cycle} onChange={event=>setCycle(event.target.value)}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>
    <label>Access days<input type="number" min="1" max="365" value={days} onChange={event=>setDays(event.target.value)} required/></label>
    <button type="submit" className="mini-action">Grant access</button>
  </form></section>;
}

function Kpi({label,value}){return <div className="admin-kpi"><small>{label}</small><strong>{value}</strong></div>}
function AdminPanel({title,children}){return <section className="admin-card"><div className="admin-section-title"><h2>{title}</h2></div>{children}</section>}
function AdminTable({title,columns,children,emptyMessage="No records to display."}){
  const [page,setPage]=useState(0);
  const rows=(Array.isArray(children)?children.flat(Infinity):[children]).filter(child=>child!==null&&child!==false&&child!==undefined);
  const pageSize=20;
  const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));
  const currentPage=Math.min(page,pageCount-1);
  const visibleRows=rows.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  return <section className="admin-card admin-table-card">
    <div className="admin-section-title admin-table-title">
      <div><h2>{title}</h2><p>{rows.length ? "Operational records · latest first" : "Nothing requires attention here right now."}</p></div>
      <span className="admin-table-count"><i />{rows.length.toLocaleString()} {rows.length===1?"record":"records"}</span>
    </div>
    <div className="admin-table-scroll" style={{"--admin-columns":columns.length}}>
      <div className="admin-table-head">{columns.map(x=><span key={x}>{x}</span>)}</div>
      {rows.length?visibleRows:<div className="admin-empty-row"><span className="admin-empty-icon">✓</span><strong>{emptyMessage}</strong><small>New records will appear here when available.</small></div>}
    </div>
    {rows.length>pageSize&&<div className="admin-table-pagination">
      <span>Showing {currentPage*pageSize+1}–{Math.min((currentPage+1)*pageSize,rows.length)} of {rows.length.toLocaleString()} loaded records</span>
      <div><button type="button" disabled={currentPage===0} onClick={()=>setPage(Math.max(0,currentPage-1))} aria-label="Previous page">← Previous</button><span>Page {currentPage+1} of {pageCount}</span><button type="button" disabled={currentPage>=pageCount-1} onClick={()=>setPage(Math.min(pageCount-1,currentPage+1))} aria-label="Next page">Next →</button></div>
    </div>}
  </section>;
}
function AdminWithdrawals({transactions,onAction,userName=(id)=>String(id||"").slice(0,8)+"…"}){
  const [notes,setNotes]=useState({});
  const [hashes,setHashes]=useState({});
  const withdrawals=(transactions||[]).filter(x=>x.type==="withdrawal").sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  async function review(item,action){
    const note=(notes[item.id]||"").trim();
    if(action==="reject"&&note.length<3)return;
    if(action==="complete"&&note.length<3)return;
    const defaultNote=action==="approve"?"Approved for manual payout":"";
    const ok=await onAction("review_withdrawal",{
      transaction_id:item.id,
      review_action:action,
      reason:note||defaultNote,
      tx_hash:action==="complete"?(hashes[item.id]||"").trim():null
    });
    if(ok){setNotes(current=>({...current,[item.id]:""}));if(action==="complete")setHashes(current=>({...current,[item.id]:""}));}
  }
  return <><AdminPanel title="Withdrawal review"><p>Approval moves a request into processing but does not send funds. Send the payout manually through the appropriate wallet/provider, verify the transfer on the correct network, then record its transaction hash to complete the request. Rejecting a pending request returns its locked amount to the user's available balance. A request already processing cannot be rejected here.</p></AdminPanel>
    <AdminTable title="Withdrawal requests" columns={["User / destination","Amount","Status","Review"]}>{withdrawals.map(item=>{
      const meta=item.metadata||{},note=notes[item.id]||"",hash=hashes[item.id]||"";
      return <div className="admin-row" key={item.id}>
        <span>{userName(item.user_id)}<small>{item.user_id}</small><small>{meta.asset||"USDT"} · {meta.network||"—"}</small><small>{meta.destination_address||"Destination unavailable"}</small></span>
        <span>{Number(item.amount).toFixed(4)} {meta.asset||"USDT"}</span>
        <span>{item.status==="failed"?"Transaction failed":item.status}<small>{item.tx_hash?"TX: "+item.tx_hash.slice(0,14)+"…":""}</small></span>
        <span className="admin-withdrawal-actions">
          {item.status==="pending"&&<><input value={note} onChange={e=>setNotes(current=>({...current,[item.id]:e.target.value}))} placeholder="Review note / rejection reason"/><button className="mini-action" type="button" onClick={()=>review(item,"approve")}>Approve for payout</button><button className="mini-action" type="button" disabled={note.trim().length<3} onClick={()=>review(item,"reject")}>Reject & refund</button></>}
          {item.status==="processing"&&<><input value={hash} onChange={e=>setHashes(current=>({...current,[item.id]:e.target.value}))} placeholder="External payout transaction hash"/><input value={note} onChange={e=>setNotes(current=>({...current,[item.id]:e.target.value}))} placeholder="Payout verification note"/><button className="mini-action" type="button" disabled={hash.trim().length<8||note.trim().length<3} onClick={()=>review(item,"complete")}>Confirm payout sent</button></>}
          {item.status==="completed"&&<small>Completed — payout hash recorded</small>}
          {item.status==="failed"&&<small>Failed — funds returned</small>}
          {!["pending","processing","completed","failed"].includes(item.status)&&<small>Manual reconciliation required</small>}
        </span>
      </div>;
    })}{withdrawals.length===0&&<div className="empty-state">No withdrawal requests found.</div>}</AdminTable></>;
}
function AdminWallets({wallets,users,onAction,search="",lookupUsers,busy=false}){
 const [userId,setUserId]=useState(users[0]?.id||""),[amount,setAmount]=useState(""),[direction,setDirection]=useState("credit"),[reason,setReason]=useState("Admin wallet adjustment"),[requestId,setRequestId]=useState(""),[userSearch,setUserSearch]=useState(""),[remoteAccounts,setRemoteAccounts]=useState({query:"",users:[],wallets:[]});
 useEffect(()=>{const query=userSearch.trim();if(query.length<2){setRemoteAccounts({query:"",users:[],wallets:[]});return;}let cancelled=false;const timer=window.setTimeout(async()=>{try{const result=await lookupUsers(query);if(!cancelled)setRemoteAccounts({query,users:result.users||[],wallets:result.wallets||[]});}catch{if(!cancelled)setRemoteAccounts({query,users:[],wallets:[]});}},250);return()=>{cancelled=true;window.clearTimeout(timer);};},[userSearch,lookupUsers]);
 const remoteAccountMatches=userSearch.trim().length>=2&&remoteAccounts.query===userSearch.trim();
 const accountPool=remoteAccountMatches?remoteAccounts.users:users;
 const eligibleUsers=accountPool.filter(u=>!u.is_deleted&&!u.is_admin&&[u.id,u.username,u.display_name,u.email].some(v=>String(v||"").toLowerCase().includes(userSearch.toLowerCase())));
 const visibleWallets=(remoteAccountMatches?remoteAccounts.wallets:wallets).filter(w=>(!remoteAccountMatches||!remoteAccounts.users.some(u=>u.id===w.user_id&&u.is_admin))&&(w.asset==="USDT"||Number(w.available_balance||0)!==0||Number(w.locked_balance||0)!==0));
 async function submit(e){e.preventDefault();const value=Number(amount);if(!userId||!Number.isFinite(value)||value<=0||reason.trim().length<3)return;const request=requestId||crypto.randomUUID();setRequestId(request);const ok=await onAction("adjust_wallet",{user_id:userId,asset:"USDT",network:"TRC-20",amount:value,direction,reason:reason.trim(),request_id:request});if(ok){setAmount("");setRequestId("");}}
 return <div className="admin-stack"><section className="admin-card"><div className="admin-section-title"><div><h2>Wallet controls</h2><p>Choose a customer, then credit or debit their available USDT balance. Every adjustment is processed server-side and recorded in the wallet ledger. Test/admin accounts cannot withdraw.</p></div></div><form id="admin-wallet-adjust-form" className="admin-wallet-adjust-form" onSubmit={submit}><label>Find customer<input value={userSearch} onChange={e=>{setUserSearch(e.target.value);setUserId("");setRequestId("");}} placeholder="Search name, username, email or ID"/></label><label>Customer account<select value={userId} onChange={e=>{setUserId(e.target.value);setRequestId("");}} required><option value="">Select customer…</option>{eligibleUsers.map(u=><option key={u.id} value={u.id}>{u.display_name||u.username||u.email||u.id.slice(0,8)}{u.email?" · "+u.email:""}</option>)}</select></label><label>Amount (USDT)<input inputMode="decimal" type="number" min="0.000001" step="0.000001" value={amount} onChange={e=>{setAmount(e.target.value);setRequestId("");}} placeholder="0.00" required/></label><label>Adjustment<select value={direction} onChange={e=>{setDirection(e.target.value);setRequestId("");}}><option value="credit">Add to available balance</option><option value="debit">Subtract from available balance</option></select></label><label>Reason for audit trail<input value={reason} onChange={e=>{setReason(e.target.value);setRequestId("");}} minLength={3} maxLength={300} required placeholder="Reason for this adjustment"/></label><button className="mini-action" type="submit" disabled={!userId||Number(amount)<=0||reason.trim().length<3}>Apply audited adjustment</button></form></section><AdminTable title="Customer wallet balances" columns={["Customer","Asset / network","Available","Locked","Last updated","Manage"]} emptyMessage="No wallet balances match your search.">{visibleWallets.filter(w=>{const u=users.find(x=>x.id===w.user_id);return !search||[w.user_id,w.asset,w.network,u?.display_name,u?.username,u?.email].some(v=>String(v||"").toLowerCase().includes(search.toLowerCase()));}).map(w=>{const u=users.find(x=>x.id===w.user_id);return <div className="admin-row" key={w.id}><span><strong>{u?.display_name||u?.username||"Account"}{u?.is_admin?" · ADMIN/TEST":""}</strong><small>{u?.email||w.user_id}</small></span><span>{w.asset}<small>{w.network}</small></span><span>{Number(w.available_balance||0).toFixed(4)}</span><span>{Number(w.locked_balance||0).toFixed(4)}</span><span>{w.updated_at?new Date(w.updated_at).toLocaleString():"—"}</span><span><button type="button" className="mini-action" disabled={busy||u?.is_admin} onClick={()=>{setUserId(w.user_id);setUserSearch(u?.display_name||u?.username||u?.email||w.user_id);setAmount("");setDirection("credit");setRequestId("");document.getElementById("admin-wallet-adjust-form")?.scrollIntoView({behavior:"smooth",block:"center"});}}>Manage balance</button></span></div>;})}</AdminTable><AdminPanel title="Wallet asset policy"><p>USDT on TRC-20 is the default customer ledger wallet. Other asset balances are shown only when a balance exists; a ledger wallet is not proof that a customer has connected or supplied an external wallet address. Do not invent or assign a personal TON address.</p></AdminPanel></div>;
}
function AdminSettings({settings,onSave}) {
 const [values,setValues]=useState(Object.fromEntries((settings||[]).map(x=>[x.key,JSON.stringify(x.value,null,2)]))),[errors,setErrors]=useState({});
 const friendly={"deposit_addresses":["Deposit destinations","Supported asset and network addresses shown to customers."],"maintenance_mode":["Maintenance mode","Temporarily restrict access during planned service work."],"trading_enabled":["Trading access","Controls whether supported trading actions are available."],"ai_trading_enabled":["AI trading","Controls the AI trading feature at platform level."],"withdrawals_enabled":["Withdrawals","Controls whether new withdrawal requests may be submitted."],"ai_credit_packages":["AI credit packages","Available packages and their pricing configuration."]};
 const ordered=(settings||[]).slice().sort((x,y)=>{const rank=k=>k==="deposit_addresses"?0:k.includes("maintenance")?1:k.includes("trading")?2:k.includes("withdraw")?3:5;return rank(x.key)-rank(y.key)||x.key.localeCompare(y.key);});
 return <div className="admin-settings-workspace"><section className="admin-settings-hero"><span className="eyebrow">PLATFORM CONFIGURATION</span><h2>Application controls</h2><p>Review settings by purpose. Changes are saved individually and recorded in the administrator audit log.</p><span className="admin-settings-count">{ordered.length} configurable settings</span></section><div className="admin-settings-grid">{ordered.map(item=>{const key=item.key,value=values[key]??JSON.stringify(item.value,null,2),meta=friendly[key]||[key.replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase()),"Advanced platform setting. Review the value carefully before saving."];const parsed=(()=>{try{return JSON.parse(value)}catch{return undefined}})();return <section className="admin-setting-card" key={key}><div className="admin-setting-card-head"><span className="admin-setting-icon">⚙</span><div><h3>{meta[0]}</h3><p>{meta[1]}</p></div></div><div className="admin-setting-key">SETTING KEY · {key}</div>{typeof item.value==="boolean"?<label className="admin-setting-toggle"><span><strong>{parsed===true?"Enabled":"Disabled"}</strong><small>Switch this platform control on or off.</small></span><input type="checkbox" checked={parsed===true} onChange={e=>setValues(v=>({...v,[key]:JSON.stringify(e.target.checked)}))}/></label>:<textarea className="admin-setting-editor" rows={Math.min(8,Math.max(3,value.split("\n").length))} value={value} onChange={e=>{setValues(v=>({...v,[key]:e.target.value}));setErrors(v=>({...v,[key]:""}));}} spellCheck={false}/>}{errors[key]&&<div className="error-banner">{errors[key]}</div>}<div className="admin-setting-card-foot"><span>{parsed===undefined?"Invalid JSON":"Ready to save"}</span><button className="mini-action" type="button" disabled={parsed===undefined} onClick={async()=>{const ok=await onSave("update_setting",{key,value:parsed});if(ok)setErrors(v=>({...v,[key]:""}));else setErrors(v=>({...v,[key]:"Save failed. Review the admin error above and try again."}));}}>Save setting</button></div></section>;})}</div></div>;
}

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
  const normalized=String(type||"transaction");
  if(normalized==="withdrawal_refund") return "Withdrawal refund";
  return normalized.replace(/_/g," ").replace(/\\b\\w/g,(m)=>m.toUpperCase());
}
function ActivityRows({ account, limit=8 }) {
  const items=[...(account.transactions||[])].slice(0,limit), trades=account.trades||[];
  if(!items.length) return <div className="empty-state"><strong>No wallet activity yet</strong><p>Your deposits, withdrawals, swaps and trade activity will appear here.</p></div>;
  return <div className="activity-ledger-list">{items.map((item)=>{
    const amount=Number(item.amount||0), metadata=item.metadata||{}, tradeId=metadata.trade_id||"";
    const relatedTrade=tradeId?trades.find(t=>String(t.id)===String(tradeId)):null;
    const isTrade=["trade_profit","trade_loss","trade_lock"].includes(item.type)||Boolean(tradeId&&metadata.market_symbol);
    const isSwap=String(item.type||"").toLowerCase().includes("swap")||Boolean(metadata.from_asset&&metadata.to_asset);
    return <ActivityLedgerItem key={item.id} item={item} amount={amount} relatedTrade={relatedTrade} isTrade={isTrade} isSwap={isSwap}/>;
  })}</div>;
}
function ActivityLedgerItem({item,amount,relatedTrade,isTrade,isSwap}) {
  const [expanded,setExpanded]=useState(false), metadata=item.metadata||{};
  const tradeSymbol=metadata.market_symbol||relatedTrade?.metadata?.market_symbol||relatedTrade?.asset||"AI TRADE";
  const direction=metadata.direction||relatedTrade?.direction, leverage=Number(metadata.leverage||relatedTrade?.leverage||1);
  const stake=Number(metadata.stake||relatedTrade?.stake||amount||0);
  const pnl=metadata.pnl!==undefined?Number(metadata.pnl):relatedTrade&&relatedTrade.status!=="active"?Number(relatedTrade.result_amount||0)-Number(relatedTrade.stake||0):null;
  const tradeIsLoss=item.type==="trade_loss"||(pnl!==null&&pnl<0);
  const isFailedWithdrawal=item.type==="withdrawal"&&item.status==="failed";
  const title=isSwap?"Portfolio swap":isTrade?(item.type==="trade_lock"?"AI trade opened":tradeIsLoss?"Trade loss":"Trade profit"):isFailedWithdrawal?"Withdrawal failed":transactionLabel(item.type);
  const primary=isTrade&&item.type!=="trade_lock"&&pnl!==null?signedMoney(pnl):(item.direction==="credit"?"+":"−")+money(amount);
  const date=item.created_at?new Date(item.created_at):null;
  const detail=date&&!Number.isNaN(date.getTime())?date.toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"Recent";
  const hasDetails=isTrade||isSwap||Boolean(metadata.network||metadata.address||metadata.reason||metadata.review_reason||metadata.destination_address||item.tx_hash||String(item.type||"").toLowerCase()==="withdrawal");
  return <article className={isTrade?"activity-ledger-row trade-outcome-row":"activity-ledger-row"}>
    <button type="button" className="activity-ledger-summary" onClick={()=>hasDetails&&setExpanded(v=>!v)}>
      <div className={isTrade?(tradeIsLoss?"activity-ledger-icon trade-loss":"activity-ledger-icon trade-win"):isSwap?"activity-ledger-icon swap":"activity-ledger-icon "+(item.direction==="credit"?"credit":"debit")}>{isTrade?(tradeIsLoss?"−":"↗"):isSwap?"⇄":(item.direction==="credit"?"↑":"↓")}</div>
      <div className="activity-ledger-main"><strong>{title}</strong><small>{isTrade?tradeSymbol+" · "+(direction==="up"?"LONG":direction==="down"?"SHORT":"AI TRADE"):isSwap?(metadata.from_asset||"ASSET")+" → "+(metadata.to_asset||"ASSET"):transactionLabel(item.type)}</small></div>
      <div className="activity-ledger-meta"><span className={isFailedWithdrawal?"red":""}>{isFailedWithdrawal?"Transaction failed":item.status||"completed"}</span><small>{detail}</small></div>
      <div className="activity-ledger-value"><strong className={isTrade?(tradeIsLoss?"red":"green"):(item.direction==="credit"?"green":"red")}>{primary}</strong><small>{isTrade?(item.type==="trade_lock"?"CAPITAL LOCKED":tradeIsLoss?"LOSS":"PROFIT"):isSwap?"SWAP":isFailedWithdrawal?"TRANSACTION FAILED":item.direction==="credit"?"CREDIT":"DEBIT"}{hasDetails?" · "+(expanded?"HIDE":"DETAILS"):""}</small></div>
    </button>
    {expanded&&<div className="activity-ledger-breakdown">
      {isTrade&&<><div className="ledger-breakdown-hero"><span className={item.type==="trade_lock"?"neutral":tradeIsLoss?"red":"green"}>{item.type==="trade_lock"?"CAPITAL USED":tradeIsLoss?"LOSS":"PROFIT"}</span><strong className={item.type==="trade_lock"?"neutral":tradeIsLoss?"red":"green"}>{item.type==="trade_lock"?"$ "+money(stake):signedMoney(pnl||0)}</strong></div><div><small>MARKET</small><strong>{tradeSymbol}</strong></div><div><small>DIRECTION</small><strong className={direction==="up"?"green":"red"}>{direction==="up"?"↗ LONG":direction==="down"?"↘ SHORT":"—"}</strong></div><div><small>CAPITAL</small><strong>$ {money(stake)} USDT</strong></div><div><small>POSITION VALUE</small><strong>$ {money(stake*leverage)} USDT</strong></div><div><small>LEVERAGE</small><strong>{leverage.toFixed(0)}×</strong></div><div><small>ENTRY</small><strong>{metadata.entry_price||relatedTrade?.entry_price?Number(metadata.entry_price||relatedTrade?.entry_price).toLocaleString(undefined,{maximumFractionDigits:8}):"—"}</strong></div><div><small>EXIT</small><strong>{metadata.exit_price||relatedTrade?.exit_price?Number(metadata.exit_price||relatedTrade?.exit_price).toLocaleString(undefined,{maximumFractionDigits:8}):"—"}</strong></div><div><small>{item.type==="trade_lock"?"STATUS":"RESULT"}</small><strong className={item.type==="trade_lock"?"neutral":tradeIsLoss?"red":"green"}>{item.type==="trade_lock"?"Position active":signedMoney(pnl||0)}</strong></div><div><small>EXIT REASON</small><strong>{metadata.exit_reason?String(metadata.exit_reason).replace(/_/g," "):relatedTrade?.exit_reason?String(relatedTrade.exit_reason).replace(/_/g," "):item.type==="trade_lock"?"Position active":"Trade settled"}</strong></div></>}
      {isSwap&&<><div className="ledger-breakdown-hero"><span>SWAP</span><strong>{metadata.from_asset||"ASSET"} → {metadata.to_asset||"ASSET"}</strong></div><div><small>YOU SENT</small><strong>{metadata.from_amount?money(metadata.from_amount):money(amount)} {metadata.from_asset||""}</strong></div><div><small>YOU RECEIVED</small><strong>{metadata.to_amount?money(metadata.to_amount):"—"} {metadata.to_asset||""}</strong></div><div><small>RATE</small><strong>{metadata.rate?Number(metadata.rate).toLocaleString(undefined,{maximumFractionDigits:8}):"Market rate"}</strong></div></>}
      {!isTrade&&!isSwap&&<><div><small>TYPE</small><strong>{transactionLabel(item.type)}</strong></div><div><small>STATUS</small><strong className={isFailedWithdrawal?"red":""}>{isFailedWithdrawal?"Transaction failed":item.status||"completed"}</strong></div><div><small>AMOUNT</small><strong>{item.direction==="credit"?"+":"−"}{money(amount)}</strong></div>{metadata.network&&<div><small>NETWORK</small><strong>{metadata.network}</strong></div>}{(metadata.destination_address||metadata.address)&&<div><small>DESTINATION</small><strong>{String(metadata.destination_address||metadata.address)}</strong></div>}{item.tx_hash&&<div><small>TRANSACTION HASH</small><strong>{String(item.tx_hash)}</strong></div>}{metadata.review_reason&&<div><small>{item.status==="failed"||metadata.review_action==="reject"?"REASON FOR FAILURE":"ADMIN REVIEW NOTE"}</small><strong>{String(metadata.review_reason)}</strong></div>}</>}
    </div>}
  </article>;
}
function TradeHistoryCard({ trade:t }) {
  const [expanded,setExpanded]=useState(false), pnl=t.status==="active"?Number(t.unrealized_pnl||0):Number(t.result_amount||0)-Number(t.stake||0), returned=t.status==="active"?null:Number(t.result_amount||0);
  const symbol=t.metadata?.market_symbol||t.asset, leverage=Number(t.leverage||1);
  return <article className="trade-history-card"><button type="button" className="trade-history-summary" onClick={()=>setExpanded(v=>!v)}><div className="trade-history-identity"><PairIcon symbol={symbol}/><div><strong>{symbol}</strong><small className={t.direction==="up"?"green":"red"}>{t.direction==="up"?"↗ LONG":"↘ SHORT"} · {new Date(t.opened_at).toLocaleDateString()}</small></div></div><div className="trade-history-result"><span className={t.status==="won"?"trade-status win":t.status==="lost"?"trade-status loss":"trade-status live"}>{t.status==="won"?"WON":t.status==="lost"?"LOSS":"ACTIVE"}</span><strong className={pnl>=0?"green":"red"}>{signedMoney(pnl)}</strong><small>{t.status==="active"?"LIVE P&L":"NET RESULT"} · {expanded?"Hide":"Details"}</small></div></button>
    {expanded&&<div className="trade-history-breakdown"><div className="ledger-breakdown-hero"><span className={pnl>=0?"green":"red"}>{pnl>=0?"PROFIT":"LOSS"}</span><strong className={pnl>=0?"green":"red"}>{signedMoney(pnl)}</strong></div><div><small>MARKET</small><strong>{symbol}</strong></div><div><small>DIRECTION</small><strong className={t.direction==="up"?"green":"red"}>{t.direction==="up"?"↗ LONG":"↘ SHORT"}</strong></div><div><small>CAPITAL USED</small><strong>$ {money(t.stake)} USDT</strong></div><div><small>POSITION VALUE</small><strong>$ {money(Number(t.stake||0)*leverage)} USDT</strong></div><div><small>ENTRY</small><strong>{Number(t.entry_price||0).toLocaleString(undefined,{maximumFractionDigits:8})}</strong></div><div><small>EXIT</small><strong>{t.exit_price==null?"—":Number(t.exit_price).toLocaleString(undefined,{maximumFractionDigits:8})}</strong></div><div><small>LEVERAGE</small><strong>{leverage.toFixed(0)}×</strong></div><div><small>EXIT REASON</small><strong>{t.exit_reason?String(t.exit_reason).replace(/_/g," "):"Position active"}</strong></div>{returned!==null&&<div><small>CAPITAL AFTER TRADE</small><strong>$ {money(returned)}</strong></div>}</div>}
  </article>;
}
function ActivityDetailPage({ account, type, onBack }) {
  const isTrades=type==="trades", items=isTrades?(account.trades||[]):(account.transactions||[]);
  return <div className="activity-page activity-detail-page"><button type="button" className="activity-back-button" onClick={()=>onBack()}>← Back to Activity</button><section className="intro activity-intro"><div className="activity-intro-copy"><small>{isTrades?"TRADE HISTORY":"WALLET LEDGER"}</small><h1>{isTrades?"Recent trades.":"Recent transactions."}</h1><p>{isTrades?"Review every trade, including active positions and completed results.":"Review every wallet movement, deposits, withdrawals, swaps and trade activity."}</p></div><div className="activity-intro-watermark" aria-hidden="true" /></section><section className="activity-section"><div className="section-heading"><div><small>{isTrades?"ALL TRADES":"ALL TRANSACTIONS"}</small><h2>{isTrades?"Trade history":"Transaction history"}</h2></div><span className="activity-section-count">{items.length}</span></div>{isTrades?(items.length?<div className="trade-history-list">{items.map(t=><TradeHistoryCard key={t.id} trade={t}/>)}</div>:<div className="empty-state"><strong>No trades yet</strong><p>Your completed and active trades will appear here.</p></div>):<ActivityRows account={account}/>}</section></div>;
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

const AI_CREDIT_PLANS = [{credits:20,price:10,bonus:0},{credits:45,price:15,bonus:0},{credits:80,price:25,bonus:0},{credits:140,price:40,bonus:0},{credits:230,price:60,bonus:0},{credits:320,price:80,bonus:0},{credits:420,price:100,bonus:0},{credits:550,price:125,bonus:0},{credits:700,price:150,bonus:0}];

function AICreditsPage({ profile, onBack, refreshAccount }) {
  const [busyPlan,setBusyPlan]=useState(0),[notice,setNotice]=useState(""),[paymentOrder,setPaymentOrder]=useState(null),[paymentAddress,setPaymentAddress]=useState(""),[paymentOpen,setPaymentOpen]=useState(false),[paymentHash,setPaymentHash]=useState(""),[paymentChecking,setPaymentChecking]=useState(false),[paymentMatchIssue,setPaymentMatchIssue]=useState(""),[paymentClockNow,setPaymentClockNow]=useState(Date.now());
  const paymentCheckLock=useRef(false);
  const balance=Number(profile?.ai_credits||0);
  useEffect(()=>{let cancelled=false;async function restorePendingPayment(){if(!supabase)return;try{const [{data:history,error:historyError},{data:walletData,error:walletError}]=await Promise.all([supabase.functions.invoke("deposit-requests",{body:{action:"list"}}),supabase.functions.invoke("wallet-info")]);if(cancelled||historyError||walletError)return;const pending=(history?.requests||[]).find(item=>item.purpose==="ai_credits"&&["pending","incomplete"].includes(item.status));if(pending){setPaymentAddress(walletData?.deposit_addresses?.USDT?.address||"");setPaymentOrder({...pending,order_id:pending.id});setPaymentOpen(true);}}catch{}}restorePendingPayment();return()=>{cancelled=true}},[]);
  async function buy(plan){
    if(!supabase||busyPlan)return;
    setBusyPlan(plan.credits);setNotice("");
    try{
      const {data:walletData,error:walletError}=await supabase.functions.invoke("wallet-info");
      if(walletError||walletData?.error)throw new Error(walletData?.error||walletError?.message||"Could not load the USDT payment wallet.");
      const address=walletData?.deposit_addresses?.USDT?.address;
      if(!address)throw new Error("The USDT payment wallet is temporarily unavailable.");
      const {data,error}=await supabase.functions.invoke("deposit-requests",{body:{action:"create",purpose:"ai_credits",credits:plan.credits}});
      if(error||data?.error)throw new Error(data?.error||error?.message||"Could not create your payment request.");
      setPaymentAddress(address);setPaymentOrder(data);setPaymentHash("");setPaymentMatchIssue("");setPaymentClockNow(Date.now());setPaymentOpen(true);
    }catch(error){setNotice(error.message||"Could not create your payment request.");}
    finally{setBusyPlan(0);}
  }
  const checkPayment=useCallback(async({silent=false,txHash=""}={})=>{
    const order=paymentOrder;if(!order?.order_id||paymentCheckLock.current)return null;
    paymentCheckLock.current=true;setPaymentChecking(true);if(!silent)setNotice("");
    try{
      const {data,error}=await supabase.functions.invoke("deposit-requests",{body:{action:txHash?"submit_hash":"confirm",order_id:order.order_id,...(txHash?{tx_hash:txHash}:{}),...(!txHash&&!silent?{manual_check:true}:{})}});
      if(data?.ok){
        setPaymentOrder(null);setPaymentOpen(false);setPaymentHash("");setPaymentMatchIssue("");
        setNotice(String(Number(data.credits||order.credits))+" AI credits added successfully. Your purchase is complete.");
        window.dispatchEvent(new CustomEvent("flexar-ai-credits-updated"));await refreshAccount();return data;
      }
      if(data?.needs_review){setPaymentMatchIssue("needs_review");if(!silent)setNotice(data.message||"Your transfer needs review. No credits have been added.");return data;}
      if(data?.needs_hash||data?.status==="ambiguous"){setPaymentMatchIssue("ambiguous");if(!silent)setNotice(data.message||"More than one transfer may match. Submit your transaction hash after the payment window.");return data;}
      if(!silent)setNotice(data?.message||data?.error||error?.message||"Payment has not been detected yet. Flexar will keep checking automatically.");return data;
    }catch(error){if(!silent)setNotice(error.message||"Could not confirm payment.");return null;}
    finally{paymentCheckLock.current=false;setPaymentChecking(false);}
  },[paymentOrder,refreshAccount]);
  async function confirmPayment(){return checkPayment({silent:false});}
  async function submitPaymentHash(e){e.preventDefault();const hash=paymentHash.trim().replace(/^0x/i,"");if(!/^[a-fA-F0-9]{64}$/.test(hash)){setNotice("Enter the transaction hash from your wallet or exchange.");return;}await checkPayment({silent:false,txHash:hash});}
  useEffect(()=>{if(!paymentOrder?.order_id)return;setPaymentClockNow(Date.now());const timer=window.setInterval(()=>{setPaymentClockNow(Date.now());if(!paymentCheckLock.current)void checkPayment({silent:true});},15000);return()=>window.clearInterval(timer)},[paymentOrder?.order_id,paymentOrder?.status,checkPayment]);
  const paymentExpiryMs=paymentOrder?.expires_at?new Date(paymentOrder.expires_at).getTime():new Date(paymentOrder?.created_at||Date.now()).getTime()+30*60*1000;
  const paymentWindowExpired=Boolean(paymentOrder)&&paymentClockNow>=paymentExpiryMs;
  const paymentSecondsRemaining=Math.max(0,Math.floor((paymentExpiryMs-paymentClockNow)/1000));
  const paymentCountdown=String(Math.floor(paymentSecondsRemaining/60)).padStart(2,"0")+":"+String(paymentSecondsRemaining%60).padStart(2,"0");
  async function copyText(value){try{await navigator.clipboard?.writeText(value);setNotice("Copied to clipboard.");}catch{setNotice("Copy is unavailable in this browser. Press and hold the address to copy it.");}}
  return <div className="ai-credits-page">
    <button type="button" className="ai-credits-back" onClick={onBack}>← Back to AI Trading</button>
    <section className="ai-credits-hero"><div><small>FLEXAR AI ACCESS</small><h1>AI Credits</h1><p>Power more AI market scans with discounted packages and bonus credits.</p><button type="button" className="ai-credit-add-button" onClick={()=>document.getElementById("ai-credit-packages")?.scrollIntoView({behavior:"smooth",block:"start"})}>Buy more credits ↓</button></div><div className="ai-credits-balance"><small>YOUR BALANCE</small><strong>{balance.toFixed(1)}</strong><span>credits remaining</span></div></section>
    {notice&&<div className="notice ai-credits-notice" role="status">{notice}</div>}
    {paymentOrder&&!paymentOpen&&<section className="ai-credit-pending-bar"><div><small>PAYMENT REQUEST IN PROGRESS</small><strong>{Number(paymentOrder.payment_amount).toFixed(2)} USDT · {paymentOrder.credits} AI credits</strong><span>Finish your existing order before creating another.</span></div><button type="button" onClick={()=>setPaymentOpen(true)}>Continue payment →</button></section>}
    {paymentOrder&&paymentOpen&&<div className="auth-modal-backdrop ai-credit-payment-backdrop" onClick={()=>setPaymentOpen(false)}>
      <section className="wallet-action-modal ai-credit-payment-modal" onClick={event=>event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-credit-payment-title">
        <button className="auth-close" type="button" onClick={()=>setPaymentOpen(false)} aria-label="Close payment details">×</button>
        <div className="wallet-flow-heading"><span className="wallet-flow-icon"><img src="https://cdn.simpleicons.org/tether" alt="USDT"/></span><div><div className="eyebrow">FLEXAR AI · SECURE CHECKOUT</div><h2 id="ai-credit-payment-title">Buy AI credits</h2><p>Complete payment with USDT on the TRON (TRC-20) network.</p></div></div>
        <div className="wallet-stepper"><span className="complete"><b>1</b> Package</span><i/><span className="current"><b>2</b> Transfer</span><i/><span><b>3</b> Verify</span></div>
        <div className="ai-credit-order-summary"><div><span>Selected package</span><strong>{paymentOrder.credits} AI credits</strong></div><div><span>Package price</span><strong>{Number(paymentOrder.base_amount).toFixed(2)} USDT</strong></div></div>
        <div className="deposit-qr-card">{paymentAddress?<img className="deposit-qr-code" src={"https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data="+encodeURIComponent(paymentAddress)} alt="QR code for FLEXAR USDT TRC-20 payment address"/>:<div className="deposit-qr-placeholder">Payment address unavailable</div>}<small>USDT · TRON · TRC-20</small></div>
        <div className="deposit-payment-amount"><small>SEND EXACTLY</small><strong>{Number(paymentOrder.payment_amount).toFixed(2)} <span>USDT</span></strong><p>Send the exact amount to match this order. Your credit package is added only after on-chain verification.</p></div>
        <div className="ai-credit-address-block"><small>FLEXAR PAYMENT ADDRESS</small><code>{paymentAddress||"Loading payment address…"}</code><div className="deposit-payment-actions"><button type="button" className="deposit-copy-button" disabled={!paymentAddress} onClick={()=>copyText(paymentAddress)}>Copy address</button><button type="button" className="deposit-copy-button secondary" onClick={()=>copyText(Number(paymentOrder.payment_amount).toFixed(2))}>Copy exact amount</button></div></div>
        <div className="deposit-auto-status" role="status"><span className={"deposit-auto-indicator "+(paymentMatchIssue==="needs_review"?"review":"")}></span><div><strong>{paymentMatchIssue==="needs_review"?"Payment needs review":paymentChecking?"Checking the TRON blockchain…":"Automatic verification is active"}</strong><small>{paymentWindowExpired?"30-minute payment window ended. If you paid, submit your transaction hash below.":"Payment window · "+paymentCountdown+" remaining. Flexar checks automatically every 15 seconds."}</small></div><span className="deposit-auto-live">{paymentMatchIssue==="needs_review"?"REVIEW":paymentChecking?"CHECKING":"LIVE"}</span></div>
        <button type="button" className="withdrawal-submit" disabled={paymentChecking||busyPlan!==0} onClick={confirmPayment}>{paymentChecking?"Checking blockchain…":"Check payment now →"}</button>
        {paymentWindowExpired&&<form className="deposit-hash-form" onSubmit={submitPaymentHash}><div><strong>Payment not matched yet?</strong><p>Paste the transaction hash from your wallet or exchange. Flexar checks it against confirmed TRON data.</p></div><label>Transaction hash<input value={paymentHash} onChange={e=>setPaymentHash(e.target.value)} placeholder="Paste the transaction ID (hash)" autoComplete="off" spellCheck={false} maxLength={66} required/></label><button type="submit" disabled={paymentChecking||busyPlan!==0||!paymentHash.trim()}>{paymentChecking?"Verifying transaction…":"Submit transaction hash →"}</button></form>}
        {paymentMatchIssue==="needs_review"&&<div className="notice" role="status">Your transfer needs manual review. Your AI credits have not been added. Keep the transaction hash available for support.</div>}
        {paymentWindowExpired&&!["needs_review","ambiguous"].includes(paymentMatchIssue)&&<button type="button" className="deposit-new-request-button" onClick={()=>{setPaymentOrder(null);setPaymentOpen(false);setPaymentHash("");setPaymentMatchIssue("");setNotice("Only start a new payment if you did not send the previous one.");}}>I didn’t send this payment — choose a new package</button>}
        {notice&&<div className="notice" role="status">{notice}</div>}
        <p className="deposit-safety-note">Send USDT only on TRC-20. Flexar verifies the token, amount, recipient, confirmed transaction receipt and duplicate use before adding credits.</p>
        <button type="button" className="ai-credit-modal-close" onClick={()=>setPaymentOpen(false)}>I’ll finish this later</button>
      </section>
    </div>}
    <section className="ai-credit-plans" id="ai-credit-packages"><div className="ai-credits-section-head"><div><small>CHOOSE A PACKAGE</small><h2>More credits. Better value.</h2></div><span>1 AI trade = 1.5 credits</span></div><div className="ai-credit-plan-grid">{AI_CREDIT_PLANS.map(plan=>{const total=plan.credits+plan.bonus,regular=plan.credits/2,discount=regular>plan.price?Math.round((1-plan.price/regular)*100):0;return <article className={plan.credits===45?"ai-credit-plan featured":"ai-credit-plan"} key={plan.credits}>{plan.credits===50&&<div className="ai-plan-badge">POPULAR</div>}<div className="ai-plan-top"><span>{plan.credits} credits</span>{discount>0&&<b>Save {discount}%</b>}</div><strong className="ai-plan-price">${plan.price}</strong><span className="ai-plan-total">{total} total credits {plan.bonus>0&&<em>+{plan.bonus} bonus</em>}</span><span className="ai-plan-run-count">Up to {Math.floor(total/1.5)} full AI scans</span><button type="button" onClick={()=>buy(plan)} disabled={Boolean(busyPlan)||Boolean(paymentOrder)}>{busyPlan===plan.credits?"Preparing payment…":`Buy ${total} credits →`}</button></article>})}</div></section>
    <section className="ai-credits-note"><strong>How credits work</strong><p>Each time FLEXAR AI opens a trade, 1.5 credits are consumed. Your credits stay available until you use them, so larger packages give you more trading capacity at a lower effective cost.</p></section>
  </div>;
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
  const activeTrades=(account.trades||[]).filter((trade)=>trade.status==="active");
  const activeAiTrades=activeTrades.filter((trade)=>String(trade.metadata?.trade_mode||"")==="ai");
  const activeTrade=activeAiTrades[0]||activeTrades[0]||null;
  const activeAiPnl=activeAiTrades.reduce((sum,trade)=>sum+Number(trade.unrealized_pnl||0),0);
  const activeAiCapital=activeAiTrades.reduce((sum,trade)=>sum+Number(trade.stake||0),0);
  const direction=String(activeTrade?.direction||opportunity?.direction||"up")==="down"?"DOWN":"UP",score=Math.round(Number(activeTrade?.metadata?.confidence_percent||opportunity?.signal_score*100||0)),symbol=activeTrade?.metadata?.market_symbol||opportunity?.symbol||"—",price=Number(activeTrade?.entry_price||opportunity?.entry_price||0);
  const riskStyle=String(profile?.trading_style||"balanced").toLowerCase();
  const risk={conservative:{stop:.003,target:.006,breakEven:.003,maxHoldHours:4},balanced:{stop:.0045,target:.009,breakEven:.004,maxHoldHours:6},growth:{stop:.007,target:.012,breakEven:.006,maxHoldHours:8}}[riskStyle]||{stop:.0045,target:.009,breakEven:.004,maxHoldHours:6};
  const previewTakeProfit=price>0?price*(direction==="UP"?1+risk.target:1-risk.target):0;
  const previewStopLoss=price>0?price*(direction==="UP"?1-risk.stop:1+risk.stop):0;
  const activeTradeCount=activeTrades.length;
  const canOpenAnotherTrade=activeTradeCount<2;
  const usdt=account.wallets.find(item=>item.asset==="USDT"),reward=account.rewards?.find(item=>item.status==="active"),walletBalance=Number(usdt?.available_balance||0),bonusBalance=Number(reward?.remaining_reward||0),numericAmount=Number(amount),tradingFunds=walletBalance+bonusBalance,aiCreditsRemaining=Number(profile?.ai_credits||0),hasTradingAccess=Boolean(account.tradingAccess?.has_access)||aiCreditsRemaining>=1.5,canTrade=hasTradingAccess&&tradingFunds>=numericAmount&&canOpenAnotherTrade;
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
  return <div className="ai-trade-page"><section className="ai-page-hero compact" data-tour="trade-hero"><div className="ai-hero-copy"><div className="engine-kicker"><span className="engine-pulse"/> FLEXAR AI TRADING BOT</div><h1>Start FLEXAR AI<br/><span>trading bot.</span></h1><p>Choose how FLEXAR should work for you: review every AI trade yourself, or let the bot execute within the stake limit you set.</p><div className="ai-credit-compact"><span className="ai-credit-label">AI CREDITS</span><strong>{Number(profile?.ai_credits||0).toFixed(0)}</strong><span className="ai-credit-unit">remaining</span><button type="button" className="ai-credit-info-button" onClick={()=>setAiCreditInfo(true)} aria-label="About FLEXAR AI credits">ⓘ</button><button type="button" className="ai-credit-add-button" onClick={onOpenCredits}>Buy credits</button></div>{!aiEngineActive&&!opportunity&&<button type="button" className="ai-start-button hero-start" onClick={()=>setModeOpen(true)} disabled={aiScanning}>{aiScanning?"Scanning…":"Start FLEXAR AI trading bot →"}</button>}</div><div className="ai-engine-controls"><div className={aiEngineActive?"ai-engine-state active":"ai-engine-state"}><span className="engine-status-dot"/><div><small>BOT</small><strong>{aiEngineActive?"RUNNING":"STANDBY"}</strong></div></div>{aiEngineActive&&<button type="button" className="ai-stop-button" onClick={onStopAi}>Stop AI</button>}</div></section>
    {mode==="manual"&&aiEngineActive&&opportunities.length>0&&!activeTrade&&<section className="ai-suggestion-strip"><div className="section-heading"><div><small>AI SUGGESTIONS · MAX 2</small><h2>Choose a setup</h2></div><span>{opportunities.length} available</span></div><div className="ai-suggestion-list">{opportunities.map(item=>{const itemScore=Math.round(Number(item.signal_score||0)*100);const itemUp=item.direction!=="down";return <button type="button" key={item.id} className={item.id===opportunity?.id?"ai-suggestion-card selected":"ai-suggestion-card"} onClick={()=>{setSelectedOpportunityId(item.id);setDetailsExpanded(false)}}><PairIcon symbol={item.symbol} cryptoIcons={cryptoIcons}/><span><strong>{item.symbol}</strong><small>{itemUp?"↗ LONG":"↘ SHORT"} · {itemScore}% signal</small></span><b>{itemScore}%</b></button>})}</div></section>}
    {activeAiTrades.length>0&&<section className="ai-active-session"><div className="ai-active-session-head"><div><small>ACTIVE AI SESSION</small><h2>{activeAiTrades.length} active {activeAiTrades.length===1?"position":"positions"}</h2></div><div className="ai-session-total"><small>TOTAL OPEN P&L</small><strong className={activeAiPnl>=0?"green":"red"}>{signedMoney(activeAiPnl)}</strong><span>{activeAiCapital>0?((activeAiPnl/activeAiCapital)*100).toFixed(2):"0.00"}% on active capital</span></div></div><div className="ai-active-session-list">{activeAiTrades.map(trade=>{const tradePnl=Number(trade.unrealized_pnl||0),tradeStake=Number(trade.stake||0),tradeSymbol=trade.metadata?.market_symbol||trade.asset||"—";return <article className="ai-active-position" key={trade.id}><div className="ai-active-position-main"><PairIcon symbol={tradeSymbol} cryptoIcons={cryptoIcons}/><div><strong>{tradeSymbol}</strong><small className={trade.direction==="up"?"green":"red"}>{trade.direction==="up"?"↗ LONG":"↘ SHORT"} · {Number(trade.leverage||1).toFixed(0)}×</small></div></div><div><small>CAPITAL</small><strong>$ {money(tradeStake)}</strong></div><div className="ai-active-position-value"><small>POSITION VALUE</small><strong>$ {money(tradeStake*Math.max(1,Number(trade.leverage||1)))}</strong></div><div className="ai-active-position-pnl"><small>LIVE P&L</small><strong className={tradePnl>=0?"green":"red"}>{signedMoney(tradePnl)}</strong><span>{tradeStake>0?((tradePnl/tradeStake)*100).toFixed(2):"0.00"}%</span></div><button type="button" onClick={()=>setDetailsExpanded(false)}>View position</button></article>})}</div></section>}
    {!opportunity&&!activeTrade?<><section className="ai-status-panel"><div><small>AI BOT STATUS</small><h2>{aiScanning?"Scanning the markets…":aiEngineActive?"FLEXAR is watching for a qualifying setup.":"Ready for your first AI setup."}</h2><p>{aiScanning?"Comparing live market conditions across supported instruments.":aiEngineActive?(mode==="autopilot"?"Autopilot is enabled. A qualifying setup will execute within your selected stake limit.":"Manual approval is enabled. You will review each AI trade before capital is used."):"The trading workspace is ready. Start the bot above and choose how FLEXAR should handle the next qualifying setup."}</p></div><span className={aiEngineActive?"status-pill live":"status-pill"}>{aiEngineActive?"LIVE":"READY"}</span></section><section className="ai-workspace-preview"><div className="workspace-preview-head"><div><small>TRADING WORKSPACE</small><h2>AI setup monitor</h2></div><span>10 MARKETS</span></div><div className="workspace-preview-grid"><div><small>MARKET</small><strong>BTC / USDT</strong><span>CRYPTO · LIVE</span></div><div><small>SIGNAL</small><strong>Waiting</strong><span>AI will surface the setup</span></div><div><small>POSITION</small><strong>{activeTradeCount}/2 ACTIVE</strong><span>FLEXAR manages open risk</span></div><div><small>STAKE</small><strong>{autoStake} USDT</strong><span>{mode==="autopilot"?"Autopilot limit":"Manual approval"}</span></div></div></section></>:<section className={activeTrade?"ai-trade-decision active":"ai-trade-decision"}><div className="decision-head"><div><small>{activeTrade?"AI TRADE · ACTIVE":"AI SIGNAL · READY FOR REVIEW"}</small><h2>{symbol}</h2><span>{direction==="UP"?"↗ LONG":"↘ SHORT"} · {score}% SIGNAL</span></div><div className="signal-score-large"><strong>{score}%</strong><small>CONFIDENCE</small></div></div><div className="decision-market-row"><div className="market-identity"><PairIcon symbol={symbol} cryptoIcons={cryptoIcons}/><div><strong>{symbol}</strong><small>{marketType}</small></div></div><div className={direction==="UP"?"signal-direction up":"signal-direction down"}>{direction==="UP"?"↗ UP":"↘ DOWN"}</div></div><button type="button" className="ai-preview-toggle" onClick={()=>setDetailsExpanded(v=>!v)}>{detailsExpanded?"Collapse full preview":"Expand full preview"} <span>{detailsExpanded?"↑":"↓"}</span></button>{detailsExpanded&&<><div className="signal-level-grid compact-levels"><div><small>ENTRY</small><strong>{price.toLocaleString(undefined,{maximumFractionDigits:6})}</strong></div><div><small>INITIAL TARGET</small><strong>{previewTakeProfit?previewTakeProfit.toLocaleString(undefined,{maximumFractionDigits:6}):"AUTO"}</strong></div><div><small>INITIAL STOP</small><strong>{previewStopLoss?previewStopLoss.toLocaleString(undefined,{maximumFractionDigits:6}):"AUTO"}</strong></div><div><small>MAX HOLD</small><strong>{risk.maxHoldHours} H</strong></div></div><p className="ai-risk-preview-copy"><b>{riskStyle[0].toUpperCase()+riskStyle.slice(1)} risk:</b> the stop can move to break-even after the configured profit trigger, then trail the market so profitable trades can continue beyond the initial target.</p></>}<div className="ai-mode-strip"><span>{mode==="autopilot"?"AUTOPILOT ACTIVE":"MANUAL APPROVAL"}</span><button type="button" onClick={()=>setModeOpen(true)}>Change mode</button></div><div className="active-ai-trade-summary"><div className="panel-heading"><div><small>POSITION STATUS</small><h3>Trade is active</h3></div><span className="capital-badge live">LIVE</span></div><div className="active-ai-live-preview"><PairIcon symbol={symbol} cryptoIcons={cryptoIcons}/><div><strong>{symbol}</strong><small>{direction==="UP"?"↗ LONG":"↘ SHORT"} · {Number(activeTrade?.metadata?.confidence_percent||score).toFixed(0)}% confidence</small></div><b className={Number(activeTrade?.unrealized_pnl||0)>=0?"green":"red"}>{Number(activeTrade?.unrealized_pnl||0)>=0?"+":"−"}$ {Math.abs(Number(activeTrade?.unrealized_pnl||0)).toFixed(2)}</b></div><button type="button" className="ai-preview-toggle" onClick={()=>setDetailsExpanded(v=>!v)}>{detailsExpanded?"Collapse details":"Expand details"} <span>{detailsExpanded?"↑":"↓"}</span></button>{detailsExpanded&&<><div className="active-ai-metrics"><div><small>CAPITAL</small><strong>$ {Number(activeTrade?.stake||0).toFixed(2)}</strong></div><div><small>LIVE PROFIT</small><strong className={Number(activeTrade?.unrealized_pnl||0)>=0?"green":"red"}>{Number(activeTrade?.unrealized_pnl||0)>=0?"+":"−"}$ {Math.abs(Number(activeTrade?.unrealized_pnl||0)).toFixed(2)}</strong></div><div><small>LEVERAGE</small><strong>{Number(activeTrade?.leverage||1).toFixed(0)}×</strong></div><div><small>CONFIDENCE</small><strong>{Number(activeTrade?.metadata?.confidence_percent||score).toFixed(0)}%</strong></div></div><div className="active-ai-status"><span>ENTRY {Number(activeTrade?.entry_price||price).toLocaleString(undefined,{maximumFractionDigits:6})}</span><span>INITIAL TARGET {Number(activeTrade?.initial_take_profit_price||previewTakeProfit).toLocaleString(undefined,{maximumFractionDigits:6})}</span><span>INITIAL STOP {Number(activeTrade?.initial_stop_loss_price||previewStopLoss).toLocaleString(undefined,{maximumFractionDigits:6})}</span><span>MAX HOLD {risk.maxHoldHours} H</span></div><p className="active-ai-live-copy">FLEXAR is managing this position. Live profit updates as the market moves.</p></>}</div><div className="decision-capital"><div className="panel-heading"><div><small>STAKE</small><h3>Choose your capital</h3></div><span className="capital-badge">USDT</span></div><div className="capital-summary"><div><small>AVAILABLE</small><strong>{tradingFunds.toLocaleString(undefined,{maximumFractionDigits:4})} USDT</strong></div><span>Wallet {walletBalance.toFixed(2)} · Bonus {bonusBalance.toFixed(2)} · {activeTradeCount}/2 active</span></div><div className="stake-presets">{["10","25","50","100"].map(v=><button type="button" key={v} className={amount===v?"selected":"choice"} onClick={()=>setAmount(v)} disabled={busy||!canOpenAnotherTrade}>$ {v}</button>)}</div><div className="amount-input-wrap"><span>$</span><input inputMode="decimal" value={amount} onChange={e=>updateAmount(e.target.value)} placeholder="0.00" aria-label="AI trade stake" disabled={busy||!canOpenAnotherTrade}/><small>USDT</small></div>{mode==="autopilot"?<div className="autopilot-notice">{autoBusy?"Autopilot is executing this qualifying setup…":activeTradeCount>=2?"Two positions are already active. FLEXAR will wait for an opening before taking another.":"Autopilot is enabled for this bot. Manual approval is not required for qualifying setups within your stake limit."}</div>:<button className="ai-approve-button decision-approve" disabled={busy||!canTrade||numericAmount<=0} onClick={confirmAiTrade}>{busy?"Opening AI trade…":activeTradeCount>=2?"Two positions already active":"Approve AI Trade →"}</button>}{notice&&<div className="notice" role="status">{notice}</div>}{!hasTradingAccess&&<div className="subscription-lock"><b>Your trading access has ended.</b><span>Choose a FLEXAR Pro plan or ensure you have at least 1.5 AI credits to open an AI trade.</span></div>}{hasTradingAccess&&!canTrade&&numericAmount>0&&activeTradeCount<2&&<p className="helper">Your stake is higher than your available trading funds.</p>}</div></section>}
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
  const closedTrades=trades.filter(t=>["won","lost"].includes(t.status));
  const realizedProfit=closedTrades.reduce((sum,t)=>sum+Number(t.result_amount||0)-Number(t.stake||0),0);
  const todayKey=new Date().toLocaleDateString("en-CA");
  const todayProfit=closedTrades.reduce((sum,t)=>new Date(t.settled_at||t.opened_at||t.created_at||0).toLocaleDateString("en-CA")===todayKey?sum+Number(t.result_amount||0)-Number(t.stake||0):sum,0);
  const netProfit=realizedProfit+activeTrades.reduce((sum,t)=>sum+Number(t.unrealized_pnl||0),0);
  const activeOpenPnl=activeTrades.reduce((sum,t)=>sum+Number(t.unrealized_pnl||0),0);
  const activeCapital=activeTrades.reduce((sum,t)=>sum+Number(t.stake||0),0);
  const activeOpenReturn=activeCapital>0?(activeOpenPnl/activeCapital)*100:0;
  const recentTrades=trades.slice(0,3);
  const recentTransactions=(account.transactions||[]).slice(0,3);
  return <div className="activity-page">
    <section className="intro activity-intro"><div className="activity-intro-copy"><small>ACTIVITY CENTER</small><h1>Track every move.</h1><p>See active positions, trade results and wallet movements without having to decode the numbers.</p></div><div className="activity-intro-watermark" aria-hidden="true" /></section>
    {activeTrades.length>0&&<section className="active-trades-card activity-feature-card"><div className="section-heading"><div><small>LIVE NOW · {activeTrades.length}/2 POSITIONS</small><h2>Active trades</h2></div><span className="live-badge">● ACTIVE</span></div><div className="activity-open-pnl"><div><small>TOTAL OPEN P&L</small><strong className={activeOpenPnl>=0?"green":"red"}>{signedMoney(activeOpenPnl)}</strong></div><div><small>OPEN RETURN</small><strong className={activeOpenReturn>=0?"green":"red"}>{activeOpenReturn>=0?"+":""}{activeOpenReturn.toFixed(2)}%</strong></div><div><small>ACTIVE CAPITAL</small><strong>$ {money(activeCapital)}</strong></div></div><div className="activity-live-grid">{activeTrades.map(t=>{const pnl=Number(t.unrealized_pnl||0),entry=Number(t.entry_price||0),current=Number(t.current_price||0);return <article className="activity-live-trade" key={t.id}><div className="activity-trade-top"><div><strong>{t.metadata?.market_symbol||t.asset}</strong><span className={t.direction==="up"?"green":"red"}>{t.direction==="up"?"↗ LONG":"↘ SHORT"}</span></div><b className={pnl>=0?"green":"red"}>{signedMoney(pnl)}</b></div><div className="activity-trade-capital"><span>CAPITAL <strong>{"$"+money(t.stake)}</strong></span><span>LEVERAGE <strong>{Number(t.leverage||1).toFixed(0)}×</strong></span><span>ENTRY <strong>{entry?entry.toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</strong></span><span>NOW <strong>{current?current.toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</strong></span></div><div className="active-risk-row"><span>Target {t.initial_take_profit_price?Number(t.initial_take_profit_price).toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</span><span>Stop {t.trailing_stop_price?Number(t.trailing_stop_price).toLocaleString(undefined,{maximumFractionDigits:6}):t.initial_stop_loss_price?Number(t.initial_stop_loss_price).toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</span><span>Break-even {t.break_even_price?Number(t.break_even_price).toLocaleString(undefined,{maximumFractionDigits:6}):"—"}</span></div><small className="activity-live-caption">Unrealized P&L · updates with the market</small></article>})}</div></section>}
    <section className="trading-profit-card">
      <div className="section-heading"><div><small>TRADING PROFIT</small><h2>Your earnings from trading</h2></div><span className="profit-live-badge">LIVE</span></div>
      <div className="trading-profit-grid">
        <div><small>PROFIT TODAY</small><strong className={todayProfit>=0?"green":"red"}>{signedMoney(todayProfit)}</strong><span>Realized today · wins minus losses</span></div>
        <div><small>CUMULATIVE PROFIT</small><strong className={realizedProfit>=0?"green":"red"}>{signedMoney(realizedProfit)}</strong><span>All closed trades · net result</span></div>
        <div><small>OPEN P&L</small><strong className={activeOpenPnl>=0?"green":"red"}>{signedMoney(activeOpenPnl)}</strong><span>Unrealized · still in progress</span></div>
      </div>
    </section>
    <section className="activity-stats activity-kpi-card"><div><span className="activity-stat-icon">↗</span><div><small>TRADES</small><strong>{trades.length}</strong></div></div><div><span className="activity-stat-icon">✓</span><div><small>WINS</small><strong>{wins}</strong></div></div><div><span className="activity-stat-icon">×</span><div><small>LOSSES</small><strong>{losses}</strong></div></div><div><span className="activity-stat-icon net" aria-hidden="true">Σ</span><div className="activity-stat-copy net-copy"><small>NET P&L</small><strong className={netProfit>=0?"green":"red"}>{signedMoney(netProfit)}</strong></div></div></section>
    <section className="activity-section"><div className="section-heading"><div><small>TRADE HISTORY</small><h2>Recent trades</h2></div><button type="button" className="activity-expand-button" onClick={()=>setPage("activity-trades")}>View all <span>→</span></button></div>{recentTrades.length?<div className="trade-history-list">{recentTrades.map(t=><TradeHistoryCard key={t.id} trade={t}/>)}</div>:<div className="empty-state"><strong>No trades yet</strong><p>Your completed and active trades will appear here.</p></div>}</section>

    <section className="activity-section"><div className="section-heading"><div><small>WALLET LEDGER</small><h2>Recent transactions</h2></div><button type="button" className="activity-expand-button" onClick={()=>setPage("activity-transactions")}>View all <span>→</span></button></div><ActivityRows account={account} limit={3}/></section>
  </div>;
}
