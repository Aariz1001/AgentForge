import { ToolResult } from '../index';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec as execCallback } from 'child_process';

const execAsync = promisify(execCallback);

interface PortForwardRule {
  local: number;
  remote: number;
  type?: 'tcp' | 'udp';
}

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\//i,
  /\bdd\s+if=.*of=\/dev\/(sda|hd|disk)/i,
  /\bmkbootimg.*--output/i,
  /\bfastboot\s+flash\s+boot/i,
  /\badb\s+shell\s+su\s+-c\s+rm/i,
  />\s*\/etc\/passwd/i,
  /curl.*\|.*sh/i,
  /wget.*\|.*sh/i
];

function sanitizeCommand(command: string): string {
  if (!command || typeof command !== 'string') {
    throw new Error('Command must be a non-empty string');
  }
  
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    throw new Error('Command cannot be empty');
  }
  
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(`Command blocked by security policy: potentially destructive operation detected`);
    }
  }
  
  return trimmed;
}

function validateDeviceId(deviceId: string): string {
  if (!deviceId || typeof deviceId !== 'string') {
    throw new Error('Device ID is required');
  }
  
  if (!/^[a-zA-Z0-9\-_:.\[\]]+$/.test(deviceId)) {
    throw new Error(`Invalid device ID format: ${deviceId}. Only alphanumeric characters, hyphens, underscores, colons, dots, and brackets allowed.`);
  }
  
  return deviceId;
}

function validatePortForward(rules: any[]): PortForwardRule[] {
  if (!Array.isArray(rules)) return [];
  
  return rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object') {
      throw new Error(`Invalid port forward rule at index ${index}`);
    }
    
    const local = parseInt(String(rule.local), 10);
    const remote = parseInt(String(rule.remote), 10);
    
    if (isNaN(local) || local < 1024 || local > 65535) {
      throw new Error(`Invalid local port at index ${index}: ${rule.local}. Must be between 1024-65535.`);
    }
    
    if (isNaN(remote) || remote < 1 || remote > 65535) {
      throw new Error(`Invalid remote port at index ${index}: ${rule.remote}. Must be between 1-65535.`);
    }
    
    return {
      local,
      remote,
      type: rule.type === 'udp' ? 'udp' : 'tcp'
    };
  });
}

