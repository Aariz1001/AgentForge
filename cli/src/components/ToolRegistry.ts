/**
 * Tool Registry Component
 * =======================
 * UI for browsing and managing registered tools.
 */

import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import Table from 'cli-table3';

import { BackendClient } from '../services/BackendClient';
import { ConfigManager } from '../services/ConfigManager';
import { displayError, sectionHeader, formatPath } from '../utils/display';
import { tools as builtinTools } from '../tools/index';

export class ToolRegistry {
  private config: any;
  private client: BackendClient;

  constructor(options: any = {}) {
    this.config = options.config || new ConfigManager();
    this.client = new BackendClient(this.config);
  }
  
  /**
   * List all tools (builtin + registered)
   */
  async list(): Promise<void> {
    sectionHeader('Tool Registry');
    
    // Show builtin tools first
    console.log(chalk.bold('\n📦 Built-in Tools\n'));
    
    const builtinTable = new Table({
      head: [
        chalk.cyan('Name'),
        chalk.cyan('Description'),
        chalk.cyan('Type')
      ],
      colWidths: [15, 45, 10],
      style: { head: [], border: ['gray'] }
    });
    
    const builtinToolNames = new Set(Object.keys(builtinTools));
    
    for (const [name, tool] of Object.entries(builtinTools)) {
      const source = (tool as any).source;
      const type = source ? (source === 'forged-core' ? 'local forged' : source) : 'builtin';
      
      // We skip local forged tools here to show them in their own section later
      if (type === 'local forged') continue;

      builtinTable.push([
        chalk.green(name),
        (tool as any).description,
        chalk.gray(type)
      ]);
    }
    
    console.log(builtinTable.toString());

    // Show local forged tools (from dynamicTools)
    const localForgedTools = Object.entries(builtinTools)
      .filter(([_, tool]) => (tool as any).source === 'forged-core');

    if (localForgedTools.length > 0) {
      console.log(chalk.bold('\n💾 Local Forged Tools\n'));
      
      const localTable = new Table({
        head: [
          chalk.cyan('Name'),
          chalk.cyan('Description'),
          chalk.cyan('Path')
        ],
        colWidths: [15, 45, 15],
        style: { head: [], border: ['gray'] }
      });

      for (const [name, tool] of localForgedTools) {
        localTable.push([
          chalk.green(name),
          (tool as any).description,
          chalk.gray(`${name}.ts`)
        ]);
      }
      console.log(localTable.toString());
    }
    
    // Try to fetch registered tools from backend
    console.log(chalk.bold('\n🌐 Remote Forged Tools (Backend)\n'));
    
    const spinner = ora('Loading registered tools...').start();
    
    try {
      const response: any = await this.client.listTools({ limit: 50 });
      spinner.stop();
      
      if (!response || !response.tools || response.tools.length === 0) {
        console.log(chalk.gray('  No forged tools registered yet.\n'));
        console.log(chalk.gray('  Use `agentforge forge` to create new tools.\n'));
        return;
      }
      
      const registeredTable = new Table({
        head: [
          chalk.cyan('Name'),
          chalk.cyan('Status'),
          chalk.cyan('PRB'),
          chalk.cyan('Type')
        ],
        colWidths: [20, 12, 8, 12],
        style: { head: [], border: ['gray'] }
      });
      
      let duplicateCount = 0;
      for (const tool of response.tools) {
        // Skip if already listed as built-in to avoid confusion
        if (builtinToolNames.has(tool.name)) {
          duplicateCount++;
          continue;
        }

        const status = this.formatStatus(tool.status);
        const prb = this.formatPRB(tool.manifest?.prb_overall);
        
        registeredTable.push([
          chalk.green(tool.name),
          status,
          prb,
          chalk.yellow('forged')
        ]);
      }
      
      console.log(registeredTable.toString());
      if (duplicateCount > 0) {
        console.log(chalk.gray(`\n  Note: ${duplicateCount} tools shadowed by built-in versions`));
      }
      console.log(chalk.gray(`  Total: ${response.tools.length - duplicateCount} unique forged tools\n`));
      
    } catch (error) {
      spinner.stop();
      console.log(chalk.gray('  No forged tools registered yet.\n'));
      console.log(chalk.gray('  Backend not available. Start it to access forged tools.\n'));
    }
  }
  
  /**
   * Search tools by query
   */
  async search(query: string): Promise<void> {
    sectionHeader(`Search: "${query}"`);
    
    // Search builtin tools
    const builtinMatches = Object.entries(builtinTools)
      .filter(([name, tool]) => 
        name.includes(query.toLowerCase()) ||
        (tool as any).description.toLowerCase().includes(query.toLowerCase())
      );
    
    if (builtinMatches.length > 0) {
      console.log(chalk.bold('\n📦 Built-in & Local Matches\n'));
      
      for (const [name, tool] of builtinMatches) {
        const source = (tool as any).source === 'forged-core' ? chalk.yellow('[local]') : chalk.gray('[core]');
        console.log(`  ${chalk.green(name.padEnd(15))} ${source} ${(tool as any).description}`);
      }
    }
    
    // Search registered tools
    console.log(chalk.bold('\n🌐 Remote Forged Matches (Backend)\n'));
    
    const spinner = ora('Searching remote tools...').start();
    
    try {
      const response: any = await this.client.listTools({ search: query, limit: 20 });
      spinner.stop();
      
      if (response.tools && response.tools.length > 0) {
        console.log(chalk.bold('\n🔥 Forged Matches\n'));
        
        for (const tool of response.tools) {
          const status = this.formatStatus(tool.status);
          console.log(`  ${chalk.green(tool.name.padEnd(15))} ${status} ${tool.description?.slice(0, 40) || ''}`);
        }
      }
      
      const totalMatches = builtinMatches.length + (response.tools?.length || 0);
      console.log(chalk.gray(`\n  Found ${totalMatches} matching tools\n`));
      
    } catch (error) {
      spinner.stop();
      
      if (builtinMatches.length === 0) {
        console.log(chalk.gray('\n  No matching tools found.\n'));
      } else {
        console.log(chalk.gray('\n  (Backend search unavailable)\n'));
      }
    }
  }
  
