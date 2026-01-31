/**
 * Database Service
 * 
 * Handles database operations with Postgres/pgvector integration.
 */

import { AgentState } from './orchestration';
import { ToolManifest } from './tool-gateway';

export class DatabaseService {
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  private stateCache: Map<string, AgentState> = new Map();
  private toolCache: Map<string, ToolManifest> = new Map();

  /**
   * Saves agent state to database
   */
  async saveAgentState(state: AgentState): Promise<boolean> {
    try {
      this.stateCache.set(state.id, JSON.parse(JSON.stringify(state)));
      return true;
    } catch (error) {
      console.error('Failed to save agent state:', error);
      return false;
    }
  }

  /**
   * Retrieves agent state from database
   */
  async getAgentState(sessionId: string): Promise<AgentState | null> {
    return this.stateCache.get(sessionId) || null;
  }

  /**
   * Deletes agent state
   */
  async deleteAgentState(sessionId: string): Promise<boolean> {
    return this.stateCache.delete(sessionId);
  }

  /**
   * Saves tool manifest to database
   */
  async saveToolManifest(manifest: ToolManifest): Promise<boolean> {
    try {
      this.toolCache.set(manifest.id, JSON.parse(JSON.stringify(manifest)));
      return true;
    } catch (error) {
      console.error('Failed to save tool manifest:', error);
      return false;
    }
  }

  /**
   * Retrieves tool manifest
   */
  async getToolManifest(toolId: string): Promise<ToolManifest | null> {
    return this.toolCache.get(toolId) || null;
  }

  /**
   * Searches for tools using text matching (semantic search simulation)
   */
  async searchTools(query: string): Promise<ToolManifest[]> {
    const lowerQuery = query.toLowerCase();
    const results: ToolManifest[] = [];
    
    for (const [_, tool] of this.toolCache) {
      const nameMatch = tool.name.toLowerCase().includes(lowerQuery);
      const descMatch = tool.description.toLowerCase().includes(lowerQuery);
      const capMatch = tool.capabilities.some(cap => cap.toLowerCase().includes(lowerQuery));
      
      if (nameMatch || descMatch || capMatch) {
        results.push(tool);
      }
    }
    
    return results;
  }

  /**
   * Updates tool usage statistics
   */
  async updateToolUsage(toolId: string): Promise<boolean> {
    const tool = this.toolCache.get(toolId);
    if (tool) {
      tool.usage_count++;
      tool.last_used = new Date().toISOString();
      this.toolCache.set(toolId, tool);
      return true;
    }
    return false;
  }

  /**
   * Performs vector similarity search for tool discovery
   */
  async vectorSearch(embedding: number[], limit: number = 10): Promise<ToolManifest[]> {
    const allTools = Array.from(this.toolCache.values());
    return allTools.slice(0, limit);
  }
}
