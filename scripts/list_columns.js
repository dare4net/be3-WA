const db = require('./db');

async function listColumns() {
    try {
        const tables = ['search_filters', 'search_indexes', 'collections', 'categories', 'attributes', 'search_analytics'];
        for (const table of tables) {
            const res = await db.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1 
                AND table_schema = 'public'
            `, [table]);
            console.log(`--- Table: ${table} ---`);
            console.log(res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
            console.log('');
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

listColumns();
