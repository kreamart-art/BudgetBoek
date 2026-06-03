import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import db, { uniqueJoinCode } from "./db.js";
import { installPush } from "./push-routes.js";

const { JWT_SECRET, PORT = 4000, CORS_ORIGIN = "*" } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error("✗ Stel een sterke JWT_SECRET in via je .env-bestand (min. 16 tekens).");
  process.exit(1);
}

const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(",") }));
app.use(express.json({ limit: "5mb" }));

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");
const sign = (user) => jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
const householdOf = (userId) => db.prepare("SELECT household_id FROM users WHERE id = ?").get(userId)?.household_id;

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
app.post("/api/auth/register", authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!isEmail(email)) return res.status(400).json({ error: "Ongeldig e-mailadres" });
  if (!password || password.length < 8) return res.status(400).json({ error: "Wachtwoord moet minstens 8 tekens zijn" });

  const mail = email.toLowerCase().trim();
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(mail)) return res.status(409).json({ error: "Dit e-mailadres is al geregistreerd" });

  const create = db.transaction(() => {
    const hh = db.prepare("INSERT INTO households (name, owner_id, join_code) VALUES ('Mijn huishouden', NULL, ?)").run(uniqueJoinCode());
    const hid = Number(hh.lastInsertRowid);
    const info = db.prepare("INSERT INTO users (email, password_hash, household_id) VALUES (?, ?, ?)").run(mail, bcrypt.hashSync(password, 12), hid);
    const uid = Number(info.lastInsertRowid);
    db.prepare("UPDATE households SET owner_id = ? WHERE id = ?").run(uid, hid);
    db.prepare("INSERT INTO budgets (household_id, data, version) VALUES (?, '{}', 0)").run(hid);
    return { id: uid, email: mail };
  });
  const user = create();
  res.status(201).json({ token: sign(user), user: { email: user.email } });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase().trim());
  const ok = user ? bcrypt.compareSync(password || "", user.password_hash) : bcrypt.compareSync("x", "$2a$12$............................................");
  if (!user || !ok) return res.status(401).json({ error: "Onjuiste inloggegevens" });
  res.json({ token: sign(user), user: { email: user.email } });
});

app.get("/api/me", auth, (req, res) => res.json({ user: { email: req.user.email } }));

// ---------- gedeelde budgetdata met versie-controle ----------
app.get("/api/budget", auth, (req, res) => {
  const hid = householdOf(req.user.id);
  const row = db.prepare("SELECT data, version, updated_at FROM budgets WHERE household_id = ?").get(hid);
  res.json({ data: row ? JSON.parse(row.data) : {}, version: row ? row.version : 0, updatedAt: row?.updated_at || null });
});

// Verwacht { data, version }. version is de versie waarop de wijziging is gebaseerd.
// Komt die niet overeen met de huidige serverversie → 409 met de actuele data,
// zodat de client kan samenvoegen en opnieuw opslaan.
app.put("/api/budget", auth, (req, res) => {
  const hid = householdOf(req.user.id);
  const { data, version } = req.body || {};
  let json;
  try { json = JSON.stringify(data ?? {}); } catch { return res.status(400).json({ error: "Ongeldige data" }); }

  const current = db.prepare("SELECT data, version FROM budgets WHERE household_id = ?").get(hid);
  if (!current) {
    db.prepare("INSERT INTO budgets (household_id, data, version, updated_at) VALUES (?, ?, 1, datetime('now'))").run(hid, json);
    return res.json({ ok: true, version: 1 });
  }

  // Geen versie meegestuurd? Sta toe (eenvoudige clients), maar verhoog wel.
  const base = version == null ? current.version : Number(version);
  if (base !== current.version) {
    return res.status(409).json({ error: "Versie verouderd", current: { data: JSON.parse(current.data), version: current.version } });
  }

  // Voorwaardelijke update vangt ook een race tussen SELECT en UPDATE af.
  const info = db.prepare("UPDATE budgets SET data = ?, version = version + 1, updated_at = datetime('now') WHERE household_id = ? AND version = ?").run(json, hid, current.version);
  if (info.changes === 0) {
    const fresh = db.prepare("SELECT data, version FROM budgets WHERE household_id = ?").get(hid);
    return res.status(409).json({ error: "Versie verouderd", current: { data: JSON.parse(fresh.data), version: fresh.version } });
  }
  res.json({ ok: true, version: current.version + 1 });
});

