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
  const [account, setAccount] = useState({ wallets: [], trades: [], transactions: [], notifications: [], error: null });
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [market, setMarket] = useState(null);

  const refreshAccount = useCallback(async () => { if (!supabase || !user) return; setLoading(true); const result = await getAccountData(); setAccount(result); setLoading(false); }, [user]);

  useEffect(() => {
    let cancelled = false;
    const loadMarket = () => fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT").then((r) => r.ok ? r.json() : null).then((data) => { if (!cancelled && data) setMarket({ price: Number(data.lastPrice), change: Number(data.priceChangePercent) }); }).catch(() => {});
    loadMarket();
    const timer = setInterval(loadMarket, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  useEffect(() => {
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
      if (session?.user) loadProfile(session.user.id); else setProfile(null);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, [refreshAccount]);

  async function loadProfile(id) {
    if (!supabase) return;
    const { data } = await supabase.from("profiles").select("display_name,telegram_username,avatar_url,referral_code").eq("id", id).maybeSingle();
    setProfile(data || null);
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); setAccount({ wallets: [], trades: [], transactions: [], notifications: [], error: null }); }

  if (!inMiniApp) return <Landing market={market} />;
  if (!user && loading) return <div className="loading-screen"><div className="loader-orb">F</div><strong>Connecting your Flexar account…</strong><span>Loading your account data…</span></div>;
  if (!user) return <div className="auth-screen"><div className="auth-card"><div className="brand"><b>F</b><div><strong>Flexar</strong><small>AI TRADES</small></div></div><h1>Connect your Telegram account</h1><p>Open Flexar from the Telegram Mini App so Telegram can securely identify your account.</p>{authError && <div className="error-banner">{authError}</div>}<span className="auth-hint">No separate password is required.</span></div></div>;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><b>F</b><div><strong>Flexar</strong><small>AI Trades</small></div></div><button className="icon-button" onClick={() => setPage("profile")}>⌁</button></header>
    <main className="content">
      {authError && <div className="error-banner">{authError}</div>}
      {page === "home" && <Home account={account} loading={loading} setPage={setPage} />}
      {page === "trade" && <Trade account={account} />}
      {page === "activity" && <Activity account={account} />}
      {page === "wallet" && <Wallet account={account} />}
      {page === "profile" && <Profile user={user} profile={profile} signOut={signOut} />}
    </main>
    <nav className="bottom-nav">{nav.map(([id, icon, label]) => <button key={id} className={page === id ? "nav active" : "nav"} onClick={() => setPage(id)}><span>{icon}</span><small>{label}</small></button>)}</nav>
  </div>;
}

function Landing({ market }) {
  const price = market?.price;
  const change = market?.change;
  return <div className="landing"><div className="landing-orb orb-one" /><div className="landing-orb orb-two" />
    <header className="landing-topbar"><div className="brand"><b>F</b><div><strong>Flexar</strong><small>AI TRADING ENGINE</small></div></div><span className="live-chip">● WEB PLATFORM</span></header>
    <main className="landing-content">
      <section className="landing-hero"><div className="eyebrow">AI-POWERED MARKET OPPORTUNITIES</div><h1>Let the AI find<br /><span>the trade.</span></h1><p>Flexar continuously studies market conditions and surfaces simplified trading opportunities, so you do not need to understand complex charts before every trade.</p><div className="landing-actions"><button className="landing-cta">Enter Flexar <b>↗</b></button><span className="hero-status"><i /> Market data connected</span></div></section>
      <section className="landing-terminal"><div className="terminal-top"><div><small>LIVE MARKET</small><strong>BTC / USDT</strong></div><span className={change >= 0 ? "green" : "red"}>{change == null ? "—" : (change >= 0 ? "+" : "") + change.toFixed(2) + "%"}</span></div><Chart /><div className="terminal-bottom"><strong>{price == null ? "Loading…" : "$" + price.toLocaleString(undefined,{maximumFractionDigits:2})}</strong><span>PUBLIC MARKET DATA</span></div><div className="floating-card float-card-a">AI OPPORTUNITY <b>SCANNING</b></div><div className="floating-card float-card-b">NEXT WINDOW <b>60 MIN</b></div></section>
      <section className="opportunity-preview"><div><div className="eyebrow">AI OPPORTUNITY FEED</div><h2>Users do not hunt for trades. Flexar finds them.</h2></div><div className="opportunity-demo"><div><span>BTC / USDT</span><strong>AI opportunity detected</strong></div><b>UP ↗</b><small>60 MIN · REVIEW READY</small></div></section>
      <section className="landing-section"><div className="eyebrow">HOW FLEXAR WORKS</div><h2>Simple on the surface. Intelligent underneath.</h2><div className="landing-steps"><LandingStep n="01" title="Scan" text="Market data is continuously collected and analyzed across supported markets."/><LandingStep n="02" title="Select" text="The engine filters signals and turns stronger setups into user-friendly opportunities."/><LandingStep n="03" title="Trade" text="You review the opportunity, choose your stake and confirm when ready." /></div></section>
      <section className="landing-section"><div className="feature-row"><LandingFeature title="AI-first trading" text="The system does the heavy market analysis before presenting an opportunity."/><LandingFeature title="Real market data" text="Charts and future signals are designed around real market pricing, not invented demo prices."/><LandingFeature title="Transparent activity" text="Trades, balances and wallet events remain connected to your account ledger." /></div></section>
    </main></div>;
}
function LandingStep({n,title,text}) { return <article className="landing-step"><span>{n}</span><strong>{title}</strong><p>{text}</p></article>; }
function LandingFeature({title,text}) { return <article className="landing-feature"><b>✦</b><strong>{title}</strong><p>{text}</p></article>; }

function LandingCard({ title, text }) { return <article className="landing-card"><span>✦</span><strong>{title}</strong><p>{text}</p></article>; }

function Home({ account, loading, setPage }) {
  const active = account.trades.filter((trade) => trade.status === "active");
  const unread = account.notifications.filter((item) => !item.is_read).length;
  return <><section className="hero"><small>FLEXAR ACCOUNT</small><h1>Ready to trade.</h1><p className="green">Live account data from your Flexar backend.</p><div className="actions"><button onClick={() => setPage("trade")}>View Market</button><button className="secondary" onClick={() => setPage("wallet")}>Wallet</button></div></section>
    <h2>Balances</h2><div className="grid"><BalanceCard asset="TON" wallet={account.wallets.find((item) => item.asset === "TON")} /><BalanceCard asset="USDT" wallet={account.wallets.find((item) => item.asset === "USDT")} /></div>
    <h2>Account</h2><div className="grid"><div className="stat"><small>Active trades</small><strong>{loading ? "…" : active.length}</strong></div><div className="stat"><small>Unread alerts</small><strong>{loading ? "…" : unread}</strong></div></div>
    <h2>Recent activity</h2><ActivityRows account={account} /></>;
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

function Profile({ user, profile, signOut }) { return <><section className="profile"><div>{(profile?.display_name || "F").slice(0,1).toUpperCase()}</div><p><small>{profile?.telegram_username ? "@" + profile.telegram_username : "Flexar account"}</small><strong>{user ? profile?.display_name || "Connected account" : "Telegram authentication pending"}</strong></p>{user ? <button className="secondary" onClick={signOut}>Sign out</button> : <span className="pending-badge">PENDING</span>}</section><div className="list"><Row text="Notifications" value="Telegram + app" /><Row text="Security" value="Protected" /><Row text="Referral code" value={profile?.referral_code || "—"} /></div></>; }

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
