import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import db from './db.js';
import { cleanForTranslator } from './textUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Holistic Strategy - Zero-Hardcoding Dynamic Filter Extraction
 * Uses DB metadata, Modifier Lookahead, Translator semantic matching, and local caching.
 */
class HolisticStrategy {
    constructor() {
        this.attributes = [];
        this.translatorUrl = process.env.TRANSLATOR_URL || 'http://localhost:3004/normalize';
        this.isLoaded = false;

        // Load Modifiers and Synonyms from adjectives.json
        this.modifiers = [];
        this.synonyms = {};
        try {
            const adjPath = path.join(__dirname, '../adjectives.json');
            if (fs.existsSync(adjPath)) {
                const data = JSON.parse(fs.readFileSync(adjPath, 'utf8'));
                this.modifiers = data.modifiers || [];
                this.synonyms = data.synonyms || {};
            }
        } catch (e) {
            console.warn('[HOLISTIC] Adjectives config not found or invalid.');
        }

        // Semantic Cache: Resolves words/phrases to filter objects
        this.semanticCache = new Map();

        // Single Source of Truth: Canonical Terms
        this.dictionary = [];
        try {
            const dictionaryPath = path.join(__dirname, '../../be3_translator/canonical_terms.json');
            if (fs.existsSync(dictionaryPath)) {
                this.dictionary = JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'));
                console.log(`[HOLISTIC] Loaded ${this.dictionary.length} canonical terms for context.`);
            }
        } catch (e) {
            console.warn('[HOLISTIC] Canonical dictionary not found at expected path.');
        }
    }

    /**
     * Debug Log helper
     */
    debugLog(msg) {
        if (process.env.DEBUG === 'TRUE') {
            const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
            console.log(`[HOLISTIC DEBUG ${timestamp}] ${msg}`);
        }
    }

    /**
     * Load attributes and their clauses from DB
     */
    async loadMetadata(tenantId) {
        try {
            const attrRes = await db.query(
                "SELECT code, label, type, clauses FROM public.attributes WHERE tenant_id = $1",
                [tenantId]
            );

            this.attributes = attrRes.rows.map(attr => ({
                code: attr.code,
                label: attr.label.toLowerCase(),
                type: attr.type,
                clauses: (typeof attr.clauses === 'string' ? JSON.parse(attr.clauses) : attr.clauses) || []
            }));

            this.isLoaded = true;
            this.semanticCache.clear();
            this.debugLog(`Dynamically loaded ${this.attributes.length} attributes for tenant ${tenantId}.`);
            console.log(`[HOLISTIC] Dynamically loaded ${this.attributes.length} attributes for tenant ${tenantId}.`);
        } catch (err) {
            this.debugLog(`Metadata LOAD ERROR: ${err.message}`);
            console.error('[HOLISTIC] Metadata load error:', err);
        }
    }

