import { ToolResult } from '../index';
import chalk from 'chalk';
import { writeFile, rename, mkdir } from 'fs/promises';
import { join } from 'path';
import { cwd } from 'process';
import { randomUUID } from 'crypto';
import { platform, arch, hostname, release } from 'os';

interface TraceRecord {
  trace_id: string;
  task_id: string;
  timestamp: string;
  execution_log: Record<string, any>;
  outcome: 'success' | 'failure';
  environment: {
    platform: string;
    arch: string;
    hostname: string;
    release: string;
    node_version: string;
    cwd: string;
    pid: number;
  };
}

/**
 * Atomically records the execution log, environmental state, and final outcome 
 * of a specific task for long-term storage.
 * 
 * @param args - Object containing task_id, execution_log, and outcome
 * @param options - Optional configuration including storageDir for custom path
 * @returns ToolResult with success status and trace_id in data
 */
export async function PersistTrace(args: any, options: any = {}): Promise<ToolResult> {
  try {
    // Input validation
    if (!args || typeof args !== 'object') {
      return new ToolResult(false, 'Invalid arguments: expected object with task_id, execution_log, and outcome');
    }

    const { task_id, execution_log, outcome } = args;

    if (typeof task_id !== 'string' || task_id.trim().length === 0) {
      return new ToolResult(false, 'Validation failed: task_id must be a non-empty string');
    }

    if (typeof execution_log !== 'object' || execution_log === null || Array.isArray(execution_log)) {
      return new ToolResult(false, 'Validation failed: execution_log must be an object');
    }

    if (outcome !== 'success' && outcome !== 'failure') {
      return new ToolResult(false, "Validation failed: outcome must be either 'success' or 'failure'");
    }

    // Generate unique trace identifier
    const trace_id = randomUUID();

    // Capture environmental state
    const environment = {
      platform: platform(),
      arch: arch(),
      hostname: hostname(),
      release: release(),
      node_version: process.version,
      cwd: cwd(),
      pid: process.pid
    };

    // Construct comprehensive trace record
    const traceRecord: TraceRecord = {
      trace_id,
      task_id: task_id.trim(),
      timestamp: new Date().toISOString(),
      execution_log,
      outcome,
      environment
    };

    // Determine storage location
    const storageDir = options.storageDir || join(cwd(), '.agentforge', 'traces');
    const fileName = `${trace_id}.json`;
    const finalPath = join(storageDir, fileName);
    const tempPath = `${finalPath}.tmp`;

    // Ensure storage directory exists
    await mkdir(storageDir, { recursive: true });

    // Atomic write operation: write to temp then rename
    await writeFile(tempPath, JSON.stringify(traceRecord, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, finalPath);

    return new ToolResult(true, `Trace ${chalk.cyan(trace_id)} persisted successfully for task ${chalk.yellow(task_id)}`, { trace_id });
  } catch (error: any) {
    return new ToolResult(false, `Failed to persist trace: ${error.message}`);
  }
}

// Metadata attachment for AgentForge registry
(PersistTrace as any).description = "Atomically records the execution log, environmental state, and final outcome of a specific task for long-term storage.";
(PersistTrace as any).parameters = {
  task_id: {
    type: "string",
    description: "Unique identifier for the task being traced",
    required: true
  },
  execution_log: {
    type: "object",
    description: "Structured log object capturing execution details, state transitions, and intermediate values",
    required: true
  },
  outcome: {
    type: "string",
    description: "Final execution status of the task",
    required: true,
    enum: ["success", "failure"]
  }
};

export default PersistTrace;