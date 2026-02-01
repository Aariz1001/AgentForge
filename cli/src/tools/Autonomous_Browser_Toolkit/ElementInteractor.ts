import { Page, ElementHandle } from 'playwright';

/**
 * ElementInteractor Tool for Autonomous Browser Toolkit
 * 
 * Comprehensive element finding and interaction capabilities for AI agents.
 * Supports multiple selector strategies, robust error handling, and rich element information.
 */

// ========== Type Definitions ==========

export type ActionType = 'click' | 'type' | 'hover' | 'select' | 'check' | 'uncheck' | 'drag' | 'scroll_to';

export interface ElementInteractorInput {
  action: ActionType;
  browserId: string;
  selector?: string;
  xpath?: string;
  text?: string;
  value?: string;
  options?: string[];
  coordinates?: { x: number; y: number };
  waitForElement?: boolean;
  timeout?: number;
  captureScreenshot?: boolean;
}

export interface ElementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementProperties {
  tagName: string;
  text: string;
  value?: string;
  href?: string;
  src?: string;
  id?: string;
  className?: string;
  attributes: Record<string, string>;
  position: ElementPosition;
  isVisible: boolean;
}

export interface ElementInteractionResult {
  success: boolean;
  action: ActionType;
  element?: ElementProperties;
  elementAfter?: ElementProperties;
  screenshot?: string;
  message: string;
  error?: string;
  warnings?: string[];
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// ========== Browser Session Manager ==========

class BrowserSessionManager {
  private static sessions = new Map<string, Page>();

  static registerSession(id: string, page: Page): void {
    this.sessions.set(id, page);
  }

  static getSession(id: string): Page | undefined {
    return this.sessions.get(id);
  }

  static removeSession(id: string): void {
    this.sessions.delete(id);
  }

