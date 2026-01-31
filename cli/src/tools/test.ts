import { ToolResult } from './index';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import glob from 'fast-glob';

/**
 * Execute test suites with automatic runner detection and structured result parsing.
 */

interface TestArgs {
  pattern?: string | string[];
  runner?: 'auto' | 'jest' | 'vitest' | 'mocha' | 'node' | 'npm';
  configPath?: string;
  coverage?: boolean;
  verbose?: boolean;
  timeout?: number;
  cwd?: string;
}

interface TestOptions {
  env?: Record<string, string>;
}

interface TestFailure {
  file: string;
  suite: string;
  test: string;
  error: string;
  stack?: string;
}

interface TestSummary {
  runner: string;
  command: string;
  duration: number;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  files: string[];
  failures: TestFailure[];
  coverage?: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
  rawOutput: string;
}

async function analyzeTestEnvironment(cwd: string): Promise<string> {
  let detectedRunner = 'npm';
  
  try {
    const packagePath = path.join(cwd, 'package.json');
    const pkg = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
    const testScript = pkg?.scripts?.test || '';
    
    if (testScript.includes('vitest')) detectedRunner = 'vitest';
    else if (testScript.includes('jest')) detectedRunner = 'jest';
    else if (testScript.includes('mocha')) detectedRunner = 'mocha';
    else if (testScript.includes('node --test')) detectedRunner = 'node';
  } catch {
    // Continue with file-based detection
  }

  const configs = [
    { file: 'vitest.config.ts', runner: 'vitest' },
    { file: 'vitest.config.js', runner: 'vitest' },
    { file: 'vitest.config.mts', runner: 'vitest' },
    { file: 'jest.config.js', runner: 'jest' },
    { file: 'jest.config.ts', runner: 'jest' },
    { file: 'jest.config.mjs', runner: 'jest' },
    { file: '.mocharc.js', runner: 'mocha' },
    { file: '.mocharc.json', runner: 'mocha' }
  ];

  for (const config of configs) {
    try {
      await fs.access(path.join(cwd, config.file));
      return config.runner;
    } catch {
      continue;
    }
  }

  return detectedRunner;
}

function sanitizeWindowsGlobPattern(pattern: string): string {
  // Convert Windows backslashes to forward slashes for glob compatibility
  return pattern.replace(/\\/g, '/');
}

async function resolveTestTargets(pattern: string | string[], cwd: string): Promise<string[]> {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const normalizedPatterns = patterns.map(p => sanitizeWindowsGlobPattern(p));

  const entries = await glob(normalizedPatterns, {
    cwd,
    absolute: true,
    onlyFiles: true,
    braceExpansion: true,
    extglob: true,
    dot: true
  });

  return entries.map(p => path.normalize(p));
}

