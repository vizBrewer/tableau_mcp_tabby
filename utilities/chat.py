
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
    
    final_response = ""
    seen_message_ids = set()
    initial_message_count = None
    
    async for chunk in agent.astream(
        {"messages": messages}, 
        config={"configurable": {"thread_id": thread_id}, "callbacks": [langfuse_handler]}, 
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
    yield {
        "type": "final",
        "content": final_response,
        "is_final": True
    }
