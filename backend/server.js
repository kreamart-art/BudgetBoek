import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import db, { ready, uniqueJoinCode } from "./db.js";
import { installPush } from "./push-routes.js";

const { JWT_SECRET, PORT = 4000, CORS_ORIGIN = "*", NODE_ENV, TRUST_PROXY } = process.env;
const isProd = NODE_ENV === "production";

if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error("✗ Stel een sterke JWT_SECRET in via je .env-bestand (min. 16 tekens).");
  process.exit(1);
}
// Productie-hardening: weiger zwakke geheimen en een open CORS-policy.
if (isProd) {
  if (JWT_SECRET.length < 32) { console.error("✗ In productie moet JWT_SECRET minstens 32 tekens zijn."); process.exit(1); }
  if (CORS_ORIGIN === "*") { console.error("✗ In productie: zet CORS_ORIGIN op je echte frontend-domein (geen *)."); process.exit(1); }
}

const app = express();

// Achter een reverse proxy (Coolify/Caddy/Nginx) → echte client-IP voor rate-limiting.
if (TRUST_PROXY != null && TRUST_PROXY !== "") {
  let tp = TRUST_PROXY;
  if (tp === "true") tp = true;
  else if (tp === "false") tp = false;
  else if (/^\d+$/.test(tp)) tp = Number(tp);
  app.set("trust proxy", tp);
}

app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "5mb" }));

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");
const sign = (user) => jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
const householdOf = async (userId) => (await db.get("SELECT household_id FROM users WHERE id = ?", userId))?.household_id;

// Async-handlers netjes afvangen → geen hangende requests bij een fout.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Niet ingelogd" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "Sessie verlopen, log opnieuw in" }); }
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const joinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });

// ---------- auth ----------
app.post("/api/auth/register", authLimiter, h(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email)) return res.status(400).json({ error: "Ongeldig e-mailadres" });
  if (!password || password.length < 8) return res.status(400).json({ error: "Wachtwoord moet minstens 8 tekens zijn" });

  const mail = email.toLowerCase().trim();
  if (await db.get("SELECT id FROM users WHERE email = ?", mail)) return res.status(409).json({ error: "Dit e-mailadres is al geregistreerd" });

  const hash = bcrypt.hashSync(password, 12);
  const user = await db.tx(async (t) => {
    const code = await uniqueJoinCode(t);
    const hid = await t.insert("INSERT INTO households (name, owner_id, join_code) VALUES ('Mijn huishouden', NULL, ?) RETURNING id", code);
    const uid = await t.insert("INSERT INTO users (email, password_hash, household_id) VALUES (?, ?, ?) RETURNING id", mail, hash, hid);
    await t.run("UPDATE households SET owner_id = ? WHERE id = ?", uid, hid);
    await t.run("INSERT INTO budgets (household_id, data, version) VALUES (?, '{}', 0)", hid);
    return { id: uid, email: mail };
  });
  res.status(201).json({ token: sign(user), user: { email: user.email } });
}));

app.post("/api/auth/login", authLimiter, h(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await db.get("SELECT * FROM users WHERE email = ?", (email || "").toLowerCase().trim());
  const ok = user ? bcrypt.compareSync(password || "", user.password_hash) : bcrypt.compareSync("x", "$2a$12$............................................");
  if (!user || !ok) return res.status(401).json({ error: "Onjuiste inloggegevens" });
  res.json({ token: sign(user), user: { email: user.email } });
}));

app.get("/api/me", auth, (req, res) => res.json({ user: { email: req.user.email } }));

// ---------- gedeelde budgetdata met versie-controle ----------
app.get("/api/budget", auth, h(async (req, res) => {
  const hid = await householdOf(req.user.id);
  const row = await db.get("SELECT data, version, updated_at FROM budgets WHERE household_id = ?", hid);
  res.json({ data: row ? JSON.parse(row.data) : {}, version: row ? row.version : 0, updatedAt: row?.updated_at || null });
}));

// Verwacht { data, version }. version is de versie waarop de wijziging is gebaseerd.
// Komt die niet overeen met de huidige serverversie → 409 met de actuele data,
// zodat de client kan samenvoegen en opnieuw opslaan.
app.put("/api/budget", auth, h(async (req, res) => {
  const hid = await householdOf(req.user.id);
  const { data, version } = req.body || {};
  let json;
  try { json = JSON.stringify(data ?? {}); } catch { return res.status(400).json({ error: "Ongeldige data" }); }
  const now = new Date().toISOString();

  const current = await db.get("SELECT data, version FROM budgets WHERE household_id = ?", hid);
  if (!current) {
    await db.run("INSERT INTO budgets (household_id, data, version, updated_at) VALUES (?, ?, 1, ?)", hid, json, now);
    return res.json({ ok: true, version: 1 });
  }

  // Geen versie meegestuurd? Sta toe (eenvoudige clients), maar verhoog wel.
  const base = version == null ? current.version : Number(version);
  if (base !== current.version) {
    return res.status(409).json({ error: "Versie verouderd", current: { data: JSON.parse(current.data), version: current.version } });
  }

  // Voorwaardelijke update vangt ook een race tussen SELECT en UPDATE af.
  const info = await db.run("UPDATE budgets SET data = ?, version = version + 1, updated_at = ? WHERE household_id = ? AND version = ?", json, now, hid, current.version);
  if (info.changes === 0) {
    const fresh = await db.get("SELECT data, version FROM budgets WHERE household_id = ?", hid);
    return res.status(409).json({ error: "Versie verouderd", current: { data: JSON.parse(fresh.data), version: fresh.version } });
  }
  res.json({ ok: true, version: current.version + 1 });
}));

