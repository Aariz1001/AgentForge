import { v4 as uuidv4 } from 'uuid';
import { OpenRouterService } from './openrouter';
import { OrchestrationService } from './orchestration';
import { MemoryEngine } from './memory/memory-engine';
import { MemoryTier } from './memory/hierarchy-manager';
import { TodoRegistry } from './todo-registry';
import { PlanWriter } from './plan-writer';
import { SwarmRunRequest, SwarmRunResult, SwarmAgentResult, SwarmTask } from './swarm-types';
import { settings } from '../core/config';
import { SwarmAgent } from './swarm-agent';

interface Config {
  get(key: string): any;
}

export class SwarmOrchestrator {
  private openrouter: OpenRouterService;
  private orchestrator: OrchestrationService;
  private memory: MemoryEngine;
  private todos: TodoRegistry;
  private planWriter: PlanWriter;

  constructor(_config: Config, deps: {
    openrouter: OpenRouterService;
    orchestrator: OrchestrationService;
    memory: MemoryEngine;
    todos: TodoRegistry;
    planWriter: PlanWriter;
  }) {
    this.openrouter = deps.openrouter;
    this.orchestrator = deps.orchestrator;
    this.memory = deps.memory;
    this.todos = deps.todos;
    this.planWriter = deps.planWriter;
  }

  async runSwarm(request: SwarmRunRequest): Promise<SwarmRunResult> {
    const runId = `swarm_${uuidv4()}`;
    const startedAt = new Date().toISOString();

    const agentCount = Math.min(
      request.agents || settings.swarm.defaultAgents,
      request.maxAgents || settings.swarm.maxAgents
    );

    const tasks = await this.routeTasks(request.task, agentCount, request.model);
    const agentResults = await this.executeAgents(tasks, request);
    const unifiedSummary = await this.mergeResults(request.task, agentResults, request.model);

    const artifacts = await this.planWriter.writeArtifacts({
      planDir: settings.swarm.planDir,
      runId,
      unifiedSummary,
      agentResults
    });

    return {
      runId,
      status: 'completed',
      startedAt,
      completedAt: new Date().toISOString(),
      agentResults,
      unifiedSummary,
      ...artifacts
    };
  }

  private async routeTasks(task: string, agentCount: number, model?: string): Promise<SwarmTask[]> {
    const baseTasks: SwarmTask[] = Array.from({ length: agentCount }).map((_, i) => ({
      id: `task_${i + 1}`,
      title: `Focus area ${i + 1}`,
      description: `${task} (focus area ${i + 1})`,
      targetPaths: []
    }));

    if (!settings.swarm.router.useLLM) {
      return baseTasks;
    }

    try {
      const response = await this.openrouter.complete({
        model: model || settings.swarm.router.model || settings.openrouter.primaryModel,
        messages: [
          { role: 'system', content: 'You are a swarm task router. Split the task into focused sub-tasks.' },
          { role: 'user', content: task }
        ],
        profile: { temperature: 0.2 }
      });

      const content = response.choices?.[0]?.message?.content || '';
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      if (lines.length === 0) return baseTasks;

      return lines.slice(0, agentCount).map((line, idx) => ({
        id: `task_${idx + 1}`,
        title: `Focus area ${idx + 1}`,
        description: line.replace(/^[\-\d\.\s]+/, ''),
        targetPaths: []
      }));
    } catch {
      return baseTasks;
    }
  }

  private async executeAgents(tasks: SwarmTask[], request: SwarmRunRequest): Promise<SwarmAgentResult[]> {
    const results: SwarmAgentResult[] = [];
    const concurrency = Math.max(1, settings.swarm.concurrency);
    let index = 0;

    const runNext = async (): Promise<void> => {
      const currentIndex = index++;
      if (currentIndex >= tasks.length) return;
      const task = tasks[currentIndex];

      const role = task.roleHint || 'worker';
      const agent = new SwarmAgent(this.orchestrator, role);
      const result = await agent.run(task, {
        workingDirectory: request.context?.workingDirectory
      });
      results.push(result);
      const content = result.summary || `Swarm task ${task.id} completed`;
      this.memory.remember(content, {
        key: `swarm:${task.id}`,
        tier: MemoryTier.EPISODIC,
        tags: ['swarm', task.title, role],
        source: 'swarm',
        metadata: result,
        importance: 0.6
      });
      this.todos.add(`Review ${task.title}`);

      await runNext();
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => runNext()));
    return results;
  }

  private async mergeResults(task: string, results: SwarmAgentResult[], model?: string): Promise<string> {
    const summaries = results.map(r => `Agent ${r.agentId}: ${r.summary}`).join('\n');

    try {
      const response = await this.openrouter.complete({
        model: model || settings.swarm.mergeModel || settings.openrouter.primaryModel,
        messages: [
          { role: 'system', content: 'You are a swarm integrator. Merge agent summaries into a unified plan.' },
          { role: 'user', content: `Task: ${task}\n\nSummaries:\n${summaries}` }
        ],
        profile: { temperature: 0.2 }
      });

      return response.choices?.[0]?.message?.content || summaries;
    } catch {
      return summaries;
    }
  }
}
