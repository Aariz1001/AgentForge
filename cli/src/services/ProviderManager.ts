/**
 * Provider Manager
 * ================
 * Manages multiple LLM providers and handles provider switching.
 */

import chalk from 'chalk';
import type { 
  LLMProvider, 
  LLMMessage, 
  LLMCompletionOptions, 
  LLMCompletionResponse, 
  LLMStreamResponse,
  LLMProviderInfo,
  ProviderType 
} from './LLMProvider';
import { OpenRouterService } from './OpenRouterService';
import { CopilotService } from './CopilotService';

export interface ProviderStatus {
  provider: ProviderType;
  available: boolean;
  info?: LLMProviderInfo;
}

export class ProviderManager {
  private config: any;
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private activeProvider: ProviderType;

  constructor(config: any) {
    this.config = config;
    
    // Initialize providers
    this.providers.set('openrouter', new OpenRouterService(config));
    this.providers.set('copilot', new CopilotService(config));
    
    // Get active provider from config (default to openrouter)
    this.activeProvider = config.get('llm.provider') || 'openrouter';
  }

  /**
   * Get the active provider type
   */
  getActiveProviderType(): ProviderType {
    return this.activeProvider;
  }

  /**
   * Get the active provider instance
   */
  getActiveProvider(): LLMProvider {
    const provider = this.providers.get(this.activeProvider);
    if (!provider) {
      throw new Error(`Provider ${this.activeProvider} not found`);
    }
    return provider;
  }

  /**
   * Get a specific provider by type
   */
  getProvider(type: ProviderType): LLMProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Set the active provider
   */
  async setActiveProvider(type: ProviderType): Promise<boolean> {
    const provider = this.providers.get(type);
    if (!provider) {
      console.error(chalk.red(`Unknown provider: ${type}`));
      return false;
    }

    // Check if provider is available
    const available = await provider.isAvailable();
    if (!available) {
      console.error(chalk.red(`Provider ${provider.displayName} is not available.`));
      
      // Offer to authenticate if possible
      if (provider.authenticate) {
        console.log(chalk.yellow(`\nWould you like to set up ${provider.displayName}?`));
      }
      return false;
    }

    this.activeProvider = type;
    this.config.set('llm.provider', type);
    
    console.log(chalk.green(`✓ Switched to ${provider.displayName}`));
    return true;
  }

  /**
   * Get status of all providers
   */
  async getAllProvidersStatus(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = [];

    for (const [type, provider] of this.providers) {
      const available = await provider.isAvailable();
      let info: LLMProviderInfo | undefined;

      if (available) {
        try {
          info = await provider.getInfo();
        } catch {
          // Ignore info errors
        }
      }

      statuses.push({ provider: type, available, info });
    }

    return statuses;
  }

  /**
   * Complete a chat request using active provider
   */
  async complete(messages: LLMMessage[], options: LLMCompletionOptions = {}): Promise<LLMCompletionResponse> {
    const provider = this.getActiveProvider();
    return provider.complete(messages, options);
  }

  /**
   * Stream a chat request using active provider
   */
  async stream(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    options: LLMCompletionOptions = {}
  ): Promise<LLMStreamResponse> {
    const provider = this.getActiveProvider();
    return provider.stream(messages, onChunk, options);
  }

  /**
   * Get available models from active provider
   */
  async getModels(): Promise<string[]> {
    const provider = this.getActiveProvider();
    return provider.getModels();
  }

  /**
   * Get info from active provider
   */
  async getInfo(): Promise<LLMProviderInfo> {
    const provider = this.getActiveProvider();
    return provider.getInfo();
  }

  /**
   * Authenticate with a specific provider
   */
  async authenticateProvider(type: ProviderType): Promise<boolean> {
    const provider = this.providers.get(type);
    if (!provider) {
      console.error(chalk.red(`Unknown provider: ${type}`));
      return false;
    }

    if (!provider.authenticate) {
      console.error(chalk.yellow(`Provider ${provider.displayName} does not support interactive authentication.`));
      return false;
    }

    return provider.authenticate();
  }

  /**
   * Sign out from a specific provider
   */
  async signOutProvider(type: ProviderType): Promise<void> {
    const provider = this.providers.get(type);
    if (!provider) {
      console.error(chalk.red(`Unknown provider: ${type}`));
      return;
    }

    if (provider.signOut) {
      await provider.signOut();
    }

    // If this was the active provider, try to switch to another
    if (this.activeProvider === type) {
      for (const [otherType, otherProvider] of this.providers) {
        if (otherType !== type && await otherProvider.isAvailable()) {
          this.activeProvider = otherType;
          this.config.set('llm.provider', otherType);
          console.log(chalk.yellow(`Switched to ${otherProvider.displayName}`));
          break;
        }
      }
    }
  }

  /**
   * Display provider status in a formatted way
   */
  async displayStatus(): Promise<void> {
    console.log(chalk.bold('\n📡 LLM Provider Status\n'));
    console.log(chalk.gray(`  Active provider: ${chalk.cyan(this.activeProvider)}`));
    console.log('');

    const statuses = await this.getAllProvidersStatus();

    for (const status of statuses) {
      const provider = this.providers.get(status.provider)!;
      const isActive = status.provider === this.activeProvider;
      const activeMarker = isActive ? chalk.green(' (active)') : '';
      
      if (status.available && status.info) {
        console.log(`${chalk.green('●')} ${provider.displayName}${activeMarker}`);
        
        if (status.info.subscription) {
          console.log(chalk.gray(`  └─ Subscription: ${status.info.subscription}`));
        }
        
        if (status.info.usage) {
          const { used, limit, remaining } = status.info.usage;
          const percent = limit === Infinity ? 0 : Math.round((used / limit) * 100);
          const limitStr = limit === Infinity ? '∞' : limit.toString();
          console.log(chalk.gray(`  └─ Usage: ${used}/${limitStr} (${remaining} remaining)`));
        }
      } else {
        console.log(`${chalk.red('○')} ${provider.displayName}${activeMarker}`);
        console.log(chalk.gray(`  └─ Not configured or unavailable`));
        if (status.provider === 'openrouter') {
          console.log(chalk.gray('  └─ Setup: agentforge provider --login openrouter'));
        } else if (status.provider === 'copilot') {
          console.log(chalk.gray('  └─ Setup: agentforge provider --login copilot'));
        }
      }
    }

    console.log('');
  }
}

export default ProviderManager;
