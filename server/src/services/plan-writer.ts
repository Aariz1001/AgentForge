import { writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { SwarmAgentResult, SwarmRunResult } from './swarm-types';

export interface PlanArtifactOptions {
  planDir: string;
  runId: string;
  unifiedSummary: string;
  agentResults: SwarmAgentResult[];
}

export class PlanWriter {
  async writeArtifacts(options: PlanArtifactOptions): Promise<Pick<SwarmRunResult, 'planPath' | 'planJsonPath' | 'integrationReportPath'>> {
    const planDir = resolve(process.cwd(), options.planDir);
    await mkdir(planDir, { recursive: true });
    const planPath = join(planDir, `PLAN_${options.runId}.md`);
    const planJsonPath = join(planDir, `PLAN_${options.runId}.json`);
    const integrationReportPath = join(planDir, `INTEGRATION_${options.runId}.md`);

    const markdown = this.buildMarkdown(options.unifiedSummary, options.agentResults);
    const json = this.buildJson(options.unifiedSummary, options.agentResults);
    const integration = this.buildIntegrationReport(options.agentResults);

    await writeFile(planPath, markdown, 'utf-8');
    await writeFile(planJsonPath, JSON.stringify(json, null, 2), 'utf-8');
    await writeFile(integrationReportPath, integration, 'utf-8');

    return { planPath, planJsonPath, integrationReportPath };
  }

  private buildMarkdown(summary: string, results: SwarmAgentResult[]): string {
    const sections = results.map(r =>
      `## Agent ${r.agentId} (${r.role})\n\n${r.summary}\n\n${r.details || ''}`.trim()
    ).join('\n\n');

    return `# Swarm Plan\n\n## Unified Summary\n\n${summary}\n\n${sections}\n`;
  }

  private buildJson(summary: string, results: SwarmAgentResult[]): Record<string, any> {
    return {
      summary,
      agents: results
    };
  }

  private buildIntegrationReport(results: SwarmAgentResult[]): string {
    const todoLines = results.flatMap(r => (r.todos || []).map(todo => `- ${todo} (agent ${r.agentId})`));
    return `# Swarm Integration Report\n\n## Consolidated TODOs\n\n${todoLines.join('\n') || 'No TODOs reported.'}\n`;
  }
}
