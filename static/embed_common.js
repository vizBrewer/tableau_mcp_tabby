// =============================================================================
//  Shared Tableau Embedding helpers (used by portal.js and grants.js)
// =============================================================================

// Tracks in-flight / completed embedding-API script loads, keyed by URL, so we
// only inject each module script once.
const _embeddingApiLoads = {};

/**
 * Dynamically inject the Tableau Embedding API v3 module script and resolve when
 * the custom elements (<tableau-viz>) are defined. The URL is config-driven
 * (customer pod), so it can't be a static <script> tag.
 *
 * @param {string} url Full URL to tableau.embedding.3.latest.min.js on the pod.
 * @returns {Promise<void>}
 */
function loadEmbeddingApi(url) {
    if (!url) {
        return Promise.reject(new Error('No embedding API URL configured. Set it on the Settings page.'));
    }
    if (_embeddingApiLoads[url]) {
        return _embeddingApiLoads[url];
    }

    const promise = new Promise((resolve, reject) => {
        // If a <tableau-viz> is already defined, the API is present.
        if (window.customElements && window.customElements.get('tableau-viz')) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.type = 'module';
        script.src = url;
        script.onload = () => {
            // The module registers custom elements; wait for them to be defined.
            if (window.customElements && window.customElements.whenDefined) {
                window.customElements.whenDefined('tableau-viz').then(resolve, resolve);
            } else {
                resolve();
            }
        };
        script.onerror = () => reject(new Error(`Failed to load embedding API from ${url}`));
        document.head.appendChild(script);
    });

    _embeddingApiLoads[url] = promise;
    return promise;
}

/**
 * Fetch a fresh embedding JWT from the backend.
 * @returns {Promise<{token:string, exp:number, server_url:string, site_content_url:string}>}
 */
async function getEmbedToken() {
    const res = await fetch('/api/embed-token');
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (body && body.detail) detail = body.detail;
        } catch (_) { /* ignore */ }
        throw new Error(detail);
    }
    return res.json();
}

/**
 * Fetch the public portal config (curated groups + embedding endpoints).
 * @returns {Promise<{groups:Array, brand:Object, server_url:string, site_content_url:string, embedding_api_url:string}>}
 */
async function getPortalConfig() {
    const res = await fetch('/api/portal-config');
    if (!res.ok) throw new Error(`Failed to load portal config (HTTP ${res.status})`);
    return res.json();
}
