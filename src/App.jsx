import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { getTelegramWebApp, isTelegramMiniApp } from "./lib/telegram";
import { getAccountData } from "./lib/data";

const nav = [["home","⌂","Home"],["trade","↗","Trade"],["activity","◷","Activity"],["wallet","▣","Wallet"],["profile","◉","Profile"]];

export default function App() {
  const [inMiniApp, setInMiniApp] = useState(false);
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [account, setAccount] = useState({ wallets: [], trades: [], transactions: [], notifications: [], opportunities: [], error: null });
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [market, setMarket] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [rewardBusy, setRewardBusy] = useState(false);

  const refreshAccount = useCallback(async () => { if (!supabase || !user) return; setLoading(true); const result = await getAccountData(); setAccount(result); setLoading(false); }, [user]);

  useEffect(() => {
    let cancelled = false;
    const loadMarket = () => fetch("https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT").then((r) => r.ok ? r.json() : null).then((data) => { if (!cancelled && data) setMarket({ price: Number(data.lastPrice), change: Number(data.priceChangePercent) }); }).catch(() => {});
    loadMarket();
    const timer = setInterval(loadMarket, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  useEffect(() => {
    window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); setInstallPrompt(event); });
    const miniApp = getTelegramWebApp();
    setInMiniApp(isTelegramMiniApp());
    if (miniApp) { miniApp.ready(); miniApp.expand(); }
    if (!supabase) { setLoading(false); return; }
    let mounted = true;
    if (miniApp && miniApp.initData) { supabase.functions.invoke("telegram-auth", { body: { initData: miniApp.initData } }).then(async ({ data, error }) => { if (!mounted) return; if (error || data?.error) { setAuthError(data?.error || error?.message || "Telegram authentication failed."); setLoading(false); return; } if (!data?.session?.access_token || !data?.session?.refresh_token) { setAuthError("Telegram authentication returned no session."); setLoading(false); return; } const { error: sessionError } = await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }); if (sessionError) { setAuthError(sessionError.message || "Could not establish your Flexa AI session."); setLoading(false); return; } setAuthError(""); refreshAccount(); }).catch((error) => { if (mounted) { setAuthError(error.message || "Telegram authentication failed."); setLoading(false); } }); }
    supabase.auth.getClaims().then(({ data }) => { if (!mounted) return; const claims=data?.claims; setUser(claims?.sub ? { id: claims.sub, claims } : null); if (claims?.sub) loadProfile(claims.sub); else setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user || null);
      if (session?.user) { loadProfile(session.user.id); provisionAccount(session.user.id); } else setProfile(null);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, [refreshAccount]);

  async function provisionAccount(id) {
    if (!supabase) return;
    const referralCode = new URLSearchParams(window.location.search).get("ref") || localStorage.getItem("flexa_referral_code") || "";
    if (referralCode) localStorage.setItem("flexa_referral_code", referralCode);
    await supabase.functions.invoke("account-onboarding", { body: { referral_code: referralCode } });
    refreshAccount();
  }

  async function claimReward() {
    if (!supabase || rewardBusy) return;
    setRewardBusy(true);
    const { error } = await supabase.functions.invoke("account-onboarding", { body: { action: "claim" } });
    setRewardBusy(false);
    if (!error) refreshAccount();
  }

  async function installFlexa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  }

  async function loadProfile(id) {
    if (!supabase) return;
    const { data } = await supabase.from("profiles").select("display_name,telegram_username,avatar_url,referral_code,is_admin").eq("id", id).maybeSingle();
    setProfile(data || null);
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); setAccount({ wallets: [], trades: [], transactions: [], notifications: [], opportunities: [], error: null }); }

  if (profile?.is_admin && page === "admin") return <AdminDashboard onExit={() => setPage("home")} />;
  if (!inMiniApp && !user) return <Landing market={market} showAuth={showAuth} setShowAuth={setShowAuth} installPrompt={installPrompt} installFlexa={installFlexa} />;
  if (!user && loading) return <div className="loading-screen"><div className="loader-orb">F</div><strong>Connecting your Flexa AI account…</strong><span>Loading your account data…</span></div>;
  if (!user) return <div className="auth-screen"><div className="auth-card"><div className="brand"><b>F</b><div><strong>Flexa AI</strong><small>AI TRADES</small></div></div><h1>Connect your Telegram account</h1><p>Open Flexa AI from the Telegram Mini App so Telegram can securely identify your account.</p>{authError && <div className="error-banner">{authError}</div>}<span className="auth-hint">No separate password is required.</span></div></div>;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><b>F</b><div><strong>Flexa AI</strong><small>AI Trades</small></div></div><button className="icon-button" onClick={() => setPage("profile")}>⌁</button></header>
    <main className="content">
      {authError && <div className="error-banner">{authError}</div>}
      {page === "home" && <Home account={account} loading={loading} setPage={setPage} claimReward={claimReward} rewardBusy={rewardBusy} />}
      {page === "trade" && <Trade account={account} />}
      {page === "activity" && <Activity account={account} />}
      {page === "wallet" && <Wallet account={account} />}
      {page === "profile" && <Profile user={user} profile={profile} signOut={signOut} />}
    </main>
    <nav className="bottom-nav">{nav.map(([id, icon, label]) => <button key={id} className={page === id ? "nav active" : "nav"} onClick={() => setPage(id)}><span>{icon}</span><small>{label}</small></button>)}{profile?.is_admin&&<button className={page==="admin"?"nav active":"nav"} onClick={()=>setPage("admin")}><span>◆</span><small>Admin</small></button>}</nav>
  </div>;
}

