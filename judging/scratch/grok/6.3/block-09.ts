// worker.ts binding: RD_RATE_LIMITER (Durable Object)

export class RdRateLimiterDO {
  private tokens = 250;
  private lastRefillMs = Date.now();
  private readonly capacity = 250;
  private readonly refillPerMs = 250 / 60_000;

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const n = Number(new URL(request.url).searchParams.get("n") ?? "1");
    await this.state.blockConcurrencyWhile(async () => {
      for (;;) {
        const now = Date.now();
        const elapsed = Math.max(0, now - this.lastRefillMs);
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
        this.lastRefillMs = now;
        if (this.tokens >= n) {
          this.tokens -= n;
          return;
        }
        const waitMs = Math.ceil((n - this.tokens) / this.refillPerMs);
        await sleep(Math.min(waitMs, 1000));
      }
    });
    return new Response("ok");
  }
}

export class DurableObjectRateGate implements GlobalRateGate {
  constructor(private ns: DurableObjectNamespace, private name = "rd-global") {}

  async acquire(n = 1): Promise<void> {
    const id = this.ns.idFromName(this.name);
    const stub = this.ns.get(id);
    const res = await stub.fetch(`https://do/acquire?n=${n}`);
    if (!res.ok) throw new RdApiError("Global rate gate failed", "RATE_LIMITED", 429, true);
  }
}
