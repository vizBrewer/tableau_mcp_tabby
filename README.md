# Tableau MCP Tabby 🐱

A streaming AI chat interface for Tableau data analysis, featuring real-time agent thinking steps and enhanced user experience. Built on the Tableau MCP (Model Context Protocol) with LangChain integration.

> **Credits:** This project is derived from [Will Sutton](https://github.com/wjsutton)'s excellent [tableau_mcp_starter_kit](https://github.com/TheInformationLab/tableau_mcp_starter_kit) created at [The Information Lab](https://github.com/TheInformationLab). The original work provided the foundation for Tableau MCP integration with LangChain.

## ✨ Key Features

- **🔄 Real-time Streaming**: Watch the AI agent think through your questions step-by-step
- **🤖 Multiple LLM Providers**: Support for OpenAI, AWS Bedrock, and easily extensible for other providers
- **🐱 Personalized Interface**: Custom cat favicon and friendly UI included, easily updated
- **📊 Natural Language Queries**: Ask questions about your Tableau data in plain English
- **🎯 Smart Error Handling**: Improved schema validation and error recovery
- **📱 Responsive Design**: Works on desktop and mobile devices
- **🔧 Dashboard Extension**: Embed directly into Tableau dashboards *Under Continued Construction*
- **📝 Flexible Callbacks**: Choose between FileCallbackHandler, Langfuse, or no callbacks

## 🚀 What Makes This Different
Unlike traditional chat interfaces that only show final results, Tableau MCP Tabby streams the agent's intermediate thinking steps in real-time:

```
🐱 Analyzing your request...
💭 I'll analyze this step by step: Identify the correct datasource...
💭 Inspecting schema to find the date field and visit counter...
💭 Querying the datasource to count visits for the last complete year...
📊 [Final results displayed]
```

**Architecture Note:** This application uses a streamable-http interface with an MCP server instead of a localized instance. The Tableau MCP server uses Direct Trust and Connected Apps to facilitate the connection and authentication.
## 📋 Prerequisites

- **Tableau Server 2025.1+** or **Tableau Cloud** ([Free trial available](https://www.tableau.com/en-gb/developer))
- **Python 3.11+** - [Download Python](https://python.org/downloads/)
- **Node.js 22.15.0 LTS** - [Download Node.js](https://nodejs.org/)
- **Git** - [Download Git](https://git-scm.com/downloads/)
- **LLM Provider Credentials**:
  - **OpenAI**: API key from [OpenAI Platform](https://platform.openai.com/)
  - **AWS Bedrock**: AWS Access Key ID, Secret Access Key, and Region (requires Bedrock access enabled)

## ⚠️ Data Privacy Notice

This application sends Tableau data to external AI models. For production use with sensitive data:
- Use the sample dataset for testing
- Consider configuring AWS Bedrock for private model hosting, or other on-premise AI solutions
- Review your organization's data governance policies
- All queries and results are sent to the configured LLM provider

## 🛠️ Installation

### 1. Install Tableau MCP Server this will be on a separate machine.

```bash
git clone https://github.com/tableau/tableau-mcp.git
cd tableau-mcp
npm install
npm run build
```

### 2. Clone This Repository

```bash
git clone https://github.com/yourusername/tableau_mcp_tabby.git
cd tableau_mcp_tabby
```

### 3. Set Up Python Environment

```bash
# Create virtual environment
python -m venv .venv

# Activate it
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

## ⚙️ Configuration

### 1. Environment Setup

Copy the template and configure your settings:

```bash
cp .env_template .env
```

Edit `.env` with your credentials:

```env
# Tableau MCP Configuration
TABLEAU_MCP_HTTP_URL=http://localhost:3927/tableau-mcp

# Model Provider Configuration
MODEL_PROVIDER=openai          # Options: "openai" or "aws"
MODEL_USED=gpt-4               # Model name (e.g., "gpt-4", "gpt-4-turbo" for OpenAI)
MODEL_TEMPERATURE=0            # Temperature setting (0-2)

# OpenAI Configuration (required if MODEL_PROVIDER=openai)
OPENAI_API_KEY=your-openai-api-key

# AWS Bedrock Configuration (required if MODEL_PROVIDER=aws)
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
AWS_REGION=us-east-1           # AWS region where Bedrock is available
# AWS_SESSION_TOKEN=optional   # Only needed for temporary credentials

# Optional: Langfuse Observability
USE_LANGFUSE=false             # Set to "true" to enable Langfuse tracing
LANGFUSE_PUBLIC_KEY=your-public-key
LANGFUSE_SECRET_KEY=your-secret-key
LANGFUSE_HOST=https://us.cloud.langfuse.com
```

### 2. Model Provider Selection

Choose your LLM provider by setting `MODEL_PROVIDER`:

- **OpenAI** (`MODEL_PROVIDER=openai`): Requires `OPENAI_API_KEY`
  - Popular models: `gpt-5`, `gpt-4-turbo`, `gpt-3.5-turbo`
  
- **AWS Bedrock** (`MODEL_PROVIDER=aws`): Requires AWS credentials
  - Popular models: `anthropic.claude-3-sonnet-20240229-v1:0`, `anthropic.claude-3-5-sonnet-20241022-v2:0`
  - Ensure Bedrock is enabled in your AWS account and region

### 3. Callback Handler Configuration

Control tracing and logging behavior:

- **FileCallbackHandler** (default when `USE_LANGFUSE=false`): Writes traces to `.logs/agent_trace.jsonl`
- **Langfuse** (`USE_LANGFUSE=true`): Sends traces to Langfuse cloud for observability
- **None**: Disable callbacks by setting environment to neither option

### 2. Start Tableau MCP Server

**Important:** The MCP server must be running before starting the web application.

In the tableau-mcp directory:

```bash
# HTTP mode (required for this application)
npm run serve:http
```

The MCP server will start on port 3927 by default. Ensure it's accessible at the URL configured in your `.env` file (default: `http://localhost:3927/tableau-mcp`).

## 🏃‍♂️ Running the Application

### Development Mode

**Prerequisites:** Ensure the Tableau MCP server is running (see Installation step 2).

```bash
# Activate virtual environment (if not already active)
source .venv/bin/activate  # macOS/Linux
# or
.venv\Scripts\activate     # Windows

# Start the application
python web_app.py
```

Open your browser to `http://localhost:8000` and start chatting with your data!

### Production Deployment

⚠️ **Important:** This application uses in-memory session storage and is **NOT compatible with multi-worker deployments**. It has been verified to work with **single worker, multi-threaded** configurations on **Amazon Linux 2023**.

#### Deployment on Amazon Linux 2023 (EC2)

1. **Create a dedicated user:**

```bash
sudo useradd -m -s /bin/bash tabby-user
sudo su - tabby-user
```

2. **Clone and set up the application:**

```bash
git clone https://github.com/yourusername/tableau_mcp_tabby.git
cd tableau_mcp_tabby
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env_template .env
# Edit .env with your configuration
```

3. **Create systemd service file:**

Create `/etc/systemd/system/tabby.service`:

```ini
[Unit]
Description=Tableau Chatbot
After=network.target

[Service]
User=tabby-user
WorkingDirectory=/home/tabby-user/tableau_mcp_tabby
ExecStart=/home/tabby-user/tableau_mcp_tabby/venv/bin/gunicorn \
          --workers 1 \
          --threads 4 \
          --worker-class uvicorn.workers.UvicornWorker \
          --bind 0.0.0.0:8000 \
          --worker-connections 1000 \
          web_app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

4. **Enable and start the service:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable tabby
sudo systemctl start tabby
sudo systemctl status tabby
```

5. **View logs:**

```bash
sudo journalctl -u tabby -f
```

**Note:** The service uses `--workers 1` because session state is stored in-memory. For multi-worker support, you would need to implement shared session storage (Redis, SQLite, etc.).

### Dashboard Extension

1. Run the web app (above)
2. Open Tableau Desktop/Server
3. Create or open a dashboard
4. Add an Extension object
5. Choose "Local Extension" and select `dashboard_extension/tableau_langchain.trex`

## 💬 Example Queries

Try these natural language questions:

- "Show me the top 10 customers by sales"
- "What are the sales trends over the last 12 months?"
- "Which regions have negative profit?"
- "Compare Q1 vs Q2 performance"
- "Find outliers in the customer data"

## 🔧 Advanced Features

### Streaming Response Architecture

The application uses Server-Sent Events (SSE) to stream AI agent thoughts:

- **Backend**: FastAPI with streaming endpoints
- **Frontend**: JavaScript EventSource for real-time updates  
- **Agent**: LangGraph with custom streaming handlers

### Model Provider Abstraction

The application uses a flexible model provider system (`utilities/model_provider.py`) that makes it easy to add new LLM providers:

- **Extensible Design**: Add new providers by implementing a `_get_<provider>_llm()` function
- **Environment-based Configuration**: All provider settings managed via environment variables
- **Lazy Loading**: Provider libraries only imported when that provider is selected

### Error Handling Improvements

Enhanced error handling for common Tableau MCP issues:

- Schema validation errors
- Authentication timeouts (401 errors)
- Improved query parameter validation
- Provider-specific error messages

### Custom Styling

- Animated thinking indicators
- Cat favicon integration
- Responsive design with mobile support
- Smooth transitions between thinking steps and results

## 📁 Project Structure

```
tableau_mcp_tabby/
├── web_app.py              # Main FastAPI application
├── dashboard_app.py        # Dashboard extension version
├── static/                 # Frontend assets
│   ├── index.html         # Main UI
│   ├── script.js          # Streaming chat logic with SSE
│   ├── style.css          # Custom styling
│   └── favicon.ico        # Cat favicon 🐱
├── utilities/             
│   ├── chat.py            # Streaming response handlers
│   ├── prompt.py          # Agent system prompts and instructions
│   ├── model_provider.py  # LLM provider abstraction and initialization
│   └── logging_config.py  # Logging setup and configuration
├── dashboard_extension/   # Tableau extension files
│   └── tableau_langchain.trex  # Extension manifest
├── .env_template          # Environment variable template
├── requirements.txt       # Python dependencies
└── .logs/                 # Application logs (auto-created)
    ├── web_app.log        # Application logs
    └── agent_trace.jsonl  # Agent execution traces (if FileCallbackHandler enabled)
```

## 🐛 Troubleshooting

### Common Issues

**401 Authentication Errors:**
- Verify the Tableau MCP server is running and accessible at the configured URL
- Check that the MCP server has valid Tableau credentials configured
- Ensure Direct Trust with Connected Apps authentication is properly set up

**Model Provider Initialization Errors:**
- **OpenAI**: Verify `OPENAI_API_KEY` is set and valid
- **AWS Bedrock**: 
  - Verify `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` are set
  - Ensure Bedrock is enabled in your AWS account for the specified region
  - Check that your AWS credentials have `bedrock:InvokeModel` permissions
  - Verify the model ID matches a Bedrock-available model in your region

**Schema Validation Errors:**
- The app includes improved error handling for invalid Tableau functions
- Check the logs in `.logs/web_app.log` for detailed error information
- Review the agent's query attempts in `.logs/agent_trace.jsonl` (if FileCallbackHandler enabled)

**Streaming Not Working:**
- Ensure you're using a modern browser with EventSource support
- Check browser console for JavaScript errors
- Verify the `/chat/stream` endpoint is accessible
- Check that the MCP server is running before starting the web app

**Callback Handler Warnings:**
- If you see `FileCallbackHandler without a context manager` warnings, ensure you're using the latest version
- The application now properly manages callback handlers as context managers

**Service Won't Start (systemd):**
- Verify the `tabby-user` exists and has correct permissions
- Check that the virtual environment path is correct in `tabby.service`
- Ensure all dependencies are installed in the virtual environment
- Verify the working directory path matches your deployment location

## 🤝 Contributing

Contributions welcome! This project builds on the excellent foundation from The Information Lab. Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **[Will Sutton](https://github.com/wjsutton)** and **[The Information Lab](https://github.com/TheInformationLab)** for the original [tableau_mcp_starter_kit](https://github.com/TheInformationLab/tableau_mcp_starter_kit)
- **[Tableau MCP Team](https://github.com/tableau/tableau-mcp)** for the core MCP implementation
- **[LangChain](https://langchain.com/)** for the AI framework
- **[Tableau](https://tableau.com/)** for the analytics platform

## 🔗 Related Projects

- [Tableau MCP](https://github.com/tableau/tableau-mcp) - Core MCP server
- [Original Starter Kit](https://github.com/TheInformationLab/tableau_mcp_starter_kit) - Foundation project
- [Tableau MCP Experimental](https://github.com/wjsutton/tableau-mcp-experimental) - Advanced MCP tools

---

**⭐ If this project helps you analyze data more effectively, please give it a star!**

*Made with 🐱 and ☕ for the Tableau community*