function Landing({ market, showAuth, setShowAuth, installPrompt, installFlexa }) {
  const price = market?.price;
  const change = market?.change;
  return <div className="landing"><div className="landing-orb orb-one" /><div className="landing-orb orb-two" />
    <header className="landing-topbar"><div className="brand"><b>F</b><div><strong>Flexa AI</strong><small>AI TRADING ENGINE</small></div></div><span className="live-chip">● WEB PLATFORM</span></header>
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
  return <div className="auth-modal-backdrop" onClick={onClose}><div className="auth-modal" onClick={(event) => event.stopPropagation()}><button className="auth-close" onClick={onClose} aria-label="Close">×</button><div className="auth-modal-icon">F</div><div className="eyebrow">WELCOME TO FLEXA AI</div><h2>{mode === "signup" ? "Start in seconds." : "Welcome back."}</h2><p>{mode === "signup" ? "Create your Flexa AI account with Google or Telegram." : "Sign in with the same account you used before."}</p><AuthOptions setAuthError={setError} authError={error} /><button className="auth-mode-toggle" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Already have an account? Sign in" : "New to Flexa AI? Create an account"}</button><small className="auth-legal">By continuing, you agree to use Flexa AI responsibly and follow applicable terms.</small></div></div>;
}

function AuthOptions({ setAuthError, authError }) {
  const [busy, setBusy] = useState("");

  async function continueWithGoogle() {
    if (!supabase) { setAuthError("Supabase is not configured in this build."); return; }
    setBusy("google"); setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) { setBusy(""); setAuthError(error.message || "Google sign-in could not start."); }
  }

  useEffect(() => {
    // Load Telegram's official Login Widget directly on the website.
    // This avoids Supabase custom OAuth/OIDC providers completely.
    window.onFlexaTelegramAuth = async (telegramUser) => {
      if (!supabase) return;
      setBusy("telegram");
      setAuthError("");
      try {
        const { data, error } = await supabase.functions.invoke("telegram-login", {
          body: { telegram_user: telegramUser },
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
    };

    const container = document.getElementById("flexa-telegram-login");
    if (!container) return;
    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", "flexarxbot");
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onFlexaTelegramAuth(user)");
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
      delete window.onFlexaTelegramAuth;
    };
  }, [setAuthError]);

  return <div className="auth-options">
    <button className="auth-provider google" onClick={continueWithGoogle} disabled={!!busy}>
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

    <div className="telegram-widget-wrap">
      <div className="telegram-widget-label">Continue with Telegram</div>
      <div id="flexa-telegram-login" aria-label="Continue with Telegram" />
    </div>

    {authError && <div className="error-banner">{authError}</div>}
  </div>;
}
function LandingStep({n,title,text}) { return <article className="landing-step"><span>{n}</span><strong>{title}</strong><p>{text}</p></article>; }
function LandingFeature({title,text}) { return <article className="landing-feature"><b>✦</b><strong>{title}</strong><p>{text}</p></article>; }

function LandingCard({ title, text }) { return <article className="landing-card"><span>✦</span><strong>{title}</strong><p>{text}</p></article>; }

function Home({ account, loading, setPage, claimReward, rewardBusy }) {
  const active = account.trades.filter((trade) => trade.status === "active");
  const unread = account.notifications.filter((item) => !item.is_read).length;
  const opportunities = account.opportunities || [];
  return <>{account.rewards?.find((r) => r.status === "available") && <RewardBanner reward={account.rewards.find((r) => r.status === "available")} onClaim={claimReward} busy={rewardBusy} />}<section className="home-hero"><div><small>FLEXA AI ENGINE</small><h1>Opportunities,<br /><span>not guesswork.</span></h1><p>The engine scans market conditions and surfaces trade setups for you to review.</p></div><div className="ai-orbit"><span>AI</span><i /><i /><i /></div></section>
    <section className="home-opportunities"><div className="section-heading"><div><small>AI OPPORTUNITIES</small><h2>Ready to review</h2></div><button onClick={() => setPage("trade")}>View all →</button></div>
      {opportunities.length ? <div className="opportunity-list">{opportunities.slice(0,3).map((item) => <OpportunityCard key={item.id} item={item} setPage={setPage} />)}</div> : <div className="empty-state opportunity-empty"><strong>{loading ? "Scanning markets…" : "No opportunities yet"}</strong><p>{loading ? "Flexa AI is checking the opportunity feed." : "New AI-selected opportunities will appear here when the engine publishes them."}</p></div>}
    </section>
    <MarketsMonitored markets={account.markets} />
    <section className="balance-hero"><div><small>TOTAL AVAILABLE</small><strong>{Number(account.wallets.find((item) => item.asset === "USDT")?.available_balance || 0).toLocaleString(undefined,{maximumFractionDigits:2})} <em>USDT</em></strong></div><div className="balance-actions"><button onClick={() => setPage("wallet")}>Wallet</button><button className="secondary" onClick={() => setPage("activity")}>Activity</button></div></section>
    <div className="grid home-stats"><div className="stat"><small>Active trades</small><strong>{loading ? "…" : active.length}</strong></div><div className="stat"><small>Unread alerts</small><strong>{loading ? "…" : unread}</strong></div></div>
    <h2>Recent activity</h2><ActivityRows account={account} />
  </>;
}
function RewardBanner({ reward, onClaim, busy }) { return <section className="reward-banner"><div><small>WELCOME REWARD</small><strong>$50 <span>TRADE CREDIT</span></strong><p>Use within {Math.max(0,Math.ceil((new Date(reward.expires_at)-Date.now())/86400000))} days. The $50 itself is non-withdrawable; only eligible profit from reward trades can be withdrawn before expiry.</p></div><button onClick={onClaim} disabled={busy}>{busy ? "Claiming…" : "Claim $50 →"}</button></section>; }

function AdminDashboard({ onExit }) {
  const [data,setData]=useState(null), [tab,setTab]=useState("overview"), [busy,setBusy]=useState(false), [error,setError]=useState("");
  const load=useCallback(async()=>{if(!supabase)return;setBusy(true);const result=await supabase.functions.invoke("admin-control",{body:{action:"overview"}});setBusy(false);if(result.error||result.data?.error)setError(result.data?.error||result.error?.message||"Could not load admin data.");else{setError("");setData(result.data);}},[]);
  useEffect(()=>{load();},[load]);
  async function act(action,payload={}){setBusy(true);const result=await supabase.functions.invoke("admin-control",{body:{action,...payload}});setBusy(false);if(result.error||result.data?.error){setError(result.data?.error||result.error?.message||"Action failed.");return false;}await load();return true;}
  if(!data)return <div className="admin-shell"><header className="admin-header"><div><small>FLEXA AI CONTROL CENTER</small><h1>Admin Dashboard</h1></div></header><div className="admin-card">{error||"Loading control center…"}</div></div>;
  const users=data.users||[], tx=data.transactions||[], trades=data.trades||[], opp=data.opportunities||[], markets=data.markets||[], plans=data.plans||[], subs=data.subscriptions||[], learning=data.learning||[], adaptive=data.adaptive||[];
  const won=learning.filter(x=>x.outcome==="won").length, lost=learning.filter(x=>x.outcome==="lost").length;
  const money=tx.filter(x=>x.direction==="credit"&&x.status==="completed").reduce((s,x)=>s+Number(x.amount||0),0);
  const tabs=[["overview","Overview"],["users","Users"],["transactions","Transactions"],["trading","Trading"],["markets","Markets"],["ai","AI Engine"],["subscriptions","Subscriptions"],["settings","Settings"]];
  return <div className="admin-shell"><header className="admin-header"><div><small>FLEXA AI CONTROL CENTER</small><h1>Admin Dashboard</h1><p>Users, money flow, trading, AI intelligence and product controls.</p></div><button className="secondary" onClick={onExit}>Exit admin</button></header>
  <div className="admin-tabs">{tabs.map(t=><button key={t[0]} className={tab===t[0]?"active":""} onClick={()=>setTab(t[0])}>{t[1]}</button>)}</div>{error&&<div className="admin-alert">{error}</div>}
  {tab==="overview"&&<><div className="admin-kpis"><Kpi label="Users" value={users.length}/><Kpi label="Transactions" value={tx.length}/><Kpi label="Trading records" value={trades.length}/><Kpi label="AI opportunities" value={opp.length}/><Kpi label="Learning rows" value={learning.length}/><Kpi label="Credit volume" value={money.toFixed(2)}/></div><div className="admin-grid"><AdminPanel title="Engine health"><p>Markets: <b>{markets.filter(x=>x.active).length}/{markets.length}</b> active</p><p>Adaptive profiles: <b>{adaptive.length}</b></p><p>Learning outcomes: <b>{won} wins / {lost} losses</b></p><p>Model: <b>opportunity-v2</b></p></AdminPanel><AdminPanel title="Recent activity">{tx.slice(0,8).map(x=><div className="admin-row" key={x.id}><span>{x.type}</span><b>{x.direction} {Number(x.amount).toFixed(2)}</b></div>)}</AdminPanel></div></>}
  {tab==="users"&&<AdminTable title="Users" columns={["Name","Email","Provider","Joined","Admin"]}>{users.map(x=><div className="admin-row" key={x.id}><span>{x.display_name||x.telegram_username||"User"}<small>{x.id.slice(0,8)}…</small></span><span>{x.email||"—"}</span><span>{x.last_login_provider||"—"}</span><span>{new Date(x.created_at).toLocaleDateString()}</span><button className="mini-action" onClick={()=>act("set_user_admin",{user_id:x.id,is_admin:!x.is_admin})}>{x.is_admin?"Remove":"Make admin"}</button></div>)}</AdminTable>}
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
function AdminSettings({settings,onSave}){const [values,setValues]=useState(Object.fromEntries((settings||[]).map(x=>[x.key,JSON.stringify(x.value)])));return <AdminPanel title="Application controls"><p className="helper">Central product settings can be changed here without rebuilding the frontend.</p>{Object.entries(values).map(([key,value])=><div className="admin-setting" key={key}><label>{key}</label><input value={value} onChange={e=>setValues({...values,[key]:e.target.value})}/><button className="mini-action" onClick={()=>{try{onSave("update_setting",{key,value:JSON.parse(value)})}catch{}}}>Save</button></div>)}</AdminPanel>}
}
function MarketsMonitored({ markets }) {
  if (!markets?.length) return null;
  return <section className="markets-monitored"><div className="section-heading"><div><small>MARKETS MONITORED</small><h2>Supported pairs</h2></div><span className="live-chip">AI SCAN</span></div><div className="market-pair-grid">{markets.map((market) => <div className="market-pair" key={market.symbol}><span>{market.market_type === "forex" ? "FX" : "CRYPTO"}</span><strong>{market.display_symbol}</strong><small>{market.source === "yahoo_finance" ? "Yahoo Finance" : "Binance"}</small></div>)}</div></section>;
}
function OpportunityCard({ item, setPage }) {
  const score = Math.round(Number(item.signal_score || 0) * 100);
  return <article className="opportunity-card"><div className="opp-top"><div><small>{item.symbol}</small><strong>AI opportunity</strong></div><span className={item.direction === "up" ? "green" : "red"}>{item.direction === "up" ? "UP ↗" : "DOWN ↘"}</span></div><div className="opp-meta"><span>{Math.round(item.duration_seconds / 60)} min</span><span>Signal {score}%</span><span>{item.status.toUpperCase()}</span></div><button onClick={() => setPage("trade")}>Review opportunity →</button></article>;
}
function BalanceCard({ asset, wallet }) { return <div className="stat"><small>{asset} · {wallet?.network || (asset === "TON" ? "TON" : "TRC-20")}</small><strong>{Number(wallet?.available_balance || 0).toLocaleString(undefined,{maximumFractionDigits:4})} {asset}</strong></div>; }
function ActivityRows({ account }) {
  const items = [...account.trades.map((t) => ({date:t.opened_at,text:t.asset+" · "+t.direction.toUpperCase()+" · "+t.status,value:t.result_amount ?? t.potential_payout ?? t.stake})), ...account.transactions.map((t) => ({date:t.created_at,text:t.type.replace("_"," ")+" · "+t.status,value:t.amount}))].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8);
  if (!items.length) return <div className="empty-state"><strong>No activity yet</strong><p>Your trades and wallet transactions will appear here.</p></div>;
  return <div className="list">{items.map((item,index)=><div className="row" key={item.date+index}><span>{item.text}</span><strong className="green">{Number(item.value||0).toLocaleString(undefined,{maximumFractionDigits:4})}</strong></div>)}</div>;
}

