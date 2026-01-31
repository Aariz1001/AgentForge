/**
 * Agent Tools
 * ===========
 * Tool implementations for the AgentForge agent.
 * Each tool returns minimal output (1-2 lines).
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, access, mkdir, readdir, stat } from 'fs/promises';
import { basename, dirname, join, relative, resolve } from 'path';
import fg from 'fast-glob';
import chalk from 'chalk';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { search, browse } from './search';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execAsync = promisify(exec);

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
    timeout = 30000,
    showOutput = false
  } = options;
  
  try {
    let finalCommand = command;
    
    // Windows compatibility: translate common Linux commands
    if (process.platform === 'win32') {
      if (command.startsWith('ls ')) {
        finalCommand = command.replace(/^ls\s+/, 'dir /B ');
      } else if (command === 'ls') {
        finalCommand = 'dir /B';
      } else if (command.startsWith('cat ')) {
        finalCommand = command.replace(/^cat\s+/, 'type ');
      } else if (command.startsWith('rm -rf ')) {
        finalCommand = command.replace(/^rm\s+-rf\s+/, 'rmdir /S /Q ');
      } else if (command.startsWith('rm ')) {
        finalCommand = command.replace(/^rm\s+/, 'del /Q ');
      } else if (command.startsWith('cp ')) {
        finalCommand = command.replace(/^cp\s+/, 'copy ');
      } else if (command.startsWith('mv ')) {
        finalCommand = command.replace(/^mv\s+/, 'move ');
      }
    }

    const { stdout, stderr } = await execAsync(finalCommand, {
      cwd: resolve(cwd),
      timeout,
      maxBuffer: 10 * 1024 * 1024  // 10MB
    });
    
    const output = stdout + stderr;
    const lines = output.trim().split('\n').length;
    
    return new ToolResult(true,
      `${chalk.gray('$')} ${chalk.bold(command.slice(0, 50))}${command.length > 50 ? '...' : ''} → ${chalk.green('Exit 0')}`,
      { 
        command, 
        exitCode: 0, 
        output: showOutput ? output : `(${lines} lines)`,
        fullOutput: output,
        lines
      }
    );
  } catch (error: any) {
    const exitCode = error.code || 1;
    return new ToolResult(false,
      `${chalk.gray('$')} ${chalk.bold(command.slice(0, 50))} → ${chalk.red(`Exit ${exitCode}`)}`,
      { 
        command, 
        exitCode, 
        error: error.message,
        stderr: error.stderr,
        fullOutput: `${error.stdout || ''}${error.stderr || ''}`
      }
    );
  }
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
  const { type = 'auto' } = options;
  
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
    
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: absolutePath, timeout: 60000 });
      return new ToolResult(true, `No errors found in ${chalk.cyan(path)}`, { output: stdout + stderr });
    } catch (error: any) {
      const output = (error.stdout || '') + (error.stderr || '');
      // Try to count errors
      const errorMatches = output.match(/error|failed|fault/gi);
      const errorCount = errorMatches ? errorMatches.length : 'some';
      
      return new ToolResult(false, 
        `Found ${chalk.red(errorCount)} issues in ${chalk.cyan(path)}`,
        { output, exitCode: error.code || 1 }
      );
    }
  } catch (error: any) {
    return new ToolResult(false, `Diagnostics failed: ${error.message}`);
  }
}

/**
 * Todo Tool - Manage project task list
 */
export async function todoTool(action: string, options: any = {}): Promise<ToolResult> {
  const { task = '', id = null, status = 'pending' } = options;
  const todoPath = resolve('AGENT_TODO.md');
  
  try {
    let content = '';
    try {
      content = await readFile(todoPath, 'utf-8');
    } catch {
      content = '# 📋 Project TODO List\n\n_Keep track of tasks and progress_\n\n';
    }
    
    if (action === 'add' && task) {
      content += `- [ ] ${task}\n`;
    } else if (action === 'update' && id !== null) {
      const lines = content.split('\n');
      let currentId = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('- [')) {
          if (currentId === id) {
            const sym = status === 'completed' ? 'x' : ' ';
            lines[i] = lines[i].replace(/\[[ xX]?\]/, `[${sym}]`);
            break;
          }
          currentId++;
        }
      }
      content = lines.join('\n');
    } else if (action === 'list') {
      return new ToolResult(true, 'TODO list retrieved', { content });
    }
    
    await writeFile(todoPath, content, 'utf-8');
    return new ToolResult(true, `TODO list updated: ${action}`, { path: 'AGENT_TODO.md', content });
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
      const toolName = basename(file, '.ts');
      
      try {
        // Dynamic import using relative path
        const modulePath = `./${file}`;
        const module = await import(modulePath);
        
        // If it exports a function with the same name, register it
        if (typeof module[toolName] === 'function') {
          registerDynamicTool(toolName, {
            description: module[toolName].description || `Autonomous tool: ${toolName}`,
            parameters: module[toolName].parameters || {},
            execute: module[toolName],
            source: 'forged-core'
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
    description: 'Execute shell commands',
    parameters: {
      command: { type: 'string', required: true },
      cwd: { type: 'string', default: '.' },
      timeout: { type: 'number', default: 30000 }
    },
    execute: shell
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
    description: 'Manage project TODO list',
    parameters: {
      action: { type: 'string', required: true },
      task: { type: 'string' },
      id: { type: 'number' },
      status: { type: 'string' }
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
