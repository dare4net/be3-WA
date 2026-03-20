const db = require('./db');
const axios = require('axios');
require('dotenv').config();

const TRANSLATOR_URL = process.env.TRANSLATOR_URL || 'http://localhost:3004/normalize';

// Test cache functionality
const translatorCache = new Map();
const CACHE_MAX_SIZE = 1000;
const CACHE_TTL_MS = 60 * 60 * 1000;

function getCachedTranslation(query) {
    const normalizedQuery = query.toLowerCase().trim();
    const cached = translatorCache.get(normalizedQuery);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
    }
    if (cached) translatorCache.delete(normalizedQuery);
    return null;
}

function setCachedTranslation(query, data) {
    const normalizedQuery = query.toLowerCase().trim();
    if (translatorCache.size >= CACHE_MAX_SIZE) {
        const firstKey = translatorCache.keys().next().value;
        translatorCache.delete(firstKey);
    }
    translatorCache.set(normalizedQuery, { data, timestamp: Date.now() });
}

async function testCache() {
    const testQuery = "I need a cheap android phone";

    console.log('\n=== Cache Test ===\n');

    // First call - should be API call
    console.log('1. First call (should be API call):');
    let cached = getCachedTranslation(testQuery);
    if (!cached) {
        const res = await axios.post(TRANSLATOR_URL, { query: testQuery });
        if (res.data.success) {
            setCachedTranslation(testQuery, res.data);
            console.log('   ✓ API called, result cached');
        }
    }

    // Second call - should be cache hit
    console.log('\n2. Second call (should be cache hit):');
    cached = getCachedTranslation(testQuery);
    if (cached) {
        console.log('   ✓ Cache hit! No API call needed');
        console.log('   Result:', cached.canonical_term);
    } else {
        console.log('   ✗ Cache miss (unexpected)');
    }

    // Test case insensitivity
    console.log('\n3. Testing case insensitivity ("CHEAP ANDROID PHONE"):');
    cached = getCachedTranslation("CHEAP ANDROID PHONE");
    if (cached) {
        console.log('   ✓ Cache hit! Case normalization working');
    } else {
        console.log('   ✗ Cache miss (unexpected)');
    }

    console.log('\n=== Test Complete ===\n');
    process.exit(0);
}

testCache();
