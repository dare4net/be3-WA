import path from 'path';

function mapMicrostateYesNo(text) {
    if (!text) return text;
    const lower = String(text).toLowerCase();
    if (lower === 'ms_yes' || lower === 'yes') return 'yes';
    if (lower === 'ms_no' || lower === 'no') return 'no';
    return text;
}

export function extractInboundText(msg) {
    if (!msg || !msg.message) return null;

    const nativeFlow = msg.message.interactiveResponseMessage?.nativeFlowResponseMessage;
    if (nativeFlow) {
        let buttonId = null;
        let displayText = null;
        try {
            const params = nativeFlow.paramsJson ? JSON.parse(nativeFlow.paramsJson) : {};
            buttonId = params.id || nativeFlow.name;
            displayText = params.display_text;
        } catch {
            buttonId = nativeFlow.name;
        }
        return mapMicrostateYesNo(displayText || buttonId || '');
    }

    const legacyBtn = msg.message.buttonsResponseMessage;
    if (legacyBtn) {
        const buttonId = legacyBtn.selectedButtonId;
        const buttonText = legacyBtn.selectedDisplayText;
        return mapMicrostateYesNo(buttonId || buttonText || '');
    }

    const templateBtn = msg.message.templateButtonReplyMessage;
    if (templateBtn) {
        const buttonId = templateBtn.selectedId;
        const buttonText = templateBtn.selectedDisplayText;
        return mapMicrostateYesNo(buttonId || buttonText || '');
    }

    const listResp = msg.message.listResponseMessage;
    if (listResp) {
        const listId = listResp.singleSelectReply?.selectedRowId;
        const title = listResp.title;
        return mapMicrostateYesNo(listId || title || '');
    }

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
    if (text) return text;

    return null;
}

export function describeInboundMessage(msg) {
    if (!msg || !msg.message) return '';
    return Object.keys(msg.message || {}).join(', ');
}

export function isImageMessage(msg) {
    if (!msg || !msg.message) return false;
    return !!(msg.message.imageMessage);
}
