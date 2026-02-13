/**
 * Agent Tools
 * ===========
 * Tool implementations for the AgentForge agent.
 * Each tool returns minimal output (1-2 lines).
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, access, mkdir, readdir, stat } from 'fs/promises';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'path';
import fg from 'fast-glob';
import chalk from 'chalk';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { search, browse } from './search';
import VisualInterface from './Virtual_Phone_Controller/VisualInterface';
import DeviceOrchestrator from './Virtual_Phone_Controller/DeviceOrchestrator';
import SystemRelay from './Virtual_Phone_Controller/SystemRelay';
import AnalyzeFailure from './Autonomous_Memory_Suite/AnalyzeFailure';
import DecomposeObjective from './Autonomous_Memory_Suite/DecomposeObjective';
import PersistTrace from './Autonomous_Memory_Suite/PersistTrace';
import UpdateHeuristics from './Autonomous_Memory_Suite/UpdateHeuristics';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Track active background processes
interface ActiveProcess {
  id: string;
  process: any;
  output: string[];
  command: string;
  startedAt: string;
  kind?: 'host' | 'docker';
  containerId?: string;
  sandbox?: 'host' | 'docker';
}
const activeProcesses = new Map<string, ActiveProcess>();
let lastCommandOutput = '';

/**
 * Spawns a dedicated external terminal window for a command
 */
export async function spawnTerminal(options: any = {}): Promise<ToolResult> {
  const { command = '', cwd = '.', title = 'AgentForge Worker' } = options;
  const absCwd = resolve(cwd);

  try {
    if (process.platform === 'win32') {
      // Windows: use 'start' to open a new cmd or pwsh window
      const shell = 'pwsh.exe';
      const args = [
        'start', shell, '-NoExit', '-Command', 
        `$Host.UI.RawUI.WindowTitle = "${title}"; cd "${absCwd}"; ${command}`
      ];
      spawn('powershell.exe', ['-Command', args.join(' ')], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      // macOS: use AppleScript to open Terminal
      const script = `tell application "Terminal" to do script "cd ${absCwd} && ${command}"`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
    } else {
      // Linux: try x-terminal-emulator or gnome-terminal
      spawn('x-terminal-emulator', ['-e', `bash -c "cd ${absCwd} && ${command}; exec bash"`], { detached: true, stdio: 'ignore' }).unref();
    }

    return new ToolResult(true, `Opened a new terminal window at ${absCwd}`, { title, cwd: absCwd });
  } catch (error: any) {
    return new ToolResult(false, `Failed to spawn terminal: ${error.message}`);
  }
}

// Persistent Shell State
let persistentProcess: any = null;
let persistentOutput = '';
let persistentBusy = false;
const SHELL_SANDBOX_ROOT = resolve(process.cwd());
const DEFAULT_SHELL_TIMEOUT_MS = 30000;
const MAX_SHELL_TIMEOUT_MS = 300000;
const DEFAULT_DOCKER_SANDBOX_IMAGE = process.env.AGENTFORGE_DOCKER_IMAGE || 'node:20-bookworm';

const DANGEROUS_SHELL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|\s)(sudo\s+)?rm\s+-rf\s+\/(\s|$)/i, reason: 'Destructive root deletion is blocked' },
  { pattern: /(^|\s)(sudo\s+)?mkfs(\.|\s)/i, reason: 'Filesystem formatting commands are blocked' },
  { pattern: /(^|\s)(sudo\s+)?dd\s+if=.*\s+of=\/dev\//i, reason: 'Raw disk write commands are blocked' },
  { pattern: /(^|\s)(shutdown|reboot|halt|poweroff)(\s|$)/i, reason: 'System power commands are blocked' },
  { pattern: /(^|\s)diskpart(\s|$)/i, reason: 'Disk partition commands are blocked' },
  { pattern: /(^|\s)format\s+[a-z]:/i, reason: 'Drive formatting commands are blocked' },
  { pattern: /(^|\s)rmdir\s+\/s\s+\/q\s+[a-z]:\\/i, reason: 'Recursive drive deletion is blocked' },
  { pattern: /(^|\s)del\s+\/f\s+\/s\s+\/q\s+[a-z]:\\/i, reason: 'Recursive force delete on drive root is blocked' },
  { pattern: /\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh|pwsh|powershell)\b/i, reason: 'Remote script piping is blocked' },
  { pattern: /\b(iwr|Invoke-WebRequest)\b[^\n]*\|\s*iex\b/i, reason: 'Remote PowerShell execution is blocked' }
];

function clampShellTimeout(timeout: any): number {
  const parsed = Number(timeout);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SHELL_TIMEOUT_MS;
  return Math.min(parsed, MAX_SHELL_TIMEOUT_MS);
}

function resolveDockerImage(image?: string): string {
  const resolved = (image || DEFAULT_DOCKER_SANDBOX_IMAGE).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(resolved)) {
    throw new Error('Invalid docker image name for sandbox mode');
  }
  return resolved;
}

function resolveSandboxedCwd(cwd: string, options: any): string {
  const resolvedCwd = resolve(cwd || process.cwd());
  const allowOutsideWorkspace = options?.allowOutsideWorkspace === true || process.env.AGENTFORGE_ALLOW_OUTSIDE_WORKSPACE === '1';
  if (allowOutsideWorkspace) return resolvedCwd;

  const rel = relative(SHELL_SANDBOX_ROOT, resolvedCwd);
  const isInside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (!isInside) {
    throw new Error(`Sandbox violation: cwd must stay inside workspace (${SHELL_SANDBOX_ROOT})`);
  }
  return resolvedCwd;
}

function validateShellCommand(command: string, options: any): string {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Shell command must be a non-empty string');
  }

  const normalized = command.trim();
  if (/\r|\n/.test(normalized)) {
    throw new Error('Multi-line shell commands are blocked by sandbox policy');
  }

  if (normalized.length > 1200) {
    throw new Error('Shell command too long for safe execution');
  }

  const unsafeMode = options?.unsafe === true || process.env.AGENTFORGE_SHELL_UNSAFE === '1';
  if (!unsafeMode) {
    for (const rule of DANGEROUS_SHELL_PATTERNS) {
      if (rule.pattern.test(normalized)) {
        throw new Error(`Blocked unsafe shell command: ${rule.reason}`);
      }
    }
  }

  return normalized;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let didTimeout = false;

    const timer = setTimeout(() => {
      didTimeout = true;
      child.kill('SIGTERM');
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (didTimeout) return;
      resolveResult({ stdout, stderr, exitCode: exitCode ?? 0 });
    });
  });
}

async function ensureDockerAvailable(): Promise<void> {
  try {
    const probe = await runProcess('docker', ['version', '--format', '{{.Server.Version}}'], SHELL_SANDBOX_ROOT, 15000);
    if (probe.exitCode !== 0) {
      throw new Error(probe.stderr || probe.stdout || 'Unknown Docker error');
    }
  } catch (error: any) {
    throw new Error('Docker sandbox requested but Docker is unavailable. Start Docker Desktop and ensure `docker` works in terminal.');
  }
}

function getDockerWorkdir(cwd: string): string {
  const rel = relative(SHELL_SANDBOX_ROOT, cwd).replace(/\\/g, '/');
  return rel ? `/workspace/${rel}` : '/workspace';
}

function getDockerVolumeMount(rootPath: string): string {
  return `${rootPath.replace(/\\/g, '/')}:/workspace`;
}

