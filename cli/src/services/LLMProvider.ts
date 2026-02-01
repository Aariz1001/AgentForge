/**
 * LLM Provider Interface
 * ======================
 * Unified interface for different LLM providers (OpenRouter, GitHub Copilot, etc.)
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | any[];
}

export interface LLMCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: {
    enabled: boolean;
    effort?: 'low' | 'medium' | 'high' | 'xhigh';
  };
  stream?: boolean;
}

export interface LLMCompletionResponse {
  content: string;
  reasoning?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
  provider?: string;
}

export interface LLMStreamResponse {
  content: string;
  reasoning?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface LLMProviderInfo {
  name: string;
  displayName: string;
  isAuthenticated: boolean;
  subscription?: string;
  usage?: {
    used: number;
    limit: number;
    remaining: number;
  };
  models?: string[];
}

export interface LLMProvider {
  /** Provider name identifier */
  readonly name: string;
  
  /** Display name for UI */
  readonly displayName: string;
  
  /** Check if provider is available and authenticated */
  isAvailable(): Promise<boolean>;
  
  /** Get provider info including usage stats */
  getInfo(): Promise<LLMProviderInfo>;
  
  /** Get available models */
  getModels(): Promise<string[]>;
  
  /** Complete a chat request (non-streaming) */
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResponse>;
  
  /** Stream a chat request */
  stream(
    messages: LLMMessage[], 
    onChunk: (chunk: string) => void, 
    options?: LLMCompletionOptions
  ): Promise<LLMStreamResponse>;
  
  /** Authenticate with the provider (if needed) */
  authenticate?(): Promise<boolean>;
  
  /** Sign out from the provider */
  signOut?(): Promise<void>;
}

export type ProviderType = 'openrouter' | 'copilot';

export const PROVIDER_DISPLAY_NAMES: Record<ProviderType, string> = {
  openrouter: 'OpenRouter',
  copilot: 'GitHub Copilot',
};