  static hasSession(id: string): boolean {
    return this.sessions.has(id);
  }
}

// ========== Element Finder ==========

class ElementFinder {
  /**
   * Find element using multiple strategies
   */
  static async findElement(
    page: Page,
    selector?: string,
    xpath?: string,
    text?: string,
    timeout: number = 30000
  ): Promise<ElementHandle | null> {
    try {
      // Strategy 1: CSS Selector
      if (selector) {
        const element = await page.waitForSelector(selector, { timeout, state: 'attached' });
        return element;
      }

      // Strategy 2: XPath
      if (xpath) {
        const locator = page.locator(`xpath=${xpath}`).first();
        await locator.waitFor({ timeout, state: 'attached' });
        return await locator.elementHandle();
      }

      // Strategy 3: Text Content
      if (text) {
        const locator = page.getByText(text, { exact: false }).first();
        await locator.waitFor({ timeout, state: 'attached' });
        return await locator.elementHandle();
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract comprehensive element properties
   */
  static async getElementProperties(element: ElementHandle): Promise<ElementProperties> {
    const properties = await element.evaluate((el: Element) => {
      const rect = el.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(el);
      const isVisible = computedStyle.display !== 'none' && 
                       computedStyle.visibility !== 'hidden' && 
                       computedStyle.opacity !== '0' &&
                       rect.width > 0 && 
                       rect.height > 0;

      const attributes: Record<string, string> = {};
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        attributes[attr.name] = attr.value;
      }

      return {
        tagName: el.tagName.toLowerCase(),
        text: el.textContent?.trim() || '',
        value: (el as HTMLInputElement).value,
        href: (el as HTMLAnchorElement).href,
        src: (el as HTMLImageElement).src,
        id: el.id,
        className: el.className,
        attributes,
        position: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        isVisible,
      };
    });

    return properties;
  }
}

// ========== Element Interactor ==========

export class ElementInteractor {
  /**
   * Perform element interaction actions
   */
  static async interact(input: ElementInteractorInput): Promise<ToolResult> {
    const warnings: string[] = [];

    try {
      // Validate input
      const validationError = this.validateInput(input);
      if (validationError) {
        return {
          success: false,
          error: validationError,
        };
      }

      // Get browser session
      const page = BrowserSessionManager.getSession(input.browserId);
      if (!page) {
        return {
          success: false,
          error: `Browser session '${input.browserId}' not found. Please create a browser session first.`,
        };
      }

      // Set defaults
      const timeout = input.timeout ?? 30000;
      const waitForElement = input.waitForElement ?? true;

      // Find element (if not coordinate-based action)
      let element: ElementHandle | null = null;
      let elementBefore: ElementProperties | undefined;

      if (input.action !== 'click' || !input.coordinates) {
        const findTimeout = waitForElement ? timeout : 1000;
        element = await ElementFinder.findElement(
          page,
          input.selector,
          input.xpath,
          input.text,
          findTimeout
        );

        if (!element) {
          const selectorDesc = input.selector || input.xpath || input.text;
          return {
            success: false,
            error: waitForElement
              ? `Element not found within ${timeout}ms. Selector: ${selectorDesc}`
              : `Element not found. Selector: ${selectorDesc}`,
          };
        }

        // Capture element state before interaction
        elementBefore = await ElementFinder.getElementProperties(element);

        // Warn if element is not visible
        if (!elementBefore.isVisible) {
          warnings.push('Element is not visible. Interaction may fail.');
        }
      }

      // Perform action
      const actionResult = await this.performAction(page, element, input);
      if (!actionResult.success) {
        return {
          success: false,
          error: actionResult.error,
        };
      }

      // Capture element state after interaction
      let elementAfter: ElementProperties | undefined;
      if (element) {
        try {
          elementAfter = await ElementFinder.getElementProperties(element);
        } catch {
          warnings.push('Could not capture element state after interaction (element may have been removed).');
        }
      }

      // Capture screenshot if requested
      let screenshot: string | undefined;
      if (input.captureScreenshot && element) {
        try {
          const screenshotBuffer = await element.screenshot({ type: 'png' });
          screenshot = screenshotBuffer.toString('base64');
        } catch (error) {
          warnings.push('Could not capture element screenshot.');
        }
      }

      // Build result
      const result: ElementInteractionResult = {
        success: true,
        action: input.action,
        element: elementBefore,
        elementAfter,
        screenshot,
        message: actionResult.message,
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      return {
        success: true,
        data: result,
        metadata: {
          browserId: input.browserId,
          action: input.action,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Unexpected error during element interaction: ${error.message}`,
        metadata: {
          browserId: input.browserId,
          action: input.action,
        },
      };
    }
  }

  /**
   * Validate input parameters
   */
  private static validateInput(input: ElementInteractorInput): string | null {
    if (!input.action) {
      return 'Action is required';
    }

    const validActions: ActionType[] = ['click', 'type', 'hover', 'select', 'check', 'uncheck', 'drag', 'scroll_to'];
    if (!validActions.includes(input.action)) {
      return `Invalid action. Must be one of: ${validActions.join(', ')}`;
    }

    if (!input.browserId) {
      return 'browserId is required';
    }

    // Validate element selector is provided (unless clicking coordinates)
    if (input.action === 'click' && input.coordinates) {
      // Coordinate click is valid
    } else if (!input.selector && !input.xpath && !input.text) {
      return 'At least one of selector, xpath, or text must be provided';
    }

    // Action-specific validation
    if (input.action === 'type' && !input.value) {
      return 'value is required for type action';
    }

    if (input.action === 'select' && (!input.options || input.options.length === 0)) {
      return 'options array is required for select action';
    }

    if (input.action === 'drag' && !input.coordinates) {
      return 'coordinates are required for drag action';
    }

    return null;
  }

  /**
   * Perform the specified action
   */
  private static async performAction(
    page: Page,
    element: ElementHandle | null,
    input: ElementInteractorInput
  ): Promise<{ success: true; message: string } | { success: false; error: string }> {
    try {
      switch (input.action) {
        case 'click':
          if (input.coordinates) {
            await page.mouse.click(input.coordinates.x, input.coordinates.y);
            return { success: true, message: `Clicked at coordinates (${input.coordinates.x}, ${input.coordinates.y})` };
          } else if (element) {
            await element.click();
            return { success: true, message: 'Element clicked successfully' };
          }
          return { success: false, error: 'No element or coordinates provided for click' };

        case 'type':
          if (!element) return { success: false, error: 'Element not found' };
          if (!input.value) return { success: false, error: 'No value provided for typing' };
          
          await element.click({ clickCount: 3 });
          await page.keyboard.press('Backspace');
          await element.fill(input.value);
          
          return { success: true, message: `Typed "${input.value}" into element` };

        case 'hover':
          if (!element) return { success: false, error: 'Element not found' };
          await element.hover();
          return { success: true, message: 'Hovered over element' };

        case 'select':
          if (!element) return { success: false, error: 'Element not found' };
          if (!input.options || input.options.length === 0) {
            return { success: false, error: 'No options provided for select' };
          }
          
          await element.selectOption(input.options);
          return { success: true, message: `Selected options: ${input.options.join(', ')}` };

        case 'check':
          if (!element) return { success: false, error: 'Element not found' };
          await element.check();
          return { success: true, message: 'Element checked' };

        case 'uncheck':
          if (!element) return { success: false, error: 'Element not found' };
          await element.uncheck();
          return { success: true, message: 'Element unchecked' };

        case 'drag':
          if (!element) return { success: false, error: 'Element not found' };
          if (!input.coordinates) return { success: false, error: 'No target coordinates provided' };
          
          const box = await element.boundingBox();
          if (!box) return { success: false, error: 'Could not get element position' };
          
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(input.coordinates.x, input.coordinates.y);
          await page.mouse.up();
          return { success: true, message: `Dragged element to (${input.coordinates.x}, ${input.coordinates.y})` };

        case 'scroll_to':
          if (!element) return { success: false, error: 'Element not found' };
          await element.scrollIntoViewIfNeeded();
          return { success: true, message: 'Scrolled element into view' };

        default:
          return { success: false, error: `Unknown action: ${input.action}` };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Action '${input.action}' failed: ${error.message}`,
      };
    }
  }

  /**
   * Register a browser page with a session ID
   */
  static registerBrowserSession(id: string, page: Page): void {
    BrowserSessionManager.registerSession(id, page);
  }

  /**
   * Remove a browser session
   */
  static removeBrowserSession(id: string): void {
    BrowserSessionManager.removeSession(id);
  }

  /**
   * Check if a browser session exists
   */
  static hasBrowserSession(id: string): boolean {
    return BrowserSessionManager.hasSession(id);
  }
}

// ========== Exports ==========

export default ElementInteractor;

// Tool metadata for AI agents
export const ElementInteractorMetadata = {
  name: 'ElementInteractor',
  description: 'Find and interact with page elements using CSS selectors, XPath, or text content. Supports click, type, hover, select, check, uncheck, drag, and scroll_to actions.',
  version: '1.0.0',
  category: 'browser-automation',
  capabilities: [
    'Multiple element finding strategies (CSS, XPath, text)',
    'Comprehensive element interaction actions',
    'Rich element property extraction',
    'Before/after state comparison',
    'Optional element screenshots',
    'Robust error handling and validation',
    'Visibility detection and warnings',
  ],
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'type', 'hover', 'select', 'check', 'uncheck', 'drag', 'scroll_to'],
        description: 'The interaction action to perform',
      },
      browserId: {
        type: 'string',
        description: 'Browser session identifier',
      },
      selector: {
        type: 'string',
        description: 'CSS selector to find the element',
      },
      xpath: {
        type: 'string',
        description: 'XPath expression to find the element',
      },
      text: {
        type: 'string',
        description: 'Text content to match for finding the element',
      },
      value: {
        type: 'string',
        description: 'Text to type (required for type action)',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Options to select (required for select action)',
      },
      coordinates: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        description: 'Target coordinates for click or drag actions',
      },
      waitForElement: {
        type: 'boolean',
        default: true,
        description: 'Whether to wait for element to appear',
      },
      timeout: {
        type: 'number',
        default: 30000,
        description: 'Timeout in milliseconds for element finding',
      },
      captureScreenshot: {
        type: 'boolean',
        default: false,
        description: 'Whether to capture element screenshot',
      },
    },
    required: ['action', 'browserId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      data: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          element: { type: 'object', description: 'Element properties before interaction' },
          elementAfter: { type: 'object', description: 'Element properties after interaction' },
          screenshot: { type: 'string', description: 'Base64-encoded element screenshot' },
          message: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      error: { type: 'string' },
      metadata: { type: 'object' },
    },
  },
  examples: [
    {
      description: 'Click a button by CSS selector',
      input: {
        action: 'click',
        browserId: 'browser-1',
        selector: 'button.submit-btn',
      },
    },
    {
      description: 'Type text into an input field',
      input: {
        action: 'type',
        browserId: 'browser-1',
        selector: '#email-input',
        value: 'user@example.com',
      },
    },
    {
      description: 'Find element by text and click',
      input: {
        action: 'click',
        browserId: 'browser-1',
        text: 'Sign In',
      },
    },
    {
      description: 'Select dropdown option',
      input: {
        action: 'select',
        browserId: 'browser-1',
        selector: 'select#country',
        options: ['USA'],
      },
    },
  ],
};