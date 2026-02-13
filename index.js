const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
require('dotenv').config(); // Ensure env is loaded
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const db = require('./db');
const axios = require('axios');
const QuestionWrapper = require('./questionWrapper');
const ContextMemory = require('./contextMemory');
const { cleanForTranslator } = require('./textUtils');
const holisticStrategy = require('./holisticStrategy');

// Multi-user state management
const userSessions = new Map();
const TRANSLATOR_URL = process.env.TRANSLATOR_URL || 'http://localhost:3004/normalize';

// Initialize context-aware modules
const questionWrapper = new QuestionWrapper();
const contextMemory = new ContextMemory();

// Load metadata on startup (Using Tenant ID from .env)
let tenantId = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';
if (tenantId === 'be3') tenantId = 'cbe1df05-45ed-455a-9ce6-156b0bd45713'; // Force valid UUID

console.log(`[BOT] Initializing with Tenant ID: ${tenantId}`);
holisticStrategy.loadMetadata(tenantId).then(() => {
    console.log(`[BOT] Holistic metadata loaded successfully for tenant: ${tenantId}`);
}).catch(err => {
    console.error(`[BOT] Failed to load holistic metadata for ${tenantId}:`, err);
});

// Translator cache (LRU with TTL)
const translatorCache = new Map();
const CACHE_MAX_SIZE = 1000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

let isConnecting = false;

async function connectToWhatsApp() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Using WhatsApp version v${version.join('.')}, isLatest: ${isLatest}`);

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            auth: state,
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('--- NEW QR CODE GENERATED ---');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                isConnecting = false;
                const statusCode = (lastDisconnect.error instanceof Boom)
                    ? lastDisconnect.error.output?.statusCode
                    : null;

                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`[BOT] Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);

                if (shouldReconnect) {
                    // Add a small delay for reconnection to avoid tight loops
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                isConnecting = false;
                console.log('✅ WhatsApp connection opened successfully');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type === 'notify') {
                for (const msg of messages) {
                    if (!msg.key.fromMe && msg.message) {
                        const from = msg.key.remoteJid;
                        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
                        if (text) await handleMessage(sock, from, text);
                    }
                }
            }
        });
    } catch (err) {
        isConnecting = false;
        console.error('❌ Error in connectToWhatsApp:', err);
        setTimeout(() => connectToWhatsApp(), 5000);
    }
}

function getSession(jid) {
    if (!userSessions.has(jid)) {
        userSessions.set(jid, {
            state: 'idle',
            lastProducts: [],
            cartId: null
        });
    }
    return userSessions.get(jid);
}

/**
 * Send dynamic welcome menu with random suggestions
 */
