import { AppDataSource } from '../models/database';
import { ToolTapeCompaction, ToolTapeEntry } from '../models/schema';
import { settings } from '../core/config';
import { MemoryEngine } from './memory/memory-engine';
import { LessThan, MoreThan } from 'typeorm';
import crypto from 'crypto';

export interface TapeCompactionReport {
  windowStart: string;
  windowEnd: string;
  scanned: number;
  compactedGroups: number;
  retained: number;
  deleted: number;
  createdCompactions: number;
  dryRun?: boolean;
  skippedReason?: string;
}

export interface MemoryCompactionReport {
  clusters: number;
  summariesCreated: number;
  deleted: number;
  retained: number;
  dryRun?: boolean;
  skippedReason?: string;
}

export interface PhoenixCompactionReport {
  tape?: TapeCompactionReport;
  memory?: MemoryCompactionReport;
}

export interface PhoenixCompactorRuntimeStatus {
  tapeRunning: boolean;
  memoryRunning: boolean;
  lastTapeCompactionAt?: string;
  lastMemoryCompactionAt?: string;
  lastTapeCompactionError?: string;
  lastMemoryCompactionError?: string;
  lastTapeReport?: TapeCompactionReport;
  lastMemoryReport?: MemoryCompactionReport;
}

const stableStringify = (value: any): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const sha256 = (input: string): string => crypto.createHash('sha256').update(input).digest('hex');

const hash64 = (input: string): bigint => {
  let hash = 1469598103934665603n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash *= 1099511628211n;
  }
  return hash;
};

const simhash64 = (input: string): bigint => {
  const bits = new Array(64).fill(0);
  const tokens = input.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  for (const token of tokens) {
    const h = hash64(token);
    for (let i = 0; i < 64; i++) {
      const bit = (h >> BigInt(i)) & 1n;
      bits[i] += bit === 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) {
    if (bits[i] >= 0) out |= 1n << BigInt(i);
  }
  return out;
};

const hamming = (a: bigint, b: bigint): number => {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
};

export class PhoenixCompactorService {
  private memory: MemoryEngine;
  private tapeTimer: NodeJS.Timeout | null = null;
  private memoryTimer: NodeJS.Timeout | null = null;
  private tapeRunning = false;
  private memoryRunning = false;
  private lastTapeCompactionAt?: string;
  private lastMemoryCompactionAt?: string;
  private lastTapeCompactionError?: string;
  private lastMemoryCompactionError?: string;
  private lastTapeReport?: TapeCompactionReport;
  private lastMemoryReport?: MemoryCompactionReport;

  constructor(memory: MemoryEngine) {
    this.memory = memory;
  }

  start(): void {
    if (!this.tapeTimer) {
      this.tapeTimer = setInterval(() => {
        void this.runTapeCompaction({ dryRun: false }).catch((error: any) => {
          this.lastTapeCompactionError = error?.message || String(error);
        });
      }, settings.phoenixTape.compactionIntervalMs);
    }
    if (!this.memoryTimer) {
      this.memoryTimer = setInterval(() => {
        void this.runMemoryCompaction().catch((error: any) => {
          this.lastMemoryCompactionError = error?.message || String(error);
        });
      }, settings.phoenixTape.memoryCompactionIntervalMs);
    }
  }

  stop(): void {
    if (this.tapeTimer) clearInterval(this.tapeTimer);
    if (this.memoryTimer) clearInterval(this.memoryTimer);
    this.tapeTimer = null;
    this.memoryTimer = null;
  }

  getRuntimeStatus(): PhoenixCompactorRuntimeStatus {
    return {
      tapeRunning: this.tapeRunning,
      memoryRunning: this.memoryRunning,
      lastTapeCompactionAt: this.lastTapeCompactionAt,
      lastMemoryCompactionAt: this.lastMemoryCompactionAt,
      lastTapeCompactionError: this.lastTapeCompactionError,
      lastMemoryCompactionError: this.lastMemoryCompactionError,
      lastTapeReport: this.lastTapeReport,
      lastMemoryReport: this.lastMemoryReport
    };
  }

  async runTapeCompaction(options: { dryRun?: boolean } = {}): Promise<TapeCompactionReport> {
    const dryRun = options.dryRun ?? false;

    if (!AppDataSource.isInitialized) {
      return {
        windowStart: new Date().toISOString(),
        windowEnd: new Date().toISOString(),
        scanned: 0,
        compactedGroups: 0,
        retained: 0,
        deleted: 0,
        createdCompactions: 0,
        dryRun,
        skippedReason: 'database_not_initialized'
      };
    }

    if (this.tapeRunning) {
      return {
        windowStart: new Date().toISOString(),
        windowEnd: new Date().toISOString(),
        scanned: 0,
        compactedGroups: 0,
        retained: 0,
        deleted: 0,
        createdCompactions: 0,
        dryRun,
        skippedReason: 'already_running'
      };
    }

    this.tapeRunning = true;
    try {
      const retentionDays = settings.phoenixTape.retentionDays;
      const windowHours = settings.phoenixTape.compactionWindowHours;
      const keepPerTool = settings.phoenixTape.compactionKeepPerTool;
      const minCount = settings.phoenixTape.compactionMinCount;
      const maxDeletes = settings.phoenixTape.compactionMaxDeletes;

      const windowEnd = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
      const windowStart = new Date(windowEnd.getTime() - windowHours * 3600 * 1000);

      const repository = AppDataSource.getRepository(ToolTapeEntry);
      const compactionRepo = AppDataSource.getRepository(ToolTapeCompaction);

      const entries = await repository.find({
        where: {
          finishedAt: LessThan(windowEnd)
        }
      });

      const report: TapeCompactionReport = {
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        scanned: entries.length,
        compactedGroups: 0,
        retained: 0,
        deleted: 0,
        createdCompactions: 0,
        dryRun
      };

      const groups = new Map<string, ToolTapeEntry[]>();
      for (const entry of entries) {
        const key = `${entry.toolHash}:${entry.contextFingerprint ?? 'none'}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(entry);
      }

      let globalDeleted = 0;
      for (const [key, group] of groups.entries()) {
        if (globalDeleted >= maxDeletes) break;
        if (group.length < minCount) continue;

        const [toolHash, contextFingerprint] = key.split(':');
        const digestSeed = group
          .map(item => `${stableStringify(item.argsJson)}|${stableStringify(item.resultJson)}|${item.error ?? ''}`)
          .join('::');
        const digest = sha256(digestSeed);
        const groupHash = simhash64(digestSeed);

        const successCount = group.filter(item => item.status === 'succeeded').length;
        const failureCount = group.filter(item => item.status === 'failed').length;
        const distinctIdempotency = new Set(group.map(item => item.idempotencyKey)).size;

        const scored = group.map(item => {
          const payload = `${stableStringify(item.argsJson)}|${stableStringify(item.resultJson)}|${item.error ?? ''}`;
          const similarity = 1 - hamming(simhash64(payload), groupHash) / 64;
          return { item, similarity };
        });

        scored.sort((a, b) => {
          if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1;
          if (b.similarity !== a.similarity) return b.similarity - a.similarity;
          return (b.item.startedAt?.getTime?.() ?? 0) - (a.item.startedAt?.getTime?.() ?? 0);
        });

        const retained = new Set(scored.slice(0, keepPerTool).map(s => s.item.id));
        const deleteCandidates = scored
          .filter(s => !s.item.pinned && !retained.has(s.item.id))
          .map(s => s.item);

        const sampleArgs = scored.slice(0, 2).map(s => s.item.argsJson);
        const sampleResults = scored.slice(0, 2).map(s => s.item.resultJson);

        if (!dryRun) {
          const normalizedFingerprint = contextFingerprint === 'none' ? undefined : contextFingerprint;
          const existingCompaction = await compactionRepo.findOne({
            where: {
              toolHash,
              contextFingerprint: normalizedFingerprint,
              digest,
              createdAt: MoreThan(new Date(Date.now() - 24 * 3600 * 1000))
            }
          });

          if (!existingCompaction) {
            const compaction = compactionRepo.create({
              toolHash,
              contextFingerprint: normalizedFingerprint,
              windowStart,
              windowEnd,
              totalCount: group.length,
              successCount,
              failureCount,
              distinctIdempotency,
              digest,
              summaryJson: {
                toolHash,
                contextFingerprint: normalizedFingerprint ?? null,
                successRate: group.length ? successCount / group.length : 0,
                representativeIds: Array.from(retained),
                sampleArgs,
                sampleResults,
                failureSamples: scored.filter(s => s.item.status === 'failed').slice(0, 2).map(s => s.item.error)
              }
            });
            await compactionRepo.save(compaction);
            report.createdCompactions += 1;
          }
        }

        report.compactedGroups += 1;
        report.retained += retained.size;

        let deleted = 0;
        for (const candidate of deleteCandidates) {
          if (globalDeleted >= maxDeletes) break;
          if (!dryRun) {
            await repository.delete(candidate.id);
          }
          deleted += 1;
          globalDeleted += 1;
        }
        report.deleted += deleted;
      }

      this.lastTapeCompactionAt = new Date().toISOString();
      this.lastTapeCompactionError = undefined;
      this.lastTapeReport = report;
      return report;
    } catch (error: any) {
      this.lastTapeCompactionError = error?.message || String(error);
      throw error;
    } finally {
      this.tapeRunning = false;
    }
  }

  async runMemoryCompaction(): Promise<MemoryCompactionReport> {
    if (this.memoryRunning) {
      return {
        clusters: 0,
        summariesCreated: 0,
        deleted: 0,
        retained: 0,
        skippedReason: 'already_running'
      };
    }

    this.memoryRunning = true;
    try {
      const report = await this.memory.compact({
        minClusterSize: 3,
        keepPerCluster: 2,
        createSummaries: true
      });

      this.lastMemoryCompactionAt = new Date().toISOString();
      this.lastMemoryCompactionError = undefined;
      this.lastMemoryReport = report;
      return report;
    } catch (error: any) {
      this.lastMemoryCompactionError = error?.message || String(error);
      throw error;
    } finally {
      this.memoryRunning = false;
    }
  }
}
