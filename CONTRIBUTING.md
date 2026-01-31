# CONTRIBUTING.md

## Contributing to AgentForge

Thanks for your interest in contributing! This guide will help you get started.

### Code of Conduct

We are committed to providing a welcoming and inspiring community for all. Please read and adhere to our Code of Conduct.

### How to Contribute

#### Reporting Bugs

- Use the issue tracker to report bugs
- Describe the issue clearly, including steps to reproduce
- Include your environment (OS, Node version, etc.)
- Attach error logs or screenshots if relevant

#### Suggesting Features

- Use the issue tracker with the "enhancement" label
- Clearly describe the feature and why it would be useful
- Provide examples of how it would work

#### Submitting Pull Requests

1. **Fork** the repository
2. **Create a feature branch**: `git checkout -b feature/description`
3. **Make your changes** with clear commit messages
4. **Write tests** for new functionality
5. **Update documentation** as needed
6. **Submit your PR** with a clear description

### Development Setup

```bash
# Clone your fork
git clone https://github.com/yourusername/agentforge.git
cd agentforge

# Install dependencies
npm install
cd cli && npm install && cd ..
cd server && npm install && cd ..

# Create a .env file with your API key
cp .env.example .env
# Edit .env with your OpenRouter API key

# Start development
npm run dev:cli
```

### Code Standards

- **Language**: TypeScript (strict mode)
- **Formatting**: 2-space indents, no trailing commas
- **Linting**: ESLint (run `npm run lint:fix`)
- **Testing**: Vitest (run `npm test`)

### Commit Message Guidelines

```
type: subject (max 50 chars)

description (max 72 chars per line)

Fixes #issue-number
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Example:
```
feat: add pattern-matching tool for session analysis

Implements a new Pattern_Matcher tool that analyzes past sessions
to identify successful patterns for analogical reasoning.

Fixes #42
```

### Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure code compiles: `npm run build`
3. Ensure linting passes: `npm run lint`
4. Write a clear PR description
5. Link any related issues
6. Request review from maintainers
7. Address feedback and re-request review

### Areas Where Help is Needed

- **Documentation**: Improve README, add tutorials
- **Testing**: Increase test coverage
- **Performance**: Optimize memory and execution speed
- **Toolkits**: Create specialized toolkits (DevOps, Data Science, etc.)
- **IDE Integration**: Build VS Code extension
- **Swarm Orchestration**: Enhance multi-agent coordination

### Questions?

- Check existing issues and discussions
- Open a new discussion if your question isn't covered
- Email: hello@agentforge.dev

Thank you for contributing to AgentForge! 🔥
