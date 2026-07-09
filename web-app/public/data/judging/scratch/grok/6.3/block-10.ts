const client = new RealDebridClient({
  apiToken: env.REAL_DEBRID_TOKEN,
  rateLimiter: new IsolateTokenBucket(),
});

// 1) Unrestrict
const u = await client.unrestrictLink("https://hoster.example/file");

// 2–4) Magnet pipeline with full status handling + backoff poll
const torrent = await client.downloadMagnetToCompletion(magnetUri, {
  files: "all",
  backoff: {
    initialMs: 1000,
    maxMs: 15_000,
    multiplier: 1.8,
    jitterRatio: 0.2,
    hardTimeoutMs: 20 * 60 * 1000,
  },
  onStatus: (info, decision) => {
    console.log(info.status, info.progress, decision.kind);
  },
});

// 5) List downloads
const downloads = await client.listDownloads({ limit: 50 });
