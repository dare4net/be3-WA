require('dotenv').config();
const holisticStrategy = require('./holisticStrategy');

async function verifyThoughtProcess() {
    process.env.DEBUG = 'TRUE'; // Ensure it's active for this test
    const tenantId = process.env.TENANT_ID;

    console.log(`--- VERIFYING HOLISTIC RESOLUTION (TENANT: ${tenantId}) ---`);

    // 1. Test Metadata Load (Real DB)
    await holisticStrategy.loadMetadata(tenantId);
    if (!holisticStrategy.isLoaded) {
        console.error('FAILED to load metadata. Check your DB connection and UUID.');
        return;
    }

    // 2. Test Statement with Lookahead and Thoughts
    // Example: "low price laptops" or "under 500 intel laptops"
    const testCases = [
        { text: "low price laptops", semantic: { intent: "search", type: "category", canonical_term: "Laptops", category_id: "dfa80cc4-f95a-4c87-949b-8b0438b28949" } },
        { text: "cheap smartphones", semantic: { intent: "search", type: "clause", canonical_term: "Smartphones", id: "cl_cat_7b8b5bb4-7878-4203-a550-a0941e1e3eb9_a15ebfba-3bc6-4819-867c-ae57b74ce4b6_u", category_id: "7b8b5bb4-7878-4203-a550-a0941e1e3eb9" } }
    ];

    for (const test of testCases) {
        console.log(`\n>>> TESTING: "${test.text}"`);
        const parsed = await holisticStrategy.parseStatement(test.text, test.semantic);
        console.log('>>> BASE:', JSON.stringify(parsed.base, null, 2));
        console.log('>>> SUMMARY:', holisticStrategy.getHumanSummary(parsed));
    }

    console.log('\n--- VERIFICATION COMPLETED ---');
}

verifyThoughtProcess().catch(err => {
    console.error('Verification script failed:', err);
});
