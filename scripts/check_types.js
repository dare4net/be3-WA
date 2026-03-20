const db = require('./db');

async function checkIndexTypes() {
    try {
        const res = await db.query("SELECT DISTINCT content_type FROM search_indexes");
        console.log('Search Index Content Types:', res.rows.map(r => r.content_type));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkIndexTypes();
