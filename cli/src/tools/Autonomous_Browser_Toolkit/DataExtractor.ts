import { ToolResult } from '../index';
import { getBrowserRegistry } from './BrowserController';
import chalk from 'chalk';

interface StructureField {
  selector: string;
  attribute?: string;
  multiple?: boolean;
}

interface DataExtractorArgs {
  action: 'get_text' | 'get_attribute' | 'get_html' | 'get_all' | 'extract_table' | 'extract_links' | 'extract_structured' | 'extract_content' | 'extract_text' | 'text' | 'html' | 'attrs' | 'attribute' | 'links' | 'table';
  browserId: string;
  tabId?: string;
  selector?: string;
  xpath?: string;
  attribute?: string;
  multiple?: boolean;
  structure?: Record<string, StructureField>;
}

export async function DataExtractor(args: DataExtractorArgs): Promise<ToolResult> {
  try {
    let { action, browserId, tabId, selector, xpath, attribute, multiple = false, structure } = args;

    if (action === 'extract_text' || action === 'text') action = 'get_text';
    if (action === 'html') action = 'get_html';
    if (action === 'attrs' || action === 'attribute') action = 'get_attribute';
    if (action === 'links') action = 'extract_links';
    if (action === 'table') action = 'extract_table';

    if (!action) {
      return new ToolResult(false, 'Missing required parameter: action');
    }
    if (!browserId) {
      return new ToolResult(false, 'Missing required parameter: browserId');
    }

    const registry = getBrowserRegistry();
    const instance = registry.get(browserId);

    if (!instance) {
      return new ToolResult(false, `Browser with ID "${browserId}" not found. Create a browser instance first using BrowserController tool.`);
    }

    let page = tabId ? instance.pages.get(tabId) : undefined;

    if (!page) {
      page = Array.from(instance.pages.values()).find(p => !p.isClosed());
    }

    if (!page || page.isClosed()) {
      return new ToolResult(false, `Browser with ID "${browserId}" not found or has no active page`);
    }
    let extractedData: any = null;
    let elementCount = 0;
    const qualityMetrics: any = {
      success: true,
      emptyResults: 0,
      totalElements: 0,
      extractionMethod: selector ? 'CSS Selector' : xpath ? 'XPath' : 'Automatic'
    };

    const useSelector = selector || xpath;
    if (!useSelector && action !== 'extract_links' && action !== 'extract_structured' && action !== 'extract_content') {
      return new ToolResult(false, 'Either selector or xpath is required for this action');
    }

    switch (action) {
      case 'get_text':
        if (multiple) {
          if (xpath) {
            extractedData = await page.evaluate((xpathExpr: string) => {
              const result = document.evaluate(xpathExpr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              const texts: string[] = [];
              for (let i = 0; i < result.snapshotLength; i++) {
                const el = result.snapshotItem(i) as HTMLElement;
                texts.push(el?.innerText?.trim() || '');
              }
              return texts;
            }, xpath);
          } else {
            extractedData = await page.$$eval(selector!, (elements: Element[]) => {
              return elements.map(el => (el as HTMLElement).innerText?.trim() || '');
            });
          }
          elementCount = extractedData.length;
          qualityMetrics.emptyResults = extractedData.filter((t: string) => !t).length;
        } else {
          if (xpath) {
            extractedData = await page.evaluate((xpathExpr: string) => {
              const result = document.evaluate(xpathExpr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              const el = result.singleNodeValue as HTMLElement;
              return el?.innerText?.trim() || '';
            }, xpath);
          } else {
            const element = await page.$(selector!);
            if (!element) {
              return new ToolResult(false, `Element not found with selector: ${selector}`);
            }
            extractedData = await page.$eval(selector!, (el: Element) => (el as HTMLElement).innerText?.trim() || '');
          }
          elementCount = 1;
          if (!extractedData) qualityMetrics.emptyResults = 1;
        }
        qualityMetrics.totalElements = elementCount;
        break;

      case 'extract_content': {
        extractedData = await page.evaluate(() => {
          const main = document.querySelector('main') || document.querySelector('article') || document.body;
          return main?.innerText?.trim() || '';
        });
        elementCount = extractedData ? 1 : 0;
        qualityMetrics.totalElements = elementCount;
        qualityMetrics.emptyResults = extractedData ? 0 : 1;
        break;
      }

      case 'get_attribute':
        if (!attribute) {
          return new ToolResult(false, 'Attribute name is required for get_attribute action');
        }
        if (multiple) {
          if (xpath) {
            extractedData = await page.evaluate((xpathExpr: string, attr: string) => {
              const result = document.evaluate(xpathExpr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              const attrs: string[] = [];
              for (let i = 0; i < result.snapshotLength; i++) {
                const el = result.snapshotItem(i) as Element;
                attrs.push(el?.getAttribute(attr) || '');
              }
              return attrs;
            }, xpath, attribute);
          } else {
            extractedData = await page.$$eval(selector!, (elements: Element[], attr: string) => {
              return elements.map(el => el.getAttribute(attr) || '');
            }, attribute);
          }
          elementCount = extractedData.length;
          qualityMetrics.emptyResults = extractedData.filter((a: string) => !a).length;
        } else {
          if (xpath) {
            extractedData = await page.evaluate((xpathExpr: string, attr: string) => {
              const result = document.evaluate(xpathExpr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              const el = result.singleNodeValue as Element;
              return el?.getAttribute(attr) || '';
            }, xpath, attribute);
          } else {
            const element = await page.$(selector!);
            if (!element) {
              return new ToolResult(false, `Element not found with selector: ${selector}`);
            }
            extractedData = await page.$eval(selector!, (el: Element, attr: string) => el.getAttribute(attr) || '', attribute);
          }
          elementCount = 1;
          if (!extractedData) qualityMetrics.emptyResults = 1;
        }
        qualityMetrics.totalElements = elementCount;
        break;

      case 'get_html':
        if (multiple) {
          if (xpath) {
            extractedData = await page.evaluate((xpathExpr: string) => {
              const result = document.evaluate(xpathExpr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              const htmls: string[] = [];
              for (let i = 0; i < result.snapshotLength; i++) {
                const el = result.snapshotItem(i) as Element;
                htmls.push(el?.outerHTML || '');
              }
              return htmls;
            }, xpath);
          } else {
            extractedData = await page.$$eval(selector!, (elements: Element[]) => {
              return elements.map(el => el.outerHTML);
            });
          }
          elementCount = extractedData.length;
        } else {
          if (xpath) {
            extractedData = await page.evaluate((xpathExpr: string) => {
              const result = document.evaluate(xpathExpr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              const el = result.singleNodeValue as Element;
              return el?.outerHTML || '';
            }, xpath);
          } else {
            const element = await page.$(selector!);
            if (!element) {
              return new ToolResult(false, `Element not found with selector: ${selector}`);
            }
            extractedData = await page.$eval(selector!, (el: Element) => el.outerHTML);
          }
          elementCount = 1;
        }
        qualityMetrics.totalElements = elementCount;
        break;

      case 'get_all':
        if (xpath) {
          extractedData = await page.evaluate((xpathExpr: string) => {
            const result = document.evaluate(xpathExpr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const elements: any[] = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              const el = result.snapshotItem(i) as HTMLElement;
              elements.push({
                text: el?.innerText?.trim() || '',
                html: el?.outerHTML || '',
                tagName: el?.tagName,
                id: el?.id,
                className: el?.className,
                attributes: Array.from(el?.attributes || []).reduce((acc: any, attr) => {
                  acc[attr.name] = attr.value;
                  return acc;
                }, {})
              });
            }
            return elements;
          }, xpath);
        } else {
          extractedData = await page.$$eval(selector!, (elements: Element[]) => {
            return elements.map(el => ({
              text: (el as HTMLElement).innerText?.trim() || '',
              html: el.outerHTML,
              tagName: el.tagName,
              id: el.id,
              className: el.className,
              attributes: Array.from(el.attributes).reduce((acc: any, attr) => {
                acc[attr.name] = attr.value;
                return acc;
              }, {})
            }));
          });
        }
        elementCount = extractedData.length;
        qualityMetrics.totalElements = elementCount;
        break;

      case 'extract_table':
        if (!useSelector) {
          return new ToolResult(false, 'Selector or xpath is required for extract_table action');
        }
        if (xpath) {
          extractedData = await page.evaluate((xpathExpr: string) => {
            const result = document.evaluate(xpathExpr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const table = result.singleNodeValue as HTMLTableElement;
            if (!table) return null;
            
            const rows = Array.from(table.querySelectorAll('tr'));
            return rows.map(row => {
              const cells = Array.from(row.querySelectorAll('td, th'));
              return cells.map(cell => (cell as HTMLElement).innerText?.trim() || '');
            });
          }, xpath);
        } else {
          const element = await page.$(selector!);
          if (!element) {
            return new ToolResult(false, `Table element not found with selector: ${selector}`);
          }
          extractedData = await page.$eval(selector!, (table: Element) => {
            const rows = Array.from(table.querySelectorAll('tr'));
            return rows.map(row => {
              const cells = Array.from(row.querySelectorAll('td, th'));
              return cells.map(cell => (cell as HTMLElement).innerText?.trim() || '');
            });
          });
        }
        if (!extractedData || extractedData.length === 0) {
          return new ToolResult(false, 'Table not found or contains no rows');
        }
        elementCount = extractedData.length;
        qualityMetrics.totalElements = elementCount;
        qualityMetrics.rows = extractedData.length;
        qualityMetrics.columns = extractedData[0]?.length || 0;
        break;

      case 'extract_links':
        const linkSelector = selector || xpath || 'a';
        if (xpath) {
          extractedData = await page.evaluate((xpathExpr: string) => {
            const result = document.evaluate(xpathExpr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const links: any[] = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              const el = result.snapshotItem(i) as HTMLAnchorElement;
              links.push({
                text: el?.innerText?.trim() || '',
                href: el?.href || '',
                title: el?.title || ''
              });
            }
            return links;
          }, xpath);
        } else {
          extractedData = await page.$$eval(linkSelector, (links: Element[]) => {
            return links.map(link => ({
              text: (link as HTMLElement).innerText?.trim() || '',
              href: (link as HTMLAnchorElement).href || '',
              title: link.getAttribute('title') || ''
            }));
          });
        }
        elementCount = extractedData.length;
        qualityMetrics.totalElements = elementCount;
        qualityMetrics.validLinks = extractedData.filter((l: any) => l.href).length;
        break;

      case 'extract_structured':
        if (!structure) {
          return new ToolResult(false, 'Structure definition is required for extract_structured action');
        }
        
        extractedData = await page.evaluate((structDef: Record<string, StructureField>) => {
          const extractValue = (sel: string, attr?: string): any => {
            const el = document.querySelector(sel);
            if (!el) return null;
            if (attr) return el.getAttribute(attr);
            return (el as HTMLElement).innerText?.trim() || '';
          };

          const extractMultiple = (sel: string, attr?: string): any[] => {
            const elements = Array.from(document.querySelectorAll(sel));
            return elements.map(el => {
              if (attr) return el.getAttribute(attr);
              return (el as HTMLElement).innerText?.trim() || '';
            });
          };

          const result: any = {};
          for (const [key, config] of Object.entries(structDef)) {
            if (config.multiple) {
              result[key] = extractMultiple(config.selector, config.attribute);
            } else {
              result[key] = extractValue(config.selector, config.attribute);
            }
          }
          return result;
        }, structure);

        elementCount = Object.keys(extractedData).length;
        qualityMetrics.totalElements = elementCount;
        qualityMetrics.fieldsExtracted = Object.keys(extractedData).filter(k => extractedData[k] !== null && extractedData[k] !== '').length;
        break;

      default:
        return new ToolResult(false, `Unknown action: ${action}`);
    }

    const summary = `${chalk.green('✓')} Extracted data using ${action} (${elementCount} element${elementCount !== 1 ? 's' : ''})`;

    return new ToolResult(true, summary, {
      data: extractedData,
      elementCount,
      qualityMetrics,
      action,
      browserId
    });

  } catch (error: any) {
    return new ToolResult(false, `Data extraction failed: ${error.message}`, {
      error: error.message,
      stack: error.stack
    });
  }
}

(DataExtractor as any).description = "Extract data from pages using selectors or intelligent content parsing - get text, attributes, HTML, structured data, tables, links";
(DataExtractor as any).parameters = {
  action: {
    type: "string",
    description: "Extraction action: get_text (aliases: extract_text/text), get_attribute (aliases: attribute/attrs), get_html (alias: html), get_all, extract_table (alias: table), extract_links (alias: links), extract_structured, extract_content",
    required: true,
    enum: ['get_text', 'get_attribute', 'get_html', 'get_all', 'extract_table', 'extract_links', 'extract_structured', 'extract_content']
  },
  browserId: {
    type: "string",
    description: "Unique identifier of the browser instance to extract data from",
    required: true
  },
  tabId: {
    type: "string",
    description: "Tab ID to extract from (optional; defaults to first available tab)",
    required: false
  },
  selector: {
    type: "string",
    description: "CSS selector to target elements (e.g., 'h1', '.class', '#id', 'div > p')",
    required: false
  },
  xpath: {
    type: "string",
    description: "XPath expression to target elements (alternative to CSS selector)",
    required: false
  },
  attribute: {
    type: "string",
    description: "Attribute name to extract (required for 'get_attribute' action, e.g., 'href', 'src', 'data-id')",
    required: false
  },
  multiple: {
    type: "boolean",
    description: "Whether to extract from multiple matching elements (true) or just the first match (false). Default: false",
    required: false
  },
  structure: {
    type: "object",
    description: "Structure definition for 'extract_structured' action. Define fields as {fieldName: {selector: 'css', attribute?: 'attr', multiple?: boolean}}",
    required: false
  }
};

export default DataExtractor;