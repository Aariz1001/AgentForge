import { v4 as uuidv4 } from 'uuid';

export interface MemoryEntry {
  id: string;
  key: string;
  value: any;
  scope: 'global';
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export class SharedMemoryService {
  private entries: Map<string, MemoryEntry> = new Map();
  private maxEntries: number;
  private ttlSeconds: number;

  constructor(options: { maxEntries: number; ttlSeconds: number }) {
    this.maxEntries = options.maxEntries;
    this.ttlSeconds = options.ttlSeconds;
  }

  set(key: string, value: any, tags?: string[]): MemoryEntry {
    this.pruneExpired();
    const now = new Date().toISOString();
    const existing = this.entries.get(key);
    const entry: MemoryEntry = {
      id: existing?.id || uuidv4(),
      key,
      value,
      scope: 'global',
      tags: tags || existing?.tags,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.entries.set(key, entry);
    this.pruneOverflow();
    return entry;
  }

  get(key: string): MemoryEntry | null {
    this.pruneExpired();
    return this.entries.get(key) || null;
  }

  list(): MemoryEntry[] {
    this.pruneExpired();
    return Array.from(this.entries.values());
  }

  search(term: string): MemoryEntry[] {
    this.pruneExpired();
    const needle = term.toLowerCase();
    return Array.from(this.entries.values()).filter(entry =>
      entry.key.toLowerCase().includes(needle) ||
      JSON.stringify(entry.value).toLowerCase().includes(needle) ||
      (entry.tags || []).some(tag => tag.toLowerCase().includes(needle))
    );
  }

  private pruneOverflow(): void {
    if (this.entries.size <= this.maxEntries) return;
    const sorted = Array.from(this.entries.values())
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const overflow = sorted.length - this.maxEntries;
    for (let i = 0; i < overflow; i++) {
      this.entries.delete(sorted[i].key);
    }
  }

  private pruneExpired(): void {
    if (this.ttlSeconds <= 0) return;
    const cutoff = Date.now() - this.ttlSeconds * 1000;
    for (const [key, entry] of this.entries.entries()) {
      const updated = Date.parse(entry.updatedAt);
      if (!Number.isNaN(updated) && updated < cutoff) {
        this.entries.delete(key);
      }
    }
  }
}