    /**
     * Resolve a specific term (word or phrase) via Cache -> DB -> Translator
     */
    async resolveTerm(term) {
        if (!term) return null;
        const cleanTerm = term.toLowerCase().trim();

        if (this.semanticCache.has(cleanTerm)) {
            this.debugLog(`Cache HIT: "${cleanTerm}"`);
            return this.semanticCache.get(cleanTerm);
        }

        this.debugLog(`Cache MISS: "${cleanTerm}" -> Querying DB/Translator`);

        // A. Direct Clause Match in loaded metadata
        for (const attr of this.attributes) {
            const match = attr.clauses.find(c =>
                c.name.toLowerCase() === cleanTerm ||
                (c.title && c.title.toLowerCase() === cleanTerm)
            );
            if (match) {
                this.debugLog(`DB Match (Direct Clause): "${cleanTerm}" -> attribute:${attr.code}, value:${match.value}`);
                const res = {
                    type: 'attribute',
                    code: attr.code,
                    label: attr.label,
                    value: match.value,
                    operator: match.operator || '=',
                    term: cleanTerm,
                    display: match.title || match.name
                };
                this.semanticCache.set(cleanTerm, res);
                return res;
            }
        }

        // B. Translator Resolution
        try {
            this.debugLog(`API Call: Requesting translator for "${cleanTerm}"...`);
            const tRes = await axios.post(this.translatorUrl, { query: cleanTerm });

            if (tRes.data.success) {
                const matchedTerm = tRes.data.canonical_term || cleanTerm;

                // 1. Dictionary Verification (Single Source of Truth)
                const dictEntry = this.dictionary.find(t =>
                    t.text.toLowerCase() === matchedTerm.toLowerCase() ||
                    t.text.toLowerCase() === cleanTerm.toLowerCase()
                );

                if (dictEntry) {
                    this.debugLog(`Dictionary Match: "${matchedTerm}" -> Type: ${dictEntry.type}`);

                    if (dictEntry.type === 'attribute value' || dictEntry.type === 'clause') {
                        const res = {
                            type: 'attribute',
                            code: dictEntry.attribute_code,
                            label: dictEntry.attribute_name || dictEntry.text,
                            value: dictEntry.value,
                            operator: dictEntry.operator || '=',
                            term: cleanTerm,
                            display: dictEntry.text
                        };
                        this.semanticCache.set(cleanTerm, res);
                        return res;
                    } else if (dictEntry.type === 'attribute') {
                        // Attribute name itself (e.g. "color")
                        const res = {
                            type: 'attribute',
                            code: dictEntry.attribute_code,
                            label: dictEntry.attribute_name || dictEntry.text,
                            value: cleanTerm,
                            operator: '=',
                            term: cleanTerm,
                            display: dictEntry.text
                        };
                        this.semanticCache.set(cleanTerm, res);
                        return res;
                    } else if (dictEntry.type === 'brand') {
                        const res = {
                            type: 'attribute',
                            code: 'brand',
                            label: 'Brand',
                            value: dictEntry.value || dictEntry.text,
                            operator: 'ILIKE',
                            term: cleanTerm,
                            display: dictEntry.text
                        };
                        this.semanticCache.set(cleanTerm, res);
                        return res;
                    }
                }

                // 2. Fallback to Translator response for dynamic matches (Tags etc)
                if (tRes.data.type === 'attribute') {
                    this.debugLog(`API Match (Attribute Name): "${cleanTerm}" -> code:${tRes.data.attribute_code}`);
                    const res = {
                        type: 'attribute',
                        code: tRes.data.attribute_code,
                        label: tRes.data.attribute_name || cleanTerm,
                        value: cleanTerm,
                        operator: '=',
                        term: cleanTerm,
                        display: tRes.data.canonical_term || cleanTerm
                    };
                    this.semanticCache.set(cleanTerm, res);
                    return res;
                } else if (tRes.data.type === 'brand') {
                    this.debugLog(`API Match (Brand): "${cleanTerm}" -> brand:${tRes.data.canonical_term || cleanTerm}`);
                    const res = {
                        type: 'attribute',
                        code: 'brand',
                        label: 'Brand',
                        value: tRes.data.canonical_term || cleanTerm,
                        operator: 'ILIKE',
                        term: cleanTerm,
                        display: tRes.data.canonical_term || cleanTerm
                    };
                    this.semanticCache.set(cleanTerm, res);
                    return res;
                } else if (tRes.data.type === 'tag') {
                    this.debugLog(`API Match (Tag): "${cleanTerm}" -> tag:${tRes.data.tag_name}`);
                    const res = {
                        type: 'tag',
                        value: tRes.data.tag_name || tRes.data.canonical_term,
                        term: cleanTerm,
                        display: tRes.data.canonical_term || cleanTerm
                    };
                    this.semanticCache.set(cleanTerm, res);
                    return res;
                }
            }
        } catch (err) {
            // Silently fail for individual resolution
        }

        return null;
    }