async function runInDockerSandbox(
  command: string,
  cwd: string,
  timeout: number,
  dockerImage: string
): Promise<{ output: string; exitCode: number }> {
  const args = [
    'run',
    '--rm',
    '--pull',
    'missing',
    '-v',
    getDockerVolumeMount(SHELL_SANDBOX_ROOT),
    '-w',
    getDockerWorkdir(cwd),
    dockerImage,
    'sh',
    '-lc',
    command
  ];

  const result = await runProcess('docker', args, SHELL_SANDBOX_ROOT, timeout);
  const combined = [result.stdout, result.stderr].filter(Boolean).join('');
  return { output: combined, exitCode: result.exitCode };
}

async function startDockerBackgroundContainer(
  command: string,
  cwd: string,
  dockerImage: string
): Promise<{ containerId: string }> {
  const args = [
    'run',
    '-d',
    '--pull',
    'missing',
    '-v',
    getDockerVolumeMount(SHELL_SANDBOX_ROOT),
    '-w',
    getDockerWorkdir(cwd),
    dockerImage,
    'sh',
    '-lc',
    command
  ];

  const result = await runProcess('docker', args, SHELL_SANDBOX_ROOT, 45000);
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || 'Failed to start docker sandbox').trim());
  }

  const containerId = result.stdout.trim().split('\n').pop()?.trim() || '';
  if (!containerId) {
    throw new Error('Docker sandbox did not return a container ID');
  }

  return { containerId };
}

async function getDockerLogs(containerId: string): Promise<string> {
  const logs = await runProcess('docker', ['logs', '--tail', '200', containerId], SHELL_SANDBOX_ROOT, 15000);
  return [logs.stdout, logs.stderr].filter(Boolean).join('');
}

async function isDockerContainerRunning(containerId: string): Promise<boolean> {
  const result = await runProcess('docker', ['ps', '-q', '-f', `id=${containerId}`], SHELL_SANDBOX_ROOT, 15000);
  return result.stdout.trim().length > 0;
}

/**
 * Executes a command in a persistent shell session
 */
