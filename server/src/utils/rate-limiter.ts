/**
 * Rate Limiter Utility
 * 
 * Implements token bucket algorithm for API rate limiting.
 */

export interface RateLimitConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
  refillInterval: number; // milliseconds
}

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;
  private refillInterval: number;

  constructor(config: RateLimitConfig) {
    this.maxTokens = config.maxTokens;
    this.tokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.refillInterval = config.refillInterval;
    this.lastRefill = Date.now();
  }

  /**
   * Attempts to consume a token
   */
  tryConsume(tokens: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Returns time until next token is available (in ms)
   */
  getRetryAfter(): number {
    this.refill();
    
    if (this.tokens >= 1) {
      return 0;
    }

    const tokensNeeded = 1 - this.tokens;
    return Math.ceil((tokensNeeded / this.refillRate) * 1000);
  }

  /**
   * Refills tokens based on time elapsed
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed >= this.refillInterval) {
      const tokensToAdd = (elapsed / 1000) * this.refillRate;
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Gets current token count
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}
