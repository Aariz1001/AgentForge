import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { MemoryTier } from './hierarchy-manager';

export interface MemoryRecord {
  id: string;
  key?: string;
  content: string;
  tier: MemoryTier;
  tags?: string[];
  source?: string;
  metadata?: any;
  importance: number;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessed: string;
  accessCount: number;
  embedding: number[];
  termFreq: Record<string, number>;
  docLength: number;
  simhash: string;
}

export interface MemorySearchOptions {
  limit?: number;
  tiers?: MemoryTier[];
  tags?: string[];
  source?: string;
  includeMetadata?: boolean;
  weights?: {
    keyword?: number;
    semantic?: number;
    recency?: number;
    importance?: number;
  };
}

export interface MemorySearchResult {
  record: Omit<MemoryRecord, 'embedding' | 'termFreq' | 'simhash'>;
  score: number;
  breakdown: {
    keyword: number;
    semantic: number;
    recency: number;
    importance: number;
  };
}

export interface MemoryCompactionReport {
  clusters: number;
  summariesCreated: number;
  deleted: number;
  retained: number;
}

export interface MemoryEngineOptions {
  maxEntries: number;
  ttlSeconds: number;
  persistPath: string;
  embeddingDimensions?: number;
  saveIntervalMs?: number;
  workingTtlSeconds?: number;
  recencyHalfLifeHours?: number;
}

const DEFAULT_EMBEDDING_DIMENSIONS = 256;

