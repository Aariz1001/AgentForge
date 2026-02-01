import { ToolResult } from '../index';
import chalk from 'chalk';

interface FormAutomationArgs {
  browserId: string;
  tabId?: string;
  action: 'fill_form' | 'submit' | 'detect_forms';
  formData?: Record<string, any>;
  formSelector?: string;
  submitSelector?: string;
}

export async function FormAutomation(args: FormAutomationArgs, options: any = {}): Promise<ToolResult> {
  try {
    const { browserId, tabId, action, formData, formSelector, submitSelector } = args;

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

    switch (action) {
      case 'detect_forms': {
        const forms = await page.evaluate(() => {
          const allForms = Array.from(document.querySelectorAll('form'));
          return allForms.map((form, index) => {
            const inputs = Array.from(form.querySelectorAll('input, textarea, select')).map(input => ({
              name: (input as HTMLInputElement).name,
              type: (input as HTMLInputElement).type || 'text',
              id: input.id,
              placeholder: (input as HTMLInputElement).placeholder,
              required: (input as HTMLInputElement).required
            }));
            return {
              index,
              id: form.id || undefined,
              action: form.action,
              method: form.method,
              inputs,
              inputCount: inputs.length
            };
          });
        });

        return new ToolResult(true, `Detected ${forms.length} form(s) on page`, { forms });
      }

      case 'fill_form': {
        if (!formData) {
          return new ToolResult(false, 'formData is required for fill_form action');
        }

        const selector = formSelector || 'form';
        await page.waitForSelector(selector, { timeout: 10000 });

        const results: string[] = [];
        for (const [field, value] of Object.entries(formData)) {
          try {
            // Try multiple strategies to find and fill the field
            const fieldSelector = `${selector} [name="${field}"], ${selector} #${field}, ${selector} [placeholder*="${field}" i]`;
            
            const element = await page.$(fieldSelector);
            if (!element) {
              results.push(`⚠ Field "${field}" not found`);
              continue;
            }

            const tagName = await element.evaluate(el => el.tagName.toLowerCase());
            const inputType = await element.evaluate(el => (el as HTMLInputElement).type);

            if (tagName === 'select') {
              await page.select(fieldSelector, String(value));
            } else if (inputType === 'checkbox' || inputType === 'radio') {
              if (value) {
                await element.click();
              }
            } else if (inputType === 'file') {
              await (element as any).uploadFile(String(value));
            } else {
              await element.click({ clickCount: 3 }); // Select all
              await element.type(String(value));
            }

            results.push(`✓ Filled "${field}" with value`);
          } catch (error: any) {
            results.push(`✗ Failed to fill "${field}": ${error.message}`);
          }
        }

        return new ToolResult(true, `Form filling completed: ${results.length} fields processed`, { 
          results,
          successful: results.filter(r => r.startsWith('✓')).length,
          failed: results.filter(r => r.startsWith('✗')).length,
          warnings: results.filter(r => r.startsWith('⚠')).length
        });
      }

      case 'submit': {
        const selector = submitSelector || `${formSelector || 'form'} [type="submit"], ${formSelector || 'form'} button[type="submit"]`;
        
        await page.waitForSelector(selector, { timeout: 10000 });
        await page.click(selector);
        
        // Wait for navigation or response
        await Promise.race([
          page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 2000))
        ]);

        return new ToolResult(true, 'Form submitted successfully', {
          url: page.url(),
          title: await page.title()
        });
      }

      default:
        return new ToolResult(false, `Unknown action: ${action}`);
    }

  } catch (error: any) {
    return new ToolResult(false, `Form automation failed: ${error.message}`);
  }
}

// Metadata
(FormAutomation as any).description = "Intelligently fill out and submit web forms with auto-detection of input types, support for complex form scenarios including dropdowns, checkboxes, radio buttons, file uploads, and multi-step forms";
(FormAutomation as any).parameters = {
  browserId: { type: 'string', description: 'Browser instance ID', required: true },
  tabId: { type: 'string', description: 'Tab ID (optional, uses first tab if not specified)', required: false },
  action: { type: 'string', description: 'Action: detect_forms, fill_form, or submit', required: true },
  formData: { type: 'object', description: 'Key-value pairs of form fields to fill (for fill_form)', required: false },
  formSelector: { type: 'string', description: 'CSS selector for form element (default: "form")', required: false },
  submitSelector: { type: 'string', description: 'CSS selector for submit button (for submit action)', required: false }
};

export default FormAutomation;
