from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.tools.base import ToolException
import logging

logger = logging.getLogger(__name__)

async def format_agent_response(agent, messages, langfuse_handler, thread_id: str) -> str:
    """Stream response from agent and return the final AI message content with enhanced error handling."""
    response_text = ""
    tool_errors = []
    has_tool_calls = False
    error_occurred = False

    try:
        async for chunk in agent.astream(
            {"messages": messages},
            config={"configurable": {"thread_id": thread_id}, "callbacks": [langfuse_handler]},
            stream_mode="values",
        ):
            if "messages" in chunk and chunk["messages"]:
                latest: BaseMessage = chunk["messages"][-1]
                
                # Track if we have tool calls
                if hasattr(latest, 'tool_calls') and latest.tool_calls:
                    has_tool_calls = True
                
                # Capture tool error messages
                if isinstance(latest, ToolMessage):
                    if hasattr(latest, 'status') and latest.status == "error":
                        error_occurred = True
                        tool_name = getattr(latest, 'name', 'Unknown tool')
                        error_content = str(latest.content)
                        
                        # Handle specific MCP errors
                        if "-32602" in error_content or "Invalid params" in error_content:
                            tool_errors.append(f"Tool '{tool_name}' received invalid parameters. This usually means field names, data types, or query structure don't match the datasource schema.")
                        elif "-32601" in error_content or "Method not found" in error_content:
                            tool_errors.append(f"Tool '{tool_name}' is not available or not properly configured.")
                        elif "401" in error_content or "authentication" in error_content.lower():
                            tool_errors.append(f"Authentication failed for tool '{tool_name}'. Please check your Tableau credentials.")
                        else:
                            tool_errors.append(f"Tool '{tool_name}' failed: {error_content}")
                        
                        logger.warning(f"Tool error captured: {error_content}")
                    elif any(error_indicator in str(latest.content).lower() for error_indicator in ["error", "failed", "-32602", "invalid params"]):
                        # Catch tool errors even without explicit status
                        error_occurred = True
                        tool_name = getattr(latest, 'name', 'Unknown tool')
                        error_content = str(latest.content)
                        
                        if "-32602" in error_content:
                            tool_errors.append(f"Tool '{tool_name}' parameter error: The query parameters don't match the expected format. Please check field names and data types.")
                        else:
                            tool_errors.append(f"Tool '{tool_name}' encountered an issue: {error_content}")
                        logger.warning(f"Potential tool error: {error_content}")
                
                # Only capture actual AI responses, not tool messages
                elif isinstance(latest, AIMessage):
                    # latest.content is usually a string or list of message parts
                    if isinstance(latest.content, str):
                        response_text = latest.content
                    else:
                        # If it's a list of parts, join text parts
                        response_text = "".join(
                            part.get("text", "") if isinstance(part, dict) else str(part)
                            for part in latest.content
                        )

        # Enhanced error handling and response formatting
        if tool_errors and not response_text.strip():
            # If we have tool errors but no AI response, provide a helpful message
            response_text = "I encountered some issues while trying to help you:\n\n"
            for error in tool_errors[:3]:  # Limit to first 3 errors to avoid overwhelming
                response_text += f"• {error}\n"
            if len(tool_errors) > 3:
                response_text += f"• ... and {len(tool_errors) - 3} more issues\n"
            
            # Provide specific guidance based on error types
            if any("-32602" in error or "parameter" in error.lower() for error in tool_errors):
                response_text += "\n**Suggestion:** Let me first check the available datasources and their field structure, then try your query again with the correct parameters."
            elif any("401" in error or "authentication" in error.lower() for error in tool_errors):
                response_text += "\n**Suggestion:** Please check your Tableau server credentials and permissions."
            else:
                response_text += "\n**Suggestion:** This might be due to network issues or the requested resource not being available. Please try rephrasing your question or check your Tableau connection."
        
        elif tool_errors and response_text.strip():
            # If we have both response and tool errors, append a note
            response_text += f"\n\n*Note: Some tools encountered issues during this request. The response above may be incomplete.*"
        
        elif has_tool_calls and not response_text.strip():
            # If we had tool calls but no response and no explicit errors
            response_text = "I tried to help with your request, but didn't receive a complete response. This might be due to connectivity issues or the tools being unavailable. Please try again or rephrase your question."

    except ToolException as e:
        logger.error(f"ToolException in format_agent_response: {str(e)}", exc_info=True)
        if "401" in str(e):
            response_text = "I encountered an authentication error while trying to access your Tableau data. Please check your credentials and permissions."
        elif "403" in str(e):
            response_text = "I don't have permission to access the requested Tableau resource. Please check your access rights."
        elif "404" in str(e):
            response_text = "The requested Tableau resource was not found. Please verify the resource exists and try again."
        else:
            response_text = f"I encountered a tool error: {str(e)}. Please try rephrasing your request or try again later."
    
    except Exception as e:
        logger.error(f"Unexpected error in format_agent_response: {str(e)}", exc_info=True)
        error_occurred = True
        response_text = f"I apologize, but I encountered an unexpected error while processing your request. Please try rephrasing your question or try again. If the problem persists, there may be a connectivity issue with the Tableau server."

    # Mark thread for state recovery if errors occurred
    if error_occurred and tool_errors:
        logger.warning(f"Thread {thread_id} encountered tool errors and may need state recovery")
        # We'll handle state recovery at the web app level to avoid recursive issues

    # Final fallback
    if not response_text or not response_text.strip():
        response_text = "I'm sorry, I wasn't able to generate a response to your request. Please try rephrasing your question or ask something else."

    return response_text
