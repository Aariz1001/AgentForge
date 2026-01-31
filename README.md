# AgentForge 🔥

**A Truly Autonomous AI Agent System with Self-Evolving Architecture**

AgentForge is an advanced TypeScript/Node.js CLI agent that goes beyond task execution. It can autonomously evolve its own architecture, generate dynamic tools, maintain persistent hierarchical memory across sessions, and execute sophisticated multi-agent workflows. Built on OpenRouter, it supports 300+ models with intelligent fallback strategies.

## ✨ Core Features

**🤖 Autonomous Execution**
- LLM-powered agent with streaming responses
- Plan-Act-Verify loops for complex tasks
- Session persistence with cost tracking
- Context-aware memory summaries across sessions

**🔧 Dynamic Tool Generation (ToolForge)**
- Autonomously generates new tools from natural language descriptions
- Supports single tools and multi-tool Toolkits
- Automatic tool registration and semantic search
- Reasoning-enabled code generation (Kimi-k2.5 fallback to Claude 3.5)

**🧠 Hierarchical Experience Memory**
- **Three-tier architecture**: Working → Episodic → Semantic
- Vector-based similarity search for cross-session analogical reasoning
- Background consolidation jobs compress observations into beliefs
- Prevents catastrophic forgetting while reducing noise

**🛠️ ComponentForge (Self-Improving Architecture)**
- Audits core services (Memory, Middleware, Swarm Orchestration)
- Suggests architectural improvements with technical justification
- Interactive "Accept/Steer/Reject" loop for guided evolution
- Implements approved changes directly to codebase

**📱 Specialized Toolkits**
- **Virtual Phone Controller**: ADB-based device automation, emulator boot, APK installation, UI automation, screenshots
- Extensible architecture for domain-specific toolkits

**🔗 OpenRouter + 300+ Models**
- Seamless model switching with automatic fallback
- Reasoning model support (Kimi-k2.5, O1-preview)
- Cost optimization strategies

**📦 Built-in Tool Foundation**
- grep, glob, read, write, edit, shell, env, package
- Pattern matching for past successes
- All outputs are minimal (1-2 lines)

**🔒 Safety & Reliability**
- Code sanitization (blocks destructive patterns)
- Budget limits per session
- Rate limiting and exponential backoff
- Graceful degradation (no backend → local generation)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+ (for backend)
- PostgreSQL with pgvector (optional, for tool registry)
- Redis (optional, for caching)

### Installation

**Local Development:**
```bash
# Clone the repository
git clone https://github.com/yourusername/agentforge.git
cd agentforge/cli

# Install dependencies
npm install

# Configure
cp .env.template .env
# Edit .env with your OpenRouter API key
```

**Global Installation:**
```bash
# Install globally from the CLI directory
cd agentforge/cli
npm install -g .

# Or directly link for development
npm link

# Now use from anywhere on your system!
agentforge chat
# or use the shorthand
af chat
```

### Basic Usage

**Globally installed:**
```bash
# Start interactive chat
agentforge chat
# or
af chat

# Quick help
af --help

# Check version
af --version
```

**Local development:**
```bash
# Run the CLI
npm start

# Start interactive chat
npm run chat

# List available tools
node src/index.js tools

# Generate a new tool
node src/index.js forge

# Check system status
node src/index.js status
```

## 📖 CLI Commands

### `agentforge chat`

Start an interactive chat session with the AI agent.

```bash
agentforge chat [options]

Options:
  -m, --model <model>   OpenRouter model ID
  -s, --session <id>    Resume a previous session
  --no-stream           Disable streaming responses
```

**In-chat commands:**
- `/exit` - Exit the session
- `/clear` - Clear screen
- `/tools` - List available tools
- `/forge <description>` - Generate a new tool
- `/swarm <task>` - Run swarm mode (multi-agent planning + plan artifacts)
- `/help` - Show help

### `agentforge tools`

Browse and manage registered tools.

```bash
agentforge tools [options]

Options:
  -l, --list            List all tools
  -s, --search <query>  Search tools by name
  -i, --info <hash>     Show tool details
```

### `agentforge forge`

Generate new tools using ToolForge.

```bash
agentforge forge [options]

Options:
  -i, --interactive      Interactive wizard (Single Tool or Toolkit mode)
  -a, --audit            Audit current toolset and get improvement suggestions
```

When you run `forge -i`, you can:
- **Create Single Tools**: Generate standalone tools for specific tasks
- **Create Toolkits**: Build multi-tool collections (e.g., Virtual Phone Controller) stored in subdirectories
- **Define Constraints**: Specify dependencies, platforms, or limitations
- **Define Domain**: Tag your toolkit with a domain for better categorization

### `agentforge component`

Audit and evolve core architecture using ComponentForge.

```bash
agentforge component [options]

Options:
  (no options - interactive session)
```

ComponentForge will:
1. Scan your server and CLI services
2. Consult the LLM architect for improvement suggestions
3. Present recommendations with technical reasoning
4. Let you Accept, Steer, or Reject each proposal
5. Implement approved changes directly

### `agentforge config`

Manage configuration settings.

```bash
agentforge config [options]

Options:
  -s, --set <key=value>  Set a value
  -g, --get <key>        Get a value
  -l, --list             List all config
  --setup                Run setup wizard
```

### `agentforge run`

Execute a single task.

```bash
agentforge run <task> [options]

Options:
  -m, --model <model>    OpenRouter model ID
  -v, --verbose          Verbose output
```

## 🧠 Memory System

AgentForge uses a **three-tier hierarchical memory architecture** inspired by cognitive science:

### Working Memory
- Short-term conversational context
- Current session's observations
- Active reasoning states
- TTL-based expiration (automatic pruning)

### Episodic Memory
- Specific events and interactions
- Tool execution results
- Task completions with outcomes
- Tagged with timestamps and relations

### Semantic Memory
- Consolidated beliefs and patterns
- General knowledge extracted from episodes
- Vector-embedded for similarity search
- Background consolidation prevents catastrophic forgetting

**How It Works:**
1. New observations enter as **episodic** memories
2. A background `ConsolidationScheduler` runs every 5 minutes
3. High-importance episodic events are promoted to **semantic** memories
4. Semantic memories are compressed into structured beliefs
5. Vector search enables cross-session analogical reasoning

This allows AgentForge to:
- Remember successful strategies from past sessions
- Recognize similar problems and apply learned solutions
- Evolve its understanding over time
- Avoid repeating mistakes

## 🛠️ Built-in Tools

| Tool | Description | Output Example |
|------|-------------|----------------|
| `grep` | Search patterns in files | `Found 42 matches in 3 files` |
| `glob` | Find files by pattern | `Matched 15 files for **/*.js` |
| `read` | Read file contents | `Read lines 1-50 of file.js` |
| `write` | Write to files | `Wrote to file.js (+15, -10)` |
| `edit` | Surgical edits | `Edited file.js (+2)` |
| `shell` | Execute commands | `$ npm install → Exit 0` |
| `env` | Manage environments | `Activated python env at ./venv` |
| `package` | Install packages | `Installed 3 package(s) via npm` |

## 🔥 Toolsmith - Dynamic Tool Generation

The Toolsmith (Forge) mechanism allows the agent to generate new tools on-demand:

```
You: Create a tool to convert markdown to HTML

Agent: I'll forge a new tool for that.

🔥 Forging new tool: markdown_to_html
   Hash: 7a8b9c...

✓ Tool forged successfully and registered!
```

Generated tools are:
- **Validated** - Synthetic tests are generated and run
- **Sanitized** - Security checks prevent dangerous code
- **Registered** - Stored with semantic search for reuse

## 🛠️ Specialized Toolkits

### Virtual Phone Controller

Automate Android devices and emulators with surgical precision:

```bash
# Boot an emulator
agentforge run "Boot the Android emulator and wait for it to fully load"

# Install and interact
agentforge run "Install WhatsApp on the emulator and capture a screenshot of the home screen"

# Automate UI interactions
agentforge run "Tap on Settings, scroll to About Phone, and capture proof of the device model"
```

