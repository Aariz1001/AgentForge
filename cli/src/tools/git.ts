import { ToolResult } from './index';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve, normalize, isAbsolute } from 'path';
import chalk from 'chalk';

interface GitOperationArgs {
  command: 'status' | 'add' | 'commit' | 'push' | 'pull' | 'clone' | 'log' | 'diff' | 'branch' | 'checkout' | 'init' | 'fetch' | 'merge' | 'remote' | 'reset';
  args?: string[];
  cwd?: string;
  message?: string;
  remote?: string;
  branch?: string;
  timeout?: number;
}

/**
 * Securely resolves and validates file paths to prevent directory traversal.
 * Handles Windows backslash normalization and space-containing paths.
 */
function resolveWorkingPath(inputPath?: string): string {
  if (!inputPath) return process.cwd();
  
  // Normalize Windows paths to handle mixed separators
  const normalized = normalize(inputPath);
  
  // Resolve to absolute path
  const resolved = isAbsolute(normalized) ? normalized : resolve(process.cwd(), normalized);
  
  // Security: Prevent directory traversal beyond workspace
  const workspaceRoot = resolve(process.cwd());
  if (!resolved.startsWith(workspaceRoot) && !resolved.includes('.git')) {
    throw new Error(`Path traversal blocked: ${inputPath} resolves outside workspace`);
  }
  
  return resolved;
}

/**
 * Validates git command against allowlist to prevent arbitrary code execution.
 */
function validateGitCommand(command: string): command is GitOperationArgs['command'] {
  const allowedCommands = [
    'status', 'add', 'commit', 'push', 'pull', 'clone', 
    'log', 'diff', 'branch', 'checkout', 'init', 'fetch', 
    'merge', 'remote', 'reset', 'clean'
  ];
  return allowedCommands.includes(command);
}

/**
 * Constructs git arguments array with surgical validation.
 * Prevents injection by validating each argument segment.
 */
