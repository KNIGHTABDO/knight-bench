export interface Env {
  REAL_DEBRID_TOKEN: string; // wrangler secret
  // Optional: RD_RATE_LIMITER: DurableObjectNamespace;
}

/**
 * Public API surface (examples):
 *   POST /api/unrestrict     { link }
 *   POST /api/torrents       { magnet, files? }
 *   GET  /api/torrents/:id
 *   GET  /api/downloads
 *
 * Never accept a client-supplied RD token.
 * Never echo Authorization headers from upstream RD.
 * Never put the token in response bodies, logs shipped to the client, or URLs.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // --- auth for *your* users (session / JWT / Cloudflare Access) ---
    // Not the RD token. Example placeholder:
    const userOk = await authorizeAppUser(request, env);
    if (!userOk) return json({ error: "unauthorized" }, 401);

    const rd = new RealDebridClient({
      apiToken: env.REAL_DEBRID_TOKEN,
      rateLimiter: new IsolateTokenBucket(),
      // rateLimiter: new CompositeRateLimiter(new IsolateTokenBucket(), doGate),
    });

    try {
      if (request.method === "POST" && url.pathname === "/api/unrestrict") {
        const { link, password } = await request.json() as { link?: string; password?: string };
        if (!link) return json({ error: "link required" }, 400);
        const result = await rd.unrestrictLink(link, password);
        // Return only fields the client needs; strip nothing sensitive from RD beyond token
        // (RD token never appears here).
        return json({
          id: result.id,
          filename: result.filename,
          filesize: result.filesize,
          download: result.download,
          mimeType: result.mimeType,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/torrents") {
        const body = await request.json() as {
          magnet?: string;
          files?: string;
          wait?: boolean;
        };
        if (!body.magnet) return json({ error: "magnet required" }, 400);

        if (body.wait) {
          // Note: long polls may hit Worker subrequest / CPU / wall-time limits.
          // For large torrents prefer: start job, store torrent id, client polls your GET.
          const info = await rd.downloadMagnetToCompletion(body.magnet, {
            files: body.files ?? "all",
            backoff: { hardTimeoutMs: 50_000 }, // stay under Worker limits if needed
          });
          return json(sanitizeTorrent(info));
        }

        const added = await rd.addMagnetSafe(body.magnet);
        // Optionally kick select+poll via waitUntil for async completion
        ctx.waitUntil(
          (async () => {
            try {
              const info = await rd.getTorrentInfo(added.id);
              if (info.status === "waiting_files_selection" || info.status === "magnet_conversion") {
                await rd.downloadMagnetToCompletion(body.magnet!, {
                  files: body.files ?? "all",
                  infoHash: extractInfoHashFromMagnet(body.magnet!),
                });
              }
            } catch {
              // log server-side only
            }
          })(),
        );
        return json({ id: added.id }, 202);
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/torrents/")) {
        const id = url.pathname.split("/").pop()!;
        const info = await rd.getTorrentInfo(id);
        return json(sanitizeTorrent(info));
      }

      if (request.method === "GET" && url.pathname === "/api/downloads") {
        const items = await rd.listDownloads({ limit: 50 });
        return json(items.map(sanitizeDownload));
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      if (e instanceof RdApiError) {
        const status =
          e.code === "AUTH_EXPIRED"
            ? 502 // your API: upstream auth misconfigured — do not imply end-user 401 for RD
            : e.code === "PERMISSION_REQUIRED"
              ? 403
              : e.code === "RATE_LIMITED"
                ? 429
                : e.code === "INFRINGING_OR_UNAVAILABLE"
                  ? 451 // or 422/503 — choose product policy
                  : e.code === "TIMEOUT"
                    ? 504
                    : e.code === "TRANSIENT_UPSTREAM"
                      ? 502
                      : 400;

        // Never include env.REAL_DEBRID_TOKEN or raw Authorization in error payloads.
        return json(
          {
            error: e.code,
            message: e.message,
            retryable: e.retryable,
            retryAfterMs: e.retryAfterMs,
          },
          status,
          e.retryAfterMs
            ? { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) }
            : undefined,
        );
      }
      return json({ error: "internal_error" }, 500);
    }
  },
};

function json(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function sanitizeTorrent(info: RdTorrentInfo) {
  return {
    id: info.id,
    filename: info.filename,
    hash: info.hash,
    bytes: info.bytes,
    progress: info.progress,
    status: info.status,
    links: info.links,
    ended: info.ended,
  };
}

function sanitizeDownload(d: RdDownloadItem) {
  return {
    id: d.id,
    filename: d.filename,
    filesize: d.filesize,
    download: d.download,
    generated: d.generated,
    host: d.host,
  };
}

async function authorizeAppUser(request: Request, _env: Env): Promise<boolean> {
  // Implement session/JWT/API-key for *your* product.
  // Must be independent of Real-Debrid credentials.
  return request.headers.get("Authorization")?.startsWith("Bearer ") === true;
}