async function sendMenu(sock, from) {
    console.log('[sendMenu] Function called for', from);
    try {
        const tenantId = process.env.TENANT_ID;
        console.log('[sendMenu] Tenant ID:', tenantId);

        // Fetch random categories
        console.log('[sendMenu] Fetching categories...');
        const categoriesRes = await db.query(
            "SELECT name FROM categories WHERE tenant_id = $1 AND is_active = true ORDER BY RANDOM() LIMIT 3",
            [tenantId]
        );
        const categories = categoriesRes.rows.map(r => r.name);
        console.log('[sendMenu] Categories:', categories);

        // Load canonical terms for random suggestions
        const fs = require('fs');
        const canonicalPath = require('path').join(__dirname, '../be3_translator/canonical_terms.json');
        console.log('[sendMenu] Canonical path:', canonicalPath);
        let products = [];
        let clauses = [];

        if (fs.existsSync(canonicalPath)) {
            console.log('[sendMenu] Loading canonical terms...');
            const terms = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
            const productTerms = terms.filter(t => t.type === 'product');
            const clauseTerms = terms.filter(t => t.type === 'clause');

            // Get 3 random products
            const shuffledProducts = productTerms.sort(() => 0.5 - Math.random());
            products = shuffledProducts.slice(0, 3).map(p => p.text);

            // Get 2 random clauses
            const shuffledClauses = clauseTerms.sort(() => 0.5 - Math.random());
            clauses = shuffledClauses.slice(0, 2).map(c => c.text);
            console.log('[sendMenu] Loaded', products.length, 'products and', clauses.length, 'clauses');
        } else {
            console.log('[sendMenu] Canonical terms file not found!');
        }

        const categoryList = categories.length > 0 ? categories.join(', ') : 'Electronics, Fashion, Home & Garden';

        let message = `🛍️ *Welcome to Be3!*\n\n`;
        message += `Your one-stop shop for ${categoryList}, and much more!\n\n`;
        message += `*What can I help you with?*\n\n`;
        message += `1️⃣ *Browse* - Explore our products\n`;
        message += `2️⃣ *Cart* - View your shopping cart\n`;
        message += `3️⃣ *Status* - Track your orders\n`;
        message += `4️⃣ *Search* - Find anything you need!\n\n`;
        message += `💡 *Try searching for:*\n`;

        // Add product suggestions
        if (products.length > 0) {
            products.forEach(p => {
                message += `   • ${p}\n`;
            });
        }

        // Add clause suggestions
        if (clauses.length > 0) {
            clauses.forEach(c => {
                message += `   • ${c}\n`;
            });
        }

        message += `\nJust type what you're looking for, or choose an option above! 😊`;

        console.log(`[THOUGHT PROCESS] Final Response (Menu): ${message.substring(0, 100)}...`);
        await sock.sendMessage(from, { text: message });
    } catch (err) {
        console.error('❌ Error in sendMenu:', err.message);
        console.error('Stack:', err.stack);
        // Fallback message
        const fallback = `🛍️ *Welcome to Be3!*\n\nYour one-stop shop for everything you need!\n\n*What can I help you with?*\n\n📦 Browse\n🛒 Cart\n📍 Status\n🔍 Search\n\nJust tell me what you're looking for! 😊`;
        console.log(`[THOUGHT PROCESS] Final Response (Menu Fallback): ${fallback.substring(0, 100)}...`);
        await sock.sendMessage(from, {
            text: fallback
        });
    }
}

