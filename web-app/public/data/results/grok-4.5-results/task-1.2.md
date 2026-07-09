# iOS Safari HLS Playback — Root Cause Diagnosis

## Executive summary

Chrome works because it uses **hls.js** (`Hls.isSupported()` is true) over the **proxied** URL. iOS Safari fails because `Hls.isSupported()` is **false**, so the code takes the **native** path: `video.src = masterUrl` (unproxied). Native Safari HLS is strict about **MIME types**, **Range/206**, and **playlist vs progressive media**. The network log shows exactly that failure mode: `application/octet-stream` for `.m3u8`/`.ts`, `200` where `206` is expected, and `MEDIA_ERR_SRC_NOT_SUPPORTED`.

Do **not** rewrite the whole pipeline. Fix MIME/status passthrough, the Safari fallback URL path, and media-type branching.

---

## Ranked root causes (what breaks iOS first)

### Rank 1 — Wrong `Content-Type` for native HLS (highest likelihood)

**Symptom**
- `[Network] master.m3u8 … content-type: application/octet-stream`
- `[Network] segment_0001.ts … content-type: application/octet-stream`
- `video error: MEDIA_ERR_SRC_NOT_SUPPORTED`
- `video readyState: 0`
- Chrome + hls.js still plays (hls.js fetches/parses playlists itself and is far more tolerant of wrong MIME).

**Cause**
On iOS, playback uses the **native** HLS engine (`video.src = …`), not hls.js. Safari’s native stack typically expects:
- playlists: `application/vnd.apple.mpegurl` or `application/x-mpegURL`
- MPEG-TS segments: `video/mp2t` (or a recognized media type)

`application/octet-stream` is treated as an unknown/unsupported source for the media element, producing `MEDIA_ERR_SRC_NOT_SUPPORTED` even when the body is a valid `.m3u8` / `.ts`. The CDN/Real-Debrid unrestricted host serves octet-stream; the iOS fallback hits that host **directly**.

**Minimal fix (≤15 lines) — force correct types on the proxy response**

```diff
 export default {
   async fetch(req) {
     const url = new URL(req.url).searchParams.get("u");
-    const upstream = await fetch(url, { headers: { Range: req.headers.get("Range") || "" } });
+    const range = req.headers.get("Range");
+    const upstream = await fetch(url, { headers: range ? { Range: range } : {} });
     const h = new Headers(upstream.headers);
     h.set("Access-Control-Allow-Origin", "*");
-    h.delete("content-length");
+    const path = new URL(url).pathname.toLowerCase();
+    if (path.endsWith(".m3u8")) h.set("Content-Type", "application/vnd.apple.mpegurl");
+    else if (path.endsWith(".ts")) h.set("Content-Type", "video/mp2t");
+    else if (path.endsWith(".mp4")) h.set("Content-Type", "video/mp4");
     return new Response(upstream.body, { status: 200, headers: h });
   }
 }
```

(Also route Safari through this proxy — see Rank 2. MIME fix alone on CDN is not under app control.)

---

### Rank 2 — Safari fallback never uses the proxy (and never uses hls.js)

**Symptom**
- Network requests go to `https://cdn.rd-host.example/...` (origin CDN), not the Worker proxy.
- iOS-only failure; desktop Chrome OK.
- Console: readyState 0, `MEDIA_ERR_SRC_NOT_SUPPORTED`.

**Cause**
```js
if (Hls.isSupported()) {
  hls.loadSource(proxied(masterUrl));  // Chrome
} else {
  video.src = masterUrl;               // iOS: raw CDN, no MIME/CORS/Range fixes
}
```
`Hls.isSupported()` is false on iOS Safari (no full MSE path for hls.js). The `else` branch is the intended native-HLS path, but it:
1. Skips `proxied(...)`, so Worker header fixes never apply.
2. Does not set `type` / does not prefer `canPlayType('application/vnd.apple.mpegurl')` explicitly.
3. Leaves iOS dependent on CDN headers that are wrong (Rank 1) and Range behavior that is weak (Rank 3).

**Minimal fix (≤15 lines) — proxy native path too; detect native HLS**

