import crypto from 'crypto';

function base64Url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export default class UiRegistry {
    constructor({ ttlMs = 10 * 60 * 1000, maxEntries = 500 } = {}) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this._map = new Map();
    }

    create({ sponsor, actions }) {
        const token = base64Url(crypto.randomBytes(9));
        const now = Date.now();
        const entry = {
            token,
            sponsor,
            actions: Array.isArray(actions) ? actions : [],
            createdAt: now,
            expiresAt: now + this.ttlMs,
        };

        this._map.set(token, entry);
        this._gc();

        return entry;
    }

    get(token) {
        const entry = this._map.get(token);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this._map.delete(token);
            return null;
        }
        return entry;
    }

    resolve(actionToken) {
        const parsed = UiRegistry.parseActionToken(actionToken);
        if (!parsed) return null;

        const entry = this.get(parsed.token);
        if (!entry) return null;

        const action = entry.actions?.find(a => a && a.key === parsed.actionKey) || null;
        if (!action) return null;

        return { entry, action };
    }

    _gc() {
        const now = Date.now();
        for (const [token, entry] of this._map.entries()) {
            if (!entry || entry.expiresAt <= now) this._map.delete(token);
        }

        if (this._map.size <= this.maxEntries) return;

        const entries = Array.from(this._map.entries()).sort((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0));
        const overflow = this._map.size - this.maxEntries;
        for (let i = 0; i < overflow; i++) {
            this._map.delete(entries[i][0]);
        }
    }

    static buildActionToken(token, actionKey) {
        return `ui:${token}:${actionKey}`;
    }

    static parseActionToken(text) {
        if (!text) return null;
        const s = String(text).trim();
        if (!s.startsWith('ui:')) return null;
        const parts = s.split(':');
        if (parts.length !== 3) return null;
        const [, token, actionKey] = parts;
        if (!token || !actionKey) return null;
        return { token, actionKey };
    }
}
