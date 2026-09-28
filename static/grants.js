// =============================================================================
//  Grants page — single embedded dashboard with filter dropdowns.
//  Token auth flows through the backend (see embed_common.js).
// =============================================================================

// --- Editable demo config -------------------------------------------------
// This page is a fixed single-dashboard demo. Adjust VIZ_URL to your view and
// the FILTER_FIELDS map to your workbook's field names.
const VIZ_URL =
    'https://10ax.online.tableau.com/t/keegandev/views/HealthGrantDisbursements/BorderStateHealthGrantDisbursements2020-2026';
const FILTER_FIELDS = {
    fy: 'Fiscal Year',
    program: 'Program Area',
    geo: 'Region',
};
// ---------------------------------------------------------------------------

let viz = null;
let FilterUpdateTypeRef = null;

const statusEl = document.getElementById('viz-status');

async function initViz() {
    try {
        const cfg = await getPortalConfig();
        await loadEmbeddingApi(cfg.embedding_api_url);

        // Pull FilterUpdateType from the embedding module if available.
        try {
            const mod = await import(cfg.embedding_api_url);
            FilterUpdateTypeRef = mod.FilterUpdateType || null;
        } catch (_) { /* fall back to string literal below */ }

        const { token } = await getEmbedToken();

        viz = document.createElement('tableau-viz');
        viz.setAttribute('src', VIZ_URL);
        viz.setAttribute('token', token);
        viz.setAttribute('toolbar', 'bottom');
        viz.setAttribute('hide-tabs', '');

        viz.addEventListener('firstinteractive', () => {
            statusEl.textContent = 'Loaded';
            statusEl.style.color = 'rgba(255,255,255,0.9)';
        });

        const wrapper = document.getElementById('vizWrapper');
        wrapper.innerHTML = '';
        wrapper.appendChild(viz);
    } catch (err) {
        statusEl.textContent = 'Error: ' + err.message;
        statusEl.style.color = '#ffd2d2';
    }
}

async function applyFilters() {
    if (!viz || !viz.workbook) return;
    const fy = document.getElementById('filter-fy').value;
    const program = document.getElementById('filter-program').value;
    const geo = document.getElementById('filter-geo').value;

    const replace = (FilterUpdateTypeRef && FilterUpdateTypeRef.Replace) || 'replace';
    const all = (FilterUpdateTypeRef && FilterUpdateTypeRef.All) || 'all';

    try {
        const sheet = viz.workbook.activeSheet;
        await sheet.applyFilterAsync(FILTER_FIELDS.fy, fy ? [fy] : [], fy ? replace : all);
        await sheet.applyFilterAsync(FILTER_FIELDS.program, program ? [program] : [], program ? replace : all);
        await sheet.applyFilterAsync(FILTER_FIELDS.geo, geo ? [geo] : [], geo ? replace : all);
    } catch (err) {
        console.warn('Filter error — check field names match your workbook:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('applyBtn').addEventListener('click', applyFilters);
    initViz();
});
