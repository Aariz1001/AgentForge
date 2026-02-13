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
  action: 'launch' | 'open' | 'start' | 'close' | 'quit' | 'exit' | 'get_tabs' | 'tabs' | 'list_tabs' | 'switch_tab' | 'new_tab' | 'close_tab' | 'relaunch' | 'restart' | 'reopen' | 'relaunch_headed' | 'status' | 'get_status' | 'list_browsers' | 'list' | 'close_all' | 'shutdown_all' | 'ensure_tab' | 'focus';
  browserId?: string;
  headless?: boolean;
  profile?: string;
  userAgent?: string;
  windowSize?: WindowSize;
  tabId?: string;
  url?: string;
  reuseBlankTab?: boolean;
  includeTabDetails?: boolean;
}

interface BrowserInstance {
  id: string;
  browser: Browser;
  pages: Map<string, Page>;
  profile?: string;
  headless: boolean;
  userAgent?: string;
  windowSize: WindowSize;
  createdAt: Date;
  lastActiveTabId?: string;
}

interface TabInfo {
  tabId: string;
  url: string;
  title: string;
  isClosed?: boolean;
}

const browserRegistry: Map<string, BrowserInstance> = new Map();

let cleanupRegistered = false;

function resolveBrowserId(browserId?: string): { browserId?: string; error?: string } {
  if (browserId) {
    if (!browserRegistry.has(browserId)) {
      return { error: `Browser with ID ${browserId} not found` };
    }
    return { browserId };
  }

  const activeIds = Array.from(browserRegistry.keys());
  if (activeIds.length === 1) {
    return { browserId: activeIds[0] };
  }

  if (activeIds.length === 0) {
    return { error: 'No active browser instances found. Launch a browser first.' };
  }

  return { error: `browserId is required because ${activeIds.length} browser instances are active: ${activeIds.join(', ')}` };
}

async function collectTabInfo(instance: BrowserInstance): Promise<TabInfo[]> {
  const tabs: TabInfo[] = [];
  for (const [tabId, page] of instance.pages.entries()) {
    try {
      const isClosed = page.isClosed();
      tabs.push({
        tabId,
        url: isClosed ? 'closed' : page.url(),
        title: isClosed ? 'Tab closed' : await page.title(),
        isClosed,
      });
    } catch (error: any) {
      tabs.push({
        tabId,
        url: 'unknown',
        title: `Error: ${error.message}`,
        isClosed: true,
      });
    }
  }
  return tabs;
}

function browserCapabilities() {
  return {
    multiTab: true,
    sessionProfiles: true,
    headedMode: true,
    headlessMode: true,
    autoResolution: true,
    actions: ['launch', 'close', 'get_tabs', 'switch_tab', 'new_tab', 'close_tab', 'relaunch', 'status', 'list_browsers', 'close_all', 'ensure_tab']
  };
}

