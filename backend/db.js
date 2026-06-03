import Database from "better-sqlite3";
import crypto from "node:crypto";

const db = new Database(process.env.DB_FILE || "budget.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Een huishouden bundelt één of meer gebruikers rond één gedeeld budget.
// budgets.version verhoogt bij elke opslag → maakt optimistische concurrency
// mogelijk: een opslag op verouderde data wordt geweigerd.

db.exec(`
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
`);

// --- migraties ---
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("household_id")) db.exec("ALTER TABLE users ADD COLUMN household_id INTEGER");

const budgetCols = db.prepare("PRAGMA table_info(budgets)").all().map((c) => c.name);
const budgetsExist = budgetCols.length > 0;
const budgetsAreV1 = budgetCols.includes("user_id");   // oudste opzet: per gebruiker
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

if (!budgetsExist) {
  db.exec(CREATE_BUDGETS);
} else if (!budgetsAreV1 && !budgetsHaveVersion) {
  // huishouden-versie zonder versiekolom → kolom toevoegen
  db.exec("ALTER TABLE budgets ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
}

export function uniqueJoinCode() {
  let code;
  do { code = crypto.randomBytes(4).toString("hex").toUpperCase(); }
  while (db.prepare("SELECT 1 FROM households WHERE join_code = ?").get(code));
  return code;
}

const migrate = db.transaction(() => {
  const orphans = db.prepare("SELECT id FROM users WHERE household_id IS NULL").all();
  for (const u of orphans) {
    const info = db.prepare("INSERT INTO households (name, owner_id, join_code) VALUES ('Mijn huishouden', ?, ?)").run(u.id, uniqueJoinCode());
    db.prepare("UPDATE users SET household_id = ? WHERE id = ?").run(info.lastInsertRowid, u.id);
  }
  if (budgetsAreV1) {
    db.exec("ALTER TABLE budgets RENAME TO budgets_v1");
    db.exec(CREATE_BUDGETS);
    for (const r of db.prepare("SELECT user_id, data, updated_at FROM budgets_v1").all()) {
      const u = db.prepare("SELECT household_id FROM users WHERE id = ?").get(r.user_id);
      if (u?.household_id) db.prepare("INSERT OR REPLACE INTO budgets (household_id, data, version, updated_at) VALUES (?, ?, 0, ?)").run(u.household_id, r.data, r.updated_at);
    }
    db.exec("DROP TABLE budgets_v1");
  }
});
migrate();

export default db;
