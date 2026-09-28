"""
Settings storage for Tableau embedding configuration.

Persists connection details, connected-app credentials, JWT parameters, and the
public portal content to a gitignored JSON file (config/settings.json). This is
intentionally separate from .env / LLM config.

Secret handling: the connected-app secret value is NEVER returned to the browser.
GET endpoints use get_public_settings() which masks the secret behind a boolean
"secret_value_set" flag. The raw secret is only read server-side by
get_signing_material() when minting JWTs.
"""

import copy
import json
import logging
import os
import threading
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# CWD is the repo root when run via `uvicorn web_app:app`, matching the existing
# relative `static/...` reads in web_app.py.
SETTINGS_PATH = Path("config/settings.json")

# Tableau caps connected-app embedding JWT lifetime at 10 minutes.
MAX_TOKEN_LIFETIME_SECONDS = 600

DEFAULTS: dict[str, Any] = {
    "tableau": {
        "server_url": "",
        "site_content_url": "",
        "site_name": "",
    },
    "connected_app": {
        "client_id": "",
        "secret_id": "",
        "secret_value": "",
    },
    "jwt": {
        "embedding_username": "",
        # <tableau-viz> needs tableau:views:embed; <tableau-authoring-viz>
        # (Explore Data / New Workbook) additionally needs
        # tableau:views:embed_authoring. One token serves both, so include both.
        # See https://help.tableau.com/current/api/embedding_api/en-us/docs/embedding_api_auth.html
        "scopes": ["tableau:views:embed", "tableau:views:embed_authoring"],
        "token_lifetime_seconds": MAX_TOKEN_LIFETIME_SECONDS,
    },
    # The full raw inventory pulled from the Tableau REST API on "Sync". This is
    # the *superset* the settings group-builder draws from; the portal never
    # renders it directly. Curated `portal.groups` reference into it by LUID.
    "catalog": {
        "workbooks": [],     # [{id, name, project, views:[{id,name,viz_url,content_url}]}]
        "datasources": [],   # [{id, content_url, name, project, type, description, has_extracts}]
        "projects": [],      # sorted list of distinct project names (for grouping UI)
        "synced_at": "",     # ISO8601 of the last successful sync
    },
    # The curated projection the portal shows. Groups are user-defined and can
    # span multiple Tableau projects; each references catalog content by LUID.
    "portal": {
        "groups": [
            # {
            #   "id": "grp-...", "name": "...", "icon": "fa-...",
            #   "dashboards": [
            #     {"id": <view luid>, "name", "viz_url", "toolbar",
            #      "icon", "datasource_id": <catalog ds luid | "">}
            #   ],
            #   "datasource_ids": [<catalog ds luid>, ...]
            # }
        ],
        # Branding / labels so the shell stays generic (not NIH-specific).
        "brand": {"title": "Embedded Analytics Portal"},
    },
}

_lock = threading.Lock()


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into a copy of base (override wins)."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def load_settings() -> dict:
    """Return current settings merged over defaults. Never raises on bad files."""
    with _lock:
        return _load_unlocked()


def _load_unlocked() -> dict:
    if not SETTINGS_PATH.exists():
        return copy.deepcopy(DEFAULTS)
    try:
        raw = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            logger.warning("settings.json is not an object; using defaults")
            return copy.deepcopy(DEFAULTS)
        return _deep_merge(DEFAULTS, _migrate(raw))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Could not read settings.json (%s); using defaults", exc)
        return copy.deepcopy(DEFAULTS)


