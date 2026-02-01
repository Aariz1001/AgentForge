import { ToolResult } from '../index';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, extname, join, basename } from 'path';

interface BrowserReportArgs {
  browserId: string;
  tabId?: string;
  outputPath: string;
  includeText?: boolean;
  maxTextChars?: number;
  includeLinks?: boolean;
  linkLimit?: number;
  includeScreenshot?: boolean;
  fullPageScreenshot?: boolean;
  screenshotPath?: string;
}

export async function BrowserReport(args: BrowserReportArgs): Promise<ToolResult> {
  try {
    const {
      browserId,
      tabId,
      outputPath,
      includeText = true,
      maxTextChars = 4000,
      includeLinks = true,
      linkLimit = 30,
      includeScreenshot = true,
      fullPageScreenshot = false,
      screenshotPath
    } = args;

    if (!browserId) {
      return new ToolResult(false, 'browserId is required');
    }
    if (!outputPath) {
      return new ToolResult(false, 'outputPath is required');
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

    const url = page.url();
    const title = await page.title().catch(() => '');
    const timestamp = new Date().toISOString();
    const viewport = page.viewport();

    let textContent = '';
    if (includeText) {
      const rawText = await page.evaluate(() => {
        const main = document.querySelector('main') || document.querySelector('article') || document.body;
        return main?.innerText?.trim() || '';
      });
      textContent = rawText.slice(0, maxTextChars);
    }

    let links: Array<{ text: string; href: string }> = [];
    if (includeLinks) {
      links = await page.evaluate((limit) => {
        const nodes = Array.from(document.querySelectorAll('a[href]')).slice(0, limit);
        return nodes.map(link => ({
          text: (link.textContent || '').trim(),
          href: (link as HTMLAnchorElement).href
        }));
      }, linkLimit);
    }

    let imagePath: string | null = null;
    if (includeScreenshot) {
      const outExt = extname(outputPath).toLowerCase();
      const base = outExt ? outputPath.slice(0, -outExt.length) : outputPath;
      imagePath = screenshotPath || `${base}.png`;
      const screenshotBuffer = await page.screenshot({
        fullPage: fullPageScreenshot,
        type: 'png'
      }) as Buffer;
      await mkdir(dirname(imagePath), { recursive: true });
      await writeFile(imagePath, screenshotBuffer);
    }

    await mkdir(dirname(outputPath), { recursive: true });

    const lines: string[] = [];
    lines.push(`# Browser Report`);
    lines.push('');
    lines.push(`- **Title:** ${title || 'Untitled'}`);
    lines.push(`- **URL:** ${url}`);
    lines.push(`- **Timestamp:** ${timestamp}`);
    if (viewport) {
      lines.push(`- **Viewport:** ${viewport.width}x${viewport.height}`);
    }

    if (imagePath) {
      const rel = basename(imagePath);
      lines.push('');
      lines.push(`![Screenshot](${rel})`);
    }

    if (includeText) {
      lines.push('');
      lines.push('## Extracted Text');
      lines.push('');
      lines.push(textContent || '_No text extracted._');
    }

    if (includeLinks) {
      lines.push('');
      lines.push('## Top Links');
      lines.push('');
      if (links.length === 0) {
        lines.push('_No links found._');
      } else {
        for (const link of links) {
          const label = link.text || link.href;
          lines.push(`- [${label}](${link.href})`);
        }
      }
    }

    await writeFile(outputPath, lines.join('\n'), 'utf-8');

    return new ToolResult(true, `Report written to ${outputPath}`, {
      outputPath,
      screenshotPath: imagePath,
      url,
      title,
      timestamp
    });
  } catch (error: any) {
    return new ToolResult(false, `Browser report failed: ${error.message}`);
  }
}

(BrowserReport as any).description = 'Generate a markdown report from the active browser tab, with optional text extraction, links, and screenshot.';
(BrowserReport as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  outputPath: { type: 'string', description: 'Path to write the markdown report file', required: true },
  includeText: { type: 'boolean', description: 'Include extracted page text (default: true)', required: false },
  maxTextChars: { type: 'number', description: 'Max characters of text to include (default: 4000)', required: false },
  includeLinks: { type: 'boolean', description: 'Include top links list (default: true)', required: false },
  linkLimit: { type: 'number', description: 'Max number of links to include (default: 30)', required: false },
  includeScreenshot: { type: 'boolean', description: 'Include screenshot image (default: true)', required: false },
  fullPageScreenshot: { type: 'boolean', description: 'Capture full page screenshot (default: false)', required: false },
  screenshotPath: { type: 'string', description: 'Optional explicit screenshot path', required: false }
};

export default BrowserReport;
