import {
  DurableObjectRateLimiterClient,
  InMemoryTokenBucketLimiter,
  RDAPIError,
  RDAuthExpiredError,
  RDPremiumRequiredError,
  RDRateLimitedError,
  RDTransientUpstreamError,
  RDUnavailableFileError,
  RealDebridClient,
  type RDFileSelection,
} from "./realdebrid";

export interface Env {
  RD_API_TOKEN: string;
  RD_RATE_LIMITER?: DurableObjectNamespace;
}

const bestEffortLimiter = new InMemoryTokenBucketLimiter({
  capacity: 250,
  requestsPerMinute: 240,
});

function makeClient(env: Env): RealDebridClient {
  const limiter = env.RD_RATE_LIMITER
    ? new DurableObjectRateLimiterClient(
        env.RD_RATE_LIMITER.get(env.RD_RATE_LIMITER.idFromName("real-debrid-account")),
        { capacity: 250, requestsPerMinute: 240 },
      )
    : bestEffortLimiter;

  return new RealDebridClient({
    apiToken: env.RD_API_TOKEN,
    limiter,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const rd = makeClient(env);
    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/api/unrestrict") {
        const body = await request.json<{ link: string; password?: string }>();
        const unrestricted = await rd.unrestrictLink(body.link, { password: body.password });
        return json({ filename: unrestricted.filename, download: unrestricted.download });
      }

      if (request.method === "POST" && url.pathname === "/api/torrents/magnet") {
        const body = await request.json<{ magnet: string; files?: RDFileSelection }>();
        const added = await rd.addMagnet(body.magnet);
        const torrent = await rd.pollTorrentUntilDownloaded(added.id, {
          timeoutMs: 20 * 60_000,
          onWaitingFilesSelection: body.files ?? "all",
        });
        return json({ id: added.id, status: torrent.status, links: torrent.links });
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/torrents/") && url.pathname.endsWith("/files")) {
        const torrentId = url.pathname.split("/")[3];
        const body = await request.json<{ files: RDFileSelection }>();
        await rd.selectFiles(torrentId, body.files);
        return json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/api/downloads") {
        const downloads = await rd.listDownloads({
          page: numberQuery(url, "page"),
          limit: numberQuery(url, "limit") ?? 50,
        });
        return json({ downloads });
      }

      return json({ error: "not_found" }, 404);
    } catch (error) {
      return publicError(error);
    }
  },
};

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function numberQuery(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function publicError(error: unknown): Response {
  // Do not serialize raw upstream headers, request init objects, or env values.
  // The token only exists in env.RD_API_TOKEN and the Authorization header sent
  // from Worker to Real-Debrid.
  if (error instanceof RDAuthExpiredError) {
    return json({ error: "real_debrid_auth_failed" }, 502);
  }
  if (error instanceof RDPremiumRequiredError) {
    return json({ error: "real_debrid_permission_or_premium_required" }, 403);
  }
  if (error instanceof RDUnavailableFileError) {
    return json({ error: "real_debrid_file_unavailable" }, 422);
  }
  if (error instanceof RDRateLimitedError) {
    const retryAfterSeconds = error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1_000) : 5;
    return json(
      { error: "real_debrid_rate_limited", retryAfterMs: error.retryAfterMs ?? retryAfterSeconds * 1_000 },
      503,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }
  if (error instanceof RDTransientUpstreamError) {
    return json({ error: "real_debrid_transient_upstream_error" }, 502);
  }
  if (error instanceof RDAPIError) {
    return json({ error: "real_debrid_error" }, 502);
  }
  return json({ error: "internal_error" }, 500);
}
