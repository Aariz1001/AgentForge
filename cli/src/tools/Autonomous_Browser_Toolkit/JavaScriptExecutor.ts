import { ToolResult } from '../index';
import chalk from 'chalk';

interface JavaScriptExecutorArgs {
  browserId: string;
  tabId?: string;
  script: string;
  args?: any[];
  returnType?: 'value' | 'json' | 'string';
}

export async function JavaScriptExecutor(args: JavaScriptExecutorArgs, options: any = {}): Promise<ToolResult> {
  try {
    const { browserId, tabId, script, args: scriptArgs = [], returnType = 'value' } = args;

    if (!script || script.trim() === '') {
      return new ToolResult(false, 'Script is required');
    }

    // Import dynamically to avoid circular dependencies
    const { getBrowserRegistry } = await import('./BrowserController');
    const registry = getBrowserRegistry();
    const instance = registry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser instance ${browserId} not found`);
    }

    const page = tabId ? instance.pages.get(tabId) : Array.from(instance.pages.values())[0];
    if (!page) {
      return new ToolResult(false, 'No active page found');
    }

    // Execute the script in the page context
    const result = await page.evaluate((scriptCode, evalArgs) => {
      try {
        // Create a function from the script code
        const func = new Function('args', `
          "use strict";
          ${scriptCode}
        `);
        return { success: true, result: func(evalArgs) };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }, script, scriptArgs);

    if (!result.success) {
      return new ToolResult(false, `JavaScript execution error: ${result.error}`);
    }

    // Format the result based on returnType
    let formattedResult = result.result;
    if (returnType === 'json') {
      formattedResult = JSON.stringify(result.result, null, 2);
    } else if (returnType === 'string') {
      formattedResult = String(result.result);
    }

    return new ToolResult(true, 'JavaScript executed successfully', {
      result: formattedResult,
      type: typeof result.result,
      url: page.url()
    });

  } catch (error: any) {
    return new ToolResult(false, `JavaScript execution failed: ${error.message}`);
  }
}

// Metadata
(JavaScriptExecutor as any).description = "Execute arbitrary JavaScript code in the page context for advanced automation, data manipulation, custom interactions, or accessing browser APIs not directly exposed by other tools";
(JavaScriptExecutor as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  script: { type: 'string', description: 'JavaScript code to execute in page context', required: true },
  args: { type: 'array', description: 'Arguments to pass to the script (accessible as args parameter)', required: false },
  returnType: { type: 'string', description: 'How to format the return value: value (default), json, or string', required: false }
};

export default JavaScriptExecutor;
