import { VectorStore } from './vector-store';
import chalk from 'chalk';

export enum MemoryTier {
  WORKING = 'working',   // Short-term conversational context
  EPISODIC = 'episodic', // Specific events and interactions
  SEMANTIC = 'semantic'  // General knowledge and structured beliefs
}

export interface MemoryNode {
  id: string;
  tier: MemoryTier;
  content: string;
  importance: number;
  lastAccessed: string;
  relations: string[]; // IDs of related nodes
}

/**
 * HierarchyManager consolidates memories across different tiers.
 * It prevents "catastrophic forgetting" by promoting episodic events
 * into semantic schemas.
 */
export class HierarchyManager {
  private vectorStore: VectorStore;
  private nodes: Map<string, MemoryNode> = new Map();

  constructor(vectorStore: VectorStore) {
    this.vectorStore = vectorStore;
  }

  /**
   * Add a new observation to the hierarchy
   */
  async record(content: string, tier: MemoryTier = MemoryTier.EPISODIC): Promise<void> {
    const id = Math.random().toString(36).substring(2, 9);
    const node: MemoryNode = {
      id,
      tier,
      content,
      importance: this.calculateImportance(content),
      lastAccessed: new Date().toISOString(),
      relations: []
    };

    this.nodes.set(id, node);
    
    // In a real implementation, we would generate an actual embedding here
    // For now, we use a placeholder random vector of size 1536
    const mockVector = Array.from({ length: 1536 }, () => Math.random());
    await this.vectorStore.add(mockVector, { nodeId: id, tier });
    
    console.log(chalk.gray(`[Hierarchy] Recorded ${tier} memory: ${id}`));
  }

  /**
   * Consolidate episodic memories into semantic ones
   */
  async consolidate(): Promise<number> {
    console.log(chalk.magenta(' [Hierarchy] Starting consolidation job...'));
    
    const episodicNodes = Array.from(this.nodes.values())
      .filter(n => n.tier === MemoryTier.EPISODIC && n.importance > 0.7);

    let consolidatedCount = 0;
    
    // Simplistic algorithm: If multiple episodic items are similar, merge them
    // In this MVP, we just "promote" high-importance episodic items to semantic
    for (const node of episodicNodes) {
      if (!this.isAlreadySemantic(node)) {
        node.tier = MemoryTier.SEMANTIC;
        consolidatedCount++;
      }
    }

    return consolidatedCount;
  }

  private calculateImportance(content: string): number {
    // Basic heuristic: length and presence of key emotional or logical keywords
    let score = content.length > 100 ? 0.5 : 0.2;
    if (content.match(/error|failed|success|learned|remember|critical/i)) score += 0.4;
    return Math.min(score, 1.0);
  }

  private isAlreadySemantic(node: MemoryNode): boolean {
    return Array.from(this.nodes.values()).some(n => 
      n.tier === MemoryTier.SEMANTIC && 
      n.content === node.content
    );
  }

  getNodes(tier?: MemoryTier): MemoryNode[] {
    if (tier) {
      return Array.from(this.nodes.values()).filter(n => n.tier === tier);
    }
    return Array.from(this.nodes.values());
  }
}
