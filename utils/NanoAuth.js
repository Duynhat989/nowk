const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const VERIFY_URL = 'https://flow-api.nanoai.pics/api/auth/verifyToken';
const SIGNIN_BASE = 'https://veo.nanoai.pics/desktop/signin';
const LISTEN_PORT = 27123;
const SESSION_TTL_MS = 15 * 60 * 1000;
const VERIFY_EVERY_MS = 5 * 60 * 1000;
const VERIFY_FAIL_LIMIT = 3;

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
    };
}

function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        ...corsHeaders(),
    });
    res.end(payload);
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch {
                resolve({});
            }
        });
        req.on('error', () => resolve({}));
    });
}

class NanoAuth {
    constructor(configDir) {
        this.file = path.join(configDir, 'auth.json');
        this.sessions = new Map();
        this.pendingAccessToken = '';
        this.server = null;
        this.port = 0;
        this.verifyTimer = null;
        this.verifyFails = 0;
        this.onHeartbeat = null;
        this.onForcedLogout = null;
        this.cached = { accessToken: '', balance: 0 };
    }

    async load() {
        try {
            const parsed = JSON.parse(await fsp.readFile(this.file, 'utf8'));
            this.cached = {
                accessToken: String(parsed.accessToken || ''),
                balance: Number(parsed.balance) || 0,
            };
        } catch {
            this.cached = { accessToken: '', balance: 0 };
        }
        return this.cached;
    }

    async save(partial) {
        this.cached = { ...this.cached, ...partial };
        await fsp.mkdir(path.dirname(this.file), { recursive: true });
        await fsp.writeFile(this.file, JSON.stringify(this.cached, null, 2), 'utf8');
        return this.cached;
    }

    async clear() {
        this.stopWatch();
        this.verifyFails = 0;
        this.cached = { accessToken: '', balance: 0 };
        try {
            await fsp.unlink(this.file);
        } catch {
            if (fs.existsSync(this.file)) await fsp.writeFile(this.file, '{}', 'utf8');
        }
        return this.cached;
    }

    prune() {
        const now = Date.now();
        for (const [token, session] of this.sessions) {
            if (now - session.createdAt > SESSION_TTL_MS) this.sessions.delete(token);
        }
    }

    register(token) {
        if (!token) throw new Error('Missing token');
        this.prune();
        this.sessions.set(token, { createdAt: Date.now(), accessToken: '' });
        return { success: true };
    }

    abandon(token) {
        if (token) this.sessions.delete(token);
        return { success: true };
    }

    complete(token, accessToken) {
        if (!accessToken) return { success: false, message: 'Missing token' };
        if (!token) {
            this.pendingAccessToken = accessToken;
            return { success: true };
        }
        const session = this.sessions.get(token) || { createdAt: Date.now(), accessToken: '' };
        session.accessToken = accessToken;
        this.sessions.set(token, session);
        return { success: true };
    }

    poll(token) {
        if (this.pendingAccessToken) {
            const accessToken = this.pendingAccessToken;
            this.pendingAccessToken = '';
            if (token) this.sessions.delete(token);
            return { success: true, data: { access_token: accessToken } };
        }
        const session = this.sessions.get(token);
        if (!session) return { success: false, pending: true };
        if (session.accessToken) {
            const accessToken = session.accessToken;
            this.sessions.delete(token);
            return { success: true, data: { access_token: accessToken } };
        }
        return { success: false, pending: true };
    }

    signInUrl(token) {
        return `${SIGNIN_BASE}?token=${encodeURIComponent(token)}`;
    }

    acceptListenPayload(body = {}, query = {}) {
        const token = body.token || query.token || '';
        const accessToken = body.data?.access_token
            || body.data?.accessToken
            || body.access_token
            || body.accessToken
            || query.access_token
            || '';
        return this.complete(token, accessToken);
    }

