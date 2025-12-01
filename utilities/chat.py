
async def format_agent_response(agent, messages, langfuse_handler, thread_id):
    """Stream response from agent and return the final content"""
    print(thread_id)
    response_text = ""
    async for chunk in agent.astream(
        {"messages": messages}, 
        config={"configurable": {"thread_id": thread_id}, "callbacks": [langfuse_handler]}, 
        stream_mode="values"
    ):
        if 'messages' in chunk and chunk['messages']:
            latest_message = chunk['messages'][-1]
            if hasattr(latest_message, 'content'):
                response_text = latest_message.content
    
    return response_text

async def stream_agent_response(agent, messages, langfuse_handler, thread_id):
    """Stream intermediate steps and final response from agent"""
    print(f"Starting stream for thread: {thread_id}")
    
    step_count = 0
    final_response = ""
    seen_messages = set()
    
    async for chunk in agent.astream(
        {"messages": messages}, 
        config={"configurable": {"thread_id": thread_id}, "callbacks": [langfuse_handler]}, 
        stream_mode="values"
    ):
        if 'messages' in chunk and chunk['messages']:
            # Process all new messages in this chunk
            for message in chunk['messages']:
                message_id = getattr(message, 'id', None)
                
                # Skip if we've already processed this message
                if message_id and message_id in seen_messages:
                    continue
                    
                if message_id:
                    seen_messages.add(message_id)
                
                # Handle different message types
                if hasattr(message, 'type'):
                    if message.type == 'ai' and hasattr(message, 'content') and message.content:
                        # AI thinking/planning message
                        if not hasattr(message, 'tool_calls') or not message.tool_calls:
                            step_count += 1
                            yield {
                                "type": "thinking",
                                "step": step_count,
                                "content": message.content,
                                "is_final": False
                            }
                            final_response = message.content
                        
                        # AI message with tool calls
                        elif hasattr(message, 'tool_calls') and message.tool_calls:
                            for tool_call in message.tool_calls:
                                step_count += 1
                                tool_name = tool_call.get('name', 'unknown')
                                tool_args = tool_call.get('args', {})
                                
                                yield {
                                    "type": "tool_call",
                                    "step": step_count,
                                    "tool_name": tool_name,
                                    "content": f"🔧 Calling {tool_name}...",
                                    "args": tool_args,
                                    "is_final": False
                                }
                    
                    elif message.type == 'tool' and hasattr(message, 'content'):
                        # Tool result message
                        step_count += 1
                        tool_name = getattr(message, 'name', 'unknown')
                        
                        # Truncate long tool results for display
                        content = message.content
                        if len(content) > 200:
                            content = content[:200] + "... (truncated)"
                        
                        yield {
                            "type": "tool_result",
                            "step": step_count,
                            "tool_name": tool_name,
                            "content": f"✅ {tool_name} completed",
                            "result_preview": content,
                            "is_final": False
                        }
    
    # Send final response
    yield {
        "type": "final",
        "content": final_response,
        "is_final": True
    }
