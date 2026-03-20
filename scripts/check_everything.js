const db = require('./db');

async function checkEverything() {
    try {
        console.log('--- All Content Types in search_indexes ---');
        const ct = await db.query("SELECT content_type, count(*) FROM search_indexes GROUP BY content_type");
        console.log(ct.rows);

        console.log('\n--- Collection Types ---');
        const cct = await db.query("SELECT DISTINCT collection_type FROM collections");
        console.log(cct.rows);

        console.log('\n--- Checking search_filters table again ---');
        try {
            const sf = await db.query("SELECT * FROM search_filters LIMIT 5");
            console.log(sf.rows);
        } catch (e) {
            console.log("sf failed:", e.message);
        }

        console.log('\n--- Checking search_configs ---');
        try {
            const sc = await db.query("SELECT * FROM search_configs");
            console.log(sc.rows);
        } catch (e) {
            console.log("sc failed:", e.message);
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkEverything();