async function normalizePageView(page: Page, windowSize: WindowSize): Promise<void> {
  try {
    await page.setViewport({
      width: windowSize.width,
      height: windowSize.height,
      deviceScaleFactor: 1
    });
  } catch {
    // Ignore viewport errors
  }

  try {
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1';
      document.body.style.zoom = '1';
    });
  } catch {
    // Ignore zoom errors
  }
}

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
    let action = args.action;

    if (action === 'open' || action === 'start') action = 'launch';
    if (action === 'quit' || action === 'exit') action = 'close';
    if (action === 'tabs' || action === 'list_tabs') action = 'get_tabs';
    if (action === 'restart' || action === 'reopen') action = 'relaunch';
    if (action === 'relaunch_headed') {
      action = 'relaunch';
      args.headless = false;
    }
    if (action === 'get_status') action = 'status';
    if (action === 'list') action = 'list_browsers';
    if (action === 'shutdown_all') action = 'close_all';
    if (action === 'focus') action = 'switch_tab';

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

      case 'relaunch':
        return await relaunchBrowser(args);

      case 'status':
        return await getBrowserStatus(args);

      case 'list_browsers':
        return await listBrowsers(args);

      case 'close_all':
        return await closeAllBrowsers();

      case 'ensure_tab':
        return await ensureTab(args);
      
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

    const requestedId = args.browserId;
    if (requestedId && browserRegistry.has(requestedId)) {
      return new ToolResult(false, `Browser ID ${requestedId} already exists`);
    }

    const browserId = requestedId || crypto.randomBytes(8).toString('hex');
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
        '--force-device-scale-factor=1',
        '--high-dpi-support=1',
        '--disable-features=UseZoomForDSF',
        `--window-size=${windowSize.width},${windowSize.height}`,
      ],
      defaultViewport: headless ? {
        width: windowSize.width,
        height: windowSize.height,
        deviceScaleFactor: 1
      } : null,
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

      await normalizePageView(pages[i], windowSize);
    }

    const tabIds = Array.from(pageMap.keys());

    const instance: BrowserInstance = {
      id: browserId,
      browser,
      pages: pageMap,
      profile,
      headless,
      userAgent,
      windowSize,
      createdAt: new Date(),
      lastActiveTabId: tabIds[0],
    };

    browserRegistry.set(browserId, instance);

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
        capabilities: browserCapabilities(),
        recommendation: 'Use ensure_tab + status/get_tabs to quickly get a ready tab and inspect context.'
      }
    );
  } catch (error: any) {
    return new ToolResult(false, `Failed to launch browser: ${error.message}`);
  }
}

async function relaunchBrowser(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const resolved = resolveBrowserId(args.browserId);
    if (!resolved.browserId) {
      return new ToolResult(false, resolved.error || 'Unable to resolve browserId for relaunch action');
    }
    const browserId = resolved.browserId;

    const instance = browserRegistry.get(browserId);
    if (!instance) {
      return new ToolResult(false, `Browser with ID ${browserId} not found`);
    }

    const profile = args.profile ?? instance.profile;
    const userAgent = args.userAgent ?? instance.userAgent;
    const windowSize = args.windowSize ?? instance.windowSize;
    const headless = args.headless ?? instance.headless;

    try {
      await instance.browser.close();
    } catch {
      // ignore close errors
    }

    browserRegistry.delete(browserId);

    return await launchBrowser({
      action: 'launch',
      browserId,
      headless,
      profile,
      userAgent,
      windowSize,
    });
  } catch (error: any) {
    return new ToolResult(false, `Failed to relaunch browser: ${error.message}`);
  }
}

async function closeBrowser(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const resolved = resolveBrowserId(args.browserId);
    if (!resolved.browserId) {
      return new ToolResult(false, resolved.error || 'Unable to resolve browserId for close action');
    }
    const browserId = resolved.browserId;

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
    const resolved = resolveBrowserId(args.browserId);
    if (!resolved.browserId) {
      return new ToolResult(false, resolved.error || 'Unable to resolve browserId for get_tabs action');
    }
    const browserId = resolved.browserId;

    const instance = browserRegistry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser with ID ${browserId} not found`);
    }

    const tabs = await collectTabInfo(instance);
    const openTabs = tabs.filter(t => !t.isClosed).length;

    return new ToolResult(
      true,
      `Retrieved ${tabs.length} tabs for browser ${browserId}`,
      {
        browserId,
        tabs,
        count: tabs.length,
        openTabs,
        closedTabs: tabs.length - openTabs,
        activeTabId: instance.lastActiveTabId,
      }
    );
  } catch (error: any) {
    return new ToolResult(false, `Failed to get tabs: ${error.message}`);
  }
}

async function switchTab(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const resolved = resolveBrowserId(args.browserId);
    if (!resolved.browserId) {
      return new ToolResult(false, resolved.error || 'Unable to resolve browserId for switch_tab action');
    }
    const browserId = resolved.browserId;
    const tabId = args.tabId;

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
    instance.lastActiveTabId = tabId;

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
    const resolved = resolveBrowserId(args.browserId);
    if (!resolved.browserId) {
      return new ToolResult(false, resolved.error || 'Unable to resolve browserId for new_tab action');
    }
    const browserId = resolved.browserId;
    const url = args.url || 'about:blank';
    const reuseBlankTab = args.reuseBlankTab !== false;

    const instance = browserRegistry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser with ID ${browserId} not found`);
    }

    let page: Page;
    let tabId: string;
    let reused = false;

    if (reuseBlankTab) {
      const reusable = Array.from(instance.pages.entries()).find(([_, candidate]) => !candidate.isClosed() && candidate.url() === 'about:blank');
      if (reusable) {
        [tabId, page] = reusable;
        reused = true;
      } else {
        page = await instance.browser.newPage();
        tabId = `tab-${crypto.randomBytes(4).toString('hex')}`;
        instance.pages.set(tabId, page);
      }
    } else {
      page = await instance.browser.newPage();
      tabId = `tab-${crypto.randomBytes(4).toString('hex')}`;
      instance.pages.set(tabId, page);
    }
    
    if (instance.userAgent) {
      await page.setUserAgent(instance.userAgent);
    }

    await normalizePageView(page, instance.windowSize);
    
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

    instance.lastActiveTabId = tabId;

    return new ToolResult(
      true,
      `${reused ? 'Reused' : 'Created'} tab ${tabId} in browser ${browserId}`,
      {
        browserId,
        tabId,
        url: page.url(),
        title: await page.title(),
        reused,
      }
    );
  } catch (error: any) {
    return new ToolResult(false, `Failed to create new tab: ${error.message}`);
  }
}

