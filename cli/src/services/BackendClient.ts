/**
 * Backend Client
 * ==============
 * HTTP client for communicating with the AgentForge Python backend.
 * Also handles LLM routing to different providers (OpenRouter, Copilot).
 */

import fetch from 'node-fetch';
import EventSource from 'eventsource';
import chalk from 'chalk';
import { OpenRouter } from '@openrouter/sdk';
import { CopilotService } from './CopilotService';
import type { LLMMessage, LLMCompletionOptions } from './LLMProvider';

export class BackendClient {
  private config: any;
  private baseUrl: string;
  private timeout: number;
  private apiKey: string | undefined;
  private orClient: any;
  private copilotService: CopilotService | null = null;

  constructor(config: any) {
    this.config = config;
    this.baseUrl = config.get('backend.url') || 'http://localhost:8000';
    this.timeout = config.get('backend.timeout') || 300000; // Increased to 5 minutes
    
    // Initialize provider based on config
    const activeProvider = config.get('llm.provider') || 'openrouter';
    
    // Always initialize OpenRouter if key is available
    const rawKey = config.get('openrouter.apiKey');
    this.apiKey = rawKey ? String(rawKey).trim() : undefined;
    
    if (this.apiKey) {
      this.orClient = new OpenRouter({
        apiKey: this.apiKey
      });
      
      this.headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/agentforge',
        'X-Title': 'AgentForge',
        'Content-Type': 'application/json'
      };
    }
  }

  private headers: Record<string, string> = {};

  private hasMultimodalContent(messages: any[]): boolean {
    return messages.some(m => Array.isArray(m.content) && m.content.some((p: any) => p?.type && p.type !== 'text'));
  }

  private async openRouterChatRawComplete(messages: any[], options: any = {}): Promise<any> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const model = options.model || this.config.get('openrouter.model');
    const configuredMaxTokens = options.maxTokens ?? this.config.get('openrouter.maxTokens');
    const max_tokens = typeof configuredMaxTokens === 'number' && configuredMaxTokens > 0
      ? configuredMaxTokens
      : undefined;

    const body: any = {
      model,
      messages,
      temperature: options.temperature ?? this.config.get('openrouter.temperature') ?? 0.7,
      stream: false,
      ...(max_tokens ? { max_tokens } : {})
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`OpenRouter chat completion failed: ${response.status} ${errorBody}`);
    }

    return await response.json();
  }
  
  /**
   * Make an HTTP request to the backend
   */
  async request(endpoint: string, options: any = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutMs = typeof this.timeout === 'number' ? this.timeout : 60000;
    const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          ...options.headers
        },
        signal: controller.signal
      });
      
      if (timeoutId) clearTimeout(timeoutId);
      
      if (!response.ok) {
        const error: any = await response.json().catch(() => ({}));
        throw new Error(error.detail || error.message || `HTTP ${response.status}`);
      }
      
      return response.json();
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }
  
  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result: any = await this.request('/health');
      return result.status === 'healthy';
    } catch {
      return false;
    }
  }
  
  /**
   * Check OpenRouter connectivity via backend
   */
  async checkOpenRouter(): Promise<boolean> {
    try {
      const result: any = await this.request('/health/ready');
      return result.checks?.openrouter === true;
    } catch {
      return false;
    }
  }
  
  /**
   * Execute a task
   */
  async executeTask(task: string, options: any = {}): Promise<any> {
    return this.request('/execute', {
      method: 'POST',
      body: JSON.stringify({
        task,
        context: options.context || {},
        model: options.model
      })
    });
  }
  
  /**
   * Generate a tool using the Forge
   */
  async forgeGenerate(dossier: any): Promise<any> {
    return this.request('/forge/generate', {
      method: 'POST',
      body: JSON.stringify(dossier)
    });
  }
  
  /**
   * List registered tools
   */
  async listTools(options: any = {}): Promise<any> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.status) params.set('status', options.status);
    if (options.search) params.set('search', options.search);
    
    const query = params.toString() ? `?${params}` : '';
    return this.request(`/api/v1/tools${query}`);
  }
  
  /**
   * Get tool details
   */
  async getTool(hash: string): Promise<any> {
    return this.request(`/api/v1/tools/${hash}`);
  }
  
  /**
   * Execute a tool
   */
  async executeTool(hash: string, inputs: any, options: any = {}): Promise<any> {
    return this.request(`/api/v1/exec/${hash}`, {
      method: 'POST',
      body: JSON.stringify({
        arguments: inputs,
        session_id: options.sessionId,
        timeout_override: options.timeout
      })
    });
  }
  
  /**
   * Register a new tool
   */
  async registerTool(dossier: any, options: any = {}): Promise<any> {
    return this.request('/api/v1/register', {
      method: 'POST',
      body: JSON.stringify({
        dossier,
        auto_generate: options.autoGenerate !== false,
        skip_tests: options.skipTests || false
      })
    });
  }
  
  /**
   * Get gateway metrics
   */
  async getMetrics() {
    return this.request('/metrics');
  }

  /**
   * Run a swarm task
   */
  async runSwarm(task: string, options: any = {}): Promise<any> {
    return this.request('/swarm/run', {
      method: 'POST',
      body: JSON.stringify({
        task,
        agents: options.agents,
        model: options.model,
        context: options.context
      })
    });
  }

  /**
   * Get swarm run result
   */
  async getSwarmRun(runId: string): Promise<any> {
    return this.request(`/swarm/run/${runId}`);
  }

  /**
   * PhoenixTape status
   */
  async getPhoenixStatus(): Promise<any> {
    return this.request('/phoenix/status');
  }

  /**
   * Run PhoenixTape compaction
   */
  async runPhoenixCompaction(mode: 'full' | 'tape' | 'memory' = 'full', dryRun: boolean = false): Promise<any> {
    return this.request('/phoenix/compact', {
      method: 'POST',
      body: JSON.stringify({ mode, dryRun })
    });
  }
  
  /**
   * Stream chat completion (for streaming responses)
   */
  streamChat(messages: any[], options: any = {}): Promise<any> {
    const url = `${this.baseUrl}/api/v1/chat/stream`;
    
    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(url, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        }
      });
      
      const chunks: string[] = [];
      
      eventSource.onmessage = (event: any) => {
        if (event.data === '[DONE]') {
          eventSource.close();
          resolve({ content: chunks.join(''), chunks });
          return;
        }
        
        try {
          const data = JSON.parse(event.data);
          if (data.content) {
            chunks.push(data.content);
            if (options.onChunk) {
              options.onChunk(data.content);
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      };
      
      eventSource.onerror = (error: any) => {
        eventSource.close();
        reject(new Error('Stream connection failed'));
      };
    });
  }
  
  /**
   * Direct OpenRouter call using SDK chat.send (non-streaming)
   * If Copilot is the active provider, routes to Copilot instead
   */
  async openRouterComplete(messages: any[], options: any = {}): Promise<any> {
    const activeProvider = this.config.get('llm.provider') || 'openrouter';
    
    // Route to Copilot if it's the active provider
    if (activeProvider === 'copilot') {
      return this.copilotComplete(messages, options);
    }
    
    if (!this.orClient) {
      throw new Error('OpenRouter client not initialized');
    }

    if (this.hasMultimodalContent(messages)) {
      return await this.openRouterChatRawComplete(messages, options);
    }

    const model = options.model || this.config.get('openrouter.model');
    const configuredMaxTokens = options.maxTokens ?? this.config.get('openrouter.maxTokens');
    const maxTokens = typeof configuredMaxTokens === 'number' && configuredMaxTokens > 0
      ? configuredMaxTokens
      : undefined;

    const send = async (withReasoning: boolean) => {
      const requestBody: any = {
        model,
        messages,
        temperature: options.temperature ?? this.config.get('openrouter.temperature') ?? 0.7,
        ...(maxTokens ? { maxTokens } : {}),
        ...(withReasoning && options.reasoning ? { reasoning: options.reasoning } : {})
      };

      return await this.orClient.chat.send(requestBody);
    };

    try {
      const response = await send(true);
      
      return response;
    } catch (error: any) {
      const message = error?.message || '';
      if (options.reasoning && /reasoning|unknown parameter|unsupported|invalid/i.test(message)) {
        try {
          const fallback = await send(false);
          return fallback;
        } catch (inner: any) {
          error = inner;
        }
      }
      console.error('[OpenRouter Error]:', error);
      if (error.response) {
        console.error('[OpenRouter Response Data]:', error.response.data);
      }
      throw new Error(this.sanitizeError(error));
    }
  }

  /**
   * Stream OpenRouter completion using SDK chat.send
   * If Copilot is the active provider, routes to Copilot instead
   */
  async streamOpenRouter(messages: any[], onChunk: (chunk: string) => void, options: any = {}): Promise<{ content: string, reasoning?: string, usage?: any }> {
    const activeProvider = this.config.get('llm.provider') || 'openrouter';
    
    // Route to Copilot if it's the active provider
    if (activeProvider === 'copilot') {
      return this.copilotStream(messages, onChunk, options);
    }
    
    if (!this.orClient) {
      throw new Error('OpenRouter client not initialized');
    }

    if (this.hasMultimodalContent(messages)) {
      const response = await this.openRouterChatRawComplete(messages, options);
      const content = response?.choices?.[0]?.message?.content || '';
      if (content) {
        onChunk(content);
      }
      return { content, usage: response?.usage };
    }

    const model = options.model || this.config.get('openrouter.model');
    const configuredMaxTokens = options.maxTokens ?? this.config.get('openrouter.maxTokens');
    const maxTokens = typeof configuredMaxTokens === 'number' && configuredMaxTokens > 0
      ? configuredMaxTokens
      : undefined;

    const getStream = (withReasoning: boolean) => {
      const requestBody: any = {
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        stream: true,
        ...(maxTokens ? { maxTokens } : {}),
        ...(withReasoning && options.reasoning ? { 
          reasoning: typeof options.reasoning === 'object' ? options.reasoning : { enabled: true }
        } : {})
      };

      return this.orClient.chat.send(requestBody);
    };

    try {
      const result = await getStream(true);

      let fullContent = '';
      let fullReasoning = '';
      let lastUsage: any = undefined;

      for await (const chunkData of result) {
        const delta = chunkData.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullContent += delta;
          onChunk(delta);
        }

        if (chunkData.usage) {
          lastUsage = chunkData.usage;
        }
      }

      return { content: fullContent, reasoning: fullReasoning || undefined, usage: lastUsage };
    } catch (error: any) {
      const message = error?.message || '';
      if (options.reasoning && /reasoning|unknown parameter|unsupported|invalid/i.test(message)) {
        try {
          const result = await getStream(false);
          let fullContent = '';
          let lastUsage: any = undefined;
          for await (const chunkData of result) {
            const delta = chunkData.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullContent += delta;
              onChunk(delta);
            }
            if (chunkData.usage) {
              lastUsage = chunkData.usage;
            }
          }
          return { content: fullContent, usage: lastUsage };
        } catch (inner: any) {
          error = inner;
        }
      }
      console.error('[OpenRouter Stream Error]:', error);
      throw new Error(this.sanitizeError(error));
    }
  }

  /**
   * Sanitize error messages to avoid HTML dumps
   */
  private sanitizeError(error: any): string {
    const message = error.message || 'Unknown error';
    if (message.includes('<!DOCTYPE html>') || message.includes('<html>')) {
      const statusMatch = message.match(/Error code (\d+)/i) || message.match(/Status (\d+)/i);
      const code = statusMatch ? statusMatch[1] : (error.statusCode || '5xx');
      return `OpenRouter API Error: ${code} (Internal Server Error/Bad Gateway). The upstream provider is currently down or overwhelmed. Please try again in 1-2 minutes.`;
    }
    return message;
  }

  /**
   * Fetch all available models from OpenRouter using SDK
   */
  async getModels(): Promise<any[]> {
    try {
      if (!this.orClient) {
        throw new Error('OpenRouter client not initialized');
      }

      const response = await this.orClient.models.list();
      return response.data || [];
    } catch (error: any) {
      throw new Error(`Failed to fetch models: ${error.message}`);
    }
  }

   /**
    * Get account balance/credits from OpenRouter using SDK
    */
   async getAccountBalance(): Promise<any> {
     try {
       if (!this.apiKey) {
         throw new Error('API Key not set');
       }

       // Use direct fetch to verify key if SDK is failing
       const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
         headers: {
           'Authorization': `Bearer ${this.apiKey}`
         }
       });
       
       if (!response.ok) {
         const data: any = await response.json().catch(() => ({}));
         throw new Error(data.error?.message || `HTTP ${response.status}`);
       }

       const keyInfo = await response.json();
       return keyInfo;
     } catch (error: any) {
       throw new Error(`Failed to fetch balance: ${error.message}`);
     }
   }

  /**
   * Get or create Copilot service instance
   */
  public getCopilotService(): CopilotService {
    if (!this.copilotService) {
      this.copilotService = new CopilotService(this.config);
    }
    return this.copilotService;
  }

  /**
   * Copilot completion (non-streaming)
   */
  private async copilotComplete(messages: any[], options: any = {}): Promise<any> {
    const copilot = this.getCopilotService();
    
    const model = options.model || this.config.get('copilot.model') || 'gpt-5';
    
    const llmMessages: LLMMessage[] = messages.map((m: any) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }));

    try {
      const response = await copilot.complete(llmMessages, {
        model,
        temperature: options.temperature,
        maxTokens: options.maxTokens
      });

      // Return in OpenRouter-compatible format for ChatSession
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: response.content,
            reasoning: response.reasoning
          }
        }],
        usage: response.usage,
        provider: 'copilot',
        model
      };
    } catch (error: any) {
      throw new Error(`Copilot completion failed: ${error.message}`);
    }
  }

  /**
   * Copilot streaming
   */
  private async copilotStream(
    messages: any[], 
    onChunk: (chunk: string) => void, 
    options: any = {}
  ): Promise<{ content: string, reasoning?: string, usage?: any }> {
    const copilot = this.getCopilotService();
    
    const model = options.model || this.config.get('copilot.model') || 'gpt-5';
    
    const llmMessages: LLMMessage[] = messages.map((m: any) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }));

    try {
      return await copilot.stream(llmMessages, onChunk, {
        model,
        temperature: options.temperature,
        maxTokens: options.maxTokens
      });
    } catch (error: any) {
      throw new Error(`Copilot streaming failed: ${error.message}`);
    }
  }

  /**
   * Get active provider type
   */
  getActiveProvider(): string {
    return this.config.get('llm.provider') || 'openrouter';
  }
}
export default BackendClient;