async function runInPersistentShell(command: string, cwd: string, timeout: number): Promise<{ output: string, exitCode: number }> {
  if (persistentBusy) {
    throw new Error('Persistent shell is currently busy. Wait for the previous command to finish.');
  }
  
  persistentBusy = true;
  
  try {
    if (!persistentProcess || persistentProcess.killed) {
      const shellCmd = process.platform === 'win32' ? 'pwsh.exe' : 'bash';
      const shellArgs = process.platform === 'win32'
        ? ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-']
        : ['--noprofile', '--norc'];
      
      persistentProcess = spawn(shellCmd, shellArgs, {
        cwd: resolve(cwd),
        env: { ...process.env, COLUMNS: '120', LINES: '40', TERM: 'xterm' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      persistentProcess.stdout.on('data', (data: Buffer) => { persistentOutput += data.toString(); });
      persistentProcess.stderr.on('data', (data: Buffer) => { persistentOutput += data.toString(); });
      
      // Initial wait to let shell settle
      await new Promise(r => setTimeout(r, 500));
    } else {
      // Update CWD if it changed
      persistentProcess.stdin.write(`cd "${resolve(cwd).replace(/\\/g, '/')}"\n`);
    }

    const marker = `__FORGE_TRANSACTION_${Math.random().toString(36).slice(2, 8)}__`;
    persistentOutput = '';
    
    // Command execution with delimiter and exit code capture
    const fullCommand = process.platform === 'win32'
      ? `${command}\nif ($?) { Write-Host "${marker}:0" } else { Write-Host "${marker}:$LASTEXITCODE" }\n`
      : `${command}\nif [ $? -eq 0 ]; then echo "${marker}:0"; else echo "${marker}:$?"; fi\n`;

    persistentProcess.stdin.write(fullCommand);

    return new Promise((resolve) => {
      const start = Date.now();
      const interval = setInterval(() => {
        if (persistentOutput.includes(marker)) {
          clearInterval(interval);
          const parts = persistentOutput.split(marker);
          const output = parts[0].trim();
          const exitCode = parseInt(parts[1].split(':')[1] || '0', 10);
          resolve({ output, exitCode: isNaN(exitCode) ? 0 : exitCode });
        } else if (Date.now() - start > timeout) {
          clearInterval(interval);
          resolve({ output: persistentOutput + '\n[Command timed out]', exitCode: -1 });
        }
      }, 100);
    });
  } finally {
    persistentBusy = false;
  }
}

/**
 * Base class for tool results
 */
export class ToolResult {
  success: boolean;
  summary: string;
  data: any;
  timestamp: string;

  constructor(success: boolean, summary: string, data: any = {}) {
    this.success = success;
    this.summary = summary;
    this.data = data;
    this.timestamp = new Date().toISOString();
  }
  
  toString(): string {
    const icon = this.success ? chalk.green('✓') : chalk.red('✗');
    return `${icon} ${this.summary}`;
  }
}

/**
 * Grep Tool - Search for patterns in files
 */
export async function grep(pattern: string, options: any = {}): Promise<ToolResult> {
  const {
    path = '.',
    glob = '**/*',
    ignoreCase = false,
    maxResults = 100
  } = options;
  
  try {
    const absolutePath = resolve(path);
    const stats = await stat(absolutePath).catch(() => null);
    
    if (!stats) {
      return new ToolResult(false, `Grep failed: Path does not exist: ${path}`);
    }

    let files: string[] = [];
    if (stats.isFile()) {
      files = [absolutePath];
    } else {
      files = await fg(glob, {
        cwd: absolutePath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**']
      });
    }
    
    const regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
    let totalMatches = 0;
    let filesWithMatches = 0;
    const results = [];
    
    for (const file of files) {
      if (results.length >= maxResults) break;
      
      try {
        const content = await readFile(file, 'utf-8');
        const matches = content.match(regex);
        
        if (matches) {
          totalMatches += matches.length;
          filesWithMatches++;
          results.push({
            file: stats.isFile() ? basename(file) : relative(absolutePath, file),
            count: matches.length
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
    
    return new ToolResult(true, 
      `Found ${chalk.bold(totalMatches)} matches in ${chalk.bold(filesWithMatches)} files`,
      { matches: totalMatches, files: filesWithMatches, results }
    );
  } catch (error: any) {
    return new ToolResult(false, `Grep failed: ${error.message}`);
  }
}

/**
 * Glob Tool - Find files by pattern
 */
export async function globTool(pattern: string, options: any = {}): Promise<ToolResult> {
  const {
    path = '.',
    onlyFiles = true,
    onlyDirectories = false,
    maxResults = 100
  } = options;
  
  try {
    const files = await fg(pattern, {
      cwd: resolve(path),
      absolute: false,
      onlyFiles,
      onlyDirectories,
      ignore: ['**/node_modules/**', '**/.git/**']
    } as any);
    
    return new ToolResult(true,
      `Matched ${chalk.bold(files.slice(0, maxResults).length)} files for ${chalk.gray(pattern)}`,
      { count: files.slice(0, maxResults).length, pattern, files: files.slice(0, maxResults) }
    );
  } catch (error: any) {
    return new ToolResult(false, `Glob failed: ${error.message}`);
  }
}

/**
 * Read Tool - Read file contents
 */
export async function read(filePath: string, options: any = {}): Promise<ToolResult> {
  const {
    startLine = 1,
    endLine = null,
    encoding = 'utf-8'
  } = options;
  
  try {
    const absolutePath = resolve(filePath);
    const content = (await readFile(absolutePath, encoding)).toString();
    const lines = content.split('\n');
    
    const start = Math.max(1, startLine);
    const end = endLine || lines.length;
    const selectedLines = lines.slice(start - 1, end);
    
    return new ToolResult(true,
      `Read lines ${chalk.bold(`${start}-${Math.min(end, lines.length)}`)} of ${chalk.cyan(filePath)}`,
      { 
        file: filePath,
        start,
        end: Math.min(end, lines.length),
        totalLines: lines.length,
        content: selectedLines.join('\n')
      }
    );
  } catch (error: any) {
    return new ToolResult(false, `Read failed: ${error.message}`);
  }
}

/**
 * Write Tool - Write to file
 */
export async function write(filePath: string, content: string, options: any = {}): Promise<ToolResult> {
  const {
    mode = 'overwrite',  // 'overwrite', 'append', 'insert'
    insertLine = null,
    createDirs = true
  } = options;
  
  try {
    const absolutePath = resolve(filePath);
    
    // Ensure directory exists
    if (createDirs) {
      await mkdir(dirname(absolutePath), { recursive: true });
    }
    
    let existingContent = '';
    let existingLines = 0;
    
    try {
      existingContent = (await readFile(absolutePath, 'utf-8')).toString();
      existingLines = existingContent.split('\n').length;
    } catch {
      // File doesn't exist
    }
    
    let newContent;
    const contentLines = content.split('\n').length;
    
    if (mode === 'append') {
      newContent = existingContent + (existingContent.endsWith('\n') ? '' : '\n') + content;
    } else if (mode === 'insert' && insertLine !== null) {
      const lines = existingContent.split('\n');
      lines.splice(insertLine - 1, 0, content);
      newContent = lines.join('\n');
    } else {
      newContent = content;
    }
    
    await writeFile(absolutePath, newContent, 'utf-8');
    
    const newLines = newContent.split('\n').length;
    const added = Math.max(0, newLines - existingLines);
    const removed = Math.max(0, existingLines - newLines + (mode === 'overwrite' ? existingLines : 0));
    
    const changes = [];
    if (added > 0) changes.push(chalk.green(`+${added}`));
    if (removed > 0 && mode === 'overwrite' && existingLines > 0) {
      changes.push(chalk.red(`-${existingLines}`));
    }
    
    return new ToolResult(true,
      `Wrote to ${chalk.cyan(filePath)} (${changes.length ? changes.join(', ') : 'created'})`,
      { file: filePath, added, removed: mode === 'overwrite' ? existingLines : 0, newLines }
    );
  } catch (error: any) {
    return new ToolResult(false, `Write failed: ${error.message}`);
  }
}

/**
 * Shell Tool - Execute shell command
 */
export async function shell(command: string, options: any = {}): Promise<ToolResult> {
  const {
    cwd = process.cwd(),
    timeout = DEFAULT_SHELL_TIMEOUT_MS,
    showOutput = false,
    isBackground = false,
    unsafe = false,
    allowOutsideWorkspace = false,
    sandbox = process.env.AGENTFORGE_SHELL_SANDBOX || 'docker',
    dockerImage = DEFAULT_DOCKER_SANDBOX_IMAGE
  } = options;
  
  try {
    const safeCommand = validateShellCommand(command, { unsafe });
    const safeCwd = resolveSandboxedCwd(cwd, { allowOutsideWorkspace });
    const safeTimeout = clampShellTimeout(timeout);
    const resolvedSandbox = String(sandbox).toLowerCase();
    if (!['host', 'docker'].includes(resolvedSandbox)) {
      return new ToolResult(false, `Unsupported sandbox option: ${sandbox}. Use "host" or "docker".`);
    }

    if (resolvedSandbox === 'docker') {
      await ensureDockerAvailable();
      const image = resolveDockerImage(dockerImage);

      if (isBackground) {
        const { containerId } = await startDockerBackgroundContainer(safeCommand, safeCwd, image);
        const procId = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        activeProcesses.set(procId, {
          id: procId,
          process: null,
          output: [],
          command: safeCommand,
          startedAt: new Date().toISOString(),
          kind: 'docker',
          containerId,
          sandbox: 'docker'
        });

        return new ToolResult(true,
          `Started docker sandbox process ${chalk.cyan(procId)} using ${chalk.gray(image)}`,
          { procId, command, sandbox: 'docker', dockerImage: image, containerId }
        );
      }

      const { output, exitCode } = await runInDockerSandbox(safeCommand, safeCwd, safeTimeout, image);
      lastCommandOutput = output;
      const lines = output.trim() ? output.trim().split('\n').length : 0;

      if (exitCode === 0) {
        return new ToolResult(true,
          `${chalk.gray('$')} ${chalk.bold(command.slice(0, 50))}${command.length > 50 ? '...' : ''} → ${chalk.green('Exit 0')} ${chalk.gray('[docker]')}`,
          {
            command,
            exitCode: 0,
            output: showOutput ? output : `(${lines} lines)`,
            fullOutput: output,
            lines,
            sandboxed: true,
            sandbox: 'docker',
            cwd: safeCwd,
            dockerImage: image
          }
        );
      }

      return new ToolResult(false,
        `${chalk.gray('$')} ${chalk.bold(command.slice(0, 50))} → ${chalk.red(`Exit ${exitCode}`)} ${chalk.gray('[docker]')}`,
        {
          command,
          exitCode,
          error: exitCode === -1 ? 'Command timed out' : `Command failed with exit code ${exitCode}`,
          output: output.slice(-2000),
          fullOutput: output,
          sandboxed: true,
          sandbox: 'docker',
          cwd: safeCwd,
          dockerImage: image
        }
      );
    }

    let finalCommand = safeCommand;
    
    // Windows compatibility: translate common Linux commands
    if (process.platform === 'win32') {
      if (safeCommand.startsWith('ls ')) {
        finalCommand = safeCommand.replace(/^ls\s+/, 'dir /B ');
      } else if (safeCommand === 'ls') {
        finalCommand = 'dir /B';
      } else if (safeCommand.startsWith('cat ')) {
        finalCommand = safeCommand.replace(/^cat\s+/, 'type ');
      } else if (safeCommand.startsWith('rm -rf ')) {
        finalCommand = safeCommand.replace(/^rm\s+-rf\s+/, 'rmdir /S /Q ');
      } else if (safeCommand.startsWith('rm ')) {
        finalCommand = safeCommand.replace(/^rm\s+/, 'del /Q ');
      } else if (safeCommand.startsWith('cp ')) {
        finalCommand = safeCommand.replace(/^cp\s+/, 'copy ');
      } else if (safeCommand.startsWith('mv ')) {
        finalCommand = safeCommand.replace(/^mv\s+/, 'move ');
      }
    }

    if (isBackground) {
      const procId = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const shellCmd = process.platform === 'win32' ? 'pwsh.exe' : 'bash';
      const shellArgs = process.platform === 'win32'
        ? ['-NoLogo', '-NoProfile', '-Command', finalCommand]
        : ['--noprofile', '--norc', '-c', finalCommand];

      const child = spawn(shellCmd, shellArgs, {
        cwd: safeCwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const entry: ActiveProcess = {
        id: procId,
        process: child,
        output: [],
        command: safeCommand,
        startedAt: new Date().toISOString()
      };
      activeProcesses.set(procId, entry);

      child.stdout?.on('data', (data) => entry.output.push(data.toString()));
      child.stderr?.on('data', (data) => entry.output.push(data.toString()));
      
      child.on('close', (code) => {
        // Keep in map but mark as finished
        (entry as any).exitCode = code;
        (entry as any).finishedAt = new Date().toISOString();
      });

      return new ToolResult(true, 
        `Started background process ${chalk.cyan(procId)}: ${chalk.bold(command.slice(0, 30))}`,
        { procId, command, sandbox: 'host' }
      );
    }

    const { output, exitCode } = await runInPersistentShell(finalCommand, safeCwd, safeTimeout);
    
    lastCommandOutput = output; 
    const lines = output.trim().split('\n').length;
    
    if (exitCode === 0) {
      return new ToolResult(true,
        `${chalk.gray('$')} ${chalk.bold(command.slice(0, 50))}${command.length > 50 ? '...' : ''} → ${chalk.green('Exit 0')}`,
        { 
          command, 
          exitCode: 0, 
          output: showOutput ? output : `(${lines} lines)`,
          fullOutput: output,
          lines,
          sandboxed: true,
          sandbox: 'host',
          cwd: safeCwd
        }
      );
    } else {
      return new ToolResult(false,
        `${chalk.gray('$')} ${chalk.bold(command.slice(0, 50))} → ${chalk.red(`Exit ${exitCode}`)}`,
        { 
          command, 
          exitCode, 
          error: exitCode === -1 ? 'Command timed out' : `Command failed with exit code ${exitCode}`,
          output: output.slice(-2000),
          fullOutput: output,
          sandboxed: true,
          sandbox: 'host',
          cwd: safeCwd
        }
      );
    }
  } catch (error: any) {
    const exitCode = error.code || 1;
    return new ToolResult(false,
      `Shell execution failed: ${error.message}`,
      { command, exitCode, error: error.message }
    );
  }
}

/**
 * Kill a background process
 */
export async function shellKill(procId: string): Promise<ToolResult> {
  const entry = activeProcesses.get(procId);
  if (!entry) return new ToolResult(false, `Process not found: ${procId}`);

  try {
    if (entry.kind === 'docker' && entry.containerId) {
      const killResult = await runProcess('docker', ['rm', '-f', entry.containerId], SHELL_SANDBOX_ROOT, 20000);
      if (killResult.exitCode !== 0) {
        return new ToolResult(false, `Failed to kill docker sandbox process: ${(killResult.stderr || killResult.stdout).trim()}`);
      }
      activeProcesses.delete(procId);
      return new ToolResult(true, `Killed docker sandbox process ${chalk.cyan(procId)} (${entry.command})`);
    }

    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${entry.process.pid} /T /F`).toString();
    } else {
      process.kill(-entry.process.pid); // Kill process group
    }
    activeProcesses.delete(procId);
    return new ToolResult(true, `Killed process ${chalk.cyan(procId)} (${entry.command})`);
  } catch (error: any) {
    return new ToolResult(false, `Failed to kill process: ${error.message}`);
  }
}

/**
 * Inventory Tool - Get detailed information about all available tools and toolkits
 */
export async function inventoryTool(options: any = {}): Promise<ToolResult> {
  const { query, toolkit } = options;
  
  const allTools = { ...staticTools, ...dynamicTools };
  const categories: Record<string, any[]> = {
    'built-in': [],
    'forged-core': [],
    'forged': [],
    'mcp': []
  };

  // Group tools
  for (const [name, tool] of Object.entries(allTools)) {
    const source = (tool as any).source || 'built-in';
    
    // Toolkit name is everything before the LAST underscore, or the source if no underscore
    let category = source;
    if (name.includes('_')) {
      const lastUnderscore = name.lastIndexOf('_');
      const potentialToolkit = name.substring(0, lastUnderscore);
      // If the potential toolkit is a known directory or source, use it
      category = potentialToolkit;
    }

    if (!categories[category]) categories[category] = [];
    
    const info = {
      name,
      description: (tool as any).description,
      parameters: (tool as any).parameters || {}
    };

    if (query) {
      const searchStr = `${name} ${(tool as any).description}`.toLowerCase();
      if (!searchStr.includes(query.toLowerCase())) continue;
    }

    if (toolkit && category !== toolkit) continue;

    categories[category].push(info);
  }

  // Filter out empty categories
  const result: Record<string, any[]> = {};
  for (const [cat, tools] of Object.entries(categories)) {
    if (tools.length > 0) result[cat] = tools;
  }

  // Fallback: If result is empty, something is wrong with categorization
  if (Object.keys(result).length === 0 && Object.keys(allTools).length > 0) {
    result['all-tools'] = Object.entries(allTools).map(([name, tool]) => ({
      name,
      description: (tool as any).description,
      parameters: (tool as any).parameters || {}
    }));
  }

  const summary = toolkit 
    ? `Toolkit "${toolkit}" contains ${result[toolkit]?.length || 0} tools`
    : `Collected inventory of ${Object.keys(allTools).length} available tools across ${Object.keys(result).length} categories: ${Object.keys(result).join(', ')}`;

  return new ToolResult(true, summary, { inventory: result });
}

/**
 * Get output of a background process or last command
 */
export async function shellOutput(options: any = {}): Promise<ToolResult> {
  const { procId, last = false } = options;

  if (last) {
    return new ToolResult(true, `Retrieved last command output (${lastCommandOutput.length} characters)`, {
      output: lastCommandOutput.slice(-5000) // Return last 5KB
    });
  }

  if (!procId) return new ToolResult(false, 'Expected procId or last: true');

  const entry = activeProcesses.get(procId);
  if (!entry) return new ToolResult(false, `Process not found: ${procId}`);

  if (entry.kind === 'docker' && entry.containerId) {
    try {
      const output = await getDockerLogs(entry.containerId);
      const isRunning = await isDockerContainerRunning(entry.containerId);
      return new ToolResult(true, `Retrieved output for docker sandbox process ${chalk.cyan(procId)}`, {
        command: entry.command,
        output: output.slice(-5000),
        isFinished: !isRunning,
        sandbox: 'docker',
        containerId: entry.containerId
      });
    } catch (error: any) {
      return new ToolResult(false, `Failed to read docker sandbox output: ${error.message}`);
    }
  }

  const output = entry.output.join('');
  return new ToolResult(true, `Retrieved output for process ${chalk.cyan(procId)}`, {
    command: entry.command,
    output: output.slice(-5000), // Return last 5KB
    isFinished: (entry as any).finishedAt !== undefined,
    exitCode: (entry as any).exitCode
  });
}

/**
 * Env Tool - Activate/manage virtual environments
 */
export async function env(action: string, envPath: string, options: any = {}): Promise<ToolResult> {
  const { type = 'auto' } = options;
  
  try {
    const absolutePath = resolve(envPath);
    
    // Detect environment type
    let envType = type;
    if (type === 'auto') {
      try {
        await access(join(absolutePath, 'pyvenv.cfg'));
        envType = 'python';
      } catch {
        try {
          await access(join(absolutePath, 'node_modules'));
          envType = 'node';
        } catch {
          envType = 'unknown';
        }
      }
    }
    
    if (action === 'activate') {
      // Set environment variables for child processes
      if (envType === 'python') {
        process.env.VIRTUAL_ENV = absolutePath;
        process.env.PATH = join(absolutePath, 'Scripts') + ';' + process.env.PATH;
      }
      
      return new ToolResult(true,
        `Activated ${chalk.cyan(envType)} env at ${chalk.gray(envPath)}`,
        { action, name: envPath, type: envType }
      );
    } else if (action === 'deactivate') {
      delete process.env.VIRTUAL_ENV;
      
      return new ToolResult(true,
        `Deactivated env`,
        { action }
      );
    } else if (action === 'create') {
      if (envType === 'python') {
        await shell(`python -m venv "${absolutePath}"`, { timeout: 60000 });
      }
      
      return new ToolResult(true,
        `Created ${chalk.cyan(envType)} env at ${chalk.gray(envPath)}`,
        { action, name: envPath, type: envType }
      );
    }
    
    return new ToolResult(false, `Unknown env action: ${action}`);
  } catch (error: any) {
    return new ToolResult(false, `Env ${action} failed: ${error.message}`);
  }
}

/**
 * Package Tool - Install/manage packages
 */
export async function packageTool(action: string, packages: any, options: any = {}): Promise<ToolResult> {
  const { 
    manager = 'auto',  // 'npm', 'pip', 'auto'
    dev = false,
    global = false
  } = options;
  
  try {
    // Detect package manager
    let pm = manager;
    if (manager === 'auto') {
      try {
        await access('package.json');
        pm = 'npm';
      } catch {
        try {
          await access('requirements.txt');
          pm = 'pip';
        } catch {
          pm = 'npm';  // Default to npm
        }
      }
    }
    
    const pkgList = Array.isArray(packages) ? packages : [packages];
    let command: string = '';
    
    if (pm === 'npm') {
      const flags = [dev ? '-D' : '', global ? '-g' : ''].filter(Boolean).join(' ');
      command = action === 'install' 
        ? `npm install ${flags} ${pkgList.join(' ')}`
        : `npm uninstall ${pkgList.join(' ')}`;
    } else if (pm === 'pip') {
      command = action === 'install'
        ? `pip install ${pkgList.join(' ')}`
        : `pip uninstall -y ${pkgList.join(' ')}`;
    }
    
    if (!command) {
      return new ToolResult(false, `Unknown package manager: ${pm}`);
    }
    
    const result = await shell(command, { timeout: 120000 });
    
    if ((result as any).success) {
      return new ToolResult(true,
        `${action === 'install' ? 'Installed' : 'Removed'} ${chalk.bold(pkgList.length)} package(s) via ${chalk.cyan(pm)}`,
        { action, packages: pkgList, manager: pm }
      );
    }
    
    return result;
  } catch (error: any) {
    return new ToolResult(false, `Package ${action} failed: ${error.message}`);
  }
}

/**
 * Diagnostic Tool - Check for syntax and type errors
 */
export async function checkTool(path: string = '.', options: any = {}): Promise<ToolResult> {
  const { type = 'auto', sandbox = process.env.AGENTFORGE_SHELL_SANDBOX || 'docker' } = options;
  
  try {
    const absolutePath = resolve(path);
    let checkMode = type;
    
    if (type === 'auto') {
      try {
        await access(join(absolutePath, 'tsconfig.json'));
        checkMode = 'ts';
      } catch {
        try {
          await access(join(absolutePath, 'package.json'));
          checkMode = 'js';
        } catch {
          checkMode = 'py';
        }
      }
    }
    
    let command = '';
    if (checkMode === 'ts') {
      command = 'npx tsc --noEmit';
    } else if (checkMode === 'js') {
      command = 'npx eslint . --ext .js,.jsx';
    } else if (checkMode === 'py') {
      command = 'python -m pyright .';
    }
    
    if (!command) {
      return new ToolResult(false, `No diagnostic command discovered for ${checkMode}`);
    }
    
    const shellResult = await shell(command, {
      cwd: absolutePath,
      timeout: 60000,
      sandbox,
      showOutput: true
    });

    if (shellResult.success) {
      return new ToolResult(true, `No errors found in ${chalk.cyan(path)}`, {
        output: shellResult.data?.fullOutput || shellResult.data?.output || '',
        sandbox: shellResult.data?.sandbox || sandbox
      });
    }

    const output = shellResult.data?.fullOutput || shellResult.data?.output || '';
    const errorMatches = String(output).match(/error|failed|fault/gi);
    const errorCount = errorMatches ? errorMatches.length : 'some';

    return new ToolResult(false,
      `Found ${chalk.red(errorCount)} issues in ${chalk.cyan(path)}`,
      {
        output,
        exitCode: shellResult.data?.exitCode || 1,
        sandbox: shellResult.data?.sandbox || sandbox
      }
    );
  } catch (error: any) {
    return new ToolResult(false, `Diagnostics failed: ${error.message}`);
  }
}

/**
 * Todo Tool - Manage project task list
 */
export async function todoTool(action: string, options: any = {}): Promise<ToolResult> {
  const { task = '', id = null, status = 'pending', items = [] } = options;
  const todoPath = resolve('AGENT_TODO.md');
  
  try {
    let content = '';
    try {
      content = await readFile(todoPath, 'utf-8');
    } catch {
      content = '# 📋 Project TODO List\n\n_Keep track of tasks and progress_\n\n';
    }

    let lines = content.split('\n');
    
    const getTasks = () => {
      const taskList: { id: number; title: string; completed: boolean; lineIndex: number }[] = [];
      let currentId = 0;
      for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        if (trimmedLine.startsWith('- [') || trimmedLine.startsWith('* [') || /^\[[ xX]?\]/.test(trimmedLine)) {
          const completed = /\[[xX]\]/.test(trimmedLine);
          const title = trimmedLine.replace(/^[-* ]?\[[ xX]?\]/, '').trim();
          taskList.push({ id: currentId++, title, completed, lineIndex: i });
        }
      }
      return taskList;
    };

    const normalizedAction = action === 'create' ? 'add' : action;

    if (normalizedAction === 'add') {
      const tasksToAdd = items.length > 0 ? items.map((it: any) => typeof it === 'string' ? it : it.task) : [task];
      for (const t of tasksToAdd) {
        if (t) {
          const newTask = t.trim();
          if (!lines.some(l => l.includes(newTask))) {
            lines.push(`- [ ] ${newTask}`);
          }
        }
      }
    } else if (normalizedAction === 'update' || normalizedAction === 'complete') {
      const updates = items.length > 0 ? items : (id !== null ? [{ id, status: action === 'complete' ? 'completed' : status }] : []);
      const currentTasks = getTasks();
      
      for (const update of updates) {
        const targetTask = currentTasks.find(t => t.id === update.id);
        if (targetTask) {
          const newStatus = action === 'complete' ? 'completed' : update.status;
          const sym = newStatus === 'completed' ? 'x' : ' ';
          lines[targetTask.lineIndex] = lines[targetTask.lineIndex].replace(/\[[ xX]?\]/, `[${sym}]`);
          if (update.task) {
             lines[targetTask.lineIndex] = lines[targetTask.lineIndex].replace(targetTask.title, update.task);
          }
        }
      }
    } else if (normalizedAction === 'delete') {
      const idsToDelete = items.length > 0 ? items.map((it: any) => typeof it === 'number' ? it : it.id) : (id !== null ? [id] : []);
      const currentTasks = getTasks();
      const lineIndicesToDelete = idsToDelete.map((id: any) => currentTasks.find(t => t.id === id)?.lineIndex).filter((idx: number | undefined) => idx !== undefined) as number[];
      lines = lines.filter((_, idx) => !lineIndicesToDelete.includes(idx));
    }

    content = lines.join('\n');
    await writeFile(todoPath, content, 'utf-8');

    // Display pretty list
    const finalTasks = getTasks();
    let displayOutput = `\n${chalk.bold.underline('📋 CURRENT TODO LIST')}\n`;
    if (finalTasks.length === 0) {
      displayOutput += chalk.gray('  (No items in list)\n');
    } else {
      for (const t of finalTasks) {
        const icon = t.completed ? chalk.green('✔') : chalk.yellow('○');
        const title = t.completed ? chalk.gray.strikethrough(t.title) : chalk.white(t.title);
        displayOutput += `  ${chalk.cyan(t.id.toString().padEnd(2))} ${icon} ${title}\n`;
      }
    }
    console.log(displayOutput);

    return new ToolResult(true, `TODO list updated: ${action}`, { path: 'AGENT_TODO.md', items: finalTasks });
  } catch (error: any) {
    return new ToolResult(false, `TODO management failed: ${error.message}`);
  }
}

/**
 * List Tool - Explorative directory listing
 */
export async function listTool(path: string = '.', options: any = {}): Promise<ToolResult> {
  const { depth = 1, showHidden = false, showDetails = false } = options;
  
  try {
    const absolutePath = resolve(path);
    
    async function scan(currentDir: string, currentDepth: number): Promise<any[]> {
      if (currentDepth > depth) return [];
      
      const entries = await readdir(currentDir, { withFileTypes: true });
      const results: any[] = [];
      
      for (const entry of entries) {
        if (!showHidden && entry.name.startsWith('.')) continue;
        
        const fullPath = join(currentDir, entry.name);
        const relPath = relative(absolutePath, fullPath);
        const isDirectory = entry.isDirectory();
        
        let details = {};
        if (showDetails) {
          try {
            const stats = await stat(fullPath);
            details = {
              size: stats.size,
              mtime: stats.mtime,
              mode: stats.mode
            };
          } catch {}
        }
        
        results.push({
          name: entry.name,
          path: relPath || entry.name,
          type: isDirectory ? 'directory' : 'file',
          ...details,
          children: isDirectory && currentDepth < depth ? await scan(fullPath, currentDepth + 1) : undefined
        });
      }
      
      return results;
    }
    
    const items = await scan(absolutePath, 1);
    const summary = `${items.length} items found in ${chalk.cyan(path)}`;
    
    return new ToolResult(true, summary, { items });
  } catch (error: any) {
    return new ToolResult(false, `List failed: ${error.message}`);
  }
}

/**
 * MCP Tool - Connect to and call MCP servers
 */
export async function mcpTool(action: string, options: any = {}, mcpClient?: any): Promise<ToolResult> {
  if (!mcpClient) {
    return new ToolResult(false, 'MCP Client not available in this context');
  }

  try {
    if (action === 'list') {
      const serverMap = mcpClient.listConnectedServers();
      const servers = Array.from(serverMap.entries()).map((entry: any) => {
        const [id, info] = entry;
        return { id, ...info };
      });
      return new ToolResult(true, `Found ${servers.length} configured MCP servers`, { servers });
    } else if (action === 'connect') {
      const { serverId, url, name = serverId } = options;
      const info = await mcpClient.connect(serverId, url, name);
      return new ToolResult(true, `Connected to MCP server: ${info.name}`, { info });
    } else if (action === 'call') {
      const { serverId, toolName, args = {} } = options;
      const result = await mcpClient.callTool({ serverId, toolName, arguments: args });
      return new ToolResult(result.success, result.success ? `MCP tool ${toolName} executed` : `MCP tool ${toolName} failed: ${result.error}`, result);
    }
    
    return new ToolResult(false, `Unknown MCP action: ${action}`);
  } catch (error: any) {
    return new ToolResult(false, `MCP operation failed: ${error.message}`);
  }
}

/**
 * Skill Tool - Read and apply specialized engineering skills
 */
export async function skillTool(action: string, options: any = {}): Promise<ToolResult> {
  const { join } = await import('path');
  const { homedir } = await import('os');
  
  const skillPaths = options.paths || [
    join(homedir(), '.copilot', 'skills'),
    join(homedir(), '.claude', 'skills')
  ];

  try {
    if (action === 'list') {
      const allSkills: any[] = [];
      const { existsSync } = await import('fs');
      const { readdir, readFile } = await import('fs/promises');

      for (const basePath of skillPaths) {
        if (!existsSync(basePath)) continue;
        const dirs = await readdir(basePath);
        for (const dir of dirs) {
          const skillDir = join(basePath, dir);
          const skillFile = join(skillDir, 'SKILL.md');
          if (existsSync(skillFile)) {
            const content = await readFile(skillFile, 'utf-8');
            const titleMatch = content.match(/^#\s+(.*)/m);
            const descMatch = content.match(/^##\s+Description\n([\s\S]*?)\n##/i) || content.match(/^> (.*)/m);
            
            allSkills.push({
              id: dir,
              path: skillFile,
              name: titleMatch ? titleMatch[1].trim() : dir,
              description: descMatch ? descMatch[1].trim().split('\n')[0] : 'No description'
            });
          }
        }
      }
      return new ToolResult(true, `Found ${allSkills.length} available skills`, { skills: allSkills });
    } else if (action === 'read') {
      const { id } = options;
      if (!id) return new ToolResult(false, 'Skill ID is required for "read" action');

      const { existsSync } = await import('fs');
      const { readFile } = await import('fs/promises');

      for (const basePath of skillPaths) {
        const skillFile = join(basePath, id, 'SKILL.md');
        if (existsSync(skillFile)) {
          const content = await readFile(skillFile, 'utf-8');
          return new ToolResult(true, `Successfully read skill: ${id}`, { id, content });
        }
      }
      return new ToolResult(false, `Skill not found: ${id}`);
    }
    return new ToolResult(false, `Unknown skill action: ${action}`);
  } catch (error: any) {
    return new ToolResult(false, `Skill operation failed: ${error.message}`);
  }
}

/**
 * Edit Tool - Make surgical edits to files
 */
export async function edit(filePath: string, oldContent: string, newContent: string, options: any = {}): Promise<ToolResult> {
  try {
    const absolutePath = resolve(filePath);
    let fileContent = (await readFile(absolutePath, 'utf-8')).toString();
    
    // Normalize function for robust matching
    // 1. Convert all line endings to \n
    // 2. (Optional but advised) Trim trailing whitespace on lines
    const normalize = (str: string) => str.replace(/\r\n/g, '\n');
    
    let normalizedFile = normalize(fileContent);
    let normalizedOld = normalize(oldContent);
    let normalizedNew = normalize(newContent);
    
    // If exact normalized match fails, try trimming leading/trailing blank lines from oldContent
    if (!normalizedFile.includes(normalizedOld)) {
      const trimmedOld = normalizedOld.trim();
      if (normalizedFile.includes(trimmedOld)) {
        // Find where it matches and perform the replacement
        normalizedOld = trimmedOld;
        // We also need to find the correct context in the original if we wanted to preserve it,
        // but here we are working with normalized anyway.
      }
    }
    
    if (!normalizedFile.includes(normalizedOld)) {
      return new ToolResult(false, 
        `Edit failed: old content not found in ${chalk.cyan(filePath)}. ` + 
        `Tip: Match 3-5 lines of context exactly, including indentation and whitespace.`
      );
    }
    
    // Count occurrences in normalized file
    const occurrences = (normalizedFile.match(new RegExp(escapeRegex(normalizedOld), 'g')) || []).length;
    
    if (occurrences > 1) {
      return new ToolResult(false,
        `Edit failed: ${occurrences} matches found (expected 1) in ${chalk.cyan(filePath)}. ` +
        `Tip: Provide more context to uniquely identify the section.`
      );
    }
    
    const updatedContent = normalizedFile.replace(normalizedOld, normalizedNew);
    await writeFile(absolutePath, updatedContent, 'utf-8');
    
    const oldLines = normalizedOld.split('\n').filter(l => l.trim()).length;
    const newLines = normalizedNew.split('\n').filter(l => l.trim()).length;
    const diff = newLines - oldLines;
    
    const changes = [];
    if (diff > 0) changes.push(chalk.green(`+${diff}`));
    if (diff < 0) changes.push(chalk.red(`${diff}`));
    if (diff === 0) changes.push(chalk.gray('modified'));
    
    return new ToolResult(true,
      `Edited ${chalk.cyan(filePath)} (${changes.join('')})`,
      { file: filePath, added: Math.max(0, diff), removed: Math.max(0, -diff) }
    );
  } catch (error: any) {
    return new ToolResult(false, `Edit failed: ${error.message}`);
  }
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Dynamic tool storage for forged tools
 */
const dynamicTools: Record<string, any> = {};

/**
 * Register a dynamically forged tool at runtime
 */
export function registerDynamicTool(name: string, tool: {
  description: string;
  parameters: Record<string, any>;
  execute: (...args: any[]) => Promise<any>;
  source?: string;
}): void {
  dynamicTools[name] = {
    name,
    description: tool.description,
    parameters: tool.parameters,
    execute: tool.execute,
    source: tool.source || 'forged',
    registeredAt: new Date().toISOString()
  };
}

/**
 * Unregister a dynamic tool
 */
export function unregisterDynamicTool(name: string): boolean {
  if (dynamicTools[name]) {
    delete dynamicTools[name];
    return true;
  }
  return false;
}

/**
 * Get all dynamic tools
 */
export function getDynamicTools(): Record<string, any> {
  return { ...dynamicTools };
}

/**
 * Register a forged tool from a file path
 * This is used for immediate registration after generation
 */
export async function registerForgedToolFromFile(name: string, filePath: string): Promise<boolean> {
  try {
    // We use a query param to cache-bust the import in case of redeployments in same session
    const modulePath = `file://${filePath}?update=${Date.now()}`;
    const module = await import(modulePath);
    
    if (typeof module[name] === 'function') {
      registerDynamicTool(name, {
        description: module[name].description || `Directly forged tool: ${name}`,
        parameters: module[name].parameters || {},
        execute: module[name],
        source: 'forged'
      });
      return true;
    }
    return false;
  } catch (error) {
    console.error(chalk.red(`Failed to register forged tool ${name}:`), error);
    return false;
  }
}

/**
 * Create a tool executor from generated Python code
 * This creates a JavaScript wrapper that calls the Python code via shell
 */
export function createToolExecutor(name: string, sourceCode: string): (...args: any[]) => Promise<ToolResult> {
  return async (...args: any[]): Promise<ToolResult> => {
    try {
      // Write the source code to a temp file
      const { writeFile, unlink } = await import('fs/promises');
      const { tmpdir } = await import('os');
      const { join } = await import('path');
      
      const tempFile = join(tmpdir(), `agentforge_tool_${name}_${Date.now()}.py`);
      
      // Create a wrapper that calls the main function with JSON args
      const wrappedCode = `${sourceCode}

if __name__ == "__main__":
    import sys
    import json
    
    try:
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        result = main(**args) if 'main' in dir() else ${name}(**args)
        print(json.dumps({"success": True, "data": result}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
`;
      
      await writeFile(tempFile, wrappedCode, 'utf-8');
      
      // Execute the Python script
      const argsJson = JSON.stringify(args[0] || {});
      const result = await shell(`python "${tempFile}" '${argsJson.replace(/'/g, "\\'")}'`, { timeout: 60000 });
      
      // Clean up temp file
      try {
        await unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
      
      // Parse the result
      if ((result as any).data?.output) {
        try {
          const output = JSON.parse((result as any).data.output);
          if (output.success) {
            return new ToolResult(true, `${name} completed`, output.data);
          } else {
            return new ToolResult(false, `${name} failed: ${output.error}`);
          }
        } catch {
          return new ToolResult(true, `${name} completed`, { raw: (result as any).data.output });
        }
      }
      
      return result as ToolResult;
    } catch (error: any) {
      return new ToolResult(false, `${name} execution failed: ${error.message}`);
    }
  };
}

/**
 * Load forged tools from the tools directory
 * This allows newly forged .ts tools to be automatically registered.
 */
export async function loadForgedTools(): Promise<void> {
  try {
    // Search for all .ts files in the tools directory and its subdirectories
    const entries = await fg(['**/*.ts'], {
      cwd: __dirname,
      ignore: ['index.ts', 'declarations.d.ts', 'search.ts'],
      absolute: false
    });

    for (const file of entries) {
      const fileName = basename(file, '.ts');
      const dirName = dirname(file);
      const isSubdir = dirName !== '.';
      
      // If in a subdir, use it as a prefix (toolkit namespace)
      const toolName = isSubdir 
        ? `${dirName.replace(/[\/\\]/g, '_')}_${fileName}`
        : fileName;
      
      try {
        // Dynamic import using relative path
        const modulePath = `./${file.replace(/\\/g, '/')}`;
        const module = await import(modulePath);
        
        // Find the tool function (either named export or default export)
        const toolFn = (typeof module[fileName] === 'function') 
          ? module[fileName] 
          : (module.default && (module.default.name === fileName || !module.default.name)) 
            ? module.default 
            : null;

        if (toolFn && typeof toolFn === 'function') {
          registerDynamicTool(toolName, {
            description: toolFn.description || `Autonomous tool: ${fileName}`,
            parameters: toolFn.parameters || {},
            execute: toolFn,
            source: isSubdir ? dirName.replace(/[\/\\]/g, '_') : 'forged-core'
          });
        }
      } catch (err: any) {
        console.error(chalk.red(`[Forge Loader] Failed to load tool ${file}:`), err.message);
      }
    }
  } catch (error) {
    // Directory unreadable or other issue
  }
}

/**
 * Static tool registry for the agent
 */
const staticTools: Record<string, any> = {
  grep: {
    name: 'grep',
    description: 'Search for patterns in files',
    parameters: {
      pattern: { type: 'string', required: true },
      path: { type: 'string', default: '.' },
      glob: { type: 'string', default: '**/*' },
      ignoreCase: { type: 'boolean', default: false }
    },
    execute: grep
  },
  glob: {
    name: 'glob',
    description: 'Find files matching a pattern',
    parameters: {
      pattern: { type: 'string', required: true },
      path: { type: 'string', default: '.' }
    },
    execute: globTool
  },
  read: {
    name: 'read',
    description: 'Read file contents',
    parameters: {
      filePath: { type: 'string', required: true },
      startLine: { type: 'number', default: 1 },
      endLine: { type: 'number', default: null }
    },
    execute: read
  },
  write: {
    name: 'write',
    description: 'Write content to a file',
    parameters: {
      filePath: { type: 'string', required: true },
      content: { type: 'string', required: true },
      mode: { type: 'string', default: 'overwrite' }
    },
    execute: write
  },
  edit: {
    name: 'edit',
    description: 'Make surgical edits to files',
    parameters: {
      filePath: { type: 'string', required: true },
      oldContent: { type: 'string', required: true },
      newContent: { type: 'string', required: true }
    },
    execute: edit
  },
  shell: {
    name: 'shell',
    description: 'Execute shell commands in a workspace sandbox with safety checks',
    parameters: {
      command: { type: 'string', required: true },
      cwd: { type: 'string', default: '.' },
      timeout: { type: 'number', default: 30000 },
      isBackground: { type: 'boolean', default: false, description: 'Run in background without blocking' },
      sandbox: { type: 'string', default: 'host', description: 'Execution sandbox: "host" or "docker"' },
      dockerImage: { type: 'string', default: DEFAULT_DOCKER_SANDBOX_IMAGE, description: 'Docker image used when sandbox is "docker"' },
      unsafe: { type: 'boolean', default: false, description: 'Disable dangerous-command blocking (not recommended)' },
      allowOutsideWorkspace: { type: 'boolean', default: false, description: 'Allow cwd outside workspace sandbox root' }
    },
    execute: shell
  },
  shell_kill: {
    name: 'shell_kill',
    description: 'Kill a background process by ID',
    parameters: {
      procId: { type: 'string', required: true }
    },
    execute: shellKill
  },
  shell_output: {
    name: 'shell_output',
    description: 'Get last command output or background process output',
    parameters: {
      procId: { type: 'string', description: 'Background process ID' },
      last: { type: 'boolean', default: false, description: 'Get output of the last synchronous command' }
    },
    execute: shellOutput
  },
  inventory: {
    name: 'inventory',
    description: 'List all available tools and specialized toolkits with detailed parameter info',
    parameters: {
      query: { type: 'string', description: 'Search for tools by name or description' },
      toolkit: { type: 'string', description: 'Filter by specific toolkit name' }
    },
    execute: inventoryTool
  },
  env: {
    name: 'env',
    description: 'Manage virtual environments',
    parameters: {
      action: { type: 'string', required: true },
      envPath: { type: 'string', required: true }
    },
    execute: env
  },
  package: {
    name: 'package',
    description: 'Install or remove packages',
    parameters: {
      action: { type: 'string', required: true },
      packages: { type: 'array', required: true }
    },
    execute: packageTool
  },
  check: {
    name: 'check',
    description: 'Run project diagnostics (tsc, eslint, pyright)',
    parameters: {
      path: { type: 'string', default: '.' },
      type: { type: 'string', default: 'auto' }
    },
    execute: checkTool
  },
  todo: {
    name: 'todo',
    description: 'Manage project TODO list with batch support',
    parameters: {
      action: { type: 'string', required: true, description: '"add", "update", "complete", "delete", or "list"' },
      task: { type: 'string', description: 'Single task title' },
      id: { type: 'number', description: 'Single ID for update/complete/delete' },
      status: { type: 'string', description: 'New status for update' },
      items: { type: 'array', description: 'Batch items: array of strings for "add", or objects {id, status, task} for update' }
    },
    execute: todoTool
  },
  list: {
    name: 'list',
    description: 'List directory contents with depth control',
    parameters: {
      path: { type: 'string', default: '.' },
      depth: { type: 'number', default: 1 },
      showHidden: { type: 'boolean', default: false },
      showDetails: { type: 'boolean', default: false }
    },
    execute: listTool
  },
  mcp: {
    name: 'mcp',
    description: 'Manage and call MCP servers',
    parameters: {
      action: { type: 'string', required: true },
      serverId: { type: 'string' },
      url: { type: 'string' },
      toolName: { type: 'string' },
      args: { type: 'object' }
    },
    execute: mcpTool
  },
  skill: {
    name: 'skill',
    description: 'Read and apply specialized engineering skills from the local library',
    parameters: {
      action: { type: 'string', required: true, description: 'The action to perform: "list" or "read"' },
      id: { type: 'string', description: 'The unique ID of the skill to read (required for "read")' },
      paths: { type: 'array', description: 'Optional list of base paths to search for skills' }
    },
    execute: skillTool
  },
  "forge-audit": {
    name: "forge-audit",
    description: "Analyze current toolset for gaps and suggest improvements",
    parameters: {},
    execute: async () => {
      return new ToolResult(true, "Toolset audit requested. Recommend user run 'af forge --audit' for manual review or proceed with auto-evolution.");
    }
  },
  search: {
    name: 'search',
    description: 'Unrestricted web search (DuckDuckGo/Brave) to find documentation, code, or information.',
    parameters: {
      query: { type: 'string', required: true },
      maxResults: { type: 'number', default: 5 },
      useBrave: { type: 'boolean', default: false }
    },
    execute: search
  },
  browse: {
    name: 'browse',
    description: 'Directly extract clean text content from any website URL.',
    parameters: {
      url: { type: 'string', required: true }
    },
    execute: browse
  },
  spawn_terminal: {
    name: 'spawn_terminal',
    description: 'Open a real, visible terminal window on the desktop for long-running tasks or manual oversight.',
    parameters: {
      command: { type: 'string', description: 'Initial command to run' },
      cwd: { type: 'string', description: 'Working directory for the new terminal' },
      title: { type: 'string', description: 'Window title (Windows only)' }
    },
    execute: spawnTerminal
  },
  // Virtual Phone Controller Toolkit
  Virtual_Phone_Controller_VisualInterface: {
    name: 'Virtual_Phone_Controller_VisualInterface',
    description: (VisualInterface as any).description,
    parameters: (VisualInterface as any).parameters,
    execute: VisualInterface,
    source: 'Virtual_Phone_Controller'
  },
  Virtual_Phone_Controller_DeviceOrchestrator: {
    name: 'Virtual_Phone_Controller_DeviceOrchestrator',
    description: (DeviceOrchestrator as any).description,
    parameters: (DeviceOrchestrator as any).parameters,
    execute: DeviceOrchestrator,
    source: 'Virtual_Phone_Controller'
  },
  Virtual_Phone_Controller_SystemRelay: {
    name: 'Virtual_Phone_Controller_SystemRelay',
    description: (SystemRelay as any).description,
    parameters: (SystemRelay as any).parameters,
    execute: SystemRelay,
    source: 'Virtual_Phone_Controller'
  },
  // Autonomous Memory Suite Toolkit
  Autonomous_Memory_Suite_AnalyzeFailure: {
    name: 'Autonomous_Memory_Suite_AnalyzeFailure',
    description: (AnalyzeFailure as any).description,
    parameters: (AnalyzeFailure as any).parameters,
    execute: AnalyzeFailure,
    source: 'Autonomous_Memory_Suite'
  },
  Autonomous_Memory_Suite_DecomposeObjective: {
    name: 'Autonomous_Memory_Suite_DecomposeObjective',
    description: (DecomposeObjective as any).description,
    parameters: (DecomposeObjective as any).parameters,
    execute: DecomposeObjective,
    source: 'Autonomous_Memory_Suite'
  },
  Autonomous_Memory_Suite_PersistTrace: {
    name: 'Autonomous_Memory_Suite_PersistTrace',
    description: (PersistTrace as any).description,
    parameters: (PersistTrace as any).parameters,
    execute: PersistTrace,
    source: 'Autonomous_Memory_Suite'
  },
  Autonomous_Memory_Suite_UpdateHeuristics: {
    name: 'Autonomous_Memory_Suite_UpdateHeuristics',
    description: (UpdateHeuristics as any).description,
    parameters: (UpdateHeuristics as any).parameters,
    execute: UpdateHeuristics,
    source: 'Autonomous_Memory_Suite'
  }
};

/**
 * Combined tool registry (static + dynamic)
 * This getter ensures dynamic tools are always included
 */
export const tools: Record<string, any> = new Proxy(staticTools, {
  get(target, prop) {
    if (prop === Symbol.iterator || prop === 'entries') {
      return function* () {
        const seen = new Set<string>();
        for (const key of Object.keys(target)) {
          seen.add(key);
          yield [key, target[key]];
        }
        for (const key of Object.keys(dynamicTools)) {
          if (!seen.has(key)) {
            seen.add(key);
            yield [key, dynamicTools[key]];
          }
        }
      };
    }
    if (typeof prop === 'string') {
      return target[prop] || dynamicTools[prop];
    }
    return undefined;
  },
  has(target, prop) {
    return prop in target || prop in dynamicTools;
  },
  ownKeys(target) {
    return Array.from(new Set([...Object.keys(target), ...Object.keys(dynamicTools)]));
  },
  getOwnPropertyDescriptor(target, prop) {
    if (prop in target) {
      return Object.getOwnPropertyDescriptor(target, prop);
    }
    if (typeof prop === 'string' && prop in dynamicTools) {
      return { enumerable: true, configurable: true, value: dynamicTools[prop] };
    }
    return undefined;
  }
});

export default tools;
