require('dotenv').config();
const holisticStrategy = require('./holisticStrategy');

async function test() {
    process.env.DEBUG = 'TRUE';
    const tenantId = process.env.TENANT_ID;
    await holisticStrategy.loadMetadata(tenantId);

    const testCases = [
        "midrange phones",
        "flagship phones",
        "budget phones",
        "256gb phones"
    ];

    for (const text of testCases) {
        console.log(`\n--- TESTING: "${text}" ---`);
        const semantic = { intent: "search", type: "category", canonical_term: "Smartphones", id: "7b8b5bb4-7878-4203-a550-a0941e1e3eb9" };
        const parsed = await holisticStrategy.parseStatement(text, semantic);
        console.log('FILTERS:');
        console.log(JSON.stringify(parsed.filters, null, 2));
    }
    console.log('--- END TEST ---');
}

test();