def _migrate(raw: dict) -> dict:
    """Upgrade an older settings shape to the current one, in place-ish.

    v1 stored `portal.agencies` (workbook→views tree) and `portal.datasources`
    (flat list) directly as the shown content. v2 separates a raw `catalog`
    (superset) from curated `portal.groups`. When we see the v1 shape and no v2
    groups yet, lift agencies→groups and datasources→catalog so nothing is lost.
    """
    portal = raw.get("portal")
    if not isinstance(portal, dict):
        return raw
    has_v2 = isinstance(portal.get("groups"), list)
    legacy_agencies = portal.get("agencies")
    legacy_datasources = portal.get("datasources")
    if has_v2 or (legacy_agencies is None and legacy_datasources is None):
        return raw  # already v2, or nothing legacy to lift

    catalog = raw.setdefault("catalog", {})
    # Datasources move verbatim into the catalog (same field names).
    if isinstance(legacy_datasources, list) and not catalog.get("datasources"):
        catalog["datasources"] = legacy_datasources

    groups: list[dict] = []
    if isinstance(legacy_agencies, list):
        wb_catalog = catalog.setdefault("workbooks", [])
        for i, agency in enumerate(legacy_agencies):
            if not isinstance(agency, dict):
                continue
            dashboards = agency.get("dashboards") or []
            gid = agency.get("id") or f"grp-{i}"
            groups.append({
                "id": f"grp-{gid}",
                "name": agency.get("name") or gid,
                "icon": agency.get("icon") or "fa-layer-group",
                "dashboards": [
                    {
                        "id": d.get("id"),
                        "name": d.get("name") or d.get("id"),
                        "viz_url": d.get("viz_url") or "",
                        "toolbar": d.get("toolbar") or "hidden",
                        "icon": d.get("icon") or "fa-chart-column",
                        "datasource_id": d.get("datasource_luid") or "",
                    }
                    for d in dashboards if isinstance(d, dict) and d.get("id")
                ],
                "datasource_ids": [],
            })
            # Also seed the catalog workbook entry so the builder can show it.
            if not any(w.get("id") == agency.get("id") for w in wb_catalog):
                wb_catalog.append({
                    "id": agency.get("id"),
                    "name": agency.get("name") or gid,
                    "project": "",
                    "views": [
                        {"id": d.get("id"), "name": d.get("name") or d.get("id"),
                         "viz_url": d.get("viz_url") or "", "content_url": ""}
                        for d in dashboards if isinstance(d, dict) and d.get("id")
                    ],
                })
    portal["groups"] = groups
    portal.pop("agencies", None)
    portal.pop("datasources", None)
    logger.info("Migrated legacy settings (agencies→groups, datasources→catalog)")
    return raw


