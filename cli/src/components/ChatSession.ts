/**
 * Chat Session Component
 * ======================
 * Interactive chat session with the AgentForge agent.
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import autocomplete from 'inquirer-autocomplete-prompt';
import boxen from 'boxen';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import figures from 'figures';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import os from 'os';
import readline from 'readline';

import { BackendClient } from '../services/BackendClient';
import { AgentSkill, SessionManager, SessionStats } from '../services/SessionManager';
import { MCPClient } from '../services/MCPClient';
import { ProviderManager } from '../services/ProviderManager';
import { ForgeUI } from './ForgeUI';
import { tools, registerDynamicTool } from '../tools/index';
import { displayError, displayInfo, displaySuccess, clearLine, toolOutput } from '../utils/display';

// Blue pointer character for the prompt
const POINTER = chalk.cyan('›');
const POINTER_ACTIVE = chalk.blue('▶');

interface CommandDefinition {
  name: string;
  description: string;
  usage: string;
}

// Register autocomplete prompt
inquirer.registerPrompt('autocomplete', autocomplete);
// Remove the extra list pointer arrow from autocomplete choices
(figures as any).pointer = ' ';

// Configure marked for terminal output
marked.use(markedTerminal());

const SYSTEM_PROMPT = `You are AgentForge, a highly advanced autonomous Software Engineering agent. 
Your goal is to perform complex tasks within the user's workspace using a strict Test-Driven Development (TDD) approach.

ENVIRONMENT:
- Operating System: ${process.platform}
- Current Working Directory: {{CWD}}
- Workspace Root: {{ROOT}}
- Selected Folders: {{FOLDERS}}

CORE CAPABILITIES:
1. Contextual Awareness: You explore the environment deeply. Use \`list\` and \`glob\` frequently to discover project structure.
2. Code Implementation: You implement new features, fix bugs, and refactor code using surgical edits.
3. Environment Management: You can manage environments and install dependencies. All synchronous \`shell\` commands run in a single persistent terminal session, preserving current working directory and environment variables across calls. For long-running processes (like dev servers), use \`shell\` with \`isBackground: true\`. If you need to observe a long-running process in a real, visible terminal window for manual oversight, use \`spawn_terminal\`.
4. Toolsmithing: You can request new tools if your current set is insufficient.
5. Task Tracking: You maintain a project-wide TODO list in \`AGENT_TODO.md\`.
6. Web Research: You have access to unrestricted, world-class search tools (DuckDuckGo/Brave). Use \`search\` for general research and \`browse\` to extract content from specific URLs.
7. Specialized Knowledge: You can access MCP (Model Context Protocol) servers for up-to-date documentation and specialized skills. Use \`mcp\` to query servers like 'context7' (for library docs) and 'langchain' (for LangChain info).
8. Engineering Skills: Use the \`skill\` tool to discover and read expert engineering pattern libraries (e.g., 'openrouter-typescript-sdk', 'frontend-design').
9. Terminal Control: For background processes, use \`shell_output\` to check progress and \`shell_kill\` to stop them. If a command fails and you missed the output, use \`shell_output\` with \`last: true\`.
10. Tool Inventory: Use \`inventory\` to discover all available tools, including specialized toolkits (e.g., 'Virtual_Phone_Controller', 'Autonomous_Browser_Toolkit'). If you feel you are missing a capability, check the inventory first.
11. Hardware & Mobile Interface: You can control virtual and physical devices via the \`Virtual_Phone_Controller\` toolkit. This provides "vision" (extracting screenshots and dumping UI hierarchy XML), "fingertip" control (tapping/swiping/click-by-text), "typing" (injecting text), and "system relay" (low-level ADB shell access). Screenshots are provided to you as direct image inputs, allowing you to "see" exactly what is on the device screen.
12. Web Automation & Browser Control: You have full autonomous web browsing capabilities via the \`Autonomous_Browser_Toolkit\`. This provides browser management (launch/close), navigation, element interaction (click/type/hover), data extraction, screenshot capture for vision analysis, form automation, JavaScript execution, session persistence (cookies/localStorage), intelligent page analysis, and smart waiting strategies. Use these tools for web research, testing, data extraction, form filling, and complex multi-step web workflows.

TEST-DRIVEN DEVELOPMENT (TDD) MANDATE:
- ALWAYS write a test (via \`write\` or \`edit\`) for any new feature or fix BEFORE implementing it. 
- ALWAYS run the test (via \`shell\` or \`check\`) to see it fail, then implement the missing logic, then run the test again to see it pass.
- DO NOT report task completion until you have verified your changes with at least one automated test.
- Scaffold any project with tests from the start, regardless of the language or framework.

KNOWLEDGE ACQUISITION:
- **Up-to-date Docs**: When working with modern libraries (Next.js, Tailwind, MongoDB, etc.), ALWAYS check \`mcp\` action: "call" with server: "context7", toolName: "query-docs". It provides the latest API references and examples. (Example libraryIds: /vercel/next.js, /mongodb/docs).
- **Expert Patterns**: Before starting a specific domain task (e.g., UI building, API integration), check \`skill\` action: "list" and "read" the relevant skill. These are curated by experts to ensure top-tier code quality.
- **Mobile Vision & Control**: If a task requires interacting with a mobile app or device, immediately run \`inventory toolkit: "Virtual_Phone_Controller"\`. Use \`VisualInterface\` to "see" (screenshot/dump_hierarchy) and "act" (tap/swipe/tap_by_text) on the device. Dumping the hierarchy is often superior to screenshots for identifying button IDs and text segments. Use \`DeviceOrchestrator\` to manage its state.
- **Web Automation**: For web browsing, scraping, testing, or automation tasks, use the \`Autonomous_Browser_Toolkit\`. Start with BrowserController to launch a browser, then use Navigator for navigation, ElementInteractor for interactions, DataExtractor for content, VisionCapture for screenshots, FormAutomation for forms, PageAnalyzer for structure analysis, and WaitStrategy for dynamic content. The toolkit supports headless/headed modes, multiple tabs, session persistence, and JavaScript execution.
- **Toolkit Discovery**: If a task requires specific hardware or domain integration (e.g., "use the phone", "interact with the device", "browse the web"), ALWAYS run \`inventory\` to see if a specialized toolkit is already forged. Toolkits are collections of tools prefixed by their name (e.g., \`Virtual_Phone_Controller_...\`, \`Autonomous_Browser_Toolkit_...\`).
- **Exploration First**: Before acting, always \`list\` the root and key directories. Never assume the presence of a file.

PROJECT DISCIPLINE & EXPLORATION:
- You are an expert Software Engineer. You work across ALL languages and domains.
- **Systematic Progress**: Always call \`todo\` with \`action: "list"\` at the start of a session.
- **Elite Standards**: Consult \`.agentforge/knowledge/\` for implementation patterns (Design, TypeScript, Systems).
- **TOOL FAILURE RIGOR**: If a tool returns \`success: false\`, you MUST acknowledge the error explicitly. Do not ignore it or assume the operation succeeded anyway. If you are in the middle of a multi-step plan, stop and re-evaluate based on the error. PROCEEDING AS IF SUCCESSFUL WHEN A TOOL FAILED IS A CRITICAL VIOLATION.
- **No Daydreaming**: Do not hallucinate tool outputs. When a tool provides a screenshot or hierarchy, analyze it carefully before your next move. If a tool fails to provide vision, you CANNOT "see" the device.
- **Proactive Research**: Use the \`search\` tool at your own discretion to find best practices, library documentation, or solutions to complex errors. If the user provides a link, use \`browse\` to read it.
- Use Language Agent Tree Search (LATS) logic: Plan -> Act -> Observe -> Refine.

AVAILABLE TOOLS:
{{TOOLS}}

CODE OF CONDUCT:
- ALWAYS explore the environment before making assumptions.
- If a tool fails (e.g., File Not Found), use \`list\` or \`glob\` to find the correct path.
- ALWAYS verify your changes by reading the file back or running tests.
- Output your thoughts clearly before executing tools.

To use a tool, respond with a JSON block like this:
\`\`\`tool
{
  "name": "grep",
  "args": {
    "pattern": "function",
    "path": "./src"
  }
}
\`\`\`
Note: This backtick format is the ONLY supported tool-calling format. Do not use XML-like tags, Llama-interleaved markers, or any other hidden tokens.

To request a new tool or an entire TOOLKIT from the Toolsmith (user validation required):
\`\`\`forge-request
{
  "name": "tool_name_or_toolkit_name",
  "reason": "Vigorously justify why existing tools are insufficient and how this specific addition (or toolkit) solves it",
  "tools": [
    {
       "name": "logic_component_name",
       "purpose": "Specific functionality within the toolkit",
       "inputs": "Input descriptions",
       "outputs": "Output descriptions"
    }
  ]
}
\`\`\`
If you only need a single tool, you can just provide a single object in the \`tools\` array. The Toolsmith will create a dedicated folder for toolkits.
\`\`\``;

export class ChatSession {
  private config: any;
  private client: BackendClient;
  private sessionManager: SessionManager;
  private mcpClient: MCPClient;
  private providerManager: ProviderManager;
  private model: string;
  private sessionId: string;
  private stream: boolean;
  private messages: Array<{ role: string; content: string | any[] }> = [];
  private toolResults: any[];
  private running: boolean;
  private credits: number = 0;
  private currentModelInfo: any = null;
  private sessionCost: number = 0;
  private selectedFolders: string[] = [];
  private workingDirectory: string;
  private exitHandlerSet: boolean = false;
  private historyPath: string = join(os.homedir(), '.agentforge_history');
  private history: string[] = [];
  private toolQueue: Array<{ type: 'tool' | 'forge'; payload: any; raw: string }> = [];
  private toolQueueRunning: boolean = false;
  private toolQueueNeedsContinuation: boolean = false;
  private continuationScheduled: boolean = false;
  private fatalHandlerSet: boolean = false;
  private pendingContinuation: Promise<void> | null = null;
  private contextSummary: string | null = null;
  private compactingContext: boolean = false;
  private permittedTools: Set<string> = new Set();
  private pendingImage: string | null = null;
  private interrupted: boolean = false;

  constructor(options: any = {}) {
    this.config = options.config;
    this.client = new BackendClient(this.config);
    this.sessionManager = new SessionManager();
    this.mcpClient = new MCPClient();
    this.providerManager = new ProviderManager(this.config);
    
    // Get model from the active provider's config
    const activeProvider = this.providerManager.getActiveProviderType();
    this.model = options.model || this.config.get(`${activeProvider}.model`) || this.config.get('openrouter.model');
    this.sessionId = options.sessionId || this.generateSessionId();
    this.stream = options.stream !== false;
    
    this.toolResults = [];
    this.running = true;
    
    this.workingDirectory = process.cwd();
    this.loadHistory();
    
    this.sessionManager.syncLocalSkills();
    this.updateSystemPrompt();
    this.setupFatalHandlers();

    // Try to resume session if sessionId was provided
    if (options.sessionId) {
      this.resumeSession(options.sessionId);
    }
  }

  private setupFatalHandlers(): void {
    if (this.fatalHandlerSet) return;
    this.fatalHandlerSet = true;

    process.on('unhandledRejection', (reason: any) => {
      const message = reason?.message || String(reason);
      displayError('Unhandled promise rejection', message);
    });

    process.on('uncaughtException', (error: any) => {
      const message = error?.message || String(error);
      displayError('Unhandled exception', message);
    });
  }

  private loadHistory(): void {
    if (existsSync(this.historyPath)) {
      try {
        const content = readFileSync(this.historyPath, 'utf8');
        this.history = content.split('\n').filter(line => line.trim() !== '');
      } catch (e) {
        this.history = [];
      }
    }
  }

  private supportsVision(): boolean {
    // List of models known to support vision/multimodal inputs
    const visionModels = [
      'gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-4-vision',
      'claude-3', 'claude-3.5', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
      'gemini', 'gemini-pro-vision', 'gemini-1.5',
      'llava', 'qwen-vl', 'pixtral'
    ];
    
    const modelLower = this.model.toLowerCase();
    return visionModels.some(vm => modelLower.includes(vm));
  }

  private saveHistory(line: string): void {
    if (!line || line.trim() === '') return;
    try {
      // Remove duplicate if it exists to keep history clean
      const idx = this.history.indexOf(line);
      if (idx !== -1) {
        this.history.splice(idx, 1);
      }
      
      this.history.push(line);
      
      // Limit history size to 100 entries
      if (this.history.length > 100) {
        this.history.shift();
      }
      
      // Save full current history to file
      writeFileSync(this.historyPath, this.history.join('\n') + '\n');
    } catch (e) {
      // Ignore history save errors
    }
  }

  private updateSystemPrompt(): void {
    const folders = this.selectedFolders && this.selectedFolders.length > 0 
      ? this.selectedFolders.join(', ') 
      : 'All (None specifically selected)';
      
    // Build tools list dynamically
    const toolList = Object.keys(tools).map(name => {
      const tool = (tools as any)[name];
      const params = tool.parameters ? Object.keys(tool.parameters).join(', ') : '';
      return `- ${name}(${params}): ${tool.description}`;
    }).join('\n');

    const skillContent = this.sessionManager.getEnabledSkills()
      .filter(skill => skill.content && (skill.source === 'claude' || skill.source === 'copilot'))
      .map(skill => `### ${skill.name}\n${skill.content}`)
      .join('\n\n');

    const prompt = SYSTEM_PROMPT
      .replace('{{CWD}}', this.workingDirectory)
      .replace('{{ROOT}}', this.workingDirectory)
      .replace('{{FOLDERS}}', folders)
      .replace('{{TOOLS}}', toolList);

    const finalPrompt = skillContent
      ? `${prompt}\n\nLOCAL SKILLS:\n${skillContent}\n`
      : prompt;
    
    const summaryMessage = this.contextSummary
      ? { role: 'system', content: `Conversation summary (memory):\n${this.contextSummary}` }
      : null;

    if (this.messages && this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = finalPrompt;
      const nonSystem = this.messages.filter(m => m.role !== 'system');
      this.messages = [
        { role: 'system', content: finalPrompt },
        ...(summaryMessage ? [summaryMessage] : []),
        ...nonSystem
      ];
    } else {
      this.messages = [
        { role: 'system', content: finalPrompt },
        ...(summaryMessage ? [summaryMessage] : []),
        ...(this.messages || []).filter(m => m.role !== 'system')
      ];
    }
    
    this.sessionManager.addMessage('system', finalPrompt);
  }

  private async setupMCPServers(): Promise<void> {
    const mcpConfig = this.config.get('mcp');
    if (!mcpConfig || !mcpConfig.servers || !Array.isArray(mcpConfig.servers)) return;

    const spinner = ora(chalk.gray('Connecting to MCP servers...')).start();
    let connectedCount = 0;

    for (const server of mcpConfig.servers) {
      try {
        await this.mcpClient.connect(server.id, server.url, server.name);
        connectedCount++;
      } catch (err) {
        // Silently fail for individual servers, but log if verbose
        if (this.config.get('cli.verboseErrors')) {
          spinner.fail(`Failed to connect to MCP server ${server.name} (${server.id})`);
          spinner.start();
        }
      }
    }

    if (connectedCount > 0) {
      spinner.succeed(`Connected to ${connectedCount} MCP servers`);
    } else {
      spinner.stop();
    }
  }

  private resumeSession(sessionId: string): void {
    const session = this.sessionManager.loadSession(sessionId);
    if (session) {
      this.messages = session.messages.map(m => ({
        role: m.role,
        content: m.content
      }));
      const summaryMsg = session.messages.find(
        m => m.role === 'system' && 
             typeof m.content === 'string' && 
             m.content.startsWith('Conversation summary (memory):')
      );
      if (summaryMsg && typeof summaryMsg.content === 'string') {
        this.contextSummary = summaryMsg.content.replace(/^Conversation summary \(memory\):\n?/i, '').trim();
      }
      this.model = session.model;
      this.sessionCost = session.stats.totalCost;
      this.selectedFolders = session.selectedFolders || [];
      this.workingDirectory = session.workingDirectory || process.cwd();
      this.updateSystemPrompt();
      console.log(chalk.green(`✓ Resumed session: ${sessionId}`));
    }
  }
  
  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  
  async start(): Promise<void> {
    // Set up graceful exit handler
    this.setupExitHandler();
    
    await this.setupMCPServers();
    await this.loadCredits();
    
    // Create or load session
    const existingSession = this.sessionManager.getSession(this.sessionId);
    if (!existingSession) {
      this.sessionManager.createSession(this.sessionId, this.model);
      this.sessionManager.addMessage('system', SYSTEM_PROMPT);
    }
    
    // Display session info with provider
    const activeProvider = this.providerManager.getActiveProviderType();
    const providerDisplay = activeProvider === 'copilot' ? 'GitHub Copilot' : 'OpenRouter';
    
    console.log(boxen(
      chalk.cyan.bold('AgentForge') + '\n\n' +
      chalk.white('Session:  ') + chalk.gray(this.sessionId) + '\n' +
      chalk.white('Provider: ') + chalk.cyan(providerDisplay) + '\n' +
      chalk.white('Model:    ') + chalk.cyan(this.model) + '\n\n' +
      chalk.gray('Commands: /help   Exit: /exit   Interrupt: Ctrl+C (twice)')
    , { padding: 1, borderColor: 'cyan' }));
    
    while (this.running) {
      try {
        if (this.pendingContinuation) {
          await this.pendingContinuation;
        }
        
        // Ensure tool queue is finished before prompting for new input
        // to avoid stdin conflicts between readline and tool permission prompts
        while (this.toolQueueRunning || this.toolQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        await this.promptUser();
      } catch (err: any) {
        if (err.message === 'force-close') {
          this.running = false;
          break;
        }
        displayError('Main loop error', err.message);
        // Wait a second to avoid tight loops on persistent errors
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    await this.showExitStats();
  }

  private setupExitHandler(): void {
    if (this.exitHandlerSet) return;
    this.exitHandlerSet = true;

    let exitCount = 0;
    let lastExitTime = 0;

    const handleExit = async () => {
      const now = Date.now();
      
      // Reset count if more than 2 seconds have passed
      if (now - lastExitTime > 2000) {
        exitCount = 0;
      }
      
      exitCount++;
      lastExitTime = now;

      if (exitCount === 1) {
        console.log(chalk.yellow('\n\n⚠ Press Ctrl+C again to exit...'));
      } else if (exitCount >= 2) {
        this.running = false;
        await this.showExitStats();
        process.exit(0);
      }
    };

    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
  }

  private async showExitStats(): Promise<void> {
    const stats = this.sessionManager.endSession();
    if (stats) {
      console.log(this.sessionManager.formatStats(stats));
    } else {
      console.log(chalk.gray('\nSession ended.\n'));
    }
  }
  
  private async loadCredits(): Promise<void> {
    try {
      const keyInfo = await this.client.getAccountBalance();
      const limitRemaining = keyInfo.data?.limitRemaining;
      
      if (limitRemaining === null || limitRemaining === undefined) {
        this.credits = -1;
      } else {
        this.credits = limitRemaining;
      }
    } catch (error) {
      // Suppress warning - only log to debug if needed
      this.credits = 0;
    }
  }
  
  private getCommands(): CommandDefinition[] {
    return [
      { name: 'exit', description: 'Exit the session', usage: '/exit' },
      { name: 'quit', description: 'Quit the session', usage: '/quit' },
      { name: 'q', description: 'Quick exit', usage: '/q' },
      { name: 'help', description: 'Show help', usage: '/help' },
      { name: 'h', description: 'Quick help', usage: '/h' },
      { name: 'clear', description: 'Clear screen', usage: '/clear' },
      { name: 'c', description: 'Quick clear', usage: '/c' },
      { name: 'history', description: 'Show message history', usage: '/history' },
      { name: 'provider', description: 'Switch LLM provider (openrouter/copilot)', usage: '/provider [name]' },
      { name: 'model', description: 'Get/set model (persists)', usage: '/model [model_id]' },
      { name: 'config', description: 'View/update config', usage: '/config view' },
      { name: 'tools', description: 'List available tools', usage: '/tools' },
      { name: 'forge', description: 'Create a new tool', usage: '/forge <description>' },
      { name: 'session', description: 'Show session ID', usage: '/session' },
      { name: 'sessions', description: 'List/manage sessions', usage: '/sessions [list|resume|view|delete]' },
      { name: 'credits', description: 'Show account balance', usage: '/credits' },
      { name: 'cost', description: 'Show session cost', usage: '/cost' },
      { name: 'reasoning', description: 'Configure reasoning', usage: '/reasoning' },
      { name: 'folders', description: 'Select working folders', usage: '/folders' },
      { name: 'mcp', description: 'Manage MCP servers', usage: '/mcp [list|add|remove|connect]' },
      { name: 'skills', description: 'Manage agent skills', usage: '/skills [list|sync|add|remove|toggle]' },
      { name: 'stats', description: 'Show session statistics', usage: '/stats' },
      { name: 'swarm', description: 'Run swarm mode', usage: '/swarm <task>' },
      { name: 'cancel', description: 'Cancel current operation (ESC)', usage: '/cancel' },
      { name: 'interrupt', description: 'Interrupt agent response (ESC)', usage: '/interrupt' }
    ];
  }

  async promptUser(): Promise<void> {
    const commands = this.getCommands();
    try {
      // Get user input
      const input = await this.readlineWithAutocomplete(commands);
      const trimmed = (input ?? '').trim();
      
      if (!trimmed) return;
      
      // Save to history
      this.saveHistory(trimmed);
      
      // Handle commands
      if (trimmed.startsWith('/')) {
        // Special case for just "/" - show all commands
        if (trimmed === '/') {
          const { command }: any = await inquirer.prompt([
            {
              type: 'list',
              name: 'command',
              message: 'Select command:',
              pageSize: 15,
              choices: [
                ...commands.map(c => ({
                  name: `${chalk.green(c.usage.padEnd(25))} ${chalk.gray(c.description)}`,
                  value: c.usage.split(' ')[0]
                })),
                new inquirer.Separator(),
                { name: 'Cancel', value: null }
              ]
            }
          ]);
          if (command) {
            await this.handleCommand(command);
          }
        } else {
          await this.handleCommand(trimmed);
        }
        return;
      }
      
      // Check for cancel/interrupt
      if (this.interrupted) {
        this.interrupted = false;
        return;
      }
      
      // Regular message
      await this.sendMessage(trimmed);
    } catch (err: any) {
      if (err.isTtyError || err.message?.includes('User force closed')) {
        const stdin = process.stdin;
        const stdinClosed = !stdin || stdin.destroyed || !stdin.readable;
        displayError('Input interrupted', 'Prompt was closed; continuing...');
        if (stdinClosed) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        return;
      }
      // Don't throw, just continue - this prevents /config from crashing
      if (err.message?.includes('prompt')) {
        return;
      }
      console.error(chalk.red('Error:'), err.message);
    }
  }

  private async readlineWithAutocomplete(commands: any[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let historyIndex = -1;
      let tempInput = '';
      
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        historySize: 100,
        prompt: chalk.blue('▶ ')
      });

      // Pre-populate history
      const reverseHistory = [...this.history].reverse();
      (rl as any).history = reverseHistory;

      rl.prompt();

      // Handle line submission
      rl.on('line', (line: string) => {
        rl.close();
        resolve(line.trim());
      });

      // Handle Ctrl+C
      rl.on('SIGINT', () => {
        rl.close();
        resolve('');
      });

      // Handle errors
      rl.on('close', () => {
        // Already resolved in line handler
      });
    });
  }

  printInputBorder(position: 'top' | 'bottom'): void {
    const terminalWidth = process.stdout.columns || 80;
    const border = chalk.gray('─'.repeat(Math.max(0, terminalWidth - 2)));
    if (position === 'top') {
      console.log('\n' + border);
    } else {
      console.log(border + '\n');
    }
  }
  
  async handleCommand(command: string): Promise<void> {
    // Show available commands when just / is typed
    if (command === '/') {
      this.showHelp();
      return;
    }
    
    const [cmd, ...args] = command.slice(1).split(' ');
    
    try {
      switch (cmd.toLowerCase()) {
        case 'exit':
        case 'quit':
        case 'q':
          this.running = false;
          break;
          
        case 'help':
        case 'h':
          this.showHelp();
          break;
          
        case 'clear':
        case 'c':
          console.clear();
          break;
          
        case 'history':
          this.showHistory();
          break;
          
        case 'model':
          if (args.length > 0) {
            // Check if it's a custom model request
            if (args[0].toLowerCase() === 'custom') {
              await this.selectCustomModel();
            } else {
              const newModel = args.join(' ');
              this.model = newModel;
              this.config.set('openrouter.model', newModel);
              this.config.set('openrouter.provider', 'custom');
              this.config.setEnvVar('OPENROUTER_MODEL', newModel);
              console.log(chalk.green(`✓ Model set to ${chalk.cyan(newModel)} (saved)`));
            }
          } else {
            const currentModel = this.model || this.config.get('openrouter.model');
            const provider = this.config.get('openrouter.provider') || 'default';
            const visionSupport = this.supportsVision();
            console.log(`Current model: ${chalk.cyan(currentModel)}`);
            console.log(`Provider: ${chalk.cyan(provider)}`);
            console.log(`Vision support: ${visionSupport ? chalk.green('✓ Yes') : chalk.yellow('✗ No')}`);
            console.log(chalk.gray('Use /model <model_id> to change, or /model custom for provider selection'));
          }
          break;
          
        case 'config':
          await this.handleConfigCommand(args);
          break;
          
        case 'tools':
          this.showTools();
          break;
          
        case 'forge':
          await this.forgeNewTool(args.join(' '));
          break;
          
        case 'session':
          console.log(`Session ID: ${chalk.cyan(this.sessionId)}`);
          console.log(`Working Directory: ${chalk.cyan(this.workingDirectory)}`);
          if (this.selectedFolders.length > 0) {
            console.log(`Selected Folders: ${chalk.cyan(this.selectedFolders.join(', '))}`);
          }
          break;

        case 'sessions':
          await this.handleSessionsCommand(args);
          break;

        case 'credits':
          await this.showCredits();
          break;

        case 'cost':
          this.showSessionCost();
          break;

        case 'folders':
          await this.selectFolders();
          break;

        case 'mcp':
          await this.handleMCPCommand(args);
          break;

        case 'skills':
          await this.handleSkillsCommand(args);
          break;

        case 'stats':
          this.showStats();
          break;

        case 'reasoning':
          await this.configureReasoning();
          break;

        case 'swarm':
          await this.runSwarm(args.join(' '));
          break;

        case 'provider':
          await this.handleProviderCommand(args);
          break;

        case 'cancel':
        case 'interrupt':
          this.interrupted = true;
          console.log(chalk.yellow('Operation cancelled'));
          break;
          
        default:
          console.log(chalk.yellow(`Unknown command: ${cmd}`));
          console.log(chalk.gray('Type /help for available commands'));
      }
    } catch (error: any) {
      displayError(`Command failed: ${cmd}`, error.message);
    }
  }
  
  showHelp(): void {
    console.log(boxen(
      chalk.bold('Commands:\n\n') +
      chalk.cyan('Session & Navigation:\n') +
      '/exit, /q          Exit the session\n' +
      '/clear, /c         Clear screen\n' +
      '/history           Show message history\n' +
      '/session           Show current session info\n' +
      '/sessions          List/manage saved sessions\n' +
      '/folders           Select working directories\n\n' +
      chalk.cyan('Model & Config:\n') +
      '/model [id]        Get/set model (persists)\n' +
      '/model custom      Select provider & custom model\n' +
      '/config view       Show current configuration\n' +
      '/config set k v    Update a config value\n\n' +
      chalk.cyan('Provider:\n') +
      '/provider          Show/switch LLM provider\n' +
      '/provider copilot  Switch to GitHub Copilot\n' +
      '/provider openrouter Switch to OpenRouter\n\n' +
      chalk.cyan('Tools & Skills:\n') +
      '/tools             List available tools\n' +
      '/forge <desc>      Create a new tool\n' +
      '/skills            Manage agent skills (sync local skills)\n' +
      '/mcp               Manage MCP servers\n\n' +
      chalk.cyan('Cost & Credits:\n') +
      '/credits           Show account balance\n' +
      '/cost              Show session cost\n' +
      '/stats             Show session statistics\n\n' +
      chalk.cyan('Interrupts:\n') +
      'ESC                Cancel current input/operation\n' +
      '/cancel            Cancel current operation\n' +
      '/interrupt         Interrupt agent response\n\n' +
      '/swarm <task>      Run swarm mode\n' +
      '/help, /h          Show this help',
      { padding: 1, borderColor: 'blue', title: 'Help' }
    ));
  }
  
  showHistory(): void {
    console.log(chalk.bold('\nMessage History:\n'));
    
    for (const msg of this.messages.slice(1)) {
      const role = msg.role === 'user' ? chalk.cyan('You') : chalk.green('Agent');
      let content = '';
      if (Array.isArray(msg.content)) {
        const textPart = msg.content.find((p: any) => p.type === 'text');
        const hasImage = msg.content.some((p: any) => p.type === 'image_url');
        content = (textPart?.text || '') + (hasImage ? chalk.yellow(' [IMAGE ATTACHED]') : '');
      } else {
        content = msg.content;
      }
      
      const displayContent = content.slice(0, 100) + (content.length > 100 ? '...' : '');
      console.log(`${role}: ${displayContent}`);
    }
    console.log();
  }
  
  showTools(): void {
    console.log(chalk.bold('\nAvailable Tools:\n'));
    
    for (const [name, tool] of Object.entries(tools)) {
      console.log(`  ${chalk.cyan(name.padEnd(12))} ${(tool as any).description}`);
    }
    
    // Show MCP server tools
    const mcpServers = this.sessionManager.listMCPServers().filter(s => s.enabled);
    if (mcpServers.length > 0) {
      console.log(chalk.bold('\nMCP Server Tools:\n'));
      for (const server of mcpServers) {
        console.log(`  ${chalk.magenta(server.name.padEnd(12))} ${chalk.gray(server.url)}`);
      }
    }
    
    // Show enabled skills
    const skills = this.sessionManager.getEnabledSkills();
    if (skills.length > 0) {
      console.log(chalk.bold('\nEnabled Skills:\n'));
      for (const skill of skills) {
        console.log(`  ${chalk.yellow(skill.name.padEnd(12))} ${skill.description}`);
      }
    }
    
    console.log();
  }

  showConfig(): void {
    console.log(chalk.bold('\nConfiguration (including .env overrides):\n'));
    
    // Use this.config.get() to see active values including environment variables
    const apiKey = this.config.get('openrouter.apiKey');
    const model = this.config.get('openrouter.model');
    const backendUrl = this.config.get('backend.url') || this.config.get('backend_url');
    
    console.log(`${chalk.cyan('API Key:')}      ${apiKey ? chalk.gray('***' + (apiKey.slice(-4) || '')) : chalk.yellow('(not set)')}`);
    console.log(`${chalk.cyan('Model:')}        ${chalk.green(model)}`);
    console.log(`${chalk.cyan('Backend URL:')}  ${chalk.green(backendUrl)}`);
    console.log(`${chalk.cyan('Config Path:')}  ${chalk.gray(this.config.path)}`);
    console.log(`${chalk.cyan('Sessions Path:')} ${chalk.gray(this.sessionManager.path)}`);
    console.log();
  }

  private async handleConfigCommand(args: string[]): Promise<void> {
    if (!args[0] || args[0] === 'view' || args[0] === 'show') {
      this.showConfig();
    } else if (args[0] === 'set' && args[1]) {
      let key = args[1];
      const value = args.slice(2).join(' ');
      
      // Intelligent key mapping (allow setting OPENROUTER_API_KEY as openrouter.apiKey)
      if (key === 'OPENROUTER_API_KEY') key = 'openrouter.apiKey';
      if (key === 'OPENROUTER_MODEL') key = 'openrouter.model';
      if (key === 'OPENROUTER_TEMPERATURE') key = 'openrouter.temperature';
      if (key === 'OPENROUTER_MAX_TOKENS') key = 'openrouter.maxTokens';
      if (key === 'OPENROUTER_REASONING') key = 'openrouter.reasoning';
      if (key === 'AGENTFORGE_BACKEND_URL') key = 'backend.url';
      if (key === 'AGENTFORGE_BACKEND_TIMEOUT') key = 'backend.timeout';
      
      this.config.set(key, value);
      if (key === 'openrouter.model') this.config.setEnvVar('OPENROUTER_MODEL', value);
      if (key === 'openrouter.apiKey') this.config.setEnvVar('OPENROUTER_API_KEY', value);
      if (key === 'openrouter.temperature') this.config.setEnvVar('OPENROUTER_TEMPERATURE', value);
      if (key === 'openrouter.maxTokens') this.config.setEnvVar('OPENROUTER_MAX_TOKENS', value);
      if (key === 'backend.url') this.config.setEnvVar('AGENTFORGE_BACKEND_URL', value);
      if (key === 'backend.timeout') this.config.setEnvVar('AGENTFORGE_BACKEND_TIMEOUT', value);
      if (key === 'openrouter.reasoning') {
        try {
          const parsed = JSON.parse(value);
          this.config.set(key, parsed);
          this.config.setEnvVar('OPENROUTER_REASONING', JSON.stringify(parsed));
        } catch {
          this.config.setEnvVar('OPENROUTER_REASONING', value);
        }
      }
      console.log(chalk.green(`✓ ${key} updated`));
    } else {
      console.log(chalk.gray('Usage: /config view | /config set <key> <value>'));
    }
  }

  private async handleSessionsCommand(args: string[]): Promise<void> {
    const subCmd = args[0] || 'list';

    switch (subCmd) {
      case 'list':
        const sessions = this.sessionManager.listSessions(10);
        if (sessions.length === 0) {
          console.log(chalk.gray('\nNo sessions found.\n'));
          return;
        }
        console.log(chalk.bold('\nRecent Sessions:\n'));
        for (const session of sessions) {
          const isCurrent = session.id === this.sessionId;
          const indicator = isCurrent ? chalk.green('▶') : ' ';
          const date = new Date(session.updatedAt).toLocaleString();
          const cost = chalk.yellow(`$${session.stats.totalCost.toFixed(4)}`);
          const msgs = chalk.gray(`${session.stats.messagesCount} msgs`);
          console.log(`${indicator} ${chalk.cyan(session.id)} | ${date} | ${cost} | ${msgs}`);
        }
        console.log(chalk.gray('\nUse /sessions resume <id> to resume a session'));
        console.log();
        break;

      case 'resume':
        if (!args[1]) {
          console.log(chalk.yellow('Usage: /sessions resume <session_id>'));
          return;
        }
        const session = this.sessionManager.loadSession(args[1]);
        if (session) {
          this.sessionId = session.id;
          this.messages = session.messages.map(m => ({ role: m.role, content: m.content }));
          this.model = session.model;
          this.sessionCost = session.stats.totalCost;
          this.selectedFolders = session.selectedFolders || [];
          this.workingDirectory = session.workingDirectory || process.cwd();
          console.log(chalk.green(`✓ Resumed session: ${session.id}`));
          console.log(chalk.gray(`  Messages: ${session.stats.messagesCount}`));
          console.log(chalk.gray(`  Cost: $${session.stats.totalCost.toFixed(4)}`));
        } else {
          console.log(chalk.red(`Session not found: ${args[1]}`));
        }
        break;

      case 'view':
        if (!args[1]) {
          console.log(chalk.yellow('Usage: /sessions view <session_id>'));
          return;
        }
        const viewSession = this.sessionManager.getSession(args[1]);
        if (viewSession) {
          console.log(chalk.bold(`\nSession: ${viewSession.id}\n`));
          console.log(chalk.cyan('Model:    ') + viewSession.model);
          console.log(chalk.cyan('Created:  ') + new Date(viewSession.createdAt).toLocaleString());
          console.log(chalk.cyan('Updated:  ') + new Date(viewSession.updatedAt).toLocaleString());
          console.log(chalk.cyan('Messages: ') + viewSession.stats.messagesCount);
          console.log(chalk.cyan('Tokens:   ') + viewSession.stats.tokensUsed.toLocaleString());
          console.log(chalk.cyan('Cost:     ') + chalk.yellow(`$${viewSession.stats.totalCost.toFixed(6)}`));
          console.log(chalk.cyan('LOC:      ') + chalk.green(`+${viewSession.stats.linesAdded}`) + ' / ' + chalk.red(`-${viewSession.stats.linesRemoved}`));
          console.log();
        } else {
          console.log(chalk.red(`Session not found: ${args[1]}`));
        }
        break;

      case 'delete':
        if (!args[1]) {
          console.log(chalk.yellow('Usage: /sessions delete <session_id>'));
          return;
        }
        if (this.sessionManager.deleteSession(args[1])) {
          console.log(chalk.green(`✓ Deleted session: ${args[1]}`));
        } else {
          console.log(chalk.red(`Session not found: ${args[1]}`));
        }
        break;

      default:
        console.log(chalk.gray('Usage: /sessions [list|resume|view|delete] [session_id]'));
    }
  }

  private async handleMCPCommand(args: string[]): Promise<void> {
    const subCmd = args[0] || 'list';

    switch (subCmd) {
      case 'list':
        const servers = this.sessionManager.listMCPServers();
        if (servers.length === 0) {
          console.log(chalk.gray('\nNo MCP servers configured.\n'));
          console.log(chalk.gray('Use /mcp add <name> <url> to add a server'));
          return;
        }
        console.log(chalk.bold('\nMCP Servers:\n'));
        for (const server of servers) {
          const status = server.enabled ? chalk.green('enabled') : chalk.gray('disabled');
          const statusIcon = server.enabled ? chalk.green('●') : chalk.gray('○');
          console.log(`  ${statusIcon} ${chalk.cyan(server.name.padEnd(20))} ${chalk.gray(server.url)} [${status}]`);
          console.log(`    ${chalk.gray('ID: ' + server.id)}`);
        }
        console.log();
        break;

      case 'add':
        if (!args[1] || !args[2]) {
          console.log(chalk.yellow('Usage: /mcp add <name> <url>'));
          return;
        }
        const newServer = this.sessionManager.addMCPServer(args[1], args[2]);
        console.log(chalk.green(`✓ Added MCP server: ${newServer.name}`));
        console.log(chalk.gray(`  ID: ${newServer.id}`));
        console.log(chalk.gray(`  URL: ${newServer.url}`));
        break;

      case 'remove':
        if (!args[1]) {
          console.log(chalk.yellow('Usage: /mcp remove <server_id>'));
          return;
        }
        if (this.sessionManager.removeMCPServer(args[1])) {
          console.log(chalk.green(`✓ Removed MCP server: ${args[1]}`));
        } else {
          console.log(chalk.red(`Server not found: ${args[1]}`));
        }
        break;

      case 'toggle':
        if (!args[1]) {
          console.log(chalk.yellow('Usage: /mcp toggle <server_id>'));
          return;
        }
        const enabled = this.sessionManager.toggleMCPServer(args[1]);
        console.log(chalk.green(`✓ Server ${args[1]} is now ${enabled ? 'enabled' : 'disabled'}`));
        break;

      case 'connect':
        if (!args[1]) {
          console.log(chalk.yellow('Usage: /mcp connect <server_id>'));
          return;
        }
        const server = this.sessionManager.getMCPServer(args[1]);
        if (!server) {
          console.log(chalk.red(`Server not found: ${args[1]}`));
          return;
        }
        const spinner = ora({
          text: chalk.gray(`Connecting to ${server.name}...`),
          spinner: 'dots'
        }).start();
        try {
          const info = await this.mcpClient.connect(server.id, server.url, server.name);
          spinner.stop();
          console.log(chalk.green(`✓ Connected to ${info.name} v${info.version}`));
          console.log(chalk.gray(`  Capabilities: ${info.capabilities.length} tools`));
        } catch (error: any) {
          spinner.stop();
          console.log(chalk.red(`✗ Failed to connect: ${error.message}`));
        }
        break;

      default:
        console.log(chalk.gray('Usage: /mcp [list|add|remove|toggle|connect] [args]'));
    }
  }

  /**
   * Handle provider switching command
   */
  private async handleProviderCommand(args: string[]): Promise<void> {
    const subCmd = args[0]?.toLowerCase();

    // If no argument, show current provider and available options
    if (!subCmd) {
      const activeProvider = this.providerManager.getActiveProviderType();
      const providerDisplay = activeProvider === 'copilot' ? 'GitHub Copilot' : 'OpenRouter';
      
      console.log(chalk.bold('\nLLM Provider:\n'));
      console.log(`  Current: ${chalk.cyan(providerDisplay)}`);
      console.log('');
      console.log(chalk.gray('  Available providers:'));
      console.log(`    ${chalk.cyan('openrouter')}  - OpenRouter API (multiple models)`);
      console.log(`    ${chalk.cyan('copilot')}     - GitHub Copilot (Pro/Pro+ subscription)`);
      console.log('');
      console.log(chalk.gray('  Usage: /provider <name>'));
      console.log(chalk.gray('  Example: /provider copilot'));
      console.log('');
      return;
    }

    // Switch to specified provider
    if (subCmd === 'openrouter' || subCmd === 'or') {
      try {
        await this.providerManager.setActiveProvider('openrouter');
        this.model = this.config.get('openrouter.model') || 'openai/gpt-4o';
        console.log(chalk.green(`\n✓ Switched to OpenRouter`));
        console.log(`  Model: ${chalk.cyan(this.model)}`);
        console.log('');
      } catch (error: any) {
        displayError('Failed to switch provider', error.message);
      }
      return;
    }

    if (subCmd === 'copilot' || subCmd === 'github' || subCmd === 'gh') {
      try {
        // Check if Copilot is available/authenticated
        const copilotService = this.client.getCopilotService();
        
        if (!copilotService) {
          console.log(chalk.yellow('\n⚠ Copilot service not available'));
          console.log(chalk.gray('  Make sure @github/copilot-sdk is installed'));
          return;
        }

        const isAvailable = await copilotService.isAvailable();
        
        if (!isAvailable) {
          console.log(chalk.yellow('\n⚠ GitHub Copilot not authenticated'));
          console.log(chalk.gray('  Attempting to authenticate...\n'));
          
          const authSuccess = await copilotService.authenticate();
          
          if (!authSuccess) {
            console.log(chalk.red('\n✖ Authentication failed'));
            console.log(chalk.gray('  Make sure you have:'));
            console.log(chalk.gray('    1. GitHub CLI (gh) installed'));
            console.log(chalk.gray('    2. A GitHub Copilot Pro or Pro+ subscription'));
            return;
          }
        }

        await this.providerManager.setActiveProvider('copilot');
        this.model = this.config.get('copilot.model') || 'gpt-4o';
        
        console.log(chalk.green(`\n✓ Switched to GitHub Copilot`));
        console.log(`  Model: ${chalk.cyan(this.model)}`);
        
        // Show usage info
        const info = await copilotService.getInfo();
        if (info.usage) {
          console.log(`  Usage: ${chalk.cyan(`${info.usage.used}/${info.usage.limit}`)} requests this month`);
        }
        console.log('');
      } catch (error: any) {
        displayError('Failed to switch to Copilot', error.message);
      }
      return;
    }

    // Unknown provider
    console.log(chalk.yellow(`\n⚠ Unknown provider: ${subCmd}`));
    console.log(chalk.gray('  Available: openrouter, copilot'));
    console.log('');
  }

  private async handleSkillsCommand(args: string[]): Promise<void> {
    const subCmd = args[0] || 'list';

    switch (subCmd) {
      case 'list':
        const skills = this.sessionManager.listSkills();
        if (skills.length === 0) {
        console.log(chalk.gray('\nNo skills configured.\n'));
        console.log(chalk.gray('Use /skills add <name> <description> to add a skill'));
        console.log(chalk.gray('Use /skills sync to import local skills'));
        return;
        }
        console.log(chalk.bold('\nAgent Skills:\n'));
        for (const skill of skills) {
          const status = skill.enabled ? chalk.green('enabled') : chalk.gray('disabled');
          const statusIcon = skill.enabled ? chalk.green('●') : chalk.gray('○');
          const source = chalk.gray(`[${skill.source}]`);
          console.log(`  ${statusIcon} ${chalk.cyan(skill.name.padEnd(20))} ${skill.description} ${source} [${status}]`);
          console.log(`    ${chalk.gray('ID: ' + skill.id)}`);
        }
        console.log();
        break;

      case 'sync':
        const localSkills = this.sessionManager.syncLocalSkills();
        if (localSkills.length === 0) {
          console.log(chalk.gray('No local skills found in ~/.claude/skills or ~/.copilot/skills.'));
          return;
        }
        console.log(chalk.green(`✓ Synced ${localSkills.length} local skill(s)`));
        this.updateSystemPrompt();
        break;

      case 'add':
        if (!args[1] || !args[2]) {
          console.log(chalk.yellow('Usage: /skills add <name> <description>'));
          return;
        }
        const name = args[1];
        const description = args.slice(2).join(' ');
        const newSkill = this.sessionManager.addSkill({
          name,
          description,
          source: 'custom',
          enabled: true
        });
        console.log(chalk.green(`✓ Added skill: ${newSkill.name}`));
        console.log(chalk.gray(`  ID: ${newSkill.id}`));
        break;

      case 'remove':
        if (!args[1]) {
          console.log(chalk.yellow('Usage: /skills remove <skill_id>'));
          return;
        }
        if (this.sessionManager.removeSkill(args[1])) {
          console.log(chalk.green(`✓ Removed skill: ${args[1]}`));
        } else {
          console.log(chalk.red(`Skill not found: ${args[1]}`));
        }
        break;

      case 'toggle':
        if (!args[1]) {
          console.log(chalk.yellow('Usage: /skills toggle <skill_id>'));
          return;
        }
        const skillEnabled = this.sessionManager.toggleSkill(args[1]);
        console.log(chalk.green(`✓ Skill ${args[1]} is now ${skillEnabled ? 'enabled' : 'disabled'}`));
        break;

      default:
        console.log(chalk.gray('Usage: /skills [list|sync|add|remove|toggle] [args]'));
    }
  }

  private async selectFolders(): Promise<void> {
    console.log(chalk.bold('\nSelect Working Folders\n'));
    
    const currentDir = this.workingDirectory;
    const items = this.getDirectoryItems(currentDir);
    
    const choices = [
      { name: chalk.yellow('.. (parent directory)'), value: '..' },
      { name: chalk.green('✓ Select current directory'), value: '.' },
      new inquirer.Separator(),
      { name: chalk.gray('< Cancel'), value: 'cancel' },
      new inquirer.Separator(),
      ...items.map(item => ({
        name: item.isDir 
          ? chalk.cyan('📁 ' + item.name)
          : chalk.gray('   ' + item.name),
        value: item.path,
        disabled: !item.isDir
      }))
    ];

    try {
      const { selectedPath }: any = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedPath',
          message: `Current: ${chalk.cyan(currentDir)}`,
          choices,
          pageSize: 15
        }
      ]);

      if (selectedPath === 'cancel') {
        console.log(chalk.gray('\nFolder selection cancelled.'));
        return;
      } else if (selectedPath === '.') {
        // Add current directory to selected folders
        if (!this.selectedFolders.includes(currentDir)) {
          this.selectedFolders.push(currentDir);
          this.sessionManager.setSelectedFolders(this.selectedFolders);
          this.updateSystemPrompt();
          console.log(chalk.green(`✓ Added: ${currentDir}`));
        } else {
          console.log(chalk.yellow(`Already selected: ${currentDir}`));
        }
        
        // Show current selections and offer to continue
        if (this.selectedFolders.length > 0) {
          console.log(chalk.bold('\nSelected folders:'));
          this.selectedFolders.forEach(f => console.log(chalk.cyan(`  • ${f}`)));
        }
        
        const { continueSelecting }: any = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'continueSelecting',
            message: 'Select more folders?',
            default: false
          }
        ]);
        
        if (continueSelecting) {
          await this.selectFolders();
        }
      } else if (selectedPath === '..') {
        this.workingDirectory = resolve(currentDir, '..');
        this.sessionManager.setWorkingDirectory(this.workingDirectory);
        this.updateSystemPrompt();
        await this.selectFolders();
      } else {
        this.workingDirectory = selectedPath;
        this.sessionManager.setWorkingDirectory(this.workingDirectory);
        this.updateSystemPrompt();
        await this.selectFolders();
      }
    } catch (error: any) {
      if (error.isTtyError || error.message?.includes('User force closed')) {
        console.log(chalk.gray('\nFolder selection cancelled.'));
        return;
      }
      console.log(chalk.gray('\nFolder selection cancelled.'));
    }
  }

  private getDirectoryItems(dir: string): Array<{ name: string; path: string; isDir: boolean }> {
    try {
      const items = readdirSync(dir);
      return items
        .filter(item => !item.startsWith('.'))
        .map(item => {
          const fullPath = join(dir, item);
          let isDir = false;
          try {
            isDir = statSync(fullPath).isDirectory();
          } catch {
            // Skip items we can't stat
          }
          return { name: item, path: fullPath, isDir };
        })
        .sort((a, b) => {
          // Directories first, then alphabetical
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });
    } catch {
      return [];
    }
  }

  private showSessionCost(): void {
    const currentSession = this.sessionManager.getCurrentSession();
    if (currentSession) {
      console.log(chalk.bold('\nSession Cost Summary:\n'));
      console.log(chalk.cyan('Total Cost:       ') + chalk.yellow(`$${currentSession.stats.totalCost.toFixed(6)}`));
      console.log(chalk.cyan('Prompt Tokens:    ') + chalk.white(currentSession.stats.promptTokens.toLocaleString()));
      console.log(chalk.cyan('Completion Tokens:') + chalk.white(currentSession.stats.completionTokens.toLocaleString()));
      console.log(chalk.cyan('Total Tokens:     ') + chalk.white(currentSession.stats.tokensUsed.toLocaleString()));
      console.log();
    } else {
      console.log(chalk.gray('\nNo active session.\n'));
    }
  }

  private showStats(): void {
    const stats = this.sessionManager.getCurrentSession()?.stats;
    if (stats) {
      console.log(this.sessionManager.formatStats(stats));
    } else {
      console.log(chalk.gray('\nNo session statistics available.\n'));
    }
  }

  private async configureReasoning(): Promise<void> {
    const current = this.config.get('openrouter.reasoning') || { enabled: false };

    const { enabled }: any = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enabled',
        message: 'Enable reasoning?',
        default: !!current.enabled
      }
    ]);

    if (!enabled) {
      this.config.set('openrouter.reasoning', { enabled: false });
      console.log(chalk.green('✓ Reasoning disabled'));
      return;
    }

    const { mode }: any = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'Reasoning mode (optional)',
        choices: [
          { name: 'None (enable without options)', value: 'none' },
          { name: 'Effort (low/medium/high/xhigh)', value: 'effort' },
          { name: 'Reasoning tokens (explicit number)', value: 'tokens' }
        ]
      }
    ]);

    if (mode === 'none') {
      const reasoning = { enabled: true };
      this.config.set('openrouter.reasoning', reasoning);
      this.config.setEnvVar('OPENROUTER_REASONING', JSON.stringify(reasoning));
      console.log(chalk.green('✓ Reasoning enabled (no options)'));
      return;
    }

    if (mode === 'effort') {
      const { effort }: any = await inquirer.prompt([
        {
          type: 'list',
          name: 'effort',
          message: 'Reasoning effort',
          default: current.effort || 'medium',
          choices: ['low', 'medium', 'high', 'xhigh']
        }
      ]);
      const reasoning = { enabled: true, effort };
      this.config.set('openrouter.reasoning', reasoning);
      this.config.setEnvVar('OPENROUTER_REASONING', JSON.stringify(reasoning));
      console.log(chalk.green(`✓ Reasoning enabled (effort: ${effort})`));
      return;
    }

    const { reasoningTokens }: any = await inquirer.prompt([
      {
        type: 'number',
        name: 'reasoningTokens',
        message: 'Reasoning tokens',
        default: current.reasoning_tokens || 2048,
        validate: (v: number) => (v && v > 0 ? true : 'Enter a positive number')
      }
    ]);
    const reasoning = { enabled: true, reasoning_tokens: reasoningTokens };
    this.config.set('openrouter.reasoning', reasoning);
    this.config.setEnvVar('OPENROUTER_REASONING', JSON.stringify(reasoning));
    console.log(chalk.green(`✓ Reasoning enabled (tokens: ${reasoningTokens})`));
  }

  private stripToolBlocks(text: string): string {
    if (!text) return '';
    return text
      .replace(/```\s*(tool|forge-request)[\s\S]*?```/gi, '')
      .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, '')
      .replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/g, '')
      .replace(/<\|tool_calls_section_begin\|>/g, '')
      .replace(/<\|tool_calls_section_end\|>/g, '')
      .trim();
  }

  private consumeVisibleFromBuffer(buffer: string): { visible: string; remaining: string } {
    if (!buffer) return { visible: '', remaining: '' };

    let output = buffer;

    // Suppress Llama/Interleaved tool tags completely
    output = output.replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, '');
    output = output.replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/g, '');
    output = output.replace(/<\|tool_calls_section_begin\|>/g, '');
    output = output.replace(/<\|tool_calls_section_end\|>/g, '');

    // Existing backtick fence suppression logic
    let visibleResult = '';
    let i = 0;

    while (i < output.length) {
      const fenceIdx = output.indexOf('```', i);
      if (fenceIdx === -1) {
        visibleResult += output.slice(i);
        return { visible: visibleResult, remaining: '' };
      }

      visibleResult += output.slice(i, fenceIdx);
      const lineEnd = output.indexOf('\n', fenceIdx);
      if (lineEnd === -1) {
        return { visible: visibleResult, remaining: output.slice(fenceIdx) };
      }

      const fenceLine = output.slice(fenceIdx, lineEnd).trim();
      const isToolFence = /^```\s*(tool|forge-request)\s*$/i.test(fenceLine);

      if (!isToolFence) {
        visibleResult += output.slice(fenceIdx, lineEnd + 1);
        i = lineEnd + 1;
        continue;
      }

      const endIdx = output.indexOf('```', lineEnd + 1);
      if (endIdx === -1) {
        return { visible: visibleResult, remaining: output.slice(fenceIdx) };
      }

      i = endIdx + 3;
    }

    return { visible: visibleResult, remaining: '' };
  }

  private filterToolChunks(chunk: string, state: { inToolBlock: boolean; remainder: string }): string {
    let text = state.remainder + chunk;
    let output = '';

    const startFenceRegex = /```\s*(tool|forge-request)\b/i;

    while (text.length > 0) {
      if (state.inToolBlock) {
        const endIdx = text.indexOf('```');
        if (endIdx === -1) {
          state.remainder = text;
          return output;
        }
        text = text.slice(endIdx + 3);
        state.inToolBlock = false;
        continue;
      }

      const match = startFenceRegex.exec(text);
      if (!match) {
        output += text;
        state.remainder = '';
        return output;
      }

      const fenceIdx = match.index;
      output += text.slice(0, fenceIdx);

      const afterFence = text.slice(fenceIdx);
      const lineEnd = afterFence.indexOf('\n');
      if (lineEnd === -1) {
        state.remainder = afterFence;
        return output;
      }

      text = afterFence.slice(lineEnd + 1);
      state.inToolBlock = true;
    }

    state.remainder = '';
    return output;
  }

  private formatToolOutput(name: string, args: any, result: any): string {
    const data = result?.data || {};
    const target = args?.filePath || args?.path || args?.command || args?.pattern || '';
    let detail = '';

    if (name.startsWith('Autonomous_Browser_Toolkit_')) {
      const action = args?.action ? `action: ${args.action}` : '';
      const browserId = args?.browserId ? `browser: ${args.browserId}` : '';
      const tabId = args?.tabId ? `tab: ${args.tabId}` : '';
      const url = args?.url ? `url: ${args.url}` : '';
      detail = [action, browserId, tabId, url].filter(Boolean).join(' | ') || result?.summary || 'done';
    } else {
    switch (name) {
      case 'grep':
        detail = `matches: ${data.matches ?? 0}`;
        break;
      case 'glob':
        detail = `files: ${data.count ?? 0}`;
        break;
      case 'read':
        detail = `lines: ${data.start ?? '?'}-${data.end ?? '?'}`;
        break;
      case 'write':
      case 'edit':
        detail = `LOC: ${chalk.green(`+${data.added ?? 0}`)}/${chalk.red(`-${data.removed ?? 0}`)}`;
        break;
      case 'shell':
        detail = `exit: ${data.exitCode ?? 'n/a'} ${data.output ? `(${data.output})` : ''}`.trim();
        break;
      case 'env':
        detail = `${data.action ?? 'env'} ${data.type ?? ''}`.trim();
        break;
      case 'package':
        detail = `${data.action ?? 'package'} ${Array.isArray(data.packages) ? data.packages.length : 0} (${data.manager ?? ''})`.trim();
        break;
      default:
        detail = result?.summary || result?.toString?.() || 'done';
        break;
    }
    }

    const targetText = target ? chalk.gray(target) : chalk.gray('n/a');
    const status = result?.success ? chalk.green('✓') : chalk.red('✗');
    return `${status} ${chalk.cyan(name)} ${targetText} ${chalk.white(detail)}`;
  }

  private formatToolUsage(name: string): string {
    const tool = (tools as any)[name];
    if (!tool?.parameters) {
      return `Usage: ${name} <args>`;
    }

    const params = tool.parameters;
    const parts = Object.keys(params).map((key) => {
      const param = params[key];
      const required = param.required ? 'required' : 'optional';
      const def = param.default !== undefined ? `default=${param.default}` : '';
      const meta = [param.type, required, def].filter(Boolean).join(', ');
      return `${key}${meta ? ` (${meta})` : ''}`;
    });

    return `Usage: ${name} { ${parts.join('; ')} }`;
  }

  private toolSignature(payload: any): string {
    const stable = (value: any): any => {
      if (Array.isArray(value)) {
        return value.map(stable);
      }
      if (value && typeof value === 'object') {
        return Object.keys(value)
          .sort()
          .reduce<Record<string, any>>((acc, key) => {
            acc[key] = stable(value[key]);
            return acc;
          }, {});
      }
      return value;
    };

    try {
      return JSON.stringify(stable(payload));
    } catch {
      return '';
    }
  }

  private enqueueToolExecution(item: { type: 'tool' | 'forge'; payload: any; raw: string }): void {
    this.toolQueue.push(item);
    this.toolQueueNeedsContinuation = true;
    if (!this.toolQueueRunning) {
      void this.processToolQueue();
    }
  }

  private async processToolQueue(): Promise<void> {
    if (this.toolQueueRunning) return;
    this.toolQueueRunning = true;

    try {
      while (this.toolQueue.length > 0) {
        const item = this.toolQueue.shift();
        if (!item) break;

        try {
          if (item.type === 'tool') {
            await this.executeTool(item.payload);
          } else {
            await this.handleForgeRequest(item.payload);
          }
        } catch (error: any) {
          displayError('Tool execution failed', error.message);
        }
      }

      const shouldContinue = this.toolQueueNeedsContinuation && !this.continuationScheduled && this.running;
      
      if (shouldContinue) {
        this.continuationScheduled = true;
        this.toolQueueNeedsContinuation = false;
        
        // Brief pause before continuation to allow UI to settle
        await new Promise(resolve => setTimeout(resolve, 300));

        this.pendingContinuation = (async () => {
          try {
            await this.sendMessage('');
          } catch (err: any) {
            displayError('Continuation failed', err.message);
          } finally {
            this.continuationScheduled = false;
            this.pendingContinuation = null;
          }
        })();
        
        await this.pendingContinuation;
      }
    } catch (fatalError: any) {
      displayError('Tool queue processor fatal error', fatalError.message || 'Unknown error');
    } finally {
      this.toolQueueRunning = false;
      
      // If more tools were enqueued during continuation, process them
      if (this.toolQueue.length > 0 && this.running) {
        void this.processToolQueue();
      }
    }
  }

  private extractToolBlocksFromBuffer(
    buffer: string,
    executed: Set<string>
  ): { remaining: string; consumed: boolean } {
    let text = buffer;
    let consumed = false;

    // Support for multiple tool block formats
    // 1. Standard Markdown: ```tool { ... } ```
    // 2. Llama Interleaved: <|tool_call_begin|> functions.name:id <|tool_call_argument_begin|> {args} <|tool_call_end|>

    // Markdown Format
    const markdownRegex = /```\s*(tool|forge-request)\b/i;
    while (true) {
      const match = markdownRegex.exec(text);
      if (!match) break;

      const startIdx = match.index;
      const afterStart = text.slice(startIdx);
      const lineEnd = afterStart.indexOf('\n');
      if (lineEnd === -1) break;

      const blockType = match[1].toLowerCase();
      const contentStart = startIdx + lineEnd + 1;
      const endIdx = text.indexOf('```', contentStart);
      if (endIdx === -1) break;

      const raw = text.slice(contentStart, endIdx).trim();
      if (raw) {
        try {
          const payload = JSON.parse(raw);
          const signature = this.toolSignature(payload);
          if (signature && !executed.has(signature)) {
            executed.add(signature);
            this.enqueueToolExecution({ type: blockType === 'tool' ? 'tool' : 'forge', payload, raw });
          }
        } catch (error: any) {}
      }
      text = text.slice(endIdx + 3);
      consumed = true;
    }

    // Llama Interleaved Format
    const llamaRegex = /<\|tool_call_begin\|>\s*functions\.([^:]+):[^\s]*\s*<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/g;
    let llamaMatch;
    while ((llamaMatch = llamaRegex.exec(text)) !== null) {
      const name = llamaMatch[1];
      const argsRaw = llamaMatch[2].trim();
      try {
        const args = JSON.parse(argsRaw);
        const payload = { name, args };
        const signature = this.toolSignature(payload);
        if (signature && !executed.has(signature)) {
          executed.add(signature);
          this.enqueueToolExecution({ type: 'tool', payload, raw: llamaMatch[0] });
        }
      } catch (error: any) {}
      consumed = true;
    }

    // Clean up if the buffer gets way too huge without finding anything
    if (text.length > 8000 && !consumed) {
      return { remaining: text.slice(-2000), consumed: false };
    }

    return { remaining: text, consumed };
  }

  private getCompactionConfig(): {
    enabled: boolean;
    maxMessages: number;
    keepLast: number;
    summaryModel?: string;
    summaryMaxTokens: number;
  } {
    const cfg = this.config.get('openrouter.contextCompaction') || {};
    const enabled = cfg.enabled !== false;
    const maxMessages = Number(cfg.maxMessages ?? 80);
    const keepLast = Number(cfg.keepLast ?? 20);
    const summaryModel = typeof cfg.summaryModel === 'string' && cfg.summaryModel.trim()
      ? cfg.summaryModel.trim()
      : undefined;
    const summaryMaxTokens = Number(cfg.summaryMaxTokens ?? 800);

    return {
      enabled,
      maxMessages: Math.max(10, maxMessages),
      keepLast: Math.max(5, keepLast),
      summaryModel,
      summaryMaxTokens: Math.max(128, summaryMaxTokens)
    };
  }

  private formatMessagesForSummary(messages: Array<{ role: string; content: string | any[] }>): string {
    return messages
      .map((m, i) => {
        let text = '';
        if (Array.isArray(m.content)) {
          text = m.content
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('\n');
          if (m.content.some((p: any) => p.type === 'image_url')) {
            text += '\n[IMAGE ATTACHED]';
          }
        } else {
          text = m.content;
        }
        return `[#${i + 1} ${m.role.toUpperCase()}]\n${text}`;
      })
      .join('\n\n');
  }

  private async maybeCompactContext(): Promise<void> {
    if (this.compactingContext) return;

    const cfg = this.getCompactionConfig();
    if (!cfg.enabled) return;

    const nonSystem = this.messages.filter(m => m.role !== 'system');
    if (nonSystem.length <= cfg.maxMessages) return;

    const keepLast = Math.min(cfg.keepLast, nonSystem.length);
    const toSummarize = nonSystem.slice(0, Math.max(0, nonSystem.length - keepLast));
    if (toSummarize.length === 0) return;

    const summaryInput = this.formatMessagesForSummary(toSummarize);
    const summaryPrompt = `You are a context compaction engine. Summarize the conversation so far into a compact, durable memory for future steps.\n\nRequirements:\n- Capture decisions, constraints, progress, and open tasks.\n- Preserve file paths, APIs, commands, and tool results.\n- Keep it concise but complete.\n- Use bullet points and short sections.\n`;

    const previousSummary = this.contextSummary
      ? `Existing summary:\n${this.contextSummary}\n\n`
      : '';

    this.compactingContext = true;
    try {
      const result: any = await this.client.openRouterComplete([
        { role: 'system', content: summaryPrompt },
        { role: 'user', content: `${previousSummary}New messages:\n${summaryInput}` }
      ], {
        model: cfg.summaryModel || this.model,
        temperature: 0.2,
        maxTokens: cfg.summaryMaxTokens
      });

      const summary = result?.choices?.[0]?.message?.content?.trim();
      if (!summary) return;

      this.contextSummary = summary;

      const baseSystem = this.messages.find(m => m.role === 'system') || { role: 'system', content: '' };
      const kept = nonSystem.slice(-keepLast);
      this.messages = [
        { role: 'system', content: baseSystem.content },
        { role: 'system', content: `Conversation summary (memory):\n${summary}` },
        ...kept
      ];

      this.sessionManager.addMessage('system', `Conversation summary (memory):\n${summary}`);
    } catch (error: any) {
      displayError('Context compaction failed', error.message);
    } finally {
      this.compactingContext = false;
    }
  }
  
  async sendMessage(content: string): Promise<void> {
    if (content) {
      // Create message with current multimodal state using standard OpenAI format
      const userMsg: any = {
        role: 'user',
        content: this.pendingImage 
          ? [
              { type: 'text', text: content },
              { 
                type: 'image_url', 
                image_url: { url: this.pendingImage }
              }
            ]
          : content
      };

      this.messages.push(userMsg);
      this.sessionManager.addMessage('user', userMsg.content);
      
      // Clear pending image after use
      this.pendingImage = null;
    }
    
    await this.maybeCompactContext();
    
    try {
      // Show thinking indicator
      const spinner = ora({
        text: chalk.gray('Thinking...'),
        spinner: 'dots'
      }).start();
      
      let response: any;
      let usageData: any = null;
      
      const executedToolBlocks = new Set<string>();

      if (this.stream) {
        let buffer = '';
        const streamState = { rawBuffer: '' };
        spinner.stop();
        process.stdout.write('\n' + chalk.green('Agent: '));
        
        const reasoningConfig = this.config.get('openrouter.reasoning');
        const reasoningOptions = reasoningConfig?.enabled ? { reasoning: reasoningConfig } : {};

        let result: any;
        try {
          result = await this.client.streamOpenRouter(
            this.messages,
            (chunk: string) => {
              buffer += chunk;
              streamState.rawBuffer += chunk;
              const extracted = this.extractToolBlocksFromBuffer(streamState.rawBuffer, executedToolBlocks);
              streamState.rawBuffer = extracted.remaining;
              const { visible, remaining } = this.consumeVisibleFromBuffer(buffer);
              if (visible) {
                process.stdout.write(visible);
              }
              buffer = remaining;
            },
            { model: this.model, includeReasoningInContent: true, ...reasoningOptions }
          );
        } catch (error: any) {
          spinner.stop();
          
          // Detect validation errors (Zod, OpenRouter side, etc.)
          const isValidationError = /validation|input|role|content|invalid/i.test(error.message);
          
          if (isValidationError) {
            console.log(chalk.yellow('\n  ⚠ Multi-modal input error. Retrying with text-only...'));
            
            // Clean ALL messages in the current session state to ensure they stay clean
            this.messages = this.messages.map(m => {
              if (Array.isArray(m.content)) {
                return {
                  ...m,
                  content: m.content
                    .filter((p: any) => p.type === 'text')
                    .map((p: any) => p.text)
                    .join('\n')
                };
              }
              return m;
            });
            
            spinner.start(chalk.gray('Retrying (text-only)...'));
            
            result = await this.client.streamOpenRouter(
              this.messages,
              (chunk: string) => {
                buffer += chunk;
                streamState.rawBuffer += chunk;
                const extracted = this.extractToolBlocksFromBuffer(streamState.rawBuffer, executedToolBlocks);
                streamState.rawBuffer = extracted.remaining;
                const { visible, remaining } = this.consumeVisibleFromBuffer(buffer);
                if (visible) {
                   process.stdout.write(visible);
                }
                buffer = remaining;
              },
              { model: this.model, ...reasoningOptions }
            );
            spinner.stop();
          } else {
            displayError('Agent response error', error.message);
            throw error;
          }
        }
        
        response = result.content;
        usageData = result.usage;
        process.stdout.write('\n');

        const displayResponse = this.stripToolBlocks(response || '');
        const hadToolBlocks = executedToolBlocks.size > 0;
        if (!displayResponse || displayResponse.trim().length === 0) {
          if (!hadToolBlocks) {
            console.log(chalk.gray('[No response returned]') + '\n');
          }
        }
        
        // Update costs from actual usage if returned, otherwise estimate
        if (usageData) {
          const promptTokens = usageData.input_tokens || usageData.prompt_tokens || usageData.tokens_prompt || 0;
          const completionTokens = usageData.output_tokens || usageData.completion_tokens || usageData.tokens_completion || 0;
          const apiCost = usageData.cost || usageData.total_cost || usageData.usage;
          
          if (typeof apiCost === 'number') {
             this.sessionCost += apiCost;
             this.sessionManager.addCost(apiCost);
          }
          
          this.updateCostFromResponse(promptTokens, completionTokens, typeof apiCost === 'number' ? apiCost : undefined);
        } else {
          const estimatedTokens = Math.ceil((response || '').length / 4);
          this.updateCostFromResponse(0, estimatedTokens);
        }
      } else {
        const reasoningConfig = this.config.get('openrouter.reasoning');
        const reasoningOptions = reasoningConfig?.enabled ? { reasoning: reasoningConfig } : {};

        let result: any;
        try {
          result = await this.client.openRouterComplete(this.messages, {
            model: this.model,
            ...reasoningOptions
          });
        } catch (error: any) {
          spinner.stop();
          
          const isValidationError = /validation|input|role|content|invalid/i.test(error.message);
          
          if (isValidationError) {
            console.log(chalk.yellow('\n  ⚠ Multi-modal input error. Retrying with text-only...'));
            
            this.messages = this.messages.map(m => {
              if (Array.isArray(m.content)) {
                return {
                  ...m,
                  content: m.content
                    .filter((p: any) => p.type === 'text')
                    .map((p: any) => p.text)
                    .join('\n')
                };
              }
              return m;
            });
            
            spinner.start(chalk.gray('Retrying (text-only)...'));
            result = await this.client.openRouterComplete(this.messages, {
              model: this.model,
              ...reasoningOptions
            });
            spinner.stop();
          } else {
            displayError('Agent response error', error.message);
            throw error;
          }
        }
        
        spinner.stop();
        response = result.choices?.[0]?.message?.content || '';
        usageData = result.usage;
        
        if (response) {
          const rendered = marked.parse(this.stripToolBlocks(response)) as string;
          console.log(chalk.green('Agent: '));
          console.log(rendered + '\n');
        } else {
          const hasToolBlocks = /```\s*(tool|forge-request)[\s\S]*?```/i.test(response || '');
          if (!hasToolBlocks) {
            console.log(chalk.gray('[No response returned]') + '\n');
          }
        }
        
        // Update costs with actual usage data
        if (usageData) {
          const promptTokens = usageData.input_tokens || usageData.prompt_tokens || usageData.tokens_prompt || 0;
          const completionTokens = usageData.output_tokens || usageData.completion_tokens || usageData.tokens_completion || 0;
          const apiCost = usageData.cost || usageData.total_cost || usageData.usage;
          
          if (typeof apiCost === 'number') {
            this.sessionCost += apiCost;
            this.sessionManager.addCost(apiCost);
          }
          
          this.updateCostFromResponse(promptTokens, completionTokens, typeof apiCost === 'number' ? apiCost : undefined);
        } else {
          // Fallback if SDK doesn't return usage
          const inputEstimated = Math.ceil(content.length / 4);
          const outputEstimated = Math.ceil((response || '').length / 4);
          this.updateCostFromResponse(inputEstimated, outputEstimated);
        }
      }
      
      this.messages.push({ role: 'assistant', content: response });
      this.sessionManager.addMessage('assistant', response);
      
      // Process any tool calls in the response
      try {
        await this.processToolCalls(response, executedToolBlocks);
      } catch (toolProcError: any) {
        displayError('Tool processing error', toolProcError.message);
      }
      
    } catch (error: any) {
      console.log(chalk.red(`\n✖ Agent Error: ${error.message}`));
      if (this.config.get('cli.verboseErrors')) {
        console.log(chalk.gray(error.stack));
      }
    }
  }

  private updateCostFromResponse(promptTokens: number, completionTokens: number, actualCost?: number): void {
    // Always update token counts
    this.sessionManager.addTokens(promptTokens, completionTokens);
    
    // If actual cost was already handled by the caller, we're done
    if (actualCost !== undefined) {
      return;
    }

    // Otherwise calculate estimated cost based on fallback pricing
    const pricing = this.currentModelInfo?.pricing || {
      prompt: '0.000001',
      completion: '0.000002'
    };

    let promptPrice = parseFloat(pricing.prompt);
    if (isNaN(promptPrice)) promptPrice = 0.000001;
    
    let completionPrice = parseFloat(pricing.completion);
    if (isNaN(completionPrice)) completionPrice = 0.000002;

    const cost = (promptTokens * promptPrice) + (completionTokens * completionPrice);
    
    this.sessionCost += cost;
    this.sessionManager.addCost(cost);
  }
  
  async processToolCalls(response: string, executed?: Set<string>): Promise<void> {
    // Standard Markdown tool blocks
    const toolPattern = /```\s*tool\s*[\r\n]+([\s\S]*?)[\r\n]+```/gi;
    const forgeRequestPattern = /```\s*forge-request\s*[\r\n]+([\s\S]*?)[\r\n]+```/gi;
    
    // Llama interleaved tool calls
    const llamaPattern = /<\|tool_call_begin\|>\s*functions\.([^:]+):[^\s]*\s*<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/gi;

    let match: RegExpExecArray | null;
    
    // Process markdown tool calls
    while ((match = toolPattern.exec(response)) !== null) {
      try {
        const raw = match[1].trim();
        const toolCall = JSON.parse(raw);
        const signature = this.toolSignature(toolCall);
        if (executed && signature && executed.has(signature)) continue;
        if (executed && signature) executed.add(signature);
        this.enqueueToolExecution({ type: 'tool', payload: toolCall, raw });
      } catch (e: any) {}
    }

    // Process Llama tool calls
    while ((match = llamaPattern.exec(response)) !== null) {
      try {
        const name = match[1];
        const argsRaw = match[2].trim();
        const args = JSON.parse(argsRaw);
        const toolCall = { name, args };
        const signature = this.toolSignature(toolCall);
        if (executed && signature && executed.has(signature)) continue;
        if (executed && signature) executed.add(signature);
        this.enqueueToolExecution({ type: 'tool', payload: toolCall, raw: match[0] });
      } catch (e: any) {}
    }
    
    // Process forge requests with user approval
    while ((match = forgeRequestPattern.exec(response)) !== null) {
      try {
        const raw = match[1].trim();
        const forgeRequest = JSON.parse(raw);
        const signature = this.toolSignature(forgeRequest);
        if (executed && signature && executed.has(signature)) {
          continue;
        }
        if (executed && signature) {
          executed.add(signature);
        }
        this.enqueueToolExecution({ type: 'forge', payload: forgeRequest, raw });
      } catch (e: any) {
        // Silently ignore parsing errors
      }
    }
  }
  
  async executeTool(toolCall: any): Promise<void> {
    const { name, args } = toolCall;
    const tool = (tools as any)[name];
    
    if (!tool) {
      displayError(`Unknown tool: ${name}`);
      return;
    }

    // Permission check
    if (!this.permittedTools.has(name)) {
      console.log('\n' + chalk.yellow('━'.repeat(60)));
      console.log(chalk.yellow.bold('🛡️  Tool Execution Permission Request'));
      console.log(chalk.yellow('━'.repeat(60)));
      console.log(`${chalk.cyan('Tool:')} ${chalk.bold(name)}`);
      
      const argsStr = JSON.stringify(args, (k, v) => {
        if (typeof v === 'string' && v.length > 500) return v.slice(0, 500) + '... (truncated)';
        return v;
      }, 2);
      
      console.log(`${chalk.cyan('Args:')} ${chalk.gray(argsStr.replace(/\n/g, '\n      '))}`);
      console.log(chalk.yellow('━'.repeat(60)) + '\n');

      const answer: any = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: `Allow ${chalk.bold(name)} to run?`,
          choices: [
            { name: chalk.green('✓ yes, use this tool'), value: 'yes' },
            { name: chalk.blue('∞ yes, use this tool and remember for the rest of the session'), value: 'always' },
            { name: chalk.red('✗ no, and steer agentforge to guide it towards something else'), value: 'no' }
          ]
        }
      ]);

      if (answer.action === 'always') {
        this.permittedTools.add(name);
      } else if (answer.action === 'no') {
        const steering: any = await inquirer.prompt([
          {
            type: 'input',
            name: 'guidance',
            message: chalk.yellow('Provide steering guidance:'),
            validate: (input: string) => input.trim().length > 0 || 'Please provide instructions to the agent'
          }
        ]);

        console.log(chalk.yellow(`\n⚠ Execution of ${name} declined. Notifying agent with guidance...\n`));
        this.messages.push({
          role: 'user',
          content: `[User declined execution of tool "${name}". Guidance: ${steering.guidance}]`
        });
        return;
      }
    }
    
    try {
      // Execute the tool with retries
      let result: any;
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          switch (name) {
            case 'grep':
              result = await tool.execute(args.pattern, args);
              break;
            case 'glob':
              result = await tool.execute(args.pattern, args);
              break;
            case 'read':
              result = await tool.execute(args.filePath, args);
              break;
            case 'write':
              result = await tool.execute(args.filePath, args.content, args);
              // Track LOC changes for write operations
              if (result.data) {
                this.sessionManager.updateLOCStats(
                  result.data.added || 0,
                  result.data.removed || 0
                );
              }
              break;
            case 'edit':
              result = await tool.execute(args.filePath, args.oldContent, args.newContent, args);
              // Track LOC changes for edit operations
              if (result.data) {
                this.sessionManager.updateLOCStats(
                  result.data.added || 0,
                  result.data.removed || 0
                );
              }
              break;
            case 'shell':
              result = await tool.execute(args.command, args);
              break;
            case 'shell_kill':
              result = await tool.execute(args.procId);
              break;
            case 'shell_output':
              result = await tool.execute(args);
              break;
            case 'inventory':
              result = await tool.execute(args);
              break;
            case 'env':
              result = await tool.execute(args.action, args.envPath, args);
              break;
            case 'package':
              result = await tool.execute(args.action, args.packages, args);
              break;
            case 'list':
              result = await tool.execute(args.path, args);
              break;
            case 'web':
              result = await tool.execute(args.url, args);
              break;
            case 'search':
              result = await tool.execute(args.query, args);
              break;
            case 'browse':
              result = await tool.execute(args.url, args);
              break;
            case 'todo':
              result = await tool.execute(args.action, args);
              break;
            case 'check':
              result = await tool.execute(args.path, args);
              break;
            case 'mcp':
              result = await tool.execute(args.action, args, this.mcpClient);
              break;
            case 'skill':
              result = await tool.execute(args.action, { ...args, paths: this.config.get('skills.paths') });
              break;
            case 'forge-audit':
              const forge = new ForgeUI({ config: this.config });
              await forge.audit();
              result = { success: true, summary: "Toolset audit and improvement session completed." };
              break;
            default:
              // For tools not in the switch, check if they are forged, toolkit-based, or modern.
              // Most forged tools and newer tools take a single object.
              const source = (tool as any).source || '';
              if (source === 'forged' || source === 'forged-core' || source.includes('_') || name === 'git' || name === 'test' || name === 'refactor') {
                result = await tool.execute(args);
              } else {
                // Legacy fallback: try to find a primary argument based on common names
                const primaryKey = Object.keys(args).find(k => /path|file|url|pattern|id|cmd|command/i.test(k));
                if (primaryKey) {
                  result = await tool.execute(args[primaryKey], args);
                } else {
                  result = await tool.execute(args);
                }
              }
          }

          if (result && result.success === false && attempt < maxRetries) {
            const delayMs = 500 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }

          break;
        } catch (error: any) {
          if (attempt < maxRetries) {
            const delayMs = 500 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          throw error;
        }
      }
      
      // Display minimal result (tool name, target, result)
      console.log('  ' + this.formatToolOutput(name, args, result));
      
      // Track tool execution
      this.sessionManager.incrementToolCount();
      
      // Store result for context
      this.toolResults.push({
        tool: name,
        args,
        result: result.data
      });
      
      // Add tool result to conversation for context
      if (result && result.success === true) {
        let textContent = `[Tool ${name} succeeded: ${result.summary}]`;
        
        // Include output data if available and not too large
        if (result.data) {
          const normalizedData = { ...result.data };
          
          // Remove potential heavy data from text dump to avoid token waste
          // since we'll handle screenshot specifically for vision
          if (normalizedData.screenshot) delete normalizedData.screenshot;
          
          const dataStr = JSON.stringify(normalizedData, null, 2);
          const limit = (name === 'inventory' || name === 'mcp' || name === 'skill') ? 30000 : 15000;
          
          if (dataStr.length < limit) {
            textContent += `\nOutput:\n${dataStr}`;
          } else {
            textContent += `\nOutput:\n${dataStr.slice(0, limit)}... (truncated)`;
          }
        }
        
        // Multi-modal message construction with vision capability detection
        if (result.data && result.data.screenshot) {
          const imageUrl = `data:image/png;base64,${result.data.screenshot}`;
          
          if (this.supportsVision()) {
            // Model supports vision - attach image
            this.messages.push({
              role: 'user',
              content: [
                { type: 'text', text: textContent },
                { 
                  type: 'image_url', 
                  image_url: { url: imageUrl }
                }
              ]
            } as any);
          } else {
            // Model doesn't support vision - text only with note
            this.messages.push({
              role: 'user',
              content: textContent + '\n\n[Note: Screenshot captured but current model does not support vision. Consider switching to a vision-capable model like gpt-4o, claude-3.5-sonnet, or gemini-1.5-pro to analyze images.]'
            });
          }
        } else {
          this.messages.push({
            role: 'user',
            content: textContent
          });
        }
      } else if (result && result.success === false) {
        const usage = this.formatToolUsage(name);
        const explanation = result.summary || 'Tool failed.';
        const detail = result.data?.error ? ` Error: ${result.data.error}` : '';

        console.log(chalk.yellow(`  ${explanation}${detail}`));
        console.log(chalk.gray(`  ${usage}`));

        let content = `[Tool ${name} failed. Reason: ${explanation}${detail}]`;
        if (result.data) {
          const normalizedData = name === 'shell'
            ? { ...result.data, output: result.data.fullOutput }
            : result.data;
          content += `\nPartial Output/Error Details:\n${JSON.stringify(normalizedData, null, 2)}`;
        }
        content += `\n${usage}`;

        this.messages.push({
          role: 'user',
          content
        });
      }
      
    } catch (error: any) {
      console.log(chalk.red(`  ✗ Tool ${name} failed: ${error.message}`));

      // Add failure to conversation so the agent can recover gracefully
      this.messages.push({
        role: 'user',
        content: `[Tool ${name} failed after retries: ${error.message}. ${this.formatToolUsage(name)}]`
      });
    }
  }

  async handleForgeRequest(request: any): Promise<void> {
    const isToolkit = Array.isArray(request.tools) && request.tools.length > 1;
    
    console.log('\n' + chalk.yellow('━'.repeat(60)));
    console.log(chalk.yellow.bold(isToolkit ? '📦 Toolkit Creation Request' : '🔥 Tool Creation Request'));
    console.log(chalk.yellow('━'.repeat(60)));
    console.log(chalk.cyan(isToolkit ? 'Toolkit Name:' : 'Tool Name:') + ` ${request.name}`);
    console.log(chalk.cyan('Reasoning:') + ` ${request.reason}`);
    
    if (request.tools && Array.isArray(request.tools)) {
      console.log(chalk.yellow('\nComponents:'));
      request.tools.forEach((t: any, i: number) => {
        console.log(`  ${i + 1}. ${chalk.bold(t.name)}: ${t.purpose}`);
      });
    } else if (request.purpose) {
      // Compatibility with old format
      console.log(chalk.cyan('Purpose:') + ` ${request.purpose}`);
      console.log(chalk.cyan('Inputs:') + ` ${request.inputs}`);
      console.log(chalk.cyan('Outputs:') + ` ${request.outputs}`);
    }
    
    console.log(chalk.yellow('━'.repeat(60)) + '\n');

    const answer: any = await inquirer.prompt([
      {
        type: 'list',
        name: 'approve',
        message: isToolkit ? 'Do you want to forge this toolkit?' : 'Do you want to forge this tool?',
        choices: [
          { name: chalk.green('✓ Yes, forge it'), value: 'yes' },
          { name: chalk.red('✗ No, decline'), value: 'no' }
        ]
      }
    ]);

    if (answer.approve === 'yes') {
      console.log(chalk.green(`\n✓ ${isToolkit ? 'Toolkit' : 'Tool'} creation approved, proceeding...\n`));
      await this.forgeNewTool(request);
    } else {
      console.log(chalk.yellow('\n⚠ Request declined, continuing...\n'));
      
      this.messages.push({
        role: 'user',
        content: `[User declined creation request for "${request.name}". Continue with existing tools.]`
      });
    }
  }

  async forgeNewTool(request: any): Promise<void> {
    const isToolkit = Array.isArray(request.tools) && request.tools.length > 0;
    const toolkitName = request.name || (isToolkit ? 'unified_toolkit' : `custom_tool_${Date.now().toString(36)}`);
    
    const spinner = ora({
      text: chalk.yellow(`🔥 Forging ${isToolkit ? 'toolkit' : 'tool'} (Pass 1/3)...`),
      spinner: 'dots'
    }).start();
    
    try {
      const { writeFile, mkdir, readFile } = await import('fs/promises');
      const { join, resolve, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const { registerForgedToolFromFile } = await import('../tools/index');
      
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const TOOLS_DIR = resolve(__dirname, '..', 'tools');
      
      let targetDir = TOOLS_DIR;
      if (isToolkit) {
        targetDir = join(TOOLS_DIR, toolkitName);
        await mkdir(targetDir, { recursive: true });
      }

      const toolsToForge = isToolkit ? request.tools : [{
        name: toolkitName,
        purpose: request.purpose,
        inputs: request.inputs,
        outputs: request.outputs
      }];

      // Use the active provider and current model instead of hardcoded values
      const activeProvider = this.providerManager.getActiveProviderType();
      const forgingModel = this.model;
      const forgedPaths: string[] = [];
      const forgedTools: Array<{name: string, path: string, code: string}> = [];

      for (const t of toolsToForge) {
        spinner.text = chalk.yellow(`🔥 Pass 1/3: Generating ${chalk.bold(t.name)}...`);
        
        const systemPrompt = `You are an expert TypeScript developer for the AgentForge kernel. 
Generate a complete, safe TypeScript tool implementation that fits the AgentForge architecture.

Requirements:
1. Use TypeScript and specify types for all parameters and return values.
2. The tool MUST export an asynchronous function that returns a \`ToolResult\` (import it from '${isToolkit ? '../index' : './index'}').
3. Include clear docstrings with purpose, parameters, and return value.
4. Handle errors gracefully and return a \`ToolResult\` with success: false.
5. Use only standard Node.js APIs or already installed dependencies (chalk, fast-glob, node-fetch, etc.).
6. Response should be ONLY the TypeScript code, no explanation or markdown wrappers.
7. CRITICAL: Attach metadata to the exported function object: 
   \`(functionName as any).description = "..."\`
   \`(functionName as any).parameters = { argName: { type: "string", description: "...", required: true } }\`

Code Template:
import { ToolResult } from '${isToolkit ? '../index' : './index'}';
import chalk from 'chalk';
// other imports...

export async function ${t.name}(args: any, options: any = {}): Promise<ToolResult> {
  try {
     // implementation...
     return new ToolResult(true, "Summary message", { data });
  } catch (error: any) {
     return new ToolResult(false, \`Tool failed: \${error.message}\`);
  }
}

// Metadata
(${t.name} as any).description = "${t.purpose.replace(/"/g, '\\"').replace(/\n/g, ' ')}";
(${t.name} as any).parameters = {
  // define parameters here based on inputs: ${t.inputs}
};

export default ${t.name};
`;

        const userPrompt = `Forge a TypeScript component for the ${toolkitName} toolkit:
Name: ${t.name}
Purpose: ${t.purpose}
Inputs: ${t.inputs || 'Infer'}
Outputs: ${t.outputs || 'Infer'}

Context: ${request.reason || 'No additional context'}`;

        // PASS 1: Initial generation
        let generatedCode: string = '';
        try {
          let result: any = await this.client.streamOpenRouter(
            [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            () => {},
            { temperature: 1.0, model: forgingModel }
          );
          generatedCode = result.content;
        } catch (error: any) {
          throw new Error(`Pass 1 failed: ${error.message}`);
        }

        // Extract code from markdown if present
        generatedCode = this.extractCodeFromMarkdown(generatedCode);
        
        // Save initial version
        const savePath = join(targetDir, `${t.name}.ts`);
        await writeFile(savePath, generatedCode, 'utf-8');
        
        // PASS 2: Read and improve
        spinner.text = chalk.yellow(`🔥 Pass 2/3: Improving ${chalk.bold(t.name)}...`);
        
        const pass2Prompt = `You are reviewing and improving the TypeScript tool implementation.

ORIGINAL REQUEST:
Name: ${t.name}
Purpose: ${t.purpose}
Inputs: ${t.inputs || 'Infer'}
Outputs: ${t.outputs || 'Infer'}
Context: ${request.reason || 'No additional context'}

CURRENT IMPLEMENTATION:
\`\`\`typescript
${generatedCode}
\`\`\`

IMPROVEMENT TASKS:
1. Verify all error handling is robust and returns proper ToolResult
2. Ensure type safety and TypeScript best practices
3. Optimize performance and code quality
4. Add more descriptive metadata if needed
5. Ensure the function signature matches requirements

Return ONLY the improved TypeScript code, no explanation.`;

        try {
          let result: any = await this.client.streamOpenRouter(
            [{ role: 'user', content: pass2Prompt }],
            () => {},
            { temperature: 1.0, model: forgingModel }
          );
          generatedCode = this.extractCodeFromMarkdown(result.content);
          await writeFile(savePath, generatedCode, 'utf-8');
        } catch (error: any) {
          console.log(chalk.yellow(`  ⚠ Pass 2 skipped for ${t.name}: ${error.message}`));
        }
        
        // PASS 3: Final refinement
        spinner.text = chalk.yellow(`🔥 Pass 3/3: Refining ${chalk.bold(t.name)}...`);
        
        const pass3Prompt = `Final review and polish of the TypeScript tool.

ORIGINAL REQUEST:
Name: ${t.name}
Purpose: ${t.purpose}

CURRENT IMPLEMENTATION:
\`\`\`typescript
${generatedCode}
\`\`\`

FINAL POLISH:
1. Ensure code is production-ready and follows AgentForge conventions
2. Verify all edge cases are handled
3. Check that error messages are clear and actionable
4. Ensure metadata is complete and accurate
5. Add any missing imports or dependencies

Return ONLY the final, polished TypeScript code.`;

        try {
          let result: any = await this.client.streamOpenRouter(
            [{ role: 'user', content: pass3Prompt }],
            () => {},
            { temperature: 0.6, model: forgingModel }
          );
          generatedCode = this.extractCodeFromMarkdown(result.content);
          await writeFile(savePath, generatedCode, 'utf-8');
        } catch (error: any) {
          console.log(chalk.yellow(`  ⚠ Pass 3 skipped for ${t.name}: ${error.message}`));
        }
        
        // Store for registration
        forgedTools.push({ name: t.name, path: savePath, code: generatedCode });
      }
      
      spinner.text = chalk.yellow('Registering tools...');
      
      // Register all tools
      for (const tool of forgedTools) {
        const registered = await registerForgedToolFromFile(tool.name, tool.path);
        if (registered) forgedPaths.push(tool.path);
      }
      
      spinner.stop();
      
      if (forgedPaths.length > 0) {
        console.log(chalk.green(`\n🔥 Forged ${isToolkit ? 'toolkit' : 'tool'}: ${chalk.bold(toolkitName)}`));
        console.log(chalk.gray(`   ${forgedPaths.length} component(s) created with 3-pass refinement`));
        forgedPaths.forEach(p => console.log(chalk.gray(`   ✓ ${p}`)));
        
        this.updateSystemPrompt();
        
        // Add success message to conversation
        const toolNames = forgedPaths.map(p => {
          const parts = p.split(/[\\/]/);
          return parts[parts.length - 1].replace('.ts', '');
        }).join(', ');
        
        this.messages.push({
          role: 'user',
          content: `[Toolsmith successfully created the ${isToolkit ? 'toolkit "' + toolkitName + '"' : 'tool "' + toolkitName + '"'}. The following tools are now ready to use: ${toolNames}. You can now use these tools immediately in your workflow.]`
        });
        
        // Auto-continue the conversation so agent doesn't get stuck
        console.log(chalk.gray('\n📋 Continuing agent workflow...\n'));
        setTimeout(() => {
          if (this.running && !this.toolQueueRunning) {
            void this.sendMessage('');
          }
        }, 500);
      } else {
        displayError('Forge failed', 'No tools were successfully registered.');
        
        this.messages.push({
          role: 'user',
          content: `[Toolsmith failed to create "${toolkitName}". Continue with existing tools.]`
        });
      }
      
    } catch (error: any) {
      spinner.stop();
      displayError('Forge failed', error.message);
      this.messages.push({ 
        role: 'user', 
        content: `[Toolsmith failed: ${error.message}. Continue with existing tools.]`
      });
    }
  }

  // Helper method to extract code from markdown blocks
  private extractCodeFromMarkdown(text: string): string {
    // Try to extract TypeScript code block
    const tsMatch = text.match(/```(?:typescript|ts)\n([\s\S]*?)```/) 
                || text.match(/```\n([\s\S]*?)```/);
    
    if (tsMatch) {
      return tsMatch[1].trim();
    }
    
    // Fallback: try to find code by detecting import/export statements
    const codeStart = text.search(/(import|export|const|function|async|class)\s/);
    if (codeStart !== -1) {
      let code = text.slice(codeStart);
      
      // Strip trailing markdown if any
      const codeEnd = code.lastIndexOf('```');
      if (codeEnd !== -1) {
        code = code.slice(0, codeEnd);
      }
      
      return code.trim();
    }
    
    return text.trim();
  }

  async selectCustomModel(): Promise<void> {
    const spinner = ora({
      text: chalk.yellow('Fetching models...'),
      spinner: 'dots'
    }).start();

    try {
      const models = await this.client.getModels();
      spinner.stop();

      if (!models || models.length === 0) {
        displayError('No models found', 'Could not fetch models from OpenRouter');
        return;
      }

      // Step 1: Search and select a model first
      const modelChoices = models.map((model: any) => ({
        name: this.formatModelListItem(model),
        value: model.id,
        model: model
      }));

      let selectedModelResult: any;
      try {
        selectedModelResult = await inquirer.prompt([
          {
            type: 'autocomplete',
            name: 'selectedModel',
            message: 'Search models:',
            prefix: '',
            pageSize: 15,
            source: async (answersSoFar: any, input: string) => {
              input = input || '';
              
              if (!input) {
                // Show popular models by default (sort by name)
                return modelChoices.slice(0, 50);
              }

              const searchLower = input.toLowerCase();
              const filtered = modelChoices.filter((choice: any) =>
                choice.value.toLowerCase().includes(searchLower) ||
                choice.name.toLowerCase().includes(searchLower)
              );

              return filtered.length > 0 ? filtered : modelChoices.slice(0, 20);
            }
          }
        ]);
      } catch (error: any) {
        if (error.isTtyError || error.message?.includes('User force closed')) {
          console.log(chalk.gray('\nCancelled.'));
          return;
        }
        throw error;
      }

      const selectedModelId = selectedModelResult.selectedModel;
      const selectedModel = models.find((m: any) => m.id === selectedModelId);
      
      if (!selectedModel) {
        displayError('Model not found', selectedModelId);
        return;
      }

      // Step 2: Get providers for this model (extract from model endpoint data)
      const modelProvider = selectedModelId.split('/')[0];
      
      // Build provider choices: specific provider + auto options
      const providerChoices = [
        { name: `${chalk.cyan(modelProvider)} ${chalk.gray('(Default provider)')}`, value: modelProvider },
        new inquirer.Separator(),
        { name: `${chalk.green('Auto')} - Sort by ${chalk.yellow('Price')} (cheapest)`, value: 'auto:price' },
        { name: `${chalk.green('Auto')} - Sort by ${chalk.yellow('Throughput')} (fastest)`, value: 'auto:throughput' },
        { name: `${chalk.green('Auto')} - Sort by ${chalk.yellow('Latency')} (lowest)`, value: 'auto:latency' },
        new inquirer.Separator(),
        { name: chalk.gray('< Cancel'), value: null }
      ];

      let providerResult: any;
      try {
        providerResult = await inquirer.prompt([
          {
            type: 'list',
            name: 'provider',
            message: `Provider for ${chalk.cyan(selectedModel.name || selectedModelId)}:`,
            choices: providerChoices
          }
        ]);
      } catch (error: any) {
        if (error.isTtyError || error.message?.includes('User force closed')) {
          console.log(chalk.gray('\nCancelled.'));
          return;
        }
        throw error;
      }

      const { provider } = providerResult;
      if (!provider) {
        console.log(chalk.gray('\nCancelled.'));
        return;
      }

      // Determine final model and provider setting
      let finalModelId = selectedModelId;
      let providerSetting = modelProvider;
      let sortMethod: string | null = null;

      if (provider.startsWith('auto:')) {
        // Auto mode with specific sort
        sortMethod = provider.split(':')[1];
        providerSetting = 'auto';
        
        // If auto, we might want to add provider routing preference
        // For now, keep the selected model but mark provider as auto
        console.log(chalk.gray(`\n  Using auto-routing with ${sortMethod} optimization`));
      } else {
        providerSetting = provider;
      }

      // Apply the selection
      this.model = finalModelId;
      this.currentModelInfo = selectedModel;
      this.config.set('openrouter.model', finalModelId);
      this.config.set('openrouter.provider', providerSetting);
      if (sortMethod) {
        this.config.set('openrouter.autoSort', sortMethod);
      }
      this.config.setEnvVar('OPENROUTER_MODEL', finalModelId);

      // Display confirmation
      console.log(boxen(
        chalk.bold.green('✓ Model Selected\n\n') +
        chalk.cyan('Model: ') + selectedModel.name + '\n' +
        chalk.cyan('ID: ') + finalModelId + '\n' +
        chalk.cyan('Provider: ') + (providerSetting === 'auto' ? `Auto (${sortMethod})` : providerSetting) + '\n' +
        chalk.cyan('Context: ') + this.formatContext(selectedModel) + '\n' +
        (selectedModel.pricing ? 
          chalk.cyan('Price: ') + chalk.gray(`$${selectedModel.pricing.prompt}/prompt, $${selectedModel.pricing.completion}/completion`) 
          : ''),
        { padding: 1, borderColor: 'green', title: 'Model' }
      ));

    } catch (error: any) {
      spinner.stop();
      if (!error.isTtyError) {
        displayError('Model selection failed', error.message);
      }
    }
  }

  private formatModelListItem(model: any): string {
    const name = (model.name || model.id).slice(0, 45).padEnd(45);
    const context = model.context_length 
      ? chalk.gray(`${Math.round(model.context_length / 1000)}K`) 
      : chalk.gray('N/A');
    const price = model.pricing?.prompt 
      ? chalk.yellow(`$${parseFloat(model.pricing.prompt).toFixed(6)}`) 
      : chalk.gray('Free');
    
    return `${name} ${context.padStart(6)} ${price}`;
  }

  private sortModels(models: any[], sortMethod: string): any[] {
    const copy = [...models];

    switch (sortMethod) {
      case 'price':
        return copy.sort((a: any, b: any) => {
          const priceA = parseFloat(a.pricing?.prompt || '0');
          const priceB = parseFloat(b.pricing?.prompt || '0');
          return priceA - priceB;
        });

      case 'throughput':
        return copy.sort((a: any, b: any) => {
          const throughputA = a.top_provider?.max_completion_tokens || 0;
          const throughputB = b.top_provider?.max_completion_tokens || 0;
          return throughputB - throughputA;
        });

      case 'latency':
        return copy.sort((a: any, b: any) => {
          const contextA = a.context_length || 0;
          const contextB = b.context_length || 0;
          return contextA - contextB;
        });

      default:
        return copy;
    }
  }

  private formatModelChoice(model: any, sortMethod: string): string {
    const name = model.name || model.id;
    const pricing = model.pricing?.prompt || '0';
    const maxTokens = model.top_provider?.max_completion_tokens || 'N/A';
    const context = model.context_length || 'N/A';

    let details = '';
    switch (sortMethod) {
      case 'price':
        details = `$${pricing}/token`;
        break;
      case 'throughput':
        details = `${maxTokens} tokens`;
        break;
      case 'latency':
        details = `${context} context`;
        break;
    }

    return `${name.slice(0, 40).padEnd(40)} ${chalk.gray(details)}`;
  }

  private formatModelInfo(model: any, sortMethod: string): string {
    const pricing = model.pricing || {};
    const topProvider = model.top_provider || {};
    const contextFormatted = this.formatContext(model);

    let info = chalk.cyan(`Model: ${model.id}\n`);
    info += chalk.cyan(`Name: ${model.name}\n`);
    info += chalk.cyan(`Context: ${contextFormatted}\n`);
    info += chalk.cyan(`Max Completion: ${topProvider.max_completion_tokens || 'N/A'} tokens\n\n`);
    info += chalk.yellow(`Pricing (USD):\n`);
    info += chalk.gray(`  Prompt: $${pricing.prompt || '0'}/token\n`);
    info += chalk.gray(`  Completion: $${pricing.completion || '0'}/token\n`);
    info += chalk.gray(`  Request: $${pricing.request || '0'}\n`);

    return info;
  }

  async showCredits(): Promise<void> {
    const spinner = ora({
      text: chalk.yellow('Fetching account balance...'),
      spinner: 'dots'
    }).start();

    try {
      const keyInfo = await this.client.getAccountBalance();
      spinner.stop();

      if (!keyInfo || !keyInfo.data) {
        displayError('No balance data', 'Could not retrieve account information');
        return;
      }

      const data = keyInfo.data;
      const limitRemaining = data.limitRemaining;
      const usage = data.usage || 0;
      const limit = data.limit;
      
      let creditsDisplay: string;
      if (limitRemaining === null || limitRemaining === undefined) {
        creditsDisplay = chalk.green('Unlimited');
      } else {
        creditsDisplay = chalk.green(`$${limitRemaining.toFixed(2)}`);
      }

      let info = chalk.bold('Account Balance\n\n');
      info += chalk.cyan('Remaining Credits: ') + creditsDisplay + '\n';
      info += chalk.cyan('Total Usage: ') + chalk.yellow(`$${usage.toFixed(2)}`) + '\n';
      
      if (limit) {
        info += chalk.cyan('Credit Limit: ') + chalk.gray(`$${limit.toFixed(2)}`);
      } else {
        info += chalk.cyan('Credit Limit: ') + chalk.gray('None');
      }

      console.log(boxen(info, { padding: 1, borderColor: 'green', title: 'OpenRouter' }));
    } catch (error: any) {
      spinner.stop();
      displayError('Failed to fetch credits', error.message);
    }
  }

  private formatContext(modelInfo: any): string {
    if (!modelInfo || !modelInfo.context_length) {
      return 'N/A';
    }

    const context = modelInfo.context_length;
    const isCompacted = modelInfo.is_compacted === true;
    const compactNote = isCompacted ? ' [auto-compact]' : '';

    if (context >= 1000000) {
      return `${(context / 1000000).toFixed(1)}M tokens${compactNote}`;
    } else if (context >= 1000) {
      return `${(context / 1000).toFixed(1)}K tokens${compactNote}`;
    } else {
      return `${context} tokens${compactNote}`;
    }
  }

  private async runSwarm(task: string): Promise<void> {
    if (!task) {
      console.log(chalk.yellow('Usage: /swarm <task>'));
      return;
    }

    const spinner = ora({
      text: chalk.gray('Starting swarm...'),
      spinner: 'dots'
    }).start();

    try {
      const result = await this.client.runSwarm(task, {
        agents: this.config.get('swarm.defaultAgents'),
        model: this.model,
        context: {
          workingDirectory: this.workingDirectory
        }
      });

      spinner.stop();

      const summary = result.unifiedSummary || 'Swarm completed';
      console.log(boxen(
        chalk.bold('Swarm Result\n\n') +
        chalk.cyan('Run ID: ') + result.runId + '\n' +
        chalk.cyan('Agents: ') + (result.agentResults?.length || 0) + '\n' +
        chalk.cyan('Plan: ') + (result.planPath || 'n/a') + '\n' +
        chalk.cyan('Plan JSON: ') + (result.planJsonPath || 'n/a') + '\n' +
        chalk.cyan('Integration: ') + (result.integrationReportPath || 'n/a') + '\n\n' +
        chalk.gray(summary),
        { padding: 1, borderColor: 'cyan', title: 'Swarm' }
      ));

      this.messages.push({
        role: 'user',
        content: `[Swarm run completed]\n${JSON.stringify(result, null, 2)}`
      });
    } catch (error: any) {
      spinner.stop();
      displayError('Swarm failed', error.message);
    }
  }
}
