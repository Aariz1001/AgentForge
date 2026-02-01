/**
 * Session Manager
 * ===============
 * Manages session persistence, history, and statistics for AgentForge CLI.
 */

import Conf from 'conf';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import chalk from 'chalk';

export interface SessionStats {
  messagesCount: number;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  linesAdded: number;
  linesRemoved: number;
  toolsExecuted: number;
  startTime: Date;
  endTime?: Date;
  duration?: number;
}

export interface SessionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | any[];
  timestamp: string;
  tokens?: number;
  cost?: number;
}

export interface Session {
  id: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  stats: SessionStats;
  workingDirectory?: string;
  selectedFolders?: string[];
}

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  skills?: string[];
  addedAt: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'mcp' | 'custom' | 'claude' | 'copilot';
  mcpServerId?: string;
  enabled: boolean;
  content?: string;
}

const SESSION_DEFAULTS = {
  sessions: {} as Record<string, Session>,
  currentSessionId: null as string | null,
  mcpServers: [] as MCPServer[],
  skills: [] as AgentSkill[]
};

export class SessionManager {
  private store: Conf<typeof SESSION_DEFAULTS>;
  private currentSession: Session | null = null;

  constructor() {
    this.store = new Conf({
      projectName: 'agentforge-sessions',
      defaults: SESSION_DEFAULTS
    });
  }

  /**
   * Get the path to the sessions file
   */
  get path(): string {
    return this.store.path;
  }

  /**
   * Create a new session
   */
  createSession(sessionId: string, model: string): Session {
    const now = new Date();
    const session: Session = {
      id: sessionId,
      model,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      messages: [],
      stats: {
        messagesCount: 0,
        tokensUsed: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalCost: 0,
        linesAdded: 0,
        linesRemoved: 0,
        toolsExecuted: 0,
        startTime: now
      }
    };

    const sessions = this.store.get('sessions');
    sessions[sessionId] = session;
    this.store.set('sessions', sessions);
    this.store.set('currentSessionId', sessionId);
    this.currentSession = session;

    return session;
  }

  /**
   * Get current session
   */
  getCurrentSession(): Session | null {
    if (this.currentSession) return this.currentSession;

    const currentId = this.store.get('currentSessionId');
    if (!currentId) return null;

    const sessions = this.store.get('sessions');
    this.currentSession = sessions[currentId] || null;
    return this.currentSession;
  }

  /**
   * Load a session by ID
   */
  loadSession(sessionId: string): Session | null {
    const sessions = this.store.get('sessions');
    const session = sessions[sessionId];
    
    if (session) {
      this.currentSession = session;
      this.store.set('currentSessionId', sessionId);
    }
    
    return session || null;
  }

  /**
   * Save the current session
   */
  saveSession(): void {
    if (!this.currentSession) return;

    this.currentSession.updatedAt = new Date().toISOString();
    const sessions = this.store.get('sessions');
    sessions[this.currentSession.id] = this.currentSession;
    this.store.set('sessions', sessions);
  }

  /**
   * Add a message to the current session
   */
  addMessage(role: 'system' | 'user' | 'assistant', content: string | any[], tokens?: number, cost?: number): void {
    if (!this.currentSession) return;

    const message: SessionMessage = {
      role,
      content,
      timestamp: new Date().toISOString(),
      tokens,
      cost
    };

    this.currentSession.messages.push(message);
    
    if (role !== 'system') {
      this.currentSession.stats.messagesCount++;
    }
    
    if (tokens) {
      this.currentSession.stats.tokensUsed += tokens;
      if (role === 'user') {
        this.currentSession.stats.promptTokens += tokens;
      } else if (role === 'assistant') {
        this.currentSession.stats.completionTokens += tokens;
      }
    }
    
    if (cost) {
      this.currentSession.stats.totalCost += cost;
    }

    this.saveSession();
  }

  /**
   * Update LOC stats
   */
  updateLOCStats(added: number, removed: number): void {
    if (!this.currentSession) return;

    this.currentSession.stats.linesAdded += added;
    this.currentSession.stats.linesRemoved += removed;
    this.saveSession();
  }

  /**
   * Increment tool execution count
   */
  incrementToolCount(): void {
    if (!this.currentSession) return;
    this.currentSession.stats.toolsExecuted++;
    this.saveSession();
  }

  /**
   * Update session cost
   */
  addCost(cost: number): void {
    if (!this.currentSession) return;
    this.currentSession.stats.totalCost += cost;
    this.saveSession();
  }

  /**
   * Update token usage
   */
  addTokens(promptTokens: number, completionTokens: number): void {
    if (!this.currentSession) return;
    this.currentSession.stats.promptTokens += promptTokens;
    this.currentSession.stats.completionTokens += completionTokens;
    this.currentSession.stats.tokensUsed += promptTokens + completionTokens;
    this.saveSession();
  }

  /**
   * End the current session
   */
  endSession(): SessionStats | null {
    if (!this.currentSession) return null;

    const endTime = new Date();
    this.currentSession.stats.endTime = endTime;
    this.currentSession.stats.duration = 
      endTime.getTime() - new Date(this.currentSession.stats.startTime).getTime();
    
    this.saveSession();
    return this.currentSession.stats;
  }

  /**
   * List all sessions
   */
  listSessions(limit: number = 20): Session[] {
    const sessions = this.store.get('sessions');
    return Object.values(sessions)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const sessions = this.store.get('sessions');
    if (sessions[sessionId]) {
      delete sessions[sessionId];
      this.store.set('sessions', sessions);
      
      if (this.store.get('currentSessionId') === sessionId) {
        this.store.set('currentSessionId', null);
        this.currentSession = null;
      }
      
      return true;
    }
    return false;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | null {
    const sessions = this.store.get('sessions');
    return sessions[sessionId] || null;
  }

  /**
   * Set working directory for current session
   */
  setWorkingDirectory(path: string): void {
    if (!this.currentSession) return;
    this.currentSession.workingDirectory = path;
    this.saveSession();
  }

  /**
   * Set selected folders for current session
   */
  setSelectedFolders(folders: string[]): void {
    if (!this.currentSession) return;
    this.currentSession.selectedFolders = folders;
    this.saveSession();
  }

  // ==================== MCP Server Management ====================

  /**
   * Add an MCP server
   */
  addMCPServer(name: string, url: string): MCPServer {
    const server: MCPServer = {
      id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      url,
      enabled: true,
      skills: [],
      addedAt: new Date().toISOString()
    };

    const servers = this.store.get('mcpServers');
    servers.push(server);
    this.store.set('mcpServers', servers);

    return server;
  }

  /**
   * List MCP servers
   */
  listMCPServers(): MCPServer[] {
    return this.store.get('mcpServers');
  }

  /**
   * Remove an MCP server
   */
  removeMCPServer(serverId: string): boolean {
    const servers = this.store.get('mcpServers');
    const index = servers.findIndex(s => s.id === serverId);
    
    if (index !== -1) {
      servers.splice(index, 1);
      this.store.set('mcpServers', servers);
      return true;
    }
    return false;
  }

  /**
   * Toggle MCP server enabled status
   */
  toggleMCPServer(serverId: string): boolean {
    const servers = this.store.get('mcpServers');
    const server = servers.find(s => s.id === serverId);
    
    if (server) {
      server.enabled = !server.enabled;
      this.store.set('mcpServers', servers);
      return server.enabled;
    }
    return false;
  }

  /**
   * Get MCP server by ID
   */
  getMCPServer(serverId: string): MCPServer | null {
    const servers = this.store.get('mcpServers');
    return servers.find(s => s.id === serverId) || null;
  }

  // ==================== Skill Management ====================

  /**
   * Add a skill
   */
  addSkill(skill: Omit<AgentSkill, 'id'>): AgentSkill {
    const newSkill: AgentSkill = {
      ...skill,
      id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    };

    const skills = this.store.get('skills');
    skills.push(newSkill);
    this.store.set('skills', skills);

    return newSkill;
  }

  /**
   * Sync local skills from ~/.claude/skills and ~/.copilot/skills
   */
  syncLocalSkills(): AgentSkill[] {
    const allSkills = this.store.get('skills');
    const roots: Array<{ source: 'claude' | 'copilot'; dir: string }> = [
      { source: 'claude', dir: join(homedir(), '.claude', 'skills') },
      { source: 'copilot', dir: join(homedir(), '.copilot', 'skills') }
    ];

    const readSkill = (source: 'claude' | 'copilot', dir: string): AgentSkill[] => {
      if (!existsSync(dir)) return [];
      const entries = readdirSync(dir, { withFileTypes: true });
      const skills: AgentSkill[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = join(dir, entry.name);
        const filePath = join(skillDir, 'skill.md');
        if (!existsSync(filePath)) continue;

        let content = '';
        try {
          content = readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }

        const firstLine = content.split(/\r?\n/).find(line => line.trim().length > 0) || entry.name;
        const name = firstLine.replace(/^#+\s*/, '').trim() || entry.name;
        const description = `Local skill from ${source}`;

        skills.push({
          id: `skill_${source}_${entry.name}`,
          name,
          description,
          source,
          enabled: true,
          content
        });
      }

      return skills;
    };

    const localSkills = roots.flatMap(root => readSkill(root.source, root.dir));
    if (localSkills.length === 0) {
      return [];
    }

    const localIds = new Set(localSkills.map(skill => skill.id));
    const preserved = allSkills.filter(skill => skill.source !== 'claude' && skill.source !== 'copilot');
    const merged = [...preserved];

    for (const skill of localSkills) {
      const existing = allSkills.find(s => s.id === skill.id);
      if (existing) {
        skill.enabled = existing.enabled;
      }
      merged.push(skill);
    }

    this.store.set('skills', merged);
    return localSkills;
  }

  /**
   * Get skills by sources
   */
  getSkillsBySource(sources: Array<AgentSkill['source']>): AgentSkill[] {
    return this.store.get('skills').filter(skill => sources.includes(skill.source));
  }

  /**
   * List skills
   */
  listSkills(source?: 'builtin' | 'mcp' | 'custom'): AgentSkill[] {
    const skills = this.store.get('skills');
    if (source) {
      return skills.filter(s => s.source === source);
    }
    return skills;
  }

  /**
   * Remove a skill
   */
  removeSkill(skillId: string): boolean {
    const skills = this.store.get('skills');
    const index = skills.findIndex(s => s.id === skillId);
    
    if (index !== -1) {
      skills.splice(index, 1);
      this.store.set('skills', skills);
      return true;
    }
    return false;
  }

  /**
   * Toggle skill enabled status
   */
  toggleSkill(skillId: string): boolean {
    const skills = this.store.get('skills');
    const skill = skills.find(s => s.id === skillId);
    
    if (skill) {
      skill.enabled = !skill.enabled;
      this.store.set('skills', skills);
      return skill.enabled;
    }
    return false;
  }

  /**
   * Get enabled skills
   */
  getEnabledSkills(): AgentSkill[] {
    return this.store.get('skills').filter(s => s.enabled);
  }

  /**
   * Format session stats for display
   */
  formatStats(stats: SessionStats): string {
    const duration = stats.duration 
      ? this.formatDuration(stats.duration)
      : this.formatDuration(Date.now() - new Date(stats.startTime).getTime());

    const lines = [
      '',
      chalk.bold.cyan('━━━ Session Summary ━━━'),
      '',
      chalk.cyan('Duration:       ') + chalk.white(duration),
      chalk.cyan('Messages:       ') + chalk.white(stats.messagesCount.toString()),
      chalk.cyan('Tools Executed: ') + chalk.white(stats.toolsExecuted.toString()),
      '',
      chalk.bold('Token Usage:'),
      chalk.gray('  Prompt:     ') + chalk.yellow(stats.promptTokens.toLocaleString()),
      chalk.gray('  Completion: ') + chalk.yellow(stats.completionTokens.toLocaleString()),
      chalk.gray('  Total:      ') + chalk.yellow(stats.tokensUsed.toLocaleString()),
      '',
      chalk.bold('Code Changes:'),
      chalk.green(`  +${stats.linesAdded} lines added`),
      chalk.red(`  -${stats.linesRemoved} lines removed`),
      '',
      chalk.bold('Cost:'),
      chalk.yellow(`  $${stats.totalCost.toFixed(6)}`),
      ''
    ];

    return lines.join('\n');
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    this.store.set('sessions', {});
    this.store.set('currentSessionId', null);
    this.currentSession = null;
  }
}

export default SessionManager;
