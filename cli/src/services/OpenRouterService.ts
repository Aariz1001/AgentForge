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
    const maxOutputTokens = typeof configuredMaxTokens === 'number' && configuredMaxTokens > 0
      ? configuredMaxTokens
      : undefined;

    // Separate system message
    let instructions: string | undefined;
    let input: any[] = messages;

    if (messages.length > 0 && messages[0].role === 'system') {
      instructions = String(messages[0].content);
      input = messages.slice(1);
    }

    const callArgs: any = {
      model,
      input,
      temperature: options.temperature ?? this.config.get('openrouter.temperature') ?? 0.7,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(options.reasoning ? { reasoning: options.reasoning } : {})
    };

    if (instructions) {
      callArgs.instructions = instructions;
    }

    try {
      const result = this.client.callModel(callArgs);
      const response = await result.getResponse();

      return {
        content: response.text || '',
        reasoning: response.reasoning,
        usage: response.usage,
        provider: this.name,
        model
      };
    } catch (error: any) {
      // Retry without reasoning if unsupported
      if (options.reasoning && /reasoning|unknown parameter|unsupported/i.test(error.message || '')) {
        delete callArgs.reasoning;
        const result = this.client.callModel(callArgs);
        const response = await result.getResponse();
        return {
          content: response.text || '',
          usage: response.usage,
          provider: this.name,
          model
        };
      }
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
    const maxOutputTokens = typeof configuredMaxTokens === 'number' && configuredMaxTokens > 0
      ? configuredMaxTokens
      : undefined;

    let instructions: string | undefined;
    let input: any[] = messages;

    if (messages.length > 0 && messages[0].role === 'system') {
      instructions = String(messages[0].content);
      input = messages.slice(1);
    }

    const callArgs: any = {
      model,
      input,
      temperature: options.temperature ?? 0.7,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(options.reasoning ? { reasoning: options.reasoning } : {})
    };

    if (instructions) {
      callArgs.instructions = instructions;
    }

    try {
      const result = this.client.callModel(callArgs);
      let fullContent = '';
      let fullReasoning = '';

      for await (const delta of result.getTextStream()) {
        fullContent += delta;
        onChunk(delta);
      }

      try {
        for await (const reason of result.getReasoningStream()) {
          fullReasoning += reason;
        }
      } catch {
        // Reasoning stream might not be available
      }

      const response = await result.getResponse();
      return {
        content: fullContent,
        reasoning: fullReasoning || undefined,
        usage: response.usage
      };
    } catch (error: any) {
      if (options.reasoning && /reasoning|unknown parameter|unsupported/i.test(error.message || '')) {
        delete callArgs.reasoning;
        const result = this.client.callModel(callArgs);
        let fullContent = '';

        for await (const delta of result.getTextStream()) {
          fullContent += delta;
          onChunk(delta);
        }

        const response = await result.getResponse();
        return { content: fullContent, usage: response.usage };
      }
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
