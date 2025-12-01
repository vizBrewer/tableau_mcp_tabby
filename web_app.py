# Web UI Libraries
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from contextlib import asynccontextmanager

# MCP libraries
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

# LangChain Libraries
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langchain_core.tools import tool

# Set Local MCP Logging
from utilities.logging_config import setup_logging
logger = setup_logging("web_app.log")

# Load System Prompt and Message Formatter
from utilities.prompt import AGENT_SYSTEM_PROMPT
from utilities.chat import format_agent_response, stream_agent_response

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

# Set Langfuse Tracing
from langfuse.langchain import CallbackHandler
langfuse_handler = CallbackHandler()

# Global variables for agent and session
agent = None
session_context = None
import uuid
SESSION_STORE = {}

# Global async context manager for MCP connection
@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent
    logger.info("Starting up application...")
    
    try:
        logger.info("Connecting to Tableau MCP via Streamable HTTP at %s", mcp_http_url)

        # Use Streamable HTTP transport instead of stdio
        async with streamablehttp_client(mcp_http_url) as (read, write, _get_session_id):
            async with ClientSession(read, write) as client_session:
                # Initialize the connection
                await client_session.initialize()

                # Get tools, filter tools using the .env config
                mcp_tools = await load_mcp_tools(client_session)
                
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
                
                # Set AI Model
                llm = ChatOpenAI(model="gpt-5", temperature=0)

                # Create the agent
                checkpointer = InMemorySaver()
                agent = create_react_agent(model=llm, tools=mcp_tools, prompt=AGENT_SYSTEM_PROMPT, checkpointer=checkpointer)
                
                yield
        
    # Error Handling
    except Exception as e:
        logger.error(f"Failed to initialize agent: {e}")
        raise

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
    return FileResponse('static/index.html')

@app.get("/index.html")
def static_index():
    return FileResponse('static/index.html')

@app.get("/session")
async def init_session():
    thread_id = f"chat_session_{uuid.uuid4()}"
    print('session id generated: '+ thread_id)
     # Initialize empty graph state for the conversation that the langraph checkpointer can populate
    SESSION_STORE[thread_id] = {
        "state": {},          # LangGraph state (checkpointer will populate it)
    }
    return {"thread_id": thread_id}

@app.post("/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    """Handle chat messages - this is where the AI magic happens"""
    global agent
    
    if agent is None:
        logger.error("Agent not initialized")
        raise HTTPException(status_code=500, detail="Agent not initialized. Please restart the server.")
    
    # Bring in the chat thread id
    thread_id = request.thread_id

    if thread_id not in SESSION_STORE:
        raise HTTPException(status_code=400, detail="Unknown thread_id")

    try:   
        # Create proper message format for LangGraph
        messages = [HumanMessage(content=request.message)]

        # Get response from agent
        response_text = await format_agent_response(agent, messages, langfuse_handler, thread_id)
        
        return ChatResponse(response=response_text)
        
    # Error Handling
    except Exception as e:
        logger.error(f"Error processing chat request: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """Handle streaming chat messages with intermediate steps"""
    global agent
    
    if agent is None:
        logger.error("Agent not initialized")
        raise HTTPException(status_code=500, detail="Agent not initialized. Please restart the server.")
    
    thread_id = request.thread_id
    if thread_id not in SESSION_STORE:
        raise HTTPException(status_code=400, detail="Unknown thread_id")

    try:
        messages = [HumanMessage(content=request.message)]
        
        async def generate_stream():
            async for chunk in stream_agent_response(agent, messages, langfuse_handler, thread_id):
                yield f"data: {json.dumps(chunk)}\n\n"
        
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
        logger.error(f"Error processing streaming chat request: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")

# Run the app
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=80)