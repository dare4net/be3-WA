/**
 * Automated Test Suite for Context-Aware Bot
 */

const { cleanForTranslator, stripEmojis } = require('./textUtils');
const QuestionWrapper = require('./questionWrapper');
const ContextMemory = require('./contextMemory');
const axios = require('axios');

const questionWrapper = new QuestionWrapper();
const contextMemory = new ContextMemory();

console.log('🧪 Running Context-Aware Bot Tests...\n');

// Test 1: Emoji Stripping
console.log('Test 1: Emoji Stripping');
const emojiTests = [
    { input: "Do you have laptops??? 😊🔥💯", expected: "Do you have laptops?" },
    { input: "🔥 latest headphones 🎧", expected: "latest headphones" },
    { input: "No emojis here", expected: "No emojis here" }
];

emojiTests.forEach((test, i) => {
    const result = cleanForTranslator(test.input);
    const pass = result === test.expected;
    console.log(`  ${i + 1}. ${pass ? '✅' : '❌'} Input: "${test.input}"`);
    console.log(`     Output: "${result}"`);
    console.log(`     Expected: "${test.expected}"`);
});

// Test 2: Question Detection
console.log('\nTest 2: Question Detection');
const questionTests = [
    { input: "Do you have laptops?", expectedQuestion: true, expectedType: 'availability' },
    { input: "How much is iPhone 15?", expectedQuestion: true, expectedType: 'price' },
    { input: "show me phones", expectedQuestion: false, expectedType: null },
    { input: "Is there any apple products?", expectedQuestion: true, expectedType: 'availability' }
];

questionTests.forEach((test, i) => {
    const isQuestion = questionWrapper.detectQuestion(test.input);
    const questionType = isQuestion ? questionWrapper.classifyQuestion(test.input) : null;
    const pass = isQuestion === test.expectedQuestion && questionType === test.expectedType;
    console.log(`  ${i + 1}. ${pass ? '✅' : '❌'} Input: "${test.input}"`);
    console.log(`     Is Question: ${isQuestion} (expected: ${test.expectedQuestion})`);
    console.log(`     Type: ${questionType} (expected: ${test.expectedType})`);
});

// Test 3: Context Memory - Refinement Detection
console.log('\nTest 3: Refinement Detection');
const refinementTests = [
    { input: "cheaper", expectedType: 'price_lower' },
    { input: "expensive", expectedType: 'price_higher' },
    { input: "more", expectedType: 'show_more' },
    { input: "show me laptops", expectedType: null }
];

refinementTests.forEach((test, i) => {
    const refinement = contextMemory.detectRefinement(test.input);
    const pass = refinement?.type === test.expectedType;
    console.log(`  ${i + 1}. ${pass ? '✅' : '❌'} Input: "${test.input}"`);
    console.log(`     Detected: ${refinement?.type || 'none'} (expected: ${test.expectedType || 'none'})`);
});

// Test 4: Translator Integration (with tag support)
console.log('\nTest 4: Translator Integration');
const translatorTests = [
    { query: "latest headphones", expectedType: 'tag' },
    { query: "trending products", expectedType: 'tag' },
    { query: "apple laptops", expectedType: 'brand' },
    { query: "vibrant headphones", expectedType: 'clause' }
];

async function testTranslator() {
    const TRANSLATOR_URL = 'http://localhost:3004/normalize';

    for (const test of translatorTests) {
        try {
            const cleaned = cleanForTranslator(test.query);
            const response = await axios.post(TRANSLATOR_URL, { query: cleaned });

            if (response.data.success) {
                const semantic = response.data;
                const pass = semantic.type === test.expectedType;
                console.log(`  ${pass ? '✅' : '❌'} Query: "${test.query}"`);
                console.log(`     Matched: "${semantic.canonical_term}" (type: ${semantic.type})`);
                console.log(`     Expected type: ${test.expectedType}`);
            } else {
                console.log(`  ❌ Query: "${test.query}" - No match found`);
            }
        } catch (err) {
            console.log(`  ❌ Query: "${test.query}" - Error: ${err.message}`);
        }
    }
}

// Test 5: Context Memory - History
console.log('\nTest 5: Context Memory History');
const mockSession = { history: [] };

// Add some searches
contextMemory.addToHistory(mockSession, "show me phones", { intent: 'search', canonical_term: 'phones' });
contextMemory.addToHistory(mockSession, "view cart", { intent: 'cart' });
contextMemory.addToHistory(mockSession, "show me laptops", { intent: 'search', canonical_term: 'laptops' });

const lastSearch = contextMemory.getLastSearch(mockSession);
const pass = lastSearch?.canonical_term === 'laptops';
console.log(`  ${pass ? '✅' : '❌'} Last search retrieved correctly`);
console.log(`     Last search: ${lastSearch?.canonical_term} (expected: laptops)`);
console.log(`     History length: ${mockSession.history.length} (expected: 3)`);

// Run translator tests
console.log('\n⏳ Running translator tests (requires service to be running)...');
testTranslator().then(() => {
    console.log('\n✅ All tests complete!');
}).catch(err => {
    console.error('\n❌ Translator tests failed:', err.message);
});
