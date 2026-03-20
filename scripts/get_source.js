const db = require('./db');

async function getSuggestionsSource() {
    try {
        console.log('--- Search Filters ---');
        try {
            const sf = await db.query("SELECT * FROM search_filters");
            console.log(sf.rows);
        } catch (e) { console.log('sf error:', e.message); }

        console.log('\n--- Collections ---');
        try {
            const cl = await db.query("SELECT * FROM collections");
            console.log(cl.rows.map(r => ({ id: r.id, name: r.name, type: r.collection_type })));
        } catch (e) { console.log('cl error:', e.message); }

        console.log('\n--- Checking for views again (any schema) ---');
        const views = await db.query("SELECT table_schema, table_name FROM information_schema.views");
        console.log(views.rows);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

getSuggestionsSource();
