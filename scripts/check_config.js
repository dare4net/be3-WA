const db = require('./db');

async function checkConfig() {
    try {
        const res = await db.query("SELECT * FROM search_configs");
        console.log('Search Configs:', res.rows);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkConfig();
