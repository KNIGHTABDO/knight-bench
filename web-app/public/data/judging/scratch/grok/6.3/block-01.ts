/**
 * Workers constraint: no reliable cross-request setInterval.
 * - Per-isolate: best-effort spacing within one invocation (and warm isolate memory).
 * - Durable Object: true shared token bucket when many invocations share one RD account.
 */
export interface RateLimiter {
  /** Acquire permission for n RD API calls. Resolves when allowed. */
  acquire(n?: number): Promise<void>;
}

/** Token bucket suitable for a single Worker invocation (or warm isolate). */
export class IsolateTokenBucket implements RateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number = 250,
    private readonly refillPerMs: number = 250 / 60_000, // 250/min
    private readonly minSpacingMs: number = 250, // ~4 rps ceiling as safety
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  private refill(now: number): void {
    const elapsed = Math.max(0, now - this.lastRefillMs);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefillMs = now;
  }

  async acquire(n = 1): Promise<void> {
    // No setInterval: refill is lazy on each acquire using wall clock.
    // sleep via Promise + setTimeout is fine *within* one request.
    for (;;) {
      const now = Date.now();
      this.refill(now);
      if (this.tokens >= n) {
        this.tokens -= n;
        // min spacing reduces burst even if tokens remain
        await sleep(this.minSpacingMs);
        return;
      }
      const deficit = n - this.tokens;
      const waitMs = Math.ceil(deficit / this.refillPerMs);
      await sleep(Math.min(Math.max(waitMs, this.minSpacingMs), 5_000));
    }
  }
}

/**
 * Optional global gate: Worker calls this before each RD request.
 * Implementation lives in a Durable Object (not shown in full; interface only).
 *
 * Example DO design:
 * - state: { tokens, lastRefillMs }
 * - on alarm or on acquire: refill 250/min from wall clock
 * - acquire blocks (or returns 429-to-worker) until token available
 */
export interface GlobalRateGate {
  acquire(n?: number): Promise<void>;
}

export class CompositeRateLimiter implements RateLimiter {
  constructor(
    private readonly local: RateLimiter,
    private readonly global?: GlobalRateGate,
  ) {}

  async acquire(n = 1): Promise<void> {
    if (this.global) await this.global.acquire(n);
    await this.local.acquire(n);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