export async function test(args: TestArgs, options: TestOptions = {}): Promise<ToolResult> {
  const startTime = Date.now();
  const cwd = path.resolve(args.cwd || process.cwd());
  
  try {
    // Phase 1: Reasoning - Analyze environment
    const effectiveRunner = args.runner === 'auto' || !args.runner 
      ? await analyzeTestEnvironment(cwd) 
      : args.runner;
    
    // Phase 2: Surgical file resolution
    let targetFiles: string[] = [];
    if (args.pattern) {
      targetFiles = await resolveTestTargets(args.pattern, cwd);
      if (targetFiles.length === 0) {
        return new ToolResult(false, `No test files matched pattern: ${JSON.stringify(args.pattern)}`);
      }
    }

    // Phase 3: Construct command with Windows path handling
    let command = 'npx';
    let spawnArgs: string[] = [];
    let resultFile: string | null = null;

    if (effectiveRunner === 'jest') {
      resultFile = path.join(cwd, '.agentforge-jest-results.json');
      spawnArgs = [
        'jest',
        ...(targetFiles.length > 0 ? targetFiles.map(f => `${f}`) : []),
        '--json',
        `--outputFile=${resultFile}`,
        '--colors'
      ];
      if (args.configPath) spawnArgs.push('--config', `${path.normalize(args.configPath)}`);
      if (args.coverage) spawnArgs.push('--coverage');
      if (args.verbose) spawnArgs.push('--verbose');
      if (args.timeout) spawnArgs.push('--testTimeout', String(args.timeout));
      
    } else if (effectiveRunner === 'vitest') {
      resultFile = path.join(cwd, '.agentforge-vitest-results.json');
      spawnArgs = [
        'vitest', 
        'run',
        ...(targetFiles.length > 0 ? targetFiles.map(f => `${f}`) : []),
        '--reporter=verbose',
        '--reporter=json',
        `--outputFile=${resultFile}`
      ];
      if (args.configPath) spawnArgs.push('--config', `${path.normalize(args.configPath)}`);
      if (args.coverage) spawnArgs.push('--coverage');
      if (args.timeout) spawnArgs.push('--testTimeout', String(args.timeout));
      
    } else if (effectiveRunner === 'mocha') {
      spawnArgs = [
        'mocha',
        ...(targetFiles.length > 0 ? targetFiles.map(f => `${f}`) : ['--recursive', 'test/', 'tests/', '**/*.spec.js', '**/*.test.js'])
      ];
      if (args.configPath) spawnArgs.push('--config', `${path.normalize(args.configPath)}`);
      if (args.timeout) spawnArgs.push('--timeout', String(args.timeout));
      if (args.verbose) spawnArgs.push('--reporter', 'spec');
      
    } else if (effectiveRunner === 'node') {
      spawnArgs = ['--test'];
      if (targetFiles.length > 0) {
        spawnArgs.push(...targetFiles.map(f => `${f}`));
      }
      
    } else {
      command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      spawnArgs = ['test'];
      if (args.verbose) spawnArgs.push('--', '--verbose');
    }

    // Phase 4: Execution
    const summary: TestSummary = {
      runner: effectiveRunner,
      command: `${command} ${spawnArgs.join(' ')}`,
      duration: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      files: targetFiles,
      failures: [],
      rawOutput: ''
    };

    const env = {
      ...process.env,
      ...options.env,
      FORCE_COLOR: '1',
      NODE_ENV: 'test'
    };

    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(command, spawnArgs, {
        cwd,
        env,
        shell: true, // Use shell for better argument handling on Windows
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (args.verbose) process.stdout.write(chunk);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (args.verbose) process.stderr.write(chunk);
      });

      child.on('error', (err) => {
        reject(new Error(`Process spawn failed: ${err.message}`));
      });

      child.on('close', (code) => {
        summary.rawOutput = stdout + stderr;
        resolve(code || 0);
      });
    });

    // Phase 5: Structured result parsing
    if (resultFile && effectiveRunner === 'jest') {
      try {
        const results = JSON.parse(await fs.readFile(resultFile, 'utf-8'));
        await fs.unlink(resultFile).catch(() => {});
        
        summary.passed = results.numPassedTests || 0;
        summary.failed = results.numFailedTests || 0;
        summary.skipped = results.numPendingTests || 0;
        summary.total = summary.passed + summary.failed + summary.skipped;

        results.testResults?.forEach((fileResult: any) => {
          if (fileResult.status === 'failed') {
            fileResult.assertionResults?.forEach((testRes: any) => {
              if (testRes.status === 'failed') {
                summary.failures.push({
                  file: path.normalize(fileResult.name || ''),
                  suite: fileResult.name || '',
                  test: testRes.title || '',
                  error: testRes.failureMessages?.join('\n') || 'Unknown error',
                  stack: testRes.failureMessages?.join('\n')
                });
              }
            });
          }
        });
      } catch (parseErr) {
        // Fallback
      }
    }

    summary.duration = Date.now() - startTime;
    const success = summary.failed === 0 && exitCode === 0;

    return new ToolResult(success, 
      success ? `✓ Passed ${summary.passed} tests` : `✗ Failed ${summary.failed} tests`,
      { summary, exitCode }
    );

  } catch (error: any) {
    return new ToolResult(false, `Test execution failed: ${error.message}`);
  }
}

/**
 * Metadata for the tool registry
 */
(test as any).description = 'Execute test suites with automatic runner detection (Jest, Vitest, Mocha, Node).';
(test as any).parameters = {
  pattern: { type: 'string | string[]', description: 'Glob pattern(s) for test files', required: false },
  runner: { type: 'string', description: 'Test runner (auto, jest, vitest, mocha, node, npm)', default: 'auto' },
  cwd: { type: 'string', description: 'Working directory', default: '.' },
  coverage: { type: 'boolean', description: 'Enable coverage reporting', default: false },
  verbose: { type: 'boolean', description: 'Enable verbose output', default: false }
};
