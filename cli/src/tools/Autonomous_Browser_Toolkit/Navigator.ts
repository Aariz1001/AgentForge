import { ToolResult } from '../index';
import type { Page, HTTPResponse } from 'puppeteer';
import * as crypto from 'crypto';
import { getBrowserRegistry } from './BrowserController';

interface NavigatorArgs {
  action: 'goto' | 'back' | 'forward' | 'refresh' | 'navigate' | 'open';
  browserId: string;
  tabId?: string;
  url?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
  autoWait?: boolean;
  autoWaitTimeout?: number;
}

interface NavigationData {
  action: string;
  browserId: string;
  finalUrl: string;
  pageTitle: string;
  loadTime: number;
  statusCode: number | null;
  statusText: string | null;
  waitUntil: string;
  timeout: number;
  autoWait: boolean;
  autoWaitTimeout: number;
  autoWaitStatus: 'completed' | 'skipped' | 'failed';
  navigationWarning: string | null;
  navigationError: string | null;
  timestamp: string;
}

interface ErrorData {
  action: string;
  browserId: string;
  url?: string;
  error: string;
  stack?: string;
}

export async function Navigator(args: NavigatorArgs): Promise<ToolResult> {
  let { action, browserId, tabId, url, waitUntil = 'domcontentloaded', timeout = 15000, autoWait = true, autoWaitTimeout = 5000 } = args;

  const clampTimeout = (value: number) => Math.min(Math.max(value, 3000), 45000);
  timeout = clampTimeout(timeout);
  autoWaitTimeout = clampTimeout(autoWaitTimeout);

  if (action === 'navigate' || action === 'open') {
    action = 'goto';
  }

  // Validate required parameters
  if (!action) {
    return new ToolResult(false, "Missing required parameter: action");
  }

  if (!browserId) {
    return new ToolResult(false, "Missing required parameter: browserId");
  }

  if (action === 'goto' && !url) {
    return new ToolResult(false, "URL is required for 'goto' action");
  }

  // Validate action type
  const validActions: ReadonlyArray<string> = ['goto', 'back', 'forward', 'refresh'];
  if (!validActions.includes(action)) {
    return new ToolResult(false, `Invalid action: ${action}. Must be one of: ${validActions.join(', ')}`);
  }

  // Validate waitUntil parameter
  const validWaitUntil: ReadonlyArray<string> = ['load', 'domcontentloaded', 'networkidle'];
  if (!validWaitUntil.includes(waitUntil)) {
    return new ToolResult(false, `Invalid waitUntil: ${waitUntil}. Must be one of: ${validWaitUntil.join(', ')}`);
  }

  // Validate timeout
  if (timeout < 0) {
    return new ToolResult(false, "Timeout must be a positive number");
  }

  if (timeout > 300000) {
    return new ToolResult(false, "Timeout must not exceed 300000ms (5 minutes)");
  }

  try {
    const registry = getBrowserRegistry();
    const instance = registry.get(browserId);

    if (!instance) {
      return new ToolResult(
        false,
        `Browser instance '${browserId}' not found. Create a browser instance first using BrowserController tool.`
      );
    }

    if (!instance.browser.isConnected()) {
      return new ToolResult(
        false,
        `Browser instance '${browserId}' is disconnected. Please create a new browser instance.`
      );
    }

    let page: Page | undefined;

    if (tabId) {
      page = instance.pages.get(tabId);
      if (!page) {
        return new ToolResult(
          false,
          `Tab with ID '${tabId}' not found in browser instance '${browserId}'.`
        );
      }
    } else {
      const firstOpen = Array.from(instance.pages.values()).find(p => !p.isClosed());
      page = firstOpen;
    }

    if (!page || page.isClosed()) {
      const newPage = await instance.browser.newPage();
      const newTabId = `tab-${crypto.randomBytes(4).toString('hex')}`;
      instance.pages.set(newTabId, newPage);
      page = newPage;
      tabId = newTabId;
    }

    const startTime = Date.now();
    let response: HTTPResponse | null = null;
    let navigationError: string | null = null;
    let navigationWarning: string | null = null;

    const puppeteerWaitUntil = waitUntil === 'networkidle' ? 'networkidle2' : waitUntil;

    // Perform navigation action
    try {
      switch (action) {
        case 'goto':
          response = await page.goto(url!, {
            waitUntil: puppeteerWaitUntil as 'load' | 'domcontentloaded' | 'networkidle2',
            timeout: timeout
          });
          break;

        case 'back':
          response = await page.goBack({
            waitUntil: puppeteerWaitUntil as 'load' | 'domcontentloaded' | 'networkidle2',
            timeout: timeout
          });
          if (response === null) {
            navigationError = "Cannot go back: no previous page in history";
          }
          break;

        case 'forward':
          response = await page.goForward({
            waitUntil: puppeteerWaitUntil as 'load' | 'domcontentloaded' | 'networkidle2',
            timeout: timeout
          });
          if (response === null) {
            navigationError = "Cannot go forward: no next page in history";
          }
          break;

        case 'refresh':
          response = await page.reload({
            waitUntil: puppeteerWaitUntil as 'load' | 'domcontentloaded' | 'networkidle2',
            timeout: timeout
          });
          break;
      }
    } catch (navError: unknown) {
      navigationError = navError instanceof Error ? navError.message : String(navError);
    }

    const loadTime = Date.now() - startTime;

    // Fallback when navigation timed out but page is usable
    if (navigationError && /timeout/i.test(navigationError)) {
      try {
        const readyState = await page.evaluate(() => document.readyState);
        if (readyState === 'interactive' || readyState === 'complete') {
          navigationWarning = `Navigation timed out but document is ${readyState}.`;
          navigationError = null;
        }
      } catch {
        // ignore
      }
    }

    // Optional auto-wait to let content settle
    let autoWaitStatus: 'completed' | 'skipped' | 'failed' = 'skipped';
    if (autoWait) {
      try {
        await page.waitForNetworkIdle({ timeout: autoWaitTimeout });
        autoWaitStatus = 'completed';
      } catch {
        autoWaitStatus = 'failed';
      }
    }

    // Get final page information
    const finalUrl = page.url();
    let pageTitle = '';
    try {
      pageTitle = await page.title();
    } catch {
      pageTitle = 'Unable to retrieve title';
    }

    // Get HTTP status if available
    const statusCode = response ? response.status() : null;
    const statusText = response ? response.statusText() : null;

    const data: NavigationData = {
      action,
      browserId,
      finalUrl,
      pageTitle,
      loadTime,
      statusCode,
      statusText,
      waitUntil,
      timeout,
      autoWait,
      autoWaitTimeout,
      autoWaitStatus,
      navigationWarning,
      navigationError,
      timestamp: new Date().toISOString()
    };

    if (navigationError) {
      return new ToolResult(
        false,
        `Navigation ${action} failed: ${navigationError}`,
        { ...data, tabId }
      );
    }

    const warningSuffix = navigationWarning ? ` | Warning: ${navigationWarning}` : '';
    const summary = `Successfully navigated ${action === 'goto' ? `to ${url}` : action}. ` +
      `Final URL: ${finalUrl} | Title: "${pageTitle}" | Load time: ${loadTime}ms` +
      (statusCode ? ` | Status: ${statusCode}` : '') +
      (tabId ? ` | Tab: ${tabId}` : '') +
      warningSuffix;

    return new ToolResult(true, summary, { ...data, tabId });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    const errorData: ErrorData = {
      action,
      browserId,
      url,
      error: errorMessage,
      stack: errorStack
    };

    return new ToolResult(
      false,
      `Navigator tool failed: ${errorMessage}`,
      errorData
    );
  }
}

