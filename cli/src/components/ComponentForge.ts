import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { BackendClient } from '../services/BackendClient';
import { ConfigManager } from '../services/ConfigManager';
import { sectionHeader, displayError, displaySuccess } from '../utils/display';
import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import boxen from 'boxen';

const SCAN_DIRS = [
  'server/src/services',
  'server/src/core',
  'server/src/models',
  'cli/src/services',
  'cli/src/components'
];

export interface Improvement {
  id: string;
  component: string;
  type: 'improvement' | 'new_component' | 'refactor';
  description: string;
  reasoning: string;
  files_involved: string[];
}

/**
 * ComponentForge - Autonomous System Architect
 * ===========================================
 * Analyzes the AgentForge internal architecture and suggests
 * evolutionary improvements to its core services and middleware.
 */
export class ComponentForge {
  private client: BackendClient;
  private config: ConfigManager;

  constructor() {
    this.config = new ConfigManager();
    this.client = new BackendClient(this.config);
  }

  /**
   * Run the ComponentForge interactive session
   */
  async run(): Promise<void> {
    console.log(boxen(
      chalk.bold.magenta('🛠️  AgentForge ComponentForge\n\n') +
      chalk.gray('Analyzing core architecture, memory systems, and middleware...') + '\n' +
      chalk.gray('Identifying evolutionary path for autonomous capabilities.'),
      { padding: 1, borderColor: 'magenta', margin: 1, title: 'Architect Mode' }
    ));

    const spinner = ora(chalk.magenta('Scanning codebase components...')).start();
    
    try {
      const components = await this.scanCodebase();
      spinner.text = chalk.magenta('Consulting the Architect (LLM) for improvements...');
      
      const suggestions = await this.analyzeComponents(components);
      spinner.stop();

      if (suggestions.length === 0) {
        displaySuccess('Architecture is optimal. No urgent improvements identified.');
        return;
      }

      await this.selectionLoop(suggestions);

    } catch (error: any) {
      spinner.stop();
      displayError('ComponentForge Error', error.message);
    }
  }

  /**
   * Scans the project for core components
   */
  private async scanCodebase(): Promise<any[]> {
    const results: any[] = [];
    const root = process.cwd();

    for (const dir of SCAN_DIRS) {
      const fullDir = join(root, dir);
      try {
        const files = await readdir(fullDir);
        for (const file of files) {
          if (file.endsWith('.ts')) {
            const filePath = join(fullDir, file);
            const content = await readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const summary = {
              path: relative(root, filePath).replace(/\\/g, '/'),
              size: (await stat(filePath)).size,
              exports: lines.filter(l => l.includes('export class') || l.includes('export function')).map(l => {
                  const match = l.match(/(class|function)\s+(\w+)/);
                  return match ? match[2] : l.trim();
              }),
              imports: lines.filter(l => l.includes('import')).length,
              purpose: lines.slice(0, 10).join('\n').match(/\/\*\*([\s\S]*?)\*\//)?.[1]?.trim() || 'Core Component'
            };
            results.push(summary);
          }
        }
      } catch (e) {
        // Skip if directory doesn't exist
      }
    }
    return results;
  }

  /**
   * Uses LLM to identify architectural improvements
   */
  private async analyzeComponents(summaries: any[]): Promise<Improvement[]> {
    const prompt = `You are the AgentForge Principal Architect. Your goal is to evolve this autonomous agent system.
Analyze the current core components and identify 3 surgical improvements or new core components that would make the agent more powerful, autonomous, or secure.

FOCUS AREAS:
- **Long-term Memory**: Vector storage integration, hierarchical memory, or experience consolidation.
- **Cognitive Middleware**: Better tool pre-processing, safety guards, or multi-modal reasoning.
- **Swarm Orchestration**: Dynamic agent spawning, shared state management, or better task delegation.
- **Reliability**: Self-healing loops, rate limiting optimization, or persistence layers.

CURRENT COMPONENTS (METADATA):
${summaries.map(s => `- ${s.path}: ${s.purpose.substring(0, 100)}\n  Exports: ${s.exports.join(', ')}`).join('\n\n')}

IMPORTANT: When suggesting paths for new files, use the same directory structure as existing ones (e.g., 'server/src/services/new_service.ts' instead of just 'new_service.ts').

Respond with a valid JSON array of suggestions. No markdown preamble.
[
  {
    "id": "unique-id",
    "component": "Component Name",
    "type": "improvement|new_component|refactor",
    "description": "Short explanation of the change",
    "reasoning": "Technical justification why this boosts autonomy/performance",
    "files_involved": ["existing/path.ts", "new/path.ts"]
  }
]
`;

    const forgingModel = 'moonshotai/kimi-k2.5';
    const fallbackModel = this.config.get('openrouter.model') || 'anthropic/claude-3.5-sonnet';

    let response;
    try {
      response = await this.client.streamOpenRouter(
        [
            { role: 'system', content: 'You are an Elite Software Architect for Autonomous Systems.' },
            { role: 'user', content: prompt }
        ],
        () => {},
        { temperature: 1.0, model: forgingModel, reasoning: true, include_reasoning: true }
      );
    } catch (error: any) {
      response = await this.client.streamOpenRouter(
        [
            { role: 'system', content: 'You are an Elite Software Architect for Autonomous Systems.' },
            { role: 'user', content: prompt }
        ],
        () => {},
        { temperature: 0.2, model: fallbackModel }
      );
    }

    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      const cleanJson = jsonMatch ? jsonMatch[0] : response.content;
      return JSON.parse(cleanJson);
    } catch (e) {
      console.error(chalk.red('\nFailed to parse Architect recommendations.'));
      console.log(response.content);
      return [];
    }
  }

