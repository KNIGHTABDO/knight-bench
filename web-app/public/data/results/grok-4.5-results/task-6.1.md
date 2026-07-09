# Playback Layer Design: Cross-Platform Web Streaming

## 1. Decision Matrix: Source Type × Platform → Playback Strategy

| Source type | iOS Safari 16+ | macOS Safari | Chrome / Edge / Firefox (desktop) | Android Chrome |
|---|---|---|---|---|
| **HLS master (fMP4 segments)** | **Native HLS** (`video.src = master.m3u8`). MSE/hls.js is not available (or not reliable) for general media; Safari’s built-in AVFoundation stack plays HLS natively. | **Native HLS** preferred. `Hls.isSupported()` may be true on some Safari versions that expose limited MSE, but native is still the correct default for HLS masters. | **hls.js / MSE** (fMP4 is first-class in modern hls.js). Direct `video.src` on `.m3u8` is not supported. | **hls.js / MSE**. Android Chrome does not treat HLS as a first-class native progressive source the way Safari does. |
| **HLS master (TS / MPEG-TS segments)** | **Native HLS**. Safari remuxes TS → playable media internally. | **Native HLS**. | **hls.js / MSE**. hls.js transmuxes TS → fMP4 for MSE. | **hls.js / MSE** (same transmux path). |
| **Direct MP4 (byte-range / Accept-Ranges)** | **Direct progressive** (`video.src = mp4Url`). Seeking relies on HTTP **206 Partial Content** + correct `Content-Range` / `Content-Length`. | **Direct progressive**. | **Direct progressive**. | **Direct progressive**. |
| **MKV (Matroska)** | **Needs remux/transcode — not playable as-is.** No reliable native `canPlayType` for Matroska/WebM-incompatible MKV; no standard MSE demuxer for arbitrary MKV in Safari. | **Needs remux/transcode — not playable as-is.** Same constraint. | **Needs remux/transcode — not playable as-is** for general MKV. Chrome may play **some** WebM-adjacent containers, but **Matroska/MKV with H.264/HEVC/AC3/etc. is not a portable browser path**. Do not ship “try `video.src` and hope.” Server-side remux to fMP4/HLS (or transmux to fragmented MP4 for MSE with a custom pipeline) is required. | **Needs remux/transcode — not playable as-is.** Same as desktop Chromium for general MKV. |

### Honest MKV stance

Browsers do **not** provide a standard, portable MKV playback path:

- **Native `<video src>`**: Matroska is not an interoperable HTML media type. A minority of Chromium builds may open certain WebM-like files; that is **not** a product strategy for arbitrary MKV (codecs, subtitles, multi-audio, DivX/AC3, etc.).
- **MSE + hls.js**: hls.js expects HLS (or low-latency HLS) playlists and segments (TS or fMP4), not MKV files.
- **mse-in-workers / mp4box / custom demuxers**: Research-grade or app-specific; not the default “streaming app” path without a dedicated media pipeline and codec licensing/testing budget.

**Product rule:** If `source.container === 'mkv'` (or sniff says Matroska), the module refuses client playback and surfaces `NEEDS_REMUX` so the app can request server remux (e.g. MKV → fMP4 progressive or MKV → HLS fMP4).

### Why not “always hls.js”?

`Hls.isSupported()` answers: “Can this browser attach MediaSource Extensions in the way hls.js expects?” It does **not** answer “Should we use hls.js for this source on this OS?”

On **iOS Safari**, MSE for arbitrary HLS is historically unavailable / incomplete for this use case. iOS plays HLS through the **native** media pipeline. Using only `Hls.isSupported()` would:

1. Skip native HLS on devices that must use it.
2. Fail open or fail closed incorrectly when MSE appears partially present.
3. Miss the correct branch: `video.canPlayType('application/vnd.apple.mpegurl')` (and related HLS types) which is the Safari signal for native HLS.

**Correct feature detection order (conceptual):**

1. Container/source kind (MKV → refuse; MP4 progressive → direct; HLS → continue).
2. For HLS: if `canPlayType` reports native HLS support **and** we are on a Safari/WebKit-class engine (or more conservatively: if native HLS type is playable), use **native**.
3. Else if `Hls.isSupported()` → **hls.js**.
4. Else if `video.canPlayType('application/vnd.apple.mpegurl')` alone → native fallback.
5. Else → unsupported.