```diff
 const video = document.querySelector("video");
-if (Hls.isSupported()) {
+const src = proxied(masterUrl);
+if (Hls.isSupported()) {
   const hls = new Hls();
-  hls.loadSource(proxied(masterUrl));
+  hls.loadSource(src);
   hls.attachMedia(video);
-} else {
-  video.src = masterUrl; // fallback
+} else if (video.canPlayType("application/vnd.apple.mpegurl")) {
+  video.src = src; // iOS native HLS via proxy
+} else {
+  video.src = src;
 }
```

---

### Rank 3 — Worker always returns HTTP 200 (breaks Range / partial content)

**Symptom**
- `[Network] segment_0001.ts — 200 (expected 206)`
- Seeking/stalling or hard fail under native HLS; “Plug-in handled load” noise around TS segments.
- Any client that sends `Range` and requires `206 Partial Content` + `Content-Range` will misbehave.

**Cause**
```js
return new Response(upstream.body, { status: 200, headers: h });
```
Even when upstream correctly answers `206` with `Content-Range`, the Worker **forces 200**. Combined with `h.delete("content-length")`, Safari’s byte-range pipeline for media is corrupted: status and length no longer match a partial body. Desktop hls.js often downloads full segments without relying on browser-level media Range the same way, so Chrome still works.

Note: today’s iOS logs show **direct CDN** hits (Rank 2), so Rank 1–2 dominate *current* failure. Once Safari is pointed at the proxy, **this** bug becomes critical and must be fixed in the same change set.

**Minimal fix (≤15 lines) — pass through status; keep length for ranged responses**

```diff
 export default {
   async fetch(req) {
     const url = new URL(req.url).searchParams.get("u");
-    const upstream = await fetch(url, { headers: { Range: req.headers.get("Range") || "" } });
+    const range = req.headers.get("Range");
+    const upstream = await fetch(url, {
+      headers: range ? { Range: range } : {},
+    });
     const h = new Headers(upstream.headers);
     h.set("Access-Control-Allow-Origin", "*");
-    h.delete("content-length");
-    return new Response(upstream.body, { status: 200, headers: h });
+    // do not strip content-length; do not force 200
+    return new Response(upstream.body, { status: upstream.status, headers: h });
   }
 }
```

Also avoid sending `Range: ""` when the client sent no Range (empty Range confuses some origins).

---

### Rank 4 — App always treats Real-Debrid unrestricted links as HLS

**Symptom**
- Some titles are **direct MP4**, others **HLS master**.
- App always does `loadSource(masterUrl)` / `video.src = masterUrl` as if every link were an `.m3u8`.
- Intermittent title-specific failures: MP4-as-HLS → parse/support errors; or HLS path used for progressive MP4 without proper `video/mp4` handling.

**Cause**
No content sniffing / URL / `Content-Type` branch. Real-Debrid’s unrestricted endpoint is polymorphic. Forcing HLS on an MP4 yields unsupported source on native Safari (and often odd errors in hls.js).

**Minimal fix (≤15 lines) — branch MP4 vs HLS**

```diff
-const video = document.querySelector("video");
-if (Hls.isSupported()) {
-  const hls = new Hls();
-  hls.loadSource(proxied(masterUrl));
-  hls.attachMedia(video);
-} else {
-  video.src = masterUrl;
-}
+const video = document.querySelector("video");
+const src = proxied(unrestrictedUrl);
+const isHls = /\.m3u8(\?|$)/i.test(unrestrictedUrl) || unrestrictedUrl.includes("mpegurl");
+if (isHls && Hls.isSupported()) {
+  const hls = new Hls(); hls.loadSource(src); hls.attachMedia(video);
+} else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
+  video.src = src;
+} else {
+  video.src = src; // progressive MP4 (and non-hls.js fallback)
+}
```

(Optionally HEAD the unrestricted URL once and key off `Content-Type` / magic bytes if the URL has no extension.)

---

### Rank 5 — Worker strips `Content-Length` unconditionally

**Symptom**
- Incomplete or hung media loads through the proxy; Range responses without a trustworthy length; Safari media pipeline confusion when combined with forced `200`.

**Cause**
```js
h.delete("content-length");
```
Streaming proxies sometimes strip length when the body is transformed. Here the body is **not** transformed; deleting length while preserving (or mishandling) Range status breaks clients that need size for buffer allocation and partial reads.

**Minimal fix**
Do not delete `content-length` (same diff as Rank 3). If you ever stream-transform, set length only when known; otherwise leave upstream headers intact.

---

### Rank 6 — Empty `Range` header forwarded when client sends none

