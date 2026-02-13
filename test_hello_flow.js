const db = require('./db');
const axios = require('axios');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TRANSLATOR_URL = process.env.TRANSLATOR_URL || 'http://localhost:3004/normalize';

async function testHelloFlow() {
    console.log('\n=== Testing "hello" Message Flow ===\n');

    // Step 1: Call translator
    console.log('1. Calling translator with "hello"...');
    const tRes = await axios.post(TRANSLATOR_URL, { query: 'hello' });
    console.log('   Translator response:', JSON.stringify(tRes.data, null, 2));

    const semantic = tRes.data;
    const intent = semantic?.intent || 'hello';

    console.log('\n2. Checking intent routing...');
    console.log(`   Intent: "${intent}"`);
    console.log(`   Will trigger sendMenu: ${['menu', 'hi', 'hello', 'hey', 'start'].includes(intent)}`);

    // Step 3: Simulate sendMenu
    if (['menu', 'hi', 'hello', 'hey', 'start'].includes(intent)) {
        console.log('\n3. sendMenu() would be called!');
        console.log('   Fetching dynamic content...\n');

        const tenantId = process.env.TENANT_ID;

        // Fetch categories
        const categoriesRes = await db.query(
            "SELECT name FROM categories WHERE tenant_id = $1 AND is_active = true ORDER BY RANDOM() LIMIT 3",
            [tenantId]
        );
        const categories = categoriesRes.rows.map(r => r.name);
        console.log('   Categories:', categories);

        // Load terms
        const canonicalPath = path.join(__dirname, '../be3_translator/canonical_terms.json');
        if (fs.existsSync(canonicalPath)) {
            const terms = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
            const productTerms = terms.filter(t => t.type === 'product');
            const clauseTerms = terms.filter(t => t.type === 'clause');

            const shuffledProducts = productTerms.sort(() => 0.5 - Math.random());
            const products = shuffledProducts.slice(0, 3).map(p => p.text);

            const shuffledClauses = clauseTerms.sort(() => 0.5 - Math.random());
            const clauses = shuffledClauses.slice(0, 2).map(c => c.text);

            console.log('   Products:', products);
            console.log('   Clauses:', clauses);

            console.log('\n✅ Dynamic welcome message would be sent!\n');
        }
    } else {
        console.log('\n❌ sendMenu() would NOT be called');
        console.log(`   Intent "${intent}" not in menu triggers\n`);
    }

    process.exit(0);
}

testHelloFlow().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
