// =============================================================================
//  Portal logic — collapsible sidebar of curated groups, token-authenticated
//  Tableau embeds. Content comes from /api/portal-config (a curated projection
//  of the synced catalog); the embedding API script + JWTs come from the
//  backend (see embed_common.js).
//
//  Config shape:
//    { groups: [ { id, name, icon, dashboards:[{id,name,viz_url,toolbar,icon,
//                    datasource_content_url, datasource_name}],
//                  datasources:[{id,content_url,name,project,type,description,
//                    has_extracts}] } ],
//      brand: { title },
//      server_url, site_content_url, embedding_api_url }
// =============================================================================

let PORTAL_CONFIG = null;

const navTree = document.getElementById('navTree');
const SIDEBAR_KEY = 'portal.sidebarCollapsed';

// -----------------------------
// Escaping helper
// -----------------------------
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

// -----------------------------
// Build the sidebar tree from config groups
// -----------------------------
function buildTree(groups) {
    navTree.innerHTML = '';
    groups.forEach((group, gi) => {
        const groupId = group.id || `grp-${gi}`;
        const dashboards = group.dashboards || [];

        const li = document.createElement('li');
        li.className = 'group';
        li.dataset.key = groupId;

        const gicon = group.icon || 'fa-layer-group';
        li.innerHTML = `
          <div class="node" role="button" aria-expanded="false">
            <span class="caret"><i class="fa-solid fa-chevron-right"></i></span>
            <span class="grp-icon"><i class="fa-solid ${escapeHtml(gicon)}"></i></span>
            <span class="label">${escapeHtml(group.name || groupId)}</span>
            <span class="badge">${dashboards.length}</span>
          </div>
          <ul class="children"></ul>
        `;
        const kids = li.querySelector('.children');

        dashboards.forEach((d, di) => {
            const dashId = d.id || `dash-${gi}-${di}`;
            const icon = d.icon || 'fa-chart-column';
            // Self-published → Edit (pencil); linked datasource → Explore (chart).
            const canEdit = !!(d.self_published && d.authoring_url);
            const hasDs = !canEdit && !!d.datasource_content_url;
            const hasSecond = canEdit || hasDs;
            const secondIcon = canEdit ? 'fa-pen-to-square' : 'fa-magnifying-glass-chart';
            const secondTitle = canEdit
                ? 'Edit workbook'
                : (hasDs ? 'Explore data — ' + (d.datasource_name || '') : '');
            const row = document.createElement('li');
            row.className = 'dash-row';
            row.dataset.group = groupId;
            row.dataset.dash = dashId;
            // Dashboard label + icon FIRST; edit/explore link icon SECOND.
            row.innerHTML = `
              <div class="dash-main" data-role="open-dash">
                <span class="d-icon"><i class="fa-solid ${escapeHtml(icon)}"></i></span>
                <span class="d-name">${escapeHtml(d.name || dashId)}</span>
              </div>
              <span class="explore-link ${hasSecond ? '' : 'placeholder'}"
                    data-role="explore-dash"
                    title="${escapeHtml(secondTitle)}">
                <i class="fa-solid ${secondIcon}"></i>
              </span>
            `;
            kids.appendChild(row);
        });

        navTree.appendChild(li);
    });
}

// -----------------------------
// Lookups
// -----------------------------
function findGroup(groupId) {
    const groups = (PORTAL_CONFIG && PORTAL_CONFIG.groups) || [];
    return groups.find((g, i) => (g.id || `grp-${i}`) === groupId) || null;
}

function findDashboard(groupId, dashId) {
    const group = findGroup(groupId);
    if (!group) return { group: null, dash: null };
    const gi = ((PORTAL_CONFIG.groups || []).indexOf(group));
    const dash = (group.dashboards || []).find(
        (d, di) => (d.id || `dash-${gi}-${di}`) === dashId
    );
    return { group, dash: dash || null };
}

