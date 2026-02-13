const db = require('./db');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function testMenu() {
    const tenantId = process.env.TENANT_ID;

    // Fetch random categories
    const categoriesRes = await db.query(
        "SELECT name FROM categories WHERE tenant_id = $1 AND is_active = true ORDER BY RANDOM() LIMIT 3",
        [tenantId]
    );
    const categories = categoriesRes.rows.map(r => r.name);

    // Load canonical terms
    const canonicalPath = path.join(__dirname, '../be3_translator/canonical_terms.json');
    let products = [];
    let clauses = [];

    if (fs.existsSync(canonicalPath)) {
        const terms = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
        const productTerms = terms.filter(t => t.type === 'product');
        const clauseTerms = terms.filter(t => t.type === 'clause');

        const shuffledProducts = productTerms.sort(() => 0.5 - Math.random());
        products = shuffledProducts.slice(0, 3).map(p => p.text);

        const shuffledClauses = clauseTerms.sort(() => 0.5 - Math.random());
        clauses = shuffledClauses.slice(0, 2).map(c => c.text);
    }

    const categoryList = categories.length > 0 ? categories.join(', ') : 'Electronics, Fashion, Home & Garden';

    let message = `🛍️ *Welcome to Be3!*\n\n`;
    message += `Your one-stop shop for ${categoryList}, and much more!\n\n`;
    message += `*What can I help you with?*\n\n`;
    message += `📦 *Browse* - Explore our products\n`;
    message += `🛒 *Cart* - View your shopping cart\n`;
    message += `📍 *Status* - Track your orders\n`;
    message += `🔍 *Search* - Find anything you need!\n\n`;
    message += `💡 *Try searching for:*\n`;

    if (products.length > 0) {
        products.forEach(p => {
            message += `   • ${p}\n`;
        });
    }

    if (clauses.length > 0) {
        clauses.forEach(c => {
            message += `   • ${c}\n`;
        });
    }

    message += `\nJust type what you're looking for, or choose an option above! 😊`;

    console.log('\n=== DYNAMIC WELCOME MESSAGE ===\n');
    console.log(message);
    console.log('\n=== END ===\n');

    process.exit(0);
}

testMenu();
