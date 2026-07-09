# Diagnosis & Minimal Fixes for HLS Playback Failure on iOS Safari

Below is the diagnosis of all distinct bugs causing video playback to break on iOS Safari, ranked in the order they break the player first, followed by the proposed minimal fixes.

---

## Ranked Bugs

### 1. Frontend Fallback Bypasses the Proxy on iOS
* **Symptom**: iOS Safari fails immediately to load the master playlist, showing a network request directly to `https://cdn.rd-host.example/video/master.m3u8` which fails or returns an unauthorized/IP-locked page.
* **Cause**: iOS Safari does not support MediaSource Extensions (MSE), so `Hls.isSupported()` returns `false`. This forces execution to go to the `else` block, which assigns the unproxied `masterUrl` directly to `video.src`. Because Real-Debrid links are restricted by IP or require specific headers, the direct request fails.
* **Fix**: Wrap the fallback `masterUrl` in the `proxied()` helper so that the native player also routes its requests through the proxy. We also restrict the HLS check to only execute `Hls` initialization if the URL points to an HLS playlist (i.e. contains `.m3u8`), which resolves the MP4 playability bug.

```diff
@@ -1,8 +1,9 @@
 const video = document.querySelector("video");
-if (Hls.isSupported()) {
+const proxiedUrl = proxied(masterUrl);
+if (Hls.isSupported() && masterUrl.includes(".m3u8")) {
   const hls = new Hls();
-  hls.loadSource(proxied(masterUrl));
+  hls.loadSource(proxiedUrl);
   hls.attachMedia(video);
 } else {
-  video.src = masterUrl; // fallback
+  video.src = proxiedUrl; // fallback
 }
```

---

### 2. Malformed Range Request Handling in Worker (Status 200 instead of 206)
* **Symptom**: iOS Safari console shows `[Network] GET ... — 200 (expected 206)` and/or `video error: MEDIA_ERR_SRC_NOT_SUPPORTED`, and playback fails.
* **Cause**: iOS Safari's native media player (AVPlayer) requests video resources using HTTP Range requests (sending `Range: bytes=...`). The Cloudflare Worker forwards the `Range` header, but overrides the return status code to a hardcoded `200` instead of forwarding the upstream's `206 Partial Content`. It also deletes the `Content-Length` header. AVPlayer strictly requires a `206` status and matching range headers to proceed.
* **Fix**: Update the worker to return the correct upstream status code (`upstream.status`) and retain the `content-length` header.

```diff
@@ -6,3 +6,3 @@
     h.set("Access-Control-Allow-Origin", "*");
-    h.delete("content-length");
-    return new Response(upstream.body, { status: 200, headers: h });
+    return new Response(upstream.body, { status: upstream.status, headers: h });
   }
```

---

### 3. Missing/Incorrect MIME Type for HLS Playlists
* **Symptom**: iOS Safari console shows `[Log] video error: MEDIA_ERR_SRC_NOT_SUPPORTED` and the network inspector logs `content-type: application/octet-stream` for the playlist.
* **Cause**: iOS Safari's native media engine is extremely strict about MIME types. If the playlist content type is `application/octet-stream` (which is returned by Real-Debrid CDN), Safari rejects the stream, as it requires `application/x-mpegURL` or `application/vnd.apple.mpegurl` to recognize the HLS protocol.
* **Fix**: Modify the worker to detect if the proxied URL contains an `.m3u8` playlist or `.ts` segment, overriding the `Content-Type` header to `application/x-mpegURL` and `video/MP2T` respectively.

```diff
@@ -5,2 +5,4 @@
     h.set("Access-Control-Allow-Origin", "*");
+    if (url.pathname.endsWith(".m3u8")) h.set("content-type", "application/x-mpegURL");
+    if (url.pathname.endsWith(".ts")) h.set("content-type", "video/MP2T");
     h.delete("content-length");
```

---

### 4. Query-Based Proxy Strips Relative Segment Paths
* **Symptom**: Once HLS fallback is proxied, the master playlist loads, but individual segment requests (e.g., `segment_0001.ts`) return worker errors or 404s.
* **Cause**: HLS master playlists often contain relative segment paths. Standard URL resolution resolves relative paths against the base URL. If the proxy URL uses a query parameter (e.g., `https://worker.example/?u=...`), resolving `segment_0001.ts` against it yields `https://worker.example/segment_0001.ts`, stripping the query parameter containing the target domain.
* **Fix**: Rewrite the `proxied()` helper and the worker to support path-based proxy URLs (e.g., `https://worker.example/https://cdn.rd-host.example/...`). The worker will extract the target URL from the pathname if the query parameter `u` is not provided.

```diff
@@ -1,3 +1,8 @@
 export default {
   async fetch(req) {
-    const url = new URL(req.url).searchParams.get("u");
+    let urlStr = new URL(req.url).searchParams.get("u");
+    if (!urlStr) {
+      const idx = req.url.indexOf("/http");
+      if (idx !== -1) urlStr = req.url.substring(idx + 1);
+    }
+    const url = new URL(urlStr);
```

---

### 5. Frontend Player Incompatibility with Direct MP4 Titles
* **Symptom**: Playback breaks on Chrome desktop for MP4 titles.
* **Cause**: Real-Debrid links are direct MP4s for some titles. The app always treats the link as HLS, causing Chrome desktop to instantiate `hls.js` and call `hls.loadSource(proxied(masterUrl))` with an MP4 URL, which triggers a fatal manifest parsing error in `hls.js`.
* **Fix**: Modify the `if` block in the frontend to check if the URL contains `.m3u8` before initializing `hls.js`. (Addressed in the Bug 1 diff above).

---

## Consolidated Minimal Fix

### Cloudflare Worker Proxy
```javascript
export default {
  async fetch(req) {
    let urlStr = new URL(req.url).searchParams.get("u");
    if (!urlStr) {
      const idx = req.url.indexOf("/http");
      if (idx !== -1) urlStr = req.url.substring(idx + 1);
    }
    const url = new URL(urlStr);
    const upstream = await fetch(url, { headers: { Range: req.headers.get("Range") || "" } });
    const h = new Headers(upstream.headers);
    h.set("Access-Control-Allow-Origin", "*");
    if (url.pathname.endsWith(".m3u8")) h.set("content-type", "application/x-mpegURL");
    if (url.pathname.endsWith(".ts")) h.set("content-type", "video/MP2T");
    return new Response(upstream.body, { status: upstream.status, headers: h });
  }
}
```

### Frontend Player Initialization
```javascript
const proxied = (url) => `https://proxy.example/${url}`; // Path-based proxy helper to preserve relative URLs
const video = document.querySelector("video");
const proxiedUrl = proxied(masterUrl);
if (Hls.isSupported() && masterUrl.includes(".m3u8")) {
  const hls = new Hls();
  hls.loadSource(proxiedUrl);
  hls.attachMedia(video);
} else {
  video.src = proxiedUrl; // fallback
}
```
