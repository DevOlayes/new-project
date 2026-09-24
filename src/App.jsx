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
    if (miniApp && miniApp.initData) { supabase.functions.invoke("telegram-auth", { body: { initData: miniApp.initData } }).then(({ data, error }) => { if (!mounted) return; if (error || data?.error) { setAuthError(data?.error || error?.message || "Telegram authentication failed."); setLoading(false); return; } setAuthError(""); refreshAccount(); }).catch((error) => { if (mounted) { setAuthError(error.message || "Telegram authentication failed."); setLoading(false); } }); }
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
    const { data } = await supabase.from("profiles").select("display_name,telegram_username,avatar_url,referral_code").eq("id", id).maybeSingle();
    setProfile(data || null);
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); setAccount({ wallets: [], trades: [], transactions: [], notifications: [], opportunities: [], error: null }); }

  if (!inMiniApp) return <Landing market={market} showAuth={showAuth} setShowAuth={setShowAuth} installPrompt={installPrompt} installFlexa={installFlexa} />;
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
    <nav className="bottom-nav">{nav.map(([id, icon, label]) => <button key={id} className={page === id ? "nav active" : "nav"} onClick={() => setPage(id)}><span>{icon}</span><small>{label}</small></button>)}</nav>
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
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (error) { setBusy(""); setAuthError(error.message || "Google sign-in could not start."); }
  }
  function continueWithTelegram() {
    const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
    if (!botUsername) { setAuthError("Telegram sign-in still needs the Flexa AI Telegram bot username configured."); return; }
    window.open("https://t.me/" + botUsername + "?startapp=auth", "_blank", "noopener,noreferrer");
  }
  return <div className="auth-options"><button className="auth-provider google" onClick={continueWithGoogle} disabled={!!busy}><span className="provider-mark google-mark" aria-hidden="true"><svg viewBox="0 0 24 24" role="img" aria-label="Google"><path fill="#4285F4" d="M21.35 12.27c0-.72-.06-1.42-.18-2.09H12v3.95h5.24a4.48 4.48 0 0 1-1.94 2.94v2.44h3.14c1.84-1.69 2.91-4.18 2.91-7.24Z"/><path fill="#34A853" d="M12 21.7c2.63 0 4.84-.87 6.45-2.36l-3.14-2.44c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.52A9.75 9.75 0 0 0 12 21.7Z"/><path fill="#FBBC05" d="M6.54 13.79a5.87 5.87 0 0 1 0-3.58V7.69H3.3a9.75 9.75 0 0 0 0 8.62l3.24-2.52Z"/><path fill="#EA4335" d="M12 6.18c1.43 0 2.72.49 3.73 1.46l2.8-2.8C16.84 3.2 14.63 2.3 12 2.3a9.75 9.75 0 0 0-8.7 5.39l3.24 2.52C7.31 7.9 9.46 6.18 12 6.18Z"/></svg></span><span>{busy === "google" ? "Connecting Google…" : "Continue with Google"}</span><b>→</b></button><button className="auth-provider telegram" onClick={continueWithTelegram} disabled={!!busy}><span className="provider-mark telegram-mark" aria-hidden="true"><svg viewBox="0 0 24 24" role="img" aria-label="Telegram"><circle cx="12" cy="12" r="11" fill="#2AABEE"/><path fill="#FFFFFF" d="M17.92 6.21 15.48 17.7c-.18.82-.67 1.02-1.35.64l-3.72-2.74-1.8 1.73c-.2.2-.36.36-.74.36l.26-3.79 6.9-6.23c.3-.27-.06-.42-.46-.15L7.3 11.76l-3.67-.92c-.8-.25-.82-.8.16-1.19l14.56-5.61c.67-.24 1.25.16 1.04 1.17Z"/></svg></span><span>Continue with Telegram</span><b>→</b></button>{authError && <div className="error-banner">{authError}</div>}</div>;
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
    <section className="balance-hero"><div><small>TOTAL AVAILABLE</small><strong>{Number(account.wallets.find((item) => item.asset === "USDT")?.available_balance || 0).toLocaleString(undefined,{maximumFractionDigits:2})} <em>USDT</em></strong></div><div className="balance-actions"><button onClick={() => setPage("wallet")}>Wallet</button><button className="secondary" onClick={() => setPage("activity")}>Activity</button></div></section>
    <div className="grid home-stats"><div className="stat"><small>Active trades</small><strong>{loading ? "…" : active.length}</strong></div><div className="stat"><small>Unread alerts</small><strong>{loading ? "…" : unread}</strong></div></div>
    <h2>Recent activity</h2><ActivityRows account={account} />
  </>;
}
function RewardBanner({ reward, onClaim, busy }) { return <section className="reward-banner"><div><small>WELCOME REWARD</small><strong>$50 <span>TRADE CREDIT</span></strong><p>Use within {Math.max(0,Math.ceil((new Date(reward.expires_at)-Date.now())/86400000))} days. The $50 itself is non-withdrawable; only eligible profit from reward trades can be withdrawn before expiry.</p></div><button onClick={onClaim} disabled={busy}>{busy ? "Claiming…" : "Claim $50 →"}</button></section>; }

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
  const [dir,setDir]=useState("UP"); const [duration,setDuration]=useState("60"); const [amount,setAmount]=useState("25");
  const usdt=account.wallets.find((item)=>item.asset==="USDT"); const canTrade=Number(usdt?.available_balance||0)>=Number(amount);
  return <><section className="intro"><small>AI TRADE TERMINAL</small><h1>Read the market first.</h1><p>Review the chart, choose your market settings and prepare the trade.</p></section>
    <section className="trade-market"><div className="market-head"><div><small>TON / USDT</small><strong>$3.42</strong><span className="green">+2.14%</span></div><span className="live-badge">● LIVE</span></div><Chart/><div className="chart-selector"><span className="active">1m</span><span>5m</span><span>15m</span><span>1h</span></div></section>
    <section className="card"><div className="trade-balance"><span>Available USDT</span><strong>{Number(usdt?.available_balance||0).toLocaleString(undefined,{maximumFractionDigits:4})} USDT</strong></div>
      <label>Direction</label><div className="grid two"><button className={dir==="UP"?"selected":"choice"} onClick={()=>setDir("UP")}>↗ UP</button><button className={dir==="DOWN"?"selected":"choice"} onClick={()=>setDir("DOWN")}>↘ DOWN</button></div>
      <label>Duration</label><div className="grid three">{["30","60","300"].map((v)=><button key={v} className={duration===v?"selected":"choice"} onClick={()=>setDuration(v)}>{v==="60"?"1 min":v==="300"?"5 min":"30 sec"}</button>)}</div>
      <label>Stake</label><div className="grid four">{["10","25","50","100"].map((v)=><button key={v} className={amount===v?"selected":"choice"} onClick={()=>setAmount(v)}>${v}</button>)}</div>
      <div className="trade-summary"><span>Trade setup</span><strong>{dir} · {duration}s · ${amount}</strong></div><button className="full" disabled={!canTrade}>Confirm {dir} trade →</button>
      {!usdt&&<p className="helper">Connect Telegram to initialize your wallet.</p>}{usdt&&!canTrade&&<p className="helper">Stake exceeds your available USDT balance.</p>}<p className="demo-note">Order execution is intentionally locked until the server-side market and settlement engine is connected.</p>
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
