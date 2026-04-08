import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { createClient } from 'redis';

function makeKey(prefix, suffix) {
    return `${prefix}:${suffix}`;
}

export async function useRedisAuthState({ url, keyPrefix = 'wa:auth', ttlSec = 0 }) {
    if (!url) {
        throw new Error('REDIS_URL is required for Redis auth state');
    }

    const client = createClient({ url });
    client.on('error', (err) => {
        console.error('[REDIS] Client error:', err?.message || err);
    });

    if (!client.isOpen) {
        await client.connect();
    }

    const credsKey = makeKey(keyPrefix, 'creds');

    const readData = async (key) => {
        const value = await client.get(key);
        if (!value) return null;
        return JSON.parse(value, BufferJSON.reviver);
    };

    const writeData = async (key, data) => {
        const payload = JSON.stringify(data, BufferJSON.replacer);
        if (ttlSec && ttlSec > 0) {
            await client.setEx(key, ttlSec, payload);
        } else {
            await client.set(key, payload);
        }
    };

    const removeData = async (key) => {
        await client.del(key);
    };

    const creds = (await readData(credsKey)) || initAuthCreds();

    const keys = {
        get: async (type, ids) => {
            const data = {};
            await Promise.all(
                ids.map(async (id) => {
                    const key = makeKey(keyPrefix, `${type}:${id}`);
                    let value = await readData(key);
                    if (type === 'app-state-sync-key' && value) {
                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    data[id] = value;
                })
            );
            return data;
        },
        set: async (data) => {
            const multi = client.multi();
            for (const category in data) {
                for (const id in data[category]) {
                    const value = data[category][id];
                    const key = makeKey(keyPrefix, `${category}:${id}`);
                    if (value) {
                        const payload = JSON.stringify(value, BufferJSON.replacer);
                        if (ttlSec && ttlSec > 0) {
                            multi.setEx(key, ttlSec, payload);
                        } else {
                            multi.set(key, payload);
                        }
                    } else {
                        multi.del(key);
                    }
                }
            }
            await multi.exec();
        },
    };

    const clear = async () => {
        const pattern = `${keyPrefix}:*`;
        const toDelete = [];
        let deleted = 0;
        for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 200 })) {
            toDelete.push(key);
            if (toDelete.length >= 500) {
                deleted += await client.del(...toDelete);
                toDelete.length = 0;
            }
        }
        if (toDelete.length > 0) {
            deleted += await client.del(...toDelete);
        }
        return deleted;
    };

    return {
        state: { creds, keys },
        saveCreds: async () => writeData(credsKey, creds),
        clear,
        client,
    };
}
