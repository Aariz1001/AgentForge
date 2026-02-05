import { AppDataSource } from '../models/database';
import { ToolTapeEntry } from '../models/schema';
import { settings } from '../core/config';
import crypto from 'crypto';

export type ToolTapeStatus = 'started' | 'succeeded' | 'failed' | 'orphaned';
export type ReplayMode = 'strict' | 'best_effort';

export interface ToolTapeContext {
  runId: string;
  traceId: string;
  stepId: string;
  contextFingerprint?: string;
  timeoutMs?: number;
  replayMode?: ReplayMode;
  volatile?: boolean;
}

export interface ToolTapeRequest<T> {
  toolHash: string;
  args: any;
  execute: () => Promise<T>;
  context: ToolTapeContext;
}

export interface ToolTapeResult<T> {
  result: T;
  fromCache: boolean;
  entryId?: string;
}

const stableStringify = (value: any): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const sha256 = (input: string): string => crypto.createHash('sha256').update(input).digest('hex');

export class ToolTapeService {
  async getStats(): Promise<{ total: number; statuses: Record<string, number> } | null> {
    if (!AppDataSource.isInitialized) return null;

    const repository = AppDataSource.getRepository(ToolTapeEntry);
    const total = await repository.count();
    const raw = await repository
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('t.status')
      .getRawMany();

    const statuses: Record<string, number> = {};
    for (const row of raw) {
      statuses[row.status] = Number(row.count);
    }

    return { total, statuses };
  }

  async getOrExecute<T>(request: ToolTapeRequest<T>): Promise<ToolTapeResult<T>> {
    const { toolHash, args, execute, context } = request;

    if (!AppDataSource.isInitialized) {
      const result = await execute();
      return { result, fromCache: false };
    }

    const repository = AppDataSource.getRepository(ToolTapeEntry);
    const replayMode = context.replayMode ?? settings.phoenixTape.replayMode;
    const timeoutMs = context.timeoutMs ?? settings.phoenixTape.defaultTimeoutMs;

    const canonicalArgs = stableStringify(args ?? {});
    const idempotencyKey = sha256(
      `${context.runId}:${context.traceId}:${context.stepId}:${toolHash}:${canonicalArgs}:${context.contextFingerprint ?? ''}`
    );

    if (!context.volatile) {
      const existing = await repository.findOne({ where: { idempotencyKey, status: 'succeeded' } });
      if (existing) {
        const fingerprintMatches = !context.contextFingerprint || existing.contextFingerprint === context.contextFingerprint;
        if (replayMode === 'best_effort' || fingerprintMatches) {
          existing.lastUsedAt = new Date();
          await repository.save(existing);
          return {
            result: (existing.resultJson ?? {}) as T,
            fromCache: true,
            entryId: existing.id
          };
        }
      }
    }

    const started = repository.create({
      toolHash,
      runId: context.runId,
      traceId: context.traceId,
      stepId: context.stepId,
      status: 'started',
      idempotencyKey,
      contextFingerprint: context.contextFingerprint,
      pinned: false,
      argsJson: args ?? {},
      timeoutMs,
      startedAt: new Date()
    });

    await repository.save(started);

    try {
      const result = await execute();
      started.status = 'succeeded';
      started.resultJson = result as any;
      started.lastUsedAt = new Date();
      started.finishedAt = new Date();
      await repository.save(started);
      return { result, fromCache: false, entryId: started.id };
    } catch (error: any) {
      started.status = 'failed';
      started.error = error?.message || 'Tool execution failed';
      started.finishedAt = new Date();
      await repository.save(started);
      throw error;
    }
  }
}
