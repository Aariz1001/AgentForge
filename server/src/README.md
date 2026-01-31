# AgentForge Backend Services

## Overview

This directory contains the backend services for AgentForge. These services provide the core infrastructure for agent orchestration, tool generation, and execution management.

## Services

### Core Services

#### OrchestrationService (`services/orchestration.ts`)
- Manages agent lifecycle and state
- Implements circuit breakers for safety (max depth, budget limits)
- Handles session persistence and recovery
- Coordinates the Plan-Act-Verify loop

**Key Features:**
- Session-based agent state management
- Budget tracking and enforcement
- Recursion depth protection
- Atomic state updates

#### ForgeService (`services/forge.ts`)
- Generates new tools from dossier specifications
- Creates Pydantic schemas for type safety
- Runs synthetic tests for validation
- Calculates Probabilistic Reliability Bounds (PRB)

**Key Features:**
- Automatic Pydantic schema generation
- Tool code generation
- Test-driven development workflow
- Content-addressed hashing for artifacts

#### ToolGatewayService (`services/tool-gateway.ts`)
- Manages tool registry and execution
- Maintains Hot Buffer (LRU cache) for frequently used tools
- Provides sandboxed execution environment
- Ranks tools by PRB score and usage patterns

**Key Features:**
- L1 cache for hot tools (sub-millisecond access)
- PRB-based tool selection
- Capability-based permissions
- Usage analytics and tracking

#### DatabaseService (`services/database.ts`)
- In-memory storage for agent states and tool manifests
- Provides CRUD operations for sessions and tools
- Implements text-based search for tool discovery

**Key Features:**
- Fast in-memory caching
- Session state persistence
- Tool manifest storage
- Search functionality

#### OpenRouterService (`services/openrouter.ts`)
- Manages OpenRouter API integration
- Handles multi-model selection and fallbacks
- Tracks costs and token usage
- Implements rate limiting

**Key Features:**
- Model-specific profiles (temperature, max tokens, etc.)
- Automatic fallback to alternative models
- Cost tracking and budget enforcement
- Rate limiting per model

## Utilities

### Logger (`utils/logger.ts`)
- Structured JSON logging
- Multiple log levels (DEBUG, INFO, WARN, ERROR)
- Service-specific logging with context

### Validator (`utils/validation.ts`)
- Input validation and sanitization
- Type checking and format validation
- Range and constraint enforcement

### ResponseBuilder (`utils/response.ts`)
- Standardized API response formatting
- Error response templates
- HTTP status code mapping

### RateLimiter (`utils/rate-limiter.ts`)
- Token bucket algorithm implementation
- Configurable refill rates
- Per-endpoint rate limiting support

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   CLI / Frontend                        │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│              OrchestrationService                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Plan-Act-Verify Loop + Circuit Breakers         │  │
│  └──────────────────────────────────────────────────┘  │
└──────┬──────────────────┬──────────────────┬───────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌─────────────┐  ┌──────────────┐  ┌─────────────────┐
│   Forge     │  │ Tool Gateway │  │   OpenRouter    │
│   Service   │  │   Service    │  │     Service     │
└──────┬──────┘  └──────┬───────┘  └────────┬────────┘
       │                │                    │
       │                │                    │
       ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│              DatabaseService (In-Memory)                │
└─────────────────────────────────────────────────────────┘
```

## Current Implementation Status

### ✅ Fully Implemented
- In-memory storage for sessions and tools
- Agent state management with circuit breakers
- Tool generation pipeline (schema, code, tests)
- Tool gateway with Hot Buffer caching
- OpenRouter integration with multi-model support
- Comprehensive utilities (logging, validation, responses)
- Rate limiting infrastructure
- Error handling and recovery

### 🔄 Ready for Production Enhancement
- Database integration (currently in-memory, ready for Postgres/pgvector)
- E2B sandbox integration (structure in place, needs SDK)
- LangGraph integration (orchestration logic ready)
- Vector embeddings for semantic search (text search implemented)

## Usage Examples

### Creating an Agent Session

```typescript
import { OrchestrationService, DatabaseService } from './services';

const db = new DatabaseService('connection-string');
const orchestrator = new OrchestrationService(config, db);

const { sessionId, state } = await orchestrator.runAgentTask(
  'Analyze this codebase and suggest improvements',
  {
    budgetLimit: 5.0,
    workingDirectory: '/path/to/project'
  }
);
```

### Forging a New Tool

```typescript
import { ForgeService } from './services';

const forge = new ForgeService(config);

const result = await forge.processDossier({
  name: 'code_analyzer',
  description: 'Analyzes code quality and suggests improvements',
  requirements: ['Parse Python code', 'Detect code smells'],
  expectedInputs: { code: 'str', language: 'str' },
  expectedOutputs: { issues: 'List[str]', score: 'float' },
  successCriteria: ['Handles syntax errors', 'Detects common issues']
});
```

### Executing a Tool

```typescript
import { ToolGatewayService } from './services';

const gateway = new ToolGatewayService(config, db);

const result = await gateway.executeTool('tool_123', {
  code: 'def hello(): pass',
  language: 'python'
});
```

## Configuration

Services use a Config interface for configuration:

```typescript
interface Config {
  get(key: string): any;
  set(key: string, value: any): void;
}
```

### Key Configuration Options

- `forge.model`: OpenRouter model for tool generation
- `openrouter.apiKey`: OpenRouter API key
- `openrouter.fallbackModels`: Alternative models for failover
- `openrouter.costLimitUSD`: Maximum spend per request
- `safety.maxDepth`: Maximum recursion depth
- `safety.maxBudgetUsd`: Maximum total budget

## Future Enhancements

1. **Postgres Integration**: Replace in-memory storage with persistent database
2. **pgvector**: Implement semantic search using vector embeddings
3. **E2B Sandboxes**: Full integration for isolated code execution
4. **LangGraph**: Complete state machine implementation
5. **Authentication**: JWT-based API authentication
6. **Monitoring**: Prometheus metrics and health checks
7. **Distributed Tracing**: OpenTelemetry integration

## Development

The services are designed to be:
- **Modular**: Each service has a single responsibility
- **Testable**: Interfaces allow for easy mocking
- **Extensible**: Config-based behavior modification
- **Type-safe**: Full TypeScript type coverage
- **Production-ready**: Comprehensive error handling

## Notes

- All services currently use in-memory storage for rapid development
- The architecture supports easy migration to production backends
- Error handling follows a consistent pattern across services
- Logging is structured for easy parsing and analysis