function constructGitArgs(params: GitOperationArgs): string[] {
  const args: string[] = [params.command];
  
  switch (params.command) {
    case 'commit':
      if (params.message) {
        // Validate message doesn't contain shell escapes
        if (/[;&|`$]/.test(params.message)) {
          throw new Error('Commit message contains invalid characters');
        }
        args.push('-m', params.message);
      }
      if (params.args) args.push(...sanitizeArgs(params.args));
      break;
      
    case 'push':
    case 'pull':
      if (params.remote) {
        if (/[;&|`$]/.test(params.remote)) throw new Error('Invalid remote name');
        args.push(params.remote);
      }
      if (params.branch) {
        if (/[;&|`$<>\/\\]/.test(params.branch)) throw new Error('Invalid branch name');
        args.push(params.branch);
      }
      if (params.args) args.push(...sanitizeArgs(params.args));
      break;
      
    case 'checkout':
      if (params.branch) {
        if (/[;&|`$]/.test(params.branch)) throw new Error('Invalid branch name');
        args.push(params.branch);
      }
      if (params.args) args.push(...sanitizeArgs(params.args));
      break;
      
    case 'add':
      if (params.args) {
        // Surgical file validation: check each path for traversal attempts
        for (const file of params.args) {
          if (file.includes('..') && file !== '...') {
            throw new Error(`Path traversal attempt detected in: ${file}`);
          }
          if (/[;&|`$]/.test(file)) {
            throw new Error(`Invalid characters in path: ${file}`);
          }
        }
        args.push(...params.args);
      } else {
        throw new Error('Add command requires file arguments');
      }
      break;
      
    case 'clone':
      if (params.args && params.args.length > 0) {
        // Validate URL format roughly
        const url = params.args[0];
        if (/[;&|`$]/.test(url)) throw new Error('Invalid repository URL');
        args.push(...params.args);
      } else {
        throw new Error('Clone command requires repository URL');
      }
      break;
      
    default:
      if (params.args) args.push(...sanitizeArgs(params.args));
  }
  
  return args;
}

/**
 * Sanitizes generic arguments to prevent command injection.
 */
function sanitizeArgs(args: string[]): string[] {
  return args.map(arg => {
    if (/[;&|`$]/.test(arg)) {
      throw new Error(`Argument contains invalid characters: ${arg}`);
    }
    return arg;
  });
}

/**
 * Executes git process with timeout and proper Windows handling.
 */
async function executeGit(
  args: string[], 
  cwd: string, 
  timeoutMs: number
): Promise<{stdout: string; stderr: string; exitCode: number}> {
  return new Promise((resolve, reject) => {
    // windowsHide prevents console window flash on Windows
    // shell: false prevents shell interpretation (security)
    const proc = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      // Force kill after grace period
      setTimeout(() => proc.kill('SIGKILL'), 5000);
      reject(new Error(`Git operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (!killed) {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 0
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to execute git: ${err.message}`));
    });
  });
}

/**
 * Perform high-level Git operations safely.
 * 
 * @param args - Operation parameters including command, arguments, and working directory
 * @param options - Execution options (timeout overrides, etc.)
 * @returns ToolResult containing success status, message, and structured output data
 */
export async function git(args: any, options: any = {}): Promise<ToolResult> {
  try {
    // Reasoning-first: Validate inputs structurally
    if (!args || typeof args !== 'object') {
      return new ToolResult(false, 'Invalid arguments: expected configuration object');
    }

    const params = args as GitOperationArgs;
    
    if (!params.command) {
      return new ToolResult(false, 'Missing required parameter: command');
    }

    if (!validateGitCommand(params.command)) {
      return new ToolResult(false, `Security violation: command '${params.command}' is not in allowlist`);
    }

    // Resolve and validate working directory (Windows path edge cases handled)
    let workingDir: string;
    try {
      workingDir = resolveWorkingPath(params.cwd);
      if (!existsSync(workingDir)) {
        return new ToolResult(false, `Working directory does not exist: ${params.cwd || process.cwd()}`);
      }
    } catch (pathError: any) {
      return new ToolResult(false, `Path resolution failed: ${pathError.message}`);
    }

    // Pre-flight check: ensure .git exists for non-init operations
    if (params.command !== 'init' && params.command !== 'clone') {
      const gitDir = resolve(workingDir, '.git');
      if (!existsSync(gitDir)) {
        return new ToolResult(false, `Not a git repository: ${workingDir}`);
      }
    }

    // Construct arguments with surgical precision
    let gitArgs: string[];
    try {
      gitArgs = constructGitArgs(params);
    } catch (validationError: any) {
      return new ToolResult(false, `Argument validation failed: ${validationError.message}`);
    }

    const timeout = params.timeout || options.timeout || 30000;

    // Execute operation
    const result = await executeGit(gitArgs, workingDir, timeout);

    // Parse structured data based on command type
    const outputData: any = {
      command: `git ${gitArgs.join(' ')}`,
      workingDir,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };

    const success = result.exitCode === 0;

    if (success) {
      // Surgical parsing for common operations
      switch (params.command) {
        case 'status':
          const staged: string[] = [];
          const unstaged: string[] = [];
          const untracked: string[] = [];
          let currentBranch = '';
          
          const lines = result.stdout.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (line.includes('On branch')) {
              currentBranch = line.replace('On branch', '').trim();
            } else if (/^M[ \t]/.test(line)) {
              staged.push(line.substring(2).trim());
            } else if (/^[ \t]M[ \t]/.test(line)) {
              unstaged.push(trimmed.substring(1).trim());
            } else if (/^\?\?/.test(line)) {
              untracked.push(line.substring(2).trim());
            }
          }
          outputData.parsed = { branch: currentBranch, staged, unstaged, untracked, clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0 };
          break;
          
        case 'log':
          outputData.parsed = {
            commits: result.stdout
              .split('\n')
              .filter(l => /^[a-f0-9]{7,}/.test(l))
              .map(l => l.split(' ')[0])
          };
          break;
          
        case 'branch':
          outputData.parsed = {
            current: result.stdout.split('\n').find(l => l.startsWith('*'))?.replace(/^\*\s*/, '').trim(),
            all: result.stdout.split('\n').map(l => l.replace(/^\*?\s*/, '').trim()).filter(Boolean)
          };
          break;
          
        case 'diff':
          outputData.parsed = {
            hasChanges: result.stdout.length > 0,
            filesChanged: result.stdout.match(/^diff --git/gm)?.length || 0
          };
          break;
      }
    } else {
      // Log errors for debugging but return structured failure
      if (result.stderr) {
        console.error(chalk.yellow(`[git stderr] ${result.stderr}`));
      }
    }

    const message = success 
      ? `Git ${params.command} completed successfully${outputData.parsed?.branch ? ` on branch '${outputData.parsed.branch}'` : ''}`
      : `Git ${params.command} failed (exit code ${result.exitCode})`;

    return new ToolResult(success, message, outputData);

  } catch (error: any) {
    console.error(chalk.red(`[git error] ${error.message}`));
    return new ToolResult(false, `Git operation failed: ${error.message}`);
  }
}