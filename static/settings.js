// =============================================================================
//  Settings page logic — Tableau connection + visual portal group builder.
//
//  Model:
//    CATALOG = { workbooks:[{id,name,project,views:[{id,name,viz_url,content_url}]}],
//                datasources:[{id,content_url,name,project,type,description,has_extracts}],
//                projects:[...], synced_at }
//    GROUPS  = [{ id, name, icon,
//                 dashboards:[{id,name,viz_url,toolbar,icon,datasource_id}],
//                 datasource_ids:[luid,...] }]
//  GROUPS reference CATALOG content by LUID; the portal hydrates them server-side.
// =============================================================================

const $ = (id) => document.getElementById(id);

let CATALOG = { workbooks: [], datasources: [], projects: [], synced_at: '' };
let GROUPS = [];
let activeGroupId = null;
let catalogTab = 'views'; // 'views' | 'datasources'
let catalogSort = { key: 'name', dir: 1 };   // spreadsheet sort state
let catalogSelected = new Set();              // checked catalog row ids (per tab)

// A short unique id for new groups.
function uid(prefix) {
    const rnd = (crypto && crypto.randomUUID)
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${prefix}-${rnd}`;
}

function showBanner(message, ok = true) {
    const el = $('banner');
    el.textContent = message;
    el.className = 'settings-banner ' + (ok ? 'banner-ok' : 'banner-error');
    el.style.display = 'block';
}

function setFieldValue(id, value) {
    const el = $(id);
    if (el) el.value = value == null ? '' : value;
}

// Mirror the server-side derivation: server URL + the embedding API module path.
const EMBEDDING_API_PATH = '/javascripts/api/tableau.embedding.3.latest.min.js';

function updateEmbeddingPreview() {
    const base = ($('server_url').value || '').trim().replace(/\/+$/, '');
    $('embedding_api_preview').textContent = base ? base + EMBEDDING_API_PATH : '—';
}

// -----------------------------
// Load current settings + catalog
// -----------------------------
async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const s = await res.json();

        setFieldValue('server_url', s.tableau?.server_url);
        setFieldValue('site_content_url', s.tableau?.site_content_url);
        setFieldValue('site_name', s.tableau?.site_name);
        updateEmbeddingPreview();

        setFieldValue('client_id', s.connected_app?.client_id);
        setFieldValue('secret_id', s.connected_app?.secret_id);

        const secretSet = !!s.connected_app?.secret_value_set;
        $('secret_value').placeholder = secretSet ? '•••••••• (stored — leave blank to keep)' : 'Enter secret value';
        $('secret_hint').textContent = secretSet
            ? 'A secret is stored server-side. Leave blank to keep it, or type a new value to replace it.'
            : 'Stored server-side only. No secret is currently set.';

        setFieldValue('embedding_username', s.jwt?.embedding_username);
        setFieldValue('scopes', (s.jwt?.scopes || []).join(', '));
        setFieldValue('token_lifetime_seconds', s.jwt?.token_lifetime_seconds ?? 600);

        setFieldValue('brand_title', s.portal?.brand?.title);

        // Normalize groups into the editable model.
        GROUPS = (s.portal?.groups ?? []).map(normalizeGroup);
        if (GROUPS.length) activeGroupId = GROUPS[0].id;
    } catch (err) {
        showBanner('Could not load settings: ' + err.message, false);
    }

    // Catalog is a separate endpoint (the superset the builder draws from).
    try {
        const cres = await fetch('/api/catalog');
        if (cres.ok) CATALOG = await cres.json();
    } catch (_) { /* non-fatal — builder still works, just empty catalog */ }

    renderSyncMeta();
    renderProjectFilter();
    renderGroups();
    renderCatalog();
    syncGroupsJson();

    const active = findGroup(activeGroupId);
    if (active) $('catalogTargetHint').textContent = `Adds to “${active.name}”.`;
}

function normalizeGroup(g) {
    return {
        id: g.id || uid('grp'),
        name: g.name || 'Untitled group',
        icon: g.icon || 'fa-layer-group',
        dashboards: (g.dashboards || []).map((d) => ({
            id: d.id,
            name: d.name || d.id,
            viz_url: d.viz_url || '',
            toolbar: d.toolbar || 'hidden',
            icon: d.icon || 'fa-chart-column',
            datasource_id: d.datasource_id || '',
        })),
        datasource_ids: (g.datasource_ids || []).slice(),
    };
}

// -----------------------------
// Sync catalog from Tableau
// -----------------------------
async function syncFromTableau() {
    const result = $('syncResult');
    const btn = $('syncBtn');
    result.textContent = 'Syncing…';
    result.className = 'settings-test-result';
    btn.disabled = true;
    try {
        const res = await fetch('/api/catalog/sync', { method: 'POST' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
        CATALOG = body.catalog || CATALOG;
        result.textContent =
            `✓ Synced ${body.workbook_count} workbooks, ${body.view_count} views, ` +
            `${body.datasource_count} data sources across ${body.project_count} projects`;
        result.classList.add('test-ok');
        renderSyncMeta();
        renderProjectFilter();
        renderCatalog();
    } catch (err) {
        result.textContent = '✗ ' + err.message;
        result.classList.add('test-error');
    } finally {
        btn.disabled = false;
    }
}

function renderSyncMeta() {
    const meta = $('syncMeta');
    if (!meta) return;
    if (CATALOG.synced_at) {
        const when = String(CATALOG.synced_at).replace('T', ' ').replace(/(\+00:00|Z)$/, ' UTC');
        meta.textContent = `Last synced: ${when}`;
    } else {
        meta.textContent = 'Not synced yet';
    }
}

// -----------------------------
// Project filter dropdown
// -----------------------------
function renderProjectFilter() {
    const sel = $('catalogProject');
    const prev = sel.value;
    const projects = CATALOG.projects || [];
    sel.innerHTML = '<option value="">All projects</option>' +
        projects.map((p) => `<option value="${escAttr(p)}">${escHtml(p)}</option>`).join('');
    if (projects.includes(prev)) sel.value = prev;
}

// -----------------------------
// Groups column
// -----------------------------
function renderGroups() {
    const list = $('groupsList');
    $('groupsCount').textContent = String(GROUPS.length);
    list.innerHTML = '';

    if (!GROUPS.length) {
        list.innerHTML = `<div class="builder-empty">No groups yet. Name one above and click <strong>Add</strong>.</div>`;
        return;
    }

    GROUPS.forEach((g) => {
        const card = document.createElement('div');
        card.className = 'group-card' + (g.id === activeGroupId ? ' active' : '');
        card.dataset.gid = g.id;

        const dsOptions = datasourceOptionsHtml();

        const dashRows = g.dashboards.map((d) => `
            <div class="assigned-item" data-did="${escAttr(d.id)}">
              <span class="ai-icon"><i class="fa-solid ${escAttr(d.icon || 'fa-chart-column')}"></i></span>
              <span class="ai-name" title="${escAttr(d.name)}">${escHtml(d.name)}</span>
              <select class="ai-ds" data-role="link-ds" title="Link a data source (enables Explore Data)">
                <option value="">— no linked data —</option>
                ${dsOptions}
              </select>
              <button type="button" class="ai-del" data-role="del-dash" title="Remove">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>`).join('');

        const dsRows = g.datasource_ids.map((id) => {
            const ds = findDs(id);
            const name = ds ? ds.name : id;
            return `
            <div class="assigned-item" data-dsid="${escAttr(id)}">
              <span class="ai-icon"><i class="fa-solid fa-database"></i></span>
              <span class="ai-name" title="${escAttr(name)}">${escHtml(name)}</span>
              <button type="button" class="ai-del" data-role="del-ds" title="Remove">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>`;
        }).join('');

        card.innerHTML = `
          <div class="group-card-head" data-role="select-group">
            <input class="g-icon-pick" data-role="group-icon" value="${escAttr(g.icon)}" title="Font Awesome icon class, e.g. fa-chart-line">
            <input class="g-name" data-role="group-name" value="${escAttr(g.name)}">
            ${g.id === activeGroupId ? '<span class="g-active-badge">Active</span>' : ''}
            <button type="button" class="g-del" data-role="del-group" title="Delete group">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
          <div class="group-card-body">
            <div class="group-sub">Dashboards (${g.dashboards.length})</div>
            ${dashRows || '<div class="builder-empty" style="padding:10px;">No dashboards — add views from the catalog →</div>'}
            <div class="group-sub">Data Sources (${g.datasource_ids.length})</div>
            ${dsRows || '<div class="builder-empty" style="padding:10px;">No data sources — add from the catalog →</div>'}
          </div>
        `;
        list.appendChild(card);

        // Pre-select linked datasource in each dashboard's dropdown.
        card.querySelectorAll('.assigned-item[data-did]').forEach((row) => {
            const did = row.dataset.did;
            const dash = g.dashboards.find((x) => x.id === did);
            const sel = row.querySelector('[data-role="link-ds"]');
            if (dash && sel) sel.value = dash.datasource_id || '';
        });
    });
}

function datasourceOptionsHtml() {
    return (CATALOG.datasources || [])
        .map((ds) => `<option value="${escAttr(ds.id)}">${escHtml(ds.name || ds.id)}</option>`)
        .join('');
}

// Delegated events on the groups list.
$('groupsList').addEventListener('click', (e) => {
    const card = e.target.closest('.group-card');
    if (!card) return;
    const g = findGroup(card.dataset.gid);
    if (!g) return;

    if (e.target.closest('[data-role="del-group"]')) {
        e.stopPropagation();
        GROUPS = GROUPS.filter((x) => x.id !== g.id);
        if (activeGroupId === g.id) activeGroupId = GROUPS[0]?.id || null;
        renderGroups(); renderCatalog(); syncGroupsJson();
        return;
    }
    if (e.target.closest('[data-role="del-dash"]')) {
        const did = e.target.closest('.assigned-item').dataset.did;
        g.dashboards = g.dashboards.filter((d) => d.id !== did);
        renderGroups(); renderCatalog(); syncGroupsJson();
        return;
    }
    if (e.target.closest('[data-role="del-ds"]')) {
        const dsid = e.target.closest('.assigned-item').dataset.dsid;
        g.datasource_ids = g.datasource_ids.filter((x) => x !== dsid);
        renderGroups(); renderCatalog(); syncGroupsJson();
        return;
    }
    // Selecting the group as the active add-target.
    if (e.target.closest('[data-role="select-group"]') &&
        !e.target.closest('input') && !e.target.closest('select')) {
        activeGroupId = g.id;
        renderGroups(); renderCatalog();
        const hint = $('catalogTargetHint');
        hint.textContent = `Adds to “${g.name}”.`;
        hint.style.color = '';
    }
});

// Input/change (rename, icon, link datasource).
$('groupsList').addEventListener('change', (e) => handleGroupFieldChange(e));
$('groupsList').addEventListener('input', (e) => {
    if (e.target.matches('[data-role="group-name"], [data-role="group-icon"]')) {
        handleGroupFieldChange(e, /*live*/true);
    }
});

function handleGroupFieldChange(e, live) {
    const card = e.target.closest('.group-card');
    if (!card) return;
    const g = findGroup(card.dataset.gid);
    if (!g) return;

    if (e.target.matches('[data-role="group-name"]')) {
        g.name = e.target.value;
        if (!live) { renderGroups(); }
        syncGroupsJson();
    } else if (e.target.matches('[data-role="group-icon"]')) {
        g.icon = e.target.value.trim() || 'fa-layer-group';
        syncGroupsJson();
    } else if (e.target.matches('[data-role="link-ds"]')) {
        const did = e.target.closest('.assigned-item').dataset.did;
        const dash = g.dashboards.find((d) => d.id === did);
        if (dash) dash.datasource_id = e.target.value;
        syncGroupsJson();
    }
}

$('addGroupBtn').addEventListener('click', () => {
    const nameInput = $('newGroupName');
    const name = nameInput.value.trim() || `Group ${GROUPS.length + 1}`;
    const g = { id: uid('grp'), name, icon: 'fa-layer-group', dashboards: [], datasource_ids: [] };
    GROUPS.push(g);
    activeGroupId = g.id;
    nameInput.value = '';
    renderGroups(); renderCatalog(); syncGroupsJson();
    const hint = $('catalogTargetHint');
    hint.textContent = `Adds to “${name}”.`;
    hint.style.color = '';
});
$('newGroupName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('addGroupBtn').click(); }
});

// -----------------------------
// Catalog column — spreadsheet-style table
// -----------------------------
document.querySelectorAll('.catalog-tab').forEach((t) => {
    t.addEventListener('click', () => {
        if (catalogTab === t.dataset.cat) return;
        catalogTab = t.dataset.cat;
        catalogSelected.clear();               // selection is per-tab
        catalogSort = { key: 'name', dir: 1 }; // reset sort on tab switch
        document.querySelectorAll('.catalog-tab').forEach((x) =>
            x.classList.toggle('active', x === t));
        renderCatalog();
    });
});
$('catalogSearch').addEventListener('input', renderCatalog);
$('catalogProject').addEventListener('change', renderCatalog);
$('catalogAddSelected').addEventListener('click', addSelectedToGroup);

// Column definitions per tab: {key, label, sortable, class}
const CATALOG_COLUMNS = {
    views: [
        { key: 'name', label: 'View', sortable: true },
        { key: 'workbook', label: 'Workbook', sortable: true },
        { key: 'project', label: 'Project', sortable: true },
    ],
    datasources: [
        { key: 'name', label: 'Data Source', sortable: true },
        { key: 'type', label: 'Type', sortable: true },
        { key: 'project', label: 'Project', sortable: true },
    ],
};

// Flatten the catalog into filtered, sorted rows for the active tab.
function catalogRows() {
    const q = ($('catalogSearch').value || '').toLowerCase();
    const proj = $('catalogProject').value;
    let rows;

    if (catalogTab === 'views') {
        rows = [];
        (CATALOG.workbooks || []).forEach((wb) => {
            if (proj && (wb.project || '') !== proj) return;
            (wb.views || []).forEach((v) => {
                rows.push({
                    id: v.id,
                    kind: 'view',
                    name: v.name || v.id,
                    workbook: wb.name || '',
                    project: wb.project || '',
                    viz_url: v.viz_url || '',
                    wb_id: wb.id,
                });
            });
        });
    } else {
        rows = (CATALOG.datasources || []).filter((ds) => !proj || (ds.project || '') === proj)
            .map((ds) => ({
                id: ds.id,
                kind: 'ds',
                name: ds.name || ds.id,
                type: ds.type || '',
                project: ds.project || 'No project',
                has_extracts: !!ds.has_extracts,
                description: ds.description || '',
            }));
    }

    if (q) {
        rows = rows.filter((r) => {
            const hay = catalogTab === 'views'
                ? `${r.name} ${r.workbook} ${r.project}`
                : `${r.name} ${r.type} ${r.project} ${r.description}`;
            return hay.toLowerCase().includes(q);
        });
    }

    const { key, dir } = catalogSort;
    rows.sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''),
        undefined, { sensitivity: 'base' }) * dir);
    return rows;
}

function assignedIdSet() {
    const g = findGroup(activeGroupId);
    if (!g) return new Set();
    return catalogTab === 'views'
        ? new Set(g.dashboards.map((d) => d.id))
        : new Set(g.datasource_ids);
}

function renderCatalog() {
    const table = $('catalogTable');
    const rows = catalogRows();
    const columns = CATALOG_COLUMNS[catalogTab];
    const assigned = assignedIdSet();
    $('catalogCount').textContent = String(rows.length);

    // Drop selections that are no longer visible (filter/tab changed).
    const visibleIds = new Set(rows.map((r) => r.id));
    catalogSelected.forEach((id) => { if (!visibleIds.has(id)) catalogSelected.delete(id); });

    if (!rows.length) {
        const empty = (!(CATALOG.workbooks || []).length && !(CATALOG.datasources || []).length)
            ? 'Catalog is empty. Click <strong>Sync from Tableau</strong> above.'
            : `No ${catalogTab === 'views' ? 'views' : 'data sources'} match your filter.`;
        table.innerHTML = `<tbody><tr><td class="builder-empty" style="padding:22px;">${empty}</td></tr></tbody>`;
        updateBulkBar();
        return;
    }

    // Header — a "select all visible & unassigned" checkbox + sortable columns.
    const selectableCount = rows.filter((r) => !assigned.has(r.id)).length;
    const allSelected = selectableCount > 0 &&
        rows.every((r) => assigned.has(r.id) || catalogSelected.has(r.id));
    const caret = (k) => catalogSort.key === k
        ? `<span class="sort-caret">${catalogSort.dir > 0 ? '▲' : '▼'}</span>` : '';
    const head = `
        <thead><tr>
          <th class="col-check">
            <input type="checkbox" id="catalogSelectAll" ${allSelected ? 'checked' : ''}
                   ${selectableCount ? '' : 'disabled'} title="Select all shown">
          </th>
          ${columns.map((c) => `
            <th class="${c.sortable ? 'sortable' : ''}" data-sort="${c.key}">
              ${escHtml(c.label)}${c.sortable ? caret(c.key) : ''}
            </th>`).join('')}
          <th class="col-add"></th>
        </tr></thead>`;

    const body = rows.map((r) => {
        const already = assigned.has(r.id);
        const checked = catalogSelected.has(r.id);
        const cells = catalogTab === 'views'
            ? `<td><div class="ct-name"><span class="ci-icon"><i class="fa-solid fa-chart-column"></i></span>
                 <span class="ct-label" title="${escAttr(r.name)}">${escHtml(r.name)}</span></div></td>
               <td title="${escAttr(r.workbook)}">${escHtml(r.workbook) || '<span class="ct-muted">—</span>'}</td>
               <td title="${escAttr(r.project)}">${escHtml(r.project) || '<span class="ct-muted">—</span>'}</td>`
            : `<td><div class="ct-name"><span class="ci-icon"><i class="fa-solid fa-database"></i></span>
                 <span class="ct-label" title="${escAttr(r.name)}">${escHtml(r.name)}</span>
                 ${r.has_extracts ? '<span class="ct-type-pill extract">⚡ extract</span>' : ''}</div></td>
               <td>${r.type ? `<span class="ct-type-pill">${escHtml(r.type)}</span>` : '<span class="ct-muted">—</span>'}</td>
               <td title="${escAttr(r.project)}">${escHtml(r.project)}</td>`;
        return `
          <tr class="${already ? 'is-assigned' : ''}" data-id="${escAttr(r.id)}">
            <td class="col-check">
              <input type="checkbox" class="row-check" ${checked ? 'checked' : ''}
                     ${already ? 'disabled' : ''} title="${already ? 'Already in the active group' : 'Select'}">
            </td>
            ${cells}
            <td class="col-add">
              <button type="button" class="ci-add" data-role="add-row"
                      ${already ? 'disabled title="Already in the active group"' : 'title="Add to active group"'}>
                <i class="fa-solid ${already ? 'fa-check' : 'fa-plus'}"></i>
              </button>
            </td>
          </tr>`;
    }).join('');

    table.innerHTML = head + `<tbody>${body}</tbody>`;
    updateBulkBar();
}

function updateBulkBar() {
    const n = catalogSelected.size;
    $('catalogSelCount').textContent = String(n);
    const btn = $('catalogAddSelected');
    btn.disabled = n === 0 || !findGroup(activeGroupId);
}

// Sorting (header clicks).
$('catalogTable').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.sort;
    if (catalogSort.key === key) catalogSort.dir *= -1;
    else catalogSort = { key, dir: 1 };
    renderCatalog();
});

// Checkbox + per-row add (delegated).
$('catalogTable').addEventListener('change', (e) => {
    if (e.target.id === 'catalogSelectAll') {
        const assigned = assignedIdSet();
        const rows = catalogRows();
        if (e.target.checked) rows.forEach((r) => { if (!assigned.has(r.id)) catalogSelected.add(r.id); });
        else rows.forEach((r) => catalogSelected.delete(r.id));
        renderCatalog();
        return;
    }
    if (e.target.classList.contains('row-check')) {
        const id = e.target.closest('tr').dataset.id;
        if (e.target.checked) catalogSelected.add(id);
        else catalogSelected.delete(id);
        updateBulkBar();
    }
});

$('catalogTable').addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-role="add-row"]');
    if (!addBtn) return;
    const id = addBtn.closest('tr').dataset.id;
    if (!requireActiveGroup()) return;
    addCatalogItem(id);
    renderGroups();
    renderCatalog();
    syncGroupsJson();
});

function requireActiveGroup() {
    if (findGroup(activeGroupId)) return true;
    const hint = $('catalogTargetHint');
    hint.textContent = 'Pick or create a group first.';
    hint.style.color = '#d83933';
    return false;
}

// Add one catalog row (by id) to the active group, respecting the active tab.
function addCatalogItem(id) {
    const g = findGroup(activeGroupId);
    if (!g) return;
    if (catalogTab === 'views') {
        if (g.dashboards.some((d) => d.id === id)) return;
        let found = null;
        (CATALOG.workbooks || []).some((wb) =>
            (wb.views || []).some((v) => { if (v.id === id) { found = v; return true; } return false; }));
        if (!found) return;
        g.dashboards.push({
            id: found.id,
            name: found.name || found.id,
            viz_url: found.viz_url || '',
            toolbar: 'hidden',
            icon: 'fa-chart-column',
            datasource_id: '',
        });
    } else {
        if (!g.datasource_ids.includes(id)) g.datasource_ids.push(id);
    }
}

function addSelectedToGroup() {
    if (!requireActiveGroup() || !catalogSelected.size) return;
    catalogSelected.forEach((id) => addCatalogItem(id));
    catalogSelected.clear();
    renderGroups();
    renderCatalog();
    syncGroupsJson();
}

// -----------------------------
// Advanced raw-JSON mirror
// -----------------------------
function syncGroupsJson() {
    // Serialize the builder's model back to the canonical stored shape.
    const serialized = GROUPS.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        dashboards: g.dashboards.map((d) => ({
            id: d.id, name: d.name, viz_url: d.viz_url,
            toolbar: d.toolbar, icon: d.icon, datasource_id: d.datasource_id || '',
        })),
        datasource_ids: g.datasource_ids.slice(),
    }));
    $('groups_json').value = JSON.stringify(serialized, null, 2);
    $('groups_error').style.display = 'none';
}

// If the user edits the raw JSON, adopt it back into the model on blur.
$('groups_json').addEventListener('blur', () => {
    const raw = $('groups_json').value.trim();
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Groups must be a JSON array');
        GROUPS = parsed.map(normalizeGroup);
        if (!GROUPS.some((g) => g.id === activeGroupId)) activeGroupId = GROUPS[0]?.id || null;
        $('groups_error').style.display = 'none';
        renderGroups(); renderCatalog();
    } catch (err) {
        const el = $('groups_error');
        el.textContent = 'Invalid groups JSON: ' + err.message;
        el.style.display = 'block';
    }
});

// -----------------------------
// Save settings
// -----------------------------
async function saveSettings(event) {
    event.preventDefault();
    $('groups_error').style.display = 'none';

    // Prefer the builder model; validate the JSON mirror is coherent.
    let groups;
    try {
        const raw = $('groups_json').value.trim() || '[]';
        groups = JSON.parse(raw);
        if (!Array.isArray(groups)) throw new Error('Groups must be a JSON array');
    } catch (err) {
        const el = $('groups_error');
        el.textContent = 'Invalid groups JSON: ' + err.message;
        el.style.display = 'block';
        return;
    }

    const scopes = $('scopes').value.split(',').map((s) => s.trim()).filter(Boolean);

    const payload = {
        tableau: {
            server_url: $('server_url').value.trim(),
            site_content_url: $('site_content_url').value.trim(),
            site_name: $('site_name').value.trim(),
        },
        connected_app: {
            client_id: $('client_id').value.trim(),
            secret_id: $('secret_id').value.trim(),
            secret_value: $('secret_value').value,
        },
        jwt: {
            embedding_username: $('embedding_username').value.trim(),
            scopes: scopes.length ? scopes : ['tableau:views:embed', 'tableau:views:embed_authoring'],
            token_lifetime_seconds: Number($('token_lifetime_seconds').value) || 600,
        },
        portal: {
            groups,
            brand: { title: $('brand_title').value.trim() || 'Embedded Analytics Portal' },
        },
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try { const b = await res.json(); if (b.detail) detail = b.detail; } catch (_) {}
            throw new Error(detail);
        }
        showBanner('Settings saved.', true);
        $('secret_value').value = '';
        await loadSettings();
    } catch (err) {
        showBanner('Save failed: ' + err.message, false);
    }
}

// -----------------------------
// Test embed token minting
// -----------------------------
async function testToken() {
    const result = $('testResult');
    result.textContent = 'Minting…';
    result.className = 'settings-test-result';
    try {
        const res = await fetch('/api/embed-token');
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
        const secs = body.exp ? Math.max(0, body.exp - Math.floor(Date.now() / 1000)) : '?';
        result.textContent = `✓ Token minted (expires in ~${secs}s)`;
        result.classList.add('test-ok');
    } catch (err) {
        result.textContent = '✗ ' + err.message;
        result.classList.add('test-error');
    }
}

// -----------------------------
// Small escaping helpers
// -----------------------------
function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}
function escAttr(str) {
    return escHtml(str).replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    $('settingsForm').addEventListener('submit', saveSettings);
    $('testBtn').addEventListener('click', testToken);
    $('syncBtn').addEventListener('click', syncFromTableau);
    $('server_url').addEventListener('input', updateEmbeddingPreview);
});

// -----------------------------
// Lookups
// -----------------------------
function findGroup(id) { return GROUPS.find((g) => g.id === id) || null; }
function findDs(id) { return (CATALOG.datasources || []).find((d) => d.id === id) || null; }
