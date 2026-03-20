/**
 * Text Utilities - Text cleaning and normalization
 */

/**
 * Remove all emojis from text
 */
function stripEmojis(text) {
    // Comprehensive emoji regex pattern
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{FE00}-\u{FE0F}]|[\u{1F018}-\u{1F270}]|[\u{238C}-\u{2454}]|[\u{20D0}-\u{20FF}]/gu;

    return text.replace(emojiRegex, '').trim();
}

/**
 * Normalize text for processing
 */
function normalizeText(text) {
    return text
        .replace(/\?+/g, '?')     // Multiple question marks to single
        .replace(/!+/g, '!')       // Multiple exclamation to single
        .replace(/\s+/g, ' ')      // Multiple spaces to single
        .trim();
}

/**
 * Clean text before sending to translator
 */
function cleanForTranslator(text) {
    let cleaned = stripEmojis(text);
    cleaned = normalizeText(cleaned);
    return cleaned;
}

export {
    stripEmojis,
    normalizeText,
    cleanForTranslator
};
