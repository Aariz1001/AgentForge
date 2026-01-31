import { ToolResult } from '../index';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface HeuristicEntry {
  id: string;
  root_cause: string;
  proposed_fix: string;
  created_at: string;
  frequency: number;
  last_triggered: string;
  active: boolean;
}

/**
 * Ingests failure analysis to generate and store new rules, modifying future decomposition logic to prevent recurrence.
 * @param args - Object containing root_cause and proposed_fix
 * @param options - Optional configuration for storage path
 * @returns ToolResult with heuristic_id on success
 */
export async function UpdateHeuristics(args: any, options: any = {}): Promise<ToolResult> {
  try {
    // Validate inputs
    if (!args || typeof args !== 'object') {
      return new ToolResult(false, 'Invalid arguments: expected an object with root_cause and proposed_fix');
    }

    const { root_cause, proposed_fix } = args;

    if (!root_cause || typeof root_cause !== 'string' || root_cause.trim().length === 0) {
      return new ToolResult(false, 'Missing or invalid required parameter: root_cause (non-empty string)');
    }

    if (!proposed_fix || typeof proposed_fix !== 'string' || proposed_fix.trim().length === 0) {
      return new ToolResult(false, 'Missing or invalid required parameter: proposed_fix (non-empty string)');
    }

    // Generate unique heuristic ID
    const heuristic_id = `heur_${crypto.randomBytes(8).toString('hex')}`;

    // Determine storage location
    const workspaceRoot = process.cwd();
    const memoryDir = options.memoryPath || path.join(workspaceRoot, '.agentforge', 'memory');
    const heuristicsFile = path.join(memoryDir, 'heuristics.json');

    // Ensure directory exists
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    // Load existing heuristics
    let heuristics: HeuristicEntry[] = [];
    if (fs.existsSync(heuristicsFile)) {
      try {
        const data = fs.readFileSync(heuristicsFile, 'utf-8');
        const parsed = JSON.parse(data);
        heuristics = Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.warn(chalk.yellow('Warning: Corrupted heuristics file, initializing new storage'));
        heuristics = [];
      }
    }

    // Check for duplicate/similar heuristics (simple substring match)
    const existingIndex = heuristics.findIndex(h => 
      h.root_cause.toLowerCase().trim() === root_cause.toLowerCase().trim()
    );

    if (existingIndex >= 0) {
      // Update existing heuristic
      heuristics[existingIndex].frequency += 1;
      heuristics[existingIndex].last_triggered = new Date().toISOString();
      heuristics[existingIndex].proposed_fix = proposed_fix.trim(); // Update fix if improved
      
      fs.writeFileSync(heuristicsFile, JSON.stringify(heuristics, null, 2), 'utf-8');
      
      return new ToolResult(true, `Updated existing heuristic pattern (ID: ${heuristics[existingIndex].id})`, {
        heuristic_id: heuristics[existingIndex].id,
        frequency: heuristics[existingIndex].frequency,
        is_update: true
      });
    }

    // Create new heuristic entry
    const newHeuristic: HeuristicEntry = {
      id: heuristic_id,
      root_cause: root_cause.trim(),
      proposed_fix: proposed_fix.trim(),
      created_at: new Date().toISOString(),
      frequency: 1,
      last_triggered: new Date().toISOString(),
      active: true
    };

    heuristics.push(newHeuristic);
    fs.writeFileSync(heuristicsFile, JSON.stringify(heuristics, null, 2), 'utf-8');

    console.log(chalk.blue(`🧠 Stored heuristic ${heuristic_id} to Autonomous Memory Suite`));

    return new ToolResult(true, `Successfully generated heuristic rule ${heuristic_id}`, {
      heuristic_id: heuristic_id,
      total_rules: heuristics.length,
      is_update: false
    });

  } catch (error: any) {
    console.error(chalk.red('UpdateHeuristics error:'), error);
    return new ToolResult(false, `Failed to update heuristics: ${error.message || 'Unknown error'}`);
  }
}

// Metadata
(UpdateHeuristics as any).description = "Ingests failure analysis to generate and store new rules, modifying future decomposition logic to prevent recurrence.";
(UpdateHeuristics as any).parameters = {
  root_cause: {
    type: "string",
    description: "The identified root cause of the failure that needs to be prevented in future decompositions",
    required: true
  },
  proposed_fix: {
    type: "string",
    description: "The proposed solution or rule to apply when similar patterns are detected in future tasks",
    required: true
  }
};

export default UpdateHeuristics;