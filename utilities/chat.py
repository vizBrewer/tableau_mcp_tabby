import json
import re
from typing import Any, List


def _mcp_image_block_to_data_url(obj: Any) -> str | None:
    """Convert known MCP image block shapes to a data URL."""
    if obj is None:
        return None
    if isinstance(obj, dict) and obj.get("type") == "image":
        data = obj.get("data")
        mime = obj.get("mimeType") or obj.get("mime_type") or "image/png"
        if isinstance(data, str) and data.strip():
            return f"data:{mime};base64,{data.strip()}"
    if getattr(obj, "type", None) == "image":
        data = getattr(obj, "data", None)
        mime = getattr(obj, "mimeType", None) or getattr(obj, "mime_type", None) or "image/png"
        if isinstance(data, str) and data.strip():
            return f"data:{mime};base64,{data.strip()}"
    return None


_DATA_URI_IMAGE_RE = re.compile(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+")
_BASE64_RE = re.compile(r"^[A-Za-z0-9+/]+=*$")


def _extract_images_from_any(content: Any) -> List[str]:
    """Extract data:image URLs from strings, dict/list content, or image blocks."""
    found: List[str] = []
    seen: set[str] = set()

    def add(url: str) -> None:
        normalized = re.sub(r"\s+", "", url.strip())
        if not normalized or normalized in seen:
            return
        seen.add(normalized)
        found.append(normalized)

    def walk(value: Any) -> None:
        if value is None:
            return
        block_url = _mcp_image_block_to_data_url(value)
        if block_url:
            add(block_url)
            return
        if isinstance(value, str):
            for m in _DATA_URI_IMAGE_RE.finditer(value):
                add(m.group(0))
            compact = re.sub(r"\s+", "", value)
            if len(compact) > 500 and _BASE64_RE.fullmatch(compact):
                add("data:image/png;base64," + compact)
            try:
                decoded = json.loads(value)
            except (TypeError, ValueError, json.JSONDecodeError):
                return
            walk(decoded)
            return
        if isinstance(value, dict):
            for _, sub in value.items():
                walk(sub)
            return
        if isinstance(value, list):
            for item in value:
                walk(item)

    walk(content)
    return found


def extract_images_from_tool_message(message: Any) -> List[str]:
    urls: List[str] = []
    for url in _extract_images_from_any(getattr(message, "content", None)):
        if url not in urls:
            urls.append(url)
    for url in _extract_images_from_any(getattr(message, "artifact", None)):
        if url not in urls:
            urls.append(url)
    return urls


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, (str, int, float, bool))


def _normalize_rows_dict_list(rows: Any, max_rows: int = 120) -> List[dict]:
    if not isinstance(rows, list):
        return []
    normalized: List[dict] = []
    for row in rows[:max_rows]:
        if isinstance(row, dict):
            clean = {str(k): v for k, v in row.items() if _is_scalar(v)}
            if clean:
                normalized.append(clean)
    return normalized


def _normalize_rows_with_columns(obj: dict, max_rows: int = 120) -> List[dict]:
    columns = obj.get("columns")
    rows = obj.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list):
        return []
    col_names = [str(c) for c in columns]
    normalized: List[dict] = []
    for row in rows[:max_rows]:
        if isinstance(row, list):
            mapped = {}
            for i, col in enumerate(col_names):
                if i < len(row) and _is_scalar(row[i]):
                    mapped[col] = row[i]
            if mapped:
                normalized.append(mapped)
        elif isinstance(row, dict):
            mapped = {str(k): v for k, v in row.items() if _is_scalar(v)}
            if mapped:
                normalized.append(mapped)
    return normalized


def _extract_tables_from_any(content: Any) -> List[dict]:
    """Extract compact tabular data candidates from tool outputs."""
    candidates: List[dict] = []
    seen: set[str] = set()

    def add_table(rows: List[dict], title: str = "Tool Result") -> None:
        if len(rows) < 2:
            return
        # Require at least one numeric value somewhere for charting potential.
        has_numeric = any(
            isinstance(v, (int, float)) and not isinstance(v, bool)
            for row in rows for v in row.values()
        )
        if not has_numeric:
            return
        key = json.dumps(rows[:20], sort_keys=True, default=str)
        if key in seen:
            return
        seen.add(key)
        candidates.append({"title": title, "rows": rows})

    def walk(value: Any, path_hint: str = "Tool Result") -> None:
        if value is None:
            return
        if isinstance(value, str):
            try:
                decoded = json.loads(value)
            except (TypeError, ValueError, json.JSONDecodeError):
                return
            walk(decoded, path_hint)
            return
        if isinstance(value, list):
            rows = _normalize_rows_dict_list(value)
            if rows:
                add_table(rows, path_hint)
            for item in value:
                walk(item, path_hint)
            return
        if isinstance(value, dict):
            title = str(value.get("name") or value.get("title") or value.get("caption") or path_hint)
            # Common tabular container shapes.
            for key in ("data", "result", "results", "records", "items", "values"):
                rows = _normalize_rows_dict_list(value.get(key))
                if rows:
                    add_table(rows, title)
            rows = _normalize_rows_with_columns(value)
            if rows:
                add_table(rows, title)
            for k, sub in value.items():
                walk(sub, str(k))

    walk(content)
    return candidates


