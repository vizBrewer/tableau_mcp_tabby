// =============================
//  Tabby AI Chat - Frontend Logic
// =============================
console.log("script.js IS LOADED");
// Persistent thread ID for conversation state
let THREAD_ID = null;
// AbortController for stopping requests
let currentAbortController = null;

// -----------------------------
// Status indicator helpers
// -----------------------------
function setStatus(text, variant = "ok") {
    const el = document.getElementById('statusIndicator');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('status-ok', 'status-thinking', 'status-error');
    if (variant === 'thinking') {
        el.classList.add('status-thinking');
    } else if (variant === 'error') {
        el.classList.add('status-error');
    } else {
        el.classList.add('status-ok');
    }
}

// -----------------------------
// Initialize session on page load
// -----------------------------
document.addEventListener('DOMContentLoaded', async function () {
    document.getElementById('messageInput').focus();
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetSession);
    }
    setStatus('● Connecting…', 'thinking');
    await initSession();
});

// -----------------------------
// Create a new session
// -----------------------------
async function initSession() {
    try {
        console.log("initSession() called");
        const res = await fetch('/session');
        const data = await res.json();
        THREAD_ID = data.thread_id;
        
        console.log("Initialized conversation thread:", THREAD_ID);
        setStatus('● Connected', 'ok');
    } catch (err) {
        console.error("Failed to initialize session:", err);
        addMessage('Could not start chat session. Please refresh.', 'bot');
        setStatus('● Error connecting', 'error');
    }
}

// -----------------------------
// Reset session
// -----------------------------
async function resetSession() {
    const chatBox = document.getElementById('chatBox');
    chatBox.innerHTML = '';
    THREAD_ID = null;
    setStatus('● Connecting…', 'thinking');
    await initSession();
}

// -----------------------------
// Send user message to backend
// -----------------------------
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message || !THREAD_ID) return;

    // Add user message to chat box
    addMessage(message, 'user');
    input.value = '';

    // Disable send button and show stop button
    const btn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');
    const input_field = document.getElementById('messageInput');
    btn.disabled = true;
    input_field.disabled = true;
    btn.style.display = 'none'; // Hide send button
    stopBtn.style.display = 'inline-block'; // Show stop button
    setStatus('● Thinking…', 'thinking');

    // Create a placeholder for the streaming response
    const streamingContext = addStreamingMessage();

    // Create new AbortController for this request
    currentAbortController = new AbortController();

    try {
        const response = await fetch('/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                thread_id: THREAD_ID
            }),
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                // Process any remaining buffered data
                if (buffer.trim()) {
                    const lines = buffer.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                updateStreamingMessage(streamingContext, data);
                            } catch (e) {
                                console.error('Error parsing SSE data on close:', e, 'Line:', line.substring(0, 100));
                            }
                        }
                    }
                }
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            
            // Keep the last potentially incomplete line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() && line.startsWith('data: ')) {
                    try {
                        const jsonStr = line.slice(6);
                        const data = JSON.parse(jsonStr);
                        updateStreamingMessage(streamingContext, data);
                    } catch (e) {
                        console.error('Error parsing SSE data:', e);
                        console.error('Problematic line:', line.substring(0, 200));
                    }
                }
            }
        }
    } catch (error) {
        // Check if it was aborted by user
        if (error.name === 'AbortError') {
            console.log('Generation stopped by user');
            updateStreamingMessage(streamingContext, {
                type: 'final',
                content: '⏹️ Generation stopped by user.',
                is_final: true
            });
            setStatus('● Connected', 'ok');
        } else {
            console.error('Error:', error);
            updateStreamingMessage(streamingContext, {
                type: 'final',
                content: '⚠️ Could not connect to the server. Refresh the page to start a new session.',
                is_final: true
            });
            setStatus('● Error during response', 'error');
        }
    } finally {
        // Re-enable buttons and restore UI
        currentAbortController = null;
        btn.disabled = false;
        input_field.disabled = false;
        btn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
        input_field.focus();
        
        if (THREAD_ID) {
            setStatus('● Connected', 'ok');
        }
    }
}

// -----------------------------
// Stop generation
// -----------------------------
function stopGeneration() {
    if (currentAbortController) {
        console.log('Stopping generation...');
        currentAbortController.abort();
    }
}