**`canPlayType` nuance:**

- Returns `''` | `'maybe'` | `'probably'`. Treat **both** `'maybe'` and `'probably'` as “native path available” for HLS MIME types; `''` means no.
- Check both `application/vnd.apple.mpegurl` and `application/x-mpegURL` (historical alias).
- `canPlayType` is about **container/codec signaling the browser claims**, not network reachability or CORS. It will not tell you if the CDN returns wrong `Content-Type` for the playlist (a separate iOS trap).
- For progressive MP4, prefer something like `video/mp4; codecs="avc1.42E01E,mp4a.40.2"` when you know codecs; bare `video/mp4` is weaker (`maybe`) but usually enough to choose progressive vs refuse.

---

## 2. Single TypeScript Module: `createPlayer`

```typescript
/**
 * createPlayer — cross-platform playback entrypoint.
 *
 * Platforms: iOS Safari 16+, macOS Safari, desktop Chrome/Edge/Firefox, Android Chrome.
 * Sources: HLS (fMP4 or TS), progressive MP4 (byte-range), MKV (explicit non-playable).
 *
 * Feature detection note:
 *   Hls.isSupported() alone is wrong on iOS: it only probes MSE, while iOS must use
 *   native HLS via canPlayType('application/vnd.apple.mpegurl'). Always prefer native
 *   HLS when the engine reports Apple HLS MIME support; use hls.js only when MSE is
 *   the viable path and native HLS is not.
 */

export type SourceKind = 'hls' | 'mp4' | 'mkv';

export interface SourceInfo {
  /** Absolute or same-origin URL to master playlist, MP4, or MKV. */
  url: string;
  kind: SourceKind;
  /** Optional MIME / codec hint for canPlayType refinement. */
  mimeType?: string;
  /** True if origin guarantees Accept-Ranges / 206 for progressive MP4. */
  supportsByteRange?: boolean;
  /** Optional: 'live' | 'vod' for policy (e.g. live retry vs fatal). */
  streamType?: 'live' | 'vod';
  /** Optional poster / start position. */
  startPosition?: number;
}

export type PlaybackStrategy =
  | 'native-hls'
  | 'hls-js'
  | 'direct-progressive'
  | 'needs-remux';

export type PlayerErrorCode =
  | 'NEEDS_REMUX'
  | 'UNSUPPORTED'
  | 'MEDIA_ERROR'
  | 'NETWORK_ERROR'
  | 'DECODE_ERROR'
  | 'MANIFEST_ERROR'
  | 'UNKNOWN';

export interface PlayerError {
  code: PlayerErrorCode;
  message: string;
  fatal: boolean;
  strategy: PlaybackStrategy | null;
  raw?: unknown;
}

export interface PlayerHandle {
  strategy: PlaybackStrategy;
  destroy(): void;
  recoverMediaError(): void;
  getHls(): import('hls.js').default | null;
}

export interface CreatePlayerOptions {
  /** Called on fatal/non-fatal structured errors. */
  onError?: (err: PlayerError) => void;
  /** Autoplay attempt after source attach (subject to autoplay policy). */
  autoplay?: boolean;
  /** Muted autoplay unlock (required path on iOS when autoplay is desired). */
  mutedAutoplay?: boolean;
  /**
   * Injected hls.js constructor for testability. Defaults to dynamic import consumer
   * wiring; pass Hls from 'hls.js' in app bootstrap.
   */
  Hls?: typeof import('hls.js').default;
  /** Max automatic network recoveries for hls.js before fatal. */
  maxNetworkRetries?: number;
}

const HLS_MIME_CANDIDATES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegURL',
] as const;

function canPlayNativeHls(video: HTMLVideoElement): boolean {
  // Treat 'maybe' and 'probably' as support. Empty string = no native HLS.
  return HLS_MIME_CANDIDATES.some((t) => {
    const r = video.canPlayType(t);
    return r === 'maybe' || r === 'probably';
  });
}

function canPlayProgressiveMp4(video: HTMLVideoElement, mime?: string): boolean {
  const candidates = [
    mime,
    'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4',
  ].filter(Boolean) as string[];
  return candidates.some((t) => {
    const r = video.canPlayType(t);
    return r === 'maybe' || r === 'probably';
  });
}

function pickStrategy(
  video: HTMLVideoElement,
  source: SourceInfo,
  HlsCtor: typeof import('hls.js').default | undefined
): PlaybackStrategy {
  if (source.kind === 'mkv') {
    return 'needs-remux';
  }

  if (source.kind === 'mp4') {
    if (!canPlayProgressiveMp4(video, source.mimeType)) {
      return 'needs-remux'; // e.g. unsupported codec profile
    }
    return 'direct-progressive';
  }

  // source.kind === 'hls'
  // CRITICAL: prefer native HLS when canPlayType says so (iOS/macOS Safari).
  // Do NOT gate solely on Hls.isSupported() — that is MSE-only and wrong on iOS.
  const native = canPlayNativeHls(video);
  const mse =
    typeof HlsCtor !== 'undefined' &&
    typeof HlsCtor.isSupported === 'function' &&
    HlsCtor.isSupported();

  if (native) {
    // On Safari (iOS/macOS), native is correct for HLS masters (fMP4 or TS).
    // Even if mse is true on some desktop Safari builds, native remains preferred
    // for power, FairPlay pathways, and fewer MSE edge cases.
    return 'native-hls';
  }
  if (mse) {
    return 'hls-js';
  }
  // Last resort: if neither MSE nor native MIME — unsupported HLS environment.
  return 'needs-remux'; // treated as unplayable without server assist
}

function ensureInlinePlaybackAttributes(video: HTMLVideoElement): void {
  // iOS trap: without playsinline, video may force fullscreen / fail muted inline UX.
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  // Prefer attribute reflection for older WebKit:
  (video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
}

function wireNativeNetworkRecovery(
  video: HTMLVideoElement,
  source: SourceInfo,
  strategy: PlaybackStrategy,
  onError?: (err: PlayerError) => void
): () => void {
  let lastRecoverAt = 0;
  const RECOVER_COOLDOWN_MS = 3000;

  const onVideoError = () => {
    const mediaError = video.error;
    // HTMLMediaElement.error codes:
    // 1 MEDIA_ERR_ABORTED, 2 MEDIA_ERR_NETWORK, 3 MEDIA_ERR_DECODE, 4 MEDIA_ERR_SRC_NOT_SUPPORTED
    const code = mediaError?.code;
    const isNetwork = code === MediaError.MEDIA_ERR_NETWORK || code === 2;
    const isDecode = code === MediaError.MEDIA_ERR_DECODE || code === 3;
    const isSrc = code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === 4;

    if (isNetwork) {
      const now = Date.now();
      if (now - lastRecoverAt > RECOVER_COOLDOWN_MS) {
        lastRecoverAt = now;
        // Native signal: 'error' event + mediaError.code === NETWORK.
        // Recovery: re-set src (or load()) to re-request playlist/segments.
        // Preserve currentTime best-effort for VOD.
        const t = video.currentTime;
        const wasPaused = video.paused;
        video.removeAttribute('src');
        video.load();
        video.src = source.url;
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          if (source.streamType !== 'live' && t > 0 && Number.isFinite(t)) {
            try {
              video.currentTime = t;
            } catch {
              /* live or unseekable */
            }
          }
          if (!wasPaused) {
            void video.play().catch(() => {
              /* autoplay policy may block; surface separately if needed */
            });
          }
        };
        video.addEventListener('loadedmetadata', onLoaded);
        onError?.({
          code: 'NETWORK_ERROR',
          message: 'Native network error; reloading source',
          fatal: false,
          strategy,
          raw: mediaError,
        });
        return;
      }
      onError?.({
        code: 'NETWORK_ERROR',
        message: 'Native network error; recovery cooldown exhausted',
        fatal: true,
        strategy,
        raw: mediaError,
      });
      return;
    }

    if (isDecode) {
      onError?.({
        code: 'DECODE_ERROR',
        message: 'Native decode error',
        fatal: true,
        strategy,
        raw: mediaError,
      });
      return;
    }

    if (isSrc) {
      onError?.({
        code: 'UNSUPPORTED',
        message: 'Native source not supported (codec/container/manifest)',
        fatal: true,
        strategy,
        raw: mediaError,
      });
      return;
    }

    onError?.({
      code: 'MEDIA_ERROR',
      message: 'Native media error',
      fatal: true,
      strategy,
      raw: mediaError,
    });
  };

  video.addEventListener('error', onVideoError);
  return () => video.removeEventListener('error', onVideoError);
}

export function createPlayer(
  video: HTMLVideoElement,
  source: SourceInfo,
  options: CreatePlayerOptions = {}
): PlayerHandle {
  const {
    onError,
    autoplay = false,
    mutedAutoplay = true,
    Hls: HlsCtor,
    maxNetworkRetries = 3,
  } = options;

  // --- iOS trap defense #1: inline playback attributes (before setting src) ---
  ensureInlinePlaybackAttributes(video);

  const strategy = pickStrategy(video, source, HlsCtor);

  if (strategy === 'needs-remux') {
    const err: PlayerError = {
      code: source.kind === 'mkv' ? 'NEEDS_REMUX' : 'UNSUPPORTED',
      message:
        source.kind === 'mkv'
          ? 'MKV is not playable in-browser; remux/transcode to fMP4 or HLS required'
          : 'No viable playback path for this source on this platform',
      fatal: true,
      strategy,
    };
    onError?.(err);
    return {
      strategy,
      destroy() {
        /* no-op */
      },
      recoverMediaError() {
        /* no-op */
      },
      getHls: () => null,
    };
  }

  let hls: import('hls.js').default | null = null;
  let unwireNative: (() => void) | null = null;
  let networkRetryCount = 0;
  let destroyed = false;

  const tryAutoplay = () => {
    if (!autoplay || destroyed) return;
    // --- iOS trap defense #2: autoplay policy — mute before play() ---
    if (mutedAutoplay) {
      video.muted = true;
      video.setAttribute('muted', '');
    }
    const p = video.play();
    if (p && typeof p.then === 'function') {
      p.catch((e) => {
        onError?.({
          code: 'MEDIA_ERROR',
          message: `Autoplay blocked: ${String(e)}`,
          fatal: false,
          strategy,
          raw: e,
        });
      });
    }
  };

  if (strategy === 'direct-progressive') {
    // Progressive MP4: browser uses range requests when supportsByteRange / server allows.
    // --- iOS trap defense #3 (class: range/206): document requirement; optional preflight ---
    // If supportsByteRange === false, seeking on iOS often breaks after first buffer.
    if (source.supportsByteRange === false) {
      onError?.({
        code: 'MEDIA_ERROR',
        message:
          'Progressive MP4 without byte-range (HTTP 206) will not seek reliably on iOS Safari',
        fatal: false,
        strategy,
      });
    }
    video.src = source.url;
    if (typeof source.startPosition === 'number' && source.startPosition > 0) {
      const seek = () => {
        video.currentTime = source.startPosition!;
        video.removeEventListener('loadedmetadata', seek);
      };
      video.addEventListener('loadedmetadata', seek);
    }
    unwireNative = wireNativeNetworkRecovery(video, source, strategy, onError);
    video.addEventListener('loadeddata', tryAutoplay, { once: true });
  } else if (strategy === 'native-hls') {
    // Native HLS: assign master URL directly. Safari fetches multivariant playlist.
    // Content-Type of playlist should be application/vnd.apple.mpegurl (or compatible);
    // wrong types can fail on iOS even when Chrome would ignore them — app/CDN concern.
    video.src = source.url;
    if (typeof source.startPosition === 'number' && source.startPosition > 0) {
      const seek = () => {
        // Live: startPosition may be ignored / clamped; VOD: works after metadata.
        try {
          video.currentTime = source.startPosition!;
        } catch {
          /* ignore */
        }
        video.removeEventListener('loadedmetadata', seek);
      };
      video.addEventListener('loadedmetadata', seek);
    }
    unwireNative = wireNativeNetworkRecovery(video, source, strategy, onError);
    video.addEventListener('loadeddata', tryAutoplay, { once: true });
  } else if (strategy === 'hls-js') {
    if (!HlsCtor) {
      onError?.({
        code: 'UNSUPPORTED',
        message: 'hls.js constructor not provided but MSE path selected',
        fatal: true,
        strategy,
      });
      return {
        strategy,
        destroy() {},
        recoverMediaError() {},
        getHls: () => null,
      };
    }

    hls = new HlsCtor({
      enableWorker: true,
      // Start position for VOD; for live, hls.js uses liveSyncDuration defaults.
      startPosition: source.startPosition ?? -1,
      // Network robustness
      fragLoadingMaxRetry: 6,
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
    });

    hls.attachMedia(video);
    hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => {
      hls!.loadSource(source.url);
    });
    hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
      tryAutoplay();
    });

    hls.on(HlsCtor.Events.ERROR, (_event, data) => {
      if (destroyed || !hls) return;

      // hls.js signal: Events.ERROR with { type, details, fatal, ... }
      if (data.fatal) {
        switch (data.type) {
          case HlsCtor.ErrorTypes.NETWORK_ERROR: {
            networkRetryCount += 1;
            if (networkRetryCount <= maxNetworkRetries) {
              onError?.({
                code: 'NETWORK_ERROR',
                message: `hls.js fatal network error; startLoad() retry ${networkRetryCount}/${maxNetworkRetries}`,
                fatal: false,
                strategy,
                raw: data,
              });
              // Mid-playback network loss: re-start loader without full destroy.
              hls.startLoad();
            } else {
              onError?.({
                code: 'NETWORK_ERROR',
                message: 'hls.js fatal network error; retries exhausted',
                fatal: true,
                strategy,
                raw: data,
              });
            }
            break;
          }
          case HlsCtor.ErrorTypes.MEDIA_ERROR: {
            onError?.({
              code: 'MEDIA_ERROR',
              message: 'hls.js fatal media error; attempting recoverMediaError()',
              fatal: false,
              strategy,
              raw: data,
            });
            hls.recoverMediaError();
            break;
          }
          default: {
            onError?.({
              code: data.type === HlsCtor.ErrorTypes.MUX_ERROR ? 'DECODE_ERROR' : 'UNKNOWN',
              message: `hls.js fatal error: ${data.type} / ${data.details}`,
              fatal: true,
              strategy,
              raw: data,
            });
            hls.destroy();
            hls = null;
            break;
          }
        }
      } else {
        // Non-fatal: buffer stalls, intermittent frag fails — hls.js often self-recovers.
        if (
          data.details === HlsCtor.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === HlsCtor.ErrorDetails.LEVEL_LOAD_ERROR ||
          data.details === HlsCtor.ErrorDetails.FRAG_LOAD_ERROR
        ) {
          onError?.({
            code: 'NETWORK_ERROR',
            message: `hls.js non-fatal network: ${data.details}`,
            fatal: false,
            strategy,
            raw: data,
          });
        }
      }
    });
  }

  return {
    strategy,
    destroy() {
      destroyed = true;
      unwireNative?.();
      unwireNative = null;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        /* ignore */
      }
    },
    recoverMediaError() {
      if (hls) {
        hls.recoverMediaError();
      } else {
        // Native: best-effort reload
        const t = video.currentTime;
        video.src = source.url;
        video.addEventListener(
          'loadedmetadata',
          () => {
            if (source.streamType !== 'live') {
              try {
                video.currentTime = t;
              } catch {
                /* ignore */
              }
            }
          },
          { once: true }
        );
      }
    },
    getHls: () => hls,
  };
}

/**
 * Usage sketch (app bootstrap):
 *
 * import Hls from 'hls.js';
 * import { createPlayer } from './createPlayer';
 *
 * const video = document.querySelector('video')!;
 * const handle = createPlayer(video, { url, kind: 'hls' }, { Hls, autoplay: true, mutedAutoplay: true });
 * // later: handle.destroy();
 */
```

