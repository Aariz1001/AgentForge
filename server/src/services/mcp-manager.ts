/**
 * MCP Manager Service
 * 
 * Manages connections to Model Context Protocol servers on the backend.
 * Provides unified interface for querying up-to-date documentation and specialized tools.
 */

import fetch from 'node-fetch';
import { randomUUID } from 'crypto';
import { DatabaseService } from './database';
import { ToolTapeService } from './tool-tape';
import { ResourceGuardService } from './resource-guard';
import { settings } from '../core/config';

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  status: 'online' | 'offline' | 'error';
  capabilities: any[];
}

export interface MCPCallOptions {
  runId?: string;
  traceId?: string;
  stepId?: string;
  contextFingerprint?: string;
  timeoutMs?: number;
  replayMode?: 'strict' | 'best_effort';
  volatile?: boolean;
}

export class MCPManagerService {
  private servers: Map<string, MCPServer> = new Map();
  private db: DatabaseService;
  private toolTape?: ToolTapeService;
  private resourceGuard?: ResourceGuardService;

  constructor(
    db: DatabaseService,
    initialServers: any[] = [],
    options: { toolTape?: ToolTapeService; resourceGuard?: ResourceGuardService } = {}
  ) {
    this.db = db;
    this.toolTape = options.toolTape;
    this.resourceGuard = options.resourceGuard;
    if (initialServers.length > 0) {
      for (const s of initialServers) {
        this.registerServer({
          ...s,
          status: 'offline',
          capabilities: []
        });
      }
    } else {
      this.initializeDefaultServers();
    }
  }

  private initializeDefaultServers() {
    this.registerServer({
      id: 'context7',
      name: 'Context7 Documentation Server',
      url: 'https://mcp.context7.io',
      status: 'offline',
      capabilities: []
    });
    this.registerServer({
      id: 'langchain',
      name: 'LangChain Docs Server',
      url: 'https://mcp.langchain.com',
      status: 'offline',
      capabilities: []
    });
  }

  async registerServer(server: MCPServer): Promise<void> {
    this.servers.set(server.id, server);
    // Persist to DB if needed
  }

  async listServers(): Promise<MCPServer[]> {
    return Array.from(this.servers.values());
  }

  async queryDocs(serverId: string, query: string): Promise<any> {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`MCP Server ${serverId} not found`);

    try {
      const response = await fetch(`${server.url}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      if (!response.ok) throw new Error(`MCP Query failed: ${response.statusText}`);
      return await response.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async callTool(serverId: string, toolName: string, args: any, options: MCPCallOptions = {}): Promise<any> {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`MCP Server ${serverId} not found`);

    const timeoutMs = options.timeoutMs ?? settings.phoenixTape.defaultTimeoutMs;
    const runId = options.runId ?? 'mcp-run';
    const traceId = options.traceId ?? randomUUID();
    const stepId = options.stepId ?? `${serverId}:${toolName}`;

    const execute = async () => {
      const controller = new AbortController();
      const callId = randomUUID();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      this.resourceGuard?.register({
        id: callId,
        type: 'mcp',
        startedAt: Date.now(),
        timeoutMs,
        abort: () => controller.abort()
      });

      try {
        const response = await fetch(`${server.url}/call`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: toolName, arguments: args }),
          signal: controller.signal
        });

        if (!response.ok) throw new Error(`MCP Call failed: ${response.statusText}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
        this.resourceGuard?.release(callId);
      }
    };

    if (!this.toolTape) {
      try {
        return await execute();
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }

    try {
      const result = await this.toolTape.getOrExecute({
        toolHash: `${serverId}:${toolName}`,
        args,
        execute,
        context: {
          runId,
          traceId,
          stepId,
          contextFingerprint: options.contextFingerprint,
          timeoutMs,
          replayMode: options.replayMode,
          volatile: options.volatile
        }
      });

      return result.result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
