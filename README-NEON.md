# VARNOX X CRASHER — Neon database update

Both parts now persist on the same shared Neon/Postgres database used by the
other VARNOX portals (`varnox_*` / `talkless_*` tables), using the
`crasher_*` table prefix so nothing collides.

## What changed

**Web — `Squichy Free (Web)`**
- `api/db.js` (new): pg pool + auto-created tables
  - `crasher_settings(key text PK, value text)` — stores `premium_mode`
  - `crasher_premium_keys(id serial, key text UNIQUE, status, used_phone, used_at, created_at)`
- `api/api-routes.js`:
  - `premium_mode` is read from / persisted to Neon (was an in-memory flag
    that reset on every cold start / lambda instance)
  - Issued premium keys are stored in Neon; `/api/pair` validates a stored
    unused key and marks it `used` with the phone number after a successful pairing
  - New `GET /api/owner/premium-keys` lists issued keys
  - Fixed a broken `OWNER_CODE` default string (unterminated literal)
- `package.json` + lockfile: added `pg`

**Bot — `Squichy Free (Bot)`**
- `database/neon.js` (new): optional loader for `crasher_bot_premium`
- `squichy.js`: premium whitelist now merges Neon (`crasher_bot_premium`
  numbers) with `database/premium.json`; per-message disk reads replaced by
  the cached list. Without `DATABASE_URL` the bot behaves exactly as before.

## Setup

### Web (Vercel)
1. Set `DATABASE_URL` env var (production/preview/development) to a Neon
   connection string. Optional: `OWNER_CODE`, `OWNER_TOKEN_SECRET`,
   `PREMIUM_KEY`, `PREMIUM_MODE`, `WORKER_SECRET`.
2. Deploy the `Squichy Free (Web)` folder (root directory = `Squichy Free (Web)`).
3. Tables are created automatically on first API call.

### Bot (VPS / panel)
1. `npm install` in `Squichy Free (Bot)`.
2. Optional: set `DATABASE_URL`; add/remove premium numbers in
   `crasher_bot_premium` (column `number`, e.g. `254712345678`) to control
   the bot whitelist from the DB.

## Tables created automatically
```
crasher_settings          key text PK | value text
crasher_premium_keys      id serial | key text UNIQUE | status text | used_phone text | used_at timestamptz | created_at timestamptz
crasher_bot_premium       number text PK | added_at timestamptz   (bot only)
```
