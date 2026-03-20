const db = require('./db');
require('dotenv').config();

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

async function debug() {
    const tenantId = process.env.TENANT_ID;
    // Semantic match for "cheap android phone"
    const semantic = {
        type: 'clause',
        category_id: '5cba5153-0772-450a-b8b7-8a4fa532ecc1',
        attribute_code: 'p',
        clause_name: 'p',
        canonical_term: 'cheap Android Phones'
    };

    try {
        let queryStr = "SELECT content_id FROM public.search_indexes WHERE tenant_id = $1 AND content_type = 'product' AND is_active = true";
        let params = [tenantId];
        let pCount = 2;

        if (semantic.type === 'category' || semantic.category_id) {
            const catId = semantic.category_id || semantic.id;
            const allCatIds = await getDescendantCategoryIds(tenantId, catId);
            queryStr += ` AND metadata->'category_ids' ?| $${pCount}`;
            params.push(allCatIds);
            pCount++;
        }

        if (['clause', 'brand'].includes(semantic.type) || semantic.clause_name) {
            const attrCode = semantic.attribute_code;
            const clauseName = semantic.clause_name;

            const attrRes = await db.query(
                "SELECT code, clauses, type FROM public.attributes WHERE tenant_id = $1 AND (code = $2)",
                [tenantId, attrCode]
            );

            if (attrRes.rows.length > 0) {
                const { code, clauses, type } = attrRes.rows[0];
                const clausesArr = (typeof clauses === 'string' ? JSON.parse(clauses) : clauses) || [];
                const clause = clausesArr.find(c => c.name === clauseName);

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

        const finalQuery = `SELECT id, name FROM products WHERE id IN (${queryStr}) AND status = 'active'`;

        console.log('SQL:', finalQuery);
        console.log('PARAMS:', JSON.stringify(params, null, 2));

        const res = await db.query(finalQuery, params);
        console.log('RESULTS:', res.rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debug();
