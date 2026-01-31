import { ToolResult } from './index';
import { SessionManager } from '../services/SessionManager';
import chalk from 'chalk';

/**
 * Pattern Matcher Tool
 * ====================
 * Searches past execution logs and sessions to find similar problems 
 * and identify proven solutions or strategies that worked before.
 */

export async function Pattern_Matcher(args: { query: string }, options: any = {}): Promise<ToolResult> {
  try {
    const sessionManager = new SessionManager();
    const sessions = sessionManager.listSessions();
    
    if (sessions.length === 0) {
      return new ToolResult(true, "No past sessions found to match patterns against.");
    }

    const query = args.query.toLowerCase();
    const matches: Array<{
      sessionId: string;
      relevance: number;
      task: string;
      outcome: string;
    }> = [];

    for (const session of sessions) {
      if (!session || !session.messages) continue;

      // Look for the initial task/user message
      const firstUserMsg = session.messages.find(m => m.role === 'user');
      if (!firstUserMsg) continue;

      const taskContent = firstUserMsg.content;
      const taskLower = taskContent.toLowerCase();
      
      // Calculate relevance
      let relevance = 0;
      if (taskLower.includes(query)) {
        relevance = 1.0;
      } else {
        // Split into words and check for overlaps
        const queryWords = query.split(/\s+/).filter(w => w.length > 3);
        if (queryWords.length === 0) {
           relevance = taskLower.includes(query) ? 0.5 : 0;
        } else {
           const taskWords = taskLower.split(/\s+/);
           const overlap = queryWords.filter(w => taskWords.includes(w));
           relevance = overlap.length / queryWords.length;
        }
      }

      if (relevance > 0.2) {
        // Find if there was a successful outcome
        // Look for "success" or "✓" in assistant messages or tool results
        const successMatch = session.messages.some(m => 
          m.role === 'assistant' && 
          (m.content.includes('✓') || m.content.toLowerCase().includes('success') || m.content.toLowerCase().includes('fixed'))
        );

        matches.push({
          sessionId: session.id,
          relevance,
          task: taskContent.slice(0, 100) + (taskContent.length > 100 ? '...' : ''),
          outcome: successMatch ? 'Successful' : 'Unknown/Failed'
        });
      }
    }

    // Sort by relevance
    matches.sort((a, b) => b.relevance - a.relevance);
    const topMatches = matches.slice(0, 3);

    if (topMatches.length === 0) {
      return new ToolResult(true, `No similar patterns found for query: "${args.query}"`);
    }

    const summary = `Found ${topMatches.length} similar past tasks. Highest relevance: ${(topMatches[0].relevance * 100).toFixed(1)}%.`;
    
    return new ToolResult(true, summary, {
      matches: topMatches,
      suggestion: topMatches[0].outcome === 'Successful' 
        ? "This task has been solved before. Recommend reviewing its history."
        : "Found similar tasks but no clear successful outcome identified."
    });

  } catch (error: any) {
    return new ToolResult(false, `Pattern matching failed: ${error.message}`);
  }
}

// Metadata for the forged tool registry
(Pattern_Matcher as any).description = "Searches past execution logs and sessions to find similar problems and identify proven solutions or strategies that worked before.";
(Pattern_Matcher as any).parameters = {
  query: { type: 'string', required: true }
};

