/**
 * Context Memory - Manages conversation history and detects refinements
 */
class ContextMemory {
    /**
     * Add message to conversation history
     */
    addToHistory(session, message, semantic) {
        if (!session.history) {
            session.history = [];
        }

        session.history.push({
            text: message,
            semantic,
            timestamp: Date.now()
        });

        // Keep last 3 messages
        if (session.history.length > 3) {
            session.history.shift();
        }
    }

    /**
     * Get last search from history
     */
    getLastSearch(session) {
        if (!session.history || session.history.length === 0) {
            return null;
        }

        // Find most recent search intent
        for (let i = session.history.length - 1; i >= 0; i--) {
            const entry = session.history[i];
            if (entry.semantic?.intent === 'search') {
                return entry.semantic;
            }
        }

        return null;
    }

    /**
     * Detect if message is a refinement
     */
    detectRefinement(message) {
        const lower = message.toLowerCase().trim();

        // Price refinements
        if (lower.match(/^(cheaper|less expensive|lower price)$/)) {
            return { type: 'price_lower' };
        }
        if (lower.match(/^(expensive|higher price|premium)$/)) {
            return { type: 'price_higher' };
        }

        // Show more
        if (lower.match(/^(more|others|different|show me more)$/)) {
            return { type: 'show_more' };
        }

        return null;
    }

    /**
     * Check if context is still valid (not expired)
     */
    isContextValid(session, timeoutMs = 30 * 60 * 1000) {
        const lastSearch = this.getLastSearch(session);
        if (!lastSearch) {
            return false;
        }

        return (Date.now() - lastSearch.timestamp) < timeoutMs;
    }
}

export default ContextMemory;