    /**
     * Parse statement holistically using Price Regex + Modifier Lookahead + Translator Resolution
     */
    async parseStatement(text, semanticMatch) {
        this.debugLog(`START RESOLUTION for: "${text}"`);
        let lower = text.toLowerCase().replace(/[?!.,]/g, ' ');
        const filters = [];

        // 1. Extract Price Filters (Regex-based)
        const priceRegex = /\$(\d+)|(\d+)\s*dollars?|price\s*of\s*(\d+)|under\s+(\d+)|around\s+(\d+)|above\s+(\d+)|over\s+(\d+)|below\s+(\d+)/gi;
        let pMatch;
        while ((pMatch = priceRegex.exec(lower)) !== null) {
            const value = parseInt(pMatch[1] || pMatch[2] || pMatch[3] || pMatch[4] || pMatch[5] || pMatch[6] || pMatch[7] || pMatch[8]);
            let op = 'within';
            const contextStart = Math.max(0, pMatch.index - 15);
            const context = lower.substring(contextStart, pMatch.index + pMatch[0].length).toLowerCase();

            if (context.includes('under') || context.includes('below') || context.includes('less than')) op = 'below';
            else if (context.includes('above') || context.includes('over') || context.includes('more than')) op = 'above';

            filters.push({ type: 'price', value, op, term: pMatch[0] });
            this.debugLog(`Price EXTRACTED: "${pMatch[0]}" -> val:${value}, op:${op}`);
        }

        // 2. Extract Semantic Filters with Lookahead (Search for modifiers like "low price")
        const words = lower.split(/\s+/).filter(w => w.length > 2);
        const baseTerm = semanticMatch?.canonical_term?.toLowerCase() || '';

        if (semanticMatch) {
            this.debugLog(`BASE IDENTITY identified: term="${semanticMatch.canonical_term}", type="${semanticMatch.type}", id="${semanticMatch.id || semanticMatch.category_id}"`);
        }

        for (let i = 0; i < words.length; i++) {
            const word = words[i];

            // Skip if part of base identity or already matched as price
            if (baseTerm.includes(word) || filters.find(f => f.term?.toLowerCase().includes(word))) continue;

            // Handle Synonyms
            const resolvedWord = this.synonyms[word] || word;

            let foundMatch = null;

            // A. Modifier Lookahead (e.g., "low" + "price")
            if (this.modifiers.includes(resolvedWord) && i + 1 < words.length) {
                const nextWord = words[i + 1];
                const phrase = `${resolvedWord} ${nextWord}`;
                this.debugLog(`Modifier DETECTED: "${resolvedWord}" -> Trying lookahead with "${nextWord}"...`);
                foundMatch = await this.resolveTerm(phrase);
                if (foundMatch) {
                    this.debugLog(`Lookahead SUCCESS: "${phrase}" resolved.`);
                    i++; // Skip next word
                } else {
                    this.debugLog(`Lookahead FAILED: "${phrase}" not meaningful.`);
                }
            }

            // B. Resolve single word if no compound match
            if (!foundMatch) {
                foundMatch = await this.resolveTerm(resolvedWord);
            }

            if (foundMatch) {
                this.debugLog(`Filter FOUND: type=${foundMatch.type}, code=${foundMatch.code}, value=${foundMatch.value}, display="${foundMatch.display}"`);
                filters.push(foundMatch);
            }
        }

        const deduped = this.deduplicateFilters(filters);
        this.debugLog(`FINAL Deduplicated Filters (${deduped.length}): ${deduped.map(f => {
            if (f.type === 'attribute') return `${f.label}:${f.display || f.value}`;
            return f.display;
        }).join(', ')}`);

        return {
            intent: semanticMatch?.intent || 'search',
            base: semanticMatch ? {
                type: semanticMatch.type,
                id: semanticMatch.id || semanticMatch.category_id || semanticMatch.original_id,
                category_id: semanticMatch.category_id,
                term: semanticMatch.canonical_term
            } : null,
            filters: deduped,
            raw: text
        };
    }

    /**
     * Deduplicate filters (e.g., if multiple words resolve to same attribute:value)
     */
    deduplicateFilters(filters) {
        const seen = new Set();
        const result = filters.filter(f => {
            const key = f.type === 'price' ? `price-${f.value}-${f.op}` : `${f.type}-${f.code || ''}-${f.value}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        this.debugLog(`Final Parsed Filters: ${result.map(f => `${f.type}:${f.value}`).join(', ')}`);
        return result;
    }

    /**
     * Build the scoring expression for SQL (The Battle)
     */
    buildScoringExpr(parsed) {
        const scoreParts = [];

        parsed.filters.forEach(f => {
            if (f.type === 'price') {
                const condition = f.op === 'below' ? `price < ${f.value}` :
                    f.op === 'above' ? `price > ${f.value}` :
                        `price BETWEEN ${f.value * 0.8} AND ${f.value * 1.2}`;
                scoreParts.push(`(CASE WHEN ${condition} THEN 1 ELSE 0 END)`);
            } else if (f.type === 'tag') {
                scoreParts.push(`(CASE WHEN tags @> ARRAY['${f.value}']::text[] THEN 1 ELSE 0 END)`);
            } else if (f.type === 'attribute') {
                const attrPath = `attributes->>'${f.code}'`;
                if (Array.isArray(f.value)) {
                    const values = f.value.map(v => `'${v}'`).join(',');
                    scoreParts.push(`(CASE WHEN ${attrPath} = ANY(ARRAY[${values}]::text[]) THEN 1 ELSE 0 END)`);
                } else {
                    scoreParts.push(`(CASE WHEN ${attrPath} ${f.operator} '${f.value}' THEN 1 ELSE 0 END)`);
                }
            }
        });

        return scoreParts.length > 0 ? `(${scoreParts.join(' + ')})` : '0';
    }

    /**
     * Generate a humanized summary of the search
     */
    getHumanSummary(parsed) {
        const base = parsed.base?.term || 'products';
        if (parsed.filters.length === 0) return base;

        const filterTerms = parsed.filters.map(f => {
            if (f.type === 'price') {
                if (f.op === 'below') return `under $${f.value}`;
                if (f.op === 'above') return `above $${f.value}`;
                return `around $${f.value}`;
            }
            return f.display || f.term || f.value;
        });

        return `${filterTerms.join(' ')} ${base}`;
    }
}

export default new HolisticStrategy();