  /**
   * User interaction loop
   */
  private async selectionLoop(suggestions: Improvement[]): Promise<void> {
    let currentSuggestions = [...suggestions];

    while (currentSuggestions.length > 0) {
      sectionHeader('Evolutionary Recommendations');
      
      const choices = currentSuggestions.map((s, i) => ({
        name: `${chalk.bold.magenta(s.component)} [${s.type.toUpperCase()}] - ${chalk.white(s.description)}`,
        value: i
      }));

      const { selection }: any = await inquirer.prompt([
        {
          type: 'list',
          name: 'selection',
          message: 'Which improvement should we implement?',
          choices: [...choices, new inquirer.Separator(), { name: '❌ Exit ComponentForge', value: -1 }]
        }
      ]);

      if (selection === -1) break;

      const item = currentSuggestions[selection];
      console.log('\n' + boxen(
        chalk.magenta.bold(item.component) + '\n\n' +
        chalk.white('Why:') + ' ' + chalk.gray(item.reasoning) + '\n\n' +
        chalk.yellow('Files to be updated/created:') + '\n' +
        item.files_involved.map(f => `  - ${chalk.cyan(f)}`).join('\n'),
        { padding: 1, borderColor: 'magenta', title: 'Details' }
      ));

      const { action }: any = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Decision:',
          choices: [
            { name: '🚀 Accept & Implement Now', value: 'accept' },
            { name: '🕹️  Steer (Modify the plan)', value: 'steer' },
            { name: '🔙 Back to suggestions', value: 'back' }
          ]
        }
      ]);

      if (action === 'accept') {
        const success = await this.implement(item);
        if (success) {
            currentSuggestions = currentSuggestions.filter((_, i) => i !== selection);
        }
      } else if (action === 'steer') {
        const { feedback }: any = await inquirer.prompt([
          { type: 'input', name: 'feedback', message: 'How should we refine this proposal?' }
        ]);
        
        const spinner = ora(chalk.magenta('Refining the plan with the Architect...')).start();
        const refined = await this.refineSuggestion(item, feedback);
        spinner.stop();
        
        if (refined) {
            currentSuggestions[selection] = refined;
        }
      }
    }
  }

  /**
   * Refines a suggestion based on user feedback
   */
  private async refineSuggestion(original: Improvement, feedback: string): Promise<Improvement | null> {
      const prompt = `Original Architectural Suggestion:
${JSON.stringify(original, null, 2)}

User Feedback:
"${feedback}"

Based on the feedback, refine the suggestion. Return the updated JSON object. Only the JSON.`;

      const forgingModel = 'moonshotai/kimi-k2.5';
      const fallbackModel = this.config.get('openrouter.model') || 'anthropic/claude-3.5-sonnet';

      let response;
      try {
        response = await this.client.streamOpenRouter(
          [{ role: 'user', content: prompt }],
          () => {},
          { temperature: 1.0, model: forgingModel, reasoning: true, include_reasoning: true }
        );
      } catch (error: any) {
        response = await this.client.streamOpenRouter(
            [{ role: 'user', content: prompt }],
            () => {},
            { temperature: 0.2, model: fallbackModel }
        );
      }

      try {
          const jsonMatch = response.content.match(/\{[\s\S]*\}/);
          return JSON.parse(jsonMatch ? jsonMatch[0] : response.content);
      } catch {
          return null;
      }
  }

  /**
   * Implements the selected improvement
   */
  private async implement(item: Improvement): Promise<boolean> {
    const spinner = ora(chalk.magenta(`Forging component: ${item.component}...`)).start();
    
    try {
        const fileContents: any = {};
        for (const f of item.files_involved) {
            try {
                fileContents[f] = await readFile(join(process.cwd(), f), 'utf-8');
            } catch {
                fileContents[f] = '// New component file to be created';
            }
        }

        const prompt = `You are a Senior Systems Engineer. Implement the following architectural evolution.
Requirement: ${item.description}
Technical Goal: ${item.reasoning}

Maintain the existing style and architecture. Ensure types are correct.

Current context of files:
${Object.entries(fileContents).map(([path, content]) => `FILE: ${path}\n\`\`\`typescript\n${content}\n\`\`\``).join('\n\n')}

