const db = require('./db');

async function checkCollections() {
    try {
        console.log('--- Collection items in search_indexes ---');
        const res = await db.query("SELECT title, metadata FROM search_indexes WHERE content_type = 'collection' LIMIT 5");
        console.log(res.rows);

        console.log('\n--- Categories in search_indexes ---');
        const cres = await db.query("SELECT title, metadata FROM search_indexes WHERE content_type = 'category' LIMIT 5");
        console.log(cres.rows);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkCollections();