async function handleMessage(sock, from, text) {
    try {
        const session = getSession(from);
        const rawText = text.trim();

        // Clean text: remove emojis before processing
        const cleanedText = cleanForTranslator(rawText);
        const command = cleanedText.toLowerCase();

        // 1. Check for specific numeric shortcuts (add X)
        if (command.startsWith('add ')) {
            const index = parseInt(command.split(' ')[1]);
            if (!isNaN(index)) return addToCart(sock, from, index);
        }

        // *** AI AGENT INTEGRATION ***
        if (process.env.USE_AI_AGENT === 'true') {
            try {
                // Initialize history if needed
                if (!session.history) session.history = [];

                // Add User Message to History
                session.history.push({ role: 'user', text: rawText });

                // Keep history manageable (last 10 messages)
                if (session.history.length > 20) session.history = session.history.slice(-20);

                console.log(`[BOT] Routing message to AI Agent... History Size: ${session.history.length}`);

                const aiRes = await axios.post('http://localhost:3005/chat', {
                    message: rawText,
                    session_id: from,
                    history: session.history.slice(0, -1) // Send previous history, not current msg (server adds it)
                });

                if (aiRes.data.success) {
                    console.log(`[BOT] AI Agent responded.`);

                    // Add AI Response to History
                    session.history.push({ role: 'ai', text: aiRes.data.reply });

                    if (aiRes.data.reply.includes('[CHECKOUT]')) {
                        return startCheckout(sock, from);
                    }

                    // Send the text reply first
                    await sock.sendMessage(from, { text: aiRes.data.reply });

                    // --- INTELLIGENT IMAGE SENDING (Phase 17) ---
                    // Use the AI service's smart image filtering with bot-level deduplication
                    if (aiRes.data.display_images && Array.isArray(aiRes.data.display_images) && aiRes.data.display_images.length > 0) {
                        console.log(`[BOT] AI provided ${aiRes.data.display_images.length} images...`);

                        // Get or initialize image history for this session
                        if (!session.imageHistory) session.imageHistory = new Map();
                        const now = Date.now();
                        const IMAGE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes cooldown per image

                        let sentCount = 0;
                        for (const img of aiRes.data.display_images) {
                            try {
                                // Check if this image was sent recently
                                const lastSent = session.imageHistory.get(img.url);
                                if (lastSent && (now - lastSent) < IMAGE_COOLDOWN_MS) {
                                    console.log(`[BOT] Skipping duplicate image: ${img.caption} (sent ${Math.round((now - lastSent) / 1000)}s ago)`);
                                    continue;
                                }

                                console.log(`[BOT] Sending image: ${img.caption}`);
                                await sock.sendMessage(from, {
                                    image: { url: img.url },
                                    caption: img.caption
                                });

                                // Track this image
                                session.imageHistory.set(img.url, now);
                                sentCount++;

                                // Clean up old history (keep map from growing infinitely)
                                if (session.imageHistory.size > 50) {
                                    const oldestKey = session.imageHistory.keys().next().value;
                                    session.imageHistory.delete(oldestKey);
                                }
                            } catch (imgErr) {
                                console.error(`[BOT] Failed to send image: ${imgErr.message}`);
                            }
                        }

                        console.log(`[BOT] Sent ${sentCount}/${aiRes.data.display_images.length} images (${aiRes.data.display_images.length - sentCount} were duplicates)`);
                    } else {
                        console.log(`[BOT] No images to send (AI decided images not warranted)`);
                    }

                    return;
                }
            } catch (aiErr) {
                console.error(`[BOT] AI Agent failed: ${aiErr.message}. Falling back to legacy logic.`);
            }
        }

        // 2. Extract price if present
        let extractedPrice = null;
        let textForTranslator = cleanedText;
        const priceMatch = cleanedText.match(/\$(\d+)|(\d+)\s*dollars?|price\s*of\s*(\d+)|under\s+(\d+)|around\s+(\d+)/i);
        if (priceMatch) {
            extractedPrice = parseInt(priceMatch[1] || priceMatch[2] || priceMatch[3] || priceMatch[4] || priceMatch[5]);
            textForTranslator = cleanedText.replace(priceMatch[0], '').replace(/\s+/g, ' ').trim();
            console.log(`[PRICE EXTRACTED] $${extractedPrice} from: "${cleanedText}"`);
        }

        // 3. Call Translator
        let semantic = null;
        try {
            const cached = getCachedTranslation(textForTranslator);
            if (cached) {
                console.log(`[THOUGHT PROCESS] Cache HIT for: "${textForTranslator}"`);
                semantic = cached;
            } else {
                console.log(`[THOUGHT PROCESS] API Call: Requesting translator for "${textForTranslator}"...`);
                const tRes = await axios.post(TRANSLATOR_URL, { query: textForTranslator });
                if (tRes.data.success) {
                    semantic = tRes.data;
                    console.log(`[THOUGHT PROCESS] Translator RESPONSE: success=${semantic.success}, intent=${semantic.intent}, type=${semantic.type}, id=${semantic.id || semantic.category_id}`);
                    setCachedTranslation(textForTranslator, semantic);
                } else {
                    console.log(`[THOUGHT PROCESS] Translator FAILED: ${JSON.stringify(tRes.data)}`);
                }
            }
        } catch (err) {
            console.warn('[THOUGHT PROCESS] Translator Service unavailable.');
        }

        // 4. Holistic Parsing
        const parsed = await holisticStrategy.parseStatement(cleanedText, semantic);
        session.lastParsed = parsed;

        // 5. Question detection
        const isQuestion = questionWrapper.detectQuestion(cleanedText);

        // 6. Routing
        const intent = semantic?.intent || command;

        // Holistic Search takes precedence if intent is search
        if (intent === 'search' && parsed) {
            await fetchSemanticProducts(sock, from, parsed, isQuestion);
            return;
        }

        // Exact command match for numeric menu
        if (command === '1') return browseProducts(sock, from);
        if (command === '2') return viewCart(sock, from);
        if (command === '3') return viewOrderStatus(sock, from);
        if (command === '4') return sock.sendMessage(from, { text: "🔍 Please type what you're looking for (e.g., 'android phones' or 'laptops') and I'll find it for you!" });

        // Intent-based routing
        if (['menu', 'hi', 'hello', 'hey', 'start'].includes(intent)) {
            session.state = 'idle';
            return sendMenu(sock, from);
        }

        if (intent === 'browse') return browseProducts(sock, from);
        if (intent === 'cart') return viewCart(sock, from);
        if (intent === 'status') return viewOrderStatus(sock, from);
        if (intent === 'checkout') return startCheckout(sock, from);

        if (intent === 'help') {
            return sock.sendMessage(from, { text: "I can help you browse products, manage your cart, and track orders. Just tell me what you need!" });
        }

        // Admin command to clear cache
        if (command === 'clear cache' || command === 'clearcache') {
            translatorCache.clear();
            return sock.sendMessage(from, { text: "✅ Translator cache cleared!" });
        }

        // Handle collecting address state
        if (session.state === 'collecting_address') {
            return finalizeCheckout(sock, from, rawText);
        }

        // Final Fallback: Keyword Search
        const searchQuery = command.startsWith('search ') ? rawText.substring(7).trim() : rawText;
        return searchProducts(sock, from, searchQuery);

    } catch (err) {
        console.error('❌ FATAL Error in handleMessage:', err);
    }
}

