/**
 * Forge UI Component
 * ==================
 * Interactive tool creation wizard using the Toolsmith mechanism.
 */

import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import inquirer from 'inquirer';

import { BackendClient } from '../services/BackendClient';
import { ConfigManager } from '../services/ConfigManager';
import { tools } from '../tools/index';
import { displayError, displaySuccess, sectionHeader, displayInfo } from '../utils/display';
import { readFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOOLS_DIR = resolve(__dirname, '..', 'tools');

export class ForgeUI {
  private config: any;
  private client: BackendClient;

  constructor(options: any = {}) {
    this.config = options.config || new ConfigManager();
    this.client = new BackendClient(this.config);
  }
  
  /**
   * Audit the current toolset and identify gaps or improvements
   */
  async audit(): Promise<void> {
    console.log(boxen(
      chalk.bold('🔍 Toolset Auditor & Optimizer\n\n') +
      chalk.gray('Identifying gaps in functionality and searching for improvements.\n') +
      chalk.gray('Analyzing current tools against enterprise-grade engineering standards.'),
      { padding: 1, borderColor: 'cyan', title: 'Audit' }
    ));

    const spinner = ora(chalk.yellow('Analyzing existing toolkit...')).start();
    
    try {
      // 1. Gather context
      const toolSummaries = Object.keys(tools).map(name => {
        const t = (tools as any)[name];
        return `- ${name}: ${t.description}`;
      }).join('\n');

      // Try to read ChatSession.ts for system prompt (engineering context)
      let sysPrompt = '';
      try {
        const chatSessionPath = join(process.cwd(), 'src', 'components', 'ChatSession.ts');
        const content = await readFile(chatSessionPath, 'utf-8');
        const match = content.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
        if (match) sysPrompt = match[1];
      } catch {}

      spinner.text = chalk.yellow('Consulting Toolsmith intelligence...');

      const auditPrompt = `You are the AgentForge Toolset Architect. Perform a deep structural audit of the current capabilities.

ANALYSIS PROTOCOL:
1. Identify existing expertise based on current tools.
2. Detect "fragility gaps" (where current tools might fail on complex Windows paths, deep recursion, or large files).
3. Identify "functional voids" (capabilities required for elite software engineering but missing).
4. Propose surgical improvements or new autonomous tools.

CURRENT TOOLS:
${toolSummaries}

AGENT ENGINEERING CONTEXT:
${sysPrompt.substring(0, 2000)}...

Respond with a JSON-formatted audit report:
{
  "strengths": ["description of current strengths"],
  "gaps": ["description of gap"],
  "suggestions": [
     { 
       "name": "Tool Name", 
       "action": "create|edit", 
       "reason": "Why this is critical for elite performance", 
       "spec": { "purpose": "...", "inputs": "...", "outputs": "..." } 
     }
  ]
}`;

      const response = await this.client.streamOpenRouter(
        [
          { role: 'system', content: 'You are an autonomous Toolset Architect.' },
          { role: 'user', content: auditPrompt }
        ],
        () => {},
        { 
          temperature: 0.1,
          // Only use reasoning if the model likely supports it or it's specifically configured
          reasoning: this.config.get('openrouter.reasoning.enabled') || false
        }
      );

      let report: any;
      try {
        // Find JSON in response (handle potential preamble/thinking)
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        const cleanJson = jsonMatch ? jsonMatch[0] : response.content.replace(/```json\n?|\n?```/g, '').trim();
        report = JSON.parse(cleanJson);
      } catch {
        spinner.stop();
        displayError('Audit Error', 'Could not parse architect response.');
        console.log(response.content);
        return;
      }

      spinner.stop();
      sectionHeader('Audit Results');
      
      if (report.strengths) {
        console.log(chalk.bold('\nExisting Strengths:'));
        report.strengths.forEach((s: string) => console.log(`  ${chalk.green('✓')} ${s}`));
      }

      console.log(chalk.bold('\nCritical Gaps:'));
      report.gaps.forEach((g: string) => console.log(`  ${chalk.red('•')} ${g}`));

      console.log(chalk.bold('\nStrategy & Actionable Improvements:'));
      console.log(chalk.gray('(Press <space> to select one or more, then press <enter> to execute)'));
      
      const actionChoices = report.suggestions.map((s: any, i: number) => ({
        name: `${chalk.cyan(`[${s.action.toUpperCase()}]`)} ${chalk.bold(s.name)}: ${s.reason}`,
        value: i
      }));

      const { selectedActions }: any = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedActions',
          message: 'Select items to implement:',
          choices: actionChoices,
          pageSize: 10,
          validate: (val: any[]) => val.length > 0 || 'Select at least one improvement, or press Ctrl+C to stop.'
        }
      ]);

      for (const idx of selectedActions) {
        const suggestion = report.suggestions[idx];
        displayInfo(`Implementing ${chalk.bold(suggestion.name)}...`);
        
        await this.generate({
          name: suggestion.name,
          ...suggestion.spec,
          constraints: [
            ...(suggestion.constraints || []),
            'Use reasoning-first logic',
            'Surgical precision in file interactions',
            'Handle Windows path edge cases'
          ]
        });
      }

    } catch (error: any) {
      spinner.stop();
      displayError('Audit Failed', error.message);
    }
  }

  /**
   * Interactive tool creation wizard
   */
  async wizard(): Promise<void> {
    console.log(boxen(
      chalk.bold('🔥 Toolsmith - Tool Forge Wizard\n\n') +
      chalk.gray('Create a new tool or toolkit by describing what you need.\n') +
      chalk.gray('The Toolsmith will generate, validate, and register it.'),
      { padding: 1, borderColor: 'yellow', title: 'Forge' }
    ));

    const { forgeType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'forgeType',
        message: 'What would you like to forge?',
        choices: [
          { name: 'Single Tool (Specific functionality)', value: 'tool' },
          { name: 'Toolkit (A collection of related tools)', value: 'toolkit' }
        ]
      }
    ]);

    if (forgeType === 'tool') {
      const answers: any = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Tool name:',
          validate: (input: string) => {
            if (!input.trim()) return 'Name is required';
            if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(input)) {
              return 'Name must start with letter and contain only alphanumeric, underscore, or hyphen';
            }
            return true;
          }
        },
        {
          type: 'input',
          name: 'purpose',
          message: 'What should this tool do?',
          validate: (input: string) => input.length >= 10 || 'Please provide more detail (at least 10 characters)'
        },
        {
          type: 'input',
          name: 'inputs',
          message: 'Describe the inputs:',
          default: 'Infer from purpose'
        },
        {
          type: 'input',
          name: 'outputs',
          message: 'Describe the outputs:',
          default: 'Infer from purpose'
        },
        {
          type: 'input',
          name: 'domain',
          message: 'Domain/category (optional):',
          default: 'general'
        },
        {
          type: 'input',
          name: 'constraints',
          message: 'Any constraints? (comma-separated, optional):',
          default: ''
        },
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Generate this tool?',
          default: true
        }
      ]);
      
      if (!answers.confirm) {
        console.log(chalk.gray('\nTool creation cancelled.\n'));
        return;
      }
      
      await this.generate({
        name: answers.name,
        purpose: answers.purpose,
        inputs: answers.inputs,
        outputs: answers.outputs,
        domain: answers.domain,
        constraints: (answers.constraints as string).split(',').map(c => c.trim()).filter(Boolean)
      });
    } else {
      // Toolkit logic
      const toolkitAnswers: any = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Toolkit name:',
          validate: (input: string) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(input) || 'Invalid name'
        },
        {
          type: 'input',
          name: 'purpose',
          message: 'What is the high-level purpose of this toolkit?',
          validate: (input: string) => input.length >= 20 || 'Please be more descriptive'
        },
        {
          type: 'input',
          name: 'domain',
          message: 'Domain/category (optional):',
          default: 'general'
        },
        {
          type: 'input',
          name: 'constraints',
          message: 'Any constraints? (comma-separated, optional):',
          default: ''
        }
      ]);

      const spinner = ora(chalk.yellow('Designing toolkit components...')).start();
      
      const constraints = (toolkitAnswers.constraints as string).split(',').map(c => c.trim()).filter(Boolean);
      
      try {
        const designPrompt = `You are an expert Tool Architect. Design a toolkit named "${toolkitAnswers.name}" for: ${toolkitAnswers.purpose}
Domain: ${toolkitAnswers.domain}
Constraints: ${constraints.join(', ') || 'None specified'}

Propose a set of 2-5 surgical, highly focused TypeScript tools that work together to solve this.

Respond with ONLY a JSON array of tool specifications:
[
  { "name": "ToolName", "purpose": "focused purpose", "inputs": "...", "outputs": "...", "constraints": ["..."] },
  ...
]`;

        const response = await this.client.streamOpenRouter(
          [
            { role: 'system', content: 'You are an autonomous Toolset Architect.' },
            { role: 'user', content: designPrompt }
          ],
          () => {},
          { temperature: 0.1 }
        );

        const jsonMatch = response.content.match(/\[[\s\S]*\]/);
        const components = JSON.parse(jsonMatch ? jsonMatch[0] : response.content);
        spinner.stop();

        console.log(chalk.bold('\nProposed Toolkit Components:'));
        components.forEach((c: any, i: number) => {
          console.log(`  ${i + 1}. ${chalk.cyan(c.name)}: ${c.purpose}`);
        });

        const { selectedComponents }: any = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedComponents',
            message: 'Select components to forge:',
            choices: components.map((c: any) => ({ name: c.name, value: c, checked: true })),
            validate: (val: any[]) => val.length > 0 || 'Select at least one component'
          }
        ]);

        // Merge toolkit-level metadata into components
        const toolsWithMetadata = selectedComponents.map((c: any) => ({
          ...c,
          domain: toolkitAnswers.domain,
          constraints: Array.from(new Set([...(c.constraints || []), ...constraints]))
        }));

        await this.generate({
          name: toolkitAnswers.name,
          purpose: toolkitAnswers.purpose,
          domain: toolkitAnswers.domain,
          constraints: constraints,
          tools: toolsWithMetadata
        });

      } catch (err: any) {
        spinner.stop();
        displayError('Toolkit design failed', err.message);
      }
    }
  }
  
  /**
   * Generate a tool from a dossier
   */
  async generate(dossier: any): Promise<void> {
    sectionHeader('Forging Tool');
    
    const displayPurpose = dossier.purpose || dossier.reason || 'No description provided';
    console.log(`  ${chalk.gray('Name:')} ${chalk.cyan(dossier.name)}`);
    console.log(`  ${chalk.gray('Purpose:')} ${displayPurpose.slice(0, 60)}${displayPurpose.length > 60 ? '...' : ''}`);
    console.log();
    
    // Check if backend is available
    const backendAvailable = await this.client.healthCheck();
    
    if (!backendAvailable) {
      // Generate locally using OpenRouter directly
      await this.generateLocally(dossier);
      return;
    }
    
    // Use backend Forge
    const spinner = ora({
      text: chalk.yellow('Connecting to Forge...'),
      spinner: 'dots'
    }).start();
    
    try {
      const result: any = await this.client.forgeGenerate({
        name: dossier.name,
        purpose: dossier.purpose,
        inputs_description: dossier.inputs || 'Infer from purpose',
        outputs_description: dossier.outputs || 'Infer from purpose',
        domain: dossier.domain,
        constraints: dossier.constraints || []
      });
      
      spinner.stop();
      
      if (result.success) {
        this.showSuccess(result);
      } else {
        displayError('Forge failed', result.error);
      }
      
    } catch (error: any) {
      spinner.stop();
      displayError('Forge failed', error.message);
      
      // Offer to try local generation
      const { tryLocal }: any = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'tryLocal',
          message: 'Try generating locally using OpenRouter?',
          default: true
        }
      ]);
      
      if (tryLocal) {
        await this.generateLocally(dossier);
      }
    }
  }
  
  /**
   * Generate tool locally using OpenRouter
   */
  async generateLocally(dossier: any): Promise<void> {
    const isToolkit = Array.isArray(dossier.tools) && dossier.tools.length > 0;
    const toolkitName = dossier.name;
    
    console.log(chalk.yellow(`\n🔥 Generating ${isToolkit ? 'toolkit' : 'tool'} locally...\n`));
    
    const spinner = ora(isToolkit ? `Forging toolkit ${toolkitName}...` : `Forging tool ${dossier.name}...`).start();
    
    try {
      const { writeFile, mkdir } = await import('fs/promises');
      const { registerForgedToolFromFile } = await import('../tools/index');
      
      let targetDir = TOOLS_DIR;
      if (isToolkit) {
        targetDir = join(TOOLS_DIR, toolkitName);
        await mkdir(targetDir, { recursive: true });
      }

      const toolsToForge = isToolkit ? dossier.tools : [{
        name: dossier.name,
        purpose: dossier.purpose,
        inputs: dossier.inputs || 'Infer from purpose',
        outputs: dossier.outputs || 'Infer from purpose',
        constraints: dossier.constraints || []
      }];

      const forgedPaths: string[] = [];
      
      // Use the configured model from config instead of hardcoded values
      const configuredModel = this.config.get('openrouter.model') || this.config.get('copilot.model');
      const forgingModel = configuredModel || 'anthropic/claude-4.5-sonnet';

      for (const t of toolsToForge) {
        spinner.text = chalk.yellow(`Generating component: ${chalk.bold(t.name)}...`);

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

        const userPrompt = `Forge a TypeScript tool for AgentForge with these specifications:

Name: ${t.name}
Purpose: ${t.purpose}
Inputs: ${t.inputs || 'Infer from purpose'}
Outputs: ${t.outputs || 'Infer from purpose'}
${t.constraints?.length ? `Constraints: ${t.constraints.join(', ')}` : ''}
${isToolkit ? `Part of Toolkit: ${toolkitName}` : ''}

Generate a complete implementation. The main function should be exported as the tool name.`;

        let result;
        try {
          result = await this.client.streamOpenRouter(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            () => {},
            { temperature: 1.0, model: forgingModel }
          );
        } catch (error: any) {
          throw new Error(`Tool generation failed: ${error.message}`);
        }

        let generatedCode = result.content;
        
        // Better code extraction logic
        const tsMatch = generatedCode.match(/```(?:typescript|ts)\n([\s\S]*?)```/) 
                    || generatedCode.match(/```\n([\s\S]*?)```/);
        
        if (tsMatch) {
          generatedCode = tsMatch[1];
        } else {
          const codeStart = generatedCode.search(/(import|export|const|function|async|class)\s/);
          if (codeStart !== -1) {
            generatedCode = generatedCode.slice(codeStart);
          }
          const codeEnd = generatedCode.lastIndexOf('```');
          if (codeEnd !== -1) {
            generatedCode = generatedCode.slice(0, codeEnd);
          }
        }
        generatedCode = generatedCode.trim();
        
        const fileName = `${t.name}.ts`;
        const savePath = join(targetDir, fileName);
        
        await writeFile(savePath, generatedCode, 'utf-8');
        
        // Try to register
        const registered = await registerForgedToolFromFile(t.name, savePath);
        if (registered) forgedPaths.push(savePath);
      }
      
      spinner.stop();
      
      if (forgedPaths.length > 0) {
        displaySuccess(`Successfully forged ${isToolkit ? 'toolkit' : 'tool'} with ${forgedPaths.length} components.`);
        forgedPaths.forEach(p => console.log(chalk.gray(`   ✓ ${p}`)));
      } else {
        displayError('Forge failed', 'No components were successfully generated.');
      }
      
    } catch (error: any) {
      spinner.stop();
      displayError('Forge failed', error.message);
    }
  }
  
  /**
   * Show success message with tool details
   */
  showSuccess(result: any): void {
    const manifest = result.manifest || {};
    
    console.log(boxen(
      chalk.bold.green('🔥 Tool Forged Successfully!\n\n') +
      chalk.gray('Hash: ') + chalk.cyan(result.content_hash?.slice(0, 32) + '...') + '\n' +
      chalk.gray('Name: ') + manifest.name + '\n' +
      chalk.gray('Version: ') + (manifest.version || '1.0.0') + '\n' +
      chalk.gray('Entry: ') + (manifest.entry_point || 'main') + '\n\n' +
      (manifest.parameters?.length > 0 
        ? chalk.bold('Parameters:\n') + 
          manifest.parameters.map((p: any) => 
            `  ${chalk.cyan(p.name)}: ${p.type} - ${p.description || ''}`
          ).join('\n')
        : '') +
      '\n\n' +
      chalk.gray('The tool is now available in the registry and can be used by the agent.'),
      {
        padding: 1,
        borderColor: 'green',
        title: 'Success'
      }
    ));
    
    console.log(chalk.gray('\nUse with: ') + chalk.cyan(`agentforge tools --info ${result.content_hash?.slice(0, 16)}`));
    console.log();
  }
  
  /**
   * Quick forge from command line description
   */
  async quickForge(description: string): Promise<void> {
    // Parse description to extract name if possible
    const nameMatch = description.match(/^(\w+):\s*/);
    let name, purpose;
    
    if (nameMatch) {
      name = nameMatch[1];
      purpose = description.slice(nameMatch[0].length);
    } else {
      name = `tool_${Date.now().toString(36)}`;
      purpose = description;
    }
    
    await this.generate({
      name,
      purpose,
      inputs: 'Infer from purpose',
      outputs: 'Infer from purpose'
    });
  }
}

export default ForgeUI;
