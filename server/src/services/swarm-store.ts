import { SwarmRunResult } from './swarm-types';

export class SwarmStore {
  private runs: Map<string, SwarmRunResult> = new Map();

  save(result: SwarmRunResult): void {
    this.runs.set(result.runId, result);
  }

  get(runId: string): SwarmRunResult | null {
    return this.runs.get(runId) || null;
  }
}
