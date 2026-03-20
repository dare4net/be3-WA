const db = require('./db');
const axios = require('axios');
require('dotenv').config();

const TRANSLATOR_URL = process.env.TRANSLATOR_URL || 'http://localhost:3004/normalize';
const TENANT_ID = process.env.TENANT_ID;

// Mock socket to capture output
const sock = {
    sendMessage: async (jid, content) => {
        console.log(`\n[BOT RESPONSE to ${jid}]:`);
        console.log(content.text);
        console.log('------------------------------------------');
    }
};

// Simplified sessions
const userSessions = new Map();
function getSession(jid) {
    if (!userSessions.has(jid)) {
        userSessions.set(jid, { state: 'idle', lastProducts: [], cartId: null });
    }
    return userSessions.get(jid);
}

/**
 * Recursive helper to get all descendant category IDs
 */
async function getDescendantCategoryIds(tenantId, categoryId) {
    const ids = [categoryId];
    const res = await db.query(
        "SELECT id FROM categories WHERE tenant_id = $1 AND parent_id = $2 AND is_active = true",
        [tenantId, categoryId]
    );
    for (const row of res.rows) {
        const children = await getDescendantCategoryIds(tenantId, row.id);
        ids.push(...children);
    }
    return ids;
}

/**
 * Helper to translate collection rules/manual IDs into search index SQL
 */
async function getCollectionFilterSQL(tenantId, collectionId, pCount, params) {
    const res = await db.query(
        "SELECT rules, manual_product_ids, excluded_product_ids FROM collections WHERE id = $1 AND tenant_id = $2",
        [collectionId, tenantId]
    );
    if (res.rows.length === 0) return { sql: ' AND FALSE', pCount };

    const { rules, manual_product_ids, excluded_product_ids } = res.rows[0];
    const parsedRules = (typeof rules === 'string' ? JSON.parse(rules) : rules) || [];
    const manualIds = (typeof manual_product_ids === 'string' ? JSON.parse(manual_product_ids) : manual_product_ids) || [];
    const excludedIds = (typeof excluded_product_ids === 'string' ? JSON.parse(excluded_product_ids) : excluded_product_ids) || [];

    let conditions = [];

    if (manualIds.length > 0) {
        conditions.push(`content_id = ANY($${pCount})`);
        params.push(manualIds);
        pCount++;
    }

    for (const rule of parsedRules) {
        const { field, operator, value } = rule;
        switch (field) {
            case 'category':
                const allCatIds = await getDescendantCategoryIds(tenantId, value);
                conditions.push(`metadata->'category_ids' ?| $${pCount}`);
                params.push(allCatIds);
                pCount++;
                break;
            case 'tag':
                conditions.push(`metadata->'tags' ? $${pCount}`);
                params.push(value);
                pCount++;
                break;
            case 'price':
                const pricePath = `metadata->>'price'`;
                const safePrice = `(CASE WHEN ${pricePath} ~ '^-?[0-9.]+$' THEN (${pricePath})::numeric ELSE NULL END)`;
                const sqlOp = operator === 'lt' ? '<' : (operator === 'gt' ? '>' : '=');
                conditions.push(`${safePrice} ${sqlOp} $${pCount}`);
                params.push(parseFloat(value));
                pCount++;
                break;
        }
    }

    let sql = '';
    if (conditions.length > 0) {
        sql = ` AND (${conditions.join(' OR ')})`;
    } else if (manualIds.length === 0) {
        return { sql: ' AND FALSE', pCount };
    }

    if (excludedIds.length > 0) {
        sql += ` AND content_id != ALL($${pCount})`;
        params.push(excludedIds);
        pCount++;
    }

    return { sql, pCount };
}

