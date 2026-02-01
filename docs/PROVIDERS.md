# LLM Provider Configuration

AgentForge supports multiple LLM providers, allowing you to choose between different AI backends based on your subscription and preferences.

## Supported Providers

### 1. OpenRouter (Default)
- **Pricing**: Pay-as-you-go based on model usage
- **API Key Required**: Yes
- **Website**: https://openrouter.ai

### 2. GitHub Copilot (Pro/Pro+)
- **Pricing**: 
  - Copilot Pro: $10/month (300 premium requests)
  - Copilot Pro+: $39/month (1500 premium requests)
- **Requirements**: 
  - GitHub Copilot Pro or Pro+ subscription
  - GitHub CLI (`gh`) installed and authenticated

## Quick Start

### Check Provider Status
```bash
agentforge provider --list
```

### Switch to GitHub Copilot
```bash
# First, authenticate with Copilot
agentforge provider --login copilot

# Then switch to Copilot as your active provider
agentforge provider --switch copilot
```

### Switch to OpenRouter
```bash
# Set up your API key
agentforge provider --login openrouter

# Switch to OpenRouter
agentforge provider --switch openrouter
```

## Provider Commands

| Command | Description |
|---------|-------------|
| `agentforge provider` | Show status of all providers |
| `agentforge provider --list` | List all providers with details |
| `agentforge provider --switch <provider>` | Switch active provider |
| `agentforge provider --login <provider>` | Authenticate with a provider |
| `agentforge provider --logout <provider>` | Sign out from a provider |
| `agentforge provider --models` | List available models |
| `agentforge provider --usage` | Show usage statistics |

## GitHub Copilot Setup

### Prerequisites
1. **GitHub CLI**: Install from https://cli.github.com/
   ```bash
   # Windows
   winget install --id GitHub.cli
   
   # macOS
   brew install gh
   
   # Linux
   sudo apt install gh  # Debian/Ubuntu
   ```

2. **Copilot Subscription**: Sign up at https://github.com/features/copilot

### Authentication Flow
When you run `agentforge provider --login copilot`:
1. AgentForge checks if GitHub CLI is installed
2. Opens browser for GitHub OAuth authentication
3. Verifies your Copilot subscription
4. Stores authentication locally

### Available Models (by Subscription)

#### Copilot Pro
- GPT-5, GPT-5-mini, GPT-5-codex
- Claude Sonnet 4, Claude Sonnet 4.5, Claude Opus 4.5
- Gemini 2.5 Pro, Gemini 3 Flash/Pro
- And more...

#### Copilot Pro+ (Additional)
- Claude Opus 4.1
- Extended rate limits

## Usage Tracking

AgentForge tracks your premium request usage for Copilot:

```bash
# View current usage
agentforge provider --usage
```

Usage is tracked per-month and resets automatically.

## Starting a Chat with Specific Provider

```bash
# Use Copilot for this session
agentforge chat --provider copilot

# Use OpenRouter for this session
agentforge chat --provider openrouter
```

## Environment Variables

You can also configure providers via environment variables:

```bash
# Set default provider
export LLM_PROVIDER=copilot  # or "openrouter"

# OpenRouter settings
export OPENROUTER_API_KEY=your-key-here
export OPENROUTER_MODEL=anthropic/claude-3.5-sonnet

# Copilot settings
export COPILOT_MODEL=gpt-5
```

## Troubleshooting

### "GitHub CLI not installed"
Install the GitHub CLI from https://cli.github.com/

### "No GitHub Copilot subscription found"
1. Visit https://github.com/features/copilot
2. Subscribe to Copilot Pro ($10/mo) or Pro+ ($39/mo)
3. Run `agentforge provider --login copilot` again

### "Provider not available"
- Check your internet connection
- Verify API keys are set correctly
- Run `agentforge status` to diagnose issues

### Copilot authentication issues
```bash
# Re-authenticate with GitHub
gh auth logout
gh auth login --web -s copilot

# Then re-login to AgentForge
agentforge provider --login copilot
```
