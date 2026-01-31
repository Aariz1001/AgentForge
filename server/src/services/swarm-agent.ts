import { OrchestrationService } from './orchestration';
import { SwarmAgentResult, SwarmTask, AgentRole } from './swarm-types';

export class SwarmAgent {
  private orchestrator: OrchestrationService;
  private role: AgentRole;

  constructor(orchestrator: OrchestrationService, role: AgentRole) {
    this.orchestrator = orchestrator;
    this.role = role;
  }

  async run(task: SwarmTask, context: { workingDirectory?: string }): Promise<SwarmAgentResult> {
    const { state } = await this.orchestrator.runAgentTask(task.description, {
      workingDirectory: context.workingDirectory
    });

    const summary = `Planned task: ${task.description}`;
    return {
      agentId: state.id,
      role: this.role,
      summary,
      details: `State initialized with ${state.messages.length} message(s).`
    };
  }
}