### Why `Hls.isSupported()` alone is the wrong test on iOS

| Check | What it measures | iOS Safari reality |
|---|---|---|
| `Hls.isSupported()` | MSE + `SourceBuffer` APIs hls.js needs | Typically **false** or not the path you want; HLS is a **system** feature |
| `video.canPlayType('application/vnd.apple.mpegurl')` | Engine claims native HLS playback | **true** (`maybe`/`probably`) on iOS/macOS Safari |
| Wrong composition: `if (Hls.isSupported()) hls else if (canPlayType) native` | MSE first | On platforms where both could be true (some desktop Safari), MSE-first can pick a worse path; on iOS, MSE-first simply fails closed if you **only** check `Hls.isSupported()` and never fall through |
| Correct composition: `if (canPlayNativeHls) native else if (Hls.isSupported()) hls` | Native first for HLS | Matches Apple’s pipeline; hls.js only where MSE is the real HLS engine |

**`canPlayType` nuance (summary):** returns a **confidence string**, not a boolean; check for non-empty; test Apple HLS MIME **and** legacy alias; does not validate CDN headers, CORS, or codec inside the variant streams.

---

## 3. Three Highest-Impact iOS Safari Traps (with defending code)

### Trap A — Autoplay policy (muted / user-gesture)

**Why highest-impact:** Marketing and “tap to open player” flows silently fail: `video.play()` rejects with `NotAllowedError`. Users see a frozen first frame and blame “broken stream.” iOS is stricter than desktop Chrome about unmuted autoplay.

