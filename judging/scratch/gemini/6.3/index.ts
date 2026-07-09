import { RealDebridClient, RealDebridError } from "./realDebridClient";

export interface Env {
  // Bindings configured in wrangler.toml or the Cloudflare Dashboard
  REAL_DEBRID_API_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // simple token validation
    if (!env.REAL_DEBRID_API_TOKEN) {
      return new Response(JSON.stringify({ error: "Server Configuration Error: Missing API token" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const client = new RealDebridClient(env.REAL_DEBRID_API_TOKEN);

    // Router
    try {
      // 1. ADD MAGNET & START DOWNLOAD
      if (url.pathname === "/api/magnet" && request.method === "POST") {
        const body = (await request.json()) as { magnet?: string; selectAll?: boolean };
        if (!body.magnet || !body.magnet.startsWith("magnet:")) {
          return new Response(JSON.stringify({ error: "Invalid magnet URI" }), { status: 400 });
        }

        // Add magnet
        const addResponse = await client.addMagnet(body.magnet);
        
        // Auto-select files if requested
        if (body.selectAll) {
          // Fetch initial info to see files list
          const info = await client.getTorrentInfo(addResponse.id);
          if (info.status === "waiting_files_selection") {
            await client.selectFiles(addResponse.id, "all");
          }
        }

        return new Response(JSON.stringify({ success: true, torrentId: addResponse.id }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 2. POLL TORRENT STATUS
      if (url.pathname.startsWith("/api/poll/") && request.method === "GET") {
        const torrentId = url.pathname.split("/").pop();
        if (!torrentId) {
          return new Response(JSON.stringify({ error: "Missing Torrent ID" }), { status: 400 });
        }

        // Poll torrent in worker context (timeout after 2 mins to prevent Worker termination)
        const finalInfo = await client.pollTorrent(torrentId, {
          timeoutMs: 120000,
          initialDelayMs: 1000,
          maxDelayMs: 10000,
          jitter: true,
        });

        // If successfully downloaded, we can automatically unrestrict the links
        let downloadLinks: string[] = [];
        if (finalInfo.status === "downloaded" && finalInfo.links.length > 0) {
          const unrestrictPromises = finalInfo.links.map((link) => client.unrestrictLink(link));
          const unrestricted = await Promise.all(unrestrictPromises);
          downloadLinks = unrestricted.map((r) => r.download);
        }

        return new Response(
          JSON.stringify({
            status: finalInfo.status,
            progress: finalInfo.progress,
            downloadLinks,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 3. LIST DOWNLOADS
      if (url.pathname === "/api/downloads" && request.method === "GET") {
        const page = parseInt(url.searchParams.get("page") || "1", 10);
        const downloads = await client.listDownloads(page);
        return new Response(JSON.stringify({ downloads }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Fallback
      return new Response(JSON.stringify({ error: "Not Found" }), { status: 404 });

    } catch (err) {
      // Map typed client errors to client-safe JSON responses
      if (err instanceof RealDebridError) {
        return new Response(
          JSON.stringify({
            error: err.message,
            code: err.name,
          }),
          {
            status: err.status || 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ error: (err as Error).message || "Internal Server Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};