    async verify(accessToken) {
        if (!accessToken) return { success: false, valid: false, balance: 0, token: '' };
        try {
            const res = await fetch(VERIFY_URL, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: 'application/json',
                },
            });
            const data = await res.json().catch(() => null);
            if (!data || typeof data !== 'object') {
                return { success: false, valid: false, balance: 0, token: '', network: true };
            }
            const ok = data.success === true;
            const nextToken = String(data?.data?.token || '');
            const balance = Number(data?.data?.balance) || 0;
            return { success: ok, valid: ok, balance, token: nextToken, network: false };
        } catch (err) {
            console.error('verifyToken error:', err.message);
            return { success: false, valid: false, balance: 0, token: '', network: true };
        }
    }

    startWatch() {
        this.stopWatch();
        this.verifyFails = 0;
        if (!this.cached.accessToken) return;
        this.verifyTimer = setInterval(() => {
            this.tickVerify().catch((err) => console.error('[auth] verify tick', err.message));
        }, VERIFY_EVERY_MS);
    }

    stopWatch() {
        if (this.verifyTimer) {
            clearInterval(this.verifyTimer);
            this.verifyTimer = null;
        }
    }

    async tickVerify() {
        const token = this.cached.accessToken;
        if (!token) {
            this.stopWatch();
            return;
        }
        const checked = await this.verify(token);
        if (checked.network) return;
        if (checked.success) {
            this.verifyFails = 0;
            const next = { balance: checked.balance };
            if (checked.token) next.accessToken = checked.token;
            await this.save(next);
            this.onHeartbeat?.({
                loggedIn: true,
                balance: this.cached.balance,
            });
            return;
        }
        this.verifyFails += 1;
        if (this.verifyFails < VERIFY_FAIL_LIMIT) return;
        await this.clear();
        this.onForcedLogout?.({ reason: 'verify-failed' });
    }

    async startServer() {
        if (this.server) return this.port;
        this.server = http.createServer(async (req, res) => {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, corsHeaders());
                res.end();
                return;
            }

            const url = new URL(req.url || '/', `http://127.0.0.1:${this.port || LISTEN_PORT}`);
            const route = url.pathname.replace(/\/+$/, '') || '/';

            try {
                if ((req.method === 'POST' || req.method === 'GET') && route === '/listen') {
                    const body = req.method === 'POST' ? await readBody(req) : {};
                    json(res, 200, this.acceptListenPayload(body, Object.fromEntries(url.searchParams)));
                    return;
                }
                if (req.method === 'POST' && route === '/api/auth/signin-register') {
                    const body = await readBody(req);
                    json(res, 200, this.register(body.token || url.searchParams.get('token')));
                    return;
                }
                if (req.method === 'POST' && route === '/api/auth/signin-abandon') {
                    const body = await readBody(req);
                    json(res, 200, this.abandon(body.token || url.searchParams.get('token')));
                    return;
                }
                if ((req.method === 'POST' || req.method === 'GET') && route === '/api/auth/signin-complete') {
                    const body = req.method === 'POST' ? await readBody(req) : {};
                    const result = this.acceptListenPayload(body, Object.fromEntries(url.searchParams));
                    if (req.method === 'GET') {
                        const html = '<!doctype html><meta charset="utf-8"><title>NowK</title><p>Signed in. You can close this tab.</p>';
                        res.writeHead(200, {
                            'Content-Type': 'text/html; charset=utf-8',
                            'Access-Control-Allow-Origin': '*',
                        });
                        res.end(html);
                        return;
                    }
                    json(res, 200, result);
                    return;
                }
                if (req.method === 'GET' && route === '/api/auth/signin-poll') {
                    json(res, 200, this.poll(url.searchParams.get('token')));
                    return;
                }
                json(res, 404, { success: false, message: 'Not found' });
            } catch (err) {
                json(res, 400, { success: false, message: err.message || 'Bad request' });
            }
        });

        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(LISTEN_PORT, '0.0.0.0', () => {
                this.port = LISTEN_PORT;
                this.server.removeListener('error', reject);
                console.log(`[auth] listening on http://localhost:${LISTEN_PORT}/listen`);
                resolve();
            });
        });
        return this.port;
    }

    applyDeepLink(rawUrl) {
        try {
            const parsed = new URL(rawUrl);
            const token = parsed.searchParams.get('token') || '';
            const accessToken = parsed.searchParams.get('access_token')
                || parsed.searchParams.get('accessToken')
                || '';
            if (token && accessToken) this.complete(token, accessToken);
            else if (accessToken) this.pendingAccessToken = accessToken;
            return { token, accessToken };
        } catch {
            return { token: '', accessToken: '' };
        }
    }
}

module.exports = NanoAuth;
module.exports.SIGNIN_BASE = SIGNIN_BASE;
module.exports.LISTEN_PORT = LISTEN_PORT;
module.exports.VERIFY_EVERY_MS = VERIFY_EVERY_MS;
module.exports.VERIFY_FAIL_LIMIT = VERIFY_FAIL_LIMIT;