**Defense in module:** before `play()`, force muted when `mutedAutoplay` is set:

```typescript
// Defense line(s):
if (mutedAutoplay) {
  video.muted = true;
  video.setAttribute('muted', '');
}
const p = video.play();
```

**Justification:** Unmuted autoplay without a user gesture is blocked on iOS Safari. Muted (or user-initiated) play is the supported path. The module reports non-fatal `Autoplay blocked` if even muted play fails, so the UI can show a big Play button (second gesture).

---

### Trap B — Inline playback attributes (`playsinline`)

**Why highest-impact:** Without `playsinline` / `webkit-playsinline`, iOS may take over with fullscreen playback, break in-page UI (controls, overlays, PiP assumptions), and interact badly with muted autoplay and custom chrome. This is a default footgun for every SPA player shell.

**Defense in module:** set attributes **before** assigning `src`:

```typescript
// Defense line(s) — ensureInlinePlaybackAttributes():
video.setAttribute('playsinline', 'true');
video.setAttribute('webkit-playsinline', 'true');
(video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
```

**Justification:** Inline is required for modern in-page streaming UX on iPhone. Setting both the property and the legacy `webkit-playsinline` attribute maximizes compatibility across iOS 16+ WebKit variants.

---

### Trap C — Progressive MP4 byte-range / HTTP 206 requirements

