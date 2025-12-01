// =============================
//  Tabby AI Chat - Frontend Logic
// =============================
console.log("script.js IS LOADED");
// Persistent thread ID for conversation state
let THREAD_ID = null;

// -----------------------------
// Initialize session on page load
// -----------------------------
document.addEventListener('DOMContentLoaded', async function () {
    document.getElementById('messageInput').focus();
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
    } catch (err) {
        console.error("Failed to initialize session:", err);
        addMessage('Could not start chat session. Please refresh.', 'bot');
    }
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

    // Disable send button
    const btn = document.getElementById('sendBtn');
    btn.disabled = true;
    btn.textContent = 'Thinking...';

    // Create a placeholder for the streaming response
    const streamingMessageId = addStreamingMessage();

    try {
        const response = await fetch('/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                thread_id: THREAD_ID
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        updateStreamingMessage(streamingMessageId, data);
                    } catch (e) {
                        console.error('Error parsing SSE data:', e);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error:', error);
        updateStreamingMessage(streamingMessageId, {
            type: 'final',
            content: '⚠️ Could not connect to the server.',
            is_final: true
        });
    }

    // Re-enable button
    btn.disabled = false;
    btn.textContent = 'Send';
}

// -----------------------------
// Add message to chat window
// -----------------------------
function addMessage(text, type) {
    const chatBox = document.getElementById('chatBox');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = text.replace(/\n/g, '<br>');
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
    messageDiv.innerHTML = '<div class="thinking"><img src="static/favicon.ico" class="thinking-cat"> Analyzing your request...</div>';
    
    chatBox.appendChild(messageDiv);
    
    // Auto scroll to bottom
    chatBox.scrollTop = chatBox.scrollHeight;
    
    return messageDiv;
}

function updateStreamingMessage(messageElement, data) {
    if (data.type === 'thinking') {
        // Show agent thinking/planning
        messageElement.innerHTML = `<div class="thinking-step">
            <span class="step-indicator">💭</span> 
            <span class="step-text">${data.content.replace(/\n/g, '<br>')}</span>
        </div>`;
    } else if (data.type === 'tool_call') {
        // Show tool being called
        messageElement.innerHTML = `<div class="thinking-step">
            <span class="step-indicator">🔧</span> 
            <span class="step-text">${data.content.replace(/\n/g, '<br>')}</span>
        </div>`;
    } else if (data.type === 'tool_result') {
        // Show tool completion
        messageElement.innerHTML = `<div class="thinking-step">
            <span class="step-indicator">✅</span> 
            <span class="step-text">${data.content.replace(/\n/g, '<br>')}</span>
        </div>`;
    } else if (data.type === 'step') {
        // Show generic step (fallback)
        messageElement.innerHTML = `<div class="thinking-step">
            <span class="step-indicator">💭</span> 
            <span class="step-text">${data.content.replace(/\n/g, '<br>')}</span>
        </div>`;
    } else if (data.type === 'final') {
        // Show final result and remove streaming class
        messageElement.classList.remove('streaming');
        messageElement.innerHTML = data.content.replace(/\n/g, '<br>');
    }
    
    // Auto scroll to bottom
    const chatBox = document.getElementById('chatBox');
    chatBox.scrollTop = chatBox.scrollHeight;
}

// -----------------------------
// Allow Enter to send message
// -----------------------------
function handleEnter(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}