/**
 * Recursive helper to get all descendant category IDs
 */
async function getDescendantCategoryIds(tenantId, categoryId) {
    const ids = [categoryId];
    const res = await db.query(
        "SELECT id FROM categories WHERE tenant_id = $1 AND parent_id = $2 AND is_active = true",
        [tenantId, categoryId]
    );
    for (const row of res.rows) {
        const children = await getDescendantCategoryIds(tenantId, row.id);
        ids.push(...children);
    }
    return ids;
}

/**
 * Helper to translate collection rules/manual IDs into search index SQL
 */
async function getCollectionFilterSQL(tenantId, collectionId, pCount, params) {
    const res = await db.query(
        "SELECT rules, manual_product_ids, excluded_product_ids FROM collections WHERE id = $1 AND tenant_id = $2",
        [collectionId, tenantId]
    );
    if (res.rows.length === 0) return { sql: ' AND FALSE', pCount };

    const { rules, manual_product_ids, excluded_product_ids } = res.rows[0];
    const parsedRules = (typeof rules === 'string' ? JSON.parse(rules) : rules) || [];
    const manualIds = (typeof manual_product_ids === 'string' ? JSON.parse(manual_product_ids) : manual_product_ids) || [];
    const excludedIds = (typeof excluded_product_ids === 'string' ? JSON.parse(excluded_product_ids) : excluded_product_ids) || [];

    let conditions = [];

    // Manual IDs match content_id
    if (manualIds.length > 0) {
        conditions.push(`content_id = ANY($${pCount})`);
        params.push(manualIds);
        pCount++;
    }

    // Build conditions from rules
    for (const rule of parsedRules) {
        const { field, operator, value } = rule;
        switch (field) {
            case 'category':
                const allCatIds = await getDescendantCategoryIds(tenantId, value);
                conditions.push(`metadata->'category_ids' ?| $${pCount}`);
                params.push(allCatIds);
                pCount++;
                break;
            case 'tag':
                conditions.push(`metadata->'tags' ? $${pCount}`);
                params.push(value);
                pCount++;
                break;
            case 'price':
                const pricePath = `metadata->>'price'`;
                const safePrice = `(CASE WHEN ${pricePath} ~ '^-?[0-9.]+$' THEN (${pricePath})::numeric ELSE NULL END)`;
                const sqlOp = operator === 'lt' ? '<' : (operator === 'gt' ? '>' : '=');
                conditions.push(`${safePrice} ${sqlOp} $${pCount}`);
                params.push(parseFloat(value));
                pCount++;
                break;
        }
    }

    let sql = '';
    if (conditions.length > 0) {
        sql = ` AND (${conditions.join(' OR ')})`;
    } else if (manualIds.length === 0) {
        // If no rules and no manual IDs, return nothing
        return { sql: ' AND FALSE', pCount };
    }

    if (excludedIds.length > 0) {
        sql += ` AND content_id != ALL($${pCount})`;
        params.push(excludedIds);
        pCount++;
    }

    return { sql, pCount };
}

