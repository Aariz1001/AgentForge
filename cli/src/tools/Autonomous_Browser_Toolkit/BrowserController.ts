import { ToolResult } from '../index';
import { Browser, Page } from 'puppeteer';
import * as puppeteer from 'puppeteer';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

interface WindowSize {
  width: number;
  height: number;
}

interface BrowserControllerArgs {
  action: 'launch' | 'close' | 'get_tabs' | 'switch_tab' | 'new_tab' | 'close_tab';
  browserId?: string;
  headless?: boolean;
  profile?: string;
  userAgent?: string;
  windowSize?: WindowSize;
  tabId?: string;
  url?: string;
}

interface BrowserInstance {
  id: string;
  browser: Browser;
  pages: Map<string, Page>;
  profile?: string;
  headless: boolean;
  userAgent?: string;
  createdAt: Date;
}

interface TabInfo {
  tabId: string;
  url: string;
  title: string;
}

const browserRegistry: Map<string, BrowserInstance> = new Map();

let cleanupRegistered = false;

function registerCleanup(): void {
  if (cleanupRegistered) return;
  
  const cleanup = async () => {
    const instances = Array.from(browserRegistry.values());
    for (const instance of instances) {
      try {
        await instance.browser.close();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    browserRegistry.clear();
  };

  process.on('exit', () => {
    cleanup().catch(() => {});
  });
  
  process.on('SIGINT', () => {
    cleanup().then(() => process.exit(0)).catch(() => process.exit(1));
  });
  
  process.on('SIGTERM', () => {
    cleanup().then(() => process.exit(0)).catch(() => process.exit(1));
  });

  cleanupRegistered = true;
}

export async function BrowserController(args: BrowserControllerArgs, options: any = {}): Promise<ToolResult> {
  try {
    const action = args.action;

    if (!action) {
      return new ToolResult(false, 'Action parameter is required');
    }

    switch (action) {
      case 'launch':
        return await launchBrowser(args);
      
      case 'close':
        return await closeBrowser(args);
      
      case 'get_tabs':
        return await getTabs(args);
      
      case 'switch_tab':
        return await switchTab(args);
      
      case 'new_tab':
        return await newTab(args);
      
      case 'close_tab':
        return await closeTab(args);
      
      default:
        return new ToolResult(false, `Unknown action: ${action}`);
    }
  } catch (error: any) {
    return new ToolResult(false, `BrowserController failed: ${error.message}`);
  }
}

async function launchBrowser(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    registerCleanup();

    const browserId = crypto.randomBytes(8).toString('hex');
    const headless = args.headless !== false;
    const profile = args.profile;
    const userAgent = args.userAgent;
    const windowSize = args.windowSize || { width: 1920, height: 1080 };

    if (windowSize.width < 100 || windowSize.width > 7680) {
      return new ToolResult(false, 'Window width must be between 100 and 7680 pixels');
    }
    if (windowSize.height < 100 || windowSize.height > 4320) {
      return new ToolResult(false, 'Window height must be between 100 and 4320 pixels');
    }

    const launchOptions: any = {
      headless: headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${windowSize.width},${windowSize.height}`,
      ],
      defaultViewport: {
        width: windowSize.width,
        height: windowSize.height,
      },
    };

    if (profile) {
      const userDataDir = path.join(os.tmpdir(), 'browser-profiles', profile);
      launchOptions.userDataDir = userDataDir;
    }

    const browser = await puppeteer.launch(launchOptions);
    const pages = await browser.pages();
    const pageMap = new Map<string, Page>();
    
    for (let i = 0; i < pages.length; i++) {
      const pageId = `tab-${i}`;
      pageMap.set(pageId, pages[i]);
      
      if (userAgent) {
        await pages[i].setUserAgent(userAgent);
      }
    }

    const instance: BrowserInstance = {
      id: browserId,
      browser,
      pages: pageMap,
      profile,
      headless,
      userAgent,
      createdAt: new Date(),
    };

    browserRegistry.set(browserId, instance);

    const tabIds = Array.from(pageMap.keys());

    return new ToolResult(
      true,
      `Browser launched successfully with ID: ${browserId}`,
      {
        browserId,
        headless,
        profile,
        tabIds,
        windowSize,
        userAgent,
        createdAt: instance.createdAt.toISOString(),
      }
    );
  } catch (error: any) {
    return new ToolResult(false, `Failed to launch browser: ${error.message}`);
  }
}

async function closeBrowser(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const browserId = args.browserId;

    if (!browserId) {
      return new ToolResult(false, 'browserId is required for close action');
    }

    const instance = browserRegistry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser with ID ${browserId} not found`);
    }

    await instance.browser.close();
    browserRegistry.delete(browserId);

    return new ToolResult(
      true,
      `Browser ${browserId} closed successfully`,
      { browserId, closedAt: new Date().toISOString() }
    );
  } catch (error: any) {
    return new ToolResult(false, `Failed to close browser: ${error.message}`);
  }
}