// Metadata for AgentForge tool system
(Navigator as any).description = "Navigate to URLs, go back/forward, refresh pages, and wait for page loads with intelligent timeout handling";

(Navigator as any).parameters = {
  action: {
    type: "string",
    description: "Navigation action: 'goto' (aliases: navigate/open), 'back', 'forward', 'refresh'",
    required: true,
    enum: ['goto', 'navigate', 'open', 'back', 'forward', 'refresh']
  },
  browserId: {
    type: "string",
    description: "Unique identifier of the browser instance to perform navigation on",
    required: true
  },
  tabId: {
    type: "string",
    description: "Tab ID to navigate (optional; if omitted, the first available tab is used)",
    required: false
  },
  url: {
    type: "string",
    description: "Target URL to navigate to (required only for 'goto' action). Must include protocol (http:// or https://)",
    required: false
  },
  waitUntil: {
    type: "string",
    description: "When to consider navigation successful: 'load' (full page load including resources), 'domcontentloaded' (DOM is ready), 'networkidle' (no network activity for 500ms). Default: 'domcontentloaded'",
    required: false,
    enum: ['load', 'domcontentloaded', 'networkidle'],
    default: 'domcontentloaded'
  },
  timeout: {
    type: "number",
    description: "Maximum time in milliseconds to wait for navigation (0-300000). Default: 30000 (30 seconds)",
    required: false,
    default: 30000
  },
  autoWait: {
    type: "boolean",
    description: "After navigation, wait briefly for network to go idle (helps dynamic pages)",
    required: false,
    default: true
  },
  autoWaitTimeout: {
    type: "number",
    description: "Timeout in milliseconds for auto-wait network idle step",
    required: false,
    default: 5000
  }
};

export default Navigator;