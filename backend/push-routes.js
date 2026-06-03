// push-routes.js — pushberichten en herinnering-planner.
// Aansluiten in server.js:  import { installPush } from "./push-routes.js";
//                           installPush(app, { auth });   // ná het definiëren van `auth`
import webpush from "web-push";          // npm install web-push
import db from "./db.js";

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT = "mailto:admin@example.com" } = process.env;

export function installPush(app, { auth }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      endpoint     TEXT UNIQUE NOT NULL,
      subscription TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sent_reminders (
      key     TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const enabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (enabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  else console.warn("⚠ Pushberichten staan uit: stel VAPID_PUBLIC_KEY en VAPID_PRIVATE_KEY in (npx web-push generate-vapid-keys).");

  // ---------- abonnementen ----------
  app.get("/api/push/key", (_req, res) => res.json({ key: VAPID_PUBLIC_KEY || null }));

  app.post("/api/push/subscribe", auth, (req, res) => {
    const sub = req.body?.subscription;
    if (!sub?.endpoint) return res.status(400).json({ error: "Ongeldige subscription" });
    db.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription = excluded.subscription
    `).run(req.user.id, sub.endpoint, JSON.stringify(sub));
    res.json({ ok: true });
  });

  app.post("/api/push/unsubscribe", auth, (req, res) => {
    if (req.body?.endpoint) db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(req.body.endpoint, req.user.id);
    res.json({ ok: true });
  });

  async function sendToUser(userId, payload) {
    const subs = db.prepare("SELECT endpoint, subscription FROM push_subscriptions WHERE user_id = ?").all(userId);
    for (const s of subs) {
      try {
        await webpush.sendNotification(JSON.parse(s.subscription), JSON.stringify(payload));
      } catch (e) {
        // 404/410 = abonnement bestaat niet meer → opruimen
        if (e.statusCode === 404 || e.statusCode === 410) db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(s.endpoint);
      }
    }
  }

  app.post("/api/push/test", auth, async (req, res) => {
    if (!enabled) return res.status(503).json({ error: "Pushberichten zijn niet geconfigureerd op de server" });
    await sendToUser(req.user.id, { title: "Budgetboek", body: "Testmelding — pushberichten werken! 🎉", url: "/" });
    res.json({ ok: true });
  });

  // ---------- planner ----------
  const ymd = (d) => d.toISOString().slice(0, 10);
  const minusDays = (iso, n) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() - n); return d; };
  const daysBetween = (aStr, bStr) => Math.round((Date.parse(bStr) - Date.parse(aStr)) / 86400000);

  async function checkReminders() {
    if (!enabled) return;
    const today = ymd(new Date());
    for (const row of db.prepare("SELECT household_id, data FROM budgets").all()) {
      let data; try { data = JSON.parse(row.data); } catch { continue; }
      const txs = (data.transactions || []).filter((t) => t?.reminder?.enabled && t.date);
      if (!txs.length) continue;
      const members = db.prepare("SELECT id FROM users WHERE household_id = ?").all(row.household_id);
      for (const t of txs) {
        const days = Math.max(0, Number(t.reminder.daysBefore) || 0);
        const dueStr = ymd(new Date(t.date));
        const fireStr = ymd(minusDays(t.date, days));
        if (today < fireStr || today > dueStr) continue;            // alleen tussen meld- en vervaldatum
        const key = `${row.household_id}:${t.id}:${dueStr}`;
        if (db.prepare("SELECT 1 FROM sent_reminders WHERE key = ?").get(key)) continue; // al verstuurd
        const left = daysBetween(today, dueStr);
        const when = left <= 0 ? "vandaag" : left === 1 ? "morgen" : `over ${left} dagen`;
        const amount = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(t.amount || 0);
        const payload = { title: "Herinnering", body: `${t.description || t.category || "Transactie"} — ${amount} ${when}.`, url: "/", tag: key };
        for (const m of members) await sendToUser(m.id, payload);
        db.prepare("INSERT OR REPLACE INTO sent_reminders (key) VALUES (?)").run(key);
      }
    }
  }

  setTimeout(checkReminders, 5000);                 // kort na opstarten
  setInterval(checkReminders, 15 * 60 * 1000);      // daarna elk kwartier
  app.post("/api/push/check-now", auth, async (_req, res) => { await checkReminders(); res.json({ ok: true }); }); // handig bij testen
}
