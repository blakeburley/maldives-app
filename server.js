// =============================================================================
// server.js — Express server for the Maldives honeymoon comparison tool
//
// START: node server.js   (or: npm start)
//
// WHAT IT DOES:
//   1. Opens (or creates) the SQLite database via db.js
//   2. Auto-seeds resort/pricing data from data.json if the DB is empty
//   3. Serves index.html and static assets from this folder
//   4. Provides a small REST API for data and session persistence
//
// API ENDPOINTS:
//   GET  /api/data             → Full resort/pricing data from SQLite
//   POST /api/data/reload      → Re-read data.json and update SQLite (no restart needed)
//   GET  /api/session          → Saved user selections for slot 1 and slot 2
//   POST /api/session/:slot    → Save one slot's selections + overrides
//
// STORAGE FLOW:
//   data.json → [seed / reload] → SQLite (maldives.db)
//                                        ↑↓
//                               index.html (browser)
//                               saves selections after every change
//                               restores them on next page load
//
// DEPLOYMENT:
//   Set PORT and DB_PATH environment variables (see .env.example).
//   Compatible with Railway, Render, Fly.io — any platform that supports Node.js
//   and can mount a persistent volume for the .db file.
// =============================================================================

// Load .env file if present (install dotenv: npm i dotenv, then uncomment below)
// require('dotenv').config();

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { initDb, getData, setData, getSession, saveSlot } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// Parse JSON request bodies
app.use(express.json());

// Serve index.html, data.json, and any other static files in this folder
app.use(express.static(path.join(__dirname)));

// =============================================================================
// STARTUP: auto-seed the database from data.json if it's empty
// =============================================================================
async function autoSeed() {
  const existing = getData();
  if (existing) {
    console.log('✅  Database already has resort data — skipping auto-seed.');
    console.log('    (To reload from data.json: POST /api/data/reload)');
    return;
  }

  const dataPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(dataPath)) {
    console.warn('⚠️   Database is empty and data.json not found — app will not function until seeded.');
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    setData(data);
    console.log(`✅  Auto-seeded database from data.json (${data.resorts.length} resorts).`);
  } catch (e) {
    console.error('❌  Failed to auto-seed:', e.message);
  }
}

// =============================================================================
// API ROUTES
// =============================================================================

// ── GET /api/data ─────────────────────────────────────────────────────────────
// Returns the full resort/pricing/combos object that the frontend uses to
// render everything. Data lives in SQLite; originally seeded from data.json.
app.get('/api/data', (req, res) => {
  const data = getData();
  if (!data) {
    return res.status(404).json({
      error: 'No data in database. Run: node seed.js'
    });
  }
  res.json(data);
});

// ── POST /api/data/reload ─────────────────────────────────────────────────────
// Re-reads data.json and updates SQLite. Use this when you've edited rates,
// added a resort, etc. No server restart needed — just hit this endpoint and
// refresh the browser.
app.post('/api/data/reload', (req, res) => {
  const dataPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(dataPath)) {
    return res.status(404).json({ error: 'data.json not found' });
  }
  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    setData(data);
    console.log('🔄  Data reloaded from data.json via API call.');
    res.json({ ok: true, resorts: data.resorts.length, message: 'Data reloaded from data.json' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/session ──────────────────────────────────────────────────────────
// Returns the user's last-saved slot selections so the app can restore state
// on page load. Returns {} if no session has been saved yet.
app.get('/api/session', (req, res) => {
  res.json(getSession());
});

// ── POST /api/session/:slot ───────────────────────────────────────────────────
// Saves one slot's full state (resort, nights, villa, meal plan, overrides).
// Called automatically by the frontend after every user change.
// Body: { resortId, nights, villa, mealPlan, overrides }
app.post('/api/session/:slot', (req, res) => {
  const slot = parseInt(req.params.slot, 10);
  if (slot !== 1 && slot !== 2) {
    return res.status(400).json({ error: 'Slot must be 1 or 2' });
  }

  const { resortId, nights, villa, mealPlan, overrides } = req.body;

  // Basic validation
  if (!resortId) {
    return res.status(400).json({ error: 'resortId is required' });
  }

  saveSlot(slot, { resortId, nights, villa, mealPlan, overrides });
  res.json({ ok: true, slot });
});

// =============================================================================
// START SERVER
// db must be initialised before we can serve any requests, so we use an
// async IIFE to await initDb() and autoSeed() before calling app.listen().
// =============================================================================
(async () => {
  try {
    await initDb();   // open or create maldives.db, run schema migrations
    await autoSeed(); // seed from data.json if the DB is empty

    app.listen(PORT, () => {
      console.log(`\n🌴  Maldives comparison running at http://localhost:${PORT}/`);
      console.log(`    Database: ${process.env.DB_PATH || 'maldives.db'}`);
      console.log('    Press Ctrl+C to stop.\n');
    });
  } catch (e) {
    console.error('❌  Failed to start server:', e);
    process.exit(1);
  }
})();
