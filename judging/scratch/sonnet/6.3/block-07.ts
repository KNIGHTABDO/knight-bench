// ============================================================================
// worker.ts — the ONLY place the RD token is read; the ONLY HTTP surface
// exposed to end users. The RD token never crosses this boundary outward.
// ============================================================================

export interface Env {
  RD_API_TOKEN: string; // set via `wrangler secret put RD_API_TOKEN`
  RD_LIMITER: DurableObjectNamespace; // bound to RdRateLimiterDO
}

export { RdRateLimiterDO } from "./rate-limiter";

function buildClient(env: Env): RealDebridClient {
  const doId = env.RD_LIMITER.idFromName("rd-global-limiter");
  const stub = env.RD_LIMITER.get(doId);
  const local = new IsolateLocalLimiter();
  const globalLimiter = new DurableObjectLimiter(stub);
  const limiter = new CompositeLimiter(local, globalLimiter);
  return new RealDebridClient(env.RD_API_TOKEN, limiter);
}

/** Strips any RD internals (headers, raw body text, token) before responding to the client. */
function toClientSafeError(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof RdAuthExpiredError) return { status: 502, body: { error: "upstream_auth_expired" } };
  if (err instanceof RdPermissionError) return { status: 402, body: { error: "premium_required" } };
  if (err instanceof RdUnavailableError) return { status: 404, body: { error: "file_unavailable" } };
  if (err instanceof RdRateLimitError) return { status: 503, body: { error: "rate_limited_try_later" } };
  if (err instanceof RdTransientServerError) return { status: 502, body: { error: "upstream_unavailable" } };
  return { status: 500, body: { error: "internal_error" } };
  // Note: none of these branches include err.bodyText, err.message details
  // from RD, or any header — only a coarse client-safe code, precisely so
  // the token and RD's internal response shape can never leak via an error path.
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/unrestrict" && req.method === "POST") {
      const { link } = await req.json<{ link: string }>();
      if (!link || typeof link !== "string") {
        return Response.json({ error: "missing_link" }, { status: 400 });
      }
      const client = buildClient(env);
      try {
        const result = await client.unrestrictLink(link);
        // Return ONLY the fields the frontend needs — not the raw RD object,
        // which may include account-identifying metadata.
        return Response.json({ download: result.download, filename: result.filename });
      } catch (err) {
        const { status, body } = toClientSafeError(err);
        return Response.json(body, { status });
      }
    }

    if (url.pathname === "/api/download-magnet" && req.method === "POST") {
      const { magnet, magnetHash } = await req.json<{ magnet: string; magnetHash: string }>();
      if (!magnet || !magnetHash) {
        return Response.json({ error: "missing_magnet" }, { status: 400 });
      }
      const client = buildClient(env);
      try {
        const added = await client.addMagnetIdempotent(magnet, magnetHash);
        const selection = await client.getTorrentInfo(added.id);
        if (selection.status === "waiting_files_selection") {
          await client.selectFiles(added.id, "all");
        }
        const outcome = await pollTorrentStatus(client, added.id, { hardTimeoutMs: 60_000 });
        if (outcome.kind === "downloaded") {
          return Response.json({
            status: "downloaded",
            links: outcome.info.links,
          });
        }
        if (outcome.kind === "failed") {
          return Response.json({ status: "failed", reason: outcome.reason }, { status: 422 });
        }
        return Response.json({ status: outcome.kind }, { status: 202 });
      } catch (err) {
        const { status, body } = toClientSafeError(err);
        return Response.json(body, { status });
      }
    }

    if (url.pathname === "/api/downloads" && req.method === "GET") {
      const client = buildClient(env);
      try {
        const downloads = await client.listDownloads();
        return Response.json(
          downloads.map((d) => ({ id: d.id, filename: d.filename, download: d.download, filesize: d.filesize })),
        );
      } catch (err) {
        const { status, body } = toClientSafeError(err);
        return Response.json(body, { status });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