/**
 * Fetch products based on holistic parsed result (Base + Multiple Filters)
 */
async function fetchSemanticProducts(sock, from, parsed, skipMessage = false) {
    try {
        const session = getSession(from);
        const tenantId = process.env.TENANT_ID || 'be3';
        const { base, filters } = parsed;

        // 1. Direct Product Match (if base is a specific product)
        if (base?.type === 'product') {
            const prodRes = await db.query(
                "SELECT id, name, price, description FROM products WHERE id = $1 AND tenant_id = $2",
                [base.id, tenantId]
            );
            if (prodRes.rows.length > 0) {
                const p = prodRes.rows[0];
                session.lastProducts = [p];
                if (!skipMessage) {
                    const text = `📦 *${p.name}*\n💰 Price: $${p.price}\n📝 ${p.description || 'No description available.'}\n\n➡️ Type *add 1* to add to cart.`;
                    return sock.sendMessage(from, { text });
                }
                return;
            }
        }

        // 2. Build Base Query (Category, Collection, Brand)
        let queryStr = "SELECT content_id FROM public.search_indexes WHERE tenant_id = $1 AND content_type = 'product' AND is_active = true";
        let params = [tenantId];
        let pCount = 2;

        if (base?.type === 'category' || base?.category_id || (base?.type === 'clause' && base?.id)) {
            const catId = base.category_id || base.id;
            const allCatIds = await getDescendantCategoryIds(tenantId, catId);
            queryStr += ` AND metadata->'category_ids' ?| $${pCount}`;
            params.push(allCatIds);
            pCount++;
        } else if (base?.type === 'collection') {
            const collResult = await getCollectionFilterSQL(tenantId, base.id, pCount, params);
            queryStr += collResult.sql;
            pCount = collResult.pCount;
        } else if (base?.type === 'brand') {
            queryStr += ` AND (attributes->>'brand')::text ILIKE $${pCount}`;
            params.push(`%${base.term}%`);
            pCount++;
        }

        // 3. Construct Battle of Products SQL (Scoring)
        const scoreExpr = holisticStrategy.buildScoringExpr(parsed);
        const hasFilters = parsed.filters && parsed.filters.length > 0;

        let finalQuery = `
            WITH base_products AS (
                SELECT id, name, price, attributes, tags 
                FROM products 
                WHERE id IN (${queryStr}) AND status = 'active'
            ),
            scored_products AS (
                SELECT id, name, price, ${scoreExpr} as match_count
                FROM base_products
            )
            SELECT * FROM scored_products
            ${hasFilters ? 'WHERE match_count > 0' : ''}
            ORDER BY match_count DESC, price ASC
            LIMIT 12
        `;

        const res = await db.query(finalQuery, params);
        session.lastProducts = res.rows;

        if (res.rows.length === 0) {
            console.log(`[BOT] Local search yielded 0 results. Attempting server-side fallback...`);
            try {
                // Fallback to Server-Side Search
                const fallbackQuery = parsed.base?.term || parsed.raw || '';
                const fallbackRes = await axios.get('http://localhost:3000/search', {
                    params: { q: fallbackQuery },
                    headers: { 'X-Tenant-ID': tenantId }
                });

                if (fallbackRes.data.success && fallbackRes.data.results && fallbackRes.data.results.length > 0) {
                    console.log(`[BOT] Server-side fallback found ${fallbackRes.data.results.length} products.`);
                    const serverProducts = fallbackRes.data.results.slice(0, 10); // Limit to 10
                    session.lastProducts = serverProducts;

                    if (!skipMessage) {
                        let list = `🌍 *Found on global search for "${parsed.raw || 'results'}":*\n\n`;
                        serverProducts.forEach((p, i) => {
                            list += `🌐 [${i + 1}] *${p.name}*\n💰 Price: $${p.price}\n\n`;
                        });
                        list += `➡️ Type *add <number>* to add to cart.`;
                        console.log(`[THOUGHT PROCESS] Final Response (Server Fallback): ${list.substring(0, 100)}...`);
                        return sock.sendMessage(from, { text: list });
                    }
                    return;
                }
            } catch (fbErr) {
                console.error(`[BOT] Server-side fallback failed:`, fbErr.message);
            }

            if (!skipMessage) {
                return sock.sendMessage(from, { text: `I couldn't find any items matching "${base?.term || 'that'}" right now.` });
            }
            return;
        }

        // 4. Send Humanized Response
        if (!skipMessage) {
            const summary = holisticStrategy.getHumanSummary(parsed);

            // Check for question responses first
            const isQuestion = questionWrapper.detectQuestion(parsed.raw);
            if (isQuestion) {
                const type = questionWrapper.classifyQuestion(parsed.raw);
                const response = questionWrapper.formatResponse(type, res.rows, { canonical_term: summary });
                console.log(`[THOUGHT PROCESS] Final Response (Question): ${response}`);
                return sock.sendMessage(from, { text: response });
            }

            let list = `✨ *Found for "${summary}":*\n\n`;
            res.rows.forEach((p, i) => {
                const matchIcon = p.match_count > 0 ? (p.match_count >= filters.length ? '✅' : '🌟') : '📦';
                list += `${matchIcon} [${i + 1}] *${p.name}*\n💰 Price: $${p.price}\n\n`;
            });
            list += `➡️ Type *add <number>* to add to cart.`;

            console.log(`[THOUGHT PROCESS] Final Response (Search): ${list.substring(0, 100)}...`);
            await sock.sendMessage(from, { text: list });
        }
    } catch (err) {
        console.error('Holistic search error:', err);
        if (!skipMessage) {
            await sock.sendMessage(from, { text: "⚠️ I encountered an error while searching. Please try again with a simpler request!" });
        }
    }
}



