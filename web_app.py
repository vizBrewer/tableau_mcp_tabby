# Web UI Libraries
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from fastapi.responses import HTMLResponse, StreamingResponse, Response
from pydantic import BaseModel
from contextlib import asynccontextmanager

# MCP libraries
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

# LangChain Libraries
from langchain_mcp_adapters.tools import load_mcp_tools
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langchain_core.tools import tool

# Set Local MCP Logging
from utilities.logging_config import setup_logging
logger = setup_logging("web_app.log")

# Load System Prompt and Message Formatter
from utilities.prompt import AGENT_SYSTEM_PROMPT
from utilities.chat import stream_agent_response
from utilities.model_provider import get_llm

# Tableau embedding: settings storage + connected-app JWT minting
from utilities.settings_store import (
    get_public_settings,
    save_settings,
    load_settings,
    get_signing_material,
    is_configured,
    derive_embedding_api_url,
    save_catalog,
    get_catalog,
    build_portal_projection,
    add_dashboards_to_group,
)
from utilities.embed_token import mint_embed_token
from utilities.tableau_rest import fetch_catalog, fetch_view_preview
# LEGACY/TESTING: format_agent_response is commented out - uncomment if you need non-streaming endpoint
# from utilities.chat import format_agent_response

# Tool error handling
from langgraph.prebuilt.tool_node import ToolNode

# Load Environment and set MCP endpoint
import os
import json
from dotenv import load_dotenv

load_dotenv()
mcp_http_url = os.getenv(
    "TABLEAU_MCP_HTTP_URL",
    "http://localhost:3927/tableau-mcp",
)
if not mcp_http_url:
    raise RuntimeError("TABLEAU_MCP_HTTP_URL must be defined")

def _static_html_response(filename: str) -> HTMLResponse:
    html = Path(f"static/{filename}").read_text(encoding="utf-8")
    return HTMLResponse(html)


def _index_html_response() -> HTMLResponse:
    return _static_html_response("index.html")

# Set Langfuse Tracing or local Tracing
callback_handler = None
_file_callback_handler_ctx = None  # Store context manager reference

if os.getenv("USE_LANGFUSE", "false").lower() == "true":
    from langfuse.langchain import CallbackHandler
    callback_handler = CallbackHandler()
elif os.getenv("USE_LANGFUSE", "false").lower() == "false":
    from langchain_core.callbacks import FileCallbackHandler
    os.makedirs(".logs", exist_ok=True)  # Ensure .logs directory exists
    # FileCallbackHandler will be entered as context manager in lifespan
    _file_callback_handler_ctx = FileCallbackHandler(filename=".logs/agent_trace.jsonl")
else:
    callback_handler = None
    _file_callback_handler_ctx = None


# Global variables for agent and session
agent = None
session_context = None
import uuid
SESSION_STORE = {}

