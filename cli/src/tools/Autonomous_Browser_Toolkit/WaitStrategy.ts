import { ToolResult } from '../index';
import chalk from 'chalk';

interface WaitStrategyArgs {
  browserId: string;
  tabId?: string;
  strategy: 'element' | 'navigation' | 'network_idle' | 'timeout' | 'function';
  selector?: string;
  timeout?: number;
  waitFunction?: string;
  pollInterval?: number;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
}

export async function WaitStrategy(args: WaitStrategyArgs, options: any = {}): Promise<ToolResult> {
  try {
    const { 
      browserId, 
      tabId, 
      strategy, 
      selector, 
      timeout = 30000,
      waitFunction,
      pollInterval = 100,
      state = 'visible'
    } = args;

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

    const startTime = Date.now();

    switch (strategy) {
      case 'element': {
        if (!selector) {
          return new ToolResult(false, 'selector is required for element wait strategy');
        }

        await page.waitForSelector(selector, { 
          timeout,
          visible: state === 'visible',
          hidden: state === 'hidden'
        });

        const elapsed = Date.now() - startTime;
        return new ToolResult(true, `Element "${selector}" became ${state}`, {
          selector,
          state,
          elapsedMs: elapsed,
          url: page.url()
        });
      }

      case 'navigation': {
        await page.waitForNavigation({ timeout, waitUntil: 'networkidle2' });
        const elapsed = Date.now() - startTime;
        return new ToolResult(true, 'Navigation completed', {
          url: page.url(),
          title: await page.title(),
          elapsedMs: elapsed
        });
      }

      case 'network_idle': {
        await page.waitForNetworkIdle({ timeout });
        const elapsed = Date.now() - startTime;
        return new ToolResult(true, 'Network became idle', {
          url: page.url(),
          elapsedMs: elapsed
        });
      }

      case 'timeout': {
        await new Promise(resolve => setTimeout(resolve, timeout));
        return new ToolResult(true, `Waited for ${timeout}ms`, {
          timeoutMs: timeout
        });
      }

      case 'function': {
        if (!waitFunction) {
          return new ToolResult(false, 'waitFunction is required for function wait strategy');
        }

        await page.waitForFunction(waitFunction, { timeout, polling: pollInterval });
        const elapsed = Date.now() - startTime;
        return new ToolResult(true, 'Custom wait condition met', {
          function: waitFunction,
          elapsedMs: elapsed,
          url: page.url()
        });
      }

      default:
        return new ToolResult(false, `Unknown strategy: ${strategy}`);
    }

  } catch (error: any) {
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return new ToolResult(false, `Wait timeout exceeded: ${error.message}`, {
        strategy: args.strategy,
        timeout: args.timeout
      });
    }
    return new ToolResult(false, `Wait strategy failed: ${error.message}`);
  }
}

// Metadata
(WaitStrategy as any).description = "Intelligent waiting strategies for dynamic content including waiting for elements to appear/disappear, network idle state, page navigation, custom JavaScript conditions, or simple time-based delays";
(WaitStrategy as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  strategy: { type: 'string', description: 'Wait strategy: element, navigation, network_idle, timeout, or function', required: true },
  selector: { type: 'string', description: 'CSS selector for element strategy', required: false },
  timeout: { type: 'number', description: 'Maximum wait time in milliseconds (default: 30000)', required: false },
  waitFunction: { type: 'string', description: 'JavaScript function code for function strategy (should return boolean)', required: false },
  pollInterval: { type: 'number', description: 'Polling interval in ms for function strategy (default: 100)', required: false },
  state: { type: 'string', description: 'Element state to wait for: attached, detached, visible, or hidden (default: visible)', required: false }
};

export default WaitStrategy;
