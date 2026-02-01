import { ToolResult } from '../index';
import fetch from 'node-fetch';

interface WaybackLookupArgs {
  url: string;
}

export async function WaybackLookup(args: WaybackLookupArgs): Promise<ToolResult> {
  try {
    const { url } = args;
    if (!url) {
      return new ToolResult(false, 'url is required');
    }

    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl, { headers: { 'User-Agent': 'AgentForge/1.0' } });
    if (!res.ok) {
      return new ToolResult(false, `Wayback lookup failed: ${res.status} ${res.statusText}`);
    }

    const data: any = await res.json();
    const closest = data?.archived_snapshots?.closest;

    if (!closest || !closest.available) {
      return new ToolResult(false, 'No archived snapshot available', { url });
    }

    return new ToolResult(true, 'Wayback snapshot found', {
      url,
      snapshot: {
        available: closest.available,
        timestamp: closest.timestamp,
        status: closest.status,
        snapshotUrl: closest.url
      }
    });
  } catch (error: any) {
    return new ToolResult(false, `Wayback lookup failed: ${error.message}`);
  }
}

(WaybackLookup as any).description = 'Find archived snapshots of a URL from the Internet Archive Wayback Machine.';
(WaybackLookup as any).parameters = {
  url: { type: 'string', description: 'URL to lookup in Wayback Machine', required: true }
};

export default WaybackLookup;