# Global async context manager for MCP connection
@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent, callback_handler, _file_callback_handler_ctx
    logger.info("Starting up application...")
    
    # Enter FileCallbackHandler context manager if using file-based callbacks
    if _file_callback_handler_ctx is not None:
        callback_handler = _file_callback_handler_ctx.__enter__()
        logger.info("FileCallbackHandler context entered")
    
    try:
        logger.info("Connecting to Tableau MCP via Streamable HTTP at %s", mcp_http_url)

        # Use Streamable HTTP transport instead of stdio
        async with streamablehttp_client(mcp_http_url) as (read, write, _get_session_id):
            async with ClientSession(read, write) as client_session:
                # Initialize the connection
                await client_session.initialize()

                # Get tools, filter tools using the .env config
                mcp_tools = await load_mcp_tools(client_session)
                logger.info(f"Loaded {len(mcp_tools)} MCP tools")
                
                # Debug: Log ALL tool descriptions to understand what the agent sees
                # logger.info(f"Loaded {len(mcp_tools)} MCP tools")
                # print(f"🔧 Loaded {len(mcp_tools)} MCP tools:")
                
                # for tool in mcp_tools:
                #     logger.info(f"Tool: {tool.name}")
                #     print(f"  {tool.name}")
                    
                #     if tool.name == "query-datasource":
                #         logger.info(f"Query-datasource DESCRIPTION: {tool.description}")
                #         logger.info(f"Query-datasource ARGS SCHEMA: {tool.args_schema}")
                #         print(f"   QUERY-DATASOURCE DESCRIPTION:")
                #         print(f"     {tool.description}")
                #         print(f"   QUERY-DATASOURCE ARGS SCHEMA:")
                #         print(f"     {tool.args_schema}")
                        
                #         # Also log the actual schema properties if available
                #         if hasattr(tool.args_schema, 'schema'):
                #             logger.info(f"Query-datasource SCHEMA DETAILS: {tool.args_schema.schema()}")
                #             print(f"   SCHEMA DETAILS:")
                #             print(f"     {tool.args_schema.schema()}")
                
                # logger.info("Tool loading and inspection complete")
                
                # Initialize LLM using model provider utility
                llm = get_llm()

                # Create tool node with error handling - errors will be returned as ToolMessages
                # This allows the agent to see the error and retry with a different approach
                tool_node = ToolNode(mcp_tools, handle_tool_errors=True)

                # Create the agent with error-aware tool node
                checkpointer = InMemorySaver()
                agent = create_react_agent(
                    model=llm, 
                    tools=tool_node,  # Use ToolNode instead of raw tools
                    prompt=AGENT_SYSTEM_PROMPT, 
                    checkpointer=checkpointer
                )
                
                yield
        
    # Error Handling
    except Exception as e:
        logger.error(f"Failed to initialize agent: {e}")
        raise
    finally:
        # Exit FileCallbackHandler context manager on shutdown
        if _file_callback_handler_ctx is not None:
            _file_callback_handler_ctx.__exit__(None, None, None)
            logger.info("FileCallbackHandler context exited")

# Create FastAPI app with lifespan
app = FastAPI(
    title="Tableau AI Chat", 
    description="Simple AI chat interface for Tableau data",
    lifespan=lifespan
)

# Serve static files (HTML, CSS, JS)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Request/Response models
class ChatRequest(BaseModel):
    message: str
    thread_id: str

class ChatResponse(BaseModel):
    response: str





@app.get("/")
def home():
    """Serve the main HTML page"""
    return _index_html_response()


@app.get("/index.html")
def static_index():
    return _index_html_response()


# ── Tableau embedding: showcase pages ──────────────────────────────────────
@app.get("/portal")
def portal_page():
    """Serve the embedded-dashboard portal (collapsible sidebar of curated groups)."""
    return _static_html_response("portal.html")


@app.get("/grants")
def grants_page():
    """Serve the single-dashboard demo with filter dropdowns."""
    return _static_html_response("grants.html")


@app.get("/settings")
def settings_page():
    """Serve the Tableau connection / embedding settings page."""
    return _static_html_response("settings.html")


@app.get("/widget")
def widget_page():
    """Serve the compact chat UI embedded by the floating Tabby widget."""
    return _static_html_response("widget.html")


# ── Tableau embedding: API endpoints ───────────────────────────────────────
@app.get("/api/settings")
async def api_get_settings():
    """Return current settings with the connected-app secret value masked."""
    return get_public_settings()


