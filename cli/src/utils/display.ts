/**
 * Display Utilities
 * =================
 * Beautiful terminal output helpers for AgentForge CLI.
 */

import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';

// Custom gradient for AgentForge branding
const agentGradient = gradient(['#00D9FF', '#00FF7F']);
const forgeGradient = gradient(['#FF6B6B', '#FFD700', '#00FF7F']);

/**
 * Display the welcome banner
 */
export async function displayWelcome(): Promise<void> {
  return new Promise<void>((resolve) => {
    figlet.text('AgentForge', {
      font: 'ANSI Shadow',
      horizontalLayout: 'fitted'
    }, (err: any, data: any) => {
      if (err) {
        console.log(chalk.bold.cyan('\n  AgentForge\n'));
      } else {
        console.log('\n' + agentGradient(data));
      }
      
      console.log(chalk.gray('  Autonomous AI Agent with Toolsmith Mechanism'));
      console.log(chalk.gray('  ─'.repeat(25)));
      console.log();
      resolve();
    });
  });
}

/**
 * Display help information
 */
export function displayHelp() {
  const commands = [
    { cmd: 'chat', alias: 'c', desc: 'Start interactive chat session' },
    { cmd: 'run <task>', alias: 'r', desc: 'Execute a single task' },
    { cmd: 'tools', alias: 't', desc: 'List and manage tools' },
    { cmd: 'forge', alias: 'f', desc: 'Generate new tools' },
    { cmd: 'component', alias: 'cf', desc: 'Evolve core agent architecture' },
    { cmd: 'config', alias: '', desc: 'Manage configuration' },
    { cmd: 'status', alias: '', desc: 'Check system status' }
  ];
  
  console.log(chalk.bold('  Commands:\n'));
  
  for (const { cmd, alias, desc } of commands) {
    const aliasStr = alias ? chalk.gray(` (${alias})`) : '';
    console.log(`    ${chalk.cyan(cmd.padEnd(15))}${aliasStr.padEnd(6)} ${desc}`);
  }
  
  console.log('\n  ' + chalk.gray('Run `agentforge <command> --help` for more info\n'));
}

/**
 * Format tool execution result with minimal output
 */
export function formatToolResult(tool: string, result: any): string {
  const icons: Record<string, string> = {
    grep: 'grep',
    glob: 'glob',
    read: 'read',
    write: 'write',
    shell: 'shell',
    env: 'env',
    package: 'package',
    forge: 'forge'
  };
  
  const icon = icons[tool] || 'tool';
  const color = result.success ? chalk.green : chalk.red;
  
  return color(`${icon} ${result.summary}`);
}

/**
 * Display a section header
 */
export function sectionHeader(title: string): void {
  console.log('\n' + chalk.bold.cyan(` ${title.toUpperCase()} `));
  console.log(chalk.gray(' '.repeat(2) + '─'.repeat(title.length + 2)));
}

/**
 * Display a thinking/reasoning block
 */
export function displayThinking(content: string): void {
  if (!content) return;
  
  console.log('\n' + chalk.gray(' 💭 Thinking...'));
  console.log(boxen(chalk.italic.gray(content), {
    padding: { left: 2, right: 2, top: 0, bottom: 0 },
    borderColor: 'gray',
    dimBorder: true,
    borderStyle: 'none'
  }));
}

/**
 * Display tool output in minimal format
 */
export function toolOutput(type: string, data: any): void {
  const formatters: Record<string, () => string> = {
    grep: () => {
      const { matches, files } = data;
      return `Found ${chalk.bold(matches)} matches in ${chalk.bold(files)} files`;
    },
    glob: () => {
      const { count, pattern } = data;
      return `Matched ${chalk.bold(count)} files for ${chalk.gray(pattern)}`;
    },
    read: () => {
      const { file, start, end } = data;
      return `Read lines ${chalk.bold(`${start}-${end}`)} of ${chalk.cyan(file)}`;
    },
    write: () => {
      const { file, added, removed } = data;
      const changes = [];
      if (added > 0) changes.push(chalk.green(`+${added}`));
      if (removed > 0) changes.push(chalk.red(`-${removed}`));
      return `Wrote to ${chalk.cyan(file)} (${changes.join(', ')})`;
    },
    shell: () => {
      const { command, exitCode } = data;
      const status = exitCode === 0 
        ? chalk.green('✓') 
        : chalk.red(`Exit ${exitCode}`);
      return `${chalk.gray('$')} ${chalk.bold(command)} → ${status}`;
    },
    env: () => {
      const { action, name } = data;
      return `${action === 'activate' ? 'Activated' : 'Deactivated'} env ${chalk.cyan(name)}`;
    },
    package: () => {
      const { action, packages } = data;
      const verb = action === 'install' ? 'Installed' : 'Removed';
      return `${verb} ${chalk.bold(packages.length)} package(s)`;
    }
  };
  
  const formatter = formatters[type];
  if (formatter) {
    console.log(`  ${formatter()}`);
  }
}

/**
 * Display streaming message with typing effect
 */
export async function streamText(text: string, speed: number = 10): Promise<void> {
  for (const char of text) {
    process.stdout.write(char);
    await new Promise(r => setTimeout(r, speed));
  }
}

/**
 * Display agent thinking indicator
 */
export function thinkingIndicator(message = 'Thinking') {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  
  return setInterval(() => {
    process.stdout.write(`\r${chalk.cyan(frames[i++ % frames.length])} ${chalk.gray(message)}...`);
  }, 80);
}

/**
 * Display error message
 */
export function displayError(message: string, details: string | null = null): void {
  console.log(boxen(
    chalk.red('✗ ') + message + 
    (details ? '\n\n' + chalk.gray(details) : ''),
    { 
      padding: 1, 
      borderColor: 'red',
      title: 'Error'
    }
  ));
}

/**
 * Display success message
 */
export function displaySuccess(message: string): void {
  console.log(chalk.green('✓ ') + message);
}

/**
 * Display info message
 */
export function displayInfo(message: string): void {
  console.log(chalk.blue('ℹ ') + message);
}

/**
 * Display warning message
 */
export function displayWarning(message: string): void {
  console.log(chalk.yellow('⚠ ') + message);
}

/**
 * Format file path for display
 */
export function formatPath(path: string, maxLength: number = 40): string {
  if (path.length <= maxLength) {
    return chalk.cyan(path);
  }
  
  const parts = path.split(/[/\\]/);
  const file = parts.pop();
  let truncated = '...' + parts.slice(-2).join('/') + '/' + file;
  
  return chalk.cyan(truncated);
}

/**
 * Display progress bar
 */
export function progressBar(current: number, total: number, width: number = 30): string {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  
  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return `${bar} ${percentage}%`;
}

/**
 * Display code block with syntax highlighting hint
 */
export function codeBlock(code: string, language: string = ''): void {
  console.log(boxen(code, {
    padding: 1,
    borderColor: 'gray',
    title: language || 'code'
  }));
}

/**
 * Clear line and move cursor
 */
export function clearLine() {
  process.stdout.write('\r\x1b[K');
}

export default {
  displayWelcome,
  displayHelp,
  formatToolResult,
  sectionHeader,
  toolOutput,
  streamText,
  thinkingIndicator,
  displayError,
  displaySuccess,
  displayInfo,
  displayWarning,
  formatPath,
  progressBar,
  codeBlock,
  clearLine
};
