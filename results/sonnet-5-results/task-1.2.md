DIAGNOSIS: iOS Safari HLS playback failure

Note on certainty: this diagnosis is based entirely on the artifacts provided (worker snippet, frontend snippet, console/network excerpts, and the Real-Debrid note). I have not run this code. Where I infer iOS Safari/AVPlayer internals (e.g. MIME-sniffing strictness, native HLS engine behavior) I am relying on well-documented platform behavior, not on something I verified in this environment — flagged inline as "(platform behavior, not verified here)".

======================================================================
BUG #1 (ranked #1 — breaks iOS first / is the proximate cause)
======================================================================
Symptom:
video readyState stays 0 (HAVE_NOTHING), video.error = MEDIA_ERR_SRC_NOT_SUPPORTED, and the console shows "Plug-in handled load (segment_0001.ts)". The master.m3u8 request returns content-type: application/octet-stream instead of application/vnd.apple.mpegurl, and it is fetched directly from cdn.rd-host.example rather than through the Worker.

Cause:
On iOS Safari, Hls.isSupported() (hls.js's MSE-support check) returns false, because iOS Safari does not expose the MSE APIs hls.js needs (platform behavior, not verified here). The code therefore takes the `else` branch: `video.src = masterUrl`, i.e. native HLS playback via AVPlayer, using the RAW, un-proxied Real-Debrid URL. Apple's native HLS engine is strict about content sniffing/MIME type for the initial resource (platform behavior, not verified here); Real-Debrid's CDN serves the master playlist (and segments) as application/octet-stream instead of application/vnd.apple.mpegurl / video/mp2t. Since this path never goes through the Worker (which is the only place a Content-Type could be corrected), Safari's native player cannot recognize the resource as HLS and immediately fails with MEDIA_ERR_SRC_NOT_SUPPORTED before readyState advances past 0. This is exactly why Chrome works (hls.js/MSE ignores server MIME type and manually parses/feeds bytes into the SourceBuffer) while iOS fails (native player depends on correct MIME type).

Fix (frontend + worker, ~10 lines):
Route the native-fallback path through the same proxy used for hls.js, and have the Worker force the correct Content-Type based on the requested resource's extension so Safari's native player recognizes it:

```js
// frontend
} else {
  video.src = proxied(masterUrl); // was: video.src = masterUrl
}
```
```js
// worker: after h.delete("content-length")
const path = new URL(url).pathname;
h.set("Content-Type",
  path.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" :
  path.endsWith(".ts")   ? "video/mp2t" :
  upstream.headers.get("content-type") || "application/octet-stream");
```

======================================================================
BUG #2 (ranked #2 — structural, causes bug #1 and compounds segment loading)
======================================================================
Symptom:
None of the Worker's fixes (CORS header, any future content-type/range handling) ever apply on iOS; both master.m3u8 and segment_0001.ts are requested directly against cdn.rd-host.example in the network log, bypassing the Worker entirely.

Cause:
The frontend only proxies the URL on the hls.js branch (`proxied(masterUrl)` inside `hls.loadSource`). The native-fallback branch (`video.src = masterUrl`) uses the unproxied URL, and any HLS playlist parsed natively will also resolve segment URIs against that same un-proxied origin. This is the same root code defect as Bug #1 (missing `proxied()` call in the else branch), but it's worth calling out separately because it's the reason "fixing the Worker" alone will not fix iOS — the Worker's fixes are dead code for the platform that needs them most unless the fallback path is also routed through it.

Fix:
Same one-line change as Bug #1 (`video.src = proxied(masterUrl)`). No additional code needed — listed separately here only because it is a distinct architectural gap (proxy coverage), not a duplicate report of the same line.

======================================================================
BUG #3 (ranked #3 — breaks seeking/byte-range once the proxy is actually used)
======================================================================
Symptom:
"[Network] GET .../segment_0001.ts — 200 (expected 206)". Once traffic is routed through the Worker (after fixing Bug #1/#2), Range requests will still not be honored correctly.

Cause:
The Worker hard-codes `status: 200` in its Response regardless of what the upstream returned:
```js
return new Response(upstream.body, { status: 200, headers: h });
```
If a client sends a `Range` header and the upstream (Real-Debrid host) honors it with a `206 Partial Content` + `Content-Range` response, the Worker discards that status and reports `200` while still forwarding the `Content-Range` header (since headers are copied wholesale via `new Headers(upstream.headers)`). A `200` status with a `Content-Range` header is a malformed/inconsistent HTTP response. iOS's native player and MSE-based players both rely on correct 206 semantics for seeking and incremental buffering; Safari in particular is known to be strict about this (platform behavior, not verified here). Chrome/hls.js is less affected in the simple case shown here because hls.js typically does plain sequential segment fetches without relying on the proxy honoring mid-file Range requests, but this remains a latent bug for any byte-range playlist (`EXT-X-BYTERANGE`) or seek-driven Range request on any platform.

Fix (~3 lines):
```js
// worker
const upstream = await fetch(url, { headers: { Range: req.headers.get("Range") || "" } });
const h = new Headers(upstream.headers);
h.set("Access-Control-Allow-Origin", "*");
h.delete("content-length");
return new Response(upstream.body, { status: upstream.status, headers: h }); // was: status: 200
```

======================================================================
BUG #4 (ranked #4 — real bug, but not what's shown failing in this specific log; affects both platforms)
======================================================================
Symptom:
Per the Real-Debrid note: "the unrestricted link is a direct MP4 for some titles and an HLS master for others; the app always treats it as HLS." For MP4 titles, hls.js's `loadSource()` will attempt to parse the MP4 binary as an m3u8 playlist and fail (on Chrome), or the native fallback will hand a raw MP4 URL to `video.src` expecting HLS-specific handling.

Cause:
The frontend never inspects the resolved Real-Debrid link (extension, or the RD API's reported mimeType/streamable type) before deciding to treat it as HLS. It unconditionally calls `hls.loadSource(proxied(masterUrl))` / falls back to treating `masterUrl` as an HLS master. This is not what's failing in the specific console log given (that log clearly shows a real .m3u8/.ts pair), but it's a distinct, real defect per the Real-Debrid note and will break playback (on both Chrome and iOS) for any title where RD returns a direct MP4.

Fix (~6 lines):
```js
const isHls = /\.m3u8(\?|$)/i.test(masterUrl); // or check RD API's returned mimeType field if available
if (isHls && Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(proxied(masterUrl));
  hls.attachMedia(video);
} else {
  video.src = proxied(masterUrl); // works for both native-HLS fallback and direct MP4
}
```

======================================================================
SUMMARY TABLE
======================================================================
1. Missing Content-Type correction + native fallback bypassing proxy → Safari native player can't recognize application/octet-stream master.m3u8 → MEDIA_ERR_SRC_NOT_SUPPORTED, readyState 0. (Primary/first cause of iOS failure.)
2. Native-fallback branch (`video.src = masterUrl`) never calls `proxied()`, so the Worker's fixes never run on iOS at all. (Same code line as #1's fix; listed separately as the structural reason iOS is uniquely affected.)
3. Worker hard-codes HTTP status 200, discarding upstream's 206/Content-Range on Range requests, breaking correct partial-content semantics for seeking/buffering.
4. App never distinguishes an RD direct-MP4 link from an RD HLS-master link before choosing hls.js vs. native playback, per the Real-Debrid note. Real but not the cause of the specific log shown; affects both platforms.

Minimal fix, in order of priority: (a) change `video.src = masterUrl` to `video.src = proxied(masterUrl)`; (b) have the Worker set Content-Type from the requested path's extension instead of passing through `application/octet-stream`; (c) change the Worker's hard-coded `status: 200` to `status: upstream.status`; (d) add a cheap extension/mimeType check before deciding HLS vs. direct-file playback. None of this requires rewriting the pipeline — all four fixes are localized, single-purpose diffs against the two snippets given.