@app.post("/api/settings")
async def api_save_settings(request: Request):
    """Persist settings. Accepts a free-form dict (portal groups are open-ended)."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Settings payload must be an object")
    try:
        return save_settings(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Failed to save settings: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save settings")


@app.get("/api/portal-config")
async def api_portal_config():
    """Public portal content (curated projection) + embedding endpoints. No secrets."""
    settings = load_settings()
    server_url = settings["tableau"]["server_url"]
    projection = build_portal_projection()
    return {
        "groups": projection["groups"],
        "datasources": projection["datasources"],
        "brand": projection["brand"],
        "server_url": server_url,
        "site_content_url": settings["tableau"]["site_content_url"],
        "embedding_api_url": derive_embedding_api_url(server_url),
    }


@app.get("/api/catalog")
async def api_catalog():
    """Return the full synced Tableau inventory for the settings group-builder.

    Browser-safe (no secrets) — this is the superset the user curates from.
    """
    return get_catalog()


@app.get("/api/view-thumbnail/{view_id}")
async def api_view_thumbnail(view_id: str):
    """Proxy the Tableau REST previewImage (PNG thumbnail) for a view.

    Maps view_id → its workbook_id via the synced catalog, then fetches the
    thumbnail with a cached REST session. Used by the portal welcome gallery.
    """
    catalog = get_catalog()
    workbook_id = None
    for w in catalog.get("workbooks", []):
        if any(v.get("id") == view_id for v in w.get("views", [])):
            workbook_id = w.get("id")
            break
    if not workbook_id:
        raise HTTPException(status_code=404, detail="View not found in catalog")

    ok, _ = is_configured()
    if not ok:
        raise HTTPException(status_code=400, detail="Tableau connection not configured")
    try:
        png = fetch_view_preview(get_signing_material(), view_id, workbook_id)
    except Exception as exc:
        logger.warning("Thumbnail fetch failed for view %s: %s", view_id, exc)
        raise HTTPException(status_code=502, detail="Could not fetch thumbnail")
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=1800"},
    )


@app.post("/api/catalog/sync")
async def api_catalog_sync():
    """Fetch the full inventory (workbooks/views + datasources) from the Tableau
    REST API and store it as the catalog. Does NOT alter curated portal groups.
    Reuses the connected-app secret (REST-scoped JWT)."""
    ok, missing = is_configured()
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=f"Tableau connection not configured. Missing: {', '.join(missing)}",
        )
    try:
        signing = get_signing_material()
        content = fetch_catalog(signing)
    except Exception as exc:
        logger.error(f"Failed to sync catalog from Tableau REST: {exc}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Tableau REST sync failed: {exc}")

    # No reliable wall clock without Date.now(); stamp with the REST session time.
    from datetime import datetime, timezone
    synced_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    catalog = save_catalog(
        content["workbooks"], content["datasources"], content["projects"], synced_at
    )
    view_count = sum(len(w.get("views", [])) for w in catalog["workbooks"])
    return {
        "catalog": catalog,
        "workbook_count": len(catalog["workbooks"]),
        "view_count": view_count,
        "datasource_count": len(catalog["datasources"]),
        "project_count": len(catalog["projects"]),
        "synced_at": synced_at,
    }


def _match_published_workbook(workbooks: list, workbook_name: str, new_url: str) -> dict | None:
    """Resolve which catalog workbook a publish event refers to.

    The publish event reliably carries only `newUrl`; the display name may be
    absent. We try, in order: (A) exact display-name match, (B) workbook LUID
    present in the URL, (C) the workbook's contentUrl token (derived from a
    view's contentUrl, the part before "/sheets/") present in the URL. This
    survives the various URL shapes Tableau returns after publish.
    """
    from urllib.parse import unquote
    if workbook_name:
        named = [w for w in workbooks if (w.get("name") or "") == workbook_name]
        if named:
            return named[-1]

    if new_url:
        decoded = unquote(new_url).lower()
        # (B) LUID in the URL.
        for w in workbooks:
            wid = (w.get("id") or "").lower()
            if wid and wid in decoded:
                return w
        # (C) workbook contentUrl token (from any view's contentUrl prefix).
        for w in workbooks:
            for v in w.get("views", []):
                cu = (v.get("content_url") or "")
                prefix = cu.split("/sheets/")[0].strip("/").lower()
                if prefix and prefix in decoded:
                    return w
    return None


@app.post("/api/portal-config/add-published")
async def api_add_published(request: Request):
    """Add sheets from a just-published workbook to a portal group.

    Called by the portal when the embedded Web Authoring viz fires a publish
    event. Re-syncs the catalog via REST (so the new workbook is present), finds
    the workbook by name, and appends its views (optionally filtered to
    `sheet_names`) as dashboards to the target group.

    Body: { group_id?, group_name?, workbook_name (required), sheet_names? }
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON")
    workbook_name = (body.get("workbook_name") or "").strip()
    new_url = (body.get("new_url") or "").strip()
    if not workbook_name and not new_url:
        raise HTTPException(status_code=400, detail="workbook_name or new_url is required")

    ok, missing = is_configured()
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=f"Tableau connection not configured. Missing: {', '.join(missing)}",
        )

    # Refresh the catalog so the freshly-published workbook is present.
    try:
        signing = get_signing_material()
        content = fetch_catalog(signing)
    except Exception as exc:
        logger.error(f"Failed to sync catalog for add-published: {exc}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Tableau REST sync failed: {exc}")

    from datetime import datetime, timezone
    synced_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save_catalog(content["workbooks"], content["datasources"], content["projects"], synced_at)

    workbook = _match_published_workbook(content["workbooks"], workbook_name, new_url)
    logger.info(
        "add-published: workbook_name=%r new_url=%r catalog_workbooks=%d matched=%r",
        workbook_name, new_url, len(content["workbooks"]),
        (workbook or {}).get("name"),
    )
    if not workbook:
        # Log the catalog names so we can see why matching missed.
        logger.info("add-published NO MATCH; catalog names: %s",
                    [w.get("name") for w in content["workbooks"]][:60])
        hint = workbook_name or new_url
        raise HTTPException(
            status_code=404,
            detail=f"Couldn't match the published workbook ({hint}) in the catalog yet — try again in a moment.",
        )
    workbook_name = workbook.get("name") or workbook_name

    views = workbook.get("views", [])
    sheet_names = body.get("sheet_names")
    if isinstance(sheet_names, list) and sheet_names:
        wanted = set(sheet_names)
        filtered = [v for v in views if v.get("name") in wanted]
        views = filtered or views  # fall back to all if names didn't match

    # Auto-link the data source the workbook was authored on: map the authoring
    # content_url (what the portal launched authoring with) back to a catalog
    # datasource LUID, so the new dashboards are linked without manual setup.
    ds_content_url = (body.get("datasource_content_url") or "").strip()
    datasource_id = ""
    if ds_content_url:
        match = next(
            (d for d in content["datasources"] if (d.get("content_url") or "") == ds_content_url),
            None,
        )
        datasource_id = (match or {}).get("id", "")

    dashboards = [
        {
            "id": v.get("id"),
            "name": v.get("name") or v.get("id"),
            "viz_url": v.get("viz_url", ""),
            "toolbar": "hidden",
            "icon": "fa-chart-column",
            "datasource_id": datasource_id,
            "self_published": True,  # authored & published from the portal → editable
        }
        for v in views if v.get("id") and v.get("viz_url")
    ]
    if not dashboards:
        raise HTTPException(status_code=404, detail="No embeddable views found in the published workbook.")

    group_id, added = add_dashboards_to_group(
        body.get("group_id"), dashboards, body.get("group_name")
    )
    return {
        "group_id": group_id,
        "workbook": workbook_name,
        "added": added,
        "added_count": len(added),
    }


