// ============================================================================
// retry.ts
// ============================================================================

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  opts: RetryOptions,
): Promise<T> {
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 15_000;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === opts.maxAttempts) throw err;

      let delay = Math.random() * Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      if (err instanceof RdRateLimitError && err.retryAfterMs) {
        delay = err.retryAfterMs;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
