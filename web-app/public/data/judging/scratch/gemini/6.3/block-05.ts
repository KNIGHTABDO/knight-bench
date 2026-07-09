export class DurableObjectLimiter implements RateLimiter {
  constructor(private doStub: any) {}

  public async acquire(): Promise<void> {
    while (true) {
      const response = await this.doStub.fetch("http://rate-limiter/acquire");
      const result = await response.json();
      if (result.allowed) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs));
    }
  }

  public report429(retryAfterSeconds: number): void {
    // Dynamic feedback if the DO and upstream drifts
  }
}
