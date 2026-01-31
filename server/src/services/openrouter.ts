/**
 * OpenRouter Integration Service
 * 
 * Manages OpenRouter API integration with multi-model support,
 * fallback handling, and cost tracking.
 */

export interface Config {
  get(key: string): any;
  set(key: string, value: any): void;
}

export interface OpenRouterConfig {
  apiKey: string;
  defaultModel: string;
  modelProfiles: Record<string, ModelProfile>;
  fallbackModels: string[];
  costLimitUSD: number;
  rateLimitRPM: number;
}

export interface ModelProfile {
  reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh';
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
}

export interface LLMRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  profile?: ModelProfile;
  stream?: boolean;
}

export interface LLMResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  cost?: number;
}

export class OpenRouterService {
  private config: Config;
  private apiKey: string;
  private baseURL: string = 'https://openrouter.ai/api/v1';
  private totalCost: number = 0;

  constructor(config: Config) {
    this.config = config;
    this.apiKey = config.get('openrouter.apiKey') || '';
  }

  /**
   * Calls OpenRouter API with specified model
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const modelConfig = this.config.get('openrouter.modelProfiles')?.[request.model] || {};
    const profile = { ...modelConfig, ...request.profile };

    const requestBody = {
      model: request.model,
      messages: request.messages,
      ...profile,
      stream: request.stream || false
    };

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/agentforge',
          'X-Title': 'AgentForge'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        // Try fallback models if primary fails
        return await this.tryFallback(request);
      }

      const data = await response.json();
      
      // Calculate cost (if pricing available)
      if (data.usage) {
        const cost = this.calculateCost(request.model, data.usage);
        data.cost = cost;
        this.totalCost += cost;
      }

      return data;
    } catch (error: any) {
      // Try fallback models
      return await this.tryFallback(request);
    }
  }

  /**
   * Attempts to use fallback models
   */
  private async tryFallback(request: LLMRequest): Promise<LLMResponse> {
    const fallbackModels = this.config.get('openrouter.fallbackModels') || [];

    for (const model of fallbackModels) {
      try {
        console.log(`Trying fallback model: ${model}`);
        return await this.complete({ ...request, model });
      } catch (error) {
        continue;
      }
    }

    throw new Error('All models failed including fallbacks');
  }

  /**
   * Calculates cost based on token usage and model pricing
   */
  private calculateCost(model: string, usage: { prompt_tokens: number; completion_tokens: number }): number {
    // Placeholder: Use actual model pricing
    const promptPrice = 0.000001; // $1 per 1M tokens
    const completionPrice = 0.000002; // $2 per 1M tokens

    return (usage.prompt_tokens * promptPrice) + (usage.completion_tokens * completionPrice);
  }

  /**
   * Gets available models from OpenRouter
   */
  async getModels(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Returns total cost spent
   */
  getTotalCost(): number {
    return this.totalCost;
  }

  /**
   * Checks if cost limit has been exceeded
   */
  checkCostLimit(): boolean {
    const limit = this.config.get('openrouter.costLimitUSD') || 100;
    return this.totalCost >= limit;
  }
}