Provide the FULL code for each file mentioned. Use the following format for each file:

### FILENAME: path/to/file.ts
\`\`\`typescript
// Full file content here
\`\`\`
`;

        const forgingModel = 'moonshotai/kimi-k2.5';
        const fallbackModel = this.config.get('openrouter.model') || 'anthropic/claude-3.5-sonnet';

        let response;
        try {
          process.stdout.write('\n');
          response = await this.client.streamOpenRouter(
            [
              { role: 'system', content: 'You are an Elite AgentForge Engineer. Output ONLY file content blocks.' },
              { role: 'user', content: prompt }
            ],
            (chunk: string) => {
                // Determine if we should show the chunk (optional: filter reasoning if needed)
                process.stdout.write(chalk.gray(chunk));
            },
            { temperature: 1.0, model: forgingModel, reasoning: true, include_reasoning: true }
          );
          process.stdout.write('\n');
        } catch (error: any) {
          response = await this.client.streamOpenRouter(
            [
              { role: 'system', content: 'You are an Elite AgentForge Engineer. Output ONLY file content blocks.' },
              { role: 'user', content: prompt }
            ],
            () => {},
            { temperature: 0.2, model: fallbackModel }
          );
        }

        spinner.stop();
        
        // Basic parser for the format
        const blocks = response.content.split(/### FILENAME:?\s+/i).filter(b => b.trim());
        
        if (blocks.length === 0) {
            // Fallback: try to find any code blocks and match paths mentioned in item
            const codeBlocks = response.content.match(/```(?:typescript|ts)\n([\s\S]*?)```/g);
            if (codeBlocks && item.files_involved.length === 1) {
                const code = codeBlocks[0].replace(/```(?:typescript|ts)\n|```/g, '').trim();
                const fullPath = join(process.cwd(), item.files_involved[0]);
                
                const { mkdir } = await import('fs/promises');
                const { dirname } = await import('path');
                try { await mkdir(dirname(fullPath), { recursive: true }); } catch {}

                await writeFile(fullPath, code, 'utf-8');
                displaySuccess(`Implemented changes to ${item.files_involved[0]}`);
                return true;
            }
            throw new Error('No implementation blocks found in response.');
        }

        for (const block of blocks) {
            const lines = block.split('\n');
            let relativePath = lines[0].trim().replace(/\\/g, '/');
            
            // Clean up potentially hallucinated preamble in path
            if (relativePath.startsWith('###')) relativePath = relativePath.replace(/^#+\s*/, '');
            
            const codeMatch = block.match(/```(?:typescript|ts)\n([\s\S]*?)```/);
            
            if (codeMatch && relativePath) {
                const fullPath = join(process.cwd(), relativePath);
                // Ensure directory exists
                const { mkdir } = await import('fs/promises');
                const { dirname } = await import('path');
                try { await mkdir(dirname(fullPath), { recursive: true }); } catch {}
                
                await writeFile(fullPath, codeMatch[1].trim(), 'utf-8');
                displaySuccess(`Forged: ${relativePath}`);
            }
        }
        
        console.log(chalk.green('\n✅ Implementation complete. Restarting the system may be required.'));
        return true;

    } catch (error: any) {
        spinner.stop();
        displayError('Implementation Failed', error.message);
        return false;
    }
  }
}