async function closeTab(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const resolved = resolveBrowserId(args.browserId);
    if (!resolved.browserId) {
      return new ToolResult(false, resolved.error || 'Unable to resolve browserId for close_tab action');
    }
    const browserId = resolved.browserId;
    const tabId = args.tabId;

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
    if (instance.lastActiveTabId === tabId) {
      instance.lastActiveTabId = Array.from(instance.pages.keys())[0];
    }

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

async function getBrowserStatus(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const resolved = resolveBrowserId(args.browserId);
    if (!resolved.browserId) {
      return new ToolResult(false, resolved.error || 'Unable to resolve browserId for status action');
    }
    const browserId = resolved.browserId;
    const instance = browserRegistry.get(browserId)!;

    const tabs = args.includeTabDetails === false ? undefined : await collectTabInfo(instance);
    const openTabs = tabs ? tabs.filter(t => !t.isClosed).length : Array.from(instance.pages.values()).filter(p => !p.isClosed()).length;

    return new ToolResult(true, `Browser ${browserId} status retrieved`, {
      browserId,
      connected: instance.browser.isConnected(),
      headless: instance.headless,
      profile: instance.profile,
      userAgent: instance.userAgent,
      windowSize: instance.windowSize,
      createdAt: instance.createdAt.toISOString(),
      uptimeMs: Date.now() - instance.createdAt.getTime(),
      tabCount: instance.pages.size,
      openTabs,
      activeTabId: instance.lastActiveTabId,
      tabs,
      capabilities: browserCapabilities(),
    });
  } catch (error: any) {
    return new ToolResult(false, `Failed to get browser status: ${error.message}`);
  }
}

async function listBrowsers(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const includeTabDetails = args.includeTabDetails !== false;
    const rows = [] as any[];

    for (const [browserId, instance] of browserRegistry.entries()) {
      const tabs = includeTabDetails ? await collectTabInfo(instance) : undefined;
      rows.push({
        browserId,
        connected: instance.browser.isConnected(),
        headless: instance.headless,
        profile: instance.profile,
        createdAt: instance.createdAt.toISOString(),
        uptimeMs: Date.now() - instance.createdAt.getTime(),
        tabCount: instance.pages.size,
        activeTabId: instance.lastActiveTabId,
        tabs,
      });
    }

    return new ToolResult(true, `Found ${rows.length} active browser instance(s)`, {
      count: rows.length,
      browsers: rows,
      capabilities: browserCapabilities(),
    });
  } catch (error: any) {
    return new ToolResult(false, `Failed to list browsers: ${error.message}`);
  }
}

