/**
 * MCP Client
 * ==========
 * Client for connecting to Model Context Protocol servers.
 */

import fetch from 'node-fetch';
import chalk from 'chalk';

export interface MCPCapability {
  name: string;
  description: string;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
}

export interface MCPServerInfo {
  name: string;
  version: string;
  url: string;
  capabilities: MCPCapability[];
  status: 'connected' | 'disconnected' | 'error';
  lastPing?: Date;
}

export interface MCPToolCall {
  serverId: string;
  toolName: string;
  arguments: Record<string, any>;
}

export interface MCPToolResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime?: number;
}

export class MCPClient {
  private servers: Map<string, MCPServerInfo> = new Map();
  private timeout: number;

  constructor(timeout: number = 30000) {
    this.timeout = timeout;
  }

  /**
   * Connect to an MCP server
   */
  async connect(serverId: string, url: string, name: string): Promise<MCPServerInfo> {
    try {
      // Ping the server to check connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${url}/info`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const info = await response.json() as any;

      const serverInfo: MCPServerInfo = {
        name: info.name || name,
        version: info.version || 'unknown',
        url: url,
        capabilities: info.capabilities || [],
        status: 'connected',
        lastPing: new Date()
      };

      this.servers.set(serverId, serverInfo);
      return serverInfo;

    } catch (error: any) {
      const serverInfo: MCPServerInfo = {
        name,
        version: 'unknown',
        url,
        capabilities: [],
        status: 'error',
        lastPing: new Date()
      };

      this.servers.set(serverId, serverInfo);
      throw new Error(`Failed to connect to MCP server: ${error.message}`);
    }
  }

  /**
   * Disconnect from an MCP server
   */
  disconnect(serverId: string): boolean {
    return this.servers.delete(serverId);
  }

  /**
   * Get server info
   */
  getServerInfo(serverId: string): MCPServerInfo | undefined {
    return this.servers.get(serverId);
  }

  /**
   * List connected servers
   */
  listConnectedServers(): Map<string, MCPServerInfo> {
    return this.servers;
  }

  /**
   * Execute a tool on an MCP server by ID
   */
  async callTool(toolCall: MCPToolCall): Promise<MCPToolResult> {
    const server = this.servers.get(toolCall.serverId);
    if (!server) {
      return { success: false, error: `Server not found: ${toolCall.serverId}` };
    }
    return this.executeTool(server.url, toolCall);
  }

  /**
   * Execute a tool on an MCP server
   */
  async executeTool(url: string, toolCall: MCPToolCall): Promise<MCPToolResult> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${url}/tools/${toolCall.toolName}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          arguments: toolCall.arguments
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as any;
        return {
          success: false,
          error: error.message || `Server returned ${response.status}`,
          executionTime: Date.now() - startTime
        };
      }

      const result = await response.json() as any;

      return {
        success: true,
        data: result,
        executionTime: Date.now() - startTime
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.name === 'AbortError' ? 'Request timeout' : error.message,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Discover tools from an MCP server
   */
  async discoverTools(url: string): Promise<MCPCapability[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${url}/tools`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const tools = await response.json() as any;
      return Array.isArray(tools) ? tools : tools.tools || [];

    } catch (error: any) {
      throw new Error(`Failed to discover tools: ${error.message}`);
    }
  }

  /**
   * Ping server to check if alive
   */
  async ping(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${url}/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;

    } catch {
      return false;
    }
  }

  /**
   * Format server status for display
   */
  formatServerStatus(serverId: string, name: string, url: string, status: 'connected' | 'disconnected' | 'error'): string {
    const statusIcon = {
      connected: chalk.green('●'),
      disconnected: chalk.gray('○'),
      error: chalk.red('✗')
    }[status];

    const statusColor = {
      connected: chalk.green,
      disconnected: chalk.gray,
      error: chalk.red
    }[status];

    return `${statusIcon} ${chalk.cyan(name.padEnd(20))} ${chalk.gray(url.padEnd(35))} ${statusColor(status)}`;
  }
}

export default MCPClient;
