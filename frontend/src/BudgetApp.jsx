import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, ArrowDownUp, TrendingUp, Target, Plus, Trash2, X,
  Wallet, ArrowUpRight, ArrowDownRight, Repeat, Briefcase, Home,
  PiggyBank, AlertTriangle, Settings, Sparkles, Check, Search, Pencil,
  Download, Upload, ChevronLeft, ChevronRight, Lightbulb, Landmark, Gauge,
  Bell, BellRing, Users, LogOut, FileUp
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { storage, onRemoteUpdate, startSync, stopSync } from "./api";
import { push } from "./push";
import DatePicker from "./DatePicker";
import CsvImport from "./CsvImport";
import Household from "./Household";

// ---------- helpers ----------
const fmtEUR = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const fmtEURc = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n || 0);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabelShort = (d) => d.toLocaleDateString("nl-NL", { month: "short" });
const monthLabelLong = (d) => d.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
const uid = () => Math.random().toString(36).slice(2, 10);
const num = (v) => parseFloat(String(v).replace(",", ".")) || 0;
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const CATS = {
  prive: {
    uitgave: ["Wonen", "Boodschappen", "Vervoer", "Verzekeringen", "Abonnementen", "Vrije tijd", "Zorg", "Overig"],
    inkomst: ["Salaris", "Toeslagen", "Cadeau", "Overig"],
    sparen: ["Naar spaarrekening", "Van spaarrekening", "Overig"],
  },
  zakelijk: {
    uitgave: ["Software & tools", "Marketing", "Kantoor", "Belasting & BTW", "Verzekeringen", "Uitbesteding", "Overig"],
    inkomst: ["Freelance", "Project", "Overig"],
    sparen: ["Naar spaarrekening", "Van spaarrekening", "Overig"],
  },
};
const DEFAULTS = { reservePct: 35, reserveOn: true };

function seedData() {
  const t = []; const now = new Date();
  for (let m = 5; m >= 0; m--) {
    const base = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const day = (d) => new Date(base.getFullYear(), base.getMonth(), d).toISOString();
    t.push({ id: uid(), type: "inkomst", scope: "prive", amount: 3200, category: "Salaris", date: day(24), description: "Salaris", recurring: true });
    t.push({ id: uid(), type: "uitgave", scope: "prive", amount: 1250, category: "Wonen", date: day(1), description: "Huur", recurring: true, reminder: { enabled: true, daysBefore: 3 } });
    t.push({ id: uid(), type: "uitgave", scope: "prive", amount: 410 + m * 8, category: "Boodschappen", date: day(8), description: "Boodschappen", recurring: false });
    t.push({ id: uid(), type: "uitgave", scope: "prive", amount: 65, category: "Abonnementen", date: day(3), description: "Streaming & telefoon", recurring: true });
    t.push({ id: uid(), type: "uitgave", scope: "prive", amount: 120, category: "Vrije tijd", date: day(12), description: "Uit eten", recurring: false });
    t.push({ id: uid(), type: "inkomst", scope: "zakelijk", amount: 2400 + m * 150, category: "Freelance", date: day(15), description: "Webdesign opdracht", recurring: false });
    t.push({ id: uid(), type: "uitgave", scope: "zakelijk", amount: 95, category: "Software & tools", date: day(2), description: "Hosting & tools", recurring: true });
    t.push({ id: uid(), type: "uitgave", scope: "zakelijk", amount: 60, category: "Marketing", date: day(10), description: "Advertenties", recurring: false });
  }
  const goals = [
    { id: uid(), name: "Buffer / noodfonds", target: 10000, saved: 6200, scope: "prive", deadline: "" },
    { id: uid(), name: "Reis Suriname", target: 4500, saved: 1800, scope: "prive", deadline: `${now.getFullYear()}-07-25` },
    { id: uid(), name: "Nieuwe laptop", target: 2200, saved: 900, scope: "zakelijk", deadline: "" },
  ];
  const budgets = { "prive::Boodschappen": 450, "prive::Vrije tijd": 200, "prive::Abonnementen": 80, "zakelijk::Marketing": 150 };
  return { transactions: t, goals, budgets, settings: { ...DEFAULTS }, deleted: {} };
}

