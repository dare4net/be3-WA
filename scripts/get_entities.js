const db = require('./db');

async function getEntities() {
    try {
        console.log('--- Global Filters ---');
        const sf = await db.query("SELECT id, filter_key, label FROM search_filters WHERE is_active = true");
        console.log(sf.rows);

        console.log('\n--- Collections ---');
        const cl = await db.query("SELECT id, name, slug, collection_type FROM collections WHERE is_active = true");
        console.log(cl.rows);

        console.log('\n--- categories ---');
        const ct = await db.query("SELECT id, name, slug FROM categories WHERE is_active = true");
        console.log(ct.rows);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

getEntities();