function Trade({ account }) {
  const [amount,setAmount]=useState("25");
  const opportunity=account.opportunities?.[0] || null;
  const dir=opportunity?.direction === "down" ? "DOWN" : "UP";
  const duration=opportunity ? String(Math.round(opportunity.duration_seconds/60)) : "60";
  const usdt=account.wallets.find((item)=>item.asset==="USDT"); const canTrade=Boolean(account.tradingAccess?.has_access) && Number(usdt?.available_balance||0)>=Number(amount);
  return <><section className="intro"><small>AI TRADE TERMINAL</small><h1>{opportunity ? "AI-selected opportunity." : "Waiting for the next setup."}</h1><p>{opportunity ? "Flexa AI selected this market from the supported pair feed. The engine handles the complex analysis underneath." : "Flexa AI is scanning the supported crypto and forex pairs for a qualifying setup."}</p></section>
    <section className="trade-market"><div className="market-head"><div><small>{opportunity?.symbol || account.markets?.[0]?.display_symbol || "MARKET"}</small><strong>{opportunity?.entry_price ? Number(opportunity.entry_price).toLocaleString(undefined,{maximumFractionDigits:6}) : "—"}</strong><span className={dir==="UP" ? "green" : "red"}>{opportunity ? dir : "SCANNING"}</span></div><span className="live-badge">● LIVE ENGINE</span></div><Chart/><div className="chart-selector"><span className="active">1m</span><span>5m</span><span>15m</span><span>1h</span></div></section>
    <section className="card"><div className="trade-balance"><span>Available USDT</span><strong>{Number(usdt?.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:4})} USDT</strong></div>
      <div className="ai-selected-trade"><small>AI DIRECTION</small><strong className={dir==="UP"?"green":"red"}>{dir==="UP"?"↗ UP":"↘ DOWN"}</strong><span>{duration} min · {opportunity ? Math.round(Number(opportunity.signal_score||0)*100) : 0}% signal confidence</span></div>
      <label>Stake</label><div className="grid four">{["10","25","50","100"].map((v)=><button key={v} className={amount===v?"selected":"choice"} onClick={()=>setAmount(v)}>${v}</button>)}</div>
      <div className="trade-summary"><span>Trade setup</span><strong>{dir} · {duration} min · ${amount}</strong></div><button className="full" disabled={!canTrade || !opportunity}>{opportunity ? "Confirm " + dir + " trade →" : "Waiting for AI opportunity…"}</button>
      {!account.tradingAccess?.has_access&&<div className="subscription-lock"><b>Your trading trial has ended.</b><span>Choose a Flexa Pro plan to continue using the trading engine.</span><button className="secondary">View plans</button></div>}{!usdt&&<p className="helper">Connect Telegram to initialize your wallet.</p>}{usdt&&account.tradingAccess?.has_access&&!canTrade&&<p className="helper">Stake exceeds your available USDT balance.</p>}<p className="demo-note">Trading access is controlled server-side. Execution remains locked until the settlement flow is enabled.</p>
    </section></>;
}

