#!/usr/bin/env node

/**
 * AgentForge CLI - Main Entry Point
 * ==================================
 * Beautiful terminal interface for the AgentForge autonomous agent system.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';
import ora from 'ora';
import inquirer from 'inquirer';

import { ChatSession } from './components/ChatSession';
import { ToolRegistry } from './components/ToolRegistry';
import { ForgeUI } from './components/ForgeUI';
import { ComponentForge } from './components/ComponentForge';
import { ConfigManager } from './services/ConfigManager';
import { BackendClient } from './services/BackendClient';
import { ProviderManager } from './services/ProviderManager';
import { displayWelcome, displayHelp } from './utils/display';
import { loadForgedTools } from './tools/index';

const VERSION = '1.0.0';

function getPanelWidth(min = 72, max = 104, margin = 4): number {
  const cols = process.stdout.columns || 100;
  return Math.min(max, Math.max(min, cols - margin));
}

// Initialize CLI
const program = new Command();

// Load Core Tools from disk
const coreToolsPromise = loadForgedTools().catch((err) => {
  console.error(chalk.red('\n⚠️  Failed to load core forged tools:'), err.message);
});

program
  .name('agentforge')
  .description('AgentForge - Autonomous AI Agent with Toolsmith Mechanism')
  .version(VERSION);

// Chat command - main interactive mode
program
  .command('chat')
  .alias('c')
  .description('Start an interactive chat session with the agent')
  .option('-m, --model <model>', 'Model ID to use')
  .option('-s, --session <id>', 'Resume a previous session')
  .option('-p, --provider <provider>', 'LLM provider (openrouter, copilot)')
  .option('--no-stream', 'Disable streaming responses')
  .action(async (options) => {
    await coreToolsPromise;
    await displayWelcome();
    const config = new ConfigManager();
    const providerManager = new ProviderManager(config);
    
    // Switch provider if specified
    if (options.provider) {
      const switched = await providerManager.setActiveProvider(options.provider as any);
      if (!switched) {
        console.log(chalk.yellow('\nFalling back to default provider...'));
      }
    }
    
    // Check if active provider is available
    const activeProvider = providerManager.getActiveProvider();
    const isAvailable = await activeProvider.isAvailable();
    
    if (!isAvailable) {
      if (providerManager.getActiveProviderType() === 'openrouter') {
        console.log(chalk.yellow('\n⚠️  OpenRouter API key not configured.'));
        await setupApiKey(config);
      } else if (providerManager.getActiveProviderType() === 'copilot') {
        console.log(chalk.yellow('\n⚠️  GitHub Copilot not configured.'));
        const authenticated = await providerManager.authenticateProvider('copilot');
        if (!authenticated) {
          console.log(chalk.yellow('\nFalling back to OpenRouter...'));
          await providerManager.setActiveProvider('openrouter');
          if (!config.get('openrouter.apiKey')) {
            await setupApiKey(config);
          }
        }
      }
    }
    
    const session = new ChatSession({
      model: options.model,
      sessionId: options.session,
      stream: options.stream,
      config
    });
    
    await session.start();
  });

// Tools command - list and manage tools
program
  .command('tools')
  .alias('t')
  .description('List and manage registered tools')
  .option('-l, --list', 'List all tools')
  .option('-s, --search <query>', 'Search tools by name or description')
  .option('-i, --info <hash>', 'Show tool details')
  .action(async (options) => {
    await coreToolsPromise;
    const registry = new ToolRegistry();
    
    if (options.search) {
      await registry.search(options.search);
    } else if (options.info) {
      await registry.showInfo(options.info);
    } else {
      await registry.list();
    }
  });

// Forge command - create new tools
program
  .command('forge')
  .alias('f')
  .description('Generate a new tool using the Toolsmith')
  .option('-n, --name <name>', 'Tool name')
  .option('-d, --description <desc>', 'Tool description')
  .option('-i, --interactive', 'Interactive tool creation wizard')
  .option('-a, --audit', 'Audit current toolset for gaps and improvements')
  .action(async (options) => {
    await coreToolsPromise;
    const forge = new ForgeUI();
    
    if (options.audit) {
      await forge.audit();
    } else if (options.interactive || (!options.name && !options.description)) {
      await forge.wizard();
    } else {
      await forge.generate({
        name: options.name,
        description: options.description
      });
    }
  });

// ComponentForge command - improve core architecture
program
  .command('component')
  .alias('cf')
  .description('Audit and improve core agent components (Memory, Middleware, Services)')
  .action(async () => {
    await coreToolsPromise;
    const cf = new ComponentForge();
    await cf.run();
  });

// MCP Command
program
  .command('mcp')
  .description('Manage Model Context Protocol (MCP) servers')
  .option('-l, --list', 'List configured MCP servers')
  .option('-a, --add <id,url,name>', 'Add a new MCP server (id,url,name)')
  .option('-r, --remove <id>', 'Remove an MCP server')
  .action(async (options) => {
    const config = new ConfigManager();
    const mcpConfig = config.get('mcp') || { servers: [] };
    
    if (options.add) {
      const [id, url, name] = options.add.split(',');
      if (!id || !url) {
        console.error(chalk.red('Error: id and url are required for adding a server. Usage: --add id,url,name'));
        return;
      }
      mcpConfig.servers.push({ id, url, name: name || id });
      config.set('mcp', mcpConfig);
      console.log(chalk.green(`✓ Added MCP server: ${name || id}`));
    } else if (options.remove) {
      const initialLength = mcpConfig.servers.length;
      mcpConfig.servers = mcpConfig.servers.filter((s: any) => s.id !== options.remove);
      if (mcpConfig.servers.length < initialLength) {
        config.set('mcp', mcpConfig);
        console.log(chalk.green(`✓ Removed MCP server: ${options.remove}`));
      } else {
        console.log(chalk.yellow(`! MCP server not found: ${options.remove}`));
      }
    } else {
      console.log(chalk.bold('\n🌐 Configured MCP Servers\n'));
      if (mcpConfig.servers.length === 0) {
        console.log(chalk.gray('  No MCP servers configured.'));
      } else {
        mcpConfig.servers.forEach((s: any) => {
          console.log(`  ${chalk.cyan(s.id.padEnd(15))} ${chalk.white((s.name || '').padEnd(25))} ${chalk.gray(s.url)}`);
        });
      }
      console.log();
    }
  });

// Skills Command
program
  .command('skills')
  .description('Manage technical skills search paths')
  .option('-l, --list', 'List skill search paths')
  .option('-a, --add <path>', 'Add a skill search path')
  .option('-r, --remove <path>', 'Remove a skill search path')
  .action(async (options) => {
    const config = new ConfigManager();
    const skillsConfig = config.get('skills') || { paths: [] };
    
    if (options.add) {
      if (!skillsConfig.paths.includes(options.add)) {
        skillsConfig.paths.push(options.add);
        config.set('skills', skillsConfig);
        console.log(chalk.green(`✓ Added skill path: ${options.add}`));
      }
    } else if (options.remove) {
      const initialLength = skillsConfig.paths.length;
      skillsConfig.paths = skillsConfig.paths.filter((p: string) => p !== options.remove);
      if (skillsConfig.paths.length < initialLength) {
        config.set('skills', skillsConfig);
        console.log(chalk.green(`✓ Removed skill path: ${options.remove}`));
      }
    } else {
      console.log(chalk.bold('\n📚 Skill Search Paths\n'));
      if (skillsConfig.paths.length === 0) {
        console.log(chalk.gray('  No skill paths configured.'));
      } else {
        skillsConfig.paths.forEach((p: string) => {
          console.log(`  ${chalk.white(p)}`);
        });
      }
      console.log();
    }
  });

// Provider command - manage LLM providers (OpenRouter, Copilot, etc.)
program
  .command('provider')
  .alias('p')
  .description('Manage LLM providers (OpenRouter, GitHub Copilot)')
  .option('-l, --list', 'List all providers and their status')
  .option('-s, --switch <provider>', 'Switch to a provider (openrouter, copilot)')
  .option('--login <provider>', 'Authenticate with a provider')
  .option('--logout <provider>', 'Sign out from a provider')
  .option('--models', 'List available models for active provider')
  .option('--usage', 'Show usage statistics for active provider')
  .action(async (options) => {
    const config = new ConfigManager();
    const providerManager = new ProviderManager(config);
    
    if (options.login) {
      const provider = options.login.toLowerCase();
      if (provider === 'copilot') {
        await providerManager.authenticateProvider('copilot');
      } else if (provider === 'openrouter') {
        // OpenRouter uses API key
        await setupApiKey(config);
      } else {
        console.log(chalk.red(`Unknown provider: ${provider}`));
        console.log(chalk.gray('Available providers: openrouter, copilot'));
        console.log(chalk.gray('Examples:'));
        console.log(chalk.gray('  agentforge provider --login openrouter'));
        console.log(chalk.gray('  agentforge provider --login copilot'));
      }
    } else if (options.logout) {
      const provider = options.logout.toLowerCase();
      await providerManager.signOutProvider(provider as any);
    } else if (options.switch) {
      const provider = options.switch.toLowerCase();
      await providerManager.setActiveProvider(provider as any);
    } else if (options.models) {
      const spinner = ora('Fetching models...').start();
      try {
        const models = await providerManager.getModels();
        spinner.stop();
        console.log(chalk.bold(`\n🤖 Available Models (${providerManager.getActiveProviderType()})\n`));
        models.slice(0, 30).forEach(m => console.log(`  ${chalk.cyan(m)}`));
        if (models.length > 30) {
          console.log(chalk.gray(`  ... and ${models.length - 30} more`));
        }
        console.log();
      } catch (error: any) {
        spinner.fail(error.message);
      }
    } else if (options.usage) {
      const spinner = ora('Fetching usage...').start();
      try {
        const info = await providerManager.getInfo();
        spinner.stop();
        console.log(chalk.bold(`\n📊 ${info.displayName} Usage\n`));
        if (info.subscription) {
          console.log(`  Subscription: ${chalk.green(info.subscription)}`);
        }
        if (info.usage) {
          const { used, limit, remaining } = info.usage;
          const limitStr = limit === Infinity ? '∞' : limit.toString();
          console.log(`  Requests Used: ${chalk.yellow(used)}/${limitStr}`);
          console.log(`  Remaining: ${chalk.green(remaining)}`);
        }
        console.log();
      } catch (error: any) {
        spinner.fail(error.message);
      }
    } else {
      // Default: show status
      await providerManager.displayStatus();
    }
  });

// Config command - manage settings
program
  .command('config')
  .description('Manage AgentForge configuration')
  .option('-s, --set <key=value>', 'Set a configuration value')
  .option('-g, --get <key>', 'Get a configuration value')
  .option('-l, --list', 'List all configuration')
  .option('--setup', 'Run initial setup wizard')
  .action(async (options) => {
    const config = new ConfigManager();
    
    if (options.setup) {
      await runSetupWizard(config);
    } else if (options.set) {
      const eqIndex = options.set.indexOf('=');
      if (eqIndex <= 0) {
        console.log(chalk.red('Invalid format for --set. Expected: key=value'));
        console.log(chalk.gray('Example: agentforge config --set openrouter.model=anthropic/claude-sonnet-4'));
        return;
      }
      const key = options.set.slice(0, eqIndex).trim();
      const value = options.set.slice(eqIndex + 1).trim();
      config.set(key, value);
      console.log(chalk.green(`✓ Set ${key}`));
    } else if (options.get) {
      const value = config.get(options.get);
      console.log(value ?? chalk.gray('(not set)'));
    } else {
      displayConfig(config);
    }
  });

// Run command - execute a single task
program
  .command('run <task>')
  .alias('r')
  .description('Execute a single task')
  .option('-m, --model <model>', 'OpenRouter model ID')
  .option('-v, --verbose', 'Verbose output')
  .action(async (task, options) => {
    const config = new ConfigManager();
    const client = new BackendClient(config);
    
    const spinner = ora('Executing task...').start();
    
    try {
      const result: any = await client.executeTask(task, {
        model: options.model,
        verbose: options.verbose
      });
      
      spinner.succeed('Task completed');
      console.log(boxen(result.summary || result.output, {
        padding: 1,
        borderColor: 'green',
        title: 'Result',
        width: getPanelWidth(72, 108)
      }));
    } catch (error: any) {
      spinner.fail('Task failed');
      console.error(chalk.red(error.message));
    }
  });

// Status command - check system status
program
  .command('status')
  .description('Check AgentForge system status')
  .action(async () => {
    const config = new ConfigManager();
    const client = new BackendClient(config);
    const providerManager = new ProviderManager(config);
    
    console.log(chalk.bold('\n📊 AgentForge Status\n'));

    const shellSandbox = process.env.AGENTFORGE_SHELL_SANDBOX || 'docker';
    const backendUrl = config.get('backend.url') || 'http://localhost:8000';
    const activeProviderType = providerManager.getActiveProviderType();
    console.log(boxen(
      chalk.white('Environment') + '\n\n' +
      chalk.gray('Provider: ') + chalk.cyan(activeProviderType) + '\n' +
      chalk.gray('Backend:  ') + chalk.cyan(backendUrl) + '\n' +
      chalk.gray('Sandbox:  ') + chalk.cyan(shellSandbox),
      { padding: 1, borderColor: 'cyan', width: getPanelWidth(72, 96) }
    ));
    
    // Show provider status
    await providerManager.displayStatus();
    
    const checks = [
      { name: 'Backend API', check: () => client.healthCheck() },
      { name: 'Active Provider Ready', check: async () => providerManager.getActiveProvider().isAvailable() },
      { name: 'Configuration', check: () => !!config.get('openrouter.apiKey') || !!config.get('llm.provider') }
    ];
    
    for (const { name, check } of checks) {
      const spinner = ora(name).start();
      try {
        const ok = await check();
        if (ok) {
          spinner.succeed(chalk.green(name));
        } else {
          spinner.warn(chalk.yellow(name + ' (not configured)'));
        }
      } catch (error: any) {
        spinner.fail(chalk.red(name + ` (${error.message})`));
      }
    }

    console.log(chalk.gray('Quick actions:'));
    console.log(chalk.gray('  • Setup provider: agentforge provider --login <openrouter|copilot>'));
    console.log(chalk.gray('  • Run wizard:     agentforge config --setup'));
    console.log(chalk.gray('  • Start chat:     agentforge chat'));
    console.log();
  });

// Helper functions
async function setupApiKey(config: any) {
  console.log(boxen(
    chalk.bold.cyan('OpenRouter Setup') + '\n\n' +
    chalk.gray('Paste your OpenRouter API key to enable chat immediately.') + '\n' +
    chalk.gray('You can create one at: ') + chalk.cyan('https://openrouter.ai/keys'),
    { padding: 1, borderColor: 'cyan', width: getPanelWidth(72, 96) }
  ));

  const existingKey = config.get('openrouter.apiKey') || '';
  const existingModel = config.get('openrouter.model') || 'anthropic/claude-sonnet-4-20250514';
  
  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: existingKey ? 'OpenRouter API Key (leave blank to keep current):' : 'OpenRouter API Key:',
      mask: '*',
      validate: (input: string) => {
        if (!input && existingKey) return true;
        return input.length > 10 || 'API key seems too short';
      }
    },
    {
      type: 'list',
      name: 'model',
      message: 'Default AI Model:',
      choices: [
        { name: 'Claude Sonnet 4 (Recommended)', value: 'anthropic/claude-sonnet-4-20250514' },
        { name: 'GPT-4o', value: 'openai/gpt-4o' },
        { name: 'Claude 3.5 Sonnet', value: 'anthropic/claude-3.5-sonnet' },
        { name: 'Gemini 1.5 Pro', value: 'google/gemini-1.5-pro' }
      ],
      default: existingModel
    }
  ]);

  config.set('llm.provider', 'openrouter');
  if (answers.apiKey) {
    config.set('openrouter.apiKey', answers.apiKey);
  }
  config.set('openrouter.model', answers.model);

  console.log(chalk.green('\n✓ OpenRouter configuration saved.\n'));
  console.log(chalk.gray('Next steps:'));
  console.log(chalk.gray('  1) Verify provider: agentforge provider --list'));
  console.log(chalk.gray('  2) Start chat:      agentforge chat\n'));
}

async function runSetupWizard(config: any) {
  console.log(boxen(
    chalk.bold('AgentForge Setup Wizard') + '\n\n' +
    chalk.gray('Configure provider, model, backend, and streaming in one flow.'),
    { padding: 1, borderColor: 'cyan', width: getPanelWidth(72, 96) }
  ));

  const currentProvider = (config.get('llm.provider') || 'openrouter').toLowerCase();
  const existingKey = config.get('openrouter.apiKey') || '';

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Primary provider:',
      choices: [
        { name: 'OpenRouter (API key)', value: 'openrouter' },
        { name: 'GitHub Copilot (subscription)', value: 'copilot' }
      ],
      default: currentProvider === 'copilot' ? 'copilot' : 'openrouter'
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'OpenRouter API Key:',
      mask: '*',
      when: (a: any) => a.provider === 'openrouter',
      default: existingKey,
      validate: (input: string, allAnswers: any) => {
        if (allAnswers.provider !== 'openrouter') return true;
        if (!input && existingKey) return true;
        return input.length > 10 || 'API key seems too short';
      }
    },
    {
      type: 'list',
      name: 'model',
      message: 'Default AI Model:',
      when: (a: any) => a.provider === 'openrouter',
      choices: [
        { name: 'Claude Sonnet 4 (Recommended)', value: 'anthropic/claude-sonnet-4-20250514' },
        { name: 'GPT-4o', value: 'openai/gpt-4o' },
        { name: 'Claude 3.5 Sonnet', value: 'anthropic/claude-3.5-sonnet' },
        { name: 'Gemini 1.5 Pro', value: 'google/gemini-1.5-pro' }
      ],
      default: config.get('openrouter.model') || 'anthropic/claude-sonnet-4-20250514'
    },
    {
      type: 'input',
      name: 'backendUrl',
      message: 'Backend URL:',
      default: config.get('backend.url') || 'http://localhost:8000'
    },
    {
      type: 'confirm',
      name: 'streamOutput',
      message: 'Enable streaming output:',
      default: config.get('cli.streamOutput') !== false
    }
  ]);

  config.set('llm.provider', answers.provider);
  if (answers.provider === 'openrouter') {
    if (answers.apiKey) {
      config.set('openrouter.apiKey', answers.apiKey);
    }
    config.set('openrouter.model', answers.model);
  }
  config.set('backend.url', answers.backendUrl);
  config.set('cli.streamOutput', answers.streamOutput);

  console.log(chalk.green('\n✓ Setup complete.\n'));
  if (answers.provider === 'copilot') {
    console.log(chalk.gray('Next steps for Copilot:'));
    console.log(chalk.gray('  1) Login:  agentforge provider --login copilot'));
    console.log(chalk.gray('  2) Verify: agentforge provider --list'));
  } else {
    console.log(chalk.gray('Next steps for OpenRouter:'));
    console.log(chalk.gray('  1) Verify: agentforge provider --list'));
  }
  console.log(chalk.gray('  3) Start:  agentforge chat\n'));
}

function displayConfig(config: any) {
  const data = config.getAll();
  console.log(boxen(
    Object.entries(data)
      .map(([k, v]) => `${chalk.cyan(k)}: ${
        k.includes('apiKey') ? chalk.gray('***') : v
      }`)
      .join('\n') || chalk.gray('No configuration set'),
    { padding: 1, title: 'Configuration', borderColor: 'blue', width: getPanelWidth(72, 108) }
  ));
}

// Default action (no command) - start chat mode
program.action(async () => {
  await displayWelcome();
  const config = new ConfigManager();
  const providerManager = new ProviderManager(config);
  
  // Check if active provider is available
  const activeProvider = providerManager.getActiveProvider();
  const isAvailable = await activeProvider.isAvailable();
  
  if (!isAvailable) {
    if (providerManager.getActiveProviderType() === 'openrouter') {
      console.log(chalk.yellow('\n⚠️  OpenRouter API key not configured.'));
      await setupApiKey(config);
    } else if (providerManager.getActiveProviderType() === 'copilot') {
      console.log(chalk.yellow('\n⚠️  GitHub Copilot not configured.'));
      const authenticated = await providerManager.authenticateProvider('copilot');
      if (!authenticated) {
        console.log(chalk.yellow('\nFalling back to OpenRouter...'));
        await providerManager.setActiveProvider('openrouter');
        if (!config.get('openrouter.apiKey')) {
          await setupApiKey(config);
        }
      }
    }
  }
  
  const session = new ChatSession({
    model: config.get(`${providerManager.getActiveProviderType()}.model`),
    stream: true,
    config
  });
  
  await session.start();
});

// Parse and execute with error handling
program.parseAsync(process.argv).catch(err => {
  console.error('\n' + chalk.red.bold('🔥 Critical CLI Error:'));
  console.error(chalk.red(`   ${err.message || 'Unknown error occured'}`));
  process.exit(1);
});