// ============================================================
export default function BudgetApp({ onLogout }) {
  const [data, setData] = useState({ transactions: [], goals: [], budgets: {}, settings: { ...DEFAULTS }, deleted: {} });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [scope, setScope] = useState("alles");
  const [monthOffset, setMonthOffset] = useState(0);
  const [txModal, setTxModal] = useState(false);
  const [editTx, setEditTx] = useState(null);
  const [goalModal, setGoalModal] = useState(false);
  const [savingGoal, setSavingGoal] = useState(null);
  const [budgetModal, setBudgetModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [csvModal, setCsvModal] = useState(false);
  const [hhModal, setHhModal] = useState(false);
  const [toast, setToast] = useState("");

  const applyData = (d) => setData({
    transactions: d.transactions || [], goals: d.goals || [],
    budgets: d.budgets || {}, settings: { ...DEFAULTS, ...(d.settings || {}) }, deleted: d.deleted || {},
  });

  useEffect(() => {
    onRemoteUpdate(applyData);
    (async () => {
      try { const r = await storage.get("budget"); if (r?.value) applyData(JSON.parse(r.value)); }
      catch (e) { console.error(e); }
      setLoading(false);
    })();
    const syncId = startSync(15000);
    return () => stopSync(syncId);
  }, []);

  const persist = async (next) => {
    setData(next);
    try { await storage.set("budget", JSON.stringify(next)); } catch (e) { console.error(e); }
  };
  const reloadData = async () => { try { const r = await storage.get("budget"); if (r?.value) applyData(JSON.parse(r.value)); } catch (e) { console.error(e); } };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const selMonth = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const selKey = monthKey(selMonth);
  const prevKey = monthKey(new Date(selMonth.getFullYear(), selMonth.getMonth() - 1, 1));
  const isCurMonth = monthOffset === 0;

  // live = niet-verwijderd
  const tx = useMemo(() => {
    let list = data.transactions.filter((x) => !data.deleted?.[x.id]);
    if (scope !== "alles") list = list.filter((x) => x.scope === scope);
    return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [data.transactions, data.deleted, scope]);

  const liveGoals = useMemo(
    () => data.goals.filter((g) => !data.deleted?.[g.id] && (scope === "alles" || g.scope === scope)),
    [data.goals, data.deleted, scope]
  );

  const totals = useMemo(() => {
    let saldo = 0, mIn = 0, mUit = 0, prevUit = 0;
    const catMap = {};
    for (const x of tx) {
      if (x.type === "sparen") continue;   // overboeking tussen eigen rekeningen → neutraal
      saldo += x.type === "inkomst" ? x.amount : -x.amount;
      const k = monthKey(new Date(x.date));
      if (k === selKey) {
        if (x.type === "inkomst") mIn += x.amount;
        else { mUit += x.amount; catMap[x.category] = (catMap[x.category] || 0) + x.amount; }
      }
      if (k === prevKey && x.type === "uitgave") prevUit += x.amount;
    }
    const cats = Object.entries(catMap).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value);
    return { saldo, mIn, mUit, net: mIn - mUit, cats, prevUit, catMap };
  }, [tx, selKey, prevKey]);

  const reserve = useMemo(() => {
    if (!data.settings.reserveOn) return { amount: 0, besteedbaar: totals.saldo, winst: 0 };
    const yr = new Date().getFullYear();
    let ink = 0, uit = 0;
    for (const x of data.transactions) {
      if (data.deleted?.[x.id] || x.scope !== "zakelijk" || x.type === "sparen") continue;
      if (new Date(x.date).getFullYear() !== yr) continue;
      if (x.type === "inkomst") ink += x.amount; else uit += x.amount;
    }
    const winst = Math.max(0, ink - uit);
    const amount = Math.round(winst * data.settings.reservePct / 100);
    return { amount, besteedbaar: totals.saldo - amount, winst };
  }, [data.transactions, data.deleted, data.settings, totals.saldo]);

  const chartData = useMemo(() => {
    const hist = []; const now = new Date();
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const k = monthKey(d); let net = 0;
      for (const x of tx) if (x.type !== "sparen" && monthKey(new Date(x.date)) === k) net += x.type === "inkomst" ? x.amount : -x.amount;
      hist.push({ label: monthLabelShort(d), net });
    }
    let recurNet = 0;
    for (const x of tx) if (x.recurring && x.type !== "sparen") recurNet += x.type === "inkomst" ? x.amount : -x.amount;
    const last3avg = hist.slice(-3).reduce((s, h) => s + h.net, 0) / 3;
    const monthlyEst = Math.round((recurNet + last3avg) / 2);
    const rows = hist.map((h) => ({ label: h.label, saldo: null, prognose: null }));
    let acc = totals.saldo;
    for (let i = hist.length - 1; i >= 0; i--) { rows[i].saldo = acc; acc -= hist[i].net; }
    rows[hist.length - 1].prognose = totals.saldo;
    let proj = totals.saldo;
    for (let m = 1; m <= 6; m++) { proj += monthlyEst; rows.push({ label: monthLabelShort(new Date(now.getFullYear(), now.getMonth() + m, 1)), saldo: null, prognose: proj }); }
    return { rows, monthlyEst, recurNet, last3avg };
  }, [tx, totals.saldo]);

  const insights = useMemo(() => {
    const out = [];
    if (totals.net < 0) out.push({ t: "warn", m: `Je geeft deze maand ${fmtEUR(-totals.net)} meer uit dan er binnenkomt.` });
    if (totals.prevUit > 0) {
      const diff = totals.mUit - totals.prevUit; const pct = Math.round(diff / totals.prevUit * 100);
      if (Math.abs(pct) >= 8) out.push({ t: diff > 0 ? "warn" : "good", m: `Je uitgaven liggen ${Math.abs(pct)}% ${diff > 0 ? "hoger" : "lager"} dan vorige maand.` });
    }
    if (totals.mIn > 0 && totals.net > 0) out.push({ t: "good", m: `Je spaarde deze maand ${Math.round(totals.net / totals.mIn * 100)}% van je inkomsten.` });
    for (const [key, b] of Object.entries(data.budgets)) {
      const [bs, bc] = key.split("::");
      if (scope !== "alles" && bs !== scope) continue;
      const spent = totals.catMap[bc] || 0;
      if (b > 0 && spent > b) out.push({ t: "warn", m: `Budget "${bc}" overschreden: ${fmtEUR(spent)} van ${fmtEUR(b)}.` });
    }
    return out.slice(0, 4);
  }, [totals, data.budgets, scope]);

  // ---------- acties ----------
  const addTx = (t) => persist({ ...data, transactions: [...data.transactions, { ...t, id: uid() }] });
  const updateTx = (t) => persist({ ...data, transactions: data.transactions.map((x) => x.id === t.id ? t : x) });
  const delTx = (id) => persist({ ...data, transactions: data.transactions.filter((x) => x.id !== id), deleted: { ...data.deleted, [id]: new Date().toISOString() } });
  const addGoal = (g) => persist({ ...data, goals: [...data.goals, { ...g, id: uid() }] });
  const delGoal = (id) => persist({ ...data, goals: data.goals.filter((x) => x.id !== id), deleted: { ...data.deleted, [id]: new Date().toISOString() } });
  const topUpGoal = (id, amt) => persist({ ...data, goals: data.goals.map((g) => g.id === id ? { ...g, saved: g.saved + amt } : g) });
  const saveBudgets = (b) => persist({ ...data, budgets: b });
  const saveSettings = (s) => persist({ ...data, settings: s });
  const importTransactions = (incoming) => { persist({ ...data, transactions: [...data.transactions, ...incoming] }); flash(`${incoming.length} transacties geïmporteerd.`); };
  const resetAll = () => { if (confirm("Alles wissen? Dit kan niet ongedaan worden gemaakt.")) persist({ transactions: [], goals: [], budgets: {}, settings: { ...DEFAULTS }, deleted: {} }); };

  const bookRecurring = () => {
    const sigs = {};
    for (const x of data.transactions) if (x.recurring && !data.deleted?.[x.id]) {
      const s = `${x.type}|${x.scope}|${x.category}|${x.description}|${x.amount}`;
      if (!sigs[s] || new Date(x.date) > new Date(sigs[s].date)) sigs[s] = x;
    }
    const existing = new Set();
    for (const x of data.transactions) if (!data.deleted?.[x.id] && monthKey(new Date(x.date)) === selKey) existing.add(`${x.type}|${x.scope}|${x.category}|${x.description}|${x.amount}`);
    const toAdd = [];
    for (const [s, tpl] of Object.entries(sigs)) {
      if (existing.has(s)) continue;
      const d = new Date(tpl.date); const day = Math.min(d.getDate(), 28);
      toAdd.push({ ...tpl, id: uid(), date: new Date(selMonth.getFullYear(), selMonth.getMonth(), day).toISOString() });
    }
    if (toAdd.length === 0) { flash("Vaste lasten staan al geboekt voor deze maand."); return; }
    persist({ ...data, transactions: [...data.transactions, ...toAdd] });
    flash(`${toAdd.length} vaste ${toAdd.length === 1 ? "post" : "posten"} geboekt.`);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `budget-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url); flash("Back-up gedownload.");
  };
  const importData = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { const d = JSON.parse(e.target.result); applyData(d); persist({ transactions: d.transactions || [], goals: d.goals || [], budgets: d.budgets || {}, settings: { ...DEFAULTS, ...(d.settings || {}) }, deleted: d.deleted || {} }); setSettingsModal(false); flash("Back-up geladen."); }
      catch { flash("Kon dit bestand niet lezen."); }
    };
    reader.readAsText(file);
  };

  if (loading) return <Shell><div style={{ padding: 80, textAlign: "center", color: "var(--muted)" }}>Laden…</div></Shell>;
  const empty = data.transactions.length === 0 && data.goals.length === 0;

  return (
    <Shell>
      <header className="bh">
        <div>
          <div className="brand"><Wallet size={18} /> <span>Budgetboek</span></div>
          <h1>Goedendag</h1>
          <p className="sub">{new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <div className="topright">
          <button className="gear" onClick={() => setSettingsModal(true)} aria-label="Instellingen"><Settings size={17} /></button>
          <div className="scope">
            {["alles", "prive", "zakelijk"].map((s) => (
              <button key={s} className={scope === s ? "chip on" : "chip"} onClick={() => setScope(s)}>
                {s === "alles" ? "Alles" : s === "prive" ? <><Home size={13} /> Privé</> : <><Briefcase size={13} /> Zakelijk</>}
              </button>
            ))}
          </div>
        </div>
      </header>

      {empty ? (
        <div className="card empty">
          <Sparkles size={26} style={{ color: "var(--gold)" }} />
          <h2>Begin met een schone lei</h2>
          <p>Voeg je eerste transactie toe, importeer een bankafschrift, of laad voorbeelddata om de app meteen in actie te zien.</p>
          <div className="row">
            <button className="btn primary" onClick={() => setTxModal(true)}><Plus size={16} /> Transactie</button>
            <button className="btn ghost" onClick={() => setCsvModal(true)}><FileUp size={16} /> Importeer CSV</button>
            <button className="btn ghost" onClick={() => persist(seedData())}>Voorbeelddata</button>
          </div>
        </div>
      ) : (
        <>
          <nav className="tabs">
            {[["dashboard", "Overzicht", LayoutDashboard], ["transacties", "Transacties", ArrowDownUp],
              ["budget", "Budget", Gauge], ["forecast", "Forecast", TrendingUp], ["doelen", "Doelen", Target]].map(([k, label, Icon]) => (
              <button key={k} className={view === k ? "tab on" : "tab"} onClick={() => setView(k)}><Icon size={16} /> {label}</button>
            ))}
          </nav>

          {(view === "dashboard" || view === "budget") && (
            <div className="monthnav">
              <button onClick={() => setMonthOffset(monthOffset - 1)} aria-label="Vorige"><ChevronLeft size={18} /></button>
              <span>{monthLabelLong(selMonth)}{isCurMonth && " · nu"}</span>
              <button onClick={() => setMonthOffset(Math.min(0, monthOffset + 1))} disabled={isCurMonth} aria-label="Volgende"><ChevronRight size={18} /></button>
            </div>
          )}

          {view === "dashboard" && <Dashboard totals={totals} reserve={reserve} reserveOn={data.settings.reserveOn} chartData={chartData} goals={liveGoals} insights={insights} setView={setView} />}
          {view === "transacties" && <Transacties tx={tx} onAdd={() => setTxModal(true)} onEdit={setEditTx} onDel={delTx} onBookRecurring={bookRecurring} onOpenCsv={() => setCsvModal(true)} />}
          {view === "budget" && <Budget budgets={data.budgets} catMap={totals.catMap} scope={scope} onEdit={() => setBudgetModal(true)} />}
          {view === "forecast" && <Forecast chartData={chartData} totals={totals} />}
          {view === "doelen" && <Doelen goals={liveGoals} onAdd={() => setGoalModal(true)} onDel={delGoal} onTopUp={setSavingGoal} />}
        </>
      )}

      {!empty && <button className="fab" onClick={() => setTxModal(true)} aria-label="Toevoegen"><Plus size={24} /></button>}
      {toast && <div className="toast">{toast}</div>}

      {txModal && <TxModal onClose={() => setTxModal(false)} onSave={(t) => { addTx(t); setTxModal(false); }} defScope={scope === "alles" ? "prive" : scope} />}
      {editTx && <TxModal initial={editTx} onClose={() => setEditTx(null)} onSave={(t) => { updateTx(t); setEditTx(null); }} defScope={editTx.scope} />}
      {goalModal && <GoalModal onClose={() => setGoalModal(false)} onSave={(g) => { addGoal(g); setGoalModal(false); }} defScope={scope === "alles" ? "prive" : scope} />}
      {savingGoal && <TopUpModal goal={data.goals.find((g) => g.id === savingGoal)} onClose={() => setSavingGoal(null)} onSave={(amt) => { topUpGoal(savingGoal, amt); setSavingGoal(null); }} />}
      {budgetModal && <BudgetModal budgets={data.budgets} scope={scope === "alles" ? "prive" : scope} onClose={() => setBudgetModal(false)} onSave={(b) => { saveBudgets(b); setBudgetModal(false); }} />}
      {settingsModal && <SettingsModal settings={data.settings} onClose={() => setSettingsModal(false)} onSave={saveSettings} onExport={exportData} onImport={importData} onReset={resetAll} onLogout={onLogout} onOpenHousehold={() => { setSettingsModal(false); setHhModal(true); }} />}
      {csvModal && <CsvImport existing={data.transactions.filter((x) => !data.deleted?.[x.id])} onImport={importTransactions} onClose={() => setCsvModal(false)} />}
      {hhModal && <Household onClose={() => setHhModal(false)} onChanged={reloadData} />}
    </Shell>
  );
}

// ============================================================ DASHBOARD
function Dashboard({ totals, reserve, reserveOn, chartData, goals, insights, setView }) {
  return (
    <div className="grid">
      <div className="card hero">
        <span className="lbl">Totaal saldo</span>
        <div className="big">{fmtEUR(totals.saldo)}</div>
        {reserveOn && reserve.amount > 0 && <div className="besteedbaar">Besteedbaar na reservering: <strong>{fmtEUR(reserve.besteedbaar)}</strong></div>}
        <div className="spark">
          <ResponsiveContainer width="100%" height={56}>
            <AreaChart data={chartData.rows.filter((r) => r.saldo != null)}>
              <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--gold)" stopOpacity={0.5} /><stop offset="100%" stopColor="var(--gold)" stopOpacity={0} /></linearGradient></defs>
              <Area type="monotone" dataKey="saldo" stroke="var(--gold)" strokeWidth={2} fill="url(#g1)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="card insights">
          <span className="lbl"><Lightbulb size={14} style={{ color: "var(--gold)" }} /> Inzichten</span>
          <div className="ins-list">{insights.map((i, n) => (<div key={n} className={`ins ${i.t}`}><span className="dotc" />{i.m}</div>))}</div>
        </div>
      )}

      <div className="duo">
        <div className="card stat"><span className="lbl"><ArrowUpRight size={14} style={{ color: "var(--pos)" }} /> Inkomsten</span><div className="num pos">{fmtEUR(totals.mIn)}</div></div>
        <div className="card stat"><span className="lbl"><ArrowDownRight size={14} style={{ color: "var(--neg)" }} /> Uitgaven</span><div className="num neg">{fmtEUR(totals.mUit)}</div></div>
      </div>

      <div className="card">
        <span className="lbl">Resultaat deze maand</span>
        <div className="num" style={{ color: totals.net >= 0 ? "var(--pos)" : "var(--neg)" }}>{totals.net >= 0 ? "+" : ""}{fmtEUR(totals.net)}</div>
        {totals.prevUit > 0 && <p className="muted" style={{ marginTop: 6 }}>Vorige maand gaf je {fmtEUR(totals.prevUit)} uit.</p>}
      </div>

      {reserveOn && reserve.amount > 0 && (
        <div className="card">
          <span className="lbl"><Landmark size={14} style={{ color: "var(--green)" }} /> Reservering belasting & BTW</span>
          <div className="num" style={{ color: "var(--green)" }}>{fmtEUR(reserve.amount)}</div>
          <p className="muted">Indicatie: opzij gezet voor je zakelijke winst dit jaar ({fmtEUR(reserve.winst)}). Geen fiscaal advies — pas het percentage aan via instellingen.</p>
        </div>
      )}

      <div className="card">
        <div className="ch"><span className="lbl">Grootste uitgaven</span></div>
        {totals.cats.length === 0 ? <p className="muted">Geen uitgaven deze maand.</p> : (
          <div className="catlist">
            {totals.cats.slice(0, 5).map((c) => (
              <div key={c.name} className="catrow">
                <div className="cattop"><span>{c.name}</span><strong>{fmtEUR(c.value)}</strong></div>
                <div className="bar"><div className="fill" style={{ width: `${Math.round((c.value / totals.mUit) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="ch"><span className="lbl">Spaardoelen</span><button className="lnk" onClick={() => setView("doelen")}>Bekijk alles →</button></div>
        {goals.length === 0 ? <p className="muted">Nog geen doelen ingesteld.</p> : goals.slice(0, 3).map((g) => {
          const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
          return (<div key={g.id} className="goalmini"><div className="cattop"><span><PiggyBank size={13} /> {g.name}</span><strong>{pct}%</strong></div><div className="bar"><div className="fill gold" style={{ width: `${pct}%` }} /></div></div>);
        })}
      </div>
    </div>
  );
}

// ============================================================ TRANSACTIES
function Transacties({ tx, onAdd, onEdit, onDel, onBookRecurring, onOpenCsv }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("alles");
  const filtered = useMemo(() => tx.filter((x) => {
    if (filter !== "alles" && x.type !== filter) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (x.description || "").toLowerCase().includes(s) || x.category.toLowerCase().includes(s);
  }), [tx, q, filter]);
  const groups = useMemo(() => {
    const g = {};
    for (const x of filtered) { const k = new Date(x.date).toLocaleDateString("nl-NL", { month: "long", year: "numeric" }); (g[k] = g[k] || []).push(x); }
    return g;
  }, [filtered]);

  return (
    <div className="grid">
      <div className="card">
        <div className="searchbar"><Search size={16} className="si" /><input placeholder="Zoek op naam of categorie…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="filterrow">
          <div className="seg sm" style={{ flex: 1, marginBottom: 0 }}>
            {[["alles", "Alles"], ["inkomst", "In"], ["uitgave", "Uit"], ["sparen", "Spaar"]].map(([k, l]) => (<button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>))}
          </div>
          <button className="btn small ghost" onClick={onBookRecurring} title="Vaste lasten boeken"><Repeat size={14} /> Vaste lasten</button>
          <button className="btn small ghost" onClick={onOpenCsv} title="Bankafschrift importeren"><FileUp size={14} /> CSV</button>
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 && <p className="muted">Geen transacties gevonden.</p>}
        {Object.entries(groups).map(([month, items]) => (
          <div key={month} className="txgroup">
            <div className="txmonth">{month}</div>
            {items.map((x) => (
              <div key={x.id} className="txrow" onClick={() => onEdit(x)}>
                <div className={`tic ${x.type}`}>{x.type === "inkomst" ? <ArrowUpRight size={16} /> : x.type === "sparen" ? <PiggyBank size={16} /> : <ArrowDownRight size={16} />}</div>
                <div className="txmid">
                  <div className="txdesc">{x.description || x.category}
                    {x.recurring && <span className="pill"><Repeat size={10} /> mnd</span>}
                    {x.reminder?.enabled && <span className="pill gold"><Bell size={10} /> {x.reminder.daysBefore}d</span>}
                  </div>
                  <div className="txmeta">{x.category} · {x.scope === "prive" ? "Privé" : "Zakelijk"} · {fmtDate(x.date)}</div>
                </div>
                <div className={`txamt ${x.type === "inkomst" ? "pos" : x.type === "sparen" ? "spaar" : "neg"}`}>{x.type === "inkomst" ? "+" : x.type === "sparen" ? "" : "−"}{fmtEURc(x.amount)}</div>
                <button className="del" onClick={(e) => { e.stopPropagation(); onDel(x.id); }} aria-label="Verwijder"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        ))}
        <p className="hint"><Pencil size={11} /> Tik op een transactie om te bewerken.</p>
      </div>
    </div>
  );
}

// ============================================================ BUDGET
function Budget({ budgets, catMap, scope, onEdit }) {
  const rows = Object.entries(budgets)
    .filter(([k]) => scope === "alles" || k.startsWith(scope + "::"))
    .map(([k, limit]) => { const [s, c] = k.split("::"); return { s, c, limit, spent: catMap[c] || 0 }; })
    .sort((a, b) => (b.spent / b.limit) - (a.spent / a.limit));
  return (
    <div className="grid">
      <div className="card">
        <div className="ch"><span className="lbl">Maandbudgetten</span><button className="btn small primary" onClick={onEdit}><Pencil size={13} /> Instellen</button></div>
        {rows.length === 0 ? <p className="muted">Nog geen budgetten ingesteld. Tik op "Instellen" om limieten per categorie te bepalen.</p> : (
          <div className="catlist" style={{ gap: 16 }}>
            {rows.map((r) => {
              const pct = r.limit > 0 ? Math.round(r.spent / r.limit * 100) : 0;
              const over = r.spent > r.limit;
              return (
                <div key={r.s + r.c} className="catrow">
                  <div className="cattop">
                    <span>{r.c} {scope === "alles" && <em className="scopetag">{r.s === "prive" ? "privé" : "zakelijk"}</em>}</span>
                    <strong style={{ color: over ? "var(--neg)" : "var(--ink)" }}>{fmtEUR(r.spent)} / {fmtEUR(r.limit)}</strong>
                  </div>
                  <div className="bar"><div className="fill" style={{ width: `${Math.min(100, pct)}%`, background: over ? "var(--neg)" : pct > 80 ? "var(--gold)" : "var(--green)" }} /></div>
                  {over && <span className="overmsg"><AlertTriangle size={11} /> {fmtEUR(r.spent - r.limit)} over budget</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================ FORECAST
function Forecast({ chartData, totals }) {
  const est = chartData.monthlyEst;
  const last = chartData.rows[chartData.rows.length - 1];
  return (
    <div className="grid">
      <div className="card">
        <span className="lbl">Verwacht saldo over 6 maanden</span>
        <div className="big" style={{ color: last.prognose >= totals.saldo ? "var(--pos)" : "var(--neg)" }}>{fmtEUR(last.prognose)}</div>
        <p className="muted">Geschat maandresultaat: <strong style={{ color: est >= 0 ? "var(--pos)" : "var(--neg)" }}>{est >= 0 ? "+" : ""}{fmtEUR(est)}</strong>. Gemiddelde van je vaste posten ({fmtEUR(chartData.recurNet)}) en je werkelijke resultaat van de laatste 3 maanden ({fmtEUR(Math.round(chartData.last3avg))}).</p>
      </div>
      <div className="card">
        <span className="lbl">Saldo-verloop & prognose</span>
        <div style={{ height: 260, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData.rows} margin={{ left: -10, right: 6, top: 6 }}>
              <defs><linearGradient id="gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--green)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--green)" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v) => fmtEUR(v)} contentStyle={{ borderRadius: 12, border: "1px solid var(--line)", fontSize: 13, fontFamily: "Hanken Grotesk" }} />
              <Area type="monotone" dataKey="saldo" name="Werkelijk" stroke="var(--green)" strokeWidth={2.5} fill="url(#gh)" connectNulls />
              <Area type="monotone" dataKey="prognose" name="Prognose" stroke="var(--gold)" strokeWidth={2.5} strokeDasharray="5 4" fill="none" connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="legend"><span><i className="dot green" /> Werkelijk</span><span><i className="dot gold" /> Prognose</span></div>
      </div>
    </div>
  );
}

// ============================================================ DOELEN
function Doelen({ goals, onAdd, onDel, onTopUp }) {
  const monthsTo = (deadline) => { if (!deadline) return null; const d = new Date(deadline); const now = new Date(); return Math.max(0, (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())); };
  return (
    <div className="grid">
      <div className="card">
        <div className="ch"><span className="lbl">{goals.length} spaardoelen</span><button className="btn small primary" onClick={onAdd}><Plus size={14} /> Nieuw doel</button></div>
        {goals.length === 0 && <p className="muted">Nog geen doelen. Voeg er een toe om te gaan sparen.</p>}
        <div className="goalgrid">
          {goals.map((g) => {
            const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
            const left = Math.max(0, g.target - g.saved);
            const m = monthsTo(g.deadline);
            const perMonth = m && m > 0 && left > 0 ? Math.ceil(left / m) : null;
            return (
              <div key={g.id} className="goalcard">
                <div className="ch"><span className="gname"><PiggyBank size={15} style={{ color: "var(--gold)" }} /> {g.name}</span><button className="del" onClick={() => onDel(g.id)}><Trash2 size={14} /></button></div>
                <div className="ring" style={{ background: `conic-gradient(var(--gold) ${pct * 3.6}deg, var(--line) 0deg)` }}><div className="ringin">{pct}%</div></div>
                <div className="gnums"><strong>{fmtEUR(g.saved)}</strong> <span>/ {fmtEUR(g.target)}</span></div>
                <div className="gmeta">{left > 0 ? `Nog ${fmtEUR(left)} te gaan` : "Doel behaald! 🎉"}</div>
                {perMonth && <div className="gpace">≈ {fmtEUR(perMonth)}/mnd om de streefdatum te halen</div>}
                <button className="btn ghost full" onClick={() => onTopUp(g.id)}><Plus size={14} /> Inleg toevoegen</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================ MODALS
function Modal({ title, onClose, children }) {
  return (<div className="overlay" onClick={onClose}><div className="modal" onClick={(e) => e.stopPropagation()}><div className="mh"><h3>{title}</h3><button className="x" onClick={onClose}><X size={18} /></button></div>{children}</div></div>);
}

function TxModal({ initial, onClose, onSave, defScope }) {
  const [type, setType] = useState(initial?.type || "uitgave");
  const [scope, setScope] = useState(initial?.scope || defScope);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [category, setCategory] = useState(initial?.category || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [date, setDate] = useState(initial ? isoDay(new Date(initial.date)) : isoDay(new Date()));
  const [recurring, setRecurring] = useState(initial?.recurring || false);
  const [remind, setRemind] = useState(initial?.reminder?.enabled || false);
  const [daysBefore, setDaysBefore] = useState(initial?.reminder?.daysBefore ?? 3);
  const cats = CATS[scope][type];

  const meldDate = useMemo(() => { const d = new Date(date); d.setDate(d.getDate() - Math.max(0, parseInt(daysBefore) || 0)); return d; }, [date, daysBefore]);

  const save = () => {
    const a = num(amount); if (a <= 0) return;
    onSave({
      id: initial?.id, type, scope, amount: a, category: category || cats[0], description,
      date: new Date(date).toISOString(), recurring,
      reminder: remind ? { enabled: true, daysBefore: Math.max(0, parseInt(daysBefore) || 0) } : { enabled: false },
    });
  };

  return (
    <Modal title={initial ? "Transactie bewerken" : "Nieuwe transactie"} onClose={onClose}>
      <div className="seg seg3"><button className={type === "uitgave" ? "on neg" : ""} onClick={() => { setType("uitgave"); setCategory(""); }}>Uitgave</button><button className={type === "inkomst" ? "on pos" : ""} onClick={() => { setType("inkomst"); setCategory(""); }}>Inkomst</button><button className={type === "sparen" ? "on spaar" : ""} onClick={() => { setType("sparen"); setCategory(""); }}>Sparen</button></div>
      <div className="seg sm"><button className={scope === "prive" ? "on" : ""} onClick={() => { setScope("prive"); setCategory(""); }}>Privé</button><button className={scope === "zakelijk" ? "on" : ""} onClick={() => { setScope("zakelijk"); setCategory(""); }}>Zakelijk</button></div>
      {type === "sparen" && <p className="spaarhint"><PiggyBank size={13} /> Overboeking tussen je eigen rekeningen — telt niet mee als inkomst of uitgave, en verandert je saldo niet.</p>}
      <label className="fld"><span>Bedrag</span><input type="number" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
      <label className="fld"><span>Categorie</span><select value={category || cats[0]} onChange={(e) => setCategory(e.target.value)}>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label className="fld"><span>Omschrijving</span><input type="text" placeholder="bijv. Huur, boodschappen…" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="fld"><span>Datum</span><DatePicker value={date} onChange={setDate} /></div>
      <button type="button" className={recurring ? "toggle on" : "toggle"} onClick={() => setRecurring(!recurring)}><Repeat size={15} /> Maandelijks terugkerend {recurring && <Check size={15} style={{ marginLeft: "auto" }} />}</button>
      <button type="button" className={remind ? "toggle on" : "toggle"} onClick={() => setRemind(!remind)}>{remind ? <BellRing size={15} /> : <Bell size={15} />} Herinnering {remind && <Check size={15} style={{ marginLeft: "auto" }} />}</button>
      {remind && (
        <>
          <label className="fld"><span>Aantal dagen van tevoren</span><input type="number" min="0" max="60" inputMode="numeric" value={daysBefore} onChange={(e) => setDaysBefore(e.target.value)} /></label>
          <p className="meldhint"><BellRing size={13} /> Melding op <strong>{meldDate.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}</strong></p>
        </>
      )}
      <button className="btn primary full" onClick={save}>{initial ? "Opslaan" : "Toevoegen"}</button>
    </Modal>
  );
}

function GoalModal({ onClose, onSave, defScope }) {
  const [name, setName] = useState(""); const [target, setTarget] = useState(""); const [saved, setSaved] = useState(""); const [scope, setScope] = useState(defScope); const [deadline, setDeadline] = useState("");
  const save = () => { const t = num(target); if (!name || !t) return; onSave({ name, target: t, saved: num(saved), scope, deadline }); };
  return (
    <Modal title="Nieuw spaardoel" onClose={onClose}>
      <label className="fld"><span>Naam</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="bijv. Reis, buffer…" autoFocus /></label>
      <label className="fld"><span>Doelbedrag</span><input type="number" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0,00" /></label>
      <label className="fld"><span>Al gespaard</span><input type="number" inputMode="decimal" value={saved} onChange={(e) => setSaved(e.target.value)} placeholder="0,00" /></label>
      <div className="seg sm"><button className={scope === "prive" ? "on" : ""} onClick={() => setScope("prive")}>Privé</button><button className={scope === "zakelijk" ? "on" : ""} onClick={() => setScope("zakelijk")}>Zakelijk</button></div>
      <div className="fld"><span>Streefdatum (optioneel)</span><DatePicker value={deadline} onChange={setDeadline} /></div>
      <button className="btn primary full" onClick={save}>Doel aanmaken</button>
    </Modal>
  );
}

function TopUpModal({ goal, onClose, onSave }) {
  const [amount, setAmount] = useState("");
  const save = () => { const a = num(amount); if (a) onSave(a); };
  return (<Modal title={`Inleg · ${goal.name}`} onClose={onClose}><label className="fld"><span>Bedrag toevoegen</span><input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus /></label><button className="btn primary full" onClick={save}>Toevoegen</button></Modal>);
}

function BudgetModal({ budgets, scope, onClose, onSave }) {
  const [s, setS] = useState(scope);
  const [vals, setVals] = useState(() => { const o = {}; for (const [k, v] of Object.entries(budgets)) o[k] = String(v); return o; });
  const cats = CATS[s].uitgave;
  const setVal = (key, v) => setVals({ ...vals, [key]: v });
  const save = () => { const out = { ...budgets }; for (const c of cats) { const key = `${s}::${c}`; const v = num(vals[key]); if (v > 0) out[key] = v; else delete out[key]; } onSave(out); };
  return (
    <Modal title="Maandbudgetten" onClose={onClose}>
      <div className="seg sm"><button className={s === "prive" ? "on" : ""} onClick={() => setS("prive")}>Privé</button><button className={s === "zakelijk" ? "on" : ""} onClick={() => setS("zakelijk")}>Zakelijk</button></div>
      <p className="muted" style={{ marginBottom: 12 }}>Stel een maandlimiet per categorie in. Laat leeg voor geen limiet.</p>
      {cats.map((c) => (<label className="fld budrow" key={c}><span>{c}</span><input type="number" inputMode="decimal" placeholder="—" value={vals[`${s}::${c}`] || ""} onChange={(e) => setVal(`${s}::${c}`, e.target.value)} /></label>))}
      <button className="btn primary full" onClick={save}>Opslaan</button>
    </Modal>
  );
}

function SettingsModal({ settings, onClose, onSave, onExport, onImport, onReset, onLogout, onOpenHousehold }) {
  const [reserveOn, setReserveOn] = useState(settings.reserveOn);
  const [pct, setPct] = useState(String(settings.reservePct));
  const [pushState, setPushState] = useState({ supported: true, enabled: false, permission: "default" });
  const [pushBusy, setPushBusy] = useState(false);
  const fileRef = React.useRef();

  useEffect(() => { push.status().then(setPushState).catch(() => setPushState({ supported: false, enabled: false, permission: "unsupported" })); }, []);

  const saveAndClose = () => { onSave({ reserveOn, reservePct: Math.min(60, Math.max(0, num(pct))) }); onClose(); };
  const togglePush = async () => {
    setPushBusy(true);
    try { if (pushState.enabled) await push.disable(); else await push.enable(); setPushState(await push.status()); }
    catch (e) { alert(e.message); }
    finally { setPushBusy(false); }
  };
  const test = async () => { try { await push.sendTest(); } catch (e) { alert(e.message); } };

  return (
    <Modal title="Instellingen" onClose={onClose}>
      <span className="lbl"><Landmark size={14} /> Reservering belasting & BTW</span>
      <button type="button" className={reserveOn ? "toggle on" : "toggle"} style={{ marginTop: 8 }} onClick={() => setReserveOn(!reserveOn)}>Reservering tonen {reserveOn && <Check size={15} style={{ marginLeft: "auto" }} />}</button>
      {reserveOn && <label className="fld"><span>Percentage van zakelijke winst (%)</span><input type="number" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></label>}
      <button className="btn primary full" onClick={saveAndClose}>Opslaan</button>

      <div className="divider" />
      <span className="lbl"><Bell size={14} /> Pushberichten</span>
      {pushState.supported ? (
        <>
          <button type="button" className={pushState.enabled ? "toggle on" : "toggle"} style={{ marginTop: 8 }} onClick={togglePush} disabled={pushBusy}>
            {pushState.enabled ? <BellRing size={15} /> : <Bell size={15} />} Pushberichten ontvangen {pushState.enabled && <Check size={15} style={{ marginLeft: "auto" }} />}
          </button>
          {pushState.enabled && <button className="btn ghost full" onClick={test}>Stuur testmelding</button>}
          {pushState.permission === "denied" && <p className="muted">Meldingen zijn in je browser geblokkeerd; zet ze daar weer aan om dit te gebruiken.</p>}
        </>
      ) : <p className="muted" style={{ marginTop: 8 }}>Deze browser ondersteunt geen pushberichten.</p>}

      <div className="divider" />
      <span className="lbl"><Users size={14} /> Delen</span>
      <button className="btn ghost full" style={{ marginTop: 8 }} onClick={onOpenHousehold}><Users size={15} /> Delen met partner</button>

      <div className="divider" />
      <span className="lbl">Back-up</span>
      <div className="row" style={{ justifyContent: "stretch", marginTop: 8 }}>
        <button className="btn ghost" style={{ flex: 1 }} onClick={onExport}><Download size={15} /> Exporteren</button>
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => fileRef.current.click()}><Upload size={15} /> Importeren</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files[0] && onImport(e.target.files[0])} />
      </div>

      <div className="divider" />
      <button className="btn ghost full" onClick={onLogout}><LogOut size={15} /> Uitloggen</button>
      <button className="btn danger full" onClick={onReset}><Trash2 size={15} /> Alle gegevens wissen</button>
    </Modal>
  );
}

// ============================================================ SHELL
function Shell({ children }) {
  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        :root { --paper:#F3EFE6; --card:#FBFAF5; --ink:#1E2B25; --muted:#7A7E73; --green:#1F5A47; --green-d:#163b30; --gold:#C29B3E; --pos:#2E7D5B; --neg:#C24B33; --line:#E6E1D4; }
        .app { font-family:'Hanken Grotesk',sans-serif; background:var(--paper); color:var(--ink); min-height:100vh; padding:22px 16px 120px; max-width:560px; margin:0 auto; background-image:radial-gradient(circle at 0% 0%, rgba(194,155,62,0.07), transparent 40%); }
        h1 { font-family:'Fraunces',serif; font-size:30px; font-weight:500; letter-spacing:-0.5px; line-height:1.05; }
        h2 { font-family:'Fraunces',serif; font-weight:500; font-size:22px; } h3 { font-family:'Fraunces',serif; font-weight:500; font-size:20px; }
        .bh { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:18px; }
        .brand { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:var(--green); margin-bottom:6px; }
        .sub { color:var(--muted); font-size:13px; margin-top:4px; text-transform:capitalize; }
        .topright { display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
        .gear { background:var(--card); border:1px solid var(--line); border-radius:11px; padding:7px; cursor:pointer; color:var(--muted); display:grid; place-items:center; transition:.15s; }
        .gear:hover { color:var(--green); border-color:var(--green); }
        .scope { display:flex; flex-direction:column; gap:5px; }
        .chip { display:inline-flex; align-items:center; gap:4px; justify-content:flex-end; border:1px solid var(--line); background:var(--card); color:var(--muted); padding:5px 10px; border-radius:20px; font-size:12px; font-weight:600; font-family:inherit; cursor:pointer; transition:.15s; white-space:nowrap; }
        .chip.on { background:var(--green); color:#fff; border-color:var(--green); }
        .tabs { display:flex; gap:6px; margin-bottom:14px; overflow-x:auto; padding-bottom:2px; }
        .tab { display:inline-flex; align-items:center; gap:6px; border:none; background:transparent; color:var(--muted); padding:8px 13px; border-radius:11px; font-size:14px; font-weight:600; font-family:inherit; cursor:pointer; white-space:nowrap; transition:.15s; }
        .tab.on { background:var(--ink); color:var(--paper); }
        .monthnav { display:flex; align-items:center; justify-content:space-between; background:var(--card); border:1px solid var(--line); border-radius:13px; padding:7px 10px; margin-bottom:13px; }
        .monthnav span { font-weight:600; font-size:14px; text-transform:capitalize; }
        .monthnav button { background:none; border:none; color:var(--green); cursor:pointer; padding:4px; display:grid; place-items:center; border-radius:8px; }
        .monthnav button:disabled { color:var(--line); cursor:default; }
        .grid { display:flex; flex-direction:column; gap:13px; }
        .duo { display:grid; grid-template-columns:1fr 1fr; gap:13px; }
        .card { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:18px; box-shadow:0 1px 2px rgba(30,43,37,0.03); }
        .lbl { font-size:12px; font-weight:600; color:var(--muted); letter-spacing:.3px; display:inline-flex; align-items:center; gap:5px; }
        .hero { background:linear-gradient(150deg,var(--green) 0%,var(--green-d) 100%); color:#fff; border:none; position:relative; overflow:hidden; }
        .hero .lbl { color:rgba(255,255,255,0.7); }
        .big { font-family:'Fraunces',serif; font-size:38px; font-weight:500; letter-spacing:-1px; margin-top:6px; }
        .besteedbaar { font-size:13px; color:rgba(255,255,255,0.8); margin-top:6px; } .besteedbaar strong { color:#fff; }
        .spark { margin:8px -18px -18px; }
        .stat .num, .num { font-family:'Fraunces',serif; font-size:26px; font-weight:500; margin-top:6px; }
        .pos { color:var(--pos); } .neg { color:var(--neg); }
        .insights .ins-list { display:flex; flex-direction:column; gap:9px; margin-top:11px; }
        .ins { display:flex; align-items:flex-start; gap:9px; font-size:13.5px; line-height:1.4; }
        .ins .dotc { width:7px; height:7px; border-radius:50%; margin-top:5px; flex-shrink:0; }
        .ins.warn .dotc { background:var(--neg); } .ins.good .dotc { background:var(--pos); }
        .ch { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
        .muted { color:var(--muted); font-size:13.5px; line-height:1.5; }
        .catlist { display:flex; flex-direction:column; gap:11px; }
        .catrow { display:flex; flex-direction:column; gap:5px; }
        .cattop { display:flex; justify-content:space-between; font-size:13.5px; gap:8px; }
        .cattop span { display:inline-flex; align-items:center; gap:5px; color:var(--ink); }
        .cattop strong { font-weight:600; white-space:nowrap; }
        .scopetag { font-style:normal; font-size:10px; background:var(--line); color:var(--muted); padding:1px 6px; border-radius:10px; font-weight:600; }
        .bar { height:7px; background:var(--line); border-radius:4px; overflow:hidden; }
        .fill { height:100%; background:var(--green); border-radius:4px; transition:width .3s; }
        .fill.gold { background:var(--gold); }
        .overmsg { font-size:11.5px; color:var(--neg); font-weight:600; display:inline-flex; align-items:center; gap:4px; }
        .goalmini { margin-top:11px; display:flex; flex-direction:column; gap:5px; }
        .searchbar { display:flex; align-items:center; gap:8px; background:var(--paper); border:1px solid var(--line); border-radius:11px; padding:9px 12px; margin-bottom:10px; }
        .searchbar .si { color:var(--muted); flex-shrink:0; }
        .searchbar input { border:none; background:none; outline:none; font-family:inherit; font-size:14px; width:100%; color:var(--ink); }
        .filterrow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .txgroup { margin-top:2px; }
        .txmonth { font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:var(--muted); margin:14px 0 6px; }
        .txrow { display:flex; align-items:center; gap:11px; padding:9px 0; border-bottom:1px solid var(--line); cursor:pointer; }
        .txrow:last-child { border-bottom:none; }
        .tic { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; flex-shrink:0; }
        .tic.inkomst { background:rgba(46,125,91,0.12); color:var(--pos); } .tic.uitgave { background:rgba(194,75,51,0.1); color:var(--neg); }
        .tic.sparen { background:rgba(46,111,142,0.12); color:#2E6F8E; }
        .txmid { flex:1; min-width:0; }
        .txdesc { font-size:14.5px; font-weight:600; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .txmeta { font-size:12px; color:var(--muted); margin-top:1px; }
        .pill { display:inline-flex; align-items:center; gap:3px; font-size:9.5px; font-weight:700; text-transform:uppercase; background:var(--line); color:var(--muted); padding:2px 6px; border-radius:20px; letter-spacing:.3px; }
        .pill.gold { background:rgba(194,155,62,0.18); color:#9a7a28; }
        .txamt { font-family:'Fraunces',serif; font-size:15.5px; font-weight:500; flex-shrink:0; }
        .txamt.spaar { color:var(--muted); }
        .spaarhint { display:flex; align-items:center; gap:7px; font-size:13px; color:#2E6F8E; background:rgba(46,111,142,0.07); border-radius:10px; padding:10px 12px; margin-bottom:14px; line-height:1.4; }
        .del { background:none; border:none; color:var(--muted); cursor:pointer; padding:5px; border-radius:8px; flex-shrink:0; opacity:.5; transition:.15s; }
        .del:hover { opacity:1; color:var(--neg); background:rgba(194,75,51,0.08); }
        .hint { font-size:11.5px; color:var(--muted); display:flex; align-items:center; gap:5px; margin-top:12px; justify-content:center; }
        .legend { display:flex; gap:18px; justify-content:center; margin-top:10px; font-size:12px; color:var(--muted); }
        .legend span { display:inline-flex; align-items:center; gap:6px; }
        .dot { width:10px; height:3px; border-radius:2px; display:inline-block; } .dot.green { background:var(--green); } .dot.gold { background:var(--gold); }
        .goalgrid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .goalcard { background:var(--paper); border:1px solid var(--line); border-radius:15px; padding:14px; display:flex; flex-direction:column; align-items:center; gap:7px; text-align:center; }
        .goalcard .ch { width:100%; margin-bottom:2px; }
        .gname { font-size:13px; font-weight:700; display:inline-flex; align-items:center; gap:5px; text-align:left; }
        .ring { width:86px; height:86px; border-radius:50%; display:grid; place-items:center; margin:4px 0; }
        .ringin { width:64px; height:64px; background:var(--paper); border-radius:50%; display:grid; place-items:center; font-family:'Fraunces',serif; font-size:19px; font-weight:600; }
        .gnums { font-size:13px; } .gnums strong { font-family:'Fraunces',serif; font-size:16px; } .gnums span { color:var(--muted); }
        .gmeta { font-size:11.5px; color:var(--muted); } .gpace { font-size:11px; color:var(--green); font-weight:600; }
        .empty { text-align:center; display:flex; flex-direction:column; align-items:center; gap:10px; padding:40px 24px; }
        .empty p { color:var(--muted); font-size:14px; max-width:320px; line-height:1.5; }
        .row { display:flex; gap:10px; margin-top:8px; flex-wrap:wrap; justify-content:center; }
        .btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; border:none; border-radius:12px; padding:11px 18px; font-size:14px; font-weight:600; font-family:inherit; cursor:pointer; transition:.15s; }
        .btn.primary { background:var(--green); color:#fff; } .btn.primary:hover { background:var(--green-d); }
        .btn.ghost { background:transparent; border:1px solid var(--line); color:var(--ink); } .btn.ghost:hover { background:var(--paper); }
        .btn.danger { background:rgba(194,75,51,0.08); color:var(--neg); } .btn.danger:hover { background:rgba(194,75,51,0.15); }
        .btn.small { padding:7px 12px; font-size:13px; border-radius:9px; }
        .btn.full { width:100%; margin-top:6px; }
        .lnk { background:none; border:none; color:var(--green); font-size:12.5px; font-weight:600; font-family:inherit; cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
        .fab { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); width:56px; height:56px; border-radius:50%; background:var(--green); color:#fff; border:none; cursor:pointer; display:grid; place-items:center; box-shadow:0 8px 24px rgba(31,90,71,0.4); transition:.15s; z-index:50; }
        .fab:hover { background:var(--green-d); transform:translateX(-50%) scale(1.05); }
        .toast { position:fixed; bottom:92px; left:50%; transform:translateX(-50%); background:var(--ink); color:var(--paper); padding:11px 18px; border-radius:12px; font-size:13.5px; font-weight:500; z-index:120; box-shadow:0 6px 20px rgba(0,0,0,0.25); }
        .overlay { position:fixed; inset:0; background:rgba(30,43,37,0.4); backdrop-filter:blur(3px); display:flex; align-items:flex-end; justify-content:center; z-index:100; }
        .modal { background:var(--card); border-radius:22px 22px 0 0; padding:22px 20px 28px; width:100%; max-width:560px; max-height:90vh; overflow-y:auto; animation:up .25s ease; }
        @keyframes up { from { transform:translateY(40px); opacity:.6; } to { transform:translateY(0); opacity:1; } }
        .mh { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
        .x { background:var(--paper); border:none; border-radius:9px; padding:7px; cursor:pointer; color:var(--muted); display:grid; place-items:center; }
        .seg { display:grid; grid-template-columns:1fr 1fr; gap:6px; background:var(--paper); padding:4px; border-radius:12px; margin-bottom:11px; }
        .seg.sm { margin-bottom:14px; grid-template-columns:repeat(auto-fit,minmax(0,1fr)); }
        .seg.seg3 { grid-template-columns:1fr 1fr 1fr; }
        .seg button { border:none; background:transparent; padding:9px; border-radius:9px; font-size:13.5px; font-weight:600; font-family:inherit; cursor:pointer; color:var(--muted); transition:.15s; }
        .seg button.on { background:var(--card); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,0.08); }
        .seg button.on.pos { color:var(--pos); } .seg button.on.neg { color:var(--neg); } .seg button.on.spaar { color:#2E6F8E; }
        .fld { display:flex; flex-direction:column; gap:6px; margin-bottom:13px; }
        .fld span { font-size:12.5px; font-weight:600; color:var(--muted); }
        .fld input, .fld select { border:1px solid var(--line); background:var(--paper); border-radius:11px; padding:12px 13px; font-size:15px; font-family:inherit; color:var(--ink); outline:none; transition:.15s; }
        .fld input:focus, .fld select:focus { border-color:var(--green); background:var(--card); }
        .budrow { flex-direction:row; align-items:center; justify-content:space-between; gap:12px; margin-bottom:9px; }
        .budrow span { flex:1; } .budrow input { width:120px; text-align:right; }
        .toggle { display:flex; align-items:center; gap:8px; width:100%; border:1px solid var(--line); background:var(--paper); padding:12px 13px; border-radius:11px; font-size:14px; font-weight:600; font-family:inherit; cursor:pointer; color:var(--muted); margin-bottom:14px; }
        .toggle.on { border-color:var(--green); color:var(--green); background:rgba(31,90,71,0.05); }
        .toggle:disabled { opacity:.6; cursor:default; }
        .meldhint { display:flex; align-items:center; gap:7px; font-size:13px; color:var(--green); background:rgba(31,90,71,0.05); border-radius:10px; padding:10px 12px; margin-bottom:14px; }
        .meldhint strong { text-transform:capitalize; }
        .divider { height:1px; background:var(--line); margin:18px 0 12px; }
        @media (max-width:380px){ .goalgrid{grid-template-columns:1fr;} }
      `}</style>
      {children}
    </div>
  );
}
