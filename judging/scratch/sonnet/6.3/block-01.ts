// ============================================================================
// rate-limiter.ts
// ============================================================================

/** Shared token-bucket configuration for the Real-Debrid API. */
export const RD_RATE_LIMIT = {
  /** RD's documented approximate ceiling. Treat as unverified against current
   *  RD docs at integration time — confirm before relying on it in production. */
  maxRequestsPerWindow: 250,
  windowMs: 60_000,
} as const;

/** Minimal interface both limiter tiers implement so callers don't care which one is active. */
export interface RateLimiter {
  /** Resolves once it is safe to make one request; consumes one token. */
  acquire(): Promise<void>;
}

/**
 * Tier B: per-isolate best-effort limiter.
 * Lives in module scope so it is reused across requests handled by the SAME
 * warm isolate, but a fresh isolate starts with a full bucket — this is not
 * a global guarantee, only a local courtesy limiter.
 */
export class IsolateLocalLimiter implements RateLimiter {
  private tokens: number;
  private windowStart: number;

  constructor(
    private readonly max = RD_RATE_LIMIT.maxRequestsPerWindow,
    private readonly windowMs = RD_RATE_LIMIT.windowMs,
  ) {
    this.tokens = max;
    this.windowStart = Date.now();
  }

  private refillIfNeeded(): void {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.tokens = this.max;
      this.windowStart = now;
    }
  }

  async acquire(): Promise<void> {
    this.refillIfNeeded();
    if (this.tokens > 0) {
      this.tokens -= 1;
      return;
    }
    // Bucket exhausted for this isolate's current window: wait out the
    // remainder of the window. NOTE: this is a real await inside a single
    // request's execution (or a waitUntil task) — it is NOT a cross-request
    // timer, so it respects the Workers model (no ambient background timers).
    const waitMs = this.windowMs - (Date.now() - this.windowStart);
    await sleep(Math.max(waitMs, 0));
    this.refillIfNeeded();
    this.tokens = Math.max(this.tokens - 1, 0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tier A: Durable Object token bucket. This DO class must be exported from
 * your Worker's entry module and bound in wrangler.toml, e.g.:
 *
 *   [[durable_objects.bindings]]
 *   name = "RD_LIMITER"
 *   class_name = "RdRateLimiterDO"
 *
 * All isolates call the SAME DO instance (fixed idFromName), so the counter
 * below is genuinely global/serialized — the DO runtime guarantees only one
 * request is processed at a time per instance.
 */
export class RdRateLimiterDO {
  private state: DurableObjectState;
  private tokens = RD_RATE_LIMIT.maxRequestsPerWindow;
  private windowStart = Date.now();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(_req: Request): Promise<Response> {
    // Restore persisted counters on cold start of this DO instance.
    const stored = await this.state.storage.get<{ tokens: number; windowStart: number }>("bucket");
    if (stored) {
      this.tokens = stored.tokens;
      this.windowStart = stored.windowStart;
    }

    const now = Date.now();
    if (now - this.windowStart >= RD_RATE_LIMIT.windowMs) {
      this.tokens = RD_RATE_LIMIT.maxRequestsPerWindow;
      this.windowStart = now;
    }

    if (this.tokens <= 0) {
      const retryAfterMs = RD_RATE_LIMIT.windowMs - (now - this.windowStart);
      return new Response(JSON.stringify({ ok: false, retryAfterMs }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }

    this.tokens -= 1;
    await this.state.storage.put("bucket", { tokens: this.tokens, windowStart: this.windowStart });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}

/** Client-side wrapper that talks to the DO and retries locally if the DO says "wait". */
export class DurableObjectLimiter implements RateLimiter {
  constructor(private readonly stub: DurableObjectStub) {}

  async acquire(): Promise<void> {
    for (;;) {
      const res = await this.stub.fetch("https://rd-limiter.internal/acquire");
      const body = await res.json<{ ok: boolean; retryAfterMs?: number }>();
      if (body.ok) return;
      await sleep(Math.min(body.retryAfterMs ?? 1000, RD_RATE_LIMIT.windowMs));
    }
  }
}

/** Composite limiter: cheap local pre-check backed by the authoritative DO. */
export class CompositeLimiter implements RateLimiter {
  constructor(
    private readonly local: IsolateLocalLimiter,
    private readonly global: RateLimiter | undefined,
  ) {}

  async acquire(): Promise<void> {
    await this.local.acquire();
    if (this.global) {
      await this.global.acquire();
    }
    // If `global` is undefined (DO not bound, e.g. local dev), we fall back
    // to isolate-local-only limiting. This is a deliberate degrade, logged
    // by the caller, not a silent correctness gap for single-isolate cases.
  }
}