export class MemoryEngine {
  private records: Map<string, MemoryRecord> = new Map();
  private keyIndex: Map<string, string> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();
  private sourceIndex: Map<string, Set<string>> = new Map();
  private lshIndex: Map<string, Set<string>> = new Map();
  private docFreq: Map<string, number> = new Map();
  private totalDocs = 0;
  private avgDocLength = 0;
  private options: MemoryEngineOptions;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(options: MemoryEngineOptions) {
    this.options = {
      embeddingDimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      saveIntervalMs: 2000,
      workingTtlSeconds: options.ttlSeconds,
      recencyHalfLifeHours: 72,
      ...options
    };
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.options.persistPath, 'utf-8');
      const stored: MemoryRecord[] = JSON.parse(data);
      this.records.clear();
      this.keyIndex.clear();
      stored.forEach(record => this.hydrateRecord(record));
      this.rebuildIndexes();
    } catch {
      this.records.clear();
      this.keyIndex.clear();
      this.invertedIndex.clear();
      this.tagIndex.clear();
      this.sourceIndex.clear();
      this.lshIndex.clear();
      this.docFreq.clear();
      this.totalDocs = 0;
      this.avgDocLength = 0;
    }
  }

  async save(): Promise<void> {
    const dir = dirname(this.options.persistPath);
    await fs.mkdir(dir, { recursive: true });
    const payload = Array.from(this.records.values());
    await fs.writeFile(this.options.persistPath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  remember(content: string, options: {
    key?: string;
    tier?: MemoryTier;
    tags?: string[];
    source?: string;
    metadata?: any;
    importance?: number;
    pinned?: boolean;
  } = {}): MemoryRecord {
    const now = new Date().toISOString();
    const tier = this.normalizeTier(options.tier);
    const importance = options.importance ?? this.estimateImportance(content);

    const existingId = options.key ? this.keyIndex.get(options.key) : undefined;
    if (existingId) {
      const existing = this.records.get(existingId);
      if (existing) {
        this.removeIndexes(existing);
        const updated = this.buildRecord(existing.id, content, {
          ...options,
          tier,
          importance,
          createdAt: existing.createdAt,
          accessCount: existing.accessCount,
          lastAccessed: existing.lastAccessed
        });
        this.records.set(existing.id, updated);
        this.addIndexes(updated);
        this.scheduleSave();
        return updated;
      }
    }

    const id = this.generateId();
    const record = this.buildRecord(id, content, {
      ...options,
      tier,
      importance,
      createdAt: now
    });

    this.records.set(id, record);
    if (options.key) this.keyIndex.set(options.key, id);
    this.addIndexes(record);
    this.prune();
    this.scheduleSave();
    return record;
  }

  private normalizeTier(tier?: MemoryTier): MemoryTier {
    if (!tier) return MemoryTier.EPISODIC;
    const values = Object.values(MemoryTier) as string[];
    return values.includes(tier as string) ? tier : MemoryTier.EPISODIC;
  }

  get(id: string): MemoryRecord | null {
    const record = this.records.get(id);
    if (!record) return null;
    this.touch(record);
    return record;
  }

  list(): Array<Omit<MemoryRecord, 'embedding' | 'termFreq' | 'simhash'>> {
    this.pruneExpired();
    return Array.from(this.records.values()).map(r => this.stripInternal(r));
  }

  delete(id: string): boolean {
    const record = this.records.get(id);
    if (!record) return false;
    this.removeIndexes(record);
    this.records.delete(id);
    if (record.key) this.keyIndex.delete(record.key);
    this.recalculateStats();
    this.scheduleSave();
    return true;
  }

  search(query: string, options: MemorySearchOptions = {}): MemorySearchResult[] {
    this.pruneExpired();
    const weights = {
      keyword: options.weights?.keyword ?? 0.5,
      semantic: options.weights?.semantic ?? 0.3,
      recency: options.weights?.recency ?? 0.1,
      importance: options.weights?.importance ?? 0.1
    };

    const tokens = this.tokenize(query);
    const queryEmbedding = this.computeEmbedding(query);
    const candidateIds = this.collectCandidates(tokens, queryEmbedding, options);
    if (candidateIds.size === 0) return [];

    const now = Date.now();
    const halfLifeHours = this.options.recencyHalfLifeHours ?? 72;
    const halfLifeMs = halfLifeHours * 3600 * 1000;

    const results: MemorySearchResult[] = [];
    for (const id of candidateIds) {
      const record = this.records.get(id);
      if (!record) continue;
      if (options.tiers && !options.tiers.includes(record.tier)) continue;
      if (options.tags && !this.hasAnyTag(record, options.tags)) continue;
      if (options.source && record.source !== options.source) continue;

      const keywordScore = tokens.length ? this.computeKeywordScore(tokens, record) : 0;
      const semanticScore = query ? this.cosineSimilarity(queryEmbedding, record.embedding) : 0;
      const ageMs = now - Date.parse(record.updatedAt);
      const recencyScore = halfLifeMs > 0 ? Math.exp(-ageMs / halfLifeMs) : 0;
      const importanceScore = record.importance;

      const score =
        keywordScore * weights.keyword +
        semanticScore * weights.semantic +
        recencyScore * weights.recency +
        importanceScore * weights.importance;

      results.push({
        record: this.stripInternal(record, options.includeMetadata),
        score,
        breakdown: {
          keyword: keywordScore,
          semantic: semanticScore,
          recency: recencyScore,
          importance: importanceScore
        }
      });
    }

    results.sort((a, b) => b.score - a.score);
    const limit = options.limit ?? 8;
    return results.slice(0, limit).map(result => {
      const record = this.records.get(result.record.id);
      if (record) this.touch(record);
      return result;
    });
  }

  consolidate(): number {
    let promoted = 0;
    for (const record of this.records.values()) {
      if (record.tier !== MemoryTier.EPISODIC) continue;
      const shouldPromote = record.importance >= 0.8 || record.accessCount >= 5;
      if (shouldPromote) {
        record.tier = MemoryTier.SEMANTIC;
        record.updatedAt = new Date().toISOString();
        promoted += 1;
      }
    }
    if (promoted > 0) this.scheduleSave();
    return promoted;
  }

  compact(options: {
    minClusterSize?: number;
    keepPerCluster?: number;
    createSummaries?: boolean;
  } = {}): MemoryCompactionReport {
    const minClusterSize = options.minClusterSize ?? 3;
    const keepPerCluster = options.keepPerCluster ?? 2;
    const createSummaries = options.createSummaries ?? true;

    const ids = Array.from(this.records.keys());
    const parent = new Map<string, string>();

    const find = (x: string): string => {
      const p = parent.get(x) || x;
      if (p !== x) parent.set(x, find(p));
      return parent.get(x) || x;
    };

    const union = (a: string, b: string): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    for (const [band, bandIds] of this.lshIndex.entries()) {
      const bandList = Array.from(bandIds);
      if (bandList.length < 2) continue;
      for (let i = 1; i < bandList.length; i++) {
        union(bandList[0], bandList[i]);
      }
    }

    const clusters = new Map<string, string[]>();
    for (const id of ids) {
      const root = find(id);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root)!.push(id);
    }

    let summariesCreated = 0;
    let deleted = 0;
    let retained = 0;

    for (const cluster of clusters.values()) {
      if (cluster.length < minClusterSize) {
        retained += cluster.length;
        continue;
      }

      const records = cluster
        .map(id => this.records.get(id))
        .filter(Boolean) as MemoryRecord[];

      const candidates = records.filter(r => r.tier === MemoryTier.EPISODIC && !r.pinned);
      if (candidates.length < minClusterSize) {
        retained += records.length;
        continue;
      }

      const centroid = candidates[0].embedding;
      const scored = candidates.map(r => ({
        record: r,
        score: this.cosineSimilarity(centroid, r.embedding) + r.importance + r.accessCount * 0.02
      }));

      scored.sort((a, b) => b.score - a.score);
      const keep = new Set(scored.slice(0, keepPerCluster).map(s => s.record.id));

      if (createSummaries) {
        const tokens = candidates.flatMap(r => this.tokenize(r.content));
        const topTokens = Array.from(tokens.reduce((acc, t) => acc.set(t, (acc.get(t) || 0) + 1), new Map<string, number>()))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([t]) => t);
        const summaryContent = `Constellation summary: ${topTokens.join(', ')}.`;
        this.remember(summaryContent, {
          tier: MemoryTier.SEMANTIC,
          tags: ['compaction', 'constellation'],
          metadata: {
            clusterSize: cluster.length,
            kept: Array.from(keep),
            sample: candidates.slice(0, 2).map(r => r.content)
          },
          importance: 0.75
        });
        summariesCreated += 1;
      }

      for (const record of candidates) {
        if (keep.has(record.id)) {
          retained += 1;
          continue;
        }
        this.delete(record.id);
        deleted += 1;
      }
    }

    return {
      clusters: clusters.size,
      summariesCreated,
      deleted,
      retained
    };
  }

  private buildRecord(id: string, content: string, options: {
    key?: string;
    tier: MemoryTier;
    tags?: string[];
    source?: string;
    metadata?: any;
    importance: number;
    pinned?: boolean;
    createdAt?: string;
    accessCount?: number;
    lastAccessed?: string;
  }): MemoryRecord {
    const now = new Date().toISOString();
    const tokens = this.tokenize(content);
    const termFreq = this.buildTermFreq(tokens);
    const embedding = this.computeEmbedding(content);
    const simhash = this.computeSimhash(tokens);
    return {
      id,
      key: options.key,
      content,
      tier: options.tier,
      tags: options.tags,
      source: options.source,
      metadata: options.metadata,
      importance: Math.max(0, Math.min(options.importance, 1)),
      pinned: options.pinned,
      createdAt: options.createdAt ?? now,
      updatedAt: now,
      lastAccessed: options.lastAccessed ?? now,
      accessCount: options.accessCount ?? 0,
      embedding,
      termFreq,
      docLength: tokens.length,
      simhash
    };
  }

  private hydrateRecord(record: MemoryRecord): void {
    const hydrated: MemoryRecord = {
      ...record,
      importance: Math.max(0, Math.min(record.importance ?? 0.1, 1)),
      createdAt: record.createdAt ?? new Date().toISOString(),
      updatedAt: record.updatedAt ?? new Date().toISOString(),
      lastAccessed: record.lastAccessed ?? record.updatedAt ?? new Date().toISOString(),
      accessCount: record.accessCount ?? 0,
      embedding: record.embedding ?? this.computeEmbedding(record.content),
      termFreq: record.termFreq ?? this.buildTermFreq(this.tokenize(record.content)),
      docLength: record.docLength ?? this.tokenize(record.content).length,
      simhash: record.simhash ?? this.computeSimhash(this.tokenize(record.content))
    };

    this.records.set(hydrated.id, hydrated);
    if (hydrated.key) this.keyIndex.set(hydrated.key, hydrated.id);
  }

  private rebuildIndexes(): void {
    this.invertedIndex.clear();
    this.tagIndex.clear();
    this.sourceIndex.clear();
    this.lshIndex.clear();
    this.docFreq.clear();
    this.totalDocs = 0;
    this.avgDocLength = 0;
    for (const record of this.records.values()) {
      this.addIndexes(record, false);
    }
    this.recalculateStats();
  }

  private addIndexes(record: MemoryRecord, updateStats: boolean = true): void {
    this.totalDocs += updateStats ? 1 : 0;
    this.avgDocLength = updateStats
      ? (this.avgDocLength * (this.totalDocs - 1) + record.docLength) / this.totalDocs
      : this.avgDocLength;

    for (const term of Object.keys(record.termFreq)) {
      if (!this.invertedIndex.has(term)) this.invertedIndex.set(term, new Set());
      this.invertedIndex.get(term)!.add(record.id);
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }

    if (record.tags) {
      for (const tag of record.tags) {
        const key = tag.toLowerCase();
        if (!this.tagIndex.has(key)) this.tagIndex.set(key, new Set());
        this.tagIndex.get(key)!.add(record.id);
      }
    }

    if (record.source) {
      const key = record.source.toLowerCase();
      if (!this.sourceIndex.has(key)) this.sourceIndex.set(key, new Set());
      this.sourceIndex.get(key)!.add(record.id);
    }

    this.addLsh(record);
  }

  private removeIndexes(record: MemoryRecord): void {
    for (const term of Object.keys(record.termFreq)) {
      this.invertedIndex.get(term)?.delete(record.id);
      const count = (this.docFreq.get(term) ?? 1) - 1;
      if (count <= 0) this.docFreq.delete(term);
      else this.docFreq.set(term, count);
    }

    if (record.tags) {
      for (const tag of record.tags) {
        this.tagIndex.get(tag.toLowerCase())?.delete(record.id);
      }
    }

    if (record.source) {
      this.sourceIndex.get(record.source.toLowerCase())?.delete(record.id);
    }

    this.removeLsh(record);
  }

  private addLsh(record: MemoryRecord): void {
    const bands = this.getLshBands(record.simhash);
    for (const band of bands) {
      if (!this.lshIndex.has(band)) this.lshIndex.set(band, new Set());
      this.lshIndex.get(band)!.add(record.id);
    }
  }

  private removeLsh(record: MemoryRecord): void {
    const bands = this.getLshBands(record.simhash);
    for (const band of bands) {
      this.lshIndex.get(band)?.delete(record.id);
    }
  }

  private recalculateStats(): void {
    const lengths = Array.from(this.records.values()).map(r => r.docLength);
    this.totalDocs = lengths.length;
    this.avgDocLength = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  }

  private collectCandidates(tokens: string[], queryEmbedding: number[], options: MemorySearchOptions): Set<string> {
    const candidates = new Set<string>();

    for (const token of tokens) {
      const ids = this.invertedIndex.get(token);
      if (ids) ids.forEach(id => candidates.add(id));
    }

    if (tokens.length > 0 && queryEmbedding.length > 0) {
      const simhash = this.computeSimhash(tokens);
      const bands = this.getLshBands(simhash);
      for (const band of bands) {
        const ids = this.lshIndex.get(band);
        if (ids) ids.forEach(id => candidates.add(id));
      }
    }

    if (options.tags) {
      const tagMatches = new Set<string>();
      options.tags.forEach(tag => {
        this.tagIndex.get(tag.toLowerCase())?.forEach(id => tagMatches.add(id));
      });
      if (tagMatches.size > 0) {
        return new Set([...candidates].filter(id => tagMatches.has(id)));
      }
    }

    if (tokens.length === 0 || candidates.size === 0) {
      this.records.forEach((_value, key) => candidates.add(key));
    }

    return candidates;
  }

  private computeKeywordScore(tokens: string[], record: MemoryRecord): number {
    if (this.totalDocs === 0) return 0;
    const k1 = 1.2;
    const b = 0.75;
    let score = 0;
    for (const token of tokens) {
      const freq = record.termFreq[token] ?? 0;
      if (freq === 0) continue;
      const df = this.docFreq.get(token) ?? 1;
      const idf = Math.log(1 + (this.totalDocs - df + 0.5) / (df + 0.5));
      const tf = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (record.docLength / (this.avgDocLength || 1))));
      score += idf * tf;
    }
    return score;
  }

  private estimateImportance(content: string): number {
    let score = content.length > 180 ? 0.4 : 0.2;
    if (content.match(/error|failed|critical|remember|important|success|decision|constraint|risk/i)) score += 0.4;
    if (content.match(/todo|action|plan|strategy|milestone/i)) score += 0.2;
    return Math.min(score, 1);
  }

  private tokenize(text: string): string[] {
    const matches = text.toLowerCase().match(/[a-z0-9]{2,}/g);
    return matches ? matches.slice(0, 128) : [];
  }

  private buildTermFreq(tokens: string[]): Record<string, number> {
    return tokens.reduce((acc, token) => {
      acc[token] = (acc[token] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private computeEmbedding(text: string): number[] {
    const dim = this.options.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
    const vector = new Array(dim).fill(0);
    const tokens = this.tokenize(text);

    for (const token of tokens) {
      const hashed = this.hashString(token);
      const index = hashed % dim;
      vector[index] += 1;

      if (token.length > 3) {
        for (let i = 0; i < token.length - 2; i++) {
          const trigram = token.slice(i, i + 3);
          const triHash = this.hashString(trigram);
          const triIndex = triHash % dim;
          vector[triIndex] += 0.5;
        }
      }
    }

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map(v => v / norm);
  }

  private cosineSimilarity(v1: number[], v2: number[]): number {
    let dot = 0;
    for (let i = 0; i < Math.min(v1.length, v2.length); i++) {
      dot += v1[i] * v2[i];
    }
    return dot;
  }

  private hashString(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
  }

  private computeSimhash(tokens: string[]): string {
    const bitSums = new Array(64).fill(0);
    for (const token of tokens) {
      const hash = this.hashString64(token);
      for (let i = 0; i < 64; i++) {
        const bit = (hash >> BigInt(i)) & 1n;
        bitSums[i] += bit === 1n ? 1 : -1;
      }
    }
    let simhash = 0n;
    for (let i = 0; i < 64; i++) {
      if (bitSums[i] >= 0) {
        simhash |= 1n << BigInt(i);
      }
    }
    return simhash.toString();
  }

  private hashString64(text: string): bigint {
    let hash = 1469598103934665603n;
    for (let i = 0; i < text.length; i++) {
      hash ^= BigInt(text.charCodeAt(i));
      hash *= 1099511628211n;
    }
    return hash;
  }

  private getLshBands(simhash: string): string[] {
    const value = BigInt(simhash);
    const bands: string[] = [];
    for (let band = 0; band < 4; band++) {
      const shift = BigInt(band * 16);
      const bandValue = Number((value >> shift) & 0xffffn);
      bands.push(`${band}:${bandValue}`);
    }
    return bands;
  }

  private touch(record: MemoryRecord): void {
    record.lastAccessed = new Date().toISOString();
    record.accessCount += 1;
  }

  private prune(): void {
    this.pruneExpired();
    if (this.records.size <= this.options.maxEntries) return;
    const candidates = Array.from(this.records.values())
      .filter(r => !r.pinned)
      .sort((a, b) => {
        const scoreA = a.importance + a.accessCount * 0.01;
        const scoreB = b.importance + b.accessCount * 0.01;
        return scoreA - scoreB;
      });

    const overflow = this.records.size - this.options.maxEntries;
    for (let i = 0; i < overflow && i < candidates.length; i++) {
      this.delete(candidates[i].id);
    }
  }

  private pruneExpired(): void {
    const ttlSeconds = this.options.workingTtlSeconds ?? 0;
    if (ttlSeconds <= 0) return;
    const cutoff = Date.now() - ttlSeconds * 1000;
    for (const record of this.records.values()) {
      if (record.tier !== MemoryTier.WORKING) continue;
      const updated = Date.parse(record.updatedAt);
      if (!Number.isNaN(updated) && updated < cutoff && !record.pinned) {
        this.delete(record.id);
      }
    }
  }

  private stripInternal(record: MemoryRecord, includeMetadata: boolean = true): Omit<MemoryRecord, 'embedding' | 'termFreq' | 'simhash'> {
    const { embedding, termFreq, simhash, ...rest } = record;
    if (!includeMetadata) {
      const { metadata, ...safe } = rest;
      return safe;
    }
    return rest;
  }

  private hasAnyTag(record: MemoryRecord, tags: string[]): boolean {
    if (!record.tags || record.tags.length === 0) return false;
    const recordTags = new Set(record.tags.map(tag => tag.toLowerCase()));
    return tags.some(tag => recordTags.has(tag.toLowerCase()));
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    const delay = this.options.saveIntervalMs ?? 2000;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      await this.save();
    }, delay);
  }

  private generateId(): string {
    return `mem_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const buildMemoryEngine = (options: MemoryEngineOptions): MemoryEngine => {
  return new MemoryEngine(options);
};