async function closeAllBrowsers(): Promise<ToolResult> {
  const closed: string[] = [];
  const failed: Array<{ browserId: string; error: string }> = [];

  for (const [browserId, instance] of Array.from(browserRegistry.entries())) {
    try {
      await instance.browser.close();
      browserRegistry.delete(browserId);
      closed.push(browserId);
    } catch (error: any) {
      failed.push({ browserId, error: error.message });
    }
  }

  if (failed.length > 0) {
    return new ToolResult(false, `Closed ${closed.length} browser(s), failed to close ${failed.length}`, {
      closed,
      failed,
      remaining: Array.from(browserRegistry.keys()),
    });
  }

  return new ToolResult(true, `Closed ${closed.length} browser(s)`, {
    closed,
    remaining: Array.from(browserRegistry.keys()),
  });
}

async function ensureTab(args: BrowserControllerArgs): Promise<ToolResult> {
  try {
    const resolved = resolveBrowserId(args.browserId);
    if (!resolved.browserId) {
      return new ToolResult(false, resolved.error || 'Unable to resolve browserId for ensure_tab action');
    }
    const browserId = resolved.browserId;
    const instance = browserRegistry.get(browserId)!;

    let tabId = args.tabId;
    let page: Page | undefined;
    let created = false;

    if (tabId) {
      page = instance.pages.get(tabId);
      if (page?.isClosed()) {
        page = undefined;
      }
    }

    if (!page && instance.lastActiveTabId) {
      const activePage = instance.pages.get(instance.lastActiveTabId);
      if (activePage && !activePage.isClosed()) {
        tabId = instance.lastActiveTabId;
        page = activePage;
      }
    }

    if (!page) {
      const firstOpen = Array.from(instance.pages.entries()).find(([_, p]) => !p.isClosed());
      if (firstOpen) {
        [tabId, page] = firstOpen;
      }
    }

    if (!page) {
      page = await instance.browser.newPage();
      tabId = `tab-${crypto.randomBytes(4).toString('hex')}`;
      instance.pages.set(tabId, page);
      created = true;
      if (instance.userAgent) {
        await page.setUserAgent(instance.userAgent);
      }
      await normalizePageView(page, instance.windowSize);
    }

    if (args.url && args.url !== 'about:blank') {
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    await page.bringToFront();
    instance.lastActiveTabId = tabId;

    return new ToolResult(true, `Ready tab ${tabId} in browser ${browserId}`, {
      browserId,
      tabId,
      created,
      url: page.url(),
      title: await page.title(),
      recommendation: 'Use Navigator and ElementInteractor with this tabId for deterministic multi-step flows.',
    });
  } catch (error: any) {
    return new ToolResult(false, `Failed to ensure tab: ${error.message}`);
  }
}

(BrowserController as any).description = "Launch, manage, and control browser instances with support for multiple profiles, headless/headed modes, and session persistence";
(BrowserController as any).parameters = {
  action: {
    type: "string",
    description: "Action to perform: launch/open/start, close/quit/exit, get_tabs/tabs/list_tabs, switch_tab/focus, new_tab, close_tab, relaunch/restart/reopen/relaunch_headed, status/get_status, list_browsers/list, close_all/shutdown_all, or ensure_tab",
    required: true,
    enum: ['launch', 'open', 'start', 'close', 'quit', 'exit', 'get_tabs', 'tabs', 'list_tabs', 'switch_tab', 'focus', 'new_tab', 'close_tab', 'relaunch', 'restart', 'reopen', 'relaunch_headed', 'status', 'get_status', 'list_browsers', 'list', 'close_all', 'shutdown_all', 'ensure_tab']
  },
  browserId: {
    type: "string",
    description: "Browser instance ID. Optional when exactly one browser is active (auto-resolved).",
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
    description: "URL to open (for 'new_tab' or 'ensure_tab').",
    required: false
  },
  reuseBlankTab: {
    type: "boolean",
    description: "For new_tab, reuse an existing about:blank tab if available (default: true)",
    required: false,
    default: true
  },
  includeTabDetails: {
    type: "boolean",
    description: "Include full tab details for status/list actions (default: true)",
    required: false
  }
};

export function getBrowserRegistry(): Map<string, BrowserInstance> {
  return browserRegistry;
}

export default BrowserController;