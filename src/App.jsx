import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { getTelegramWebApp, isTelegramMiniApp } from "./lib/telegram";

const nav = [["home","⌂","Home"],["trade","↗","Trade"],["activity","◷","Activity"],["wallet","▣","Wallet"],["profile","◉","Profile"]];

export default function App() {
  const [inMiniApp, setInMiniApp] = useState(false);
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const miniApp = getTelegramWebApp();
    setInMiniApp(isTelegramMiniApp());
    if (miniApp) { miniApp.ready(); miniApp.expand(); }
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getClaims().then(({ data }) => { if (mounted) setUser(data?.claims || null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user || null);
      if (session?.user) loadProfile(session.user.id); else setProfile(null);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  async function loadProfile(id) {
    if (!supabase) return;
    const { data } = await supabase.from("profiles").select("display_name,telegram_username,avatar_url,referral_code").eq("id", id).maybeSingle();
    setProfile(data || null);
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); }

  if (!inMiniApp) return <Landing onOpen={() => setInMiniApp(true)} />;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><b>F</b><div><strong>Flexar</strong><small>AI Trades</small></div></div><button className="icon-button" onClick={() => setPage("profile")}>⌁</button></header>
    <main className="content">
      {page === "home" && <Home setPage={setPage} />}
      {page === "trade" && <Trade />}
      {page === "activity" && <Activity />}
      {page === "wallet" && <Wallet />}
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

function Home({ setPage }) {
  const stats = [["Available","$1,284.60"],["Active trades","1"],["Win rate","78%"],["Referrals","12"]];
  return <><section className="hero"><small>TOTAL BALANCE</small><h1>$1,284.60</h1><p className="green">+ $84.60 this week</p><div className="actions"><button onClick={() => setPage("trade")}>Start AI Trade</button><button className="secondary" onClick={() => setPage("wallet")}>Wallet</button></div></section>
    <h2>Quick view</h2><div className="grid">{stats.map(([label, amount]) => <div className="stat" key={label}><small>{label}</small><strong>{amount}</strong></div>)}</div>
    <h2>Recent activity</h2><div className="list"><Row text="TON / USDT · UP" value="+$21.25" /><Row text="TON / USDT · DOWN" value="-$15.00" bad /></div></>;
}

function Trade() {
  const [dir, setDir] = useState("UP"); const [amount, setAmount] = useState("25"); const amounts = ["10","25","50","100"];
  return <><section className="intro"><small>AI TRADE</small><h1>Trade with a clear view.</h1><p>Choose your stake, duration and direction.</p></section>
    <section className="card"><div className="market"><strong>TON / USDT</strong><span>● LIVE</span></div><div className="price"><small>Current price</small><strong>$3.42</strong><em>+2.14%</em></div>
      <label>Direction</label><div className="grid two"><button className={dir === "UP" ? "selected" : ""} onClick={() => setDir("UP")}>↗ UP</button><button className={dir === "DOWN" ? "selected" : ""} onClick={() => setDir("DOWN")}>↘ DOWN</button></div>
      <label>Stake</label><div className="grid four">{amounts.map((item) => <button key={item} className={amount === item ? "selected" : ""} onClick={() => setAmount(item)}>{"$" + item}</button>)}</div>
      <button className="full">Confirm {dir} trade</button></section></>;
}

function Activity() { return <><section className="intro"><small>ACTIVITY</small><h1>Your trade history.</h1><p>Track settled and active trades from your Flexar account.</p></section><div className="list"><Row text="TON / USDT · UP · Today 09:12" value="+$21.25" /><Row text="TON / USDT · DOWN · Yesterday 18:40" value="-$15.00" bad /><Row text="TON / USDT · UP · Yesterday 16:21" value="+$8.50" /></div></>; }

function Wallet() { return <><section className="intro"><small>WALLET</small><h1>Move funds simply.</h1><p>TON and USDT on TRC-20 are supported.</p></section><section className="hero"><small>PORTFOLIO BALANCE</small><h1>$1,284.60</h1><div className="actions"><button>Deposit</button><button className="secondary">Withdraw</button></div></section><div className="list"><Row text="TON · TON network" value="184.20 TON" /><Row text="USDT · TRC-20" value="654.60 USDT" /></div></>; }

function Profile({ user, profile, signOut }) { return <><section className="profile"><div>{(profile?.display_name || "F").slice(0,1).toUpperCase()}</div><p><small>{profile?.telegram_username ? "@" + profile.telegram_username : "Flexar account"}</small><strong>{user ? profile?.display_name || "Connected account" : "Telegram authentication pending"}</strong></p>{user ? <button className="secondary" onClick={signOut}>Sign out</button> : <span className="pending-badge">PENDING</span>}</section><div className="list"><Row text="Notifications" value="Telegram + app" /><Row text="Security" value="Protected" /><Row text="Referral code" value={profile?.referral_code || "—"} /></div></>; }

function Row({ text, value, bad }) { return <div className="row"><span>{text}</span><strong className={bad ? "red" : "green"}>{value}</strong></div>; }
