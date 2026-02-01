/**
 * Backend Client
 * ==============
 * HTTP client for communicating with the AgentForge Python backend.
 */

import fetch from 'node-fetch';
import EventSource from 'eventsource';
import chalk from 'chalk';
import { OpenRouter } from '@openrouter/sdk';

export class BackendClient {
  private config: any;
  private baseUrl: string;
  private timeout: number;
  private apiKey: string | undefined;
  private orClient: any;

  constructor(config: any) {
    this.config = config;
    this.baseUrl = config.get('backend.url') || 'http://localhost:8000';
    this.timeout = config.get('backend.timeout') ?? 60000;
    
    // Use raw key and trim to ensure no whitespace issues
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
   * Direct OpenRouter call using SDK callModel pattern (non-streaming)
   */
  async openRouterComplete(messages: any[], options: any = {}): Promise<any> {
    if (!this.orClient) {
      throw new Error('OpenRouter client not initialized');
    }

    const model = options.model || this.config.get('openrouter.model');
    const configuredMaxTokens = options.maxTokens ?? this.config.get('openrouter.maxTokens');
    const maxOutputTokens = typeof configuredMaxTokens === 'number' && configuredMaxTokens > 0
      ? configuredMaxTokens
      : undefined;

    // Separate system message if it's the first one to use the instructions parameter
    let instructions: string | undefined;
    let input: any[] = messages;

    if (messages.length > 0 && messages[0].role === 'system') {
      instructions = String(messages[0].content);
      input = messages.slice(1);
    }
    
    const send = async (withReasoning: boolean) => {
      const callArgs: any = {
        model,
        input,
        temperature: options.temperature ?? this.config.get('openrouter.temperature') ?? 0.7,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        ...(withReasoning && options.reasoning ? { reasoning: options.reasoning } : {})
      };
      
      if (instructions) {
        callArgs.instructions = instructions;
      }

      const result = this.orClient.callModel(callArgs);
      return await result.getResponse();
    };

    try {
      const response = await send(true);
      
      // Normalize response to maintain compatibility with existing ChatSession logic
      // existing logic expects response.choices[0].message.content
      // or similar from openRouter
      if (response && response.text && !response.choices) {
        return {
          ...response,
          choices: [{
            message: {
              role: 'assistant',
              content: response.text,
              reasoning: response.reasoning
            }
          }],
          usage: response.usage
        };
      }
      return response;
    } catch (error: any) {
      const message = error?.message || '';
      if (options.reasoning && /reasoning|unknown parameter|unsupported|invalid/i.test(message)) {
        try {
          const fallback = await send(false);
          if (fallback && fallback.text && !fallback.choices) {
             return {
              ...fallback,
              choices: [{
                message: {
                  role: 'assistant',
                  content: fallback.text
                }
              }],
              usage: fallback.usage
            };
          }
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
   * Stream OpenRouter completion using SDK callModel pattern
   */
  async streamOpenRouter(messages: any[], onChunk: (chunk: string) => void, options: any = {}): Promise<{ content: string, reasoning?: string, usage?: any }> {
    if (!this.orClient) {
      throw new Error('OpenRouter client not initialized');
    }

    const model = options.model || this.config.get('openrouter.model');
    const configuredMaxTokens = options.maxTokens ?? this.config.get('openrouter.maxTokens');
    const maxOutputTokens = typeof configuredMaxTokens === 'number' && configuredMaxTokens > 0
      ? configuredMaxTokens
      : undefined;

    let instructions: string | undefined;
    let input: any[] = messages;

    if (messages.length > 0 && messages[0].role === 'system') {
      instructions = String(messages[0].content);
      input = messages.slice(1);
    }
    
    const getStream = (withReasoning: boolean) => {
      const callArgs: any = {
        model,
        input,
        temperature: options.temperature ?? 0.7,
        ...(maxOutputTokens ? { maxOutputTokens } : {}),
        ...(withReasoning && options.reasoning ? { 
          reasoning: typeof options.reasoning === 'object' ? options.reasoning : { enabled: true }
        } : {})
      };

      if (instructions) {
        callArgs.instructions = instructions;
      }

      return this.orClient.callModel(callArgs);
    };

    try {
      const result = getStream(true);

      let fullContent = '';
      let fullReasoning = '';

      for await (const delta of result.getTextStream()) {
        fullContent += delta;
        onChunk(delta);
      }

      // Check for reasoning if supported
      try {
        for await (const reason of result.getReasoningStream()) {
          fullReasoning += reason;
          if (options.includeReasoningInContent) {
            fullContent += reason;
            onChunk(reason);
          }
        }
      } catch (e) {
        // Reasoning stream might not be supported/available
      }

      const response = await result.getResponse();
      return { content: fullContent, reasoning: fullReasoning, usage: response.usage };
    } catch (error: any) {
      const message = error?.message || '';
      if (options.reasoning && /reasoning|unknown parameter|unsupported|invalid/i.test(message)) {
        try {
          const result = getStream(false);
          let fullContent = '';
          for await (const delta of result.getTextStream()) {
            fullContent += delta;
            onChunk(delta);
          }
          const response = await result.getResponse();
          return { content: fullContent, usage: response.usage };
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
}
export default BackendClient;
