# Systems Design: AgentForge Kernel Stack

## Technical Specifications

AgentForge is architected as a high-availability, stateful agentic system composed of four primary layers:

- **Orchestration Layer (LangGraph):** Manages the agentic loop, state persistence, and the "Convince" dossier logic for tool requests.
- **The Forge Node (Tool Generation):** A specialized subgraph that performs contract-first TDD. It generates Pydantic-validated Python code, executes synthetic test suites in isolated E2B sandboxes, and signs artifacts.
- **The Tool Gateway (Execution):** An out-of-process kernel that loads tool artifacts from the Registry. It uses `importlib` or dynamic execution within a secure sandbox to run tools without restarting the main process.
- **Persistence & Discovery (Postgres + pgvector):** Stores tool metadata, content-hashed source code, and vectorized docstrings for RAG-based tool discovery and "Active Stack" caching.

## Data Flow

1. **Input Processing**: The User Intent is analyzed by the Orchestrator via OpenRouter LLM call (using configured model_id). The Semantic Skill Index (SSI) is queried via vector search to identify existing tools. If a gap is identified, the agent generates a Tool Request Dossier.
2. **Core Logic**:
   - **Forge Phase**: The Forge Node receives the Dossier, calls OpenRouter with the Forge model configuration (often reasoning-heavy), generates a Pydantic schema, writes the tool code, and runs synthetic tests.
   - **Validation Phase**: Upon passing tests, the tool is hashed (Merkle-style) and registered in the Database with a Probabilistic Reliability Bound (PRB) score.
   - **Execution Phase**: The Gateway retrieves the artifact, checks capability permissions, and executes the tool in a locked E2B environment.
3. **Output Generation**: Results are committed to the Atomic Shadow-State. If successful, the state is merged into the main graph; if the tool fails, a circuit breaker triggers a retry or a Forge refinement loop using an alternate OpenRouter model if configured.

## Interfaces

### Public API

```python
class AgentForge:
    async def run(self, task_description: str, budget_limit: float = 1.0):
        """
        Main entry point for autonomous task execution.
        :param task_description: Natural language goal
        :param budget_limit: Maximum USD spend before circuit breaker
        """
        pass

    def register_manual_tool(self, func: Callable, schema: dict):
        """Registers a predefined tool into the Registry."""
        pass

    async def get_tool_stats(self, tool_id: str) -> dict:
        """Returns PRB (Probabilistic Reliability Bound) and usage history."""
        pass
```

### Internal Interfaces

- **Orchestrator ↔ Forge Node**: Transmits a `ToolDossier` (JSON) containing requirements, expected input/output types, and 3-5 success criteria.
- **Forge Node ↔ Registry**: Data exchange via `ToolArtifact` (SQL/Blob) containing `content_hash`, `source_code`, `pydantic_model`, and `test_results`.
- **Gateway ↔ E2B Sandbox**: gRPC/REST pipeline for isolated code execution, passing environment variables and lockfile definitions.

## Error Handling

- **Input Validation Errors**: Handled via Pydantic model enforcement at the Gateway; malformed tool calls trigger an immediate "Refinement" loop back to the agent.
- **Processing Errors**: Hierarchical Circuit Breakers monitor recursion depth (max 5) and token budget. If a tool fails 3x, it is flagged for "Maturity Tier" demotion.
- **External Service Failures**: E2B environment caching allows for deterministic retries; network timeouts trigger an exponential backoff strategy within the LangGraph retry-node.

## Performance Considerations

- **Target Latency**: 
    - Tool Discovery (SSI): <200ms
    - Tool Generation (Forge): <15s (including TDD)
    - Tool Execution (Gateway): <500ms (overhead above tool runtime)
- **Throughput Requirements**: Support for 10 concurrent agentic sessions per Forge Node; horizontal scaling via stateless Gateway instances.
- **Resource Constraints**: 
    - Memory: 2GB per Gateway instance for hot-tool caching.
    - Storage: Postgres instance with `pgvector` extension; minimum 50GB for artifact history and logs.

---
*Generated from boardroom plan*