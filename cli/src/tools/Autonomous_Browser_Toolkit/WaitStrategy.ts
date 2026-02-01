import { ToolResult } from '../index';
import chalk from 'chalk';

interface WaitStrategyArgs {
  browserId: string;
  tabId?: string;
  strategy: 'element' | 'navigation' | 'network_idle' | 'timeout' | 'function' | 'auto' | 'network' | 'networkidle' | 'nav' | 'navigate';
  selector?: string;
  timeout?: number;
  waitFunction?: string;
  pollInterval?: number;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
}

export async function WaitStrategy(args: WaitStrategyArgs, options: any = {}): Promise<ToolResult> {
  try {
    let { 
      browserId, 
      tabId, 
      strategy, 
      selector, 
      timeout = 15000,
      waitFunction,
      pollInterval = 100,
      state = 'visible'
    } = args;

    if (strategy === 'networkidle' || strategy === 'network') strategy = 'network_idle';
    if (strategy === 'nav' || strategy === 'navigate') strategy = 'navigation';

    const clampTimeout = (value: number) => Math.min(Math.max(value, 3000), 45000);
    const effectiveTimeout = clampTimeout(timeout);

    // Import dynamically to avoid circular dependencies
    const { getBrowserRegistry } = await import('./BrowserController');
    const registry = getBrowserRegistry();
    const instance = registry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser instance ${browserId} not found`);
    }

    const page = tabId ? instance.pages.get(tabId) : Array.from(instance.pages.values()).find(p => !p.isClosed());
    if (!page || page.isClosed()) {
      return new ToolResult(false, 'No active page found');
    }

    const startTime = Date.now();

    switch (strategy) {
      case 'element': {
        if (!selector) {
          return new ToolResult(false, 'selector is required for element wait strategy');
        }

        if (state === 'attached') {
          await page.waitForSelector(selector, { timeout: effectiveTimeout });
        } else if (state === 'detached') {
          await page.waitForSelector(selector, { timeout: effectiveTimeout, hidden: true });
        } else {
          await page.waitForSelector(selector, { 
            timeout: effectiveTimeout,
            visible: state === 'visible',
            hidden: state === 'hidden'
          });
        }

        const elapsed = Date.now() - startTime;
        return new ToolResult(true, `Element "${selector}" became ${state}`, {
          selector,
          state,
          elapsedMs: elapsed,
          url: page.url()
        });
      }

      case 'navigation': {
        await page.waitForNavigation({ timeout: effectiveTimeout, waitUntil: 'domcontentloaded' });
        const elapsed = Date.now() - startTime;
        return new ToolResult(true, 'Navigation completed', {
          url: page.url(),
          title: await page.title(),
          elapsedMs: elapsed
        });
      }

      case 'network_idle': {
        await page.waitForNetworkIdle({ timeout: effectiveTimeout });
        const elapsed = Date.now() - startTime;
        return new ToolResult(true, 'Network became idle', {
          url: page.url(),
          elapsedMs: elapsed
        });
      }

      case 'timeout': {
        await new Promise(resolve => setTimeout(resolve, effectiveTimeout));
        return new ToolResult(true, `Waited for ${effectiveTimeout}ms`, {
          timeoutMs: effectiveTimeout
        });
      }

      case 'function': {
        if (!waitFunction) {
          return new ToolResult(false, 'waitFunction is required for function wait strategy');
        }

        await page.waitForFunction(waitFunction, { timeout: effectiveTimeout, polling: pollInterval });
        const elapsed = Date.now() - startTime;
        return new ToolResult(true, 'Custom wait condition met', {
          function: waitFunction,
          elapsedMs: elapsed,
          url: page.url()
        });
      }

      case 'auto': {
        const steps: string[] = [];
        const endBy = Date.now() + effectiveTimeout;

        const remaining = () => Math.max(500, endBy - Date.now());

        try {
          await page.waitForFunction(() => document.readyState !== 'loading', { timeout: Math.min(5000, remaining()) });
          steps.push('dom_ready');
        } catch {
          // ignore
        }

        const selectors = selector ? [selector] : ['main', '[role="main"]', 'article', 'body'];
        let matchedSelector: string | null = null;
        for (const sel of selectors) {
          try {
            await page.waitForSelector(sel, { timeout: Math.min(3000, remaining()), visible: sel !== 'body' });
            matchedSelector = sel;
            steps.push(`element:${sel}`);
            break;
          } catch {
            // try next
          }
        }

        try {
          await page.waitForNetworkIdle({ timeout: Math.min(5000, remaining()) });
          steps.push('network_idle');
        } catch {
          // ignore
        }

        const elapsed = Date.now() - startTime;
        if (steps.length === 0) {
          return new ToolResult(false, 'Auto wait did not detect readiness signals', {
            elapsedMs: elapsed,
            url: page.url(),
          });
        }

        return new ToolResult(true, 'Auto wait completed', {
          steps,
          matchedSelector,
          elapsedMs: elapsed,
          url: page.url(),
        });
      }

      default:
        return new ToolResult(false, `Unknown strategy: ${strategy}`);
    }

  } catch (error: any) {
    const fallbackTimeout = Math.min(Math.max(args.timeout ?? 15000, 3000), 45000);
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return new ToolResult(false, `Wait timeout exceeded: ${error.message}`, {
        strategy: args.strategy,
        timeout: fallbackTimeout
      });
    }
    return new ToolResult(false, `Wait strategy failed: ${error.message}`);
  }
}

// Metadata
(WaitStrategy as any).description = "Intelligent waiting strategies for dynamic content including auto readiness detection, waiting for elements to appear/disappear, network idle state, page navigation, custom JavaScript conditions, or simple time-based delays";
(WaitStrategy as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  strategy: { type: 'string', description: 'Wait strategy: auto, element, navigation (alias: nav/navigate), network_idle (alias: network/networkidle), timeout, or function', required: true },
  selector: { type: 'string', description: 'CSS selector for element strategy', required: false },
  timeout: { type: 'number', description: 'Maximum wait time in milliseconds (default: 30000)', required: false },
  waitFunction: { type: 'string', description: 'JavaScript function code for function strategy (should return boolean)', required: false },
  pollInterval: { type: 'number', description: 'Polling interval in ms for function strategy (default: 100)', required: false },
  state: { type: 'string', description: 'Element state to wait for: attached, detached, visible, or hidden (default: visible)', required: false }
};

export default WaitStrategy;
