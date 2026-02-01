import { ToolResult } from '../index';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

interface PageSnapshotArgs {
  browserId: string;
  tabId?: string;
  outputDir: string;
  includeHtml?: boolean;
  includeText?: boolean;
  includeScreenshot?: boolean;
  fullPageScreenshot?: boolean;
}

export async function PageSnapshot(args: PageSnapshotArgs): Promise<ToolResult> {
  try {
    const {
      browserId,
      tabId,
      outputDir,
      includeHtml = true,
      includeText = true,
      includeScreenshot = true,
      fullPageScreenshot = true
    } = args;

    if (!browserId) {
      return new ToolResult(false, 'browserId is required');
    }
    if (!outputDir) {
      return new ToolResult(false, 'outputDir is required');
    }

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

    await mkdir(outputDir, { recursive: true });

    const url = page.url();
    const title = await page.title().catch(() => '');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const manifest: any = { url, title, timestamp, files: {} };

    if (includeHtml) {
      const html = await page.content();
      const htmlPath = join(outputDir, `snapshot-${timestamp}.html`);
      await writeFile(htmlPath, html, 'utf-8');
      manifest.files.html = htmlPath;
    }

    if (includeText) {
      const text = await page.evaluate(() => {
        const main = document.querySelector('main') || document.querySelector('article') || document.body;
        return main?.innerText?.trim() || '';
      });
      const textPath = join(outputDir, `snapshot-${timestamp}.txt`);
      await writeFile(textPath, text, 'utf-8');
      manifest.files.text = textPath;
    }

    if (includeScreenshot) {
      const screenshotPath = join(outputDir, `snapshot-${timestamp}.png`);
      const screenshotBuffer = await page.screenshot({ fullPage: fullPageScreenshot, type: 'png' }) as Buffer;
      await writeFile(screenshotPath, screenshotBuffer);
      manifest.files.screenshot = screenshotPath;
    }

    const manifestPath = join(outputDir, `snapshot-${timestamp}.json`);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    return new ToolResult(true, `Snapshot saved to ${outputDir}`, { manifestPath, manifest });
  } catch (error: any) {
    return new ToolResult(false, `Page snapshot failed: ${error.message}`);
  }
}

(PageSnapshot as any).description = 'Save a full snapshot of the current page (HTML/text/screenshot) to a directory for auditing and reporting.';
(PageSnapshot as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  outputDir: { type: 'string', description: 'Directory to write snapshot files', required: true },
  includeHtml: { type: 'boolean', description: 'Include HTML snapshot (default: true)', required: false },
  includeText: { type: 'boolean', description: 'Include text snapshot (default: true)', required: false },
  includeScreenshot: { type: 'boolean', description: 'Include screenshot (default: true)', required: false },
  fullPageScreenshot: { type: 'boolean', description: 'Full page screenshot (default: true)', required: false }
};

export default PageSnapshot;
