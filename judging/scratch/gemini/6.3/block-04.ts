// Durable Object definition for rate limiting
export class RealDebridRateLimiterDO {
  private tokens = 50;
  private lastRefill = Date.now();
  private maxTokens = 50;
  private refillRate = 250 / (60 * 1000); // 250 tokens per minute

  constructor(private state: any, private env: any) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/acquire") {
      const now = Date.now();
      const elapsed = now - this.lastRefill;
      this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
      this.lastRefill = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return new Response(JSON.stringify({ allowed: true }), { status: 200 });
      }

      const missing = 1 - this.tokens;
      const delay = Math.ceil(missing / this.refillRate);
      return new Response(JSON.stringify({ allowed: false, retryAfterMs: delay }), { status: 429 });
    }

    return new Response("Not Found", { status: 404 });
  }
}
