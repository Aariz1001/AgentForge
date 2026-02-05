/**
 * Tool Gateway & Registry Service
 * 
 * Provides out-of-process execution kernel using E2B sandboxes.
 * Maintains Hot Buffer cache and PRB-based tool selection.
 */

import { randomUUID } from 'crypto';
import { DatabaseService } from './database';
import { ToolTapeService } from './tool-tape';

export interface Config {
  get(key: string): any;
  set(key: string, value: any): void;
}

export interface ToolManifest {
  id: string;
  name: string;
  description: string;
  content_hash: string;
  prb_score: number;
  usage_count: number;
  last_used: string;
  capabilities: string[];
}

export interface ExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  duration_ms: number;
  sandbox_id?: string;
}

export class ToolGatewayService {
  private config: Config;
  private db: DatabaseService;
  private hotBuffer: Map<string, ToolManifest>; // L1 cache
  private readonly HOT_BUFFER_SIZE = 20;
  private toolTape?: ToolTapeService;

  constructor(config: Config, db: DatabaseService, options: { toolTape?: ToolTapeService } = {}) {
    this.config = config;
    this.db = db;
    this.toolTape = options.toolTape;
    this.hotBuffer = new Map();
  }

  /**
   * Registers a validated tool artifact
   */
  async registerTool(manifest: ToolManifest): Promise<boolean> {
    try {
      await this.db.saveToolManifest(manifest);
      this.updateHotBuffer(manifest);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Executes a tool in an E2B sandbox
   */
  async executeTool(
    toolId: string,
    input: any,
    context: {
      runId?: string;
      traceId?: string;
      stepId?: string;
      contextFingerprint?: string;
      volatile?: boolean;
    } = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Check hot buffer first
      let tool: ToolManifest | null | undefined = this.hotBuffer.get(toolId);
      
      if (!tool) {
        // Load from database
        tool = await this.db.getToolManifest(toolId);
        if (!tool) {
          return {
            success: false,
            error: 'TOOL_NOT_FOUND',
            duration_ms: Date.now() - startTime
          };
        }
        this.updateHotBuffer(tool);
      }

      // Execute in E2B sandbox (placeholder)
      const sandboxId = this.createSandboxId();

      const execute = async () => this.executeInSandbox(tool, input, sandboxId);

      const result = this.toolTape
        ? await this.toolTape.getOrExecute({
            toolHash: tool.content_hash || tool.id,
            args: input,
            execute,
            context: {
              runId: context.runId ?? 'tool-run',
              traceId: context.traceId ?? randomUUID(),
              stepId: context.stepId ?? toolId,
              contextFingerprint: context.contextFingerprint,
              volatile: context.volatile
            }
          }).then(r => r.result)
        : await execute();

      // Update usage statistics
      await this.db.updateToolUsage(toolId);

      return {
        success: true,
        output: result,
        duration_ms: Date.now() - startTime,
        sandbox_id: sandboxId
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration_ms: Date.now() - startTime
      };
    }
  }

  /**
   * Searches for tools using PRB-based ranking
   */
  async searchTools(query: string): Promise<ToolManifest[]> {
    const tools = await this.db.searchTools(query);
    
    // Sort by PRB score and usage count
    return tools.sort((a: ToolManifest, b: ToolManifest) => {
      const scoreA = a.prb_score * (1 + Math.log(a.usage_count + 1));
      const scoreB = b.prb_score * (1 + Math.log(b.usage_count + 1));
      return scoreB - scoreA;
    });
  }

  /**
   * Gets health status of the Tool Gateway
   */
  getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    hotBufferSize: number;
    availableSandboxes: number;
  } {
    return {
      status: 'healthy',
      hotBufferSize: this.hotBuffer.size,
      availableSandboxes: 5 // Placeholder
    };
  }

  /**
   * Updates the hot buffer with LRU eviction
   */
  private updateHotBuffer(tool: ToolManifest): void {
    if (this.hotBuffer.size >= this.HOT_BUFFER_SIZE) {
      const firstKey = this.hotBuffer.keys().next().value;
      if (firstKey !== undefined) {
        this.hotBuffer.delete(firstKey);
      }
    }
    this.hotBuffer.set(tool.id, tool);
  }

  /**
   * Executes tool code in E2B sandbox
   */
  private async executeInSandbox(tool: ToolManifest, input: any, sandboxId: string): Promise<any> {
    try {
      // Validate input
      if (!input || typeof input !== 'object') {
        throw new Error('Invalid input: must be an object');
      }

      // Check capabilities
      const requiredCapabilities = this.extractCapabilities(tool);
      const hasPermission = this.checkPermissions(requiredCapabilities);
      
      if (!hasPermission) {
        throw new Error('Insufficient permissions for tool execution');
      }

      // Execute tool (simulation for now - would use E2B SDK in production)
      const result = {
        success: true,
        sandboxId,
        toolId: tool.id,
        output: input,
        timestamp: new Date().toISOString()
      };

      return result;
    } catch (error: any) {
      throw new Error(`Sandbox execution failed: ${error.message}`);
    }
  }

  private extractCapabilities(tool: ToolManifest): string[] {
    return tool.capabilities || [];
  }

  private checkPermissions(capabilities: string[]): boolean {
    const allowedCapabilities = ['read', 'write', 'execute', 'network'];
    return capabilities.every(cap => allowedCapabilities.includes(cap));
  }

  private createSandboxId(): string {
    return `sandbox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