async function browseProducts(sock, from) {
    try {
        const session = getSession(from);
        const res = await db.query(
            "SELECT id, name, price FROM products WHERE status = 'active' LIMIT 8"
        );

        session.lastProducts = res.rows;

        if (res.rows.length === 0) {
            return sock.sendMessage(from, { text: "Sorry, we don't have any products available right now." });
        }

        let list = `✨ *Our Products:*\n\n`;
        res.rows.forEach((p, i) => {
            list += `[${i + 1}] *${p.name}*\n💰 Price: $${p.price}\n\n`;
        });
        list += `➡️ Type *add <number>* to add to cart.\nExample: *add 1*`;

        console.log(`[THOUGHT PROCESS] Final Response (Browse): ${list.substring(0, 100)}...`);
        await sock.sendMessage(from, { text: list });
    } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: "⚠️ Error loading products." });
    }
}

async function searchProducts(sock, from, query) {
    try {
        const session = getSession(from);
        const res = await db.query(
            "SELECT id, name, price FROM products WHERE name ILIKE $1 AND status = 'active' LIMIT 8",
            [`%${query}%`]
        );

        session.lastProducts = res.rows;

        if (res.rows.length === 0) {
            return sock.sendMessage(from, { text: `No products matching "${query}" were found.` });
        }

        let list = `🔍 *Search Results for "${query}":*\n\n`;
        res.rows.forEach((p, i) => {
            list += `[${i + 1}] *${p.name}*\n💰 Price: $${p.price}\n\n`;
        });
        list += `➡️ Type *add <number>* to add to cart.`;

        console.log(`[THOUGHT PROCESS] Final Response (Search Keyword): ${list.substring(0, 100)}...`);
        await sock.sendMessage(from, { text: list });
    } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: "⚠️ Error searching products." });
    }
}

