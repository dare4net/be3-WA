const db = require('./db');

async function findStored() {
    try {
        console.log('--- Searching for "Global" or "Special" in search_indexes ---');
        const res = await db.query("SELECT content_type, title, metadata FROM search_indexes WHERE title ILIKE '%Global%' OR title ILIKE '%Special%'");
        console.log(res.rows);

        console.log('\n--- Checking search_filters table again (raw) ---');
        const sf = await db.query("SELECT * FROM search_filters");
        console.log('Filters count:', sf.rows.length);
        if (sf.rows.length > 0) console.log(sf.rows);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

findStored();