function Activity({ account }) { return <><section className="intro"><small>ACTIVITY</small><h1>Your account history.</h1><p>Trades and wallet transactions are loaded from Supabase.</p></section><ActivityRows account={account} /></>; }

function Wallet({ account }) { return <><section className="intro"><small>WALLET</small><h1>Your funds, connected.</h1><p>Balances below are read directly from Supabase.</p></section><div className="grid">{account.wallets.map((wallet)=><BalanceCard key={wallet.id} asset={wallet.asset} wallet={wallet} />)}</div><div className="actions"><button>Deposit</button><button className="secondary">Withdraw</button></div><div className="notice">Deposit verification and withdrawals will be server-controlled. The browser cannot edit balances.</div></>; }

function Profile({ user, profile, signOut }) { return <><section className="profile"><div>{(profile?.display_name || "F").slice(0,1).toUpperCase()}</div><p><small>{profile?.telegram_username ? "@" + profile.telegram_username : "Flexa AI account"}</small><strong>{user ? profile?.display_name || "Connected account" : "Telegram authentication pending"}</strong></p>{user ? <button className="secondary" onClick={signOut}>Sign out</button> : <span className="pending-badge">PENDING</span>}</section><div className="list"><Row text="Notifications" value="Telegram + app" /><Row text="Security" value="Protected" /><Row text="Referral code" value={profile?.referral_code || "—"} /><Row text="Referral sharing" value="Invite friends · earn after qualification" /></div></>; }

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

function Row({ text, value, bad }) { return <div className="row"><span>{text}</span><strong className={bad ? "red" : "green"}>{value}</strong></div>; }