// -----------------------------
// Simple markdown-ish formatter
// -----------------------------
/** Bedrock / multimodal: content may be a string or list of {type,text|reasoning_content} blocks. */
function stringifyStreamContent(content) {
    if (content == null || content === '') return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        const parts = [];
        for (const block of content) {
            if (typeof block === 'string') {
                parts.push(block);
            } else if (block && typeof block === 'object') {
                if (block.type === 'text' && typeof block.text === 'string') {
                    parts.push(block.text);
                } else if (block.type === 'reasoning_content' && block.reasoning_content != null) {
                    const rc = block.reasoning_content;
                    if (typeof rc === 'string') parts.push(rc);
                    else if (typeof rc.text === 'string') parts.push(rc.text);
                }
            }
        }
        return parts.join('\n');
    }
    if (typeof content === 'object' && content.type === 'text' && typeof content.text === 'string') {
        return content.text;
    }
    return String(content);
}

function formatMarkdown(text) {
    text = stringifyStreamContent(text);
    if (!text) return '';
    // Escape HTML first
    const escapeHtml = (str) => {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    const lines = text.split('\n');
    const parts = [];
    let inList = false;

    for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (inList) {
                parts.push('</ul>');
                inList = false;
            }
            parts.push('<br>');
            continue;
        }
        // headings
        if (trimmed.startsWith('### ')) {
            if (inList) { parts.push('</ul>'); inList = false; }
            parts.push('<h3>' + escapeHtml(trimmed.slice(4)) + '</h3>');
            continue;
        }
        if (trimmed.startsWith('## ')) {
            if (inList) { parts.push('</ul>'); inList = false; }
            parts.push('<h2>' + escapeHtml(trimmed.slice(3)) + '</h2>');
            continue;
        }
        if (trimmed.startsWith('# ')) {
            if (inList) { parts.push('</ul>'); inList = false; }
            parts.push('<h1>' + escapeHtml(trimmed.slice(2)) + '</h1>');
            continue;
        }
        // list items
        if (/^[-*]\s+/.test(trimmed)) {
            if (!inList) {
                parts.push('<ul>');
                inList = true;
            }
            const item = trimmed.replace(/^[-*]\s+/, '');
            parts.push('<li>' + inlineMd(escapeHtml(item)) + '</li>');
            continue;
        } else if (inList) {
            parts.push('</ul>');
            inList = false;
        }
        // normal paragraph
        parts.push('<p>' + inlineMd(escapeHtml(trimmed)) + '</p>');
    }
    if (inList) parts.push('</ul>');
    return parts.join('');
}

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function renderImage(src, alt = 'View image') {
    if (typeof src !== 'string' || !src.startsWith('data:image/')) return '';
    return `<figure class="chat-image-wrap"><img class="chat-image" alt="${escapeAttr(alt)}" src="${escapeAttr(src)}"></figure>`;
}

function stripMarkdownDataImages(text) {
    if (typeof text !== 'string' || !text) return text;
    // Remove markdown image tags that embed data URLs so we only show rendered images.
    return text
        .replace(/!\[[^\]]*\]\(\s*data:image\/[a-zA-Z0-9.+-]+;base64,[^)]*\)/g, '')
        .trim();
}

function formatChatReply(text, images) {
    const cleanedText = stripMarkdownDataImages(text || '');
    let html = formatMarkdown(cleanedText);
    if (Array.isArray(images) && images.length) {
        for (const src of images) {
            html += renderImage(src);
        }
    }
    return html;
}

function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const cleaned = value.replace(/[$,%\s,]/g, '');
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function toDateMs(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

function inferChartConfig(table) {
    if (!table || !Array.isArray(table.rows) || table.rows.length < 2) return null;
    const rows = table.rows.slice(0, 80);
    const columns = Object.keys(rows[0] || {});
    if (!columns.length) return null;

    const numericCols = columns.filter((col) => {
        let ok = 0;
        for (const row of rows) if (toNumber(row[col]) !== null) ok += 1;
        return ok >= Math.max(2, Math.floor(rows.length * 0.5));
    });
    if (!numericCols.length) return null;

    const dateCols = columns.filter((col) => {
        let ok = 0;
        for (const row of rows) if (toDateMs(row[col]) !== null) ok += 1;
        return ok >= Math.max(2, Math.floor(rows.length * 0.6));
    });

    if (dateCols.length) {
        const dateCol = dateCols[0];
        const valueCol = numericCols.find((c) => c !== dateCol) || numericCols[0];
        const points = rows
            .map((r) => ({ t: toDateMs(r[dateCol]), x: r[dateCol], y: toNumber(r[valueCol]) }))
            .filter((p) => p.t !== null && p.y !== null)
            .sort((a, b) => a.t - b.t);
        if (points.length < 2) return null;
        return {
            type: 'line',
            title: `${table.title || 'Time Series'}: ${valueCol} over ${dateCol}`,
            labels: points.map((p) => String(p.x)),
            datasets: [{
                label: valueCol,
                data: points.map((p) => p.y),
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79, 70, 229, 0.12)',
                tension: 0.25,
                fill: true
            }]
        };
    }

    const categoryCol = columns.find((c) => !numericCols.includes(c)) || columns[0];
    const valueCol = numericCols[0];
    const bars = rows
        .map((r) => ({ c: r[categoryCol], y: toNumber(r[valueCol]) }))
        .filter((p) => p.c != null && p.y !== null);
    if (bars.length < 2) return null;
    return {
        type: 'bar',
        title: `${table.title || 'Category Metrics'}: ${valueCol} by ${categoryCol}`,
        labels: bars.slice(0, 30).map((p) => String(p.c)),
        datasets: [{
            label: valueCol,
            data: bars.slice(0, 30).map((p) => p.y),
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderColor: 'rgba(59, 130, 246, 1)',
            borderWidth: 1
        }]
    };
}

