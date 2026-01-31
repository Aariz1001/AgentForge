# AgentForge CLI - Global Installation Guide

## Overview

AgentForge is a powerful autonomous AI agent system with a beautiful CLI interface and Python backend. This guide will help you set up the CLI for global use on your system.

## Prerequisites

- **Node.js** 18.0.0 or higher
- **npm** (comes with Node.js)
- **Python** 3.8 or higher (for the backend)
- **pip** (comes with Python)

## Quick Installation

### 1. Install the CLI Globally

```bash
# Navigate to the cli directory
cd cli

# Install globally using npm
npm install -g .
```

This will:
- Install all Node.js dependencies
- Set up the `agentforge` and `af` commands globally
- Make the CLI available from any directory

### 2. Install Backend Dependencies

```bash
# Navigate to the build directory
cd ../build

# Install Python dependencies
pip install -r requirements.txt
```

### 3. Configure API Key

```bash
# Set your OpenRouter API key
agentforge config set openrouter.apiKey YOUR_API_KEY_HERE
```

## Starting the System

### Start the Backend (Python)

```bash
# From the build directory
python src/main.py

# Or using pip to run as module
python -m src.main
```

The backend will start on `http://localhost:8000` with API docs at `http://localhost:8000/docs`

### Start the CLI (Node.js)

```bash
# From any directory, start an interactive chat session
agentforge chat

# Or use the shorthand
af chat
```

## Available Commands

### Main Commands

```bash
agentforge chat              # Start interactive chat with the agent
agentforge run <task>        # Execute a single task
agentforge tools             # List and manage tools
agentforge forge             # Generate new tools with AI
agentforge config            # Manage configuration
agentforge status            # Check system status
```

### Configuration Commands

```bash
agentforge config set <key> <value>    # Set a configuration value
agentforge config get <key>             # Get a configuration value
agentforge config list                  # List all configurations
```

### Short Aliases

```bash
af c                         # Shorthand for 'agentforge chat'
af r <task>                  # Shorthand for 'agentforge run'
af t                         # Shorthand for 'agentforge tools'
af f                         # Shorthand for 'agentforge forge'
```

## Verification

### Verify CLI Installation

```bash
# Check the CLI version
agentforge --version

# Display help information
agentforge --help

# Check system status
agentforge status
```

### Verify Backend Installation

```bash
# From the build directory, test the API
curl http://localhost:8000/health

# View API documentation
# Visit http://localhost:8000/docs in your browser
```

## Updating Display Settings

The CLI uses a beautiful color theme with:
- **Primary Colors**: Cyan (#00D9FF) and Lime Green (#00FF7F)
- **Accent Colors**: Red (#FF6B6B), Gold (#FFD700), Green (#00FF7F)
- **Font**: ANSI Shadow (figlet)

All output uses the elegant 3D text rendering with gradient effects.

## System Architecture

```
AgentForge System
├── CLI (Node.js)
│   ├── Interactive Chat
│   ├── Tool Management
│   ├── Configuration
│   └── Beautiful Terminal UI
│
└── Backend (Python)
    ├── FastAPI Server
    ├── Agent Orchestrator
    ├── Tool Gateway
    ├── Memory System
    └── OpenRouter Integration
```

## Troubleshooting

### CLI Not Found After Installation

If the `agentforge` command is not recognized:

1. **On Windows**: The PATH environment variable might need to be refreshed
   ```powershell
   # Open a new PowerShell window to refresh PATH
   # Or restart your terminal application
   ```

2. **On macOS/Linux**: Ensure npm's global bin directory is in PATH
   ```bash
   # Check where npm installs globals
   npm config get prefix
   
   # Add to PATH if needed (add to ~/.bashrc or ~/.zshrc)
   export PATH="$(npm config get prefix)/bin:$PATH"
   ```

### Python Backend Issues

If the backend fails to start:

```bash
# Verify Python is installed
python --version

# Verify all dependencies are installed
pip show -f $(cat requirements.txt | cut -d'=' -f1)

# Try installing with upgrade flag
pip install --upgrade -r requirements.txt
```

### OpenRouter API Key Issues

1. Verify the API key is set:
   ```bash
   agentforge config get openrouter.apiKey
   ```

2. Get a new API key from https://openrouter.ai/

3. Update the configuration:
   ```bash
   agentforge config set openrouter.apiKey NEW_KEY
   ```

## Project Structure

```
AgentForge/
├── cli/                          # Node.js CLI Application
│   ├── src/
│   │   ├── index.js             # Main entry point
│   │   ├── components/          # UI components
│   │   ├── services/            # Backend integration
│   │   ├── tools/               # Tool definitions
│   │   └── utils/               # Display utilities
│   ├── package.json
│   └── agentforge.bat          # Windows wrapper
│
├── build/                        # Python Backend
│   ├── src/
│   │   ├── main.py             # FastAPI application
│   │   ├── core/               # Configuration, safety
│   │   ├── models/             # Database models
│   │   ├── services/           # Agent services
│   │   └── utils/              # Utilities
│   ├── requirements.txt
│   └── schema.sql
│
└── plan/                         # Documentation
    ├── ARCHITECTURE.md
    ├── DATABASE_DESIGN.md
    ├── SYSTEMS_DESIGN.md
    └── TASKS.json
```

## Next Steps

1. **Explore Tools**: Use `agentforge tools` to see available tools
2. **Create Custom Tools**: Use `agentforge forge` to generate new tools
3. **Configure Advanced Settings**: Edit configuration for model preferences
4. **Integration**: Connect AgentForge to your applications via the Python API

## Support

For issues, questions, or contributions, please refer to the documentation in the `plan/` directory:
- Architecture overview: `plan/ARCHITECTURE.md`
- System design: `plan/SYSTEMS_DESIGN.md`
- Database design: `plan/DATABASE_DESIGN.md`

## License

MIT License - See LICENSE file for details