async function getTabs(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const browserId = args.browserId;

    if (!browserId) {
      return new ToolResult(false, 'browserId is required for get_tabs action');
    }

    const instance = browserRegistry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser with ID ${browserId} not found`);
    }

    const tabs: TabInfo[] = [];
    for (const [tabId, page] of instance.pages.entries()) {
      try {
        const isClosed = page.isClosed();
        if (isClosed) {
          tabs.push({
            tabId,
            url: 'closed',
            title: 'Tab closed',
          });
        } else {
          tabs.push({
            tabId,
            url: page.url(),
            title: await page.title(),
          });
        }
      } catch (error: any) {
        tabs.push({
          tabId,
          url: 'unknown',
          title: `Error: ${error.message}`,
        });
      }
    }

    return new ToolResult(
      true,
      `Retrieved ${tabs.length} tabs for browser ${browserId}`,
      { browserId, tabs, count: tabs.length }
    );
  } catch (error: any) {
    return new ToolResult(false, `Failed to get tabs: ${error.message}`);
  }
}

async function switchTab(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const browserId = args.browserId;
    const tabId = args.tabId;

    if (!browserId) {
      return new ToolResult(false, 'browserId is required for switch_tab action');
    }

    if (!tabId) {
      return new ToolResult(false, 'tabId is required for switch_tab action');
    }

    const instance = browserRegistry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser with ID ${browserId} not found`);
    }

    const page = instance.pages.get(tabId);

    if (!page) {
      return new ToolResult(false, `Tab with ID ${tabId} not found in browser ${browserId}`);
    }

    if (page.isClosed()) {
      return new ToolResult(false, `Tab ${tabId} is closed and cannot be switched to`);
    }

    await page.bringToFront();

    return new ToolResult(
      true,
      `Switched to tab ${tabId} in browser ${browserId}`,
      {
        browserId,
        tabId,
        url: page.url(),
        title: await page.title(),
      }
    );
  } catch (error: any) {
    return new ToolResult(false, `Failed to switch tab: ${error.message}`);
  }
}

async function newTab(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const browserId = args.browserId;
    const url = args.url || 'about:blank';

    if (!browserId) {
      return new ToolResult(false, 'browserId is required for new_tab action');
    }

    const instance = browserRegistry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser with ID ${browserId} not found`);
    }

    const page = await instance.browser.newPage();
    const tabId = `tab-${crypto.randomBytes(4).toString('hex')}`;
    
    if (instance.userAgent) {
      await page.setUserAgent(instance.userAgent);
    }
    
    instance.pages.set(tabId, page);

    if (url && url !== 'about:blank') {
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (error: any) {
        return new ToolResult(
          false,
          `Tab created but failed to navigate to ${url}: ${error.message}`,
          {
            browserId,
            tabId,
            url: page.url(),
            title: await page.title(),
          }
        );
      }
    }

    return new ToolResult(
      true,
      `New tab ${tabId} created in browser ${browserId}`,
      {
        browserId,
        tabId,
        url: page.url(),
        title: await page.title(),
      }
    );
  } catch (error: any) {
    return new ToolResult(false, `Failed to create new tab: ${error.message}`);
  }
}

async function closeTab(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const browserId = args.browserId;
    const tabId = args.tabId;

    if (!browserId) {
      return new ToolResult(false, 'browserId is required for close_tab action');
    }

    if (!tabId) {
      return new ToolResult(false, 'tabId is required for close_tab action');
    }

    const instance = browserRegistry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser with ID ${browserId} not found`);
    }

    const page = instance.pages.get(tabId);

    if (!page) {
      return new ToolResult(false, `Tab with ID ${tabId} not found in browser ${browserId}`);
    }

    if (!page.isClosed()) {
      await page.close();
    }
    instance.pages.delete(tabId);

    return new ToolResult(
      true,
      `Tab ${tabId} closed in browser ${browserId}`,
      {
        browserId,
        tabId,
        remainingTabs: Array.from(instance.pages.keys()),
      }
    );
  } catch (error: any) {
    return new ToolResult(false, `Failed to close tab: ${error.message}`);
  }
}

(BrowserController as any).description = "Launch, manage, and control browser instances with support for multiple profiles, headless/headed modes, and session persistence";
(BrowserController as any).parameters = {
  action: {
    type: "string",
    description: "Action to perform: 'launch', 'close', 'get_tabs', 'switch_tab', 'new_tab', or 'close_tab'",
    required: true,
    enum: ['launch', 'close', 'get_tabs', 'switch_tab', 'new_tab', 'close_tab']
  },
  browserId: {
    type: "string",
    description: "Browser instance ID (required for all actions except 'launch')",
    required: false
  },
  headless: {
    type: "boolean",
    description: "Run browser in headless mode (default: true, only for 'launch' action)",
    required: false
  },
  profile: {
    type: "string",
    description: "Browser profile name for session persistence (only for 'launch' action)",
    required: false
  },
  userAgent: {
    type: "string",
    description: "Custom user agent string (only for 'launch' action)",
    required: false
  },
  windowSize: {
    type: "object",
    description: "Browser window size with width and height properties (e.g., {width: 1920, height: 1080}). Only for 'launch' action",
    required: false,
    properties: {
      width: {
        type: "number",
        description: "Window width in pixels (100-7680)"
      },
      height: {
        type: "number",
        description: "Window height in pixels (100-4320)"
      }
    }
  },
  tabId: {
    type: "string",
    description: "Tab ID (required for 'switch_tab' and 'close_tab' actions)",
    required: false
  },
  url: {
    type: "string",
    description: "URL to open in new tab (only for 'new_tab' action, default: 'about:blank')",
    required: false
  }
};

export function getBrowserRegistry(): Map<string, BrowserInstance> {
  return browserRegistry;
}

export default BrowserController;