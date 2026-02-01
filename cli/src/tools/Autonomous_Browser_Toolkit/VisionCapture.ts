import { ToolResult } from '../index';
import chalk from 'chalk';

interface VisionCaptureArgs {
  browserId: string;
  tabId?: string;
  captureType: 'fullpage' | 'viewport' | 'element';
  selector?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
  omitBackground?: boolean;
}

export async function VisionCapture(args: VisionCaptureArgs, options: any = {}): Promise<ToolResult> {
  try {
    const { 
      browserId, 
      tabId, 
      captureType = 'viewport',
      selector,
      format = 'png',
      quality = 90,
      omitBackground = false
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

    let screenshot: Buffer;
    let metadata: any = {
      url: page.url(),
      format,
      quality: format === 'jpeg' ? quality : undefined,
      timestamp: new Date().toISOString()
    };

    switch (captureType) {
      case 'fullpage':
        screenshot = await page.screenshot({
          fullPage: true,
          type: format,
          quality: format === 'jpeg' ? quality : undefined,
          omitBackground
        }) as Buffer;
        
        const dimensions = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight
        }));
        metadata.width = dimensions.width;
        metadata.height = dimensions.height;
        metadata.captureType = 'fullpage';
        break;

      case 'viewport':
        screenshot = await page.screenshot({
          type: format,
          quality: format === 'jpeg' ? quality : undefined,
          omitBackground
        }) as Buffer;
        
        const viewport = page.viewport();
        metadata.width = viewport?.width || 1280;
        metadata.height = viewport?.height || 720;
        metadata.captureType = 'viewport';
        break;

      case 'element':
        if (!selector) {
          return new ToolResult(false, 'selector is required for element capture type');
        }

        const element = await page.$(selector);
        if (!element) {
          return new ToolResult(false, `Element not found: ${selector}`);
        }

        const boundingBox = await element.boundingBox();
        if (!boundingBox) {
          return new ToolResult(false, `Element has no bounding box: ${selector}`);
        }

        screenshot = await element.screenshot({
          type: format,
          quality: format === 'jpeg' ? quality : undefined,
          omitBackground
        }) as Buffer;

        metadata.selector = selector;
        metadata.width = Math.round(boundingBox.width);
        metadata.height = Math.round(boundingBox.height);
        metadata.x = Math.round(boundingBox.x);
        metadata.y = Math.round(boundingBox.y);
        metadata.captureType = 'element';
        break;

      default:
        return new ToolResult(false, `Unknown capture type: ${captureType}`);
    }

    // Convert to base64
    const base64 = screenshot.toString('base64');
    const dataUrl = `data:image/${format};base64,${base64}`;

    metadata.size = screenshot.length;
    metadata.sizeKB = (screenshot.length / 1024).toFixed(2);

    return new ToolResult(true, `Screenshot captured: ${captureType} (${metadata.width}x${metadata.height}, ${metadata.sizeKB}KB)`, {
      screenshot: base64,
      dataUrl,
      metadata
    });

  } catch (error: any) {
    return new ToolResult(false, `Vision capture failed: ${error.message}`);
  }
}

// Metadata
(VisionCapture as any).description = "Capture screenshots of web pages for agent vision analysis - supports full page, viewport, or element-specific captures with configurable formats (PNG/JPEG) and returns base64 encoded images";
(VisionCapture as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  captureType: { type: 'string', description: 'Capture type: fullpage, viewport, or element', required: true },
  selector: { type: 'string', description: 'CSS selector for element capture type', required: false },
  format: { type: 'string', description: 'Image format: png or jpeg (default: png)', required: false },
  quality: { type: 'number', description: 'JPEG quality 0-100 (default: 90)', required: false },
  omitBackground: { type: 'boolean', description: 'Omit white background for transparency (default: false)', required: false }
};

export default VisionCapture;
