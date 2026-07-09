# Diagnosis

The iOS path is not the same path as Chrome desktop. On iOS Safari, `Hls.isSupported()` is normally false because Safari uses native HLS playback instead of hls.js/MSE, so the fallback assigns `video.src = masterUrl`. The network log confirms that: iOS requests `https://cdn.rd-host.example/...` directly, not the Worker URL. That is the first divergence. The current title appears to be an HLS title (`master.m3u8` plus `.ts`), while the Real-Debrid note adds a separate MP4-vs-HLS classification bug for other titles.

Ranked by the first likely iOS-breaking point and by evidence in the artifacts:

1. iOS native fallback bypasses the proxy entirely.
2. Byte-range semantics are broken: Safari expected `206`, but got `200`; the Worker would also clobber an upstream `206` into `200`.
3. HLS/media MIME types are wrong: `application/octet-stream` is served for `.m3u8` and `.ts`.
4. HLS child URLs are not guaranteed to stay behind the proxy.
5. Real-Debrid links are sometimes direct MP4, but the app always treats them as HLS.
6. CORS/preflight/header exposure and `HEAD` handling are incomplete for browser media fetches.

## 1. iOS fallback bypasses the proxy

Symptom -> iOS Safari requests `https://cdn.rd-host.example/video/master.m3u8` and `segment_0001.ts` directly, `readyState` remains `0`, and playback ends with `MEDIA_ERR_SRC_NOT_SUPPORTED`; Chrome desktop works because it enters the hls.js branch and calls `proxied(masterUrl)`. Cause -> `Hls.isSupported()` is false on iOS Safari, so the fallback uses the raw Real-Debrid/CDN URL and skips the Worker layer that is supposed to normalize headers, ranges, MIME types, and child HLS URLs. Fix -> send native Safari HLS through the same proxy URL; this is necessary but not sufficient by itself, because the Worker still has the range and MIME bugs below.

```diff
+const src = proxied(masterUrl);
 if (Hls.isSupported()) {
   const hls = new Hls();
-  hls.loadSource(proxied(masterUrl));
+  hls.loadSource(src);
   hls.attachMedia(video);
-} else {
-  video.src = masterUrl; // fallback
+} else if (video.canPlayType("application/vnd.apple.mpegurl")) {
+  video.src = src; // native iOS HLS, still via proxy
 }
```

## 2. Worker corrupts byte-range responses

Symptom -> the iOS network log shows `segment_0001.ts` returned `200` where Safari expected `206`; native Safari is much stricter about media byte ranges than hls.js. Cause -> the Worker forwards a `Range` header, but always returns `status: 200`, deletes `content-length`, and sends an empty `Range` header when the client did not ask for one. If upstream actually returned `206 Partial Content`, the Worker destroys that status; if upstream itself ignores ranges and returns `200`, the link is not suitable for Safari byte-range playback without a real range-capable proxy. Fix -> only forward `Range` when present, preserve upstream status/statusText and range headers, and do not delete `Content-Length` for media objects. Delete `Content-Length` only when you rewrite a manifest body.

```diff
-const upstream = await fetch(url, { headers: { Range: req.headers.get("Range") || "" } });
+const headers = new Headers();
+const range = req.headers.get("Range");
+if (range) headers.set("Range", range);
+const upstream = await fetch(url, { method: req.method, headers });
 const h = new Headers(upstream.headers);
 h.set("Access-Control-Allow-Origin", "*");
-h.delete("content-length");
-return new Response(upstream.body, { status: 200, headers: h });
+return new Response(upstream.body, {
+  status: upstream.status,
+  statusText: upstream.statusText,
+  headers: h,
+});
```

## 3. Worker/CDN serves HLS as `application/octet-stream`

Symptom -> the log shows `master.m3u8` and `segment_0001.ts` coming back as `application/octet-stream`, followed by `MEDIA_ERR_SRC_NOT_SUPPORTED` and Safari's vague `Plug-in handled load` message. Cause -> hls.js can often tolerate generic MIME types because it fetches and parses bytes in JavaScript, but native iOS Safari expects recognizable media/HLS types, especially for the top-level playlist and media segments. Fix -> in the Worker, override known Real-Debrid generic content types by extension or by detected playlist content; keep this scoped to media types, not a broad response rewrite.

```diff
 const h = new Headers(upstream.headers);
+const path = new URL(url).pathname.toLowerCase();
+if (path.endsWith(".m3u8")) h.set("Content-Type", "application/vnd.apple.mpegurl");
+else if (path.endsWith(".ts")) h.set("Content-Type", "video/mp2t");
+else if (path.endsWith(".m4s")) h.set("Content-Type", "video/iso.segment");
+else if (path.endsWith(".mp4")) h.set("Content-Type", "video/mp4");
 h.set("Access-Control-Allow-Origin", "*");
```

