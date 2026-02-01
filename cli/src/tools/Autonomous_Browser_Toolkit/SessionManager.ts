import { ToolResult } from '../index';
import chalk from 'chalk';

interface SessionManagerArgs {
  browserId: string;
  tabId?: string;
  action: 'get_cookies' | 'set_cookies' | 'clear_cookies' | 'get_storage' | 'set_storage' | 'clear_storage' | 'export_session' | 'import_session';
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean }>;
  storageType?: 'localStorage' | 'sessionStorage';
  storageData?: Record<string, string>;
  key?: string;
  value?: string;
  sessionData?: any;
  maxItems?: number;
}

export async function SessionManager(args: SessionManagerArgs, options: any = {}): Promise<ToolResult> {
  try {
    const { browserId, tabId, action, cookies, storageType = 'localStorage', storageData, key, value, sessionData, maxItems = 200 } = args;

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

    switch (action) {
      case 'get_cookies': {
        const pageCookies = await page.cookies();
        return new ToolResult(true, `Retrieved ${pageCookies.length} cookie(s)`, { cookies: pageCookies });
      }

      case 'set_cookies': {
        if (!cookies || cookies.length === 0) {
          return new ToolResult(false, 'cookies array is required for set_cookies action');
        }
        await page.setCookie(...cookies);
        return new ToolResult(true, `Set ${cookies.length} cookie(s)`, { cookies });
      }

      case 'clear_cookies': {
        const currentCookies = await page.cookies();
        await page.deleteCookie(...currentCookies);
        return new ToolResult(true, `Cleared ${currentCookies.length} cookie(s)`);
      }

      case 'get_storage': {
        const storage = await page.evaluate((type, limit) => {
          const store = type === 'localStorage' ? window.localStorage : window.sessionStorage;
          const data: Record<string, string> = {};
          for (let i = 0; i < store.length && i < limit; i++) {
            const key = store.key(i);
            if (key) {
              data[key] = store.getItem(key) || '';
            }
          }
          return data;
        }, storageType, maxItems);

        return new ToolResult(true, `Retrieved ${Object.keys(storage).length} ${storageType} item(s)`, { 
          storageType,
          data: storage 
        });
      }

      case 'set_storage': {
        if (key && value) {
          await page.evaluate((type, k, v) => {
            const store = type === 'localStorage' ? window.localStorage : window.sessionStorage;
            store.setItem(k, v);
          }, storageType, key, value);
          return new ToolResult(true, `Set ${storageType} item: ${key}`);
        } else if (storageData) {
          const count = await page.evaluate((type, data) => {
            const store = type === 'localStorage' ? window.localStorage : window.sessionStorage;
            let count = 0;
            for (const [k, v] of Object.entries(data)) {
              store.setItem(k, String(v));
              count++;
            }
            return count;
          }, storageType, storageData);
          return new ToolResult(true, `Set ${count} ${storageType} item(s)`, { storageType });
        } else {
          return new ToolResult(false, 'Either key+value or storageData is required for set_storage');
        }
      }

      case 'clear_storage': {
        await page.evaluate((type) => {
          const store = type === 'localStorage' ? window.localStorage : window.sessionStorage;
          store.clear();
        }, storageType);
        return new ToolResult(true, `Cleared ${storageType}`);
      }

      case 'export_session': {
        const pageCookies = await page.cookies();
        const localStorage = await page.evaluate((limit) => {
          const data: Record<string, string> = {};
          for (let i = 0; i < window.localStorage.length && i < limit; i++) {
            const key = window.localStorage.key(i);
            if (key) {
              data[key] = window.localStorage.getItem(key) || '';
            }
          }
          return data;
        }, maxItems);
        const sessionStorage = await page.evaluate((limit) => {
          const data: Record<string, string> = {};
          for (let i = 0; i < window.sessionStorage.length && i < limit; i++) {
            const key = window.sessionStorage.key(i);
            if (key) {
              data[key] = window.sessionStorage.getItem(key) || '';
            }
          }
          return data;
        }, maxItems);

        const exportData = {
          url: page.url(),
          cookies: pageCookies,
          localStorage,
          sessionStorage,
          exportedAt: new Date().toISOString()
        };

        return new ToolResult(true, 'Session exported successfully', { session: exportData, maxItems });
      }

      case 'import_session': {
        if (!sessionData) {
          return new ToolResult(false, 'sessionData is required for import_session action');
        }

        // Import cookies
        if (sessionData.cookies && sessionData.cookies.length > 0) {
          await page.setCookie(...sessionData.cookies);
        }

        // Import localStorage
        if (sessionData.localStorage) {
          await page.evaluate((data) => {
            for (const [key, value] of Object.entries(data)) {
              window.localStorage.setItem(key, String(value));
            }
          }, sessionData.localStorage);
        }

        // Import sessionStorage
        if (sessionData.sessionStorage) {
          await page.evaluate((data) => {
            for (const [key, value] of Object.entries(data)) {
              window.sessionStorage.setItem(key, String(value));
            }
          }, sessionData.sessionStorage);
        }

        return new ToolResult(true, 'Session imported successfully', {
          cookiesImported: sessionData.cookies?.length || 0,
          localStorageItemsImported: Object.keys(sessionData.localStorage || {}).length,
          sessionStorageItemsImported: Object.keys(sessionData.sessionStorage || {}).length
        });
      }

      default:
        return new ToolResult(false, `Unknown action: ${action}`);
    }

  } catch (error: any) {
    return new ToolResult(false, `Session management failed: ${error.message}`);
  }
}

// Metadata
(SessionManager as any).description = "Manage browser cookies, localStorage, sessionStorage, and authentication state for persistent sessions across agent tasks. Export and import complete session data for session persistence and sharing";
(SessionManager as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  action: { type: 'string', description: 'Action: get_cookies, set_cookies, clear_cookies, get_storage, set_storage, clear_storage, export_session, import_session', required: true },
  cookies: { type: 'array', description: 'Array of cookie objects for set_cookies action', required: false },
  storageType: { type: 'string', description: 'Storage type: localStorage or sessionStorage (default: localStorage)', required: false },
  storageData: { type: 'object', description: 'Key-value pairs for set_storage action', required: false },
  key: { type: 'string', description: 'Storage key for set_storage action', required: false },
  value: { type: 'string', description: 'Storage value for set_storage action', required: false },
  sessionData: { type: 'object', description: 'Complete session data for import_session action', required: false },
  maxItems: { type: 'number', description: 'Max storage items to read/export per storage type (default: 200)', required: false }
};

export default SessionManager;
