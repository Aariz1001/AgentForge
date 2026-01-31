/**
 * Core Orchestration Service (LangGraph)
 * 
 * Manages the agent's "Plan-Act-Verify" loop with LangGraph integration.
 * Handles state persistence, circuit breakers, and OpenRouter API integration.
 */

import { DatabaseService } from './database';

export interface Config {
  get(key: string): any;
  set(key: string, value: any): void;
}

export interface AgentState {
  id: string;
  messages: Array<{ role: string; content: string }>;
  plan: string[];
  currentStep: number;
  recursionDepth: number;
  budget: {
    remaining: number | null;
    spent: number;
  };
  tools: string[];
  workingDirectory?: string;
  selectedFolders?: string[];
}

export interface CircuitBreaker {
  maxDepth: number | null;
  maxBudget: number | null;
  maxRetries: number | null;
}

export class OrchestrationService {
  private config: Config;
  private db: DatabaseService;
  private circuitBreaker: CircuitBreaker;

  constructor(config: Config, db: DatabaseService) {
    this.config = config;
    this.db = db;
    const maxDepth = Number(this.config.get('safety.maxDepth') ?? 0);
    const maxBudget = Number(this.config.get('safety.maxBudgetUsd') ?? 0);
    const maxRetries = Number(this.config.get('safety.circuitBreakerThreshold') ?? 0);

    this.circuitBreaker = {
      maxDepth: maxDepth > 0 ? maxDepth : null,
      maxBudget: maxBudget > 0 ? maxBudget : null, // USD
      maxRetries: maxRetries > 0 ? maxRetries : null
    };
  }

  /**
   * Initiates an agent task and triggers the LangGraph loop
   */
  async runAgentTask(taskDescription: string, options: {
    sessionId?: string;
    budgetLimit?: number;
    workingDirectory?: string;
  }): Promise<{ sessionId: string; state: AgentState }> {
    const sessionId = options.sessionId || this.generateSessionId();
    const budgetLimit = Number(options.budgetLimit ?? 0);
    const remainingBudget = budgetLimit > 0
      ? budgetLimit
      : this.circuitBreaker.maxBudget;
    
    const initialState: AgentState = {
      id: sessionId,
      messages: [{ role: 'user', content: taskDescription }],
      plan: [],
      currentStep: 0,
      recursionDepth: 0,
      budget: {
        remaining: remainingBudget,
        spent: 0
      },
      tools: [],
      workingDirectory: options.workingDirectory
    };

    // Save initial state to database
    await this.db.saveAgentState(initialState);

    return { sessionId, state: initialState };
  }

  /**
   * Retrieves the current agent state from checkpoint
   */
  async getAgentState(sessionId: string): Promise<AgentState | null> {
    return await this.db.getAgentState(sessionId);
  }

  /**
   * Validates circuit breaker constraints
   */
  validateCircuitBreaker(state: AgentState): {
    valid: boolean;
    reason?: string;
  } {
    if (this.circuitBreaker.maxDepth !== null && state.recursionDepth >= this.circuitBreaker.maxDepth) {
      return { valid: false, reason: 'MAX_RECURSION_DEPTH_EXCEEDED' };
    }

    if (state.budget.remaining !== null && state.budget.spent >= state.budget.remaining) {
      return { valid: false, reason: 'BUDGET_EXCEEDED' };
    }

    return { valid: true };
  }

  /**
   * Executes a single step in the agent loop
   */
  async executeStep(sessionId: string, action: string): Promise<{
    success: boolean;
    state: AgentState;
    error?: string;
  }> {
    const state = await this.getAgentState(sessionId);
    if (!state) {
      return { success: false, state: {} as AgentState, error: 'SESSION_NOT_FOUND' };
    }

    // Validate circuit breaker
    const validation = this.validateCircuitBreaker(state);
    if (!validation.valid) {
      return { success: false, state, error: validation.reason };
    }

    // Execute action (placeholder - integrate with actual LangGraph)
    state.currentStep++;
    state.recursionDepth++;

    // Save updated state
    await this.db.saveAgentState(state);

    return { success: true, state };
  }

  /**
   * Terminates an agent session
   */
  async terminateSession(sessionId: string): Promise<boolean> {
    return await this.db.deleteAgentState(sessionId);
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
