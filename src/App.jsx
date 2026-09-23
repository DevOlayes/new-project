import { useEffect, useState } from "react";
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

  const refreshAccount = useCallback(async () => { if (!supabase || !user) return; setLoading(true); const result = await getAccountData(); setAccount(result); setLoading(false); }, [user]);

  useEffect(() => {
    const miniApp = getTelegramWebApp();
    setInMiniApp(isTelegramMiniApp());
    if (miniApp) { miniApp.ready(); miniApp.expand(); }
    if (!supabase) { setLoading(false); return; }
    let mounted = true;
    if (miniApp && miniApp.initData) { supabase.functions.invoke("telegram-auth", { body: { initData: miniApp.initData } }).then(({ data, error }) => { if (!mounted) return; if (error || data?.error) { setAuthError(data?.error || error?.message || "Telegram authentication failed."); setLoading(false); return; } setAuthError(""); refreshAccount(); }).catch((error) => { if (mounted) { setAuthError(error.message || "Telegram authentication failed."); setLoading(false); } }); }
    supabase.auth.getClaims().then(({ data }) => { if (mounted) setUser(data?.claims || null); });
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

  if (!inMiniApp) return <Landing />;
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

function Landing({ onOpen }) {
  return <div className="landing">
    <header className="landing-topbar"><div className="brand"><b>F</b><div><strong>Flexar</strong><small>AI Trades</small></div></div><span className="status-pill">● BUILDING</span></header>
    <main className="landing-content">
      <section className="landing-hero"><div className="eyebrow">AI-POWERED TRADING</div><h1>Trade with a clearer view.</h1>
        <p>Flexar brings AI trade selection, wallet management and account activity into one simple Telegram-first experience.</p>
        <button className="landing-cta" onClick={onOpen}>Open Flexar <span>→</span></button><small className="landing-note">Best experienced inside Telegram.</small>
      </section>
      <section className="landing-grid"><LandingCard title="AI Trades" text="A focused flow for selecting and monitoring trades." /><LandingCard title="Wallets" text="TON and USDT on TRC-20 in one account." /><LandingCard title="Activity" text="Keep your trades, transactions and rewards together." /></section>
      <section className="landing-strip"><span>TELEGRAM-FIRST</span><strong>One account. One balance. Multiple interfaces.</strong></section>
    </main>
  </div>;
}

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
  const [dir, setDir] = useState("UP"); const [amount, setAmount] = useState("25"); const amounts = ["10","25","50","100"];
  return <><section className="intro"><small>AI TRADE</small><h1>Trade with a clear view.</h1><p>Choose your stake, duration and direction.</p></section>
    <section className="card"><div className="market"><strong>TON / USDT</strong><span>● LIVE</span></div><div className="price"><small>Current price</small><strong>$3.42</strong><em>+2.14%</em></div>
      <label>Direction</label><div className="grid two"><button className={dir === "UP" ? "selected" : ""} onClick={() => setDir("UP")}>↗ UP</button><button className={dir === "DOWN" ? "selected" : ""} onClick={() => setDir("DOWN")}>↘ DOWN</button></div>
      <label>Stake</label><div className="grid four">{amounts.map((item) => <button key={item} className={amount === item ? "selected" : ""} onClick={() => setAmount(item)}>{"$" + item}</button>)}</div>
      <button className="full">Confirm {dir} trade</button></section></>;
}

function Activity({ account }) { return <><section className="intro"><small>ACTIVITY</small><h1>Your account history.</h1><p>Trades and wallet transactions are loaded from Supabase.</p></section><ActivityRows account={account} /></>; }

function Wallet({ account }) { return <><section className="intro"><small>WALLET</small><h1>Your funds, connected.</h1><p>Balances below are read directly from Supabase.</p></section><div className="grid">{account.wallets.map((wallet)=><BalanceCard key={wallet.id} asset={wallet.asset} wallet={wallet} />)}</div><div className="actions"><button>Deposit</button><button className="secondary">Withdraw</button></div><div className="notice">Deposit verification and withdrawals will be server-controlled. The browser cannot edit balances.</div></>; }

function Profile({ user, profile, signOut }) { return <><section className="profile"><div>{(profile?.display_name || "F").slice(0,1).toUpperCase()}</div><p><small>{profile?.telegram_username ? "@" + profile.telegram_username : "Flexar account"}</small><strong>{user ? profile?.display_name || "Connected account" : "Telegram authentication pending"}</strong></p>{user ? <button className="secondary" onClick={signOut}>Sign out</button> : <span className="pending-badge">PENDING</span>}</section><div className="list"><Row text="Notifications" value="Telegram + app" /><Row text="Security" value="Protected" /><Row text="Referral code" value={profile?.referral_code || "—"} /></div></>; }

function Row({ text, value, bad }) { return <div className="row"><span>{text}</span><strong className={bad ? "red" : "green"}>{value}</strong></div>; }
