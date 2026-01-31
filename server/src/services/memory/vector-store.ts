import { v4 as uuidv4 } from 'uuid';

export interface VectorEntry {
  id: string;
  vector: number[];
  metadata: any;
  createdAt: string;
}

/**
 * Lightweight, in-memory Vector Store for AgentForge.
 * In a production environment, this would be replaced with Pinecone, Qdrant, or Chroma.
 */
export class VectorStore {
  private entries: VectorEntry[] = [];

  constructor() {}

  /**
   * Add a vector to the store
   */
  async add(vector: number[], metadata: any): Promise<string> {
    const id = uuidv4();
    this.entries.push({
      id,
      vector,
      metadata,
      createdAt: new Date().toISOString()
    });
    return id;
  }

  /**
   * Search for similar vectors using cosine similarity
   */
  async search(queryVector: number[], limit: number = 5): Promise<VectorEntry[]> {
    if (this.entries.length === 0) return [];

    const scored = this.entries.map(entry => ({
      ...entry,
      score: this.cosineSimilarity(queryVector, entry.vector)
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Simple cosine similarity calculation
   */
  private cosineSimilarity(v1: number[], v2: number[]): number {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
      norm1 += v1[i] * v1[i];
      norm2 += v2[i] * v2[i];
    }
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Delete an entry
   */
  async delete(id: string): Promise<void> {
    this.entries = this.entries.filter(e => e.id !== id);
  }

  /**
   * Persist to disk (Simplified)
   */
  async save(filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, JSON.stringify(this.entries), 'utf-8');
  }

  /**
   * Load from disk
   */
  async load(filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      this.entries = JSON.parse(data);
    } catch (e) {
      this.entries = [];
    }
  }
}