**Included Components:**
- **DeviceOrchestrator**: Emulator lifecycle management, APK installation, device health checks
- **VisualInterface**: Tap, swipe, text input, keyevent execution, screenshot capture
- **SystemRelay**: Deep shell command execution with port forwarding and security checks

**Requirements:**
- Android SDK with emulator (`$ANDROID_HOME` configured)
- ADB in PATH
- For physical devices: USB debugging enabled

## 🏗️ Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    AgentForge CLI (TypeScript)                │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │   Chat       │  │   ToolForge  │  │  ComponentForge    │   │
│  │  Session     │  │   (Toolsmith)│  │   (Architect)      │   │
│  └──────────────┘  └──────────────┘  └────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │           CLI Tool Registry (Dynamic Loading)            │ │
│  │  - Pattern_Matcher.ts (Session analysis)                 │ │
│  │  - Virtual_Phone_Controller/* (Device automation)        │ │
│  │  - User-forged tools (dynamically generated)             │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │               Memory Subsystem (TypeScript)              │ │
│  │  - Working Memory (in-memory, TTL-based)                 │ │
│  │  - Vector Store (cosine similarity search)               │ │
│  │  - Hierarchy Manager (Episodic→Semantic promotion)       │ │
│  │  - Consolidation Scheduler (background jobs)             │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────┬────────────────────────────────────────┘
                       │ REST/Stream
┌──────────────────────▼─────────────────────────────────────────┐
│              AgentForge Backend (TypeScript/Express)           │
│  ┌──────────────────┐  ┌────────────────────────────────────┐  │
│  │  OpenRouter      │  │      Forge Service                 │  │
│  │  Client          │  │  (Kimi-k2.5 + Fallback)            │  │
│  └──────────────────┘  └────────────────────────────────────┘  │
│  ┌──────────────────┐  ┌────────────────────────────────────┐  │
│  │ Swarm            │  │  Tool Gateway                      │  │
│  │ Orchestrator     │  │  (Execution & Isolation)           │  │
│  └──────────────────┘  └────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         Services: Database, Memory, Todo Registry        │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## ⚙️ Configuration

### CLI Configuration

Create `~/.agentforge/config.json` or set environment variables:

```bash
# Required
OPENROUTER_API_KEY=sk-or-v1-...

# Optional
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
OPENROUTER_REASONING_ENABLED=true
AGENTFORGE_BACKEND_URL=http://localhost:3000
AGENTFORGE_MAX_SESSION_COST=50.00
```

### Backend Configuration

The backend loads from environment variables:

```bash
# OpenRouter
OPENROUTER_API_KEY=sk-or-v1-...

# Server
PORT=3000
NODE_ENV=development

# Memory
VECTOR_STORE_PATH=./data/vectors.json
MEMORY_CONSOLIDATION_INTERVAL=300000  # ms (5 min default)

# Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=60000  # ms
```

## 🚀 Installation & Setup

### Prerequisites

- **Node.js 18+** - For CLI and backend
- **TypeScript 5.3+** - Already included
- **OpenRouter API Key** - Get free trial at [openrouter.ai](https://openrouter.ai)
- **Android SDK** (optional) - Only for Virtual Phone Controller
- **ADB** (optional) - For device automation

### Step 1: Clone & Install

```bash
git clone https://github.com/yourusername/agentforge.git
cd agentforge

# Install root dependencies
npm install

# Install CLI dependencies
cd cli && npm install && cd ..

# Install server dependencies
cd server && npm install && cd ..
```

### Step 2: Configuration

```bash
# Create CLI config directory
mkdir -p ~/.agentforge

# Run setup wizard
npm start config --setup
```

Or manually create `~/.agentforge/config.json`:

```json
{
  "openrouter.apiKey": "sk-or-v1-...",
  "openrouter.model": "anthropic/claude-4.5-sonnet",
  "openrouter.maxTokens": 8000,
  "openrouter.reasoning.enabled": false
}
```

### Step 3: Run the Agent

**Quick start (CLI only, local generation):**
```bash
npm run chat
# or globally
agentforge chat
```

**With backend (recommended for production):**
```bash
# Terminal 1: Start backend
npm run start:server

# Terminal 2: Start CLI
npm run start:cli
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- shell-output.test.ts

# Watch mode (development)
npm test -- --watch
```

## 📁 Project Structure

```
AgentForge/
├── cli/                              # TypeScript CLI (Node.js)
│   ├── src/
│   │   ├── index.ts                  # CLI entry point & commander setup
│   │   ├── components/
│   │   │   ├── ChatSession.ts        # Main chat loop & session manager
│   │   │   ├── ForgeUI.ts            # ToolForge interactive wizard
│   │   │   ├── ComponentForge.ts     # Architecture auditor & improver
│   │   │   └── ToolRegistry.ts       # Tool discovery & listing
│   │   ├── services/
│   │   │   ├── BackendClient.ts      # OpenRouter SDK wrapper
│   │   │   ├── ConfigManager.ts      # Settings persistence
│   │   │   ├── SessionManager.ts     # Session history
│   │   │   └── MCPClient.ts          # Model Context Protocol
│   │   ├── tools/
│   │   │   ├── index.ts              # Dynamic tool registry (Proxy-based)
│   │   │   ├── chunk.ts              # File chunking utility
│   │   │   ├── diff.ts               # Git diff analysis
│   │   │   ├── git.ts                # Git operations
│   │   │   ├── refactor.ts           # Code refactoring
│   │   │   ├── search.ts             # Pattern search
│   │   │   ├── test.ts               # Test execution
│   │   │   ├── Pattern_Matcher.ts    # Session history pattern detection
│   │   │   └── Virtual_Phone_Controller/
│   │   │       ├── DeviceOrchestrator.ts   # Emulator lifecycle
│   │   │       ├── VisualInterface.ts      # UI automation
│   │   │       └── SystemRelay.ts          # Command execution
│   │   └── utils/
│   │       └── display.ts            # Terminal UI helpers
│   ├── bin/
│   │   ├── cli.cjs                   # Global CLI entry
│   │   └── cli.js
│   ├── package.json                  # CLI dependencies
│   └── tsconfig.json
│
├── server/                           # TypeScript Backend (Express)
│   ├── src/
│   │   ├── main.ts                   # Express app setup
│   │   ├── core/
│   │   │   └── config.ts             # Backend configuration
│   │   ├── models/
│   │   │   ├── database.ts           # Database client
│   │   │   └── schema.ts             # TypeORM entities
│   │   ├── services/
│   │   │   ├── openrouter.ts         # LLM API client
│   │   │   ├── forge.ts              # Tool generation engine
│   │   │   ├── orchestration.ts      # Swarm orchestrator
│   │   │   ├── swarm-agent.ts        # Individual agent logic
│   │   │   ├── swarm-orchestrator.ts # Multi-agent coordination
│   │   │   ├── swarm-types.ts        # Type definitions
│   │   │   ├── plan-writer.ts        # Plan formatting
│   │   │   ├── shared-memory.ts      # In-memory shared state
│   │   │   ├── todo-registry.ts      # Task tracking
│   │   │   ├── tool-gateway.ts       # Tool execution sandbox
│   │   │   └── database.ts           # DB operations
│   │   ├── memory/
│   │   │   ├── vector-store.ts       # Vector embeddings & similarity
│   │   │   ├── hierarchy-manager.ts  # Episodic→Semantic promotion
│   │   │   └── consolidation-scheduler.ts # Background memory jobs
│   │   └── utils/
│   │       ├── logger.ts             # Winston logger
│   │       ├── rate-limiter.ts       # Request throttling
│   │       ├── response.ts           # Response formatting
│   │       ├── index.ts              # Utilities export
│   │       └── validation.ts         # Input validation
│   ├── package.json                  # Backend dependencies
│   └── tsconfig.json
│
├── plan/                             # Design & planning docs
│   ├── PLAN.md                       # Project roadmap
│   ├── ARCHITECTURE.md               # System design
│   ├── BACKEND_PLAN.md               # Backend details
│   ├── FRONTEND_PLAN.md              # CLI/TUI details
│   ├── DATABASE_DESIGN.md            # Schema & models
│   ├── SYSTEMS_DESIGN.md             # Integration design
│   └── INTEGRATION_test.md           # Test plan
│
├── .gitignore                        # Git exclusions
├── package.json                      # Root package manifest
├── tsconfig.json                     # Root TypeScript config
├── declarations.d.ts                 # Global type declarations
├── INSTALLATION.md                   # Installation guide
└── README.md                         # This file
```

## 🔐 Safety & Security Features

**Code Sanitization**
- Blocks dangerous patterns: `rm -rf /`, `dd if=`, `fastboot flash`, database deletion, etc.
- Prevents code injection in generated tools
- Validates file paths and prevents directory traversal

**Execution Isolation**
- Tool execution runs with timeout limits (default 30s)
- Memory usage constraints
- No access to system credentials or secrets

**Budget Controls**
- Per-session cost tracking
- Maximum spend caps (configurable)
- Real-time token/cost calculation

**Rate Limiting**
- Request throttling (100 req/min default)
- Exponential backoff on failures
- Circuit breaker pattern for cascading failures

**Session Security**
- Encrypted session storage
- API key isolation per session
- Automatic session cleanup after inactivity

## 🤝 Contributing

We welcome contributions! Here's how:

1. **Fork** the repository
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit changes**: `git commit -m 'Add amazing feature'`
4. **Push to branch**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

### Development Workflow

```bash
# Run in watch mode for rapid iteration
npm run dev:cli

# Type-check without running
npm run build

# Format code
npm run lint:fix
```

### Before Submitting PR

- [ ] TypeScript compiles without errors: `npm run build`
- [ ] Tests pass: `npm test`
- [ ] Code follows project style (2-space indent, no semicolons in exports)
- [ ] Commit messages are clear and descriptive

## 📊 Performance & Scalability

### Current Performance

- **Tool Generation**: ~10-30s (depending on model and complexity)
- **Memory Consolidation**: ~100-500ms per job (background task)
- **Vector Search**: <5ms for similarity lookup
- **Session Resume**: <100ms

### Scaling Considerations

- **Vector Store**: Replace in-memory store with Pinecone/Qdrant for 1M+ vectors
- **Database**: Use PostgreSQL with pgvector for semantic search
- **Caching**: Add Redis layer for frequently accessed tools
- **Swarm Agents**: Deploy multiple agents via Docker containers

## 🐛 Troubleshooting

**"No allowed providers available for the selected model"**
- Your OpenRouter account may not have access to certain models
- Switch to `anthropic/claude-4.5-sonnet` (always available)
- Check account tier at openrouter.ai

**"ADB not found" (Virtual Phone Controller)**
- Ensure Android SDK is installed
- Add `$ANDROID_HOME/platform-tools` to PATH
- Run `adb devices` to verify connection

**"Session cost exceeds budget"**
- Reduce `maxTokens` in config
- Use cheaper models (gpt-3.5 instead of gpt-4)
- Break large tasks into smaller sessions

**Memory consolidation not running**
- Check backend is running: `curl http://localhost:3000/health`
- Verify `MEMORY_CONSOLIDATION_INTERVAL` is set
- Check logs: `tail ~/.agentforge/logs/*.log`

## 📈 Roadmap

**Q1 2026**
- [ ] VS Code extension for IDE integration
- [ ] Multi-agent collaboration (Swarm mode enhancements)
- [ ] Persistent vector store with SQL backend

**Q2 2026**
- [ ] Browser UI dashboard (monitoring & analytics)
- [ ] Plugin system for domain-specific agents
- [ ] Automated performance tuning

**Q3 2026**
- [ ] Mobile app companion
- [ ] Enterprise auth (SAML, OAuth2)
- [ ] Advanced audit logging

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

- **OpenRouter** - Multi-model LLM access
- **TypeScript Community** - Type-safe development
- **OpenAI/Anthropic/Kimi** - Language models
- Built with ❤️ for the future of autonomous AI

---

## 📞 Support & Community

- **Issues**: [GitHub Issues](https://github.com/yourusername/agentforge/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/agentforge/discussions)
- **Twitter**: [@AgentForgeAI](https://twitter.com)
- **Email**: aarizwaqqas3@gmail.com

---

**Last Updated**: January 2026
**Status**: Active Development ⚡
