# 🐍 Python Mastery & Reliability

## Engineering Principles
Transition from "scripts that work" to "systems that scale".

### 1. Robust Type Safety
- **Strict Typing**: Use `typing.Annotated`, `Protocol`, and `TypeVar` for generic, reusable logic.
- **Pydantic V2**: Use for all data modeling and boundary validation.
- **Static Analysis**: No PR is complete without passing `pyright --lib`.

### 2. Modern Concurrency
- **Asyncio**: Use for all I/O bound operations. Avoid the "threaded bottleneck".
- **Structured Task Groups**: Use `asyncio.TaskGroup` for managing concurrent task lifecycles safely.
- **Context Management**: Use `contextlib.asynccontextmanager` for resource cleanup (DB connections, file handles).

### 3. Observable Architecture
- **Log Levels**: Use `TRACE`, `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` appropriately. No broad `print()` statements.
- **Rich Tracebacks**: Use `rich` or `structlog` for machine-readable, human-debuggable logs.
- **Health Checks**: Implement internal status checks for long-running services.

### 4. Advanced Tooling
- **Ruff**: Use for linting and formatting. It replaces 10+ legacy tools.
- **Poetry/uv**: Strict lockfile management. No "floating" dependencies.
- **Pytest**: Use fixtures, parametrization, and `pytest-asyncio` for exhaustive verification.

## The TDD Core
- Fail fast, fail early.
- Mock external dependencies.
- Test edge cases: empty strings, null values, network timeouts.
