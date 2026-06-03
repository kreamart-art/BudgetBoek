// db/postgres.js — pg-pool achter dezelfde async interface als de SQLite-adapter.
// Dezelfde queries; alleen de `?`-placeholders worden naar $1,$2,… vertaald.
import pg from "pg";

// "... WHERE a = ? AND b = ?"  →  "... WHERE a = $1 AND b = $2"
const tr = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

export function createPostgres() {
  const ssl = /^(1|true|require)$/i.test(process.env.PGSSL || "") ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL, ssl }
      : {
          host: process.env.PGHOST || "localhost",
          port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE,
          ssl,
        }
  );

  // Een fout op een idle-connectie (bijv. de server sluit 'm) mag het proces niet laten crashen.
  pool.on("error", (e) => console.error("pg pool error:", e.message));

  const bind = (runner) => ({
    async get(sql, ...p) { return (await runner.query(tr(sql), p)).rows[0]; },
    async all(sql, ...p) { return (await runner.query(tr(sql), p)).rows; },
    async run(sql, ...p) { return { changes: (await runner.query(tr(sql), p)).rowCount }; },
    async insert(sql, ...p) { return (await runner.query(tr(sql), p)).rows[0].id; }, // sql bevat RETURNING id
  });

  const api = bind(pool);

  api.tx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await fn(bind(client));
      await client.query("COMMIT");
      return r;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  };

  api.init = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS households (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL DEFAULT 'Mijn huishouden',
        owner_id   INTEGER,
        join_code  TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        household_id  INTEGER,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS budgets (
        household_id INTEGER PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
        data         TEXT NOT NULL DEFAULT '{}',
        version      INTEGER NOT NULL DEFAULT 0,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint     TEXT UNIQUE NOT NULL,
        subscription TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sent_reminders (
        key     TEXT PRIMARY KEY,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  };

  api.kind = "postgres";
  api.close = async () => pool.end();
  return api;
}
