// =============================================================================
//  Floating Tabby chat widget — injects a toggle button (bottom-right) and a
//  slide-up panel that embeds the chat UI (/widget) via an iframe.
//  Include this script on any page to add the widget.
// =============================================================================

(function () {
    // Avoid double-injection if the script is included twice.
    if (window.__tabbyWidgetInjected) return;
    window.__tabbyWidgetInjected = true;

    // Self-contained styles so the widget works on any page regardless of its CSS.
    const WIDGET_CSS = `
        #tabbyWidgetBtn {
            position: fixed; bottom: 22px; right: 22px;
            width: 60px; height: 60px; border-radius: 50%;
            background: #2c3e50; border: 2px solid #fff;
            box-shadow: 0 4px 16px rgba(0,0,0,.3); cursor: pointer;
            z-index: 2147483646; display: flex; align-items: center; justify-content: center;
            padding: 0; transition: transform .15s, box-shadow .15s;
        }
        #tabbyWidgetBtn:hover { transform: scale(1.06); box-shadow: 0 6px 22px rgba(0,0,0,.38); }
        #tabbyWidgetBtn img { width: 38px; height: 38px; object-fit: contain; }
        #tabbyWidgetPanel {
            position: fixed; bottom: 92px; right: 22px;
            width: 380px; max-width: calc(100vw - 32px);
            height: 540px; max-height: calc(100vh - 130px);
            background: #fff; border-radius: 12px;
            box-shadow: 0 12px 40px rgba(0,0,0,.35);
            z-index: 2147483647; display: none; flex-direction: column; overflow: hidden;
            transition: width .18s ease, height .18s ease;
        }
        #tabbyWidgetPanel.open { display: flex; }
        #tabbyWidgetPanel.expanded {
            width: 720px; height: calc(100vh - 130px);
        }
        #tabbyWidgetPanel .tabby-widget-header {
            background: #2c3e50; color: #fff; padding: 10px 14px;
            display: flex; align-items: center; gap: 8px;
            font-weight: 600; font-size: 15px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        }
        #tabbyWidgetPanel .tabby-widget-header img { width: 24px; height: 24px; }
        #tabbyWidgetPanel .tabby-widget-btn {
            background: transparent; border: none; color: #fff;
            font-size: 18px; cursor: pointer; line-height: 1; padding: 2px 6px;
        }
        #tabbyWidgetPanel .tabby-widget-expand { margin-left: auto; }
        #tabbyWidgetPanel .tabby-widget-btn:hover { opacity: .7; }
        #tabbyWidgetPanel .tabby-widget-iframe { flex: 1 1 auto; width: 100%; border: none; }
        @media (max-width: 600px) {
            #tabbyWidgetPanel,
            #tabbyWidgetPanel.expanded { width: calc(100vw - 24px); right: 12px; height: calc(100vh - 110px); }
        }
    `;

    function injectStyles() {
        const style = document.createElement('style');
        style.id = 'tabbyWidgetStyles';
        style.textContent = WIDGET_CSS;
        document.head.appendChild(style);
    }

    function injectWidget() {
        injectStyles();
        // Floating toggle button — uses the Tabby cat favicon as the icon.
        const btn = document.createElement('button');
        btn.id = 'tabbyWidgetBtn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Open Tabby chat');
        btn.title = 'Ask Tabby';
        btn.innerHTML = '<img src="/static/favicon.ico" alt="Tabby">';

        // Slide-up chat panel containing the chat UI in an iframe.
        const panel = document.createElement('div');
        panel.id = 'tabbyWidgetPanel';
        panel.innerHTML = `
            <div class="tabby-widget-header">
                <img src="/static/favicon.ico" alt="Tabby">
                <span>Tabby Data Assistant</span>
                <button type="button" class="tabby-widget-btn tabby-widget-expand" aria-label="Expand chat" title="Expand">⤢</button>
                <button type="button" class="tabby-widget-btn tabby-widget-close" aria-label="Close chat" title="Close">&times;</button>
            </div>
            <iframe class="tabby-widget-iframe" title="Tabby chat"></iframe>
        `;

        document.body.appendChild(btn);
        document.body.appendChild(panel);

        const iframe = panel.querySelector('.tabby-widget-iframe');
        const closeBtn = panel.querySelector('.tabby-widget-close');
        const expandBtn = panel.querySelector('.tabby-widget-expand');
        let loaded = false;

        function openPanel() {
            // Lazy-load the chat iframe on first open so it doesn't start a
            // session until the user wants it.
            if (!loaded) {
                iframe.src = '/widget';
                loaded = true;
            }
            panel.classList.add('open');
        }

        function closePanel() {
            panel.classList.remove('open');
        }

        function togglePanel() {
            if (panel.classList.contains('open')) {
                closePanel();
            } else {
                openPanel();
            }
        }

        function toggleExpand() {
            const expanded = panel.classList.toggle('expanded');
            // Swap glyph and label to reflect the next action (⤢ expand / ⤡ shrink).
            expandBtn.textContent = expanded ? '⤡' : '⤢';
            expandBtn.title = expanded ? 'Shrink' : 'Expand';
            expandBtn.setAttribute('aria-label', expanded ? 'Shrink chat' : 'Expand chat');
        }

        btn.addEventListener('click', togglePanel);
        closeBtn.addEventListener('click', closePanel);
        expandBtn.addEventListener('click', toggleExpand);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectWidget);
    } else {
        injectWidget();
    }
})();
