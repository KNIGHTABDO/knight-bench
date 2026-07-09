# Diagnosis: iOS Safari HLS broken - Ranked Root Causes

## Rank 1 - CRITICAL: Worker forces status 200, breaks Range / 206
**Symptom:** `GET segment_0001.ts — 200 (expected 206)` + `Plug-in handled load`, `readyState 0` on iOS only. Chrome works because hls.js can tolerate 200.
**Cause:** `return new Response(..., { status: 200 })` ignores upstream `206 Partial Content`. Safari's AVFoundation/native HLS *requires* `206` + `Content-Range` for byte-range requests on ts segments. Also forwards `Range: ""` when header absent, sending invalid header.
**Fix:** Pass through status and range headers, only send Range if present.
```diff
- const upstream = await fetch(url, { headers: { Range: req.headers.get("Range") || "" } });
+ const range = req.headers.get("Range");
+ const upstream = await fetch(url, { headers: range ? {Range: range} : {} });
  const h = new Headers(upstream.headers);
- return new Response(upstream.body, { status: 200, headers: h });
+ return new Response(upstream.body, { status: upstream.status, headers: h });
```

## Rank 2 - CRITICAL: Wrong Content-Type for HLS manifest/segments
**Symptom:** `content-type: application/octet-stream` for both `.m3u8` and `.ts`, `MEDIA_ERR_SRC_NOT_SUPPORTED`. Chrome hls.js sniffs; iOS native parser is strict.
**Cause:** Worker proxies headers verbatim from Real-Debrid CDN which returns `octet-stream`. Native HLS requires `application/vnd.apple.mpegurl` or `application/x-mpegURL` for manifest and `video/MP2T` for segments.
**Fix:**
```diff
  const h = new Headers(upstream.headers);
+ if (url.endsWith(".m3u8")) h.set("Content-Type","application/vnd.apple.mpegurl");
+ else if (url.endsWith(".ts")) h.set("Content-Type","video/MP2T");
+ h.set("Accept-Ranges","bytes");
  h.set("Access-Control-Allow-Origin","*");
```

## Rank 3 - CRITICAL: Frontend iOS fallback bypasses proxy + no playlist rewriting
**Symptom:** `Network GET https://cdn.rd-host.example/...` directly, not via Worker. iOS goes `else { video.src = masterUrl }`.
**Cause:** `Hls.isSupported()` is `false` on iOS Safari (native HLS, no MSE). Code then sets `video.src = masterUrl` not `proxied(masterUrl)`. Additionally Worker never rewrites m3u8 contents, so segment URLs inside manifest point directly to RD CDN, bypassing CORS/auth proxy and hitting expired/IP-locked links.
**Fix:**
```diff
  // frontend
- video.src = masterUrl;
+ video.src = proxied(masterUrl);

  // worker - if content-type is m3u8, rewrite
+ if (url.endsWith(".m3u8")) {
+   let txt = await upstream.text();
+   txt = txt.replace(/^(?!#)(.*)/gm, l => l.trim().startsWith('http') ? `/proxy?u=${encodeURIComponent(l.trim())}` : l);
+   return new Response(txt, { status: upstream.status, headers: h });
+ }
```

## Rank 4 - HIGH: Real-Debrid MP4 vs HLS handling
**Symptom:** Intermittent failure for titles where RD returns direct MP4. Note: "app always treats it as HLS".
**Cause:** hls.js will error loading MP4 as manifest. On iOS, native `<video>` can play MP4, but only if correctly sniffed. Chrome might get lucky via fallback.
**Fix:**
```diff
+ const isM3U8 = masterUrl.includes(".m3u8") || (await fetch(proxied(masterUrl),{method:"HEAD"})).headers.get("content-type")?.includes("mpegurl"));
+ if (!isM3U8) { video.src = proxied(masterUrl); return; }
  if (Hls.isSupported()) { ... }
```

## Rank 5 - MEDIUM: Worker drops range passthrough headers + CORS preflight missing
**Symptom:** Even with 206, seek fails.
**Cause:** Deletes `content-length` correctly but fails to preserve `Content-Range`, `Accept-Ranges`. No `OPTIONS` handler for hls.js XHR.
**Fix:**
```diff
+ if (req.method === "OPTIONS") return new Response(null,{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Range, Content-Type"}});
  h.delete("content-length");
+ // keep content-range, accept-ranges from upstream
```
