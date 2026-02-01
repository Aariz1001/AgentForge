/**
 * Configuration Manager
 * =====================
 * Manages persistent configuration for AgentForge CLI.
 */

import Conf from 'conf';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Get directory of current file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from various locations to ensure it's always found
// 1. Current working directory
dotenv.config();

// 2. The CLI directory (.env in AgentForge/cli/)
// This file path: AgentForge/cli/src/services/ConfigManager.ts
const cliEnvPath = join(__dirname, '..', '..', '.env'); // services -> src -> cli -> .env
dotenv.config({ path: cliEnvPath });

// 3. The workspace root (.env in AgentForge/)
const rootEnvPath = join(__dirname, '..', '..', '..', '.env'); // services -> src -> AgentForge -> cli -> .env
dotenv.config({ path: rootEnvPath });

const DEFAULT_CONFIG = {
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2.5',
    provider: 'default',
    fallbackModels: ['openai/gpt-4o', 'google/gemini-pro'],
    temperature: 1.0,
    maxTokens: 0,
    reasoning: {
      enabled: false,
      effort: 'medium',
      reasoning_tokens: undefined
    },
    contextCompaction: {
      enabled: true,
      maxMessages: 80,
      keepLast: 20,
      summaryModel: '',
      summaryMaxTokens: 800
    }
  },
  backend: {
    url: process.env.AGENTFORGE_BACKEND_URL || 'http://localhost:8000',
    timeout: 0
  },
  cli: {
    streamOutput: true,
    colorOutput: true,
    verboseErrors: false
  },
  tools: {
    defaultTimeout: 30000,
    sandboxEnabled: true
  },
  swarm: {
    maxAgents: 8,
    defaultAgents: 3,
    concurrency: 3
  },
  mcp: {
    servers: [
      { id: 'context7', url: 'https://mcp.context7.io', name: 'Context7 Documentation Server' },
      { id: 'langchain', url: 'https://docs.langchain.com/mcp', name: 'LangChain Docs Server' }
    ]
  },
  skills: {
    paths: [
      join(homedir(), '.copilot', 'skills'),
      join(homedir(), '.claude', 'skills')
    ]
  }
};

export class ConfigManager {
  private conf: any;

  constructor() {
    this.conf = new Conf({
      projectName: 'agentforge',
      defaults: DEFAULT_CONFIG,
      schema: {
        openrouter: {
          type: 'object',
          properties: {
            apiKey: { type: 'string' },
            model: { type: 'string' },
            provider: { type: 'string' },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            maxTokens: { type: 'number', minimum: 0 },
            reasoning: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                effort: { type: 'string' },
                reasoning_tokens: { type: 'number' }
              }
            },
            contextCompaction: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                maxMessages: { type: 'number', minimum: 10 },
                keepLast: { type: 'number', minimum: 5 },
                summaryModel: { type: 'string' },
                summaryMaxTokens: { type: 'number', minimum: 128 }
              }
            }
          }
        },
        backend: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            timeout: { type: 'number' }
          }
        },
        swarm: {
          type: 'object',
          properties: {
            maxAgents: { type: 'number', minimum: 1 },
            defaultAgents: { type: 'number', minimum: 1 },
            concurrency: { type: 'number', minimum: 1 }
          }
        },
        mcp: {
          type: 'object',
          properties: {
            servers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  name: { type: 'string' }
                }
              }
            }
          }
        },
        skills: {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    });

    // Also check for local .agentforge config
    this._loadLocalConfig();
  }
  
  _loadLocalConfig(): void {
    const localConfigPaths = [
      join(process.cwd(), '.agentforge'),
      join(process.cwd(), '.agentforge.json'),
      join(homedir(), '.agentforge')
    ];
    
    for (const configPath of localConfigPaths) {
      if (existsSync(configPath)) {
        try {
          const localConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
          this._mergeConfig(localConfig);
        } catch (e) {
          // Ignore malformed config files
        }
        break;
      }
    }
  }
  
  _mergeConfig(config: any): void {
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'object' && !Array.isArray(value)) {
        const existing = this.conf.get(key) || {};
        this.conf.set(key, { ...existing, ...value });
      } else {
        this.conf.set(key, value);
      }
    }
  }
  
  /**
   * Get the path to the config file
   */
  get path(): string {
    return this.conf.path;
  }

  /**
   * Get a configuration value
   * @param {string} key - Dot-notation key (e.g., 'openrouter.apiKey')
   * @returns {any} The configuration value
   */
  get(key: string): any {
    // First check environment variables
    // Convert openrouter.apiKey to OPENROUTER_API_KEY
    const envKey = key
      .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase to snake_case
      .toUpperCase()
      .replace(/\./g, '_');
    
    if (process.env[envKey] !== undefined) {
      if (key === 'openrouter.reasoning') {
        const raw = process.env[envKey] as string;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      }
      if (key === 'openrouter.temperature' || key === 'openrouter.maxTokens' || key === 'backend.timeout') {
        const num = Number(process.env[envKey]);
        return isNaN(num) ? process.env[envKey] : num;
      }
      return process.env[envKey];
    }
    
    return this.conf.get(key);
  }
  
  /**
   * Set a configuration value
   * @param {string} key - Dot-notation key
   * @param {any} value - Value to set
   */
  set(key: string, value: any): void {
    this.conf.set(key, value);
  }
  
  /**
   * Delete a configuration value
   * @param {string} key - Dot-notation key
   */
  delete(key: string): void {
    this.conf.delete(key);
  }
  
  /**
   * Get all configuration
   * @returns {object} All configuration
   */
  getAll() {
    return this.conf.store;
  }

  /**
   * Persist environment variable to .env file
   */
  setEnvVar(key: string, value: string): void {
    const paths = [cliEnvPath, rootEnvPath, join(process.cwd(), '.env')];
    const targetPath = paths.find(p => existsSync(p)) || cliEnvPath;

    let content = '';
    if (existsSync(targetPath)) {
      content = readFileSync(targetPath, 'utf-8');
    }

    const lineRegex = new RegExp(`^${key}=.*$`, 'm');
    if (lineRegex.test(content)) {
      content = content.replace(lineRegex, `${key}=${value}`);
    } else {
      const suffix = content.endsWith('\n') || content.length === 0 ? '' : '\n';
      content += `${suffix}${key}=${value}\n`;
    }

    writeFileSync(targetPath, content, 'utf-8');
    process.env[key] = value;
  }
  
  /**
   * Reset to defaults
   */
  reset() {
    this.conf.clear();
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      this.conf.set(key, value);
    }
  }
  
  /**
   * Check if a key exists
   * @param {string} key - Dot-notation key
   * @returns {boolean}
   */
  has(key: string): boolean {
    return this.conf.has(key) || !!process.env[key.toUpperCase().replace(/\./g, '_')];
  }
  
  /**
   * Get OpenRouter configuration
   * @returns {object}
   */
  getOpenRouterConfig() {
    return {
      apiKey: this.get('openrouter.apiKey'),
      model: this.get('openrouter.model'),
      fallbackModels: this.get('openrouter.fallbackModels'),
      temperature: this.get('openrouter.temperature'),
      maxTokens: this.get('openrouter.maxTokens'),
      baseUrl: 'https://openrouter.ai/api/v1'
    };
  }
  
  /**
   * Get backend configuration
   * @returns {object}
   */
  getBackendConfig() {
    return {
      url: this.get('backend.url'),
      timeout: this.get('backend.timeout')
    };
  }
}

export default ConfigManager;