function renderCharts(containerEl, tables) {
    if (!containerEl || !Array.isArray(tables) || !tables.length) return;
    if (typeof Chart === 'undefined') return;
    tables.forEach((table, index) => {
        const config = inferChartConfig(table);
        if (!config) return;
        const wrap = document.createElement('figure');
        wrap.className = 'chat-chart-wrap';
        const caption = document.createElement('figcaption');
        caption.className = 'chat-chart-caption';
        caption.textContent = config.title;
        const canvas = document.createElement('canvas');
        canvas.className = 'chat-chart-canvas';
        wrap.appendChild(caption);
        wrap.appendChild(canvas);
        containerEl.appendChild(wrap);
        new Chart(canvas.getContext('2d'), {
            type: config.type,
            data: {
                labels: config.labels,
                datasets: config.datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    x: { ticks: { maxRotation: 45, minRotation: 0 } },
                    y: { beginAtZero: true }
                }
            }
        });
    });
}

function inlineMd(s) {
    return s
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
}

// -----------------------------
// Add message to chat window
// -----------------------------
function addMessage(text, type) {
    const chatBox = document.getElementById('chatBox');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = formatMarkdown(text);
    chatBox.appendChild(messageDiv);

    // Auto scroll to bottom
    chatBox.scrollTop = chatBox.scrollHeight;
}

// -----------------------------
// Streaming message functions
// -----------------------------
function addStreamingMessage() {
    const chatBox = document.getElementById('chatBox');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot streaming';
    messageDiv.innerHTML = '<div class="thinking"><img src="static/favicon.ico" class="thinking-cat"> Thinking...</div>';
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    // console.log(messageDiv.innerHTML);
    return messageDiv;
}

function updateStreamingMessage(streamingElement, data) {
    if (!streamingElement) {
        console.error('Invalid streaming element');
        return;
    }
    
    if (data.type === 'step') {
        // Update with intermediate step content
        streamingElement.innerHTML = `<div class="thinking"><img src="static/favicon.ico" class="thinking-cat"> ${formatMarkdown(data.content)}</div>`;
        // Only scroll if it is an intermediate step and not the final response
        const chatBox = document.getElementById('chatBox');
        chatBox.scrollTop = chatBox.scrollHeight;
    } else if (data.type === 'final') {
        // Replace with final response
        streamingElement.classList.remove('streaming');
        streamingElement.innerHTML = formatChatReply(data.content, data.images);
        renderCharts(streamingElement, data.tables);
    }
    
    const chatBox = document.getElementById('chatBox');
    // chatBox.scrollTop = chatBox.scrollHeight;
}

// -----------------------------
// Suggested uses panel function (from experimental project)
// -----------------------------
function toggleSuggestedUses() {
    const content = document.getElementById('suggested-uses-content');
    const toggle = document.getElementById('suggested-uses-toggle');
    if (content && toggle) {
        content.classList.toggle('collapsed');
        toggle.textContent = content.classList.contains('collapsed') ? '▼' : '▲';
        toggle.classList.toggle('collapsed', content.classList.contains('collapsed'));
    }
}

// -----------------------------
// Allow Enter to send message
// -----------------------------
function handleEnter(event) {
    if (event.key === 'Enter' && !event.shiftKey && !document.getElementById('sendBtn').disabled) {
        event.preventDefault();
        sendMessage();
    }
}
