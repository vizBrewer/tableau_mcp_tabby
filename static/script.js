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
    const streamingContext = addStreamingMessage();

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
        console.error('Error:', error);
        updateStreamingMessage(streamingContext, {
            type: 'final',
            content: '⚠️ Could not connect to the server. Refresh the page to start a new session.',
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
        streamingElement.innerHTML = `<div class="thinking"><img src="static/favicon.ico" class="thinking-cat"> ${data.content.replace(/\n/g, '<br>')}</div>`;
        // Only scroll if it is an intermediate step and not the final response
        const chatBox = document.getElementById('chatBox');
        chatBox.scrollTop = chatBox.scrollHeight;
    } else if (data.type === 'final') {
        // Replace with final response
        streamingElement.classList.remove('streaming');
        streamingElement.innerHTML = data.content.replace(/\n/g, '<br>');
    }
    
    const chatBox = document.getElementById('chatBox');
    // chatBox.scrollTop = chatBox.scrollHeight;
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
