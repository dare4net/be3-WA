/**
 * Question Wrapper - Detects questions and formats conversational responses
 */
class QuestionWrapper {
    /**
     * Detect if message is a question
     */
    detectQuestion(text) {
        const lower = text.toLowerCase();

        const questionPatterns = [
            /^do you (have|sell|stock)/,
            /^is there/,
            /^are there/,
            /^how much/,
            /^what('s| is) the price/,
            /\?$/
        ];

        return questionPatterns.some(pattern => pattern.test(lower));
    }

    /**
     * Classify question type
     */
    classifyQuestion(text) {
        const lower = text.toLowerCase();

        if (lower.match(/do you (have|sell|stock)|is there|are there/)) {
            return 'availability';
        }
        if (lower.match(/how much|price/)) {
            return 'price';
        }
        return 'general';
    }

    /**
     * Format conversational response based on question type
     */
    formatResponse(questionType, results, semantic) {
        const term = semantic?.canonical_term || 'that';

        // No results
        if (results.length === 0) {
            if (questionType === 'availability') {
                return `❌ Sorry, we don't have "${term}" in stock within that price range.\n\n` +
                    `Would you like to:\n` +
                    `1️⃣ See all ${term}\n` +
                    `2️⃣ Browse other categories`;
            }
            return `❌ Sorry, I couldn't find "${term}" matching your request.`;
        }

        // Availability question
        if (questionType === 'availability') {
            let msg = `✅ Yes! I found *${results.length} matched option(s)* for "${term}":\n\n`;
            results.slice(0, 8).forEach((p, i) => {
                msg += `[${i + 1}] *${p.name}*\n💰 $${p.price}\n\n`;
            });
            msg += `➡️ Type *add <number>* to add to cart!`;
            return msg;
        }

        // Price question
        if (questionType === 'price') {
            if (results.length === 1) {
                const p = results[0];
                return `💰 *${p.name}*\n\nPrice: *$${p.price}*\n\n➡️ Type *add 1* to add to cart!`;
            }

            let msg = `💰 Prices for "${term}":\n\n`;
            results.slice(0, 8).forEach((p, i) => {
                msg += `[${i + 1}] ${p.name} - *$${p.price}*\n`;
            });
            msg += `\n➡️ Type *add <number>* to add to cart!`;
            return msg;
        }

        // General question
        let msg = `Found ${results.length} results for "${term}":\n\n`;
        results.slice(0, 8).forEach((p, i) => {
            msg += `[${i + 1}] *${p.name}* - $${p.price}\n`;
        });
        msg += `\n➡️ Type *add <number>* to add to cart!`;
        return msg;
    }
}

module.exports = QuestionWrapper;
