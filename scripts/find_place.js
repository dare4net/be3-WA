const db = require('./db');

async function findPlace() {
    try {
        console.log('--- Views ---');
        const viewsRes = await db.query(`
            SELECT table_name 
            FROM information_schema.views 
            WHERE table_schema = 'public'
        `);
        console.log(viewsRes.rows.map(r => r.table_name).join(', '));

        console.log('\n--- Checking collections for "special" ones ---');
        const collRes = await db.query(`
            SELECT column_name FROM information_schema.columns WHERE table_name = 'collections'
        `);
        console.log('Collections Columns:', collRes.rows.map(r => r.column_name).join(', '));

        const collData = await db.query(`SELECT id, name, slug FROM collections LIMIT 5`);
        console.log('Collections Sample:', collData.rows);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

findPlace();
