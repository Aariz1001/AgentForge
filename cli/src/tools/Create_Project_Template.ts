import { ToolResult } from './index';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface FrameworkConfig {
  command: string;
  args: (projectName: string, options?: any) => string[];
  description: string;
  requiresGlobal?: boolean;
}

const FRAMEWORKS: Record<string, FrameworkConfig> = {
  flutter: {
    command: 'flutter',
    args: (name) => ['create', name],
    description: 'Flutter mobile project'
  },
  'vscode-extension': {
    command: 'yo',
    args: () => ['code'],
    description: 'VSCode Extension (requires: npm install -g yo generator-code)',
    requiresGlobal: true
  },
  react: {
    command: 'npx',
    args: (name) => ['create-react-app', name],
    description: 'React application'
  },
  'next-js': {
    command: 'npx',
    args: (name, opts) => ['create-next-app@latest', name, ...(opts?.typescript ? ['--typescript'] : []), '--eslint', '--tailwind', '--src-dir', '--app', '--import-alias', '@/*', '--use-npm'],
    description: 'Next.js application'
  },
  nodejs: {
    command: 'npm',
    args: (name) => ['init', '-y'],
    description: 'Node.js project'
  },
  typescript: {
    command: 'npx',
    args: (name) => ['tsc', '--init'],
    description: 'TypeScript configuration'
  },
  python: {
    command: 'python',
    args: (name) => ['-m', 'venv', name],
    description: 'Python virtual environment'
  },
  rust: {
    command: 'cargo',
    args: (name) => ['new', name],
    description: 'Rust project'
  },
  go: {
    command: 'go',
    args: (name) => ['mod', 'init', name],
    description: 'Go module'
  },
  vue: {
    command: 'npm',
    args: (name) => ['create', 'vue@latest', name],
    description: 'Vue.js project'
  }
};

/**
 * Creates project templates for various frameworks and languages by executing
 * the appropriate CLI initialization commands.
 * 
 * @param args.framework - The framework type (flutter, react, next-js, etc.)
 * @param args.projectName - Name of the project to create
 * @param args.directory - Target directory (defaults to current working directory)
 * @param args.options - Framework-specific options
 * @returns ToolResult containing success status, message, and project metadata
 */
export async function Create_Project_Template(args: any, options: any = {}): Promise<ToolResult> {
  try {
    const { framework, projectName, directory = process.cwd() || '.', ...frameworkOptions } = args || {};
    
    if (!framework) {
      return new ToolResult(false, `Framework is required. Available frameworks: ${Object.keys(FRAMEWORKS).join(', ')}`);
    }
    
    if (!projectName) {
      return new ToolResult(false, 'Project name is required');
    }

    const config = FRAMEWORKS[framework.toLowerCase()];
    if (!config) {
      return new ToolResult(false, `Unsupported framework: ${framework}. Supported: ${Object.keys(FRAMEWORKS).join(', ')}`);
    }

    // Validate project name (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-_]*$/.test(projectName)) {
      return new ToolResult(false, 'Project name must start with alphanumeric and contain only letters, numbers, hyphens, and underscores');
    }

    const targetPath = path.resolve(directory, projectName);
    
    // Check if target directory already exists
    if (fs.existsSync(targetPath)) {
      return new ToolResult(false, `Directory already exists: ${targetPath}`);
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const cmdArgs = config.args(projectName, frameworkOptions);
    
    console.log(chalk.blue(`🔨 Creating ${config.description}...`));
    console.log(chalk.gray(`   Command: ${config.command} ${cmdArgs.join(' ')}`));
    console.log(chalk.gray(`   Location: ${targetPath}`));

    return new Promise((resolve) => {
      const child = spawn(config.command, cmdArgs, {
        cwd: directory,
        stdio: 'pipe',
        shell: true,
        env: { ...process.env, CI: 'true' } // CI mode for non-interactive prompts where supported
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (chunk.trim()) console.log(chalk.gray(chunk.trim()));
      });

      child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (chunk.trim()) console.error(chalk.yellow(chunk.trim()));
      });

      child.on('close', (code) => {
        if (code === 0) {
          const files = listProjectFiles(targetPath, 2);
          resolve(new ToolResult(true, `✅ Successfully created ${config.description} "${projectName}" at ${targetPath}`, {
            framework,
            projectName,
            path: targetPath,
            command: `${config.command} ${cmdArgs.join(' ')}`,
            filesCreated: files,
            requiresGlobal: config.requiresGlobal || false
          }));
        } else {
          resolve(new ToolResult(false, `❌ Failed to create project (exit code ${code}). ${stderr || 'Check that the required CLI tools are installed.'}`, {
            framework,
            projectName,
            attemptedPath: targetPath,
            error: stderr,
            hint: config.requiresGlobal ? `This framework requires global installation: ${config.description}` : undefined
          }));
        }
      });

      child.on('error', (error: any) => {
        if (error.code === 'ENOENT') {
          resolve(new ToolResult(false, `Command '${config.command}' not found. Please install the required CLI tools for ${framework}.\nDetails: ${error.message}`, {
            framework,
            installHint: config.requiresGlobal ? `Try: npm install -g ${framework === 'vscode-extension' ? 'yo generator-code' : config.command}` : `Ensure ${config.command} is installed and in PATH`
          }));
        } else {
          resolve(new ToolResult(false, `Process error: ${error.message}`));
        }
      });
    });

  } catch (error: any) {
    return new ToolResult(false, `Tool execution failed: ${error.message}`);
  }
}

/**
 * Recursively lists files in a directory up to specified depth
 */
function listProjectFiles(dir: string, depth: number): string[] {
  if (depth <= 0 || !fs.existsSync(dir)) return [];
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      
      if (entry.isDirectory()) {
        files.push(`${entry.name}/`);
        if (depth > 1) {
          const subFiles = listProjectFiles(path.join(dir, entry.name), depth - 1)
            .slice(0, 5)
            .map(f => path.join(entry.name, f));
          files.push(...subFiles);
        }
      } else {
        files.push(entry.name);
      }
    }
    return files.slice(0, 30);
  } catch {
    return [];
  }
}

// Metadata attachment for AgentForge tool registry
(Create_Project_Template as any).description = "Create templates for specific projects and frameworks like Flutter, React, Next.js, VSCode extensions, Node.js, TypeScript, Python, Rust, Go, and Vue. Executes the appropriate CLI initialization commands.";
(Create_Project_Template as any).parameters = {
  framework: {
    type: "string",
    description: "Framework or project type. Options: flutter, vscode-extension, react, next-js, nodejs, typescript, python, rust, go, vue",
    required: true
  },
  projectName: {
    type: "string",
    description: "Name of the project directory to create. Must be alphanumeric with hyphens/underscores allowed.",
    required: true
  },
  directory: {
    type: "string",
    description: "Target directory path where project will be created. Defaults to current working directory.",
    required: false
  },
  typescript: {
    type: "boolean",
    description: "Enable TypeScript support (framework-specific, e.g., for Next.js templates)",
    required: false
  }
};

export default Create_Project_Template;