**Why highest-impact:** Many CDNs or origin misconfigurations serve MP4 with `200` only (no `Accept-Ranges: bytes`). Desktop browsers sometimes still play start-to-end; **iOS Safari seeking and scrubbing commonly break** without proper **206 Partial Content** responses. Users can start playback then cannot seek — reported as “random iOS bugs.”

**Defense in module:** explicit capability flag + non-fatal diagnostic (and architecture requirement that progressive MP4 only be offered when ranges work):

```typescript
// Defense line(s):
if (source.supportsByteRange === false) {
  onError?.({
    code: 'MEDIA_ERROR',
    message:
      'Progressive MP4 without byte-range (HTTP 206) will not seek reliably on iOS Safari',
    fatal: false,
    strategy,
  });
}
video.src = source.url;
```

**Justification:** This is not something `canPlayType` can detect. The app must mark sources (or HEAD-preflight `Accept-Ranges`) and either remux to HLS for iOS or fix origin range support. The module refuses to pretend MKV works and **warns** when MP4 is known non-ranged so product can fall back to HLS packaging.

**Why these three over other candidates:**

| Candidate trap | Chosen? | Reason |
|---|---|---|
| Autoplay policy | **Yes** | Immediate UX failure on every cold start |
| `playsinline` | **Yes** | Changes presentation model entirely on iPhone |
| Range/206 for MP4 | **Yes** | Silent seek breakage specific to progressive path on iOS |
| Manifest Content-Type strictness | Strong runner-up | Critical for **native HLS** CDN setup, but is primarily an ops/CDN contract; the player cannot fully “fix” wrong `text/plain` playlists in JS on native path—only document + fail with `MEDIA_ERR_SRC_NOT_SUPPORTED` |
| Live vs VOD edge | Important | Handled lightly via `streamType` and startPosition; lower universal impact than the three above for a general matrix |

---

## 4. Error Recovery: Network Error Mid-Playback

### hls.js (MSE path)

**Signal you get:**

- Event: `Hls.Events.ERROR`
- Payload fields of interest:
  - `data.fatal: boolean`
  - `data.type`: e.g. `Hls.ErrorTypes.NETWORK_ERROR` | `MEDIA_ERROR` | …
  - `data.details`: e.g. `fragLoadError`, `manifestLoadError`, `levelLoadTimeOut`, …
  - Optional `data.response` / `data.networkDetails` depending on version

**Mid-playback network loss (fatal network):**

1. Module increments `networkRetryCount`.
2. If under `maxNetworkRetries`, emits **non-fatal** `NETWORK_ERROR` and calls **`hls.startLoad()`** to resume segment/manifest fetching from the current position context.
3. If retries exhausted, emits **fatal** `NETWORK_ERROR` and leaves teardown to the app (or caller may `destroy()`).
4. For **fatal media** errors (often decode/buffer corruption after network blips), calls **`hls.recoverMediaError()`** (codec swap / SourceBuffer recovery path inside hls.js).
5. Non-fatal network details are surfaced for telemetry; hls.js internal retries often already run via `fragLoadingMaxRetry` etc.

**Native path does not emit hls.js events** — no `ERROR` from hls.js because hls.js is not used.

