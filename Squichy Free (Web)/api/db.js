// VARNOX X CRASHER — Neon (Postgres) persistence layer.
// Mirrors the shared-database convention used by the other VARNOX portals
// (varnox_*, talkless_*, skylar_* tables on the same Neon project).
const { Pool } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  '';

let pool = null;
let initPromise = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('sslmode=require') || DATABASE_URL.includes('sslmode=verify')
        ? undefined
        : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', () => { /* idle client errors are non-fatal */ });
  }
  return pool;
}

async function ensure() {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!initPromise) {
    initPromise = (async () => {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(`
          CREATE TABLE IF NOT EXISTS crasher_settings (
            key   text PRIMARY KEY,
            value text NOT NULL DEFAULT ''
          )`);
        await client.query(`
          CREATE TABLE IF NOT EXISTS crasher_premium_keys (
            id         serial PRIMARY KEY,
            key        text UNIQUE NOT NULL,
            status     text NOT NULL DEFAULT 'unused',
            used_phone text,
            used_at    timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
          )`);
        await client.query(`
          INSERT INTO crasher_settings (key, value)
          VALUES ('premium_mode', $1)
          ON CONFLICT (key) DO NOTHING`,
          [String(process.env.PREMIUM_MODE || '').toLowerCase() === 'true' ? 'true' : 'false']);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    })();
  }
  await initPromise;
}

async function getSetting(key, fallback = null) {
  await ensure();
  const r = await getPool().query('SELECT value FROM crasher_settings WHERE key = $1', [key]);
  return r.rowCount ? r.rows[0].value : fallback;
}

async function setSetting(key, value) {
  await ensure();
  await getPool().query(
    `INSERT INTO crasher_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]);
}

async function insertPremiumKey(key) {
  await ensure();
  await getPool().query(
    'INSERT INTO crasher_premium_keys (key, status) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
    [key, 'unused']);
}

async function findUnusedPremiumKey(key) {
  await ensure();
  const r = await getPool().query(
    `SELECT id, status FROM crasher_premium_keys WHERE key = $1 AND status = 'unused'`,
    [key]);
  return r.rowCount ? r.rows[0] : null;
}

async function consumePremiumKey(id, phone) {
  await getPool().query(
    `UPDATE crasher_premium_keys
     SET status = 'used', used_phone = $2, used_at = now()
     WHERE id = $1 AND status = 'unused'`,
    [id, phone || null]);
}

async function listPremiumKeys() {
  await ensure();
  const r = await getPool().query(
    'SELECT key, status, used_phone, used_at, created_at FROM crasher_premium_keys ORDER BY id DESC LIMIT 200');
  return r.rows;
}

module.exports = {
  ensure,
  getSetting,
  setSetting,
  insertPremiumKey,
  findUnusedPremiumKey,
  consumePremiumKey,
  listPremiumKeys,
};
