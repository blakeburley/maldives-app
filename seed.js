// =============================================================================
// seed.js — Load resort/pricing data from data.json into SQLite
//
// Run this whenever you update data.json to push changes into the database:
//   node seed.js
//
// The server also auto-seeds on startup if the database is empty, so you only
// need to run this manually after editing data.json on an already-running app.
//
// You can also trigger a live reload (no restart needed) via:
//   POST http://localhost:3000/api/data/reload
// =============================================================================

const fs   = require('fs');
const path = require('path');
const { initDb, setData } = require('./db');

const dataPath = path.join(__dirname, 'data.json');

if (!fs.existsSync(dataPath)) {
  console.error('❌  data.json not found at:', dataPath);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (e) {
  console.error('❌  Failed to parse data.json:', e.message);
  process.exit(1);
}

// initDb must be called before any db operations (sql.js is async)
(async () => {
  await initDb();
  setData(data);

  console.log('✅  Seeded maldives.db from data.json');
  console.log(`    → ${data.resorts.length} resorts`);
  console.log(`    → ${data.suggestedCombinations.length} suggested combinations`);
  console.log(`    → Budget target: $${data.globalSettings.totalBudget.toLocaleString()}`);
})();