def save_settings(incoming: dict) -> dict:
    """
    Merge incoming settings into the stored file and persist.

    Preserves the existing connected-app secret value when the incoming payload
    omits it or sends a blank string, so saving other fields never wipes the
    secret.
    """
    if not isinstance(incoming, dict):
        raise ValueError("Settings payload must be an object")

    with _lock:
        current = _load_unlocked()
        merged = _deep_merge(current, incoming)

        # Preserve existing secret if the incoming one is blank/absent.
        incoming_secret = (
            incoming.get("connected_app", {}).get("secret_value")
            if isinstance(incoming.get("connected_app"), dict)
            else None
        )
        if not incoming_secret:
            merged["connected_app"]["secret_value"] = current["connected_app"]["secret_value"]

        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_PATH.write_text(
            json.dumps(merged, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info("Saved settings to %s", SETTINGS_PATH)
        return _public_view(merged)


# Path to the Embedding API v3 module on a Tableau Cloud/Server pod, appended to
# the server URL.
_EMBEDDING_API_PATH = "/javascripts/api/tableau.embedding.3.latest.min.js"


def derive_embedding_api_url(server_url: str) -> str:
    """Derive the Embedding API v3 script URL from the Tableau server URL."""
    base = (server_url or "").strip().rstrip("/")
    if not base:
        return ""
    return base + _EMBEDDING_API_PATH


def _public_view(settings: dict) -> dict:
    """Return a copy with the connected-app secret masked behind a boolean flag."""
    public = copy.deepcopy(settings)
    secret = public.get("connected_app", {}).get("secret_value", "")
    if "connected_app" in public:
        public["connected_app"].pop("secret_value", None)
        public["connected_app"]["secret_value_set"] = bool(secret)
    # Surface the derived embedding API URL so the browser doesn't have to.
    public["embedding"] = {
        "embedding_api_url": derive_embedding_api_url(
            public.get("tableau", {}).get("server_url", "")
        )
    }
    return public


def get_public_settings() -> dict:
    """Browser-safe settings: connected-app secret value masked."""
    return _public_view(load_settings())


def get_signing_material() -> dict:
    """
    Server-internal accessor returning everything needed to mint a JWT.

    Never serialize the return value to the browser.
    """
    settings = load_settings()
    ca = settings["connected_app"]
    jwt_cfg = settings["jwt"]
    tableau = settings["tableau"]
    return {
        "client_id": ca["client_id"],
        "secret_id": ca["secret_id"],
        "secret_value": ca["secret_value"],
        "embedding_username": jwt_cfg["embedding_username"],
        "scopes": jwt_cfg.get("scopes") or ["tableau:views:embed", "tableau:views:embed_authoring"],
        "token_lifetime_seconds": jwt_cfg.get(
            "token_lifetime_seconds", MAX_TOKEN_LIFETIME_SECONDS
        ),
        "server_url": tableau["server_url"],
        "site_content_url": tableau["site_content_url"],
    }


# Minimum fields required to mint a usable embedding JWT.
_REQUIRED_FIELDS = {
    "connected_app.client_id": ("connected_app", "client_id"),
    "connected_app.secret_id": ("connected_app", "secret_id"),
    "connected_app.secret_value": ("connected_app", "secret_value"),
    "jwt.embedding_username": ("jwt", "embedding_username"),
    "tableau.server_url": ("tableau", "server_url"),
}


def is_configured() -> tuple[bool, list[str]]:
    """Return (ok, missing_fields) for the minimum JWT-minting requirements."""
    settings = load_settings()
    missing: list[str] = []
    for label, (section, key) in _REQUIRED_FIELDS.items():
        if not settings.get(section, {}).get(key):
            missing.append(label)
    return (not missing, missing)


# ── Catalog + portal projection ────────────────────────────────────────────

def save_catalog(workbooks: list[dict], datasources: list[dict],
                 projects: list[dict] | None, synced_at: str) -> dict:
    """Persist the raw synced inventory. Does NOT touch curated portal groups.

    Projects are derived from workbooks + datasources when not supplied.
    Returns the stored catalog.
    """
    if projects is None:
        names = {(w.get("project") or "") for w in workbooks}
        names |= {(d.get("project") or "") for d in datasources}
        projects = sorted(n for n in names if n)
    catalog = {
        "workbooks": workbooks,
        "datasources": datasources,
        "projects": projects,
        "synced_at": synced_at,
    }
    with _lock:
        current = _load_unlocked()
        current["catalog"] = catalog
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_PATH.write_text(
            json.dumps(current, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    logger.info(
        "Saved catalog: %d workbooks, %d datasources, %d projects",
        len(workbooks), len(datasources), len(projects),
    )
    return catalog


def get_catalog() -> dict:
    """Return the raw synced inventory (browser-safe — no secrets)."""
    return load_settings().get("catalog", copy.deepcopy(DEFAULTS["catalog"]))


def add_dashboards_to_group(group_id: str | None, dashboards: list[dict],
                            group_name: str | None = None) -> tuple[str, list[dict]]:
    """Append dashboards to a portal group, de-duped by view id.

    If `group_id` matches an existing group, dashboards are appended to it.
    Otherwise a new group is created (named `group_name`, or "Published"). Used
    when a user publishes a workbook from embedded Web Authoring and we add the
    resulting sheet(s) to the portal.

    Returns (group_id, dashboards_actually_added).
    """
    with _lock:
        current = _load_unlocked()
        groups = current.setdefault("portal", {}).setdefault("groups", [])
        grp = next((g for g in groups if g.get("id") == group_id), None) if group_id else None
        if grp is None:
            grp = {
                "id": group_id or f"grp-{uuid.uuid4().hex[:8]}",
                "name": group_name or "Published",
                "icon": "fa-layer-group",
                "dashboards": [],
                "datasource_ids": [],
            }
            groups.append(grp)
        grp.setdefault("dashboards", [])
        existing = {d.get("id") for d in grp["dashboards"] if d.get("id")}
        added: list[dict] = []
        for d in dashboards:
            did = d.get("id")
            if did and did not in existing:
                grp["dashboards"].append(d)
                existing.add(did)
                added.append(d)

        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_PATH.write_text(
            json.dumps(current, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    logger.info("Added %d dashboard(s) to group %s", len(added), grp["id"])
    return grp["id"], added


def build_portal_projection() -> dict:
    """Resolve curated portal groups into the concrete structure the portal renders.

    Groups reference catalog content by LUID; here we hydrate each dashboard's
    linked datasource (into `datasource_content_url`, what Web Authoring needs)
    and each group's datasource gallery entries. Content that no longer exists
    in the catalog is dropped, so a re-sync that removes items self-heals.
    """
    settings = load_settings()
    catalog = settings.get("catalog", {})
    ds_by_id = {d.get("id"): d for d in catalog.get("datasources", []) if d.get("id")}

    groups_out: list[dict] = []
    for g in settings.get("portal", {}).get("groups", []):
        if not isinstance(g, dict):
            continue
        dashboards = []
        for d in g.get("dashboards", []):
            if not isinstance(d, dict) or not d.get("viz_url"):
                continue
            linked = ds_by_id.get(d.get("datasource_id") or "")
            viz_url = d.get("viz_url") or ""
            self_pub = bool(d.get("self_published"))
            # Self-published views open for editing in Web Authoring: the edit
            # URL is the view URL with /views/ swapped to /authoring/.
            authoring_url = viz_url.replace("/views/", "/authoring/") if (self_pub and "/views/" in viz_url) else ""
            dashboards.append({
                "id": d.get("id"),
                "name": d.get("name") or d.get("id"),
                "viz_url": viz_url,
                "toolbar": d.get("toolbar") or "hidden",
                "icon": d.get("icon") or "fa-chart-column",
                "self_published": self_pub,
                "authoring_url": authoring_url,
                # Resolved authoring target (content_url, not LUID) or "".
                "datasource_content_url": (linked or {}).get("content_url", ""),
                "datasource_name": (linked or {}).get("name", ""),
            })
        # Group datasource gallery: hydrate ids → full catalog entries.
        gallery = [ds_by_id[i] for i in g.get("datasource_ids", []) if i in ds_by_id]
        groups_out.append({
            "id": g.get("id"),
            "name": g.get("name") or g.get("id"),
            "icon": g.get("icon") or "fa-layer-group",
            "dashboards": dashboards,
            "datasources": gallery,
        })
    # Global datasource gallery: only datasources curated into a group (deduped,
    # first-seen order) — NOT the whole synced catalog. The full catalog stays
    # available to the settings group-builder via /api/catalog.
    global_datasources: list[dict] = []
    seen: set = set()
    for g in groups_out:
        for d in g["datasources"]:
            ds_id = d.get("id")
            if ds_id and ds_id not in seen:
                seen.add(ds_id)
                global_datasources.append({
                    "id": ds_id,
                    "content_url": d.get("content_url", ""),
                    "name": d.get("name") or ds_id,
                    "project": d.get("project", ""),
                    "type": d.get("type", ""),
                    "description": d.get("description", ""),
                    "has_extracts": bool(d.get("has_extracts")),
                })

    return {
        "groups": groups_out,
        "datasources": global_datasources,
        "brand": settings.get("portal", {}).get("brand", {"title": "Embedded Analytics Portal"}),
    }