@app.get("/api/embed-token")
async def api_embed_token():
    """Mint a fresh connected-app JWT for embedding. Fully public by design."""
    ok, missing = is_configured()
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=f"Embedding not configured. Missing: {', '.join(missing)}",
        )
    try:
        signing = get_signing_material()
        token, exp = mint_embed_token(signing)
    except Exception as exc:
        logger.error(f"Failed to mint embed token: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to mint embed token")
    return {
        "token": token,
        "exp": exp,
        "server_url": signing["server_url"],
        "site_content_url": signing["site_content_url"],
    }


@app.get("/session")
async def init_session():
    thread_id = f"chat_session_{uuid.uuid4()}"
    logger.info(f"New session created: {thread_id} (total sessions: {len(SESSION_STORE)})")
     # Initialize empty graph state for the conversation that the langraph checkpointer can populate
    SESSION_STORE[thread_id] = {
        "state": {},          # LangGraph state (checkpointer will populate it)
    }
    return {"thread_id": thread_id}

@app.get("/debug/sessions")
async def debug_sessions():
    """Debug endpoint to check active sessions"""
    return {
        "active_sessions": len(SESSION_STORE),
        "session_ids": list(SESSION_STORE.keys())
    }

# LEGACY/TESTING: Non-streaming chat endpoint (currently not used by frontend)
# Uncomment if you need a non-streaming endpoint for testing purposes
# @app.post("/chat")
# async def chat(request: ChatRequest) -> ChatResponse:
#     """Handle chat messages - this is where the AI magic happens"""
#     global agent
#     
#     if agent is None:
#         logger.error("Agent not initialized")
#         raise HTTPException(status_code=500, detail="Agent not initialized. Please restart the server.")
#     
#     # Bring in the chat thread id
#     thread_id = request.thread_id
# 
#     if thread_id not in SESSION_STORE:
#         raise HTTPException(status_code=400, detail="Unknown thread_id")
# 
#     try:   
#         # Create proper message format for LangGraph
#         messages = [HumanMessage(content=request.message)]
# 
#         # Get response from agent
#         response_text = await format_agent_response(agent, messages, langfuse_handler, thread_id)
#         
#         return ChatResponse(response=response_text)
#         
#     # Error Handling
#     except Exception as e:
#         logger.error(f"Error processing chat request: {str(e)}", exc_info=True)
#         raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """Handle streaming chat messages with intermediate steps"""
    global agent
    
    if agent is None:
        logger.error("Agent not initialized")
        raise HTTPException(status_code=500, detail="Agent not initialized. Please restart the server.")
    
    thread_id = request.thread_id
    logger.info(f"[{thread_id}] Received streaming request: {request.message[:50]}...")
    
    if thread_id not in SESSION_STORE:
        logger.warning(f"[{thread_id}] Unknown thread_id")
        raise HTTPException(status_code=400, detail="Unknown thread_id")

    try:
        messages = [HumanMessage(content=request.message)]
        logger.info(f"[{thread_id}] Starting agent stream, active threads: {len(SESSION_STORE)}")
        
        async def generate_stream():
            try:
                async for chunk in stream_agent_response(agent, messages, callback_handler, thread_id):
                    try:
                        # Ensure proper JSON encoding
                        json_str = json.dumps(chunk, ensure_ascii=False)
                        yield f"data: {json_str}\n\n"
                    except Exception as json_error:
                        logger.error(f"[{thread_id}] Error encoding chunk to JSON: {str(json_error)}")
                        # Send error as final response
                        yield f"data: {json.dumps({'type': 'final', 'content': 'Error encoding response', 'is_final': True})}\n\n"
                        break
                logger.info(f"[{thread_id}] Stream completed successfully")
            except Exception as e:
                logger.error(f"[{thread_id}] Error during streaming: {str(e)}", exc_info=True)
                # Always send a final error response
                try:
                    yield f"data: {json.dumps({'type': 'final', 'content': f'Error: {str(e)}', 'is_final': True})}\n\n"
                except:
                    # If even JSON encoding fails, send plain text
                    yield f"data: {json.dumps({'type': 'final', 'content': 'An error occurred', 'is_final': True})}\n\n"
        
        return StreamingResponse(
            generate_stream(),
            media_type="text/plain",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream"
            }
        )
        
    except Exception as e:
        logger.error(f"[{thread_id}] Error processing streaming chat request: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")

# Run the app
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)