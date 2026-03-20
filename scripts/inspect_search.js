const db = require('./db');

async function inspectSearchData() {
    try {
        console.log('--- Search Indexes - Content Types ---');
        const ctRes = await db.query("SELECT DISTINCT content_type FROM public.search_indexes");
        console.log(ctRes.rows.map(r => r.content_type).join(', '));

        console.log('\n--- Search Filters ---');
        const filterRes = await db.query("SELECT * FROM public.search_filters LIMIT 10");
        console.log(JSON.stringify(filterRes.rows, null, 2));

        console.log('\n--- Collections ---');
        const collRes = await db.query("SELECT id, name, slug, collection_type FROM public.collections LIMIT 10");
        console.log(JSON.stringify(collRes.rows, null, 2));

        console.log('\n--- Views ---');
        const viewsRes = await db.query(`
            SELECT table_name 
            FROM information_schema.views 
            WHERE table_schema = 'public'
        `);
        console.log(viewsRes.rows.map(r => r.table_name).join(', '));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

inspectSearchData();
