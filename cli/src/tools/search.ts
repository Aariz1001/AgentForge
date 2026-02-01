/**
 * Search & Browse Tool
 * ==================
 * High-quality web search and content extraction powered by DuckDuckGo and Brave.
 * Provides unrestricted access to web information without requiring paid API keys.
 */

import fetch from 'node-fetch';
import chalk from 'chalk';
import { ToolResult } from './index';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

/**
 * Search the web using DuckDuckGo (Keyless) or Brave (Free Tier)
 */
export async function search(query: string, options: any = {}): Promise<ToolResult> {
  const {
    maxResults = 5,
    useBrave = false
  } = options;

  const braveKey = process.env.BRAVE_SEARCH_API_KEY;

  // Use Brave if requested and key is available
  if (useBrave && braveKey) {
    return await searchBrave(query, braveKey, maxResults);
  }

  // Fallback to DuckDuckGo (always unrestricted)
  return await searchDuckDuckGo(query, maxResults);
}

/**
 * DuckDuckGo Search Implementation (Keyless)
 * Uses Instant Answer API + Lite Scraper Fallback
 */
async function searchDuckDuckGo(query: string, maxResults: number): Promise<ToolResult> {
  const results: any[] = [];
  let instantAnswer: string | undefined;

  try {
    // 1. Try DuckDuckGo Instant Answer API (Official & Stable)
    const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const iaRes = await fetch(iaUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (iaRes.ok) {
      const iaData: any = await iaRes.json();
      instantAnswer = iaData.AbstractText || iaData.Definition;
    }

    // 2. Search Results from DuckDuckGo Lite
    const liteUrl = `https://duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const searchRes = await fetch(liteUrl, { headers: { 'User-Agent': USER_AGENT } });
    const html = await searchRes.text();

    // Parse DDG Lite HTML (Table-based layout)
    const rows = html.split(/<tr/i);
    for (let i = 0; i < rows.length; i++) {
      if (results.length >= maxResults) break;

      // Match Result Title & Link
      const linkMatch = rows[i].match(/class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i);
      if (linkMatch) {
        const url = linkMatch[1];
        const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();

        // Skip internal DDG links, ads, and empty titles
        if (!url || url.includes('duckduckgo.com/y.js') || url.startsWith('/') || !title) continue;

        // Find snippet in subsequent rows
        let snippet = '';
        for (let j = i + 1; j < Math.min(i + 5, rows.length); j++) {
          if (rows[j].includes('result-snippet')) {
            snippet = rows[j].replace(/<[^>]+>/g, '').trim();
            break;
          }
        }

        results.push({ title, url, snippet });
      }
    }

    if (results.length === 0 && !instantAnswer) {
      return new ToolResult(false, `No results found for "${query}"`);
    }

    const summary = instantAnswer 
      ? `AI Answer found + ${results.length} sources for "${chalk.cyan(query)}"`
      : `Found ${chalk.bold(results.length)} results for "${chalk.cyan(query)}"`;

    return new ToolResult(true, summary, {
      query,
      answer: instantAnswer,
      results
    });

  } catch (error: any) {
    return new ToolResult(false, `DuckDuckGo Search failed: ${error.message}`);
  }
}

/**
 * Brave Search Implementation (Official Free Tier)
 */
async function searchBrave(query: string, apiKey: string, maxResults: number): Promise<ToolResult> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
    const res = await fetch(url, {
      headers: { 
        'X-Subscription-Token': apiKey, 
        'Accept': 'application/json',
        'User-Agent': USER_AGENT
      }
    });

    if (!res.ok) {
      return new ToolResult(false, `Brave Search API failed: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    const results = data.web?.results?.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description
    })) || [];

    return new ToolResult(true, `Brave Search found ${results.length} results for "${chalk.cyan(query)}"`, {
      query,
      results
    });
  } catch (error: any) {
    return new ToolResult(false, `Brave Search failed: ${error.message}`);
  }
}

/**
 * Extract content from a specific URL
 */
export async function browse(url: string, options: any = {}): Promise<ToolResult> {
  try {
    const response = await fetch(url, {
      headers: { 
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.google.com/'
      },
      signal: AbortSignal.timeout(20000)
    });
    
    if (!response.ok) {
      if (response.status === 403) {
        return new ToolResult(false, `Browse failed: 403 Forbidden. This site (e.g., Product Hunt) may have aggressive bot protection. Try using "search" to find snippets from this site instead.`);
      }
      return new ToolResult(false, `Browse failed: ${response.status} ${response.statusText}`);
    }
    
    const text = await response.text();
    
    // Clean and minimize HTML content for LLM consumption
    const cleanContent = text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')   // Remove styles
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')     // Remove nav
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '') // Remove footer
      .replace(/<[^>]+>/g, ' ')                          // Strip all tags
      .replace(/\s+/g, ' ')                              // Collapse whitespace
      .trim();

    // Extract title if possible
    const titleMatch = text.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;
      
    return new ToolResult(true, `Fetched content from ${chalk.cyan(title)}`, { 
      url, 
      title,
      length: cleanContent.length,
      content: cleanContent.substring(0, 20000) + (cleanContent.length > 20000 ? '\n\n... (content truncated for brevity)' : '')
    });
  } catch (error: any) {
    return new ToolResult(false, `Browse failed: ${error.message}`);
  }
}

// Export metadata for the agent
search.description = 'Unrestricted web search (DuckDuckGo/Brave) to find documentation, code, or information.';
search.parameters = {
  query: { type: 'string', description: 'The search query', required: true },
  maxResults: { type: 'number', description: 'Number of results to return (max 10)', default: 5 },
  useBrave: { type: 'boolean', description: 'Force Brave Search (requires BRAVE_SEARCH_API_KEY)', default: false }
};

browse.description = 'Directly extract clean text content from any website URL.';
browse.parameters = {
  url: { type: 'string', description: 'The absolute URL to browse', required: true }
};