// ---------- huishouden delen ----------
app.get("/api/household", auth, (req, res) => {
  const hid = householdOf(req.user.id);
  const hh = db.prepare("SELECT * FROM households WHERE id = ?").get(hid);
  const members = db.prepare("SELECT id, email FROM users WHERE household_id = ? ORDER BY id").all(hid);
  res.json({ name: hh.name, joinCode: hh.join_code, isOwner: hh.owner_id === req.user.id, members: members.map((m) => ({ email: m.email, isOwner: m.id === hh.owner_id })) });
});

app.put("/api/household", auth, (req, res) => {
  const hid = householdOf(req.user.id);
  const name = String(req.body?.name || "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Geef een naam op" });
  db.prepare("UPDATE households SET name = ? WHERE id = ?").run(name, hid);
  res.json({ ok: true });
});

app.post("/api/household/code", auth, (req, res) => {
  const hid = householdOf(req.user.id);
  const hh = db.prepare("SELECT owner_id FROM households WHERE id = ?").get(hid);
  if (hh.owner_id !== req.user.id) return res.status(403).json({ error: "Alleen de eigenaar kan de code vernieuwen" });
  const code = uniqueJoinCode();
  db.prepare("UPDATE households SET join_code = ? WHERE id = ?").run(code, hid);
  res.json({ joinCode: code });
});

app.post("/api/household/join", auth, joinLimiter, (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  const target = db.prepare("SELECT * FROM households WHERE join_code = ?").get(code);
  if (!target) return res.status(404).json({ error: "Deelcode niet gevonden" });

  const oldHid = householdOf(req.user.id);
  if (oldHid === target.id) return res.json({ ok: true, name: target.name });

  const move = db.transaction(() => {
    db.prepare("UPDATE users SET household_id = ? WHERE id = ?").run(target.id, req.user.id);
    const left = db.prepare("SELECT id FROM users WHERE household_id = ?").all(oldHid);
    if (left.length === 0) db.prepare("DELETE FROM households WHERE id = ?").run(oldHid);
    else {
      const old = db.prepare("SELECT owner_id FROM households WHERE id = ?").get(oldHid);
      if (old?.owner_id === req.user.id) db.prepare("UPDATE households SET owner_id = ? WHERE id = ?").run(left[0].id, oldHid);
    }
  });
  move();
  res.json({ ok: true, name: target.name });
});

app.post("/api/household/leave", auth, (req, res) => {
  const oldHid = householdOf(req.user.id);
  const leave = db.transaction(() => {
    const hh = db.prepare("INSERT INTO households (name, owner_id, join_code) VALUES ('Mijn huishouden', ?, ?)").run(req.user.id, uniqueJoinCode());
    const hid = Number(hh.lastInsertRowid);
    db.prepare("INSERT INTO budgets (household_id, data, version) VALUES (?, '{}', 0)").run(hid);
    db.prepare("UPDATE users SET household_id = ? WHERE id = ?").run(hid, req.user.id);
    const left = db.prepare("SELECT id FROM users WHERE household_id = ?").all(oldHid);
    if (left.length === 0) db.prepare("DELETE FROM households WHERE id = ?").run(oldHid);
    else {
      const old = db.prepare("SELECT owner_id FROM households WHERE id = ?").get(oldHid);
      if (old?.owner_id === req.user.id) db.prepare("UPDATE households SET owner_id = ? WHERE id = ?").run(left[0].id, oldHid);
    }
  });
  leave();
  res.json({ ok: true });
});

app.delete("/api/me", auth, (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// pushberichten + herinnering-planner
installPush(app, { auth });

app.listen(PORT, () => console.log(`✓ Budget-backend draait op http://localhost:${PORT}`));
