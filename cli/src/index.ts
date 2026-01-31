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
import { displayWelcome, displayHelp } from './utils/display';
import { loadForgedTools } from './tools/index';

const VERSION = '1.0.0';

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
  .option('-m, --model <model>', 'OpenRouter model ID', 'anthropic/claude-3.5-sonnet')
  .option('-s, --session <id>', 'Resume a previous session')
  .option('--no-stream', 'Disable streaming responses')
  .action(async (options) => {
    await coreToolsPromise;
    await displayWelcome();
    const config = new ConfigManager();
    
    if (!config.get('openrouter.apiKey')) {
      console.log(chalk.yellow('\n⚠️  OpenRouter API key not configured.'));
      await setupApiKey(config);
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
      const [key, value] = options.set.split('=');
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
        title: 'Result'
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
    
    console.log(chalk.bold('\n📊 AgentForge Status\n'));
    
    const checks = [
      { name: 'Backend API', check: () => client.healthCheck() },
      { name: 'OpenRouter API', check: () => client.checkOpenRouter() },
      { name: 'Configuration', check: () => !!config.get('openrouter.apiKey') }
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
    console.log();
  });

// Helper functions
async function setupApiKey(config: any) {
  console.log(chalk.bold.cyan('\n⚙️  Configuration Setup\n'));
  
  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'OpenRouter API Key:',
      mask: '*',
      validate: (input: string) => input.length > 10 || 'API key seems too short'
    },
    {
      type: 'list',
      name: 'model',
      message: 'Default AI Model:',
      choices: [
        { name: 'Claude 3.5 Sonnet (Recommended)', value: 'anthropic/claude-3.5-sonnet' },
        { name: 'GPT-4 Turbo', value: 'openai/gpt-4-turbo' },
        { name: 'Gemini Pro', value: 'google/gemini-pro' },
        { name: 'Llama 2', value: 'meta-llama/llama-2-70b-chat' }
      ],
      default: 0
    }
  ]);
  
  config.set('openrouter.apiKey', answers.apiKey);
  config.set('openrouter.model', answers.model);
  
  console.log(chalk.green('\n✓ Configuration saved!\n'));
}

async function runSetupWizard(config: any) {
  console.log(boxen(
    chalk.bold('AgentForge Setup Wizard'),
    { padding: 1, borderColor: 'cyan' }
  ));
  
  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'OpenRouter API Key:',
      mask: '*',
      default: config.get('openrouter.apiKey') || '',
      validate: (input: string) => input.length > 10 || 'API key seems too short'
    },
    {
      type: 'list',
      name: 'model',
      message: 'Default AI Model:',
      choices: [
        { name: 'Claude 3.5 Sonnet (Recommended)', value: 'anthropic/claude-3.5-sonnet' },
        { name: 'GPT-4 Turbo', value: 'openai/gpt-4-turbo' },
        { name: 'Gemini Pro', value: 'google/gemini-pro' },
        { name: 'Llama 2', value: 'meta-llama/llama-2-70b-chat' }
      ],
      default: config.get('openrouter.model') || 'anthropic/claude-3.5-sonnet'
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
  
  config.set('openrouter.apiKey', answers.apiKey);
  config.set('openrouter.model', answers.model);
  config.set('backend.url', answers.backendUrl);
  config.set('cli.streamOutput', answers.streamOutput);
  
  console.log(chalk.green('\n✓ Configuration saved!\n'));
}

function displayConfig(config: any) {
  const data = config.getAll();
  console.log(boxen(
    Object.entries(data)
      .map(([k, v]) => `${chalk.cyan(k)}: ${
        k.includes('apiKey') ? chalk.gray('***') : v
      }`)
      .join('\n') || chalk.gray('No configuration set'),
    { padding: 1, title: 'Configuration', borderColor: 'blue' }
  ));
}

// Default action (no command) - start chat mode
program.action(async () => {
  await displayWelcome();
  const config = new ConfigManager();
  
  if (!config.get('openrouter.apiKey')) {
    console.log(chalk.yellow('\n⚠️  OpenRouter API key not configured.'));
    await setupApiKey(config);
  }
  
  const session = new ChatSession({
    model: config.get('openrouter.model') || 'anthropic/claude-3.5-sonnet',
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