// -----------------------------
// Sidebar interactions
// -----------------------------
navTree.addEventListener('click', (e) => {
    const explore = e.target.closest('[data-role="explore-dash"]');
    if (explore && !explore.classList.contains('placeholder')) {
        e.stopPropagation();
        const row = explore.closest('.dash-row');
        setActiveRow(row);
        openDashboard(row.dataset.group, row.dataset.dash, { startTab: 'explore' });
        return;
    }

    const dashMain = e.target.closest('[data-role="open-dash"]');
    if (dashMain) {
        const row = dashMain.closest('.dash-row');
        setActiveRow(row);
        openDashboard(row.dataset.group, row.dataset.dash, { startTab: 'viz' });
        return;
    }

    // Otherwise: toggle the group open/closed.
    const groupNode = e.target.closest('.group > .node');
    if (groupNode) {
        groupNode.parentElement.classList.toggle('expanded');
        const open = groupNode.parentElement.classList.contains('expanded');
        groupNode.setAttribute('aria-expanded', String(open));
    }
});

// -----------------------------
// Top menu: Dashboards (tree) vs Data Sources (global gallery)
// -----------------------------
function activateMenu(which) {
    document.querySelectorAll('.menu-item').forEach((m) =>
        m.classList.toggle('active', m.dataset.menu === which));
    if (which === 'datasources') {
        navTree.style.display = 'none';
        showDatasourceGallery();
    } else {
        navTree.style.display = '';
    }
}

document.getElementById('menuDashboards').addEventListener('click', () => activateMenu('dashboards'));
document.getElementById('menuDatasources').addEventListener('click', () => activateMenu('datasources'));