---

### Native (iOS/macOS Safari HLS or progressive MP4)

**Signal you get:**

- DOM event: `video` element **`error`**
- Inspect **`video.error`** (`MediaError`):
  - `MEDIA_ERR_NETWORK` (code `2`) — download failed mid-stream / playlist/segment fetch failure surfaced as network
  - `MEDIA_ERR_DECODE` (code `3`)
  - `MEDIA_ERR_SRC_NOT_SUPPORTED` (code `4`) — bad manifest type, codec, or unplayable after error
  - `MEDIA_ERR_ABORTED` (code `1`)

There is **no** structured “fragment URL failed” detail comparable to hls.js `data.details`. Native stack is opaque.

**What the module does on network (`code === 2`):**

1. Emit `NETWORK_ERROR` with `fatal: false` if outside cooldown.
2. **Reload strategy:** clear src → `load()` → reassign `video.src = source.url`.
3. On `loadedmetadata`, restore `currentTime` for **VOD** (`streamType !== 'live'`); for **live**, skip seek restore (edge behavior: live windows move; restoring an old time is wrong).
4. Resume `play()` if it was playing (still subject to autoplay policy).
5. If another network error arrives inside **cooldown** (3s), emit **fatal** `NETWORK_ERROR` to stop infinite reload loops.

**Decode / src-not-supported:** treated as **fatal** with `DECODE_ERROR` or `UNSUPPORTED` — no blind reload loop.

---

### Side-by-side

| Aspect | hls.js | Native Safari |
|---|---|---|
| Primary signal | `Hls.Events.ERROR` + `data.fatal` / `data.type` | `HTMLVideoElement` `error` + `MediaError.code` |
| Network granularity | Manifest / level / fragment level details | Opaque network failure |
| First recovery API | `hls.startLoad()` | Re-set `src` + `load()` |
| Media pipeline recovery | `hls.recoverMediaError()` | Limited; full reload or give up |
| Retry budget | Explicit (`maxNetworkRetries` + hls.js internal retries) | Cooldown-gated single-flight reload |
| Live nuance | hls.js live sync config | Do not restore old `currentTime` |

---

## Implementation Notes (ops contracts outside the module)

1. **CORS:** MSE/hls.js requires CORS on playlists and segments; native HLS on iOS is more lenient for simple progressive cases but cross-origin media still needs correct headers for some features.
2. **HLS playlist Content-Type:** Prefer `application/vnd.apple.mpegurl` or `audio/mpegurl` for masters/media playlists — iOS is pickier than desktop Chromium.
3. **MKV:** Always server remux (ffmpeg: matroska → fragmented MP4 or HLS fMP4). Do not ship client-only MKV demux in v1.
4. **fMP4 vs TS HLS:** Both covered: native Safari handles both; hls.js transmuxes TS and plays fMP4 via MSE.
5. **Destroy:** Always call `handle.destroy()` on route change to avoid leaked MSE `MediaSource` and multiple audio pipelines on iOS.

---

## Deliverable Checklist

| # | Deliverable | Status |
|---|---|---|
| 1 | Decision matrix source × platform → strategy; honest MKV | Done |
| 2 | `createPlayer(video, source)` TypeScript module + feature detection rationale | Done |
| 3 | Three iOS traps with defending code lines + justification | Done (autoplay, playsinline, byte-range/206) |
| 4 | Network error signals & recovery: hls.js vs native | Done |
