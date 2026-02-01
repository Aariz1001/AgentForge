import { ToolResult } from '../index';
import type { Browser, Page, Response } from 'playwright';

// Browser instance registry (managed by BrowserManager tool or similar)
const browserInstances = new Map<string, Browser>();

interface NavigatorArgs {
  action: 'goto' | 'back' | 'forward' | 'refresh';
  browserId: string;
  url?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
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
  const { action, browserId, url, waitUntil = 'load', timeout = 30000 } = args;

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
    // Get browser instance from registry
    const browser = browserInstances.get(browserId);
    if (!browser) {
      return new ToolResult(
        false,
        `Browser instance '${browserId}' not found. Create a browser instance first using BrowserManager tool.`
      );
    }

    // Check if browser is still connected
    if (!browser.isConnected()) {
      return new ToolResult(
        false,
        `Browser instance '${browserId}' is disconnected. Please create a new browser instance.`
      );
    }

    // Get the active page
    const pages: Page[] = browser.contexts().flatMap(context => context.pages());
    if (pages.length === 0) {
      return new ToolResult(
        false,
        `No active pages found in browser instance '${browserId}'. Create a new page first.`
      );
    }
    const page: Page = pages[0];

    const startTime = Date.now();
    let response: Response | null = null;
    let navigationError: string | null = null;

    // Perform navigation action
    try {
      switch (action) {
        case 'goto':
          response = await page.goto(url!, {
            waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle',
            timeout: timeout
          });
          break;

        case 'back':
          response = await page.goBack({
            waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle',
            timeout: timeout
          });
          if (response === null) {
            navigationError = "Cannot go back: no previous page in history";
          }
          break;

        case 'forward':
          response = await page.goForward({
            waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle',
            timeout: timeout
          });
          if (response === null) {
            navigationError = "Cannot go forward: no next page in history";
          }
          break;

        case 'refresh':
          response = await page.reload({
            waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle',
            timeout: timeout
          });
          break;
      }
    } catch (navError: unknown) {
      navigationError = navError instanceof Error ? navError.message : String(navError);
    }

    const loadTime = Date.now() - startTime;

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
      navigationError,
      timestamp: new Date().toISOString()
    };

    if (navigationError) {
      return new ToolResult(
        false,
        `Navigation ${action} failed: ${navigationError}`,
        data
      );
    }

    const summary = `Successfully navigated ${action === 'goto' ? `to ${url}` : action}. ` +
      `Final URL: ${finalUrl} | Title: "${pageTitle}" | Load time: ${loadTime}ms` +
      (statusCode ? ` | Status: ${statusCode}` : '');

    return new ToolResult(true, summary, data);

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
    description: "Navigation action to perform: 'goto' (navigate to URL), 'back' (go back in history), 'forward' (go forward in history), 'refresh' (reload current page)",
    required: true,
    enum: ['goto', 'back', 'forward', 'refresh']
  },
  browserId: {
    type: "string",
    description: "Unique identifier of the browser instance to perform navigation on",
    required: true
  },
  url: {
    type: "string",
    description: "Target URL to navigate to (required only for 'goto' action). Must include protocol (http:// or https://)",
    required: false
  },
  waitUntil: {
    type: "string",
    description: "When to consider navigation successful: 'load' (full page load including resources), 'domcontentloaded' (DOM is ready), 'networkidle' (no network activity for 500ms). Default: 'load'",
    required: false,
    enum: ['load', 'domcontentloaded', 'networkidle'],
    default: 'load'
  },
  timeout: {
    type: "number",
    description: "Maximum time in milliseconds to wait for navigation (0-300000). Default: 30000 (30 seconds)",
    required: false,
    default: 30000
  }
};

// Browser instance registry management functions
export function registerBrowserInstance(browserId: string, browser: Browser): void {
  browserInstances.set(browserId, browser);
}

export function unregisterBrowserInstance(browserId: string): boolean {
  return browserInstances.delete(browserId);
}

export function getBrowserInstance(browserId: string): Browser | undefined {
  return browserInstances.get(browserId);
}

export function listBrowserInstances(): string[] {
  return Array.from(browserInstances.keys());
}

export default Navigator;