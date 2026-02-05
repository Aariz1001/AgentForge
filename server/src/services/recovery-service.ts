import { AppDataSource } from '../models/database';
import { ToolTapeEntry } from '../models/schema';
import { settings } from '../core/config';

export class RecoveryService {
  async reconcileOrphanedToolTapeEntries(): Promise<number> {
    if (!AppDataSource.isInitialized) return 0;

    const repository = AppDataSource.getRepository(ToolTapeEntry);
    const now = Date.now();
    const graceMs = settings.phoenixTape.orphanGraceMs;
    const defaultTimeout = settings.phoenixTape.defaultTimeoutMs;

    const candidates = await repository.find({ where: { status: 'started' } });

    let updated = 0;
    for (const entry of candidates) {
      const timeoutMs = entry.timeoutMs ?? defaultTimeout;
      const expired = now - entry.startedAt.getTime() > timeoutMs + graceMs;
      if (!expired) continue;

      entry.status = 'orphaned';
      entry.error = entry.error || 'Marked orphaned after restart recovery';
      entry.finishedAt = new Date();
      await repository.save(entry);
      updated += 1;
    }

    return updated;
  }
}
