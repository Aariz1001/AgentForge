export type AgentRole = 'planner' | 'worker' | 'reviewer' | 'router';

export interface SwarmTask {
  id: string;
  title: string;
  description: string;
  targetPaths: string[];
  roleHint?: AgentRole;
}

export interface SwarmRunRequest {
  task: string;
  agents?: number;
  model?: string;
  context?: Record<string, any>;
  maxAgents?: number;
}

export interface SwarmAgentResult {
  agentId: string;
  role: AgentRole;
  summary: string;
  details?: string;
  artifacts?: Record<string, any>;
  todos?: string[];
}

export interface SwarmRunResult {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  agentResults: SwarmAgentResult[];
  unifiedSummary?: string;
  planPath?: string;
  planJsonPath?: string;
  integrationReportPath?: string;
}
