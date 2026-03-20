import UiRegistry from './uiRegistry.js';

function coerceActionShape(action) {
    if (!action) return { type: 'engineered_text', text: '' };
    if (typeof action === 'string') return { type: 'engineered_text', text: action };
    if (typeof action === 'object') {
        if (action.type === 'engineered_text' && typeof action.text === 'string') return action;
        if (action.type === 'send_text' && typeof action.text === 'string') return action;
        if (typeof action.text === 'string') return { type: 'engineered_text', text: action.text };
    }
    return { type: 'engineered_text', text: '' };
}

export function resolveUiCallback(registry, inboundText) {
    const parsed = UiRegistry.parseActionToken(inboundText);
    if (!parsed) return null;

    const resolved = registry.resolve(inboundText);
    if (!resolved) return { handled: true, error: 'expired_or_unknown' };

    const action = coerceActionShape(resolved.action?.action);
    return {
        handled: true,
        sponsor: resolved.entry.sponsor,
        actionKey: resolved.action.key,
        action,
    };
}
