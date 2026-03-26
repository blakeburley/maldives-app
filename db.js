// =============================================================================
// db.js — SQLite database layer (using sql.js — pure JavaScript, no compilation)
//
// DATABASE FILE: maldives.db  (auto-created on first run, same folder as server.js)
// Set DB_PATH env var to store it elsewhere (e.g. a mounted volume on Railway).
//
// sql.js keeps an in-memory database and flushes it to disk after every write.
// The resulting file is a standard SQLite3 .db — open it with DB Browser for
// SQLite or any other SQLite tool to inspect or back up the data.
//
// TABLES:
//   data_store   — Resort & pricing data stored as a single JSON blob.
//                  Seeded from data.json on first run; update any time by
//                  editing data.json and calling POST /api/data/reload.
//
//   user_session — The user's current slot selections + overrides (slots 1 & 2).
//                  Persists across server restarts so the app resumes exactly
//                  where you left off.
//
// EXPORTS (all async — await them):
//   initDb()                 → must be called once before anything else
//   getData()                → full data object (resorts, combos, globalSettings)
//   setData(obj)             → upsert full data object
//   getSession()             → { 1: {resortId,nights,...}, 2: {...} }
//   saveSlot(slot, state)    → upsert one slot's state
// =============================================================================

const path = require('path');
const fs   = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'maldives.db');

let db;   // sql.js Database instance (in-memory)
let SQL;  // sql.js module, loaded once

// ── Schema ────────────────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS data_store (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_session (
    slot       INTEGER PRIMARY KEY,
    resort_id  TEXT,
    nights     INTEGER,
    villa      TEXT,
    meal_plan  TEXT,
    overrides  TEXT NOT NULL DEFAULT '{}',
    saved_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// ── Init ──────────────────────────────────────────────────────────────────────
// Call once at server startup. Loads the .db file if it exists, or creates a
// fresh in-memory database and runs the schema migration.
async function initDb() {
  if (db) return; // already initialised

  // sql.js must be loaded asynchronously (it fetches its WASM binary)
  SQL = await require('sql.js')();

  if (fs.existsSync(DB_PATH)) {
    // Open existing database from disk
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log(`📂  Loaded database from ${DB_PATH}`);
  } else {
    // Create a new empty database
    db = new SQL.Database();
    console.log(`✨  Created new database at ${DB_PATH}`);
  }

  // Create tables if they don't exist yet
  db.run(SCHEMA);

  // Immediately flush so the file exists on disk (even if empty)
  _save();
}

// ── Private: flush in-memory DB to disk ───────────────────────────────────────
// Called after every write. Fast for small databases (< a few MB).
function _save() {
  const data = db.export();            // Uint8Array — standard SQLite3 binary
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Private: run a SELECT and return all rows as plain objects ─────────────────
function _all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// ── Private: run a single-row SELECT ──────────────────────────────────────────
function _get(sql, params = []) {
  return _all(sql, params)[0] || null;
}

// ── Resort & pricing data ─────────────────────────────────────────────────────

/** Returns the full data object (resorts, globalSettings, suggestedCombinations),
 *  or null if the database has never been seeded. */
function getData() {
  const row = _get('SELECT value FROM data_store WHERE key = ?', ['data']);
  return row ? JSON.parse(row.value) : null;
}

/** Upserts the full data object. Called by seed.js and POST /api/data/reload. */
function setData(dataObj) {
  db.run(`
    INSERT INTO data_store (key, value, updated_at)
    VALUES ('data', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      updated_at = excluded.updated_at
  `, [JSON.stringify(dataObj)]);
  _save(); // flush to disk
}

// ── User session ──────────────────────────────────────────────────────────────

/** Returns saved selections for both slots as:
 *  { 1: { resortId, nights, villa, mealPlan, overrides }, 2: {...} }
 *  Missing slots are omitted (caller should fall back to Combo 1 defaults). */
function getSession() {
  const rows = _all('SELECT * FROM user_session ORDER BY slot');
  const session = {};
  for (const row of rows) {
    session[row.slot] = {
      resortId: row.resort_id,
      nights:   row.nights,
      villa:    row.villa,
      mealPlan: row.meal_plan,
      overrides: JSON.parse(row.overrides || '{}'),
    };
  }
  return session;
}

/** Upserts one slot's full state. Slot must be 1 or 2. */
function saveSlot(slot, { resortId, nights, villa, mealPlan, overrides }) {
  db.run(`
    INSERT INTO user_session (slot, resort_id, nights, villa, meal_plan, overrides, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(slot) DO UPDATE SET
      resort_id = excluded.resort_id,
      nights    = excluded.nights,
      villa     = excluded.villa,
      meal_plan = excluded.meal_plan,
      overrides = excluded.overrides,
      saved_at  = excluded.saved_at
  `, [slot, resortId, nights, villa, mealPlan, JSON.stringify(overrides || {})]);
  _save(); // flush to disk
}

module.exports = { initDb, getData, setData, getSession, saveSlot };
