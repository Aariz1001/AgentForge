# Frontend Plan: AgentForge CLI Terminal Interface

## Overview

The AgentForge Frontend is a real-time Node.js-based CLI terminal interface designed for monitoring autonomous agent loops, visualizing the "Toolsmith" genesis process, and managing the Tool Registry. It provides a high-transparency view into the LangGraph state machine directly in the terminal, allowing users to inspect the "Convince" dossiers sent to Forge Nodes and the resulting hot-reloadable artifacts. The agent lives entirely in the terminal with immersive real-time visualization, prioritizing observability of the recursive sub-graph protocol (RSGP) and safety circuit breakers.

## Terminal Screens/Views

1. **Agent Command Center (Main View)** - A multi-pane terminal layout featuring a real-time "Execution Trace" stream (top-right), a live ASCII-art LangGraph visualization (center-left) showing active nodes, and a "Forge Monitor" (bottom) displaying tool-generation progress with animated spinners and status indicators.
2. **Tool Registry & SSI Explorer** - An interactive terminal-based searchable library with vim-like navigation. Displays all registered tools with Semantic Skill Index (EBV-SSI) ratings, tool reliability scores (PRB), Pydantic schemas in formatted JSON, and content-hash IDs. Uses cursor navigation and fuzzy search.
3. **Forge Laboratory (Settings/Config)** - Interactive terminal form for configuring the OpenRouter API integration. Users input their OpenRouter API key, then select or input any model ID available on OpenRouter (e.g., `openai/gpt-4`, `google/gemini-2.0-flash`, `deepseek/deepseek-chat`). For each model selected, users can enable/disable model-specific features such as reasoning parameters (effort level, type), context length overrides, temperature settings, and system prompt variations. Configurations persist as JSON profiles for quick switching between model setups. Also includes safety rail thresholds (max depth, budget limits, timeout settings) and environment caching policies. Features a "Manual Forge" trigger menu for human-in-the-loop tool requests with confirmation prompts.
4. **Validation Reports (Results)** - Real-time terminal output breakdown of tool generation attempts, including synthetic test results, sanitization logs from @Kimi's safety rails, and "Shadow State" commit logs. Pageable with colored output for pass/fail status.

## Terminal Components

- **ASCIIGraphRenderer**: ASCII-art LangGraph visualization using box-drawing characters to show active nodes, transitions, and state flow in real-time.
- **DossierInspector**: A fullscreen modal view to inspect markdown-structured dossiers sent by the agent to request new tools, with syntax highlighting.
- **LiveLogStream**: A streaming text buffer with color-coded output (success, warning, error, info) from the Gateway execution kernel using Chalk.js for styling.
- **ReliabilityBadge**: A colored status indicator (🟢 Green/🟡 Gold/🔴 Red) for the Probabilistic Reliability Bound (PRB) of a tool with numeric score.
- **CircuitBreakerStatus**: A persistent top-bar widget showing current depth/budget consumption against global limits with progress bars using Unicode box characters.
- **ToolCard**: A compact terminal listing displaying tool name, semantic docstring, and Merkle-hash version with color-coded reliability status.

## User Flows

1. **Agent Autonomy Loop**: User starts the CLI with a goal → Agent processes in split-pane terminal (left: LangGraph, right: live logs) → Agent identifies missing capability → Animated "FORGE" message appears → Tool is generated/validated in real-time → Agent resumes with new capability displayed in graph.
2. **Tool Auditing**: User presses `T` in main view to toggle Tool Registry → Uses arrow keys to navigate → Presses `ENTER` to inspect a tool → Fullscreen modal displays generated Python source code and synthetic test suite with syntax highlighting → Press `Q` to return.
3. **Safety Intervention**: Circuit breaker triggers due to budget overrun → Alert banner flashes at top in red with warning message → User sees interactive menu: `[I]njection Credits`, `[P]rune Graph`, or `[T]erminate Session` → User presses key to choose action.

## Design System

- **Color Palette**:
    - **Primary Accent**: #00D9FF (Cyan Blue - Agent actions, active states)
    - **Secondary Accent**: #00FF7F (Spring Green - Success, validation, tool creation)
    - **Background**: #0A0A0A (Pure Black - Terminal background)
    - **Text Primary**: #FFFFFF (White - Main text, headings)
    - **Text Secondary**: #B0B0B0 (Light Gray - Secondary info, descriptions)
    - **Alerts/Status**: #FF6B6B (Error Red), #00FF7F (Success Green), #FFD700 (Warning Gold)

- **Typography**:
    - **Title**: 3D ASCII art text using `figlet` or similar library with `banner` style (creates depth illusion)
    - **Section Headers**: Bold uppercase with box-drawing characters for visual hierarchy
    - **Body Text**: Monospace (Courier New / Courier) for logs and data
    - **Callouts**: Indented with special Unicode characters (▸, ▹, ►, etc.)

- **Terminal Layout**:
    - **Terminal Width**: Optimized for 120-180 character width (auto-adapt to smaller screens)
    - **Padding**: 1 space margin around content areas
    - **Separators**: Box-drawing characters (─, │, ┌, ─, ┐, └, ┘, ├, ┤, ┬, ┴, ┼)
    - **Status Bars**: Single-line footers with progress indicators using Unicode blocks (▁▂▃▄▅▆▇█)

- **Interactive Elements**:
    - **Selection Highlight**: Inverse video (white text on cyan background) for focused items
    - **Progress**: Animated spinners (⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏) or bars (░░░░░░░░░░ → ████░░░░░░)
    - **Cursor**: Blinking ▊ indicator for input fields

## Model Provider Configuration

**OpenRouter Integration**: The CLI uses OpenRouter as the primary model provider, allowing users to leverage any model available on the platform without vendor lock-in. Users configure OpenRouter by:

1. Entering their OpenRouter API key in the Forge Laboratory settings
2. Selecting or manually entering any OpenRouter model ID (e.g., `openai/gpt-4-turbo`, `anthropic/claude-3-opus`, `google/gemini-2.0-flash`, `deepseek/deepseek-chat`, `mistral/mistral-large`, etc.)
3. Enabling model-specific configurations per model:
   - **Reasoning Parameters**: effort level (`xhigh`, `high`, `medium`), reasoning type
   - **Context Windows**: Override default token limits
   - **Temperature & Sampling**: Creativity vs. determinism tuning
   - **System Prompt Variants**: Different persona configurations per model
   - **Rate Limiting**: Per-model rate limit settings
4. Saving configurations as named profiles (e.g., "Fast Iteration", "Deep Reasoning", "Cost-Optimized")
5. Switching between profiles at runtime with hotkeys

Each board member can be assigned a specific OpenRouter model ID and configuration profile, enabling heterogeneous multi-model council discussions with different models optimized for their expertise roles.

---

*Generated from boardroom plan*