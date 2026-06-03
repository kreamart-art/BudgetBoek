// push-routes.js — pushberichten en herinnering-planner (driver-neutraal, async).
// Aansluiten in server.js:  import { installPush } from "./push-routes.js";
//                           installPush(app, { auth });   // ná het definiëren van `auth`
import webpush from "web-push";          // npm install web-push
import db from "./db.js";

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT = "mailto:admin@example.com" } = process.env;

// Vangt fouten in async-routes af zodat een request nooit blijft hangen.
const aw = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(500).json({ error: "Er ging iets mis op de server" }); });

export function installPush(app, { auth }) {
  // De tabellen (push_subscriptions, sent_reminders) maakt de db-laag aan in db.init().

  const enabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (enabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  else console.warn("⚠ Pushberichten staan uit: stel VAPID_PUBLIC_KEY en VAPID_PRIVATE_KEY in (npx web-push generate-vapid-keys).");

  // ---------- abonnementen ----------
  app.get("/api/push/key", (_req, res) => res.json({ key: VAPID_PUBLIC_KEY || null }));

  app.post("/api/push/subscribe", auth, aw(async (req, res) => {
    const sub = req.body?.subscription;
    if (!sub?.endpoint) return res.status(400).json({ error: "Ongeldige subscription" });
    await db.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, subscription) VALUES (?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, subscription = excluded.subscription`,
      req.user.id, sub.endpoint, JSON.stringify(sub)
    );
    res.json({ ok: true });
  }));

  app.post("/api/push/unsubscribe", auth, aw(async (req, res) => {
    if (req.body?.endpoint) await db.run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", req.body.endpoint, req.user.id);
    res.json({ ok: true });
  }));

  async function sendToUser(userId, payload) {
    const subs = await db.all("SELECT endpoint, subscription FROM push_subscriptions WHERE user_id = ?", userId);
    for (const s of subs) {
      try {
        await webpush.sendNotification(JSON.parse(s.subscription), JSON.stringify(payload));
      } catch (e) {
        // 404/410 = abonnement bestaat niet meer → opruimen
        if (e.statusCode === 404 || e.statusCode === 410) await db.run("DELETE FROM push_subscriptions WHERE endpoint = ?", s.endpoint);
      }
    }
  }

  app.post("/api/push/test", auth, aw(async (req, res) => {
    if (!enabled) return res.status(503).json({ error: "Pushberichten zijn niet geconfigureerd op de server" });
    await sendToUser(req.user.id, { title: "Budgetboek", body: "Testmelding — pushberichten werken! 🎉", url: "/" });
    res.json({ ok: true });
  }));

  // ---------- planner ----------
  const ymd = (d) => d.toISOString().slice(0, 10);
  const minusDays = (iso, n) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() - n); return d; };
  const daysBetween = (aStr, bStr) => Math.round((Date.parse(bStr) - Date.parse(aStr)) / 86400000);

  async function checkReminders() {
    if (!enabled) return;
    const today = ymd(new Date());
    for (const row of await db.all("SELECT household_id, data FROM budgets")) {
      let data; try { data = JSON.parse(row.data); } catch { continue; }
      const txs = (data.transactions || []).filter((t) => t?.reminder?.enabled && t.date);
      if (!txs.length) continue;
      const members = await db.all("SELECT id FROM users WHERE household_id = ?", row.household_id);
      for (const t of txs) {
        const days = Math.max(0, Number(t.reminder.daysBefore) || 0);
        const dueStr = ymd(new Date(t.date));
        const fireStr = ymd(minusDays(t.date, days));
        if (today < fireStr || today > dueStr) continue;            // alleen tussen meld- en vervaldatum
        const key = `${row.household_id}:${t.id}:${dueStr}`;
        if (await db.get("SELECT 1 FROM sent_reminders WHERE key = ?", key)) continue; // al verstuurd
        const left = daysBetween(today, dueStr);
        const when = left <= 0 ? "vandaag" : left === 1 ? "morgen" : `over ${left} dagen`;
        const amount = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(t.amount || 0);
        const payload = { title: "Herinnering", body: `${t.description || t.category || "Transactie"} — ${amount} ${when}.`, url: "/", tag: key };
        for (const m of members) await sendToUser(m.id, payload);
        await db.run("INSERT INTO sent_reminders (key) VALUES (?) ON CONFLICT (key) DO NOTHING", key);
      }
    }
  }

  const runCheck = () => checkReminders().catch((e) => console.error("herinnering-check mislukt:", e));
  setTimeout(runCheck, 5000);                 // kort na opstarten
  setInterval(runCheck, 15 * 60 * 1000);      // daarna elk kwartier
  app.post("/api/push/check-now", auth, aw(async (_req, res) => { await checkReminders(); res.json({ ok: true }); })); // handig bij testen
}
