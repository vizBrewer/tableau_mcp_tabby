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

/**
 * State tracked across SSE events for one agent turn.
 *   steps        – ordered list of {type, label, summary?, status}
 *   stepIndex    – map from tool_call_id → index in steps[]
 *   stepsEl      – the <div class="steps-container"> live DOM node
 *   wrapEl       – the outer .message.bot.streaming div
 */
function addStreamingMessage() {
    const chatBox = document.getElementById('chatBox');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot streaming';

    // Initial "thinking" placeholder
    messageDiv.innerHTML = '<div class="thinking"><img src="static/favicon.ico" class="thinking-cat"> Thinking…</div>';

    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    return {
        wrapEl: messageDiv,
        stepsEl: null,      // created lazily on first step event
        steps: [],
        stepIndex: {},
    };
}

function _ensureStepsContainer(ctx) {
    if (ctx.stepsEl) return ctx.stepsEl;
    ctx.wrapEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'steps-container';
    ctx.wrapEl.appendChild(container);
    ctx.stepsEl = container;
    return container;
}

function _renderStep(step) {
    const el = document.createElement('div');
    el.className = `thinking-step ${step.status}`;

    const indicator = document.createElement('span');
    indicator.className = 'step-indicator';
    if (step.status === 'pending') {
        indicator.innerHTML = '<img src="static/favicon.ico" class="thinking-cat">';
    } else if (step.status === 'completed') {
        indicator.textContent = '✓';
    } else {
        indicator.textContent = '•';
    }

    const text = document.createElement('span');
    text.className = 'step-text';
    const label = escapeAttr(step.label);
    const summaryHtml = step.summary
        ? ` <span class="step-summary">${escapeAttr(step.summary)}</span>`
        : '';
    text.innerHTML = `<strong>${label}</strong>${summaryHtml}`;

    // For query-datasource calls, add a collapsible block showing the query args
    const isQueryTool = step.tool_name &&
        step.tool_name.toLowerCase().replace(/_/g, '-') === 'query-datasource';
    if (isQueryTool && step.args) {
        const details = document.createElement('details');
        details.className = 'query-details';
        const summary = document.createElement('summary');
        summary.className = 'query-details-summary';
        summary.textContent = 'View query';
        const pre = document.createElement('pre');
        pre.className = 'query-details-body';
        pre.textContent = typeof step.args === 'string'
            ? step.args
            : JSON.stringify(step.args, null, 2);
        details.appendChild(summary);
        details.appendChild(pre);
        text.appendChild(details);
    }

    el.appendChild(indicator);
    el.appendChild(text);
    return el;
}

function _rebuildStepsList(ctx) {
    const container = ctx.stepsEl;
    if (!container) return;
    container.innerHTML = '';
    for (const step of ctx.steps) {
        container.appendChild(_renderStep(step));
    }
}

function updateStreamingMessage(ctx, data) {
    if (!ctx || !ctx.wrapEl) {
        console.error('Invalid streaming context');
        return;
    }

    const chatBox = document.getElementById('chatBox');

    if (data.type === 'tool_call') {
        // Agent is about to call a tool — add a pending step
        _ensureStepsContainer(ctx);
        const idx = ctx.steps.length;
        ctx.steps.push({ label: data.label, status: 'pending', tool_call_id: data.tool_call_id, tool_name: data.tool_name, args: data.args });
        ctx.stepIndex[data.tool_call_id] = idx;
        _rebuildStepsList(ctx);
        chatBox.scrollTop = chatBox.scrollHeight;

    } else if (data.type === 'tool_result') {
        // Tool returned — mark its step completed and add the summary
        _ensureStepsContainer(ctx);
        const idx = ctx.stepIndex[data.tool_call_id];
        if (idx !== undefined) {
            ctx.steps[idx].status = 'completed';
            ctx.steps[idx].summary = data.summary || '';
        } else {
            // result without a preceding call event — add it as a new completed step
            ctx.steps.push({ label: data.label, summary: data.summary || '', status: 'completed' });
        }
        _rebuildStepsList(ctx);
        chatBox.scrollTop = chatBox.scrollHeight;

    } else if (data.type === 'step') {
        // AI reasoning / thinking text — update or add a "reasoning" row
        _ensureStepsContainer(ctx);
        // Find or create a reasoning step (always the last entry if it's a reasoning type)
        const last = ctx.steps[ctx.steps.length - 1];
        if (last && last._isReasoning) {
            last.label = 'Thinking…';
            last.summary = data.content ? data.content.slice(0, 100) + (data.content.length > 100 ? '…' : '') : '';
        } else {
            ctx.steps.push({ label: 'Thinking…', summary: '', status: 'pending', _isReasoning: true });
        }
        _rebuildStepsList(ctx);
        chatBox.scrollTop = chatBox.scrollHeight;

    } else if (data.type === 'final') {
        // Replace streaming content with the final answer + collapsible steps log
        ctx.wrapEl.classList.remove('streaming');

        const stepCount = ctx.steps.filter(s => !s._isReasoning).length;
        const stepsHtml = stepCount > 0 ? _buildStepsSummaryHtml(ctx.steps) : '';
        ctx.wrapEl.innerHTML = stepsHtml + formatChatReply(data.content, data.images);

        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

function _buildStepsSummaryHtml(steps) {
    const toolSteps = steps.filter(s => !s._isReasoning);
    if (!toolSteps.length) return '';
    const rows = toolSteps.map(s => {
        const icon = s.status === 'completed' ? '✓' : '•';
        const summary = s.summary ? ` <span class="step-summary">${escapeAttr(s.summary)}</span>` : '';
        const isQueryTool = s.tool_name &&
            s.tool_name.toLowerCase().replace(/_/g, '-') === 'query-datasource';
        const queryBlock = (isQueryTool && s.args)
            ? `<details class="query-details"><summary class="query-details-summary">View query</summary>` +
              `<pre class="query-details-body">${escapeAttr(typeof s.args === 'string' ? s.args : JSON.stringify(s.args, null, 2))}</pre></details>`
            : '';
        return `<div class="thinking-step ${s.status}">` +
               `<span class="step-indicator">${icon}</span>` +
               `<span class="step-text"><strong>${escapeAttr(s.label)}</strong>${summary}${queryBlock}</span>` +
               `</div>`;
    }).join('');
    return `<details class="steps-details"><summary class="steps-summary">${toolSteps.length} step${toolSteps.length !== 1 ? 's' : ''}</summary>` +
           `<div class="steps-container">${rows}</div></details>`;
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
