# Tableau MCP Tabby 🐱

A streaming AI chat interface for Tableau data analysis, featuring real-time agent thinking steps and enhanced user experience. Built on the Tableau MCP (Model Context Protocol) with LangChain integration.

> **Credits:** This project is derived from [Will Sutton](https://github.com/wjsutton)'s excellent [tableau_mcp_starter_kit](https://github.com/TheInformationLab/tableau_mcp_starter_kit) created at [The Information Lab](https://github.com/TheInformationLab). The original work provided the foundation for Tableau MCP integration with LangChain.

## ✨ Key Features

- **🔄 Real-time Streaming**: Watch the AI agent think through your questions step-by-step
- **🐱 Personalized Interface**: Custom cat favicon and friendly UI
- **📊 Natural Language Queries**: Ask questions about your Tableau data in plain English
- **🎯 Smart Error Handling**: Improved schema validation and error recovery
- **📱 Responsive Design**: Works on desktop and mobile devices
- **🔧 Dashboard Extension**: Embed directly into Tableau dashboards

## 🚀 What Makes This Different

Unlike traditional chat interfaces that only show final results, Tableau MCP Tabby streams the agent's intermediate thinking steps in real-time:

```
🐱 Analyzing your request...
💭 I'll analyze this step by step: Identify the correct datasource...
💭 Inspecting schema to find the date field and visit counter...
💭 Querying the datasource to count visits for the last complete year...
📊 [Final results displayed]
```

## 📋 Prerequisites

- **Tableau Server 2025.1+** or **Tableau Cloud** ([Free trial available](https://www.tableau.com/en-gb/developer))
- **Python 3.12+** - [Download Python](https://python.org/downloads/)
- **Node.js 22.15.0 LTS** - [Download Node.js](https://nodejs.org/)
- **Git** - [Download Git](https://git-scm.com/downloads/)
- **OpenAI API Key** or other LLM provider credentials

## ⚠️ Data Privacy Notice

This application sends Tableau data to external AI models (OpenAI by default). For production use with sensitive data:
- Use the included Superstore sample dataset for testing
- Consider configuring a local/private AI model
- Review your organization's data governance policies

## 🛠️ Installation

### 1. Install Tableau MCP Server

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
# Tableau Configuration
SERVER='https://your-tableau-server.com'
SITE_NAME='YourSiteName'
PAT_NAME='YourPATName'
PAT_VALUE='YourPATSecret'

# AI Model
OPENAI_API_KEY='your-openai-api-key'

# Tableau MCP Path
TABLEAU_MCP_FILEPATH='/path/to/tableau-mcp/build/index.js'

# Optional: Langfuse Observability
LANGFUSE_PUBLIC_KEY='your-public-key'
LANGFUSE_SECRET_KEY='your-secret-key'
LANGFUSE_HOST='https://cloud.langfuse.com'
```

### 2. Start Tableau MCP Server

In the tableau-mcp directory:

```bash
# HTTP mode (recommended)
npm run serve:http

# Or stdio mode
npm run serve
```

## 🏃‍♂️ Running the Application

### Web Interface

```bash
python web_app.py
```

Open your browser to `http://localhost:8000` and start chatting with your data!

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

### Error Handling Improvements

Enhanced error handling for common Tableau MCP issues:

- Schema validation errors (invalid functions like "AGG")
- Authentication timeouts (401 errors)
- Rate limiting and concurrent request management
- Improved query parameter validation

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
│   ├── script.js          # Streaming chat logic
│   ├── style.css          # Custom styling
│   └── favicon.ico        # Cat favicon 🐱
├── utilities/             
│   ├── chat.py            # Streaming response handlers
│   ├── prompt.py          # Agent system prompts
│   └── logging_config.py  # Logging setup
├── dashboard_extension/   # Tableau extension files
└── requirements.txt       # Python dependencies
```

## 🐛 Troubleshooting

### Common Issues

**401 Authentication Errors:**
- Check your PAT credentials in `.env`
- Verify Tableau Server/Cloud connectivity
- Ensure your PAT has appropriate permissions

**Schema Validation Errors:**
- The app includes improved error handling for invalid Tableau functions
- Check the logs in `.logs/web_app.log` for detailed error information

**Streaming Not Working:**
- Ensure you're using a modern browser with EventSource support
- Check browser console for JavaScript errors
- Verify the `/chat/stream` endpoint is accessible

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