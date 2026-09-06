const crypto = require('crypto');

const WORKER_SECRET = process.env.WORKER_SECRET || "sqx_worker_9f2a7c1e4b8d3f60";
const WORKER_SERVERS = [
    'http://172.237.88.79:25570', // put the ip of the vps and the port of the server
];

const OWNER_CODE = process.env.OWNER_CODE || 'blacklorddev';
const OWNER_TOKEN_SECRET = process.env.OWNER_TOKEN_SECRET || 'TONYBLACK';
const db = require('./db');

const PREMIUM_KEY = process.env.PREMIUM_KEY || 'change-me-premium-key';
const PREMIUM_KEY_MAX_DAYS = 30;
const OWNER_TOKEN_TTL_MS = 12 * 3600 * 1000;

function cleanNumber(raw) {
    return String(raw || '').replace(/[^0-9]/g, '');
}

function secureTextEqual(left, right) {
    const a = crypto.createHash('sha256').update(String(left || '')).digest();
    const b = crypto.createHash('sha256').update(String(right || '')).digest();
    return crypto.timingSafeEqual(a, b);
}

function issuePremiumKey(days) {
    const safeDays = Math.min(Math.max(Number(days) || 7, 1), PREMIUM_KEY_MAX_DAYS);
    const expiresAt = Date.now() + safeDays * 24 * 60 * 60 * 1000;
    const nonce = crypto.randomBytes(12).toString('hex');
    const payload = `${expiresAt}.${nonce}`;
    const signature = crypto.createHmac('sha256', OWNER_TOKEN_SECRET).update(payload).digest('hex').slice(0, 32);
    return { key: `VXPK.${expiresAt}.${nonce}.${signature}`, expiresAt };
}

function verifyGeneratedPremiumKey(key) {
    const parts = String(key || '').split('.');
    if (parts.length !== 4 || parts[0] !== 'VXPK') return false;
    const expiresAt = Number(parts[1]);
    const nonce = parts[2];
    const signature = parts[3];
    if (!expiresAt || expiresAt <= Date.now() || !/^[a-f0-9]{24}$/.test(nonce) || !/^[a-f0-9]{32}$/.test(signature)) return false;
    const payload = `${expiresAt}.${nonce}`;
    const expected = crypto.createHmac('sha256', OWNER_TOKEN_SECRET).update(payload).digest('hex').slice(0, 32);
    return secureTextEqual(signature, expected);
}

function isPremiumKeyValid(key) {
    return secureTextEqual(key, PREMIUM_KEY) || verifyGeneratedPremiumKey(key);
}

async function premiumModeOn() {
    try {
        return (await db.getSetting('premium_mode', 'false')) === 'true';
    } catch (e) {
        return String(process.env.PREMIUM_MODE || '').toLowerCase() === 'true';
    }
}

// Returns the stored, unused DB row when the key is a persisted premium key.
async function storedPremiumKeyRow(key) {
    try {
        return await db.findUnusedPremiumKey(String(key || ''));
    } catch (e) {
        return null;
    }
}

async function findAvailableWorker() {
    const checks = WORKER_SERVERS.map(base =>
        fetch(`${base}/api/status`, { signal: AbortSignal.timeout(4000) })
            .then(r => r.json())
            .then(data => (data.available ? base : null))
            .catch(() => null)
    );
    const results = await Promise.all(checks);
    const available = results.filter(base => base !== null);
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
}

async function getAllSessions() {
    const checks = WORKER_SERVERS.map(base =>
        fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(4000) })
            .then(r => r.json())
            .then(sessions => Array.isArray(sessions) ? sessions : [])
            .catch(() => [])
    );
    const results = await Promise.all(checks);
    return results.flat();
}

function issueOwnerToken() {
    const expires = Date.now() + OWNER_TOKEN_TTL_MS;
    const sig = crypto.createHmac('sha256', OWNER_TOKEN_SECRET).update(String(expires)).digest('hex');
    return `${expires}.${sig}`;
}

function verifyOwnerToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return false;
    const [expiresStr, sig] = token.split('.');
    const expires = Number(expiresStr);
    if (!expires || expires < Date.now()) return false;
    const expectedSig = crypto.createHmac('sha256', OWNER_TOKEN_SECRET).update(expiresStr).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
    } catch (e) {
        return false;
    }
}

function requireOwner(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!verifyOwnerToken(token)) return res.status(401).json({ error: 'unauthorized' });
    next();
}

module.exports = function setupApiRoutes(app) {

    app.post('/api/pair', async (req, res) => {
        const number = cleanNumber(req.body.number);
        if (number.length < 7) return res.status(400).json({ error: 'invalid_number' });

        let storedRow = null;
        if (await premiumModeOn()) {
            const keyInput = req.body && req.body.premiumKey;
            storedRow = await storedPremiumKeyRow(keyInput);
            if (!storedRow && !isPremiumKeyValid(keyInput)) {
                return res.status(403).json({ error: 'premium_key_required' });
            }
        }

        const workerBase = await findAvailableWorker();
        if (!workerBase) return res.status(503).json({ error: 'no_server_available' });

        try {
            const r = await fetch(`${workerBase}/api/generate-pair`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-worker-secret': WORKER_SECRET },
                body: JSON.stringify({ numero: number }),
                signal: AbortSignal.timeout(20000)
            });
            const data = await r.json();
            if (!data.success) return res.status(400).json({ error: data.error || 'pairing_failed' });
            if (storedRow) await db.consumePremiumKey(storedRow.id, number).catch(() => {});
            res.json({ success: true, code: data.code });
        } catch (e) {
            res.status(500).json({ error: 'pairing_failed' });
        }
    });

    app.get('/api/my-numbers', async (req, res) => {
        const raw = String(req.query.numbers || '');
        const myNumeros = raw.split(',').map(cleanNumber).filter(Boolean);
        if (myNumeros.length === 0) return res.json({ numbers: [] });

        const sessions = await getAllSessions();
        const numbers = myNumeros.map(numero => {
            const session = sessions.find(s => cleanNumber(s.numero) === numero);
            return session || { numero, status: 'disconnected' };
        });
        res.json({ numbers });
    });

    app.post('/api/disconnect', async (req, res) => {
        const number = cleanNumber(req.body.number);
        if (!number) return res.status(400).json({ error: 'invalid_number' });

        await Promise.allSettled(
            WORKER_SERVERS.map(base =>
                fetch(`${base}/api/disconnect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ numero: number }),
                    signal: AbortSignal.timeout(6000)
                }).then(r => r.json())
            )
        );

        res.json({ success: true });
    });

    app.get('/api/stats', async (req, res) => {
        const sessions = await getAllSessions();
        const connected = sessions.filter(s => s.status === 'connected' || s.status === 'connecting' || s.status === 'reconnecting');
        res.json({ online: connected.length, total: sessions.length });
    });

    app.get('/api/paired-list', async (req, res) => {
        const sessions = await getAllSessions();
        res.json({ numbers: sessions });
    });

    app.post('/api/owner/verify', (req, res) => {
        const code = String(req.body.code || '');
        if (code !== OWNER_CODE) return res.status(401).json({ error: 'invalid_code' });
        res.json({ token: issueOwnerToken() });
    });

    app.get('/api/owner/sessions', requireOwner, async (req, res) => {
        const sessions = await getAllSessions();
        res.json({ numbers: sessions });
    });

    app.get('/api/owner/premium', requireOwner, async (req, res) => {
        res.json({ premiumOnly: await premiumModeOn() });
    });

    app.post('/api/owner/premium-key', requireOwner, async (req, res) => {
        const issued = issuePremiumKey(req.body && req.body.days);
        await db.insertPremiumKey(issued.key).catch(() => {});
        res.json({ success: true, key: issued.key, expiresAt: issued.expiresAt });
    });

    app.post('/api/owner/premium', requireOwner, async (req, res) => {
        const enabled = Boolean(req.body && req.body.enabled);
        await db.setSetting('premium_mode', enabled ? 'true' : 'false');
        res.json({ success: true, premiumOnly: enabled });
    });

    app.get('/api/owner/premium-keys', requireOwner, async (req, res) => {
        const keys = await db.listPremiumKeys();
        res.json({ keys });
    });

    app.post('/api/owner/disconnect', requireOwner, async (req, res) => {
        const number = cleanNumber(req.body.number);
        if (!number) return res.status(400).json({ error: 'invalid_number' });

        const results = await Promise.allSettled(
            WORKER_SERVERS.map(base =>
                fetch(`${base}/api/disconnect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ numero: number }),
                    signal: AbortSignal.timeout(6000)
                }).then(r => r.json())
            )
        );

        const success = results.some(r => r.status === 'fulfilled' && r.value?.success);
        if (!success) return res.status(400).json({ error: 'disconnect_failed' });
        res.json({ success: true });
    });
};
