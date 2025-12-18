"""
Tool wrapper utilities for better error handling of MCP tools.

This module provides wrappers that convert HTTP errors (400, 403, etc.) into
ToolException messages that LangGraph can handle gracefully, preventing graph
state corruption.
"""
import logging
from typing import List
from langchain_core.tools import BaseTool, ToolException
from langchain_core.callbacks import CallbackManagerForToolRun, AsyncCallbackManagerForToolRun

logger = logging.getLogger(__name__)


def wrap_tool_with_error_handling(tool: BaseTool) -> BaseTool:
    """
    Wrap a LangChain tool to catch HTTP errors and convert them to ToolException.
    
    This ensures that 400/403 errors from Tableau become user-friendly tool error
    messages instead of crashing the LangGraph agent state.
    
    Args:
        tool: The original LangChain tool to wrap
        
    Returns:
        A new tool instance with error handling
    """
    # Store original methods
    original_run = tool.run
    original_arun = tool.arun
    original_invoke = getattr(tool, 'invoke', None)
    original_ainvoke = getattr(tool, 'ainvoke', None)
    
    def _extract_error_message(error: Exception) -> str:
        """Extract and format error message from exception."""
        error_msg = str(error).lower()
        
        # Check for HTTP status codes in error messages (various formats)
        # Patterns: "status code 400", "Request failed with status code 400", "HTTP 400", etc.
        if "status code 400" in error_msg or ("400" in error_msg and ("request failed" in error_msg or "http" in error_msg)):
            return (
                f"The request to '{tool.name}' was invalid (HTTP 400). "
                f"This usually means the parameters were malformed or missing required fields. "
                f"Please check the tool arguments and try again."
            )
        elif "status code 403" in error_msg or ("403" in error_msg and ("request failed" in error_msg or "http" in error_msg)):
            return (
                f"Access denied (HTTP 403) when calling '{tool.name}'. "
                f"This is typically a permissions issue. The user may not have access to "
                f"the requested resource, or the authentication credentials may be insufficient. "
                f"Please verify permissions or try a different approach."
            )
        elif "status code 404" in error_msg or ("404" in error_msg and ("request failed" in error_msg or "http" in error_msg)):
            return (
                f"Resource not found (HTTP 404) when calling '{tool.name}'. "
                f"The requested resource (datasource, view, workbook, etc.) may not exist "
                f"or may have been moved. Please verify the resource identifier and try again."
            )
        elif "status code 500" in error_msg or ("500" in error_msg and ("request failed" in error_msg or "http" in error_msg)):
            return (
                f"Server error (HTTP 500) when calling '{tool.name}'. "
                f"This indicates an internal error on the Tableau server. "
                f"Please try again later or contact support if the issue persists."
            )
        else:
            # For other errors, provide a generic but informative message
            original_msg = str(error)
            return (
                f"An error occurred when calling '{tool.name}': {original_msg[:300]}. "
                f"Please try again or use a different approach."
            )
    
    def wrapped_run(*args, **kwargs) -> str:
        """Wrapped synchronous run method with error handling."""
        try:
            return original_run(*args, **kwargs)
        except ToolException:
            # Re-raise ToolException as-is (already user-friendly)
            raise
        except Exception as e:
            error_msg = str(e)
            friendly_msg = _extract_error_message(e)
            logger.warning(f"Tool {tool.name} error (HTTP detection): {error_msg[:200]}")
            raise ToolException(friendly_msg)
    
    async def wrapped_arun(*args, **kwargs) -> str:
        """Wrapped asynchronous run method with error handling."""
        try:
            return await original_arun(*args, **kwargs)
        except ToolException:
            # Re-raise ToolException as-is (already user-friendly)
            raise
        except Exception as e:
            error_msg = str(e)
            friendly_msg = _extract_error_message(e)
            logger.warning(f"Tool {tool.name} error (HTTP detection): {error_msg[:200]}")
            raise ToolException(friendly_msg)
    
    # Monkey-patch the tool's methods
    tool.run = wrapped_run
    tool.arun = wrapped_arun
    
    # Also wrap invoke/ainvoke if they exist (LangChain newer API)
    if original_invoke:
        def wrapped_invoke(*args, **kwargs):
            try:
                return original_invoke(*args, **kwargs)
            except ToolException:
                raise
            except Exception as e:
                friendly_msg = _extract_error_message(e)
                logger.warning(f"Tool {tool.name} invoke error: {str(e)[:200]}")
                raise ToolException(friendly_msg)
        tool.invoke = wrapped_invoke
    
    if original_ainvoke:
        async def wrapped_ainvoke(*args, **kwargs):
            try:
                return await original_ainvoke(*args, **kwargs)
            except ToolException:
                raise
            except Exception as e:
                friendly_msg = _extract_error_message(e)
                logger.warning(f"Tool {tool.name} ainvoke error: {str(e)[:200]}")
                raise ToolException(friendly_msg)
        tool.ainvoke = wrapped_ainvoke
    
    return tool


def wrap_mcp_tools(tools: List[BaseTool]) -> List[BaseTool]:
    """
    Wrap a list of MCP tools with error handling.
    
    Args:
        tools: List of LangChain tools from MCP
        
    Returns:
        List of wrapped tools with error handling (same list, tools modified in place)
    """
    wrapped_count = 0
    for tool in tools:
        try:
            if not isinstance(tool, BaseTool):
                logger.warning(f"Tool '{getattr(tool, 'name', 'unknown')}' is not a BaseTool, skipping wrapper")
                continue
            wrap_tool_with_error_handling(tool)
            wrapped_count += 1
            logger.debug(f"Wrapped tool '{tool.name}' with error handling")
        except Exception as e:
            logger.error(f"Failed to wrap tool '{getattr(tool, 'name', 'unknown')}': {str(e)}")
            # Continue with original tool if wrapping fails
    
    logger.info(f"Wrapped {wrapped_count} out of {len(tools)} MCP tools with error handling")
    return tools  # Return same list (tools modified in place)
