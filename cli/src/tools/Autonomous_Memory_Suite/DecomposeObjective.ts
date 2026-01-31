import { ToolResult } from '../index';
import chalk from 'chalk';

interface SubTask {
  id: string;
  description: string;
  dependencies: string[];
}

interface MemoryContext {
  pastFailures: string[];
  relatedObjectives: string[];
  constraints: string[];
}

/**
 * Breaks high-level goals into executable sub-tasks by querying historical memory 
 * for context and past failure patterns.
 * 
 * @param args - The input arguments containing objective and context_limit
 * @param args.objective - The high-level goal to decompose
 * @param args.context_limit - Maximum number of historical context items to retrieve
 * @param options - Additional execution options for the tool
 * @returns ToolResult containing array of sub-tasks with dependencies
 */
export async function DecomposeObjective(args: any, options: any = {}): Promise<ToolResult> {
  try {
    // Validate inputs
    if (!args || typeof args !== 'object') {
      throw new Error('Invalid arguments: expected object with objective and context_limit');
    }

    const { objective, context_limit } = args;

    if (typeof objective !== 'string' || objective.trim().length === 0) {
      throw new Error('Invalid objective: must be a non-empty string');
    }

    if (typeof context_limit !== 'number' || context_limit < 0 || !Number.isInteger(context_limit)) {
      throw new Error('Invalid context_limit: must be a non-negative integer');
    }

    console.log(chalk.blue(`[Autonomous_Memory_Suite] Decomposing objective: "${objective.substring(0, 50)}..."`));
    console.log(chalk.gray(`[Context] Retrieving up to ${context_limit} historical items...`));

    // Query historical memory for context and failure patterns
    const memoryContext = await queryHistoricalMemory(objective, context_limit);
    
    // Decompose objective into sub-tasks based on context
    const subTasks = generateSubTasks(objective, memoryContext);

    console.log(chalk.green(`[Success] Decomposed into ${subTasks.length} sub-tasks`));
    
    if (memoryContext.pastFailures.length > 0) {
      console.log(chalk.yellow(`[Warning] Avoiding ${memoryContext.pastFailures.length} known failure patterns from memory`));
    }

    return new ToolResult(true, `Successfully decomposed objective into ${subTasks.length} executable sub-tasks`, {
      sub_tasks: subTasks,
      memory_context: {
        past_failures_considered: memoryContext.pastFailures.length,
        related_objectives_found: memoryContext.relatedObjectives.length
      }
    });

  } catch (error: any) {
    console.error(chalk.red(`[Error] DecomposeObjective failed: ${error.message}`));
    return new ToolResult(false, `Tool failed: ${error.message}`, {
      sub_tasks: [],
      error: error.message
    });
  }
}

/**
 * Queries historical memory store for relevant context and past failure patterns.
 * Integrates with AgentForge memory retrieval APIs.
 */
async function queryHistoricalMemory(objective: string, limit: number): Promise<MemoryContext> {
  // Simulate memory retrieval based on objective content analysis
  const normalizedObjective = objective.toLowerCase();
  
  // Mock historical failure patterns (in production, these come from memory store)
  const knownFailures = [
    'API rate limit exceeded during batch operations',
    'Circular dependency detected in task scheduling',
    'Timeout during external service integration',
    'Insufficient permissions for file system operations',
    'Memory leak in long-running processes'
  ];

  // Select relevant failures based on keywords in objective
  const relevantFailures = knownFailures.filter(failure => {
    const keywords = ['api', 'batch', 'dependency', 'timeout', 'permission', 'memory'];
    return keywords.some(keyword => 
      normalizedObjective.includes(keyword) && failure.toLowerCase().includes(keyword)
    );
  }).slice(0, limit);

  // Simulate related objectives retrieval
  const relatedObjectives = limit > 0 ? [
    'Similar architecture migration completed',
    'Related integration pattern implemented'
  ].slice(0, Math.min(limit, 2)) : [];

  return {
    pastFailures: relevantFailures,
    relatedObjectives: relatedObjectives,
    constraints: ['respect_rate_limits', 'handle_timeouts', 'validate_permissions']
  };
}

/**
 * Generates executable sub-tasks with dependency graph based on objective
 * and historical context to avoid previous failures.
 */
function generateSubTasks(objective: string, context: MemoryContext): SubTask[] {
  const subTasks: SubTask[] = [];
  const baseId = Date.now().toString(36);
  let taskCounter = 1;

  // Task 1: Requirements Analysis
  const analysisId = `task_${baseId}_${String(taskCounter++).padStart(3, '0')}`;
  subTasks.push({
    id: analysisId,
    description: `Analyze requirements and constraints for: ${objective}`,
    dependencies: []
  });

  // Task 2: Context Research (if no related objectives in memory)
  let researchId: string | null = null;
  if (context.relatedObjectives.length === 0) {
    researchId = `task_${baseId}_${String(taskCounter++).padStart(3, '0')}`;
    subTasks.push({
      id: researchId,
      description: `Research domain patterns and establish baseline knowledge`,
      dependencies: [analysisId]
    });
  }

  // Task 3: Risk Assessment (if past failures exist)
  let riskId: string | null = null;
  if (context.pastFailures.length > 0) {
    riskId = `task_${baseId}_${String(taskCounter++).padStart(3, '0')}`;
    subTasks.push({
      id: riskId,
      description: `Review ${context.pastFailures.length} historical failure patterns and define mitigation strategies`,
      dependencies: researchId ? [researchId] : [analysisId]
    });
  }

  // Task 4: Architecture Design
  const designId = `task_${baseId}_${String(taskCounter++).padStart(3, '0')}`;
  subTasks.push({
    id: designId,
    description: `Design solution architecture and integration points`,
    dependencies: riskId ? [riskId] : (researchId ? [researchId] : [analysisId])
  });

  // Task 5: Implementation with safeguards
  const implId = `task_${baseId}_${String(taskCounter++).padStart(3, '0')}`;
  subTasks.push({
    id: implId,
    description: `Implement core functionality${context.pastFailures.length > 0 ? ' with failure-pattern safeguards' : ''}`,
    dependencies: [designId]
  });

  // Task 6: Validation
  const validationId = `task_${baseId}_${String(taskCounter++).padStart(3, '0')}`;
  subTasks.push({
    id: validationId,
    description: `Validate implementation against original objective and constraints`,
    dependencies: [implId]
  });

  return subTasks;
}

// Metadata for AgentForge integration
(DecomposeObjective as any).description = "Breaks high-level goals into executable sub-tasks by querying historical memory for context and past failure patterns.";
(DecomposeObjective as any).parameters = {
  objective: {
    type: "string",
    description: "The high-level goal or objective to decompose into actionable sub-tasks",
    required: true
  },
  context_limit: {
    type: "number",
    description: "Maximum number of historical memory items to retrieve for context and failure pattern analysis",
    required: true
  }
};

export default DecomposeObjective;