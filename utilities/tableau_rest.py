"""
Populate portal content from the Tableau Cloud/Server REST API.

Authenticates with a Connected App (direct-trust) JWT — the SAME connected-app
secret already used for embedding — but minted with a REST scope
(tableau:content:read) instead of the embedding scope. The connected app must
have REST scopes enabled in Tableau for sign-in to succeed.

The public entry point is fetch_catalog(), which returns the full raw inventory
the settings group-builder draws from:

    {
      "workbooks": [
        { "id": <luid>, "name": <name>, "project": <project name>, "views": [
          { "id": <luid>, "name": <name>, "viz_url": <embed url>, "content_url": <str> },
          ...
        ]},
        ...
      ],
      "datasources": [
        { "id": <luid>, "content_url": <str>, "name", "project", "type",
          "description", "has_extracts" },
        ...
      ],
      "projects": [<distinct project name>, ...],
    }

The portal itself renders a *curated projection* of this catalog (see
settings_store.build_portal_projection), not the catalog directly.
"""

import logging
import threading
import time

import httpx

from utilities.embed_token import mint_embed_token

logger = logging.getLogger(__name__)

# REST scopes needed to read workbooks/views/datasources. Distinct from embedding.
REST_SCOPES = ["tableau:content:read"]

# Fallback REST API version if serverinfo discovery fails.
_DEFAULT_API_VERSION = "3.24"

_HTTP_TIMEOUT = 30.0


def _base(server_url: str) -> str:
    return (server_url or "").strip().rstrip("/")


def _discover_api_version(client: httpx.Client, base: str) -> str:
    """Return the site's REST API version, falling back to a recent default."""
    try:
        resp = client.get(f"{base}/api/serverinfo", headers={"Accept": "application/json"})
        resp.raise_for_status()
        version = resp.json()["serverInfo"]["restApiVersion"]
        return version or _DEFAULT_API_VERSION
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("Could not discover REST API version (%s); using %s", exc, _DEFAULT_API_VERSION)
        return _DEFAULT_API_VERSION


def _sign_in(client: httpx.Client, base: str, version: str, jwt_token: str, site_content_url: str) -> tuple[str, str]:
    """Sign in via connected-app JWT. Returns (auth_token, site_id)."""
    body = {
        "credentials": {
            "jwt": jwt_token,
            "site": {"contentUrl": site_content_url or ""},
        }
    }
    resp = client.post(
        f"{base}/api/{version}/auth/signin",
        json=body,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Tableau REST sign-in failed (HTTP {resp.status_code}): {resp.text[:300]}")
    creds = resp.json()["credentials"]
    return creds["token"], creds["site"]["id"]


def _sign_out(client: httpx.Client, base: str, version: str, auth_token: str) -> None:
    try:
        client.post(
            f"{base}/api/{version}/auth/signout",
            headers={"X-Tableau-Auth": auth_token},
        )
    except httpx.HTTPError as exc:
        logger.warning("REST sign-out failed (%s); ignoring", exc)


def _paged_get(client: httpx.Client, url: str, auth_token: str, key: str) -> list[dict]:
    """GET a paginated REST collection, returning the flattened list under `key`."""
    items: list[dict] = []
    page_number = 1
    page_size = 100
    while True:
        resp = client.get(
            url,
            params={"pageSize": page_size, "pageNumber": page_number},
            headers={"Accept": "application/json", "X-Tableau-Auth": auth_token},
        )
        resp.raise_for_status()
        data = resp.json()
        container = data.get(f"{key}s", {}) or {}
        batch = container.get(key, [])
        if isinstance(batch, dict):  # single-item responses come back as an object
            batch = [batch]
        items.extend(batch)

        total = int(data.get("pagination", {}).get("totalAvailable", len(items)))
        if len(items) >= total or not batch:
            break
        page_number += 1
    return items


def _view_embed_url(base: str, site_content_url: str, view: dict) -> str:
    """Build a browser/embeddable view URL from the REST view contentUrl.

    REST returns contentUrl like "WorkbookName/sheets/ViewName"; the embeddable
    URL drops the "/sheets/" segment: /t/<site>/views/WorkbookName/ViewName.
    """
    content_url = (view.get("contentUrl") or "").replace("/sheets/", "/")
    site_segment = f"/t/{site_content_url}" if site_content_url else ""
    return f"{base}{site_segment}/views/{content_url}"


def _fetch_workbooks(client: httpx.Client, base: str, version: str, auth_token: str,
                     site_id: str, site_content_url: str) -> list[dict]:
    """Workbooks (with their project + views) → catalog workbook entries."""
    workbooks = _paged_get(
        client, f"{base}/api/{version}/sites/{site_id}/workbooks", auth_token, "workbook"
    )
    out: list[dict] = []
    for wb in workbooks:
        wb_id = wb.get("id")
        if not wb_id:
            continue
        views = _paged_get(
            client,
            f"{base}/api/{version}/sites/{site_id}/workbooks/{wb_id}/views",
            auth_token,
            "view",
        )
        view_entries = [
            {
                "id": v.get("id"),
                "name": v.get("name") or v.get("id"),
                "viz_url": _view_embed_url(base, site_content_url, v),
                "content_url": v.get("contentUrl") or "",
            }
            for v in views
            if v.get("id")
        ]
        project = wb.get("project") or {}
        out.append({
            "id": wb_id,
            "name": wb.get("name") or wb_id,
            "project": project.get("name") or "",
            "views": view_entries,
        })
    logger.info("Fetched %d workbooks from Tableau REST", len(out))
    return out


def _fetch_datasources(client: httpx.Client, base: str, version: str, auth_token: str,
                       site_id: str) -> list[dict]:
    """Published datasources → gallery entries the portal can author against.

    The `authoringNewWorkbook/<guid>/<name>` URL expects the datasource's
    contentUrl name (NOT the LUID and NOT the display name), per
    https://help.tableau.com/current/api/embedding_api/en-us/docs/embedding_api_new_workbook.html
    So `content_url` is what the portal must pass to Web Authoring; `id` (LUID)
    is kept only as a stable key.
    """
    datasources = _paged_get(
        client, f"{base}/api/{version}/sites/{site_id}/datasources", auth_token, "datasource"
    )
    out: list[dict] = []
    for ds in datasources:
        ds_id = ds.get("id")
        if not ds_id:
            continue
        project = ds.get("project") or {}
        out.append(
            {
                "id": ds_id,  # LUID — stable key, not used for authoring
                "content_url": ds.get("contentUrl") or "",  # used in authoringNewWorkbook URL
                "name": ds.get("name") or ds_id,
                "project": project.get("name") or "",
                "type": ds.get("type") or "",
                "description": ds.get("description") or "",
                "has_extracts": bool(ds.get("hasExtracts")),
            }
        )
    logger.info("Fetched %d datasources from Tableau REST", len(out))
    return out


def fetch_catalog(signing: dict) -> dict:
    """Fetch the full raw inventory (workbooks+views, datasources) in one session.

    Returns {"workbooks": [...], "datasources": [...], "projects": [...]}.

    Args:
        signing: dict from settings_store.get_signing_material() (client_id,
            secret_id, secret_value, embedding_username, server_url,
            site_content_url, ...). Scopes are overridden with REST_SCOPES.
    """
    base = _base(signing["server_url"])
    if not base:
        raise RuntimeError("Tableau server URL is not configured")
    site_content_url = signing.get("site_content_url", "") or ""

    # Mint a REST-scoped JWT from the same connected-app secret.
    rest_signing = {**signing, "scopes": REST_SCOPES}
    jwt_token, _ = mint_embed_token(rest_signing)

    with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
        version = _discover_api_version(client, base)
        auth_token, site_id = _sign_in(client, base, version, jwt_token, site_content_url)
        try:
            workbooks = _fetch_workbooks(client, base, version, auth_token, site_id, site_content_url)
            datasources = _fetch_datasources(client, base, version, auth_token, site_id)
        finally:
            _sign_out(client, base, version, auth_token)

    projects = sorted({
        p for p in (
            [w.get("project") or "" for w in workbooks]
            + [d.get("project") or "" for d in datasources]
        ) if p
    })
    return {"workbooks": workbooks, "datasources": datasources, "projects": projects}


# Backwards-compatible alias: older callers imported fetch_portal_content.
def fetch_portal_content(signing: dict) -> dict:
    """Deprecated. Returns the raw catalog; use fetch_catalog()."""
    return fetch_catalog(signing)


# ── View thumbnail proxy ────────────────────────────────────────────────────
# A REST sign-in per thumbnail would be far too slow (the welcome gallery loads
# many at once), so we cache the signed-in session and the rendered PNGs.
_session_lock = threading.Lock()
_session: dict = {}                 # {base, version, token, site_id, expires}
_SESSION_TTL = 60 * 30              # re-sign in at most every ~30 min

_preview_lock = threading.Lock()
_preview_cache: dict = {}           # view_id -> (fetched_at, png_bytes)
_PREVIEW_TTL = 60 * 30


def _get_rest_session(signing: dict) -> tuple[str, str, str, str]:
    """Return a cached (base, version, auth_token, site_id), signing in if stale."""
    with _session_lock:
        if _session and _session.get("expires", 0) > time.time():
            return _session["base"], _session["version"], _session["token"], _session["site_id"]

        base = _base(signing["server_url"])
        if not base:
            raise RuntimeError("Tableau server URL is not configured")
        site_content_url = signing.get("site_content_url", "") or ""
        rest_signing = {**signing, "scopes": REST_SCOPES}
        jwt_token, _ = mint_embed_token(rest_signing)
        with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
            version = _discover_api_version(client, base)
            token, site_id = _sign_in(client, base, version, jwt_token, site_content_url)
        _session.update(base=base, version=version, token=token, site_id=site_id,
                        expires=time.time() + _SESSION_TTL)
        return base, version, token, site_id


def fetch_view_preview(signing: dict, view_id: str, workbook_id: str) -> bytes:
    """Return the PNG thumbnail (previewImage) for a view, using a cached session.

    Retries once on 401 (expired session). Results are cached in-process so the
    gallery re-renders instantly.
    """
    with _preview_lock:
        hit = _preview_cache.get(view_id)
        if hit and time.time() - hit[0] < _PREVIEW_TTL:
            return hit[1]

    def _do_fetch() -> httpx.Response:
        base, version, token, site_id = _get_rest_session(signing)
        url = (f"{base}/api/{version}/sites/{site_id}/workbooks/{workbook_id}"
               f"/views/{view_id}/previewImage")
        with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
            return client.get(url, headers={"X-Tableau-Auth": token, "Accept": "image/png"})

    resp = _do_fetch()
    if resp.status_code == 401:
        with _session_lock:
            _session.clear()   # force re-sign-in
        resp = _do_fetch()
    resp.raise_for_status()
    png = resp.content
    with _preview_lock:
        _preview_cache[view_id] = (time.time(), png)
    return png