export async function SystemRelay(args: any, options: any = {}): Promise<ToolResult> {
  const cleanedTempFiles: string[] = [];
  let activeProcess: any = null;
  
  try {
    if (!args || typeof args !== 'object') {
      throw new Error('Arguments must be an object');
    }

    const {
      command,
      deviceId,
      portForwards = [],
      timeout = 30000,
      workingDir = process.cwd(),
      emulatorCheck = true,
      shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      cleanupScreenshots = true
    } = args;

    const safeCommand = sanitizeCommand(command);
    const safeDeviceId = validateDeviceId(deviceId);
    const safeTimeout = Math.min(Math.max(parseInt(String(timeout)) || 30000, 1000), 300000);
    const safeWorkingDir = path.resolve(workingDir);
    const safePortForwards = validatePortForward(portForwards);

    console.log(chalk.blue(`[SystemRelay] Target: ${safeDeviceId}`));
    console.log(chalk.gray(`[SystemRelay] Command preview: ${safeCommand.substring(0, 80)}${safeCommand.length > 80 ? '...' : ''}`));

    try {
      await execAsync('adb version');
    } catch (e) {
      throw new Error('ADB not found in PATH. Ensure Android SDK platform-tools are installed and accessible.');
    }

    const { stdout: deviceList } = await execAsync('adb devices -l');
    if (!deviceList.includes(safeDeviceId)) {
      throw new Error(`Device ${safeDeviceId} not found. Available devices:\n${deviceList}`);
    }

    if (emulatorCheck && (safeDeviceId.includes('emulator') || /^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(safeDeviceId))) {
      console.log(chalk.yellow(`[SystemRelay] Waiting for emulator boot completion...`));
      const bootDeadline = Date.now() + 120000;
      let booted = false;
      
      while (Date.now() < bootDeadline && !booted) {
        try {
          const { stdout: bootProp } = await execAsync(
            `adb -s ${safeDeviceId} shell getprop sys.boot_completed 2>/dev/null || echo "0"`,
            { timeout: 5000 }
          );
          if (bootProp.trim() === '1') {
            booted = true;
            console.log(chalk.green('[SystemRelay] Emulator ready'));
          } else {
            await new Promise(r => setTimeout(r, 2000));
          }
        } catch (e) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      
      if (!booted) {
        throw new Error('Emulator boot timeout exceeded (120s)');
      }
    }

    if (safePortForwards.length > 0) {
      console.log(chalk.blue(`[SystemRelay] Applying ${safePortForwards.length} port forward rules...`));
      for (const rule of safePortForwards) {
        try {
          await execAsync(`adb -s ${safeDeviceId} forward --remove tcp:${rule.local} 2>/dev/null || true`);
          const forwardCmd = `adb -s ${safeDeviceId} forward tcp:${rule.local} ${rule.type === 'udp' ? 'udp:' : ''}${rule.remote}`;
          await execAsync(forwardCmd);
          console.log(chalk.gray(`  ${rule.local}:${rule.remote} (${rule.type})`));
        } catch (e: any) {
          throw new Error(`Port forward failed for ${rule.local}:${rule.remote}: ${e.message}`);
        }
      }
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const shellArgs = shell.includes('cmd.exe') ? ['/c', safeCommand] : ['-c', safeCommand];
      
      const child = spawn(shell, shellArgs, {
        cwd: safeWorkingDir,
        env: {
          ...process.env,
          ANDROID_SERIAL: safeDeviceId,
          ADB_DEVICE: safeDeviceId,
          PATH: process.platform === 'win32' 
            ? `${process.env.PATH};${process.env.ANDROID_HOME || ''}\\platform-tools`
            : `${process.env.PATH}:/usr/local/bin:/usr/bin:${process.env.ANDROID_HOME || ''}/platform-tools`
        },
        detached: false
      });

      activeProcess = child;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }, safeTimeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > 5 * 1024 * 1024) {
          stdout = stdout.substring(0, 5 * 1024 * 1024) + '\n[OUTPUT TRUNCATED - 5MB LIMIT]';
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 1 * 1024 * 1024) {
          stderr = stderr.substring(0, 1 * 1024 * 1024) + '\n[STDERR TRUNCATED]';
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        resolve(new ToolResult(false, `Process spawn error: ${err.message}`, { error: err.message }));
      });

      child.on('close', async (code) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;

        if (cleanupScreenshots) {
          const tmpDirs = [os.tmpdir(), path.join(os.homedir(), '.android'), safeWorkingDir];
          const patterns = [/screenshot.*\.png$/i, /screencap.*\.png$/i, /screen.*\.jpg$/i, /tmp.*\.img$/i];
          
          for (const dir of tmpDirs) {
            try {
              if (fs.existsSync(dir)) {
                const entries = fs.readdirSync(dir);
                for (const entry of entries) {
                  if (patterns.some(p => p.test(entry))) {
                    const fullPath = path.join(dir, entry);
                    try {
                      fs.unlinkSync(fullPath);
                      cleanedTempFiles.push(fullPath);
                    } catch (e) {}
                  }
                }
              }
            } catch (e) {}
          }
        }

        if (timedOut) {
          resolve(new ToolResult(false, `Execution timeout after ${safeTimeout}ms`, {
            exitCode: -1,
            stdout: stdout.substring(0, 10000),
            stderr: stderr.substring(0, 5000),
            duration,
            timedOut: true
          }));
        } else {
          const success = code === 0;
          resolve(new ToolResult(success, 
            success ? `Command completed on ${safeDeviceId}` : `Exit code ${code}`,
            {
              exitCode: code,
              stdout: stdout.substring(0, 10000),
              stderr: stderr.substring(0, 5000),
              duration,
              deviceId: safeDeviceId,
              portForwards: safePortForwards.length,
              tempCleaned: cleanedTempFiles.length
            }
          ));
        }
      });
    });

  } catch (error: any) {
    if (activeProcess && !activeProcess.killed) {
      try { activeProcess.kill('SIGKILL'); } catch (e) {}
    }
    
    for (const f of cleanedTempFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
    }
    
    console.error(chalk.red(`[SystemRelay] Fatal error: ${error.message}`));
    return new ToolResult(false, `SystemRelay error: ${error.message}`, {
      errorType: error.name,
      sanitized: true
    });
  }
}

(SystemRelay as any).description = "Execute arbitrary shell commands for deep system control and manage port forwarding for remote communication relay. Provides ADB integration with input sanitization, timeout handling, emulator boot detection, and automatic cleanup of temporary screenshots.";

(SystemRelay as any).parameters = {
  command: {
    type: "string",
    description: "Shell command to execute. Dangerous patterns (rm -rf /, dd to disks, etc.) are blocked.",
    required: true
  },
  deviceId: {
    type: "string",
    description: "ADB device serial. Supports physical devices (e.g., 'ABC123') and emulators (e.g., 'emulator-5554', '192.168.1.5:5555').",
    required: true
  },
  portForwards: {
    type: "array",
    description: "Port forwarding rules to apply before execution. Each item: {local: number, remote: number, type?: 'tcp'|'udp'}.",
    required: false,
    default: []
  },
  timeout: {
    type: "number",
    description: "Execution timeout in milliseconds (1000-300000). Default 30000.",
    required: false,
    default: 30000
  },
  workingDir: {
    type: "string",
    description: "Working directory for command execution.",
    required: false,
    default: "process.cwd()"
  },
  emulatorCheck: {
    type: "boolean",
    description: "Wait for emulator boot completion before executing. Default true.",
    required: false,
    default: true
  },
  shell: {
    type: "string",
    description: "Shell executable path. Defaults to system default (cmd.exe on Windows, /bin/sh on Unix).",
    required: false
  },
  cleanupScreenshots: {
    type: "boolean",
    description: "Clean up temporary screenshot files after execution. Default true.",
    required: false,
    default: true
  }
};

export default SystemRelay;