## 4. HLS child resources can escape the proxy

Symptom -> even if the master playlist is loaded through the Worker, Safari/hls.js will resolve variant playlists, media playlists, segments, keys, and maps from the URLs inside the `.m3u8`; if those are absolute CDN URLs or relative paths resolved against the wrong base, later requests bypass the Worker and lose the fixed headers. Cause -> the Worker streams playlists unchanged, and the frontend only proxies the top-level `masterUrl`. Fix -> when the proxied resource is a manifest, rewrite URI lines and common `URI="..."` attributes to point back at the same Worker with the child URL encoded in `u`; do not rewrite comments or tags except URI attributes.

```diff
+if (new URL(url).pathname.toLowerCase().endsWith(".m3u8")) {
+  const base = new URL(url);
+  const proxify = (u) => {
+    const p = new URL(req.url);
+    p.searchParams.set("u", new URL(u, base).href);
+    return p.href;
+  };
+  const text = (await upstream.text())
+    .replace(/^([^#\r\n][^\r\n]*)/gm, (_, u) => proxify(u.trim()))
+    .replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxify(u)}"`);
+  h.delete("Content-Length");
+  return new Response(text, { status: upstream.status, headers: h });
+}
 return new Response(upstream.body, { status: upstream.status, headers: h });
```

## 5. Real-Debrid output is not always HLS

Symptom -> some titles are direct MP4 files, but the app always calls the variable `masterUrl` and sends it to `hls.loadSource(...)`; those MP4 titles will fail in hls.js because an MP4 file is not an HLS manifest. Cause -> the Real-Debrid unrestricted URL is being treated as a format guarantee, but the note says it is polymorphic: sometimes direct MP4, sometimes HLS master. Fix -> classify the link at the Real-Debrid adapter/API boundary using reliable metadata if available, otherwise by `Content-Type`, extension, or a small initial read checking for `#EXTM3U`; then only use hls.js for HLS and assign MP4 directly to the video element through the same proxy.

```diff
-const src = proxied(masterUrl);
-if (Hls.isSupported()) {
+const src = proxied(media.url);
+if (media.kind === "hls" && Hls.isSupported()) {
   const hls = new Hls();
   hls.loadSource(src);
   hls.attachMedia(video);
-} else if (video.canPlayType("application/vnd.apple.mpegurl")) {
-  video.src = src; // native iOS HLS, still via proxy
+} else {
+  video.src = src; // direct MP4, or native HLS on Safari
 }
```

## 6. CORS, preflight, exposed headers, and `HEAD` are incomplete

Symptom -> this is probably not the first iOS failure shown, because native media playback is already using the raw CDN URL, but it can break hls.js/range loading in other browsers or after the iOS path is moved to the proxy. Cause -> the Worker only sets `Access-Control-Allow-Origin`; it does not answer `OPTIONS`, allow `Range`, expose `Content-Range`/`Accept-Ranges`/`Content-Length`, or preserve non-GET methods unless combined with the range fix above. Fix -> add a tiny shared CORS header set, handle preflight locally, and pass `method: req.method` upstream for `GET`/`HEAD` media probes.

```diff
+const cors = {
+  "Access-Control-Allow-Origin": "*",
+  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
+  "Access-Control-Allow-Headers": "Range",
+  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
+};
+if (req.method === "OPTIONS") {
+  return new Response(null, { status: 204, headers: cors });
+}
 const h = new Headers(upstream.headers);
-h.set("Access-Control-Allow-Origin", "*");
+Object.entries(cors).forEach(([k, v]) => h.set(k, v));
```

## Minimal fix set

Do not rewrite the pipeline. The smallest reliable patch is:

1. Change the iOS/native fallback to use `proxied(...)`, not the raw Real-Debrid URL.
2. Fix the Worker to preserve upstream `206`, `Content-Range`, `Accept-Ranges`, and `Content-Length` for media; do not send empty `Range` headers.
3. Override generic `application/octet-stream` for `.m3u8`, `.ts`, `.m4s`, and `.mp4`.
4. Rewrite manifest child URLs so every playlist, segment, key, and map request continues through the Worker.
5. Add an RD link type check so MP4 links use `video.src = proxied(mp4Url)` and HLS links use hls.js only where hls.js is actually supported.

For the specific iOS log, the first proven bug is the fallback bypassing the proxy; the immediate fatal media-level bug is the bad `200`/range response on the first segment, with the wrong MIME types as an independent Safari-only failure source.