async function getOrCreateCart(jid) {
    const session = getSession(jid);
    if (session.cartId) return session.cartId;

    // Try to find active cart for this session_id (JID)
    const tenantId = process.env.TENANT_ID;
    const res = await db.query(
        "SELECT id FROM carts WHERE session_id = $1 AND tenant_id = $2 AND status = 'active' LIMIT 1",
        [jid, tenantId]
    );

    if (res.rows.length > 0) {
        session.cartId = res.rows[0].id;
        return session.cartId;
    }

    // Create new cart
    const createRes = await db.query(
        "INSERT INTO carts (tenant_id, session_id, status) VALUES ($1, $2, 'active') RETURNING id",
        [tenantId, jid]
    );
    session.cartId = createRes.rows[0].id;
    return session.cartId;
}

async function addToCart(sock, from, index) {
    const session = getSession(from);
    if (!session.lastProducts || session.lastProducts.length < index || index < 1) {
        return sock.sendMessage(from, { text: "❌ Invalid product number. Please browse again first." });
    }

    const product = session.lastProducts[index - 1];
    const cartId = await getOrCreateCart(from);
    const tenantId = process.env.TENANT_ID;

    try {
        // Check if item exists
        const itemRes = await db.query(
            "SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2",
            [cartId, product.id]
        );

        if (itemRes.rows.length > 0) {
            await db.query(
                "UPDATE cart_items SET quantity = quantity + 1 WHERE id = $1",
                [itemRes.rows[0].id]
            );
        } else {
            await db.query(
                "INSERT INTO cart_items (tenant_id, cart_id, product_id, price, quantity) VALUES ($1, $2, $3, $4, 1)",
                [tenantId, cartId, product.id, product.price]
            );
        }

        // Update cart total
        await db.query(`
            UPDATE carts SET total = (
                SELECT SUM(price * quantity) FROM cart_items WHERE cart_id = $1
            ) WHERE id = $1
        `, [cartId]);

        const response = `✅ Added *${product.name}* to your cart!`;
        console.log(`[THOUGHT PROCESS] Final Response (Add to Cart): ${response}`);
        await sock.sendMessage(from, { text: response });
    } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: "⚠️ Failed to add to cart." });
    }
}

async function viewCart(sock, from) {
    try {
        const cartId = await getOrCreateCart(from);
        const res = await db.query(`
            SELECT ci.quantity, ci.price, p.name 
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            WHERE ci.cart_id = $1
        `, [cartId]);

        if (res.rows.length === 0) {
            return sock.sendMessage(from, { text: "Your cart is empty! 🛒" });
        }

        let cartText = `🛒 *Your Shopping Cart:*\n\n`;
        let total = 0;
        res.rows.forEach(item => {
            const subtotal = item.quantity * item.price;
            total += subtotal;
            cartText += `• *${item.name}*\n  Qty: ${item.quantity} x $${item.price} = $${subtotal.toFixed(2)}\n\n`;
        });

        cartText += `━━━━━━━━━━━━━━\n`;
        cartText += `💰 *Total: $${total.toFixed(2)}*\n\n`;
        cartText += `Type *checkout* to complete your order.`;

        console.log(`[THOUGHT PROCESS] Final Response (Cart): ${cartText.substring(0, 100)}...`);
        await sock.sendMessage(from, { text: cartText });
    } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: "⚠️ Error loading cart." });
    }
}