  /**
   * Show detailed info about a tool
   */
  async showInfo(identifier: string): Promise<void> {
    // Check if it's a builtin tool
    const builtin = (builtinTools as any)[identifier];
    
    if (builtin) {
      this.showBuiltinInfo(identifier, builtin);
      return;
    }
    
    // Try to fetch from registry
    const spinner = ora('Loading tool info...').start();
    
    try {
      const tool: any = await this.client.getTool(identifier);
      spinner.stop();
      
      this.showForgedInfo(tool);
      
    } catch (error) {
      spinner.stop();
      displayError(`Tool not found: ${identifier}`);
    }
  }
  
  showBuiltinInfo(name: string, tool: any): void {
    const type = tool.source === 'forged-core' ? chalk.yellow('(local forged)') : chalk.gray('(built-in)');
    console.log(boxen(
      chalk.bold.green(name) + ' ' + type + '\n\n' +
      chalk.white(tool.description) + '\n\n' +
      chalk.bold('Parameters:\n') +
      Object.entries(tool.parameters)
        .map(([key, spec]: [string, any]) => {
          const required = spec.required ? chalk.red('*') : '';
          const defaultVal = spec.default !== undefined 
            ? chalk.gray(` = ${JSON.stringify(spec.default)}`)
            : '';
          return `  ${chalk.cyan(key)}${required}: ${spec.type}${defaultVal}`;
        })
        .join('\n'),
      {
        padding: 1,
        borderColor: 'green',
        title: 'Tool Info'
      }
    ));
  }
  
  showForgedInfo(tool: any): void {
    const manifest = tool.manifest || {};
    const prb = manifest.prb_scores || {};
    
    let content = chalk.bold.green(tool.name) + chalk.gray(' (forged)') + '\n\n';
    content += chalk.white(tool.description || 'No description') + '\n\n';
    
    content += chalk.bold('Details:\n');
    content += `  ${chalk.gray('Hash:')} ${tool.content_hash?.slice(0, 32)}...\n`;
    content += `  ${chalk.gray('Version:')} ${tool.version || '1.0.0'}\n`;
    content += `  ${chalk.gray('Status:')} ${this.formatStatus(tool.status)}\n`;
    content += `  ${chalk.gray('Author:')} ${tool.author || 'forge'}\n`;
    content += `  ${chalk.gray('Created:')} ${tool.created_at}\n\n`;
    
    if (Object.keys(prb).length > 0) {
      content += chalk.bold('PRB Scores:\n');
      for (const [dimension, score] of Object.entries(prb)) {
        const bar = this.formatPRBBar(score as number);
        content += `  ${chalk.gray(dimension.padEnd(15))} ${bar}\n`;
      }
      content += '\n';
    }
    
    if (manifest.parameters && manifest.parameters.length > 0) {
      content += chalk.bold('Parameters:\n');
      for (const param of manifest.parameters) {
        const required = param.required ? chalk.red('*') : '';
        content += `  ${chalk.cyan(param.name)}${required}: ${param.type} - ${param.description || ''}\n`;
      }
    }
    
    console.log(boxen(content, {
      padding: 1,
      borderColor: 'yellow',
      title: 'Forged Tool Info'
    }));
  }
  
  formatStatus(status: string): string {
    const statusColors: Record<string, any> = {
      'validated': chalk.green,
      'active': chalk.green,
      'pending': chalk.yellow,
      'pending_validation': chalk.yellow,
      'failed': chalk.red,
      'revoked': chalk.red,
      'deprecated': chalk.gray
    };
    
    const colorFn = statusColors[status] || chalk.white;
    return colorFn(status || 'unknown');
  }
  
  formatPRB(score: number | undefined | null): string {
    if (score === undefined || score === null) {
      return chalk.gray('-');
    }
    
    const percentage = Math.round(score * 100);
    
    if (percentage >= 80) {
      return chalk.green(`${percentage}%`);
    } else if (percentage >= 60) {
      return chalk.yellow(`${percentage}%`);
    } else {
      return chalk.red(`${percentage}%`);
    }
  }
  
  formatPRBBar(score: number, width = 20): string {
    const filled = Math.round(score * width);
    const empty = width - filled;
    
    let color;
    if (score >= 0.8) color = chalk.green;
    else if (score >= 0.6) color = chalk.yellow;
    else color = chalk.red;
    
    const bar = color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    return `${bar} ${Math.round(score * 100)}%`;
  }
}


export default ToolRegistry;
