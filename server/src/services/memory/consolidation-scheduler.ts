import { HierarchyManager } from './hierarchy-manager';
import chalk from 'chalk';

/**
 * ConsolidationScheduler runs periodic background jobs to 
 * optimize the agent's memory hierarchy.
 */
export class ConsolidationScheduler {
  private hierarchy: HierarchyManager;
  private interval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(hierarchy: HierarchyManager) {
    this.hierarchy = hierarchy;
  }

  /**
   * Start the background consolidation job
   */
  start(intervalMs: number = 300000): void { // Default 5 minutes
    if (this.interval) return;

    console.log(chalk.blue(`[MemoryScheduler] Started consolidation engine (Interval: ${intervalMs}ms)`));
    
    this.interval = setInterval(async () => {
      if (this.isRunning) return;
      
      try {
        this.isRunning = true;
        const count = await this.hierarchy.consolidate();
        if (count > 0) {
          console.log(chalk.green(`[MemoryScheduler] Consolidate complete: ${count} beliefs solidified.`));
        }
      } catch (error: any) {
        console.error(chalk.red(`[MemoryScheduler] Consolidation failed: ${error.message}`));
      } finally {
        this.isRunning = false;
      }
    }, intervalMs);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Trigger an immediate consolidation
   */
  async runNow(): Promise<number> {
    return this.hierarchy.consolidate();
  }
}