def extract_tables_from_tool_message(message: Any) -> List[dict]:
    tables: List[dict] = []
    for table in _extract_tables_from_any(getattr(message, "content", None)):
        tables.append(table)
    for table in _extract_tables_from_any(getattr(message, "artifact", None)):
        tables.append(table)
    # Keep payload modest for SSE
    return tables[:4]


def stringify_ai_content(content, include_reasoning: bool = False) -> str:
    """
    Flatten AIMessage.content for SSE/JSON: Bedrock (and some providers) use a list
    of blocks (e.g. reasoning_content, text) instead of a plain string.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                btype = block.get("type")
                if btype == "text" and isinstance(block.get("text"), str):
                    parts.append(block["text"])
                elif btype == "reasoning_content" and include_reasoning:
                    rc = block.get("reasoning_content")
                    if isinstance(rc, dict) and isinstance(rc.get("text"), str):
                        parts.append(rc["text"])
                    elif isinstance(rc, str):
                        parts.append(rc)
            elif hasattr(block, "text") and isinstance(getattr(block, "text", None), str):
                parts.append(block.text)
        return "\n".join(parts)
    if isinstance(content, dict) and content.get("type") == "text" and isinstance(content.get("text"), str):
        return content["text"]
    return str(content)


async def repair_incomplete_tool_calls(agent, thread_id, logger):
    """
    Check agent state for incomplete tool calls and inject error ToolMessages.
    
    This ensures that any AIMessage with tool_calls that don't have corresponding
    ToolMessages get error responses, allowing the agent to continue gracefully.
    """
    try:
        from langchain_core.messages import ToolMessage, AIMessage
        
        config = {"configurable": {"thread_id": thread_id}}
        state_snapshot = agent.get_state(config)
        
        if not state_snapshot or not state_snapshot.values:
            return False
        
        messages = state_snapshot.values.get("messages", [])
        if not messages:
            return False
        
        # Track which tool calls have responses
        tool_call_ids_with_responses = {msg.tool_call_id for msg in messages if isinstance(msg, ToolMessage)}
        tool_calls_needing_responses = []
        
        # Find AIMessages with tool_calls that don't have responses
        for message in messages:
            if isinstance(message, AIMessage) and hasattr(message, 'tool_calls') and message.tool_calls:
                for tool_call in message.tool_calls:
                    tool_call_id = tool_call.get('id') if isinstance(tool_call, dict) else getattr(tool_call, 'id', None)
                    tool_name = tool_call.get('name') if isinstance(tool_call, dict) else getattr(tool_call, 'name', 'unknown')
                    if tool_call_id and tool_call_id not in tool_call_ids_with_responses:
                        tool_calls_needing_responses.append((tool_call_id, tool_name))
        
        # Inject error ToolMessages for incomplete tool calls
        if tool_calls_needing_responses:
            logger.warning(f"[{thread_id}] Found {len(tool_calls_needing_responses)} incomplete tool call(s), injecting error responses")
            error_tool_messages = [
                ToolMessage(
                    content=f"Tool call to '{tool_name}' failed to complete. This may have been due to a network error, permission issue (403), or service unavailability. Please try again or use a different approach.",
                    tool_call_id=tool_call_id,
                    name=tool_name
                )
                for tool_call_id, tool_name in tool_calls_needing_responses
            ]
            agent.update_state(config, {"messages": list(messages) + error_tool_messages})
            logger.info(f"[{thread_id}] Injected {len(error_tool_messages)} error ToolMessage(s) to repair state")
            return True
        
        return False
        
    except Exception as repair_error:
        logger.warning(f"[{thread_id}] Error checking/repairing incomplete tool calls: {str(repair_error)}")
        return False


# LEGACY/TESTING: Non-streaming response function (currently not used - frontend uses stream_agent_response)
# Uncomment if you need a non-streaming endpoint for testing purposes
# async def format_agent_response(agent, messages, callback_handler, thread_id):
#     """Stream response from agent and return the final content"""
#     # print(thread_id)
#     response_text = ""
#     try:
#         async for chunk in agent.astream(
#             {"messages": messages}, 
#             config={"configurable": {"thread_id": thread_id}, "callbacks": [callback_handler]}, 
#             stream_mode="values"
#         ):
#             if 'messages' in chunk and chunk['messages']:
#                 latest_message = chunk['messages'][-1]
#                 if hasattr(latest_message, 'content'):
#                     response_text = latest_message.content
#         
#         # Clean up MCP error -32602 (schema validation errors)
#         if response_text and ("MCP error -32602" in response_text or "error -32602" in response_text):
#             import logging
#             logger = logging.getLogger(__name__)
#             logger.warning(f"[{thread_id}] Detected MCP error -32602 in response, replacing with user-friendly message")
#             response_text = "I encountered a validation error while processing your request. Please try rephrasing your question or refresh your browser to start a new session."
#         
#         return response_text
#     except Exception as e:
#         error_str = str(e)
#         if "MCP error -32602" in error_str or "error -32602" in error_str:
#             return "I encountered a validation error while processing your request. Please try rephrasing your question or refresh your browser to start a new session."
#         raise

async def stream_agent_response(agent, messages, callback_handler, thread_id):
    """Stream intermediate steps and final response from agent"""
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"[{thread_id}] Starting stream for thread")
    
    final_response = ""
    collected_images: List[str] = []
    collected_tables: List[dict] = []
    seen_message_ids = set()
    initial_message_count = None
    
    try:
        async for chunk in agent.astream(
            {"messages": messages}, 
            # checks if callback handler is not None then add it to the config, otherwise add an empty list
            config={"configurable": {"thread_id": thread_id}, "callbacks": [callback_handler] if callback_handler else []},
            stream_mode="values"
        ):
            if 'messages' in chunk and chunk['messages']:
                # Capture initial message count on first chunk
                if initial_message_count is None:
                    initial_message_count = len(chunk['messages'])
                
                # Only process messages beyond the initial count (new messages)
                new_messages = chunk['messages'][initial_message_count:]
                
                for message in new_messages:
                    message_id = getattr(message, 'id', None)
                    
                    # Skip if we've already seen this message in this stream
                    if message_id and message_id in seen_message_ids:
                        continue
                        
                    if message_id:
                        seen_message_ids.add(message_id)

                    if getattr(message, "type", None) == "tool":
                        for url in extract_images_from_tool_message(message):
                            if url not in collected_images:
                                collected_images.append(url)
                        for table in extract_tables_from_tool_message(message):
                            if table not in collected_tables:
                                collected_tables.append(table)
                    
                    # Stream AI thinking/reasoning
                    if hasattr(message, 'type') and message.type == 'ai':
                        if hasattr(message, 'content') and message.content:
                            step_text = stringify_ai_content(message.content, include_reasoning=True)
                            final_text = stringify_ai_content(message.content, include_reasoning=False)
                            if step_text:
                                yield {
                                    "type": "step",
                                    "content": step_text,
                                    "is_final": False
                                }
                            if final_text:
                                final_response = final_text
        
        # Send final response
        if not final_response:
            logger.warning(f"[{thread_id}] No final response captured, sending empty response")
            final_response = "I apologize, but I wasn't able to generate a response."
        
        # Clean up MCP error -32602 (schema validation errors) - these are very long and not user-friendly
        if "MCP error -32602" in final_response or "error -32602" in final_response:
            logger.warning(f"[{thread_id}] Detected MCP error -32602, replacing with user-friendly message")
            final_response = "I encountered a validation error while processing your request. Please try rephrasing your question or refresh your browser to start a new session."
        
        # Filter out LangGraph internal error messages about incomplete tool calls
        # These are state repair messages that shouldn't be shown to users
        if "Found AIMessages with tool_calls" in final_response or "do not have a corresponding ToolMessage" in final_response:
            logger.warning(f"[{thread_id}] Detected LangGraph tool call error message, filtering it out")
            # Replace with a user-friendly message
            final_response = "I encountered an issue processing your request. I've recovered and can continue - please try asking your question again or rephrase it."
        
        # Repair incomplete tool calls - check state for orphaned tool calls and inject error responses
        await repair_incomplete_tool_calls(agent, thread_id, logger)
        
        yield {
            "type": "final",
            "content": final_response,
            "images": collected_images,
            "tables": collected_tables,
            "is_final": True
        }
        logger.info(f"[{thread_id}] Stream completed, final response length: {len(final_response)}")
        
    except Exception as e:
        logger.error(f"[{thread_id}] Error in stream_agent_response: {str(e)}", exc_info=True)
        
        # Check if it's an MCP error -32602
        error_str = str(e)
        if "MCP error -32602" in error_str or "error -32602" in error_str:
            final_error_message = "I encountered a validation error while processing your request. Please try rephrasing your question or refresh your browser to start a new session."
        elif "Found AIMessages with tool_calls" in error_str or "do not have a corresponding ToolMessage" in error_str:
            # Filter out LangGraph internal error messages
            logger.warning(f"[{thread_id}] Detected LangGraph tool call error in exception, filtering it out")
            final_error_message = "I encountered an issue processing your request. I've recovered and can continue - please try asking your question again or rephrase it."
        else:
            final_error_message = f"I encountered an error: {error_str[:200]}"  # Limit length for other errors
        
        # Always send a final response, even on error
        yield {
            "type": "final",
            "content": final_error_message,
            "images": collected_images,
            "tables": collected_tables,
            "is_final": True
        }
        
        # Repair incomplete tool calls after error
        await repair_incomplete_tool_calls(agent, thread_id, logger)
