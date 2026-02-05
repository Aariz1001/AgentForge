/**
 * GitHub Copilot Service
 * ======================
 * Integration with GitHub Copilot SDK for users with Pro/Pro+ subscriptions.
 * 
 * This service provides:
 * - OAuth device flow authentication via GitHub CLI
 * - Model selection based on subscription tier
 * - Usage tracking for premium requests
 * - Streaming and non-streaming completions
 */

import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { 
  LLMProvider, 
  LLMMessage, 
  LLMCompletionOptions, 
  LLMCompletionResponse, 
  LLMStreamResponse,
  LLMProviderInfo 
} from './LLMProvider';

const execAsync = promisify(exec);

// Copilot subscription tiers and their model access
export const COPILOT_TIERS = {
  free: {
    name: 'Free',
    premiumRequests: 50,
    models: ['gpt-4.1', 'gpt-5-mini', 'grok-code-fast-1']
  },
  pro: {
    name: 'Pro',
    premiumRequests: 300,
    models: [
      'gpt-4.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-codex', 'gpt-5.1', 'gpt-5.1-codex',
      'gpt-5.1-codex-mini', 'gpt-5.1-codex-max', 'gpt-5.2', 'gpt-5.2-codex',
      'claude-haiku-4.5', 'claude-opus-4.5', 'claude-sonnet-4', 'claude-sonnet-4.5',
      'gemini-2.5-pro', 'gemini-3-flash', 'gemini-3-pro', 'grok-code-fast-1'
    ]
  },
  'pro+': {
    name: 'Pro+',
    premiumRequests: 1500,
    models: [
      'gpt-4.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-codex', 'gpt-5.1', 'gpt-5.1-codex',
      'gpt-5.1-codex-mini', 'gpt-5.1-codex-max', 'gpt-5.2', 'gpt-5.2-codex',
      'claude-haiku-4.5', 'claude-opus-4.1', 'claude-opus-4.5', 'claude-sonnet-4', 'claude-sonnet-4.5',
      'gemini-2.5-pro', 'gemini-3-flash', 'gemini-3-pro', 'grok-code-fast-1'
    ]
  }
};

export interface CopilotConfig {
  authenticated: boolean;
  username?: string;
  tier?: 'free' | 'pro' | 'pro+';
  tokenExpiry?: number;
}

export interface CopilotUsage {
  premiumRequestsUsed: number;
  premiumRequestsLimit: number;
  lastUpdated: string;
}

export class CopilotService implements LLMProvider {
  readonly name = 'copilot';
  readonly displayName = 'GitHub Copilot';
  
  private config: any;
  private copilotClient: any = null;
  private session: any = null;
  private configPath: string;
  private usagePath: string;
  private cachedConfig: CopilotConfig | null = null;
  private cachedUsage: CopilotUsage | null = null;

  constructor(config: any) {
    this.config = config;
    const dataDir = join(homedir(), '.agentforge');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.configPath = join(dataDir, 'copilot-config.json');
    this.usagePath = join(dataDir, 'copilot-usage.json');
    this.loadCachedConfig();
  }

  private loadCachedConfig(): void {
    try {
      if (existsSync(this.configPath)) {
        this.cachedConfig = JSON.parse(readFileSync(this.configPath, 'utf-8'));
      }
      if (existsSync(this.usagePath)) {
        this.cachedUsage = JSON.parse(readFileSync(this.usagePath, 'utf-8'));
      }
    } catch {
      // Ignore errors
    }
  }