**Symptom**
- Upstream sometimes rejects or ignores requests; inconsistent 200 vs 206; harder to reproduce on desktop vs mobile.

**Cause**
```js
headers: { Range: req.headers.get("Range") || "" }
```
Always injects a `Range` header. An empty `Range` is not the same as omitting the header; some CDNs behave poorly.

**Minimal fix**
Only set `Range` when present (included in Rank 1 / Rank 3 diffs).

---

### Rank 7 — HLS playlists may list absolute CDN segment URLs (proxy hole)

**Symptom**
- Master fetched via proxy (after Rank 2 fix) still loads `segment_*.ts` from `cdn.rd-host.example` with bad MIME / Range.
- Partial improvement: playlist OK, segments still fail on iOS.

**Cause**
Native HLS and hls.js resolve segment URIs as written in the playlist. Absolute RD/CDN URLs bypass the Worker, so MIME/206 fixes never apply to segments.

**Minimal fix (≤15 lines) — rewrite segment URIs in proxied playlists**

```diff
+    let body = upstream.body;
+    if (path.endsWith(".m3u8")) {
+      const text = await upstream.text();
+      const base = new URL(url);
+      const rewritten = text.replace(/^(?!#)(.+)$/gm, (line) => {
+        const abs = new URL(line.trim(), base).href;
+        return new URL(req.url).origin + "/?u=" + encodeURIComponent(abs);
+      });
+      body = rewritten;
+      h.set("Content-Type", "application/vnd.apple.mpegurl");
+      h.delete("content-length"); // body size changed
+      return new Response(body, { status: 200, headers: h });
+    }
```

(Only rewrite non-comment lines; keep this behind the playlist branch so TS/MP4 stay passthrough with correct status.)

---

## Distinct bugs checklist

| # | Bug | iOS impact order |
|---|-----|------------------|
| 1 | CDN/proxy serves `application/octet-stream` for `.m3u8` / `.ts`; Safari native HLS rejects → `MEDIA_ERR_SRC_NOT_SUPPORTED` | **1st** |
| 2 | `else` fallback uses unproxied `masterUrl`; iOS never benefits from Worker fixes | **2nd** |
| 3 | Worker forces `status: 200` instead of upstream `206` for ranged media | **3rd** (critical once proxied) |
| 4 | App always assumes HLS; Real-Debrid may return progressive MP4 | **4th** (title-dependent) |
| 5 | Worker deletes `Content-Length` on untransformed body | **5th** |
| 6 | Worker sends `Range: ""` when client has no Range | **6th** |
| 7 | Absolute segment URLs in playlists bypass proxy after playlist is fixed | **7th** (follow-on) |

---

## Recommended minimal change set (do this, nothing more)

1. **Frontend**: always `proxied(...)` on iOS native path; branch HLS vs MP4; use `canPlayType('application/vnd.apple.mpegurl')` for Safari.
2. **Worker**:  
   - forward `Range` only if present;  
   - `status: upstream.status` (preserve 206);  
   - stop deleting `Content-Length` for passthrough;  
   - set `Content-Type` by extension (m3u8 / ts / mp4);  
   - rewrite `.m3u8` segment lines through the proxy if segments stay on the bad CDN.

That is enough to restore iOS without rebuilding the pipeline.

---

## Why Chrome desktop still works

| Factor | Chrome + hls.js | iOS Safari native |
|--------|-----------------|-------------------|
| Loader | hls.js XHR/fetch | Media pipeline / “Plug-in handled load” |
| Source URL | `proxied(masterUrl)` | raw `masterUrl` (bug) |
| MIME strictness | Low for playlists | High → octet-stream fails |
| Range | Full segment GETs common | Expects proper 206 when Range used |
| Codec path | MSE | Native HLS only |

The failure is therefore **not** “iOS can’t play HLS” generically; it is **native HLS + wrong headers + wrong code path + optional MP4 misclassification**.

---

## Uncertainty notes

- Whether every Real-Debrid HLS master uses relative vs absolute segment URIs is not fully specified; Rank 7 is conditional but common with CDNs.
- Some iOS versions are slightly more tolerant of MIME types; the provided log (`application/octet-stream` + `MEDIA_ERR_SRC_NOT_SUPPORTED`) makes Rank 1 the best primary explanation for *this* capture.
- “Plug-in handled load” alone is not a root cause; it is a Safari logging artifact around media plugins when a segment load is attempted.
