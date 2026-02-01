import { ToolResult } from '../index';

interface CookieConsentDismissArgs {
  browserId: string;
  tabId?: string;
  maxClicks?: number;
}

const DEFAULT_SELECTORS = [
  'button[aria-label*="accept" i]',
  'button[aria-label*="agree" i]',
  'button[title*="accept" i]',
  'button[title*="agree" i]',
  'button#onetrust-accept-btn-handler',
  'button#onetrust-accept-btn-handler',
  'button[class*="accept" i]',
  'button[class*="agree" i]',
  'button[id*="accept" i]',
  'button[id*="agree" i]',
  '[data-testid*="accept" i]',
  '[data-testid*="agree" i]'
];

export async function CookieConsentDismiss(args: CookieConsentDismissArgs): Promise<ToolResult> {
  try {
    const { browserId, tabId, maxClicks = 3 } = args;

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

    const clicked = await page.evaluate(({ selectors, max }) => {
      const results: string[] = [];
      const clickEl = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        (el as HTMLElement).click();
        return true;
      };

      for (const selector of selectors) {
        const candidates = Array.from(document.querySelectorAll(selector));
        for (const el of candidates) {
          if (results.length >= max) break;
          if (clickEl(el)) results.push(selector);
        }
        if (results.length >= max) break;
      }

      if (results.length < max) {
        const textMatches = ['accept', 'agree', 'allow all', 'got it', 'ok'];
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
        for (const btn of buttons) {
          if (results.length >= max) break;
          const label = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
          if (textMatches.some(t => label.includes(t))) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              btn.click();
              results.push('text:' + label.slice(0, 40));
            }
          }
        }
      }

      return results;
    }, { selectors: DEFAULT_SELECTORS, max: maxClicks });

    if (!clicked || clicked.length === 0) {
      return new ToolResult(true, 'No cookie banner detected', { clicked: [] });
    }

    return new ToolResult(true, `Dismissed ${clicked.length} cookie banner(s)`, { clicked });
  } catch (error: any) {
    return new ToolResult(false, `Cookie consent dismiss failed: ${error.message}`);
  }
}

(CookieConsentDismiss as any).description = 'Dismiss common cookie consent banners by clicking accept/agree buttons.';
(CookieConsentDismiss as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  maxClicks: { type: 'number', description: 'Maximum clicks to attempt (default: 3)', required: false }
};

export default CookieConsentDismiss;
