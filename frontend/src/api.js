// api.js — praat met de budget-backend.
// LET OP: draai dit in je EIGEN frontend (Vite/Next), niet in een Claude-artifact.

const API_URL = (import.meta.env && import.meta.env.VITE_API_URL) || "http://localhost:4000";
const TOKEN_KEY = "budget_token";

const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function req(path, opts = {}) {
  const res = await fetch(API_URL + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    const err = new Error(body.error || "Er ging iets mis");
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  async register(email, password) { const r = await req("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }); setToken(r.token); return r.user; },
  async login(email, password) { const r = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); setToken(r.token); return r.user; },
  logout() { setToken(null); },
  isLoggedIn() { return !!getToken(); },
  async me() { return (await req("/api/me")).user; },
  async deleteAccount() { await req("/api/me", { method: "DELETE" }); setToken(null); },
};

export const household = {
  async get() { return req("/api/household"); },
  async rename(name) { return req("/api/household", { method: "PUT", body: JSON.stringify({ name }) }); },
  async newCode() { return req("/api/household/code", { method: "POST" }); },
  async join(code) { return req("/api/household/join", { method: "POST", body: JSON.stringify({ code }) }); },
  async leave() { return req("/api/household/leave", { method: "POST" }); },
};

// ---------------------------------------------------------------------------
// Versie-controle + tombstones voor gedeelde budgetten
// ---------------------------------------------------------------------------
let currentVersion = 0;
let remoteHandler = null;

export function onRemoteUpdate(fn) { remoteHandler = fn; }

const byId = (arr) => { const o = {}; for (const x of arr || []) o[x.id] = x; return o; };

// Verwijdermarkeringen ouder dan 90 dagen opruimen (dan is een item overal weg).
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
function pruneDeleted(deleted) {
  const out = {}; const cutoff = Date.now() - NINETY_DAYS;
  for (const [id, ts] of Object.entries(deleted || {})) if (new Date(ts).getTime() >= cutoff) out[id] = ts;
  return out;
}

// Voegt beide kanten samen op item-niveau:
//  - toevoegingen/wijzigingen van allebei blijven behouden (lokaal wint bij gelijk id);
//  - verwijderingen (tombstones) reizen mee, dus een gewist item komt niet terug.
function mergeBudget(local, server) {
  const deleted = { ...(server?.deleted || {}) };
  for (const [id, ts] of Object.entries(local?.deleted || {})) {
    if (!deleted[id] || new Date(ts) > new Date(deleted[id])) deleted[id] = ts;
  }
  const mergeArr = (a, b) => Object.values({ ...byId(b), ...byId(a) }).filter((x) => !deleted[x.id]);
  return {
    ...(server || {}), ...(local || {}),
    transactions: mergeArr(local?.transactions, server?.transactions),
    goals: mergeArr(local?.goals, server?.goals),
    budgets: { ...(server?.budgets || {}), ...(local?.budgets || {}) },
    settings: { ...(server?.settings || {}), ...(local?.settings || {}) },
    deleted: pruneDeleted(deleted),
  };
}

export const storage = {
  async get(_key) {
    const r = await req("/api/budget");
    currentVersion = r.version || 0;
    return { value: JSON.stringify(r.data || {}) };
  },
  async set(_key, value) {
    let local = JSON.parse(value);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await req("/api/budget", { method: "PUT", body: JSON.stringify({ data: local, version: currentVersion }) });
        currentVersion = r.version;
        return { ok: true };
      } catch (e) {
        if (e.status === 409 && e.body?.current) {
          local = mergeBudget(local, e.body.current.data);
          currentVersion = e.body.current.version;
          if (remoteHandler) remoteHandler(local);
          continue;
        }
        throw e;
      }
    }
    throw new Error("Opslaan lukte niet door gelijktijdige wijzigingen. Herlaad en probeer opnieuw.");
  },
};

// Optioneel: peil periodiek of de partner iets heeft gewijzigd en werk de UI bij.
export function startSync(intervalMs = 15000) {
  return setInterval(async () => {
    try {
      const r = await req("/api/budget");
      if ((r.version || 0) > currentVersion) {
        currentVersion = r.version;
        if (remoteHandler) remoteHandler(r.data || {});
      }
    } catch { /* stil negeren */ }
  }, intervalMs);
}
export function stopSync(id) { clearInterval(id); }
