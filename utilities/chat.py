
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
    
    async for chunk in agent.astream(
        {"messages": messages}, 
        config={"configurable": {"thread_id": thread_id}, "callbacks": [langfuse_handler]}, 
        stream_mode="values"
    ):
        if 'messages' in chunk and chunk['messages']:
            latest_message = chunk['messages'][-1]
            
            if hasattr(latest_message, 'content') and latest_message.content:
                # Check if this is an AI message with thinking content
                if hasattr(latest_message, 'type') and latest_message.type == 'ai':
                    step_count += 1
                    
                    # Send intermediate step
                    yield {
                        "type": "step",
                        "step": step_count,
                        "content": latest_message.content,
                        "is_final": False
                    }
                    
                    final_response = latest_message.content
    
    # Send final response
    yield {
        "type": "final",
        "content": final_response,
        "is_final": True
    }
