// VARNOX X CRASHER — optional Neon sync for the bot's premium list.
// When DATABASE_URL / NEON_DATABASE_URL is set (and the 'pg' package is
// installed), the premium whitelist also loads from the shared Neon
// database (table: crasher_bot_premium). Without a database the bot keeps
// working exactly as before, reading only ./database/premium.json.

const cachedUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';

async function loadPremiumNumbers() {
  if (!cachedUrl) return null;
  let pg = null;
  try { pg = require('pg'); } catch (e) { return null; }
  let pool = null;
  try {
    pool = new pg.Pool({ connectionString: cachedUrl, connectionTimeoutMillis: 8000, max: 2 });
    await pool.query(
      `CREATE TABLE IF NOT EXISTS crasher_bot_premium (
         number   text PRIMARY KEY,
         added_at timestamptz NOT NULL DEFAULT now()
       )`);
    const r = await pool.query('SELECT number FROM crasher_bot_premium');
    return r.rows.map(x => x.number);
  } catch (e) {
    return null;
  } finally {
    if (pool) pool.end().catch(() => {});
  }
}

module.exports = { loadPremiumNumbers };
