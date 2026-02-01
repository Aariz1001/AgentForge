/**
 * MCP Manager Service
 * 
 * Manages connections to Model Context Protocol servers on the backend.
 * Provides unified interface for querying up-to-date documentation and specialized tools.
 */

import fetch from 'node-fetch';
import { DatabaseService } from './database';

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  status: 'online' | 'offline' | 'error';
  capabilities: any[];
}

export class MCPManagerService {
  private servers: Map<string, MCPServer> = new Map();
  private db: DatabaseService;

  constructor(db: DatabaseService, initialServers: any[] = []) {
    this.db = db;
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

  async callTool(serverId: string, toolName: string, args: any): Promise<any> {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`MCP Server ${serverId} not found`);

    try {
      const response = await fetch(`${server.url}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: toolName, arguments: args })
      });

      if (!response.ok) throw new Error(`MCP Call failed: ${response.statusText}`);
      return await response.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