// Ported Fetch Logic for Testing (same as index.js)
async function fetchSemanticProducts(sock, from, semantic) {
    try {
        const session = getSession(from);
        const tenantId = TENANT_ID;

        // 1. Direct Product Match
        if (semantic.type === 'product') {
            const prodRes = await db.query(
                "SELECT id, name, price, description FROM products WHERE id = $1 AND tenant_id = $2",
                [semantic.id, tenantId]
            );
            if (prodRes.rows.length > 0) {
                const p = prodRes.rows[0];
                session.lastProducts = [p];
                const text = `📦 *${p.name}*\n💰 Price: $${p.price}\n📝 ${p.description || 'No description available.'}\n\n➡️ Type *add 1* to add to cart.`;
                return sock.sendMessage(from, { text });
            }
        }

        // 2. Build Query for List results (Category, Collection, Clause, Brand)
        let queryStr = "SELECT content_id FROM public.search_indexes WHERE tenant_id = $1 AND content_type = 'product' AND is_active = true";
        let params = [tenantId];
        let pCount = 2;

        // Apply Category/Collection Filter
        if (semantic.type === 'category' || semantic.category_id) {
            const catId = semantic.category_id || semantic.id;
            // Recursive resolution
            const allCatIds = await getDescendantCategoryIds(tenantId, catId);
            queryStr += ` AND metadata->'category_ids' ?| $${pCount}`;
            params.push(allCatIds);
            pCount++;
        } else if (semantic.type === 'collection') {
            const collResult = await getCollectionFilterSQL(tenantId, semantic.id, pCount, params);
            queryStr += collResult.sql;
            pCount = collResult.pCount;
        }

        // Apply Attribute/Clause Filter (Brand is a special clause)
        if (['clause', 'brand'].includes(semantic.type) || semantic.clause_name) {
            const attrCode = semantic.attribute_code || semantic.attribute_name?.toLowerCase();
            const clauseName = semantic.clause_name || semantic.canonical_term;

            const attrRes = await db.query(
                "SELECT code, clauses, type FROM public.attributes WHERE tenant_id = $1 AND (code = $2 OR label = $3)",
                [tenantId, attrCode, semantic.attribute_name]
            );

            if (attrRes.rows.length > 0) {
                const { code, clauses, type } = attrRes.rows[0];
                const clausesArr = (typeof clauses === 'string' ? JSON.parse(clauses) : clauses) || [];
                const clause = clausesArr.find(c => c.id === semantic.original_id || c.name === clauseName || c.title === clauseName);

                if (clause) {
                    let op = clause.operator || '=';
                    const ruleVal = clause.value;
                    const isArray = Array.isArray(ruleVal);

                    if (isArray && (op === '=' || op === 'LIKE' || op === 'ILIKE')) {
                        op = (op === 'LIKE' || op === 'ILIKE') ? 'ILIKE ANY' : '= ANY';
                    }

                    if (type === 'number') {
                        const attrPath = `metadata->'attributes'->>$${pCount}`;
                        const safeAttr = `(CASE WHEN ${attrPath} ~ '^-?[0-9.]+$' THEN (${attrPath})::numeric ELSE NULL END)`;
                        queryStr += ` AND ${safeAttr} ${op} ($${pCount + 1}${isArray ? '::numeric[]' : '::numeric'})`;
                    } else {
                        queryStr += ` AND (metadata->'attributes'->>$${pCount})::text ${op} ($${pCount + 1})`;
                    }

                    params.push(code, ruleVal);
                    pCount += 2;
                }
            }
        }

        if (semantic.type === 'attribute') {
            return sock.sendMessage(from, { text: `Which *${semantic.canonical_term}* are you looking for? (e.g., "Apple" for Brand)` });
        }

        queryStr += " LIMIT 5";
        const finalQuery = `SELECT id, name, price FROM products WHERE id IN (${queryStr}) AND status = 'active'`;

        console.log(`[DEBUG] Executing Query with params:`, params);
        const res = await db.query(finalQuery, params);
        session.lastProducts = res.rows;

        if (res.rows.length === 0) {
            return sock.sendMessage(from, { text: `We found a match for "${semantic.canonical_term}" but no products are currently available.` });
        }

        let list = `✨ *Found for "${semantic.canonical_term}":*\n\n`;
        res.rows.forEach((p, i) => {
            list += `[${i + 1}] *${p.name}*\n💰 Price: $${p.price}\n\n`;
        });
        list += `➡️ Type *add <number>* to add to cart.`;

        await sock.sendMessage(from, { text: list });
    } catch (err) {
        console.error('Semantic search error:', err);
    }
}

async function runTests() {
    const testQueries = [
        'I need a cheap android phone',
        'New Arrivals',
        'Windows tablet',
        'Laptops'
    ];

    for (const q of testQueries) {
        console.log(`\n\n>>> TESTING QUERY: "${q}"`);
        try {
            const tRes = await axios.post(TRANSLATOR_URL, { query: q });
            if (tRes.data.success) {
                const semantic = tRes.data;
                console.log(`[TRANSLATOR]: Match="${semantic.canonical_term}", Type="${semantic.type}", Intent="${semantic.intent}"`);
                await fetchSemanticProducts(sock, 'test-user', semantic);
            } else {
                console.log(`[TRANSLATOR]: No match found.`);
            }
        } catch (err) {
            console.error(`[ERROR]: Failed to test "${q}":`, err.message);
        }
    }
    process.exit(0);
}

runTests();
