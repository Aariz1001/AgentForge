import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SharedMemoryService } from './server/src/services/shared-memory';
import { TodoRegistry } from './server/src/services/todo-registry';
import { PlanWriter } from './server/src/services/plan-writer';

const sampleResults = [
  { agentId: 'a1', role: 'worker', summary: 'did work' }
];

describe('SharedMemoryService', () => {
  it('stores and retrieves entries', () => {
    const memory = new SharedMemoryService({ maxEntries: 2, ttlSeconds: 0 });
    memory.set('key', { value: 1 }, ['tag']);
    const entry = memory.get('key');
    expect(entry?.value).toEqual({ value: 1 });
    expect(entry?.tags).toEqual(['tag']);
  });
});

describe('TodoRegistry', () => {
  it('adds items', () => {
    const todos = new TodoRegistry({ maxItems: 2 });
    const item = todos.add('Do the thing');
    expect(item.status).toBe('open');
    expect(todos.list()).toHaveLength(1);
  });
});

describe('PlanWriter', () => {
  it('writes plan artifacts', async () => {
    const writer = new PlanWriter();
    const planDir = await mkdtemp(join(tmpdir(), 'agentforge-plan-'));
    const runId = 'test';
    const result = await writer.writeArtifacts({
      planDir,
      runId,
      unifiedSummary: 'summary',
      agentResults: sampleResults
    });
    expect(result.planPath).toContain(`PLAN_${runId}.md`);
    expect(result.planJsonPath).toContain(`PLAN_${runId}.json`);
    expect(result.integrationReportPath).toContain(`INTEGRATION_${runId}.md`);
  });
});
