import { ToolResult } from '../index';
import chalk from 'chalk';

interface PageAnalyzerArgs {
  browserId: string;
  tabId?: string;
  analysis: 'full' | 'forms' | 'links' | 'interactive' | 'structure' | 'navigation';
}

export async function PageAnalyzer(args: PageAnalyzerArgs, options: any = {}): Promise<ToolResult> {
  try {
    const { browserId, tabId, analysis = 'full' } = args;

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

    const analyzeFunction = await page.evaluate((analysisType) => {
      const results: any = {};

      // Forms analysis
      const analyzeForms = () => {
        const forms = Array.from(document.querySelectorAll('form'));
        return forms.map((form, idx) => {
          const inputs = Array.from(form.querySelectorAll('input, textarea, select'));
          return {
            index: idx,
            id: form.id || undefined,
            action: form.action,
            method: form.method,
            inputs: inputs.map(input => ({
              type: (input as HTMLInputElement).type || 'text',
              name: (input as HTMLInputElement).name,
              id: input.id,
              required: (input as HTMLInputElement).required,
              placeholder: (input as HTMLInputElement).placeholder
            })),
            submitButtons: Array.from(form.querySelectorAll('[type="submit"], button')).length
          };
        });
      };

      // Links analysis
      const analyzeLinks = () => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const linkData = links.map(link => ({
          text: link.textContent?.trim() || '',
          href: (link as HTMLAnchorElement).href,
          target: (link as HTMLAnchorElement).target || '_self',
          isExternal: (link as HTMLAnchorElement).hostname !== window.location.hostname
        }));

        return {
          total: linkData.length,
          internal: linkData.filter(l => !l.isExternal).length,
          external: linkData.filter(l => l.isExternal).length,
          links: linkData.slice(0, 50) // Limit to first 50
        };
      };

      // Interactive elements analysis
      const analyzeInteractive = () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
        const clickable = Array.from(document.querySelectorAll('[onclick], [ng-click], [v-on\\:click]'));

        return {
          buttons: buttons.length,
          inputs: inputs.length,
          clickableElements: clickable.length,
          totalInteractive: buttons.length + inputs.length + clickable.length,
          buttonTypes: buttons.map(btn => ({
            text: btn.textContent?.trim() || '',
            type: (btn as HTMLButtonElement).type || 'button',
            id: btn.id || undefined,
            class: btn.className || undefined
          })).slice(0, 20)
        };
      };

      // Page structure analysis
      const analyzeStructure = () => {
        return {
          title: document.title,
          headings: {
            h1: document.querySelectorAll('h1').length,
            h2: document.querySelectorAll('h2').length,
            h3: document.querySelectorAll('h3').length,
            h4: document.querySelectorAll('h4').length,
            h5: document.querySelectorAll('h5').length,
            h6: document.querySelectorAll('h6').length
          },
          sections: document.querySelectorAll('section').length,
          articles: document.querySelectorAll('article').length,
          nav: document.querySelectorAll('nav').length,
          main: document.querySelectorAll('main').length,
          aside: document.querySelectorAll('aside').length,
          footer: document.querySelectorAll('footer').length,
          images: document.querySelectorAll('img').length,
          videos: document.querySelectorAll('video').length,
          iframes: document.querySelectorAll('iframe').length
        };
      };

      // Navigation analysis
      const analyzeNavigation = () => {
        const navElements = Array.from(document.querySelectorAll('nav, [role="navigation"]'));
        const menus = Array.from(document.querySelectorAll('ul, ol')).filter(list => {
          const parent = list.closest('nav, [role="navigation"]');
          return parent !== null;
        });

        return {
          navigationSections: navElements.length,
          menus: menus.length,
          menuItems: Array.from(document.querySelectorAll('nav li, [role="navigation"] li')).length,
          breadcrumbs: document.querySelectorAll('[aria-label*="breadcrumb" i], .breadcrumb').length,
          pagination: document.querySelectorAll('[aria-label*="pagination" i], .pagination').length
        };
      };

      // Execute requested analysis
      if (analysisType === 'forms' || analysisType === 'full') {
        results.forms = analyzeForms();
      }
      if (analysisType === 'links' || analysisType === 'full') {
        results.links = analyzeLinks();
      }
      if (analysisType === 'interactive' || analysisType === 'full') {
        results.interactive = analyzeInteractive();
      }
      if (analysisType === 'structure' || analysisType === 'full') {
        results.structure = analyzeStructure();
      }
      if (analysisType === 'navigation' || analysisType === 'full') {
        results.navigation = analyzeNavigation();
      }

      return results;
    }, analysis);

    // Add page metadata
    const metadata = {
      url: page.url(),
      title: await page.title(),
      viewport: await page.viewport(),
      userAgent: await page.evaluate(() => navigator.userAgent)
    };

    return new ToolResult(true, `Page analysis completed: ${analysis}`, {
      metadata,
      analysis: analyzeFunction,
      summary: generateSummary(analyzeFunction, analysis)
    });

  } catch (error: any) {
    return new ToolResult(false, `Page analysis failed: ${error.message}`);
  }
}

function generateSummary(analysis: any, type: string): string {
  const parts: string[] = [];

  if (analysis.structure) {
    parts.push(`Page: "${analysis.structure.title}"`);
    const totalHeadings = Object.values(analysis.structure.headings as Record<string, number>).reduce((a, b) => a + b, 0);
    parts.push(`${totalHeadings} headings`);
    parts.push(`${analysis.structure.images} images`);
  }

  if (analysis.forms) {
    parts.push(`${analysis.forms.length} forms`);
  }

  if (analysis.links) {
    parts.push(`${analysis.links.total} links (${analysis.links.internal} internal, ${analysis.links.external} external)`);
  }

  if (analysis.interactive) {
    parts.push(`${analysis.interactive.totalInteractive} interactive elements`);
  }

  if (analysis.navigation) {
    parts.push(`${analysis.navigation.navigationSections} navigation sections`);
  }

  return parts.join(', ');
}

// Metadata
(PageAnalyzer as any).description = "Intelligently analyze page structure to detect forms, interactive elements, navigation patterns, and provide agent-friendly summaries of page content and capabilities";
(PageAnalyzer as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  analysis: { type: 'string', description: 'Analysis type: full, forms, links, interactive, structure, or navigation (default: full)', required: false }
};

export default PageAnalyzer;
