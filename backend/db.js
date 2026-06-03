// db.js — kiest de databasedriver en biedt één async interface aan server.js/push-routes.js.
//
//   DB_DRIVER=sqlite (standaard)  → better-sqlite3, bestand budget.db (lokaal/één server)
//   DB_DRIVER=postgres            → pg-pool (productie / efemeer bestandssysteem)
//   (zonder DB_DRIVER, mét DATABASE_URL → automatisch postgres, handig op Coolify e.d.)
//
// Beide drivers delen exact dezelfde queries (`?`-placeholders, `RETURNING id` bij inserts).
import crypto from "node:crypto";
import { createSqlite } from "./db/sqlite.js";
import { createPostgres } from "./db/postgres.js";

function pickDriver() {
  const explicit = (process.env.DB_DRIVER || "").toLowerCase();
  if (explicit === "postgres" || explicit === "pg") return "postgres";
  if (explicit === "sqlite") return "sqlite";
  return process.env.DATABASE_URL ? "postgres" : "sqlite";
}

const driver = pickDriver();
const db = driver === "postgres" ? createPostgres() : createSqlite();

// Schema (en bij SQLite: migraties) draaien vóór de server requests afhandelt.
export const ready = db.init().then(() => {
  console.log(`✓ Database: ${db.kind}`);
  return db;
});

// Genereert een unieke deelcode. `exec` is standaard de pool/db, maar binnen een
// transactie geef je de transactie-executor mee zodat de check dezelfde connectie gebruikt.
export async function uniqueJoinCode(exec = db) {
  let code;
  do { code = crypto.randomBytes(4).toString("hex").toUpperCase(); }
  while (await exec.get("SELECT 1 FROM households WHERE join_code = ?", code));
  return code;
}

export default db;