// ---------- huishouden delen ----------
app.get("/api/household", auth, h(async (req, res) => {
  const hid = await householdOf(req.user.id);
  const hh = await db.get("SELECT * FROM households WHERE id = ?", hid);
  const members = await db.all("SELECT id, email FROM users WHERE household_id = ? ORDER BY id", hid);
  res.json({ name: hh.name, joinCode: hh.join_code, isOwner: hh.owner_id === req.user.id, members: members.map((m) => ({ email: m.email, isOwner: m.id === hh.owner_id })) });
}));

app.put("/api/household", auth, h(async (req, res) => {
  const hid = await householdOf(req.user.id);
  const name = String(req.body?.name || "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Geef een naam op" });
  await db.run("UPDATE households SET name = ? WHERE id = ?", name, hid);
  res.json({ ok: true });
}));

app.post("/api/household/code", auth, h(async (req, res) => {
  const hid = await householdOf(req.user.id);
  const hh = await db.get("SELECT owner_id FROM households WHERE id = ?", hid);
  if (hh.owner_id !== req.user.id) return res.status(403).json({ error: "Alleen de eigenaar kan de code vernieuwen" });
  const code = await uniqueJoinCode();
  await db.run("UPDATE households SET join_code = ? WHERE id = ?", code, hid);
  res.json({ joinCode: code });
}));

app.post("/api/household/join", auth, joinLimiter, h(async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  const target = await db.get("SELECT * FROM households WHERE join_code = ?", code);
  if (!target) return res.status(404).json({ error: "Deelcode niet gevonden" });

  const oldHid = await householdOf(req.user.id);
  if (oldHid === target.id) return res.json({ ok: true, name: target.name });

  await db.tx(async (t) => {
    await t.run("UPDATE users SET household_id = ? WHERE id = ?", target.id, req.user.id);
    const left = await t.all("SELECT id FROM users WHERE household_id = ?", oldHid);
    if (left.length === 0) await t.run("DELETE FROM households WHERE id = ?", oldHid);
    else {
      const old = await t.get("SELECT owner_id FROM households WHERE id = ?", oldHid);
      if (old?.owner_id === req.user.id) await t.run("UPDATE households SET owner_id = ? WHERE id = ?", left[0].id, oldHid);
    }
  });
  res.json({ ok: true, name: target.name });
}));

app.post("/api/household/leave", auth, h(async (req, res) => {
  const oldHid = await householdOf(req.user.id);
  await db.tx(async (t) => {
    const code = await uniqueJoinCode(t);
    const hid = await t.insert("INSERT INTO households (name, owner_id, join_code) VALUES ('Mijn huishouden', ?, ?) RETURNING id", req.user.id, code);
    await t.run("INSERT INTO budgets (household_id, data, version) VALUES (?, '{}', 0)", hid);
    await t.run("UPDATE users SET household_id = ? WHERE id = ?", hid, req.user.id);
    const left = await t.all("SELECT id FROM users WHERE household_id = ?", oldHid);
    if (left.length === 0) await t.run("DELETE FROM households WHERE id = ?", oldHid);
    else {
      const old = await t.get("SELECT owner_id FROM households WHERE id = ?", oldHid);
      if (old?.owner_id === req.user.id) await t.run("UPDATE households SET owner_id = ? WHERE id = ?", left[0].id, oldHid);
    }
  });
  res.json({ ok: true });
}));

app.delete("/api/me", auth, h(async (req, res) => {
  await db.run("DELETE FROM users WHERE id = ?", req.user.id);
  res.json({ ok: true });
}));

app.get("/health", (_req, res) => res.json({ ok: true }));

// pushberichten + herinnering-planner
installPush(app, { auth });

// Centrale foutafhandeling (na alle routes).
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Er ging iets mis op de server" });
});

// Wacht tot het schema klaar is (en bij SQLite de migraties), dán pas luisteren.
await ready;
app.listen(PORT, () => console.log(`✓ Budget-backend draait op http://localhost:${PORT}`));
