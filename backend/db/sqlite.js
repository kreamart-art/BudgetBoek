// db/sqlite.js — better-sqlite3 achter een async interface (resolved direct, want sync driver).
// Houdt de bestaande migraties voor reeds bestaande budget.db-bestanden intact.
import Database from "better-sqlite3";
import crypto from "node:crypto";

export function createSqlite() {
  const raw = new Database(process.env.DB_FILE || "budget.db");
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  // Eén gedeelde queryvorm; `?`-placeholders werken native in SQLite.
  const bind = (db) => ({
    async get(sql, ...p) { return db.prepare(sql).get(...p); },
    async all(sql, ...p) { return db.prepare(sql).all(...p); },
    async run(sql, ...p) { const i = db.prepare(sql).run(...p); return { changes: i.changes }; },
    async insert(sql, ...p) { return db.prepare(sql).get(...p).id; }, // sql bevat RETURNING id
  });

  const api = bind(raw);

  // Transactie: better-sqlite3 is synchroon, dus BEGIN/COMMIT/ROLLBACK is atomair.
  api.tx = async (fn) => {
    raw.exec("BEGIN");
    try { const r = await fn(bind(raw)); raw.exec("COMMIT"); return r; }
    catch (e) { raw.exec("ROLLBACK"); throw e; }
  };

  api.init = async () => {
    raw.exec(`
      CREATE TABLE IF NOT EXISTS households (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL DEFAULT 'Mijn huishouden',
        owner_id   INTEGER,
        join_code  TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        household_id  INTEGER,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
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

    // --- migraties voor oudere databases ---
    const userCols = raw.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    if (!userCols.includes("household_id")) raw.exec("ALTER TABLE users ADD COLUMN household_id INTEGER");

    const budgetCols = raw.prepare("PRAGMA table_info(budgets)").all().map((c) => c.name);
    const budgetsExist = budgetCols.length > 0;
    const budgetsAreV1 = budgetCols.includes("user_id"); // oudste opzet: per gebruiker
    const budgetsHaveVersion = budgetCols.includes("version");

    const CREATE_BUDGETS = `
      CREATE TABLE budgets (
        household_id INTEGER PRIMARY KEY,
        data         TEXT NOT NULL DEFAULT '{}',
        version      INTEGER NOT NULL DEFAULT 0,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
      );
    `;
    if (!budgetsExist) raw.exec(CREATE_BUDGETS);
    else if (!budgetsAreV1 && !budgetsHaveVersion) raw.exec("ALTER TABLE budgets ADD COLUMN version INTEGER NOT NULL DEFAULT 0");

    const code = () => {
      let v; do { v = crypto.randomBytes(4).toString("hex").toUpperCase(); }
      while (raw.prepare("SELECT 1 FROM households WHERE join_code = ?").get(v));
      return v;
    };

    const migrate = raw.transaction(() => {
      for (const u of raw.prepare("SELECT id FROM users WHERE household_id IS NULL").all()) {
        const info = raw.prepare("INSERT INTO households (name, owner_id, join_code) VALUES ('Mijn huishouden', ?, ?)").run(u.id, code());
        raw.prepare("UPDATE users SET household_id = ? WHERE id = ?").run(info.lastInsertRowid, u.id);
      }
      if (budgetsAreV1) {
        raw.exec("ALTER TABLE budgets RENAME TO budgets_v1");
        raw.exec(CREATE_BUDGETS);
        for (const r of raw.prepare("SELECT user_id, data, updated_at FROM budgets_v1").all()) {
          const u = raw.prepare("SELECT household_id FROM users WHERE id = ?").get(r.user_id);
          if (u?.household_id) raw.prepare("INSERT OR REPLACE INTO budgets (household_id, data, version, updated_at) VALUES (?, ?, 0, ?)").run(u.household_id, r.data, r.updated_at);
        }
        raw.exec("DROP TABLE budgets_v1");
      }
    });
    migrate();
  };

  api.raw = raw;
  api.kind = "sqlite";
  api.close = async () => raw.close();
  return api;
}
