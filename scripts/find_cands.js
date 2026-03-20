const db = require('./db');

async function findCands() {
    try {
        console.log('--- Search Indexes - Non-Product Types ---');
        const ctRes = await db.query("SELECT DISTINCT content_type, count(*) FROM public.search_indexes GROUP BY content_type");
        console.log(ctRes.rows);

        console.log('\n--- Search Configs ---');
        const configRes = await db.query("SELECT * FROM public.search_configs LIMIT 10");
        console.log(configRes.rows);

        console.log('\n--- Search Filters contents ---');
        const filterRes = await db.query("SELECT * FROM public.search_filters LIMIT 5");
        console.log(filterRes.rows);

        console.log('\n--- Collections Types ---');
        const collRes = await db.query("SELECT DISTINCT collection_type FROM public.collections");
        console.log(collRes.rows);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

findCands();