  private saveConfig(config: CopilotConfig): void {
    this.cachedConfig = config;
    writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  private saveUsage(usage: CopilotUsage): void {
    this.cachedUsage = usage;
    writeFileSync(this.usagePath, JSON.stringify(usage, null, 2));
  }

  /**
   * Get current tier from cache
   */
  public getCurrentTier(): 'free' | 'pro' | 'pro+' | null {
    return this.cachedConfig?.tier ?? null;
  }

  // Cached gh path
  private ghPath: string | null = null;

  /**
   * Find the gh CLI executable path
   * Checks PATH first, then common installation directories
   */
  private async findGitHubCLIPath(): Promise<string | null> {
    if (this.ghPath) return this.ghPath;

    // First, try the command directly (works if PATH is updated)
    try {
      await execAsync('gh --version');
      this.ghPath = 'gh';
      return 'gh';
    } catch {
      // Not in PATH, check common locations
    }

    // Common Windows installation paths
    const windowsPaths = [
      join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'),
      join(process.env.PROGRAMFILES || '', 'GitHub CLI', 'gh.exe'),
      join(process.env['ProgramFiles(x86)'] || '', 'GitHub CLI', 'gh.exe'),
      'C:\\Program Files\\GitHub CLI\\gh.exe',
      'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
    ];

    // Check each Windows path
    for (const ghPath of windowsPaths) {
      if (existsSync(ghPath)) {
        this.ghPath = `"${ghPath}"`;
        return this.ghPath;
      }
    }

    // On macOS/Linux, check common paths
    const unixPaths = [
      '/usr/local/bin/gh',
      '/opt/homebrew/bin/gh',
      '/usr/bin/gh',
      join(homedir(), '.local', 'bin', 'gh'),
    ];

    for (const ghPath of unixPaths) {
      if (existsSync(ghPath)) {
        this.ghPath = ghPath;
        return ghPath;
      }
    }

    return null;
  }

  /**
   * Check if GitHub CLI is installed
   */
  async isGitHubCLIInstalled(): Promise<boolean> {
    const ghPath = await this.findGitHubCLIPath();
    return ghPath !== null;
  }

  /**
   * Get the gh command (with full path if needed)
   */
  private async getGhCommand(): Promise<string> {
    const ghPath = await this.findGitHubCLIPath();
    return ghPath || 'gh';
  }

  /**
   * Check if user is authenticated with GitHub CLI
   */
  async isGitHubCLIAuthenticated(): Promise<boolean> {
    try {
      const ghCmd = await this.getGhCommand();
      const { stdout } = await execAsync(`${ghCmd} auth status`);
      return stdout.includes('Logged in') || !stdout.includes('not logged');
    } catch (error: any) {
      // gh auth status returns non-zero if not authenticated
      const output = error.stderr || error.stdout || '';
      return output.includes('Logged in');
    }
  }

  /**
   * Get GitHub username
   */
  async getGitHubUsername(): Promise<string | null> {
    try {
      const ghCmd = await this.getGhCommand();
      const { stdout } = await execAsync(`${ghCmd} api user --jq .login`);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Check Copilot subscription status using multiple detection methods:
   * 1. SDK model availability - Most reliable, Pro+ has access to advanced models
   * 2. Entitlement scopes - Check capabilities via GitHub API
   * 3. Usage quota - Pro has 300 requests, Pro+ has 1500
   */
  async getCopilotSubscription(): Promise<'free' | 'pro' | 'pro+' | null> {
    const ghCmd = await this.getGhCommand();
    
    // Return cached tier if available and not expired
    if (this.cachedConfig?.tier && this.cachedConfig?.tokenExpiry) {
      if (Date.now() < this.cachedConfig.tokenExpiry) {
        return this.cachedConfig.tier;
      }
    }
    
    try {
      // Verify user is authenticated first
      const { stdout: userJson } = await execAsync(`${ghCmd} api user`);
      const userData = JSON.parse(userJson);
      
      if (!userData.login) {
        return null;
      }

      // Pro+ exclusive models that are not available in Pro
      const proPlusExclusiveModels = [
        'claude-opus-4.1',
        'o3',
        'gpt-5.2-codex',
        'gpt-5.1-codex-max'
      ];

      // Method 1: Use SDK to list available models (most reliable)
      try {
        await this.initializeClient();
        const tierFromModels = await this.detectTierFromModels();
        if (tierFromModels) {
          return tierFromModels;
        }
      } catch {
        // SDK not initialized yet, continue with other methods
      }

      // Method 1b: Probe a Pro+ only model to confirm access
      try {
        const tierFromProbe = await this.detectTierByModelProbe();
        if (tierFromProbe) {
          return tierFromProbe;
        }
      } catch {
        // Probe failed, continue
      }
      
      // Method 2: Check via SDK client if already initialized
      try {
        if (this.copilotClient?.listModels) {
          const models = await this.copilotClient.listModels?.();
          if (models && Array.isArray(models)) {
            const hasProPlusModel = models.some((m: any) => 
              proPlusExclusiveModels.some(pm => 
                m.id?.toLowerCase().includes(pm) || 
                m.name?.toLowerCase().includes(pm)
              )
            );
            if (hasProPlusModel) {
              return 'pro+';
            }
            // Has models but no Pro+ exclusive = Pro
            if (models.length > 0) {
              return 'pro';
            }
          }
        }
      } catch {
        // SDK method not available, continue to next method
      }

      // Method 2: Check entitlements via GitHub API
      try {
        const { stdout: entitlementsJson } = await execAsync(
          `${ghCmd} api user/copilot_endpoints 2>/dev/null || echo "{}"`
        );
        const entitlements = JSON.parse(entitlementsJson || '{}');
        
        // Check for Pro+ indicators in capabilities or usage limits
        if (entitlements.usage_limit) {
          if (entitlements.usage_limit >= 1500) {
            return 'pro+';
          } else if (entitlements.usage_limit >= 300) {
            return 'pro';
          } else if (entitlements.usage_limit >= 50) {
            return 'free';
          }
        }
        
        // Check capabilities field for advanced features
        if (entitlements.capabilities) {
          const caps = entitlements.capabilities;
          if (caps.includes?.('advanced_models') || caps.includes?.('pro_plus')) {
            return 'pro+';
          }
        }
      } catch {
        // Entitlements API not accessible, continue
      }

      // Method 3: Check billing/usage quota
      try {
        const { stdout: usageJson } = await execAsync(
          `${ghCmd} api users/${userData.login}/settings/billing/premium_request/usage`
        );
        const usage = JSON.parse(usageJson);
        
        // Check if user has Pro+ models in their usage history
        if (usage.usageItems && usage.usageItems.length > 0) {
          const hasProPlusModelUsage = usage.usageItems.some((item: any) => 
            proPlusExclusiveModels.some(pm => 
              item.model?.toLowerCase().includes(pm.replace('-', ''))
            )
          );
          if (hasProPlusModelUsage) {
            return 'pro+';
          }
        }
      } catch {
        // Billing API requires additional scopes, continue
      }

      // Method 4: Try to access a Pro+ only model to test
      try {
        // Quick check - try to see if claude-opus is in available models
        const { stdout: modelsJson } = await execAsync(
          `${ghCmd} api copilot/models 2>/dev/null || echo "[]"`
        );
        const models = JSON.parse(modelsJson || '[]');
        
        if (Array.isArray(models) && models.length > 0) {
          const hasProPlusModel = models.some((m: any) =>
            proPlusExclusiveModels.some(pm =>
              JSON.stringify(m).toLowerCase().includes(pm.replace('-', ''))
            )
          );
          return hasProPlusModel ? 'pro+' : 'pro';
        }
      } catch {
        // Models API not available
      }

      // Fallback: Authentication with copilot scope succeeded
      // Default to 'pro' as it's the most common individual subscription
      // The API will indicate if specific models aren't available
      return 'pro';
      
    } catch (error: any) {
      return null;
    }
  }

  /**
   * Initialize the Copilot SDK client
   */
  private async initializeClient(): Promise<void> {
    if (this.copilotClient) return;

    try {
      // Dynamic import of the Copilot SDK
      const { CopilotClient } = await import('@github/copilot-sdk');
      
      this.copilotClient = new CopilotClient({
        logLevel: 'error',
        autoStart: true,
        autoRestart: true
      });

      await this.copilotClient.start();
    } catch (error: any) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' || error.message?.includes('Cannot find module')) {
        throw new Error(
          'GitHub Copilot SDK not installed. Run: npm install @github/copilot-sdk\n' +
          'Also ensure you have GitHub Copilot Pro or Pro+ subscription.'
        );
      }
      throw error;
    }
  }

  /**
   * List available models from the SDK
   * This is the most reliable way to determine tier
   */
  async listAvailableModels(): Promise<string[]> {
    try {
      await this.initializeClient();
      
      if (this.copilotClient?.listModels) {
        const models = await this.copilotClient.listModels();
        return models.map((m: any) => m.id || m.name || m);
      }
      
      // Fallback: return models from cached tier
      if (this.cachedConfig?.tier) {
        return COPILOT_TIERS[this.cachedConfig.tier].models;
      }
      
      return [];
    } catch {
      // SDK not available, return cached tier models
      if (this.cachedConfig?.tier) {
        return COPILOT_TIERS[this.cachedConfig.tier].models;
      }
      return [];
    }
  }

  /**
   * Detect tier based on available models
   */
  async detectTierFromModels(): Promise<'free' | 'pro' | 'pro+' | null> {
    const proPlusExclusiveModels = ['claude-opus-4.1'];
    
    try {
      const availableModels = await this.listAvailableModels();
      
      if (availableModels.length === 0) {
        return null;
      }
      
      // Check for Pro+ exclusive models
      const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const hasProPlusModel = availableModels.some(model =>
        proPlusExclusiveModels.some(pm =>
          normalize(model).includes(normalize(pm))
        )
      );
      
      if (hasProPlusModel) {
        return 'pro+';
      }
      
      // Check model count - Free has very limited, Pro has more
      if (availableModels.length <= 3) {
        return 'free';
      }
      
      return 'pro';
    } catch {
      return null;
    }
  }

  /**
   * Probe a Pro+ only model to determine tier
   * If the model is accepted, the user is Pro+
   */
  private async detectTierByModelProbe(): Promise<'pro' | 'pro+' | null> {
    try {
      await this.initializeClient();

      const testModel = 'claude-opus-4.1';
      const testSession = await this.copilotClient.createSession({
        model: testModel,
        streaming: false
      });

      await testSession.destroy().catch(() => {});
      return 'pro+';
    } catch (error: any) {
      const message = error?.message?.toLowerCase() || '';
      if (
        message.includes('model') ||
        message.includes('not available') ||
        message.includes('not supported') ||
        message.includes('permission') ||
        message.includes('access')
      ) {
        return 'pro';
      }
      return null;
    }
  }

  /**
   * Create or reuse a session
   */
  private async getSession(model: string): Promise<any> {
    if (this.session) {
      // Destroy existing session if model changed
      await this.session.destroy().catch(() => {});
    }

    this.session = await this.copilotClient.createSession({
      model,
      streaming: true
    });

    return this.session;
  }

  /**
   * Check if Copilot is available
   */
  async isAvailable(): Promise<boolean> {
    // First check if authenticated via cached config
    if (this.cachedConfig?.authenticated) {
      return true;
    }

    // Check GitHub CLI authentication
    const cliInstalled = await this.isGitHubCLIInstalled();
    if (!cliInstalled) return false;

    const authenticated = await this.isGitHubCLIAuthenticated();
    if (!authenticated) return false;

    // Check Copilot subscription
    const subscription = await this.getCopilotSubscription();
    return subscription !== null;
  }

  /**
   * Get provider information
   */
  async getInfo(): Promise<LLMProviderInfo> {
    const isAuthenticated = await this.isAvailable();
    
    if (!isAuthenticated) {
      return {
        name: this.name,
        displayName: this.displayName,
        isAuthenticated: false
      };
    }

    const username = this.cachedConfig?.username || await this.getGitHubUsername();
    const tier = this.cachedConfig?.tier || await this.getCopilotSubscription() || 'free';
    const tierInfo = COPILOT_TIERS[tier];

    // Load or initialize usage
    let usage = this.cachedUsage;
    if (!usage) {
      usage = {
        premiumRequestsUsed: 0,
        premiumRequestsLimit: tierInfo.premiumRequests,
        lastUpdated: new Date().toISOString()
      };
      this.saveUsage(usage);
    }

    return {
      name: this.name,
      displayName: this.displayName,
      isAuthenticated: true,
      subscription: `Copilot ${tierInfo.name}`,
      usage: {
        used: usage.premiumRequestsUsed,
        limit: usage.premiumRequestsLimit,
        remaining: usage.premiumRequestsLimit - usage.premiumRequestsUsed
      },
      models: tierInfo.models
    };
  }

  /**
   * Get available models based on subscription
   */
  async getModels(): Promise<string[]> {
    const tier = this.cachedConfig?.tier || await this.getCopilotSubscription() || 'free';
    return COPILOT_TIERS[tier].models;
  }

  /**
   * Authenticate with GitHub Copilot
   * This method will:
   * 1. Check if GitHub CLI is installed (required)
   * 2. Check if user is logged into GitHub
   * 3. If not, open browser for OAuth device flow and WAIT for completion
   * 4. Verify Copilot subscription exists
   * 5. Save credentials and show success/error
   */
  async authenticate(): Promise<boolean> {
    console.log(chalk.bold.cyan('\n🔐 GitHub Copilot Authentication\n'));
    
    const spinner = ora('Checking prerequisites...').start();

    // Step 1: Check if GitHub CLI is installed
    spinner.text = 'Checking GitHub CLI installation...';
    const cliInstalled = await this.isGitHubCLIInstalled();
    if (!cliInstalled) {
      spinner.fail('GitHub CLI (gh) is not installed');
      console.log(boxen(
        chalk.yellow('GitHub CLI is required for Copilot authentication.\n\n') +
        chalk.gray('Note: The VS Code Copilot extension is different from the CLI.\n') +
        chalk.gray('The CLI is needed to authenticate programmatically.\n\n') +
        chalk.white('Install it using one of these methods:\n\n') +
        chalk.cyan('  Windows:  ') + chalk.white('winget install --id GitHub.cli\n') +
        chalk.cyan('  macOS:    ') + chalk.white('brew install gh\n') +
        chalk.cyan('  Linux:    ') + chalk.white('See https://cli.github.com/\n\n') +
        chalk.gray('After installing, run: agentforge provider --login copilot'),
        { padding: 1, borderColor: 'yellow', title: 'Installation Required' }
      ));
      return false;
    }
    spinner.succeed('GitHub CLI is installed');

    // Step 2: Check if authenticated with GitHub
    spinner.start('Checking GitHub authentication status...');
    const authenticated = await this.isGitHubCLIAuthenticated();
    
    if (!authenticated) {
      spinner.info('Not logged into GitHub');
      
      console.log(boxen(
        chalk.white('You need to authenticate with GitHub.\n\n') +
        chalk.gray('A browser window will open for you to:\n') +
        chalk.white('  1. Enter the code shown in the terminal\n') +
        chalk.white('  2. Authorize GitHub CLI\n\n') +
        chalk.yellow('The agent will wait until authentication is complete.'),
        { padding: 1, borderColor: 'cyan', title: '🌐 Browser Authentication' }
      ));
      
      console.log(chalk.cyan('\nStarting GitHub authentication...\n'));
      
      try {
        // Get the full path to gh command
        const ghCmd = await this.getGhCommand();
        
        // Use spawn for interactive authentication - this BLOCKS until complete
        // Keep quotes for shell execution with paths containing spaces
        const authProcess = spawn(ghCmd, ['auth', 'login', '--web', '-s', 'copilot'], {
          stdio: 'inherit',  // This allows the user to see prompts and interact
          shell: true
        });

        // Wait for the process to complete
        const authResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
          authProcess.on('close', (code) => {
            if (code === 0) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: `Process exited with code ${code}` });
            }
          });
          authProcess.on('error', (err) => {
            resolve({ success: false, error: err.message });
          });
        });

        if (!authResult.success) {
          console.log(chalk.red(`\n✗ GitHub authentication failed: ${authResult.error}`));
          console.log(chalk.gray('  Try running: gh auth login --web'));
          return false;
        }

        console.log(chalk.green('\n✓ GitHub authentication successful!\n'));
      } catch (error: any) {
        console.log(chalk.red(`\n✗ Authentication error: ${error.message}`));
        return false;
      }
    } else {
      spinner.succeed('Already authenticated with GitHub');
    }

    // Step 3: Verify/set Copilot subscription tier
    // Since authentication with copilot scope succeeded, user has access
    spinner.start('Detecting Copilot subscription...');
    
    const subscription = await this.getCopilotSubscription();
    
    if (!subscription) {
      spinner.fail('Could not verify Copilot subscription');
      console.log(chalk.yellow('\nMake sure you have an active GitHub Copilot subscription.'));
      return false;
    }
    
    spinner.succeed(`Detected Copilot ${COPILOT_TIERS[subscription].name}`);

    // Step 4: Get username and save config
    const username = await this.getGitHubUsername();
    const tierInfo = COPILOT_TIERS[subscription];

    this.saveConfig({
      authenticated: true,
      username: username || undefined,
      tier: subscription,
      tokenExpiry: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
    });

    this.saveUsage({
      premiumRequestsUsed: 0,
      premiumRequestsLimit: tierInfo.premiumRequests,
      lastUpdated: new Date().toISOString()
    });

    spinner.succeed('Copilot subscription verified');

    // Show success summary
    console.log(boxen(
      chalk.green('✓ Successfully authenticated!\n\n') +
      chalk.white('Account:      ') + chalk.cyan(username) + '\n' +
      chalk.white('Subscription: ') + chalk.green(`Copilot ${tierInfo.name}`) + '\n' +
      chalk.white('Requests:     ') + chalk.yellow(`${tierInfo.premiumRequests}/month`) + '\n' +
      chalk.white('Used:         ') + chalk.cyan(`${this.cachedUsage?.premiumRequestsUsed ?? 0}`) + '\n' +
      chalk.white('Remaining:    ') + chalk.cyan(`${(this.cachedUsage?.premiumRequestsLimit ?? tierInfo.premiumRequests) - (this.cachedUsage?.premiumRequestsUsed ?? 0)}`) + '\n' +
      chalk.white('Models:       ') + chalk.gray(`${tierInfo.models.length} available`) + '\n\n' +
      chalk.gray('To use Copilot, run:\n') +
      chalk.cyan('  agentforge provider --switch copilot\n') +
      chalk.cyan('  agentforge chat'),
      { padding: 1, borderColor: 'green', title: '🎉 GitHub Copilot Ready' }
    ));

    return true;
  }

  /**
   * Sign out from GitHub Copilot
   */
  async signOut(): Promise<void> {
    // Clear cached config
    this.cachedConfig = null;
    this.cachedUsage = null;
    
    try {
      if (existsSync(this.configPath)) {
        writeFileSync(this.configPath, JSON.stringify({ authenticated: false }, null, 2));
      }
    } catch {
      // Ignore
    }

    // Cleanup SDK resources
    if (this.session) {
      await this.session.destroy().catch(() => {});
      this.session = null;
    }
    if (this.copilotClient) {
      await this.copilotClient.stop().catch(() => {});
      this.copilotClient = null;
    }

    console.log(chalk.green('Signed out from GitHub Copilot'));
  }

  /**
   * Track usage of premium requests
   */
  private trackUsage(): void {
    if (!this.cachedUsage) {
      const tier = this.cachedConfig?.tier || 'pro';
      this.cachedUsage = {
        premiumRequestsUsed: 0,
        premiumRequestsLimit: COPILOT_TIERS[tier].premiumRequests,
        lastUpdated: new Date().toISOString()
      };
    }

    // Check if we should reset monthly usage
    const lastUpdated = new Date(this.cachedUsage.lastUpdated);
    const now = new Date();
    if (lastUpdated.getMonth() !== now.getMonth() || lastUpdated.getFullYear() !== now.getFullYear()) {
      this.cachedUsage.premiumRequestsUsed = 0;
    }

    this.cachedUsage.premiumRequestsUsed++;
    this.cachedUsage.lastUpdated = now.toISOString();
    this.saveUsage(this.cachedUsage);
  }

  /**
   * Convert messages to Copilot format
   */
  private formatMessages(messages: LLMMessage[]): { instructions?: string; prompt: string; history: any[] } {
    let instructions: string | undefined;
    const history: any[] = [];
    let lastUserMessage = '';

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      if (msg.role === 'system' && i === 0) {
        instructions = content;
      } else if (msg.role === 'user') {
        if (i === messages.length - 1) {
          lastUserMessage = content;
        } else {
          history.push({ role: 'user', content });
        }
      } else if (msg.role === 'assistant') {
        history.push({ role: 'assistant', content });
      }
    }

    return { instructions, prompt: lastUserMessage, history };
  }

  /**
   * Complete a chat request (non-streaming)
   */
  async complete(messages: LLMMessage[], options: LLMCompletionOptions = {}): Promise<LLMCompletionResponse> {
    await this.initializeClient();
    
    const model = options.model || this.config.get('copilot.model') || 'gpt-5';
    const session = await this.getSession(model);
    const { instructions, prompt, history } = this.formatMessages(messages);

    try {
      // Set system message if provided
      if (instructions) {
        // The SDK uses systemMessage in session config
        await session.destroy();
        this.session = await this.copilotClient.createSession({
          model,
          streaming: false,
          systemMessage: {
            mode: 'replace',
            content: instructions
          }
        });
      }

      // Add history messages
      for (const msg of history) {
        if (msg.role === 'user') {
          await this.session.send({ prompt: msg.content });
          // Wait for response
          await new Promise<void>((resolve) => {
            const unsub = this.session.on((event: any) => {
              if (event.type === 'session.idle') {
                unsub();
                resolve();
              }
            });
          });
        }
      }

      // Send final message and wait for response
      const response = await this.session.sendAndWait({ prompt });
      
      this.trackUsage();

      return {
        content: response?.data?.content || '',
        reasoning: response?.data?.reasoning,
        provider: this.name,
        model
      };
    } catch (error: any) {
      throw new Error(`Copilot completion failed: ${error.message}`);
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
    await this.initializeClient();
    
    const model = options.model || this.config.get('copilot.model') || 'gpt-5';
    const { instructions, prompt } = this.formatMessages(messages);

    try {
      // Create session with streaming enabled
      if (this.session) {
        await this.session.destroy().catch(() => {});
      }

      this.session = await this.copilotClient.createSession({
        model,
        streaming: true,
        ...(instructions ? {
          systemMessage: {
            mode: 'replace',
            content: instructions
          }
        } : {})
      });

      let fullContent = '';
      let fullReasoning = '';

      // Subscribe to events with a safety timeout
      let idleTimeout: NodeJS.Timeout | null = null;
      
      const done = new Promise<void>((resolve, reject) => {
        const clearAndResolve = () => {
          if (idleTimeout) clearTimeout(idleTimeout);
          resolve();
        };

        const clearAndReject = (err: Error) => {
          if (idleTimeout) clearTimeout(idleTimeout);
          reject(err);
        };

        idleTimeout = setTimeout(() => {
          if (fullContent.length > 0 || fullReasoning.length > 0) {
            console.log(chalk.gray('\n[Copilot stream heartbeat: timeout reached, but content received. Resolving.]'));
            clearAndResolve();
          } else {
            clearAndReject(new Error('Copilot stream timed out after 60s of inactivity'));
          }
        }, 60000);

        this.session.on((event: any) => {
          // Refresh timeout on any activity
          if (idleTimeout) {
            clearTimeout(idleTimeout);
            idleTimeout = setTimeout(() => clearAndResolve(), 45000); 
          }

          switch (event.type) {
            case 'assistant.message_delta':
              const delta = event.data.deltaContent || '';
              fullContent += delta;
              onChunk(delta);
              break;
            case 'assistant.reasoning_delta':
              fullReasoning += event.data.deltaContent || '';
              break;
            case 'session.idle':
              clearAndResolve();
              break;
            case 'session.error':
              clearAndReject(new Error(event.data.message || 'Session error'));
              break;
          }
        });
      });

      // Send the message
      await this.session.send({ prompt });
      await done;

      this.trackUsage();

      return {
        content: fullContent,
        reasoning: fullReasoning || undefined
      };
    } catch (error: any) {
      throw new Error(`Copilot streaming failed: ${error.message}`);
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.session) {
      await this.session.destroy().catch(() => {});
      this.session = null;
    }
    if (this.copilotClient) {
      await this.copilotClient.stop().catch(() => {});
      this.copilotClient = null;
    }
  }
}

export default CopilotService;