// -----------------------------
// Welcome screen: a thumbnail gallery of every dashboard in the portal groups
// -----------------------------
function showWelcomeGallery() {
    const groups = (PORTAL_CONFIG && PORTAL_CONFIG.groups) || [];
    const withDashboards = groups.filter((g) => (g.dashboards || []).length);

    document.getElementById('pageTitle').textContent = (PORTAL_CONFIG && PORTAL_CONFIG.brand && PORTAL_CONFIG.brand.title) || 'Welcome';
    document.getElementById('crumbs').textContent = 'Browse dashboards';

    const section = document.getElementById('content');
    section.innerHTML = '';

    if (!withDashboards.length) {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<h3>Getting started</h3>
            <p class="muted">No dashboards configured yet. Sync your Tableau site and build groups on the
            <a class="link" href="/settings">Settings</a> page.</p>`;
        section.appendChild(card);
        return;
    }

    withDashboards.forEach((group, gi) => {
        const groupId = group.id || `grp-${gi}`;
        const dashboards = group.dashboards || [];

        const sec = document.createElement('div');
        sec.className = 'thumb-section';
        sec.innerHTML = `
          <div class="thumb-section-head">
            <span class="grp-ic"><i class="fa-solid ${escapeHtml(group.icon || 'fa-layer-group')}"></i></span>
            <h2>${escapeHtml(group.name || groupId)}</h2>
            <span class="count">${dashboards.length}</span>
          </div>
          <div class="thumb-gallery"></div>
        `;
        const grid = sec.querySelector('.thumb-gallery');

        dashboards.forEach((d, di) => {
            const dashId = d.id || `dash-${gi}-${di}`;
            const card = document.createElement('div');
            card.className = 'thumb-card';
            card.innerHTML = `
              <div class="thumb-imgwrap">
                <div class="thumb-skeleton"></div>
                <img class="thumb-img" loading="lazy" alt="${escapeHtml(d.name || dashId)}"
                     src="/api/view-thumbnail/${encodeURIComponent(d.id)}" style="display:none">
              </div>
              <div class="thumb-meta">
                <div class="thumb-name">${escapeHtml(d.name || dashId)}</div>
                ${d.datasource_content_url ? '<div class="thumb-ds"><i class="fa-solid fa-magnifying-glass-chart"></i> Explore data available</div>' : ''}
              </div>
            `;
            const imgwrap = card.querySelector('.thumb-imgwrap');
            const img = card.querySelector('.thumb-img');
            const skel = card.querySelector('.thumb-skeleton');
            img.addEventListener('load', () => { img.style.display = 'block'; skel.remove(); });
            img.addEventListener('error', () => {
                skel.remove();
                imgwrap.innerHTML = '<i class="fa-solid fa-chart-column thumb-fallback"></i>';
            });
            card.addEventListener('click', () => {
                setActiveRow(null);
                openDashboard(groupId, dashId, { startTab: 'viz' });
            });
            grid.appendChild(card);
        });
        section.appendChild(sec);
    });
}

function setActiveRow(row) {
    document.querySelectorAll('.dash-row.active').forEach((r) => r.classList.remove('active'));
    if (row) row.classList.add('active');
}

// -----------------------------
// Search / filter
// -----------------------------
document.getElementById('search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    // If the Data Sources gallery is active, filter it instead of the tree.
    if (document.getElementById('menuDatasources').classList.contains('active')) {
        filterGallery(q);
        return;
    }
    document.querySelectorAll('#navTree .group').forEach((grp) => {
        const groupText = grp.querySelector('.node .label').innerText.toLowerCase();
        const matchesGroup = groupText.includes(q);
        let matchesChild = false;
        grp.querySelectorAll('.dash-row').forEach((n) => {
            const nameEl = n.querySelector('.d-name');
            const show = !q || (nameEl && nameEl.innerText.toLowerCase().includes(q)) || matchesGroup;
            n.style.display = show ? '' : 'none';
            if (show && q) matchesChild = true;
        });
        grp.style.display = (!q || matchesGroup || matchesChild) ? '' : 'none';
        if (q && (matchesGroup || matchesChild)) grp.classList.add('expanded');
        if (!q) grp.classList.remove('expanded');
    });
});

document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        document.getElementById('search').focus();
    }
});

// -----------------------------
// Sidebar collapse (persisted) + mobile drawer
// -----------------------------
function applySidebarState() {
    const collapsed = localStorage.getItem(SIDEBAR_KEY) === '1';
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    const icon = document.querySelector('#collapseBtn i');
    if (icon) icon.className = collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
}

document.getElementById('collapseBtn').addEventListener('click', () => {
    const collapsed = !(localStorage.getItem(SIDEBAR_KEY) === '1');
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
    applySidebarState();
});

document.getElementById('mobileToggle').addEventListener('click', () => {
    document.body.classList.toggle('mobile-open');
});
document.getElementById('scrim').addEventListener('click', () => {
    document.body.classList.remove('mobile-open');
});

// The v3 <tableau-viz>/<tableau-authoring-viz> sizes its iframe from the
// `width`/`height` PROPERTIES on the element — not CSS and not a window resize
// event (see Tableau's resize.html sample, which sets viz.width/viz.height
// directly). CSS width:100% on the custom element does NOT reflow the inner
// iframe, so collapsing the sidebar leaves dead space. Fix: track the live viz
// element and, whenever the content area's width changes (sidebar collapse or
// browser resize), set viz.width to the new pixel width. This reflows in place
// — no re-embed, so no reload and no lost authoring work.
let CURRENT_VIZ = null; // the live <tableau-viz>/<tableau-authoring-viz> element

function sizeVizToHost(viz) {
    if (!viz || !viz.isConnected) return;
    const host = viz.parentElement;
    if (!host) return;
    const w = Math.floor(host.getBoundingClientRect().width);
    if (w > 0) viz.width = w; // px — the API reflows the iframe to this width
}

(function watchContentResize() {
    const content = document.getElementById('content');
    if (!content || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => sizeVizToHost(CURRENT_VIZ));
    });
    ro.observe(content);
})();

// -----------------------------
// Open a dashboard: render the two-tab viz card and embed
// -----------------------------
async function openDashboard(groupId, dashId, opts = {}) {
    const { group, dash } = findDashboard(groupId, dashId);
    if (!dash) return;
    document.body.classList.remove('mobile-open');
    // Ensure the Dashboards menu is the active surface (tree visible).
    document.querySelectorAll('.menu-item').forEach((m) =>
        m.classList.toggle('active', m.dataset.menu === 'dashboards'));
    navTree.style.display = '';

    document.getElementById('pageTitle').textContent = dash.name || 'Dashboard';
    document.getElementById('crumbs').textContent = `${group.name || groupId} › ${dash.name || dashId}`;

    const section = document.getElementById('content');
    section.innerHTML = '';

    // Self-published views get an "Edit" tab (open the existing workbook in Web
    // Authoring); everything else with a linked datasource gets "Explore Data"
    // (author a NEW workbook from that datasource). Self-published wins.
    const canEdit = !!(dash.self_published && dash.authoring_url);
    const hasDatasource = !canEdit && !!dash.datasource_content_url;
    const hasSecondTab = canEdit || hasDatasource;
    const secondLabel = canEdit ? 'Edit' : 'Explore Data';

    const card = document.createElement('div');
    card.className = 'viz-card';
    card.innerHTML = `
      <div class="viz-head">
        <h3>${escapeHtml(dash.name || 'Dashboard')}</h3>
        <span class="tableau-badge"><i class="fa-solid fa-bolt"></i> Tableau</span>
      </div>
      <div class="tabs">
        <div class="tab" data-tab="viz">Dashboard</div>
        ${hasSecondTab ? `<div class="tab" data-tab="explore">${secondLabel}</div>` : ''}
      </div>
      <div class="tabpanel" id="tab-viz">
        <div id="vizHost" class="viz-host iframe-shell"><span>Loading Tableau viz…</span></div>
      </div>
      ${hasSecondTab ? `
      <div class="tabpanel" id="tab-explore">
        <div id="vizExplore" class="viz-host iframe-shell"><span>Open this tab to launch Web Authoring…</span></div>
      </div>` : ''}
    `;
    section.appendChild(card);

    let exploreLoaded = false;
    card.querySelectorAll('.tab').forEach((t) => {
        t.addEventListener('click', () => {
            card.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
            t.classList.add('active');
            card.querySelectorAll('.tabpanel').forEach((p) => p.classList.remove('active'));
            card.querySelector('#tab-' + t.dataset.tab).classList.add('active');
            if (t.dataset.tab === 'explore' && !exploreLoaded) {
                exploreLoaded = true;
                const authOpts = canEdit
                    ? { authoring_url: dash.authoring_url, groupId }
                    : { datasource_content_url: dash.datasource_content_url, groupId };
                embedAuthoring(card.querySelector('#vizExplore'), authOpts);
            } else {
                // Re-point the resize watcher at the now-visible viz and fit it
                // (a viz sized while its panel was display:none reads width 0).
                const viz = card.querySelector('#tab-' + t.dataset.tab + ' tableau-viz, #tab-' + t.dataset.tab + ' tableau-authoring-viz');
                if (viz) { CURRENT_VIZ = viz; sizeVizToHost(viz); }
            }
        });
    });

    // Activate the requested starting tab.
    const startTab = (opts.startTab === 'explore' && hasSecondTab) ? 'explore' : 'viz';
    card.querySelector(`.tab[data-tab="${startTab}"]`).click();

    await embedViz(card.querySelector('#vizHost'), dash);
}

// Render an embed error into the viz host (used by the catch blocks and the
// Embedding API's own vizloaderror event, which fires AFTER a viz is appended —
// e.g. a missing authoring scope or an unreachable src).
function showVizError(host, title, detail) {
    if (!host) return;
    host.classList.add('iframe-shell');
    host.innerHTML = `<span>${escapeHtml(title)}${detail ? ' — ' + escapeHtml(detail) : ''}</span>`;
}

// Pull a human-readable message out of a vizloaderror event (shape varies by
// API version: detail may be a string, {message}, or {errorCode, ...}).
function vizErrorMessage(e) {
    const d = e && e.detail;
    if (!d) return '';
    if (typeof d === 'string') return d;
    return d.message || d.errorMessage || d.errorCode || '';
}

// -----------------------------
// Create a <tableau-viz> with a freshly-minted token
// -----------------------------
async function embedViz(host, dash) {
    try {
        await loadEmbeddingApi(PORTAL_CONFIG.embedding_api_url);
        const { token } = await getEmbedToken();
        host.classList.remove('iframe-shell');
        host.innerHTML = '';
        const viz = document.createElement('tableau-viz');
        viz.setAttribute('src', dash.viz_url);
        viz.setAttribute('token', token);
        viz.setAttribute('toolbar', dash.toolbar || 'hidden');
        viz.style.height = '820px';
        viz.addEventListener('vizloaderror', (e) =>
            showVizError(host, 'Could not load dashboard', vizErrorMessage(e)));
        host.appendChild(viz);
        // Size to the host width now and keep it in sync on collapse/resize.
        CURRENT_VIZ = viz;
        sizeVizToHost(viz);
        viz.addEventListener('firstinteractive', () => sizeVizToHost(viz));
    } catch (err) {
        showVizError(host, 'Could not load dashboard', err.message);
    }
}

// -----------------------------
// Create a <tableau-authoring-viz> for Web Authoring on a datasource
//
// `authoringNewWorkbook/<guid>/<content_url>` expects the datasource's
// contentUrl (NOT the LUID, NOT the display name). Callers pass
// { datasource_content_url }.
// -----------------------------
async function embedAuthoring(host, opts) {
    try {
        await loadEmbeddingApi(PORTAL_CONFIG.embedding_api_url);
        const { token, server_url, site_content_url } = await getEmbedToken();
        const base = (server_url || PORTAL_CONFIG.server_url || '').replace(/\/+$/, '');
        const site = site_content_url || PORTAL_CONFIG.site_content_url || '';
        const guid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        const contentUrl = opts && opts.datasource_content_url;
        // Edit an EXISTING workbook: caller passes a ready authoring_url (view
        // URL with /views/→/authoring/). Otherwise author a NEW workbook — with a
        // datasource (authoringNewWorkbook/<guid>/<contentUrl>) or blank (newWorkbook/<guid>).
        const authoringUrl = (opts && opts.authoring_url)
            ? opts.authoring_url
            : (contentUrl
                ? `${base}/t/${site}/authoringNewWorkbook/${guid}/${contentUrl}`
                : `${base}/t/${site}/newWorkbook/${guid}`);

        host.classList.remove('iframe-shell');
        host.innerHTML = '';
        const viz = document.createElement('tableau-authoring-viz');
        viz.setAttribute('src', authoringUrl);
        viz.setAttribute('token', token);
        viz.setAttribute('toolbar', 'hidden');
        viz.hideCloseButton = true;
        viz.style.minHeight = '820px';
        host.style.minHeight = '820px';
        viz.addEventListener('vizloaderror', (e) => {
            // The most common authoring failure is a JWT missing the
            // tableau:views:embed_authoring scope — hint at it.
            const msg = vizErrorMessage(e);
            showVizError(host, 'Could not load Web Authoring',
                msg || 'check that the embed token includes the tableau:views:embed_authoring scope (Settings).');
        });
        // When the user publishes/saves the authored workbook, add its sheet(s)
        // to a portal group. workbookpublishedas fires for a new workbook;
        // workbookpublished for subsequent saves. Both route through one handler.
        viz.addEventListener('workbookpublishedas', (e) => handleAuthoringPublish(viz, opts, e));
        viz.addEventListener('workbookpublished', (e) => handleAuthoringPublish(viz, opts, e));
        host.appendChild(viz);
        // Property-based sizing reflows in place (no reload → no lost work).
        CURRENT_VIZ = viz;
        sizeVizToHost(viz);
        viz.addEventListener('firstinteractive', () => sizeVizToHost(viz));
    } catch (err) {
        showVizError(host, 'Could not load Web Authoring', err.message);
    }
}

// -----------------------------
// Publish → add published sheet(s) to a portal group
// -----------------------------
// A publish can fire workbookpublishedas + workbookpublished in quick
// succession; debounce so we only act (and toast) once per publish burst.
async function handleAuthoringPublish(viz, opts, event) {
    const now = Date.now();
    if (viz.__portalPublishAt && now - viz.__portalPublishAt < 5000) return;

    // workbookpublishedas carries { newUrl }; bare workbookpublished carries
    // nothing. The name isn't reliably on viz.workbook at this point, so the
    // backend resolves the workbook from newUrl against a fresh REST catalog.
    const newUrl = (event && event.detail && event.detail.newUrl) || '';
    let workbookName = '';
    try { workbookName = (viz.workbook && viz.workbook.name) || ''; } catch (_) {}
    let sheetNames = [];
    try { sheetNames = (viz.workbook.publishedSheetsInfo || []).map((s) => s && s.name).filter(Boolean); } catch (_) {}

    if (!newUrl && !workbookName) {
        // A bare re-save with no payload and no readable workbook — the sheet is
        // already in the portal from the first publish, so nothing to do.
        return;
    }
    viz.__portalPublishAt = now;

    // Auto-add when we know the launch group; otherwise ask which group.
    let groupId = opts && opts.groupId;
    if (!groupId) {
        groupId = await promptForGroup(workbookName || 'this workbook');
        if (!groupId) return; // cancelled
    }

    try {
        const res = await fetch('/api/portal-config/add-published', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                group_id: groupId,
                new_url: newUrl,
                workbook_name: workbookName,
                sheet_names: sheetNames,
                // The datasource authoring was launched on → auto-link it.
                datasource_content_url: (opts && opts.datasource_content_url) || '',
            }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
        const gName = (findGroup(body.group_id) || {}).name || 'the portal';
        showToast(`Added ${body.added_count} sheet(s) from “${body.workbook}” to ${gName}.`);
        // Refresh config + tree so the new dashboard appears immediately.
        PORTAL_CONFIG = await getPortalConfig();
        buildTree(PORTAL_CONFIG.groups || []);
        const badge = document.getElementById('dsMenuBadge');
        if (badge) { const n = (PORTAL_CONFIG.datasources || []).length; badge.textContent = n ? String(n) : ''; }
    } catch (err) {
        showToast('Could not add to portal: ' + err.message, true);
    }
}

// Lightweight modal to choose a target group when there's no launch context.
function promptForGroup(workbookName) {
    return new Promise((resolve) => {
        const groups = (PORTAL_CONFIG && PORTAL_CONFIG.groups) || [];
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
          <div class="modal">
            <h3>Add to portal</h3>
            <p class="muted">Published “${escapeHtml(workbookName)}”. Which group should it appear in?</p>
            <select id="grpPick">
              ${groups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('')}
            </select>
            <div class="modal-actions">
              <button type="button" class="btn-ghost" id="grpCancel">Cancel</button>
              <button type="button" class="btn-primary" id="grpAdd">Add</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        const close = (val) => { overlay.remove(); resolve(val); };
        overlay.querySelector('#grpCancel').addEventListener('click', () => close(null));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
        overlay.querySelector('#grpAdd').addEventListener('click', () =>
            close(overlay.querySelector('#grpPick').value || null));
        if (!groups.length) {
            overlay.querySelector('.modal p').textContent =
                'No portal groups exist yet — create one on the Settings page first.';
            overlay.querySelector('#grpAdd').disabled = true;
        }
    });
}

let _toastTimer = 0;
function showToast(message, isError) {
    let el = document.getElementById('portalToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'portalToast';
        el.className = 'toast';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('toast-error', !!isError);
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

// -----------------------------
// Data Sources gallery (global — every synced datasource)
// -----------------------------
function showDatasourceGallery() {
    const datasources = (PORTAL_CONFIG && PORTAL_CONFIG.datasources) || [];
    document.body.classList.remove('mobile-open');
    setActiveRow(null);

    document.getElementById('pageTitle').textContent = 'Data Sources';
    document.getElementById('crumbs').textContent = 'Data Sources › Pick one to explore & author';

    const section = document.getElementById('content');
    section.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'gallery-toolbar';
    toolbar.innerHTML = `
        <button type="button" id="newDashboardBtn" class="btn-primary">
            <i class="fa-solid fa-plus"></i> Build New Dashboard
        </button>
        <input type="search" id="gallerySearch" class="gallery-search" placeholder="Search data sources…" />
        <span class="hint-inline">Click a data source to author a new view against it.</span>
    `;
    section.appendChild(toolbar);
    toolbar.querySelector('#newDashboardBtn').addEventListener('click', openNewDashboard);

    if (!datasources.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.innerHTML = `<div><i class="fa-solid fa-database"></i></div>
            <div>No data sources in the portal yet.</div>
            <div class="hint-inline" style="margin-top:6px;">Add data sources to a group on the
            <a class="link" href="/settings">Settings</a> page to show them here.</div>`;
        section.appendChild(empty);
        return;
    }

    const gallery = document.createElement('div');
    gallery.className = 'ds-gallery';
    gallery.id = 'dsGallery';
    datasources.forEach((ds, i) => {
        const dsId = ds.id || `ds-${i}`;
        const card = document.createElement('div');
        card.className = 'ds-card';
        card.dataset.dsIndex = String(i);
        card.dataset.search = `${ds.name || ''} ${ds.project || ''} ${ds.description || ''} ${ds.type || ''}`.toLowerCase();
        card.innerHTML = `
            <button class="ds-copy" title="Copy datasource LUID" data-luid="${escapeHtml(ds.id || '')}">
              <i class="fa-solid fa-copy"></i>
            </button>
            <div class="ds-top">
              <div class="ds-avatar"><i class="fa-solid fa-database"></i></div>
              <div class="ds-name">${escapeHtml(ds.name || dsId)}</div>
            </div>
            <div class="ds-meta">
              <span class="chip">${escapeHtml(ds.project || 'No project')}</span>
              ${ds.type ? `<span class="chip">${escapeHtml(ds.type)}</span>` : ''}
              ${ds.has_extracts ? '<span class="chip extract"><i class="fa-solid fa-bolt"></i> extract</span>' : ''}
            </div>
            ${ds.description ? `<div class="ds-desc">${escapeHtml(ds.description)}</div>` : ''}
            <div class="ds-cta"><i class="fa-solid fa-magnifying-glass-chart"></i> Explore &amp; author</div>
        `;
        card.addEventListener('click', (e) => {
            if (e.target.closest('.ds-copy')) return; // copy handled separately
            openDatasource(i);
        });
        card.querySelector('.ds-copy').addEventListener('click', (e) => {
            e.stopPropagation();
            copyLuid(e.currentTarget);
        });
        gallery.appendChild(card);
    });
    section.appendChild(gallery);

    toolbar.querySelector('#gallerySearch').addEventListener('input', (e) => filterGallery(e.target.value));
}

function copyLuid(btn) {
    const luid = btn.dataset.luid || '';
    const done = () => {
        btn.classList.add('copied');
        const icon = btn.querySelector('i');
        const prev = icon.className;
        icon.className = 'fa-solid fa-check';
        setTimeout(() => { btn.classList.remove('copied'); icon.className = prev; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(luid).then(done, done);
    } else {
        const ta = document.createElement('textarea');
        ta.value = luid; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
        done();
    }
}

function filterGallery(query) {
    const q = (query || '').toLowerCase();
    document.querySelectorAll('#dsGallery .ds-card').forEach((card) => {
        card.style.display = card.dataset.search.includes(q) ? '' : 'none';
    });
}

// Open a datasource in Web Authoring (a fresh workbook bound to the datasource).
async function openDatasource(index) {
    const ds = ((PORTAL_CONFIG && PORTAL_CONFIG.datasources) || [])[index];
    if (!ds) return;
    document.body.classList.remove('mobile-open');

    document.getElementById('pageTitle').textContent = ds.name || 'Data Source';
    document.getElementById('crumbs').textContent = `Data Sources › ${ds.name || ds.id}`;

    const section = document.getElementById('content');
    section.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'viz-card';
    card.innerHTML = `
      <div class="viz-head">
        <h3>${escapeHtml(ds.name || 'Data Source')}</h3>
        <span class="tableau-badge"><i class="fa-solid fa-pen-ruler"></i> Web Authoring</span>
      </div>
      <div id="vizExplore" class="viz-host iframe-shell"><span>Launching Web Authoring…</span></div>
    `;
    section.appendChild(card);
    // Use content_url (NOT the LUID) for the authoring URL.
    await embedAuthoring(card.querySelector('#vizExplore'), { datasource_content_url: ds.content_url });
}

// Open a blank workbook in Web Authoring (no datasource bound).
async function openNewDashboard() {
    document.body.classList.remove('mobile-open');
    document.getElementById('pageTitle').textContent = 'New Dashboard';
    document.getElementById('crumbs').textContent = 'Data Sources › New blank workbook';

    const section = document.getElementById('content');
    section.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'viz-card';
    card.innerHTML = `
      <div class="viz-head">
        <h3>New Dashboard</h3>
        <span class="tableau-badge"><i class="fa-solid fa-pen-ruler"></i> Web Authoring</span>
      </div>
      <div id="vizExplore" class="viz-host iframe-shell"><span>Launching Web Authoring…</span></div>
    `;
    section.appendChild(card);
    await embedAuthoring(card.querySelector('#vizExplore'), {}); // blank newWorkbook
}

// -----------------------------
// Init
// -----------------------------
applySidebarState();

(async function init() {
    try {
        PORTAL_CONFIG = await getPortalConfig();
        const groups = PORTAL_CONFIG.groups || [];
        if (PORTAL_CONFIG.brand && PORTAL_CONFIG.brand.title) {
            document.getElementById('brandTitle').textContent = PORTAL_CONFIG.brand.title;
            document.title = PORTAL_CONFIG.brand.title;
        }
        buildTree(groups);

        // Reflect the datasource count on the Data Sources menu badge.
        const dsCount = (PORTAL_CONFIG.datasources || []).length;
        const badge = document.getElementById('dsMenuBadge');
        if (badge) badge.textContent = dsCount ? String(dsCount) : '';

        if (!groups.length) {
            document.getElementById('configHint').style.display = 'block';
        } else {
            // Auto-expand the first group for a friendlier landing.
            const first = navTree.querySelector('.group');
            if (first) first.classList.add('expanded');
        }
    } catch (err) {
        document.getElementById('crumbs').textContent = 'Failed to load portal config: ' + err.message;
    }
})();
