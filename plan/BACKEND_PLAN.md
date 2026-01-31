# Backend Plan: AgentForge Kernel Stack

## Overview

The AgentForge backend is a high-performance FastAPI-based orchestration layer that manages the lifecycle of autonomous agents, the dynamic "Forge" tool-generation pipeline, and a secure E2B-powered execution environment. It leverages LangGraph for stateful workflows, Postgres (via pgvector) for semantic tool discovery, and a hot-reloading Tool Gateway that allows agents to extend their own capabilities without system restarts.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | /api/v1/agents/run | Initiates a task; triggers the LangGraph loop and potential Forge requests. |
| GET    | /api/v1/agents/{id}/state | Retrieves the current checkpoint, memory buffer, and recursion depth. |
| POST   | /api/v1/forge/request | Manual or agent-initiated "Dossier" submission to generate a new tool. |
| GET    | /api/v1/tools/search | Semantic search for existing tools using pgvector and SSI (Semantic Skill Index). |
| POST   | /api/v1/tools/register | Registers a validated tool artifact (code + spec) into the Registry. |
| GET    | /api/v1/registry/health | Returns status of the Tool Gateway and active Hot Buffer tools. |
| DELETE | /api/v1/sessions/{id} | Terminates an agent session and wipes the ephemeral E2B sandbox. |

## Services

1. **Core Orchestration Service (LangGraph)**
   - Manages the agent's "Plan-Act-Verify" loop.
   - Handles state persistence using PostgresSaver for long-running autonomous tasks.
   - Enforces hierarchical circuit breakers (max_depth, max_budget).
   - Integrates with OpenRouter API for LLM calls via configurable model IDs and per-model settings.

2. **Forge Node Service (The Toolsmith)**
   - Consumes "Convince Dossiers" to generate Python tool code via OpenRouter LLM (configurable model ID).
   - Executes Evidence-Based Validation (EBV): runs synthetic TDD tests in a sandbox.
   - Signs artifacts with content-addressed Merkle hashes for integrity.
   - Supports different OpenRouter models for different task phases (e.g., reasoning-heavy models for architecture, fast models for iteration).

3. **Tool Gateway & Registry**
   - Provides an out-of-process execution kernel using E2B sandboxes.
   - Maintains the "Hot Buffer": an L1 cache of frequently used tool hashes for sub-millisecond loading.
   - Implements Probabilistic Reliability Bounds (PRB) to rank tool selection based on historical success.

4. **Data & Vector Service (Postgres/pgvector)**
   - Stores tool manifests, docstrings, and usage telemetry.
   - Manages "Hybrid Memory": short-term conversation context + long-term vector-indexed experiences.

5. **OpenRouter Integration Service**
   - Manages OpenRouter API key and dynamic model configuration.
   - Provides abstraction layer for model selection, reasoning parameter management, and rate limiting.
   - Supports fallback to alternate models if primary model is unavailable.
   - Tracks per-model costs and performance metrics for cost optimization.

## Authentication

- **Strategy**: JWT-based Bearer Authentication for API access.
- **Internal Security**: Tool-to-Gateway communication uses scoped API keys with "Capability Permissions" (e.g., `net:none`, `fs:read-only`).
- **Sandbox Isolation**: Every tool execution occurs in a hardened E2B environment with strict resource quotas to prevent recursive resource exhaustion.

## OpenRouter Configuration

The backend integrates with OpenRouter to provide flexible, multi-model LLM capabilities. Configuration is managed via environment variables and stored in the Postgres configuration table:

```sql
CREATE TABLE openrouter_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT NOT NULL ENCRYPTED,
  default_model_id TEXT NOT NULL,  -- e.g., "openai/gpt-4-turbo"
  model_profiles JSONB,  -- {model_id: {reasoning_effort: "xhigh", temperature: 0.7, ...}}
  fallback_models TEXT[],  -- ["anthropic/claude-3-opus", "google/gemini-2.0-flash"]
  cost_limit_usd NUMERIC,
  rate_limit_rpm INT DEFAULT 60,
  created_at TIMESTAMP DEFAULT now()
);
```

**Usage:**
- Each component (Orchestrator, Forge Node) specifies a model_id when making LLM calls
- If model is unavailable, system falls back to configured alternatives
- Per-model reasoning parameters enable optimal cost/performance tradeoffs (e.g., `xhigh` reasoning for Forge, standard for iterative planning)

## Error Responses

```json
{
  "error": "FORGE_VALIDATION_FAILED",
  "message": "The generated tool failed synthetic test case #3 (Edge Case: Null Input).",
  "code": "422",
  "trace_id": "req_88291x_forge",
  "details": {
    "node": "Forge_Node_Alpha",
    "retry_suggested": true
  }
}
```

---
*Generated from boardroom plan*