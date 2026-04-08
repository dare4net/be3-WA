async function updateStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const statusText = data.status || 'unknown';
        const statusEl = document.getElementById('status');
        statusEl.textContent = statusText;
        statusEl.className = `status-pill status-${statusText}`;
        document.getElementById('status-updated').textContent = new Date().toLocaleTimeString();

        const disconnectBtn = document.getElementById('disconnect-btn');
        const reconnectBtn = document.getElementById('reconnect-btn');
        const resetAuthBtn = document.getElementById('reset-auth-btn');
        const isConnected = statusText === 'connected';
        const isAwaitingQr = statusText === 'awaiting_qr';

        disconnectBtn.disabled = !isConnected;
        reconnectBtn.disabled = isConnected || isAwaitingQr;
        resetAuthBtn.disabled = false;
        
        const qrContainer = document.getElementById('qr-container');
        const qrText = document.getElementById('qr-text');
        const qrCodeEl = document.getElementById('qr-code');
        qrCodeEl.innerHTML = '';
        if (data.qr) {
            qrContainer.style.display = 'block';
            qrText.style.display = 'none';
            try {
                new QRCode(qrCodeEl, {
                    text: data.qr,
                    width: 256,
                    height: 256,
                    correctLevel: QRCode.CorrectLevel.H
                });
            } catch (error) {
                console.error(error);
                qrText.style.display = 'block';
                qrText.textContent = data.qr;
            }
        } else {
            qrContainer.style.display = 'none';
            qrText.style.display = 'none';
        }
    } catch (err) {
        console.error('Error updating status:', err);
        document.getElementById('status').textContent = 'error';
        document.getElementById('status').className = 'status-pill status-error';
    }
}

async function updateStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        document.getElementById('messages-in').textContent = data.messagesIn ?? 0;
        document.getElementById('messages-out').textContent = data.messagesOut ?? 0;
        document.getElementById('total-sessions').textContent = data.totalSessions ?? 0;
        document.getElementById('active-sessions').textContent = data.activeSessions ?? 0;
        document.getElementById('stats-updated').textContent = new Date().toLocaleTimeString();
    } catch (err) {
        console.error('Error updating stats:', err);
    }
}

async function loadLogs() {
    try {
        const res = await fetch('/api/logs');
        const logs = await res.json();
        const logsContainer = document.getElementById('logs-container');
        logsContainer.innerHTML = logs.map(log => 
            `<div class="log-entry">[${log.timestamp}] ${log.message}</div>`
        ).join('');
        logsContainer.scrollTop = logsContainer.scrollHeight;
        document.getElementById('logs-updated').textContent = new Date().toLocaleTimeString();
    } catch (err) {
        console.error('Error loading logs:', err);
    }
}

document.getElementById('reset-auth-btn').addEventListener('click', async () => {
    if (confirm('This will delete all auth data and require rescanning QR. Continue?')) {
        try {
            const res = await fetch('/api/reset-auth', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                alert(data.message);
                updateStatus();
                updateStats();
                loadLogs();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (err) {
            alert('Error resetting auth');
        }
    }
});

document.getElementById('disconnect-btn').addEventListener('click', async () => {
    if (confirm('Disconnect the bot from WhatsApp?')) {
        try {
            const res = await fetch('/api/disconnect', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                alert('Disconnected');
                updateStatus();
                updateStats();
                loadLogs();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (err) {
            alert('Error disconnecting');
        }
    }
});

document.getElementById('reconnect-btn').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/reconnect', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert('Reconnecting... please wait a few seconds');
            updateStatus();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error reconnecting');
    }
});

document.getElementById('clear-logs-btn').addEventListener('click', async () => {
    if (confirm('Clear the logs shown on this dashboard?')) {
        try {
            const res = await fetch('/api/logs/clear', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                loadLogs();
            } else {
                alert('Error clearing logs');
            }
        } catch (err) {
            alert('Error clearing logs');
        }
    }
});

// Auto-refresh every 5 seconds
setInterval(() => {
    updateStatus();
    updateStats();
    loadLogs();
}, 5000);

// Initial load
updateStatus();
updateStats();
loadLogs();
