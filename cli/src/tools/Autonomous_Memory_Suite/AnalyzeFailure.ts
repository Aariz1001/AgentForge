import { ToolResult } from '../index';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';

interface ExecutionStep {
  step: number;
  action: string;
  status: 'success' | 'failure' | 'pending';
  timestamp: number;
  output?: string;
  error?: string;
  metadata?: Record<string, any>;
}

interface ExecutionTrace {
  id: string;
  task_type: string;
  steps: ExecutionStep[];
  final_status: 'failed' | 'completed' | 'aborted';
  error_message?: string;
  created_at: number;
  context?: Record<string, any>;
}

interface SuccessPattern {
  task_type: string;
  optimal_sequence: string[];
  critical_path_steps: number[];
  common_failure_points: string[];
  success_rate: number;
  average_duration_ms: number;
}

interface AnalysisResult {
  root_cause: string;
  deviation_point: string;
  confidence: number;
  recommendation: string;
  matched_pattern_id?: string;
}

export async function AnalyzeFailure(args: any, options: any = {}): Promise<ToolResult> {
  try {
    const { failed_trace_id } = args;

    if (!failed_trace_id || typeof failed_trace_id !== 'string') {
      return new ToolResult(false, 'Invalid input: failed_trace_id is required and must be a string');
    }

    console.log(chalk.cyan(`[AnalyzeFailure] Loading execution trace: ${failed_trace_id}`));

    const failedTrace = await retrieveExecutionTrace(failed_trace_id);
    
    if (!failedTrace) {
      return new ToolResult(false, `Trace not found: No execution record found for ID '${failed_trace_id}'`);
    }

    if (failedTrace.final_status !== 'failed') {
      return new ToolResult(false, `Invalid trace status: Expected 'failed' but found '${failedTrace.final_status}'. Only failed traces can be analyzed.`);
    }

    console.log(chalk.cyan(`[AnalyzeFailure] Analyzing ${failedTrace.steps.length} execution steps for task type: ${failedTrace.task_type}`));

    const patterns = await retrieveSuccessPatterns(failedTrace.task_type);
    
    if (patterns.length === 0) {
      return new ToolResult(false, `No reference patterns available for task type '${failedTrace.task_type}'. Cannot perform comparative analysis.`);
    }

    const analysis = performDifferentialAnalysis(failedTrace, patterns);
    
    console.log(chalk.green(`[AnalyzeFailure] Analysis complete. Confidence: ${(analysis.confidence * 100).toFixed(1)}%`));

    const resultData = {
      root_cause: analysis.root_cause,
      deviation_point: analysis.deviation_point,
      confidence_score: analysis.confidence,
      recommendation: analysis.recommendation
    };

    return new ToolResult(
      true,
      `Root cause identified: ${analysis.root_cause}. Deviation detected at ${analysis.deviation_point}.`,
      resultData
    );

  } catch (error: any) {
    console.error(chalk.red(`[AnalyzeFailure] Analysis failed: ${error.message}`));
    return new ToolResult(false, `Failed to analyze trace: ${error.message}`);
  }
}

async function retrieveExecutionTrace(traceId: string): Promise<ExecutionTrace | null> {
  try {
    const memoryPath = path.join(process.cwd(), '.agentforge', 'memory', 'traces', `${traceId}.json`);
    const data = await fs.readFile(memoryPath, 'utf-8');
    return JSON.parse(data) as ExecutionTrace;
  } catch (err) {
    return null;
  }
}

async function retrieveSuccessPatterns(taskType: string): Promise<SuccessPattern[]> {
  try {
    const patternPath = path.join(process.cwd(), '.agentforge', 'memory', 'patterns', `${taskType}.json`);
    const data = await fs.readFile(patternPath, 'utf-8');
    const patterns = JSON.parse(data);
    return Array.isArray(patterns) ? patterns : [patterns];
  } catch (err) {
    return [];
  }
}

function performDifferentialAnalysis(failedTrace: ExecutionTrace, patterns: SuccessPattern[]): AnalysisResult {
  const sortedPatterns = patterns.sort((a, b) => b.success_rate - a.success_rate);
  const bestPattern = sortedPatterns[0];
  
  let deviationStep = -1;
  let deviationDetails = '';
  let rootCause = '';
  
  for (let i = 0; i < failedTrace.steps.length; i++) {
    const currentStep = failedTrace.steps[i];
    
    if (currentStep.status === 'failure') {
      deviationStep = i;
      deviationDetails = `Step ${i} (${currentStep.action})`;
      
      if (currentStep.error) {
        rootCause = `Execution error in ${currentStep.action}: ${currentStep.error}`;
      } else {
        rootCause = `Step failure without specific error at ${currentStep.action}`;
      }
      break;
    }
    
    if (i < bestPattern.optimal_sequence.length) {
      if (currentStep.action !== bestPattern.optimal_sequence[i]) {
        deviationStep = i;
        deviationDetails = `Step ${i}: Expected '${bestPattern.optimal_sequence[i]}' but executed '${currentStep.action}'`;
        rootCause = `Sequence deviation: Task executed '${currentStep.action}' instead of the optimal '${bestPattern.optimal_sequence[i]}' at position ${i}`;
        break;
      }
    } else {
      deviationStep = i;
      deviationDetails = `Step ${i}: Unexpected continuation beyond optimal sequence`;
      rootCause = `Over-execution: Task continued beyond the ${bestPattern.optimal_sequence.length} steps defined in success patterns`;
      break;
    }
  }

  if (deviationStep === -1) {
    deviationDetails = 'End of trace';
    rootCause = failedTrace.error_message || 'Unknown failure: Task marked as failed but no error step identified in trace';
  }

  const isKnownIssue = bestPattern.common_failure_points.some(failure => 
    rootCause.toLowerCase().includes(failure.toLowerCase()) ||
    (failedTrace.error_message || '').toLowerCase().includes(failure.toLowerCase())
  );

  const recommendation = isKnownIssue 
    ? `Apply recovery protocol for known issue pattern: ${bestPattern.common_failure_points.find(f => rootCause.toLowerCase().includes(f.toLowerCase())) || 'general recovery'}`
    : 'Novel failure pattern detected. Recommend capturing to pattern database and manual review.';

  const confidence = bestPattern.success_rate * (deviationStep > -1 ? 0.95 : 0.6);

  return {
    root_cause: rootCause,
    deviation_point: deviationDetails,
    confidence: Math.min(confidence, 1.0),
    recommendation,
    matched_pattern_id: bestPattern.task_type
  };
}

(AnalyzeFailure as any).description = "Identifies the root cause of a failed task by comparing its execution trace against successful patterns in memory. Performs differential sequence analysis to pinpoint exact deviation points between failed execution paths and historically successful task completion patterns.";

(AnalyzeFailure as any).parameters = {
  failed_trace_id: {
    type: "string",
    description: "Unique identifier of the failed execution trace to analyze. Must reference a valid trace with final_status='failed' stored in the Autonomous Memory Suite.",
    required: true
  }
};

export default AnalyzeFailure;