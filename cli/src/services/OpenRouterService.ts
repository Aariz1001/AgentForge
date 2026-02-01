/**
 * OpenRouter Service (LLMProvider Implementation)
 * ================================================
 * Wraps OpenRouter SDK to implement the unified LLMProvider interface.
 */

import { OpenRouter } from '@openrouter/sdk';
import type { 
  LLMProvider, 
  LLMMessage, 
  LLMCompletionOptions, 
  LLMCompletionResponse, 
  LLMStreamResponse,
  LLMProviderInfo 
} from './LLMProvider';

export class OpenRouterService implements LLMProvider {
  readonly name = 'openrouter';
  readonly displayName = 'OpenRouter';
  
  private config: any;
  private client: any = null;
  private apiKey: string | null = null;

  constructor(config: any) {
    this.config = config;
    this.apiKey = config.get('openrouter.apiKey') || null;
    
    if (this.apiKey) {
      this.client = new OpenRouter({ apiKey: this.apiKey });
    }
  }

  /**
   * Check if OpenRouter is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.apiKey || !this.client) {
      return false;
    }

    try {
      // Quick check via auth/key endpoint
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get provider information
   */
  async getInfo(): Promise<LLMProviderInfo> {
    if (!this.apiKey) {
      return {
        name: this.name,
        displayName: this.displayName,
        isAuthenticated: false
      };
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });

      if (!response.ok) {
        return {
          name: this.name,
          displayName: this.displayName,
          isAuthenticated: false
        };
      }

      const keyInfo: any = await response.json();
      
      return {
        name: this.name,
        displayName: this.displayName,
        isAuthenticated: true,
        usage: keyInfo.data?.usage ? {
          used: keyInfo.data.usage,
          limit: keyInfo.data.limit || Infinity,
          remaining: (keyInfo.data.limit || Infinity) - keyInfo.data.usage
        } : undefined
      };
    } catch {
      return {
        name: this.name,
        displayName: this.displayName,
        isAuthenticated: !!this.apiKey
      };
    }
  }

  /**
   * Get available models
   */
  async getModels(): Promise<string[]> {
    if (!this.client) return [];

    try {
      const response = await this.client.models.list();
      return (response.data || []).map((m: any) => m.id);
    } catch {
      return [];
    }
  }

  /**
   * Complete a chat request (non-streaming)
   */
  async complete(messages: LLMMessage[], options: LLMCompletionOptions = {}): Promise<LLMCompletionResponse> {
    if (!this.client) {
      throw new Error('OpenRouter not configured. Set your API key first.');
    }

    const model = options.model || this.config.get('openrouter.model');
    const configuredMaxTokens = options.maxTokens ?? this.config.get('openrouter.maxTokens');
    const max_tokens = typeof configuredMaxTokens === 'number' && configuredMaxTokens > 0
      ? configuredMaxTokens
      : undefined;

    const requestBody: any = {
      model,
      messages,
      temperature: options.temperature ?? this.config.get('openrouter.temperature') ?? 0.7,
      ...(max_tokens ? { max_tokens } : {})
    };

    try {
      const response = await this.client.chat.send(requestBody);
      const content = response.choices?.[0]?.message?.content || '';
      
      return {
        content,
        usage: response.usage || undefined,
        provider: this.name,
        model
      };
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Stream a chat request
   */
  async stream(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    options: LLMCompletionOptions = {}
  ): Promise<LLMStreamResponse> {
    if (!this.client) {
      throw new Error('OpenRouter not configured. Set your API key first.');
    }

    const model = options.model || this.config.get('openrouter.model');
    const configuredMaxTokens = options.maxTokens ?? this.config.get('openrouter.maxTokens');
    const max_tokens = typeof configuredMaxTokens === 'number' && configuredMaxTokens > 0
      ? configuredMaxTokens
      : undefined;

    const requestBody: any = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      stream: true,
      ...(max_tokens ? { max_tokens } : {})
    };

    try {
      const streamResult = await this.client.chat.send(requestBody);
      let fullContent = '';
      let lastUsage: any = undefined;

      // The stream returns ChatStreamingResponseChunkData objects
      for await (const chunkData of streamResult) {
        // Extract delta content from the chunk
        const delta = chunkData.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullContent += delta;
          onChunk(delta);
        }

        // Capture usage info if present (typically in the last chunk)
        if (chunkData.usage) {
          lastUsage = chunkData.usage;
        }
      }

      return {
        content: fullContent,
        usage: lastUsage
      };
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Set API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.client = new OpenRouter({ apiKey });
    this.config.set('openrouter.apiKey', apiKey);
  }
}

export default OpenRouterService;