async function startCheckout(sock, from) {
    const session = getSession(from);
    const response = "🚚 Please provide your full name and delivery address to complete the order.";
    console.log(`[THOUGHT PROCESS] Final Response (Checkout Start): ${response}`);
    await sock.sendMessage(from, { text: response });
}

async function finalizeCheckout(sock, from, address) {
    const session = getSession(from);
    try {
        const cartId = await getOrCreateCart(from);
        const tenantId = process.env.TENANT_ID;

        // Fetch cart items
        const cartItems = await db.query(`
            SELECT ci.product_id, ci.quantity, ci.price, p.name 
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            WHERE ci.cart_id = $1
        `, [cartId]);

        if (cartItems.rows.length === 0) {
            session.state = 'idle';
            return sock.sendMessage(from, { text: "Your cart is empty. Browse products first!" });
        }

        const subtotal = cartItems.rows.reduce((sum, item) => sum + (item.quantity * item.price), 0);
        const orderNumber = `WA-${Date.now().toString().slice(-6)}`;

        // Create Order
        const orderRes = await db.query(`
            INSERT INTO orders (tenant_id, order_number, subtotal, total, customer_name, billing_address, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            RETURNING id
        `, [tenantId, orderNumber, subtotal, subtotal, from.split('@')[0], JSON.stringify({ address })]);

        const orderId = orderRes.rows[0].id;

        // Create Order Items
        for (const item of cartItems.rows) {
            await db.query(`
                INSERT INTO order_items (tenant_id, order_id, product_id, product_name, quantity, price, total)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [tenantId, orderId, item.product_id, item.name, item.quantity, item.price, item.quantity * item.price]);
        }

        // Mark cart as completed
        await db.query("UPDATE carts SET status = 'completed' WHERE id = $1", [cartId]);
        session.cartId = null;
        session.state = 'idle';

        const successMsg = `🎉 *Order Confirmed!*\n\n` +
            `Order Number: *#${orderNumber}*\n` +
            `Delivery to: ${address}\n` +
            `Total Amount: $${subtotal.toFixed(2)}\n\n` +
            `Thank you for shopping with us! Type *status* to track your order anytime.`;

        console.log(`[THOUGHT PROCESS] Final Response (Order Confirmed): ${successMsg.substring(0, 100)}...`);
        await sock.sendMessage(from, { text: successMsg });
    } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: "⚠️ Checkout failed. Please try again later." });
    }
}

async function viewOrderStatus(sock, from) {
    try {
        const tenantId = process.env.TENANT_ID;
        // Search orders by customer name containing the phone number part (or exact JID if we stored that)
        const res = await db.query(`
            SELECT order_number, status, total, created_at 
            FROM orders 
            WHERE tenant_id = $1 AND (customer_name = $2 OR customer_name = $3)
            ORDER BY created_at DESC LIMIT 3
        `, [tenantId, from.split('@')[0], from]);

        if (res.rows.length === 0) {
            return sock.sendMessage(from, { text: "You haven't placed any orders yet." });
        }

        let orderText = `📦 *Your Recent Orders:*\n\n`;
        res.rows.forEach(o => {
            orderText += `#${o.order_number}\nStatus: *${o.status.toUpperCase()}*\nTotal: $${o.total}\nDate: ${new Date(o.created_at).toLocaleDateString()}\n\n`;
        });

        console.log(`[THOUGHT PROCESS] Final Response (Status): ${orderText.substring(0, 100)}...`);
        await sock.sendMessage(from, { text: orderText });
    } catch (err) {
        console.error(err);
        await sock.sendMessage(from, { text: "⚠️ Error checking status." });
    }
}

connectToWhatsApp();
