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
                    
                    # Stream AI thinking/reasoning
                    if hasattr(message, 'type') and message.type == 'ai':
                        if hasattr(message, 'content') and message.content:
                            # Yield intermediate thinking
                            yield {
                                "type": "step",
                                "content": message.content,
                                "is_final": False
                            }
                            final_response = message.content
        
        # Send final response
        if not final_response:
            logger.warning(f"[{thread_id}] No final response captured, sending empty response")
            final_response = "I apologize, but I wasn't able to generate a response."
        
        # Clean up MCP error -32602 (schema validation errors) - these are very long and not user-friendly
        if "MCP error -32602" in final_response or "error -32602" in final_response:
            logger.warning(f"[{thread_id}] Detected MCP error -32602, replacing with user-friendly message")
            final_response = "I encountered a validation error while processing your request. Please try rephrasing your question or refresh your browser to start a new session."
        
        # Repair incomplete tool calls - check state for orphaned tool calls and inject error responses
        await repair_incomplete_tool_calls(agent, thread_id, logger)
        
        yield {
            "type": "final",
            "content": final_response,
            "is_final": True
        }
        logger.info(f"[{thread_id}] Stream completed, final response length: {len(final_response)}")
        
    except Exception as e:
        logger.error(f"[{thread_id}] Error in stream_agent_response: {str(e)}", exc_info=True)
        
        # Check if it's an MCP error -32602
        error_str = str(e)
        if "MCP error -32602" in error_str or "error -32602" in error_str:
            final_error_message = "I encountered a validation error while processing your request. Please try rephrasing your question or refresh your browser to start a new session."
        else:
            final_error_message = f"I encountered an error: {error_str[:200]}"  # Limit length for other errors
        
        # Always send a final response, even on error
        yield {
            "type": "final",
            "content": final_error_message,
            "is_final": True
        }
        
        # Repair incomplete tool calls after error
        await repair_incomplete_tool_calls(agent, thread_id, logger)
