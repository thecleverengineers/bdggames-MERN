import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, dateTime, inr } from "./api";
import "./styles.css";

const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setUser((await api("/auth/me")).user); } catch { setUser(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const value = useMemo(() => ({ user, setUser, refresh, loading }), [user, refresh, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Notice({ children }) { return <div className="notice"><span>◉</span>{children}</div>; }
function Spinner() { return <div className="spinner" aria-label="Loading" />; }
function Empty({ text = "Nothing to show yet" }) { return <div className="empty"><span>✦</span><p>{text}</p></div>; }

function PageHeader({ title, action }) {
  return <header className="page-header"><div><p className="eyebrow">Legend Games</p><h1>{title}</h1></div>{action}</header>;
}

function AppShell() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const logout = async () => { await api("/auth/logout", { method: "POST" }); setUser(null); navigate("/login"); };
  const nav = [
    ["/", "⌂", "Home"], ["/games", "◉", "Games"], ["/wallet", "◈", "Wallet"], ["/rewards", "✦", "Rewards"], ["/profile", "◌", "Me"],
  ];
  return <main className="app-shell">
    <div className="topbar">
      <NavLink to="/" className="brand"><img src="/images/headlogo.png" onError={(event) => { event.currentTarget.style.display = "none"; }} /><span>LEGEND<br /><b>GAMES</b></span></NavLink>
      <div className="topbar-actions"><NavLink className="balance-chip" to="/wallet">{inr(user.wallet.total)}</NavLink><button className="avatar" onClick={() => navigate("/profile")}>{user.name?.slice(0, 1).toUpperCase() || "L"}</button></div>
    </div>
    <section className="page-content"><Outlet /></section>
    <nav className="bottom-nav">{nav.map(([to, icon, label]) => <NavLink key={to} end={to === "/"} to={to}><span>{icon}</span><small>{label}</small></NavLink>)}{["admin", "manager"].includes(user.role) && <NavLink to="/admin"><span>▦</span><small>Admin</small></NavLink>}</nav>
    <button className="logout-fab" title="Sign out" onClick={logout}>↗</button>
  </main>;
}

function Protected() { const { user, loading } = useAuth(); if (loading) return <div className="loading-screen"><Spinner /></div>; return user ? <Outlet /> : <Navigate to="/login" replace />; }
function AdminProtected() { const { user } = useAuth(); return ["admin", "manager"].includes(user?.role) ? <Outlet /> : <Navigate to="/" replace />; }

function AuthPage({ register = false }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  if (user) return <Navigate to="/" replace />;
  const submit = async (event) => {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const data = register
        ? await api("/auth/register", { method: "POST", body: { name: form.get("name"), email: form.get("email") || undefined, phone: form.get("phone") || undefined, password: form.get("password"), referralCode: form.get("referralCode") || undefined } })
        : await api("/auth/login", { method: "POST", body: { identifier: form.get("identifier"), password: form.get("password") } });
      setUser(data.user); navigate("/");
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  };
  return <div className="auth-page"><div className="auth-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><img src="/images/headlogo.png" onError={(event) => event.currentTarget.remove()} /><h1>Play the<br /><em>legendary way.</em></h1><p>One secure account for games, rewards and your wallet.</p></div><form className="auth-card" onSubmit={submit}><p className="eyebrow">Welcome to Legend Games</p><h2>{register ? "Create your account" : "Sign in"}</h2>{error && <p className="error">{error}</p>}{register && <label>Full name<input name="name" autoComplete="name" required placeholder="Your name" /></label>}<label>{register ? "Email address" : "Email or phone"}<input name={register ? "email" : "identifier"} autoComplete={register ? "email" : "username"} required placeholder={register ? "you@example.com" : "you@example.com or 9876543210"} /></label>{register && <label>Phone number <span className="optional">optional</span><input name="phone" autoComplete="tel" placeholder="9876543210" /></label>}<label>Password<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength="10" required placeholder="At least 10 characters" /></label>{register && <label>Referral code <span className="optional">optional</span><input name="referralCode" placeholder="LGXXXXXX" /></label>}<button className="primary wide" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button><p className="auth-switch">{register ? "Already registered?" : "New to Legend Games?"} <NavLink to={register ? "/login" : "/register"}>{register ? "Sign in" : "Create account"}</NavLink></p></form></div>;
}

function HomePage() {
  const { user } = useAuth();
  const [games, setGames] = useState([]);
  useEffect(() => { api("/games").then((data) => setGames(data.games)).catch(() => {}); }, []);
  return <><section className="hero"><div className="hero-copy"><p className="eyebrow">WELCOME BACK</p><h1>Hello, {user.name?.split(" ")[0] || "Player"} <span>✦</span></h1><p>Choose a game, manage your wallet and collect today’s reward.</p><NavLink to="/games" className="primary">Explore games <span>→</span></NavLink></div><img src="/banner/BANNER_7.jpg" alt="Legend Games" /></section><Notice>Fair, transparent demo rounds are live now. Your round seed hash is shown before settlement.</Notice><section className="quick-stats"><NavLink to="/wallet"><span>Wallet balance</span><strong>{inr(user.wallet.total)}</strong><small>Manage funds →</small></NavLink><NavLink to="/rewards"><span>Daily reward</span><strong>₹5.00</strong><small>Collect now →</small></NavLink><NavLink to="/profile"><span>VIP level</span><strong>VIP {user.vipLevel}</strong><small>View profile →</small></NavLink></section><section className="section-heading"><div><p className="eyebrow">PLAY NOW</p><h2>Featured games</h2></div><NavLink to="/games">All games →</NavLink></section><div className="game-grid home-games">{games.slice(0, 3).map((game) => <NavLink className="game-card" to={`/games/${game.id}`} key={game.id}><img src={game.image} alt="" /><div><small>{game.category}</small><h3>{game.name}</h3><span>{game.external ? "Provider integration" : "Play now →"}</span></div></NavLink>)}</div></>;
}

function GamesPage() {
  const { game: paramGame } = useParams(); const { user, refresh } = useAuth();
  const [data, setData] = useState({ games: [], rounds: [] }); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [amount, setAmount] = useState(10); const [choice, setChoice] = useState("green");
  const reload = useCallback(() => api("/games").then(setData).catch((reason) => setMessage(reason.message)), []);
  useEffect(() => { reload(); const timer = setInterval(reload, 12_000); return () => clearInterval(timer); }, [reload]);
  const active = data.games.find((item) => item.id === paramGame) || data.games.find((item) => !item.external);
  useEffect(() => { if (active?.choices?.length) setChoice(active.choices[0]); }, [active?.id]);
  const round = data.rounds.find((item) => item.game === active?.id); const seconds = round ? Math.max(0, Math.ceil((new Date(round.closesAt) - Date.now()) / 1000)) : 0;
  const bet = async () => { setBusy(true); setMessage(""); try { const response = await api(`/games/${active.id}/bets`, { method: "POST", body: { selection: choice, amount: Number(amount) } }); setMessage(`Bet accepted for ${response.round.period}.`); await refresh(); reload(); } catch (reason) { setMessage(reason.message); } finally { setBusy(false); } };
  if (!active) return <div className="loading-screen"><Spinner /></div>;
  return <><PageHeader title="Games" action={<span className="mode-pill">Demo mode</span>} /><div className="game-tabs">{data.games.map((game) => <NavLink key={game.id} to={`/games/${game.id}`} className={({ isActive }) => isActive || (!paramGame && game.id === active.id) ? "active" : ""}>{game.name}</NavLink>)}</div><section className="game-play"><div className="round-panel"><div><p className="eyebrow">{active.category}</p><h2>{active.name}</h2><p>{active.external ? "This partner game needs a licensed provider credential before it can be launched." : "Choose your prediction before the round closes."}</p></div><img src={active.image} alt="" />{!active.external && <div className="round-status"><span>Period <b>{round?.period?.split("-").at(-1) || "—"}</b></span><strong>{seconds}s</strong><span>Seed <b>{round?.serverSeedHash?.slice(0, 10)}…</b></span></div>}</div>{active.external ? <div className="integration-card"><span>◌</span><h3>Provider connection required</h3><p>JILI, JDB and Aviator play links are intentionally disabled until a contract, provider API credentials and jurisdiction checks have been configured.</p></div> : <div className="bet-panel"><p className="eyebrow">PLACE A DEMO BET</p><div className="choice-grid">{active.choices.map((item) => <button key={item} className={choice === item ? `choice ${item}` : "choice"} onClick={() => setChoice(item)}>{item}</button>)}</div>{active.id === "five-d-1m" && <input value={choice} onChange={(event) => setChoice(event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="Enter five digits" maxLength="5" />}<div className="amount-row"><label>Stake<input type="number" min="10" step="10" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><div>{[10, 50, 100, 500].map((value) => <button key={value} onClick={() => setAmount(value)}>₹{value}</button>)}</div></div><button className="primary wide" disabled={busy || seconds === 0} onClick={bet}>{busy ? "Placing bet…" : `Bet ${inr(amount)}`}</button>{message && <p className={message.includes("accepted") ? "success" : "error"}>{message}</p>}<p className="balance-note">Available demo balance: {inr(user.wallet.total)}</p></div>}</section><section className="section-heading"><div><p className="eyebrow">CATALOGUE</p><h2>All games</h2></div></section><div className="game-grid">{data.games.map((game) => <NavLink className="game-card" to={`/games/${game.id}`} key={game.id}><img src={game.image} alt="" /><div><small>{game.category}</small><h3>{game.name}</h3><span>{game.external ? "Setup required" : "Open game →"}</span></div></NavLink>)}</div></>;
}

function WalletPage() {
  const { user, refresh } = useAuth();
  const [tab, setTab] = useState("deposit"); const [summary, setSummary] = useState(null); const [transactions, setTransactions] = useState([]); const [requests, setRequests] = useState([]); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => { const [wallet, ledger, payments] = await Promise.all([api("/wallet/summary"), api("/wallet/transactions"), api("/wallet/requests")]); setSummary(wallet); setTransactions(ledger.transactions); setRequests(payments.requests); }, []);
  useEffect(() => { reload().catch((reason) => setMessage(reason.message)); }, [reload]);
  const submit = async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setMessage("");
    try {
      if (tab === "deposit") await api("/wallet/deposits", { method: "POST", body: { amount: Number(form.get("amount")), channel: form.get("channel"), note: form.get("note") } });
      if (tab === "withdraw") await api("/wallet/withdrawals", { method: "POST", body: { amount: Number(form.get("amount")), channel: form.get("channel"), destination: { accountName: form.get("accountName"), upiId: form.get("upiId"), accountNumber: form.get("accountNumber") }, note: form.get("note") } });
      if (tab === "transfer") await api("/wallet/transfers", { method: "POST", body: { recipient: form.get("recipient"), amount: Number(form.get("amount")), note: form.get("note") } });
      setMessage(tab === "transfer" ? "Transfer complete." : "Your request is now awaiting review."); event.currentTarget.reset(); await refresh(); await reload();
    } catch (reason) { setMessage(reason.message); } finally { setBusy(false); }
  };
  return <><PageHeader title="Wallet" action={<NavLink to="/profile" className="text-action">Accounts →</NavLink>} /><section className="wallet-hero"><div><p>Available balance</p><strong>{inr(user.wallet.total)}</strong><span>Cash {inr(user.wallet.cash)} · Bonus {inr(user.wallet.bonus)}</span></div><span className="wallet-orb">◈</span></section>{summary && <div className="pending-row"><span>Pending deposits <b>{inr(summary.pending.deposit)}</b></span><span>Pending withdrawals <b>{inr(summary.pending.withdrawal)}</b></span></div>}<div className="wallet-tabs">{[["deposit", "Add funds"], ["withdraw", "Withdraw"], ["transfer", "Transfer"]].map(([id, label]) => <button key={id} onClick={() => { setTab(id); setMessage(""); }} className={tab === id ? "active" : ""}>{label}</button>)}</div><form className="transaction-form" onSubmit={submit}><p className="eyebrow">{tab === "deposit" ? "CREATE A DEPOSIT REQUEST" : tab === "withdraw" ? "REQUEST A WITHDRAWAL" : "SEND DEMO BALANCE"}</p>{tab === "transfer" && <label>Recipient email, phone or referral code<input name="recipient" required placeholder="LGXXXXXX" /></label>}<label>Amount<input name="amount" type="number" required min="10" step="10" placeholder="Minimum ₹10" /></label>{tab !== "transfer" && <label>Channel<select name="channel"><option value="manual">Manual review</option><option value="upi">UPI</option><option value="bank">Bank transfer</option><option value="crypto">Crypto</option></select></label>}{tab === "withdraw" && <div className="form-grid"><label>Account holder<input name="accountName" placeholder="Optional in demo" /></label><label>UPI ID<input name="upiId" placeholder="name@bank" /></label><label className="full">Account number<input name="accountNumber" placeholder="Optional in demo" /></label></div>}<label>Note <span className="optional">optional</span><input name="note" maxLength="140" placeholder="Reference or message" /></label><button className="primary wide" disabled={busy}>{busy ? "Submitting…" : tab === "deposit" ? "Create deposit request" : tab === "withdraw" ? "Request withdrawal" : "Send transfer"}</button>{message && <p className={message.includes("complete") || message.includes("awaiting") ? "success" : "error"}>{message}</p>}</form><section className="section-heading"><div><p className="eyebrow">ACTIVITY</p><h2>Recent transactions</h2></div></section>{transactions.length ? <div className="ledger">{transactions.map((item) => <div className="ledger-item" key={item._id}><span className={`ledger-icon ${item.direction}`}>{item.direction === "credit" ? "+" : "−"}</span><div><strong>{item.type.replaceAll("_", " ")}</strong><small>{item.description || item.reference} · {dateTime(item.createdAt)}</small></div><b className={item.direction}>{item.direction === "credit" ? "+" : "−"}{inr(item.amount)}</b></div>)}</div> : <Empty text="Your wallet activity will appear here." />}{requests.length > 0 && <><section className="section-heading"><div><p className="eyebrow">PAYMENT QUEUE</p><h2>Your requests</h2></div></section><div className="request-list">{requests.slice(0, 6).map((item) => <div key={item._id}><span className={`status ${item.status}`}>{item.status}</span><strong>{item.type} · {inr(item.amount)}</strong><small>{item.reference} · {dateTime(item.createdAt)}</small></div>)}</div></>}</>;
}

function RewardsPage() {
  const { refresh } = useAuth(); const [data, setData] = useState(null); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const reload = useCallback(() => api("/promotions").then(setData).catch((reason) => setMessage(reason.message)), []);
  useEffect(() => { reload(); }, [reload]);
  const claim = async () => { setBusy(true); try { const response = await api("/promotions/daily-checkin", { method: "POST" }); setMessage(`${inr(response.amount)} has been added to your wallet.`); await refresh(); reload(); } catch (reason) { setMessage(reason.message); } finally { setBusy(false); } };
  if (!data) return <div className="loading-screen"><Spinner /></div>;
  return <><PageHeader title="Rewards" /><section className="reward-hero"><div><p className="eyebrow">DAILY CHECK-IN</p><h2>Come back daily.<br />Grow your balance.</h2><p>Claim a demo reward once every calendar day.</p><button className="primary" disabled={busy || data.dailyCheckin.claimed} onClick={claim}>{data.dailyCheckin.claimed ? "Claimed today ✓" : busy ? "Claiming…" : `Claim ${inr(data.dailyCheckin.amount)}`}</button>{message && <p className={message.includes("added") ? "success" : "error"}>{message}</p>}</div><span>✦</span></section><div className="reward-grid"><article><span>◌</span><p className="eyebrow">INVITE FRIENDS</p><h3>Share your code</h3><strong>{data.referral.code}</strong><p>Every valid signup earns {inr(data.referral.rewardPerSignup)} in demo credits.</p><small>{data.referral.signups} signup{data.referral.signups === 1 ? "" : "s"} so far</small></article><article><span>♛</span><p className="eyebrow">VIP STATUS</p><h3>VIP {data.vipLevel}</h3><p>VIP history and tier rules are ready for configuration in the promotion module.</p><NavLink to="/profile">View profile →</NavLink></article></div><Notice>Rewards are recorded to your wallet ledger, so you can always trace every credit.</Notice></>;
}

function ProfilePage() {
  const { user, setUser, refresh } = useAuth(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const update = async (event) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { const data = await api("/auth/me", { method: "PATCH", body: { name: form.get("name"), avatar: form.get("avatar") } }); setUser(data.user); setMessage("Profile updated."); } catch (reason) { setMessage(reason.message); } finally { setBusy(false); } };
  const password = async (event) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); try { await api("/auth/change-password", { method: "POST", body: { currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") } }); event.currentTarget.reset(); setMessage("Password updated."); await refresh(); } catch (reason) { setMessage(reason.message); } finally { setBusy(false); } };
  return <><PageHeader title="My profile" /><section className="profile-card"><span className="profile-avatar">{user.name?.slice(0, 1).toUpperCase()}</span><div><h2>{user.name}</h2><p>{user.email || user.phone}</p><span className={`status ${user.kyc.status}`}>KYC: {user.kyc.status.replaceAll("_", " ")}</span></div></section><form className="transaction-form" onSubmit={update}><p className="eyebrow">PERSONAL DETAILS</p><label>Name<input name="name" defaultValue={user.name} required /></label><label>Avatar image URL <span className="optional">optional</span><input name="avatar" type="url" defaultValue={user.avatar} placeholder="https://…" /></label><div className="readonly-grid"><span>Referral code<b>{user.referralCode}</b></span><span>VIP level<b>{user.vipLevel}</b></span><span>Account type<b>{user.role}</b></span><span>Joined<b>{new Date(user.createdAt).toLocaleDateString("en-IN")}</b></span></div><button className="primary wide" disabled={busy}>Save profile</button>{message && <p className={message.includes("updated") ? "success" : "error"}>{message}</p>}</form><form className="transaction-form secondary-form" onSubmit={password}><p className="eyebrow">SECURITY</p><label>Current password<input name="currentPassword" type="password" required /></label><label>New password<input name="newPassword" type="password" minLength="10" required /></label><button className="outline wide" disabled={busy}>Change password</button></form></>;
}

function AdminPage() {
  const [data, setData] = useState(null); const [requests, setRequests] = useState([]); const [users, setUsers] = useState([]); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => { const [dashboard, payments, people] = await Promise.all([api("/admin/dashboard"), api("/admin/payment-requests"), api("/admin/users")]); setData(dashboard); setRequests(payments.requests); setUsers(people.users); }, []);
  useEffect(() => { reload().catch((reason) => setMessage(reason.message)); }, [reload]);
  const review = async (id, decision) => { setBusy(true); try { await api(`/admin/payment-requests/${id}/review`, { method: "POST", body: { decision } }); setMessage("Payment request reviewed."); reload(); } catch (reason) { setMessage(reason.message); } finally { setBusy(false); } };
  if (!data) return <div className="loading-screen"><Spinner /></div>;
  return <><PageHeader title="Admin console" action={<span className="mode-pill">Operations</span>} /><div className="admin-stats"><article><span>Players</span><strong>{data.users}</strong></article><article><span>Open bets</span><strong>{data.openBets}</strong></article><article><span>Pending deposits</span><strong>{data.payments.deposit?.count || 0}</strong><small>{inr(data.payments.deposit?.amount)}</small></article><article><span>Pending withdrawals</span><strong>{data.payments.withdrawal?.count || 0}</strong><small>{inr(data.payments.withdrawal?.amount)}</small></article></div>{message && <p className={message.includes("reviewed") ? "success" : "error"}>{message}</p>}<section className="section-heading"><div><p className="eyebrow">REVIEW QUEUE</p><h2>Pending payments</h2></div></section>{requests.length ? <div className="admin-list">{requests.map((request) => <article key={request._id}><div><span className={`status ${request.type}`}>{request.type}</span><h3>{inr(request.amount)} <small>{request.channel}</small></h3><p>{request.user?.name || request.user?.phone} · {request.reference}</p><small>{dateTime(request.createdAt)}</small></div><div className="review-buttons"><button className="approve" disabled={busy} onClick={() => review(request._id, "approve")}>Approve</button><button className="reject" disabled={busy} onClick={() => review(request._id, "reject")}>Reject</button></div></article>)}</div> : <Empty text="No pending payment requests." />}<section className="section-heading"><div><p className="eyebrow">RECENT ACCOUNTS</p><h2>Players</h2></div></section><div className="admin-list users">{users.slice(0, 10).map((person) => <article key={person._id}><div className="user-line"><span className="avatar small">{person.name?.slice(0, 1) || "P"}</span><div><h3>{person.name}</h3><p>{person.email || person.phone} · {person.role}</p></div></div><div><strong>{inr(person.wallet?.cash + person.wallet?.bonus)}</strong><small className={`status ${person.status}`}>{person.status}</small></div></article>)}</div></>;
}

function App() {
  return <BrowserRouter><AuthProvider><Routes><Route path="/login" element={<AuthPage />} /><Route path="/register" element={<AuthPage register />} /><Route element={<Protected />}><Route element={<AppShell />}><Route path="/" element={<HomePage />} /><Route path="/games" element={<GamesPage />} /><Route path="/games/:game" element={<GamesPage />} /><Route path="/wallet" element={<WalletPage />} /><Route path="/rewards" element={<RewardsPage />} /><Route path="/profile" element={<ProfilePage />} /><Route element={<AdminProtected />}><Route path="/admin" element={<AdminPage />} /></Route></Route></Route><Route path="*" element={<Navigate to="/" replace />} /></Routes></AuthProvider></BrowserRouter>;
}

import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
