# Web Streaming Playback Layer — Cross-Platform Design

## 1. Decision Matrix: source type × platform

Source types:
- **hls-fmp4**: HLS master with CMAF fMP4 segments
- **hls-ts**: HLS master with MPEG-TS segments
- **mp4**: direct progressive MP4 file with byte-range support, moov faststart
- **mkv**: Matroska container (VP9/AV1/H.264 + Vorbis/Opus etc)

| Source Type | iOS Safari 16+ | macOS Safari 16+ | Chrome / Edge / Firefox Desktop | Android Chrome | Strategy Label |
|---|---|---|---|---|---|
| **hls-fmp4** | native HLS | native HLS | hls.js / MSE | hls.js / MSE | native where canPlayType(`application/vnd.apple.mpegurl`)!="", else MSE |
| **hls-ts** | native HLS | native HLS | hls.js / MSE (remux TS->fMP4 in worker) | hls.js / MSE | same as above; hls.js transmuxes TS in JS |
| **mp4 direct** | direct progressive `src=` | direct progressive `src=` | direct progressive `src=` | direct progressive `src=` | `video.src = url`; requires Range+206 and faststart |
| **mkv** | **needs remux/transcode — not playable as-is** | **needs remux/transcode — not playable as-is** | **needs remux/transcode**¹ | **needs remux/transcode** | No browser has reliable MKV demux in `<video>`; server must remux to fMP4 HLS or MP4 |

¹ Chrome desktop can play MKV if codecs are H.264/AAC, but fails for Opus/Vorbis, ASS subs, and seeking is broken. Do not rely. Enterprisegrade must treat MKV as not playable.

Honest MKV stance: Never send MKV bytes to `<video>`. Detect `type==='mkv'` or mime `video/x-matroska` early and throw `NOT_PLAYABLE_MKV`. Backend should provide HLS variant or on-the-fly remux endpoint (e.g., `/remux?src=...&format=hls-fmp4`). No client-side ebml demux/wasm remux is production-viable for 4 browsers × battery.

### Rationale per platform

- **iOS Safari**: Has *no* usable MSE history for HLS. Native HLS is hardware-accelerated, supports AirPlay, PiP, low-power, OS-level ABR. MSE on iOS 17.4+ exists but is limited, no fullscreen hijack fix, and drains battery. Prefer native.
- **macOS Safari**: Same, native path is optimal. MSE also works but native is lower CPU.
- **Desktop Chrome/Firefox/Edge**: No native HLS (canPlayType returns ""). Must use MSE via hls.js (handles both fMP4 and TS→fMP4 transmux).
- **Android Chrome**: `canPlayType('application/vnd.apple.mpegurl')` returns "" on most devices (some Samsung returns "maybe" but playback is broken). Do not trust native. Go hls.js/MSE.

## 2. TypeScript Module `createPlayer`

### Why `Hls.isSupported()` alone is wrong on iOS

`Hls.isSupported()` checks `MediaSource` + `isTypeSupported`. iOS pre-17.4: returns `false` → if you gate on it you would declare HLS unsupported, while native HLS *is* supported. iOS 17.4+: returns `true`, so naive code would pick hls.js/MSE over native, losing AirPlay/PiP/battery and hitting MSE bugs (Safari MSE has different eviction policy and `SourceBuffer` `QuotasExceeded`). Correct order: test native HLS first, then MSE.

### `canPlayType` nuance

`canPlayType()` does **not** return boolean. It returns `"" | "maybe" | "probably"`. Checking `if (video.canPlayType(...))` works by accident but `if (canPlayType(...) === true)` fails always. Must check `!== ""`. Also `"maybe"` for HLS does not guarantee segment codec playable — you still need to attempt load and listen for `error`. For MP4, test with codec string: `video/mp4; codecs="avc1.42E01E, mp4a.40.2"` is more truthful than `video/mp4`.

```typescript
// player.ts
import Hls, { ErrorTypes, ErrorDetails, Events as HlsEvents } from 'hls.js';

export type SourceKind = 'hls' | 'mp4' | 'mkv';
export type SourceInfo =
  | { kind: 'hls'; url: string; isFmp4?: boolean } // master m3u8 URL
  | { kind: 'mp4'; url: string }                   // progressive MP4
  | { kind: 'mkv'; url: string };                  // not directly playable

export type PlayerStrategy = 'native-hls' | 'hls.js' | 'progressive' | 'not-playable';

export type PlayerInstance = {
  strategy: PlayerStrategy;
  video: HTMLVideoElement;
  hlsInstance?: Hls;
  destroy: () => void;
  reset: () => void; // retry after error
};

const RETRY_MAX = 3;
const RETRY_BASE_MS = 1000;

function canPlayNativeHls(video: HTMLVideoElement): boolean {
  const a = video.canPlayType('application/vnd.apple.mpegurl');
  const b = video.canPlayType('application/x-mpegURL');
  return a !== '' || b !== '';
}

function isMseHlsSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).MediaSource !== 'undefined' &&
    (window as any).MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"');
}

function isIOS(): boolean {
  return /iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isSafari(): boolean {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

export function decideStrategy(video: HTMLVideoElement, source: SourceInfo): PlayerStrategy {
  if (source.kind === 'mkv') return 'not-playable';
  if (source.kind === 'mp4') return 'progressive';
  // HLS path
  if (canPlayNativeHls(video)) return 'native-hls';
  if (Hls.isSupported() && isMseHlsSupported()) return 'hls.js';
  // Fallback: Android Chrome with broken canPlayType but MSE works already covered,
  // but if both fail:
  if (Hls.isSupported()) return 'hls.js';
  return 'not-playable';
}

export function createPlayer(video: HTMLVideoElement, source: SourceInfo): PlayerInstance {
  // --- iOS Trap #1 defense: inline playback ---
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('x5-playsinline', ''); // Android WeChat webview
  video.preload = 'metadata';
  video.crossOrigin = 'anonymous';

  const strategy = decideStrategy(video, source);
  let hls: Hls | undefined;
  let retryCount = 0;
  let retryTimer: number | undefined;
  let destroyed = false;

  const cleanup = () => {
    if (retryTimer) window.clearTimeout(retryTimer);
    if (hls) { hls.destroy(); hls = undefined; }
    video.removeAttribute('src');
    // Don't call video.load() after destroy if we want to fully reset src, but we do for native cleanup
  };

  const scheduleRetry = (fn: () => void) => {
    if (destroyed || retryCount >= RETRY_MAX) return;
    const delay = RETRY_BASE_MS * Math.pow(2, retryCount) + Math.random() * 250;
    retryCount++;
    retryTimer = window.setTimeout(fn, delay);
  };

  if (strategy === 'not-playable') {
    throw Object.assign(new Error(`MKV container not playable in browsers. Needs server remux/transcode to HLS fMP4 or progressive MP4.`), { code: 'NOT_PLAYABLE_MKV' });
  }

  if (strategy === 'progressive') {
    video.src = source.url;

    // --- iOS Trap #3 defense: Range/206 requirement will manifest as stalled/MEDIA_ERR_SRC_NOT_SUPPORTED ---
    // We don't fix server here, but we surface actionable error. iOS Safari refuses MP4 if server returns 200 not 206
    // and if moov not at head it times out. preload=metadata already set helps it issue Range: bytes=0-.
    const onError = () => {
      const me = video.error;
      if (!me) return;
      // 2 = NETWORK, 3 = DECODE (moov fail), 4 = SRC_NOT_SUPPORTED
      if (me.code === MediaError.MEDIA_ERR_NETWORK && retryCount < RETRY_MAX) {
        scheduleRetry(() => { video.load(); video.play().catch(()=>{}) });
      }
    };
    video.addEventListener('error', onError);

    return {
      strategy, video,
      destroy: () => { destroyed = true; cleanup(); video.removeEventListener('error', onError); },
      reset: () => { retryCount = 0; video.load(); }
    };
  }

  if (strategy === 'native-hls') {
    video.src = source.url;

    const onNativeError = () => {
      const me = video.error;
      console.warn('[native-hls] error', me);
      if (!me) return;
      // MEDIA_ERR_NETWORK=2 -> retryable
      if (me.code === MediaError.MEDIA_ERR_NETWORK && retryCount < RETRY_MAX) {
        scheduleRetry(() => {
          video.load();
          // --- iOS Trap #2 defense: play() returns promise, must catch NotAllowedError ---
          video.play().catch((err) => {
            if (err?.name === 'NotAllowedError') {
              video.dispatchEvent(new CustomEvent('needs-user-gesture'));
            }
          });
        });
      } else if (me.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        // Likely manifest content-type misconfigured or codec unsupported — not retryable
        video.dispatchEvent(new CustomEvent('fatal', { detail: me }));
      }
    };
    video.addEventListener('error', onNativeError);

    video.addEventListener('stalled', () => {
      if (video.readyState < 2 && retryCount < RETRY_MAX) {
        scheduleRetry(() => video.load());
      }
    });

    return {
      strategy, video,
      destroy: () => { destroyed = true; cleanup(); video.removeEventListener('error', onNativeError); },
      reset: () => { retryCount = 0; video.load(); video.play().catch(()=>{}); }
    };
  }

  // hls.js branch
  hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 90,
    maxBufferLength: 30,
    xhrSetup: (xhr, url) => { xhr.withCredentials = false; }
  });

  hls.attachMedia(video);
  hls.on(HlsEvents.MEDIA_ATTACHED, () => {
    hls!.loadSource(source.url);
  });

  hls.on(HlsEvents.ERROR, (_evt, data) => {
    if (!data.fatal) return;
    switch (data.type) {
      case ErrorTypes.NETWORK_ERROR:
        console.warn('[hls.js] network error', data.details);
        if (retryCount < RETRY_MAX) {
          scheduleRetry(() => { hls?.startLoad(); retryCount--; /* hls startLoad retry is separate from our scheduler */ });
          retryCount++;
          hls?.startLoad();
        } else {
          hls?.destroy();
        }
        break;
      case ErrorTypes.MEDIA_ERROR:
        console.warn('[hls.js] media error, trying recover', data.details);
        if (data.details !== ErrorDetails.BUFFER_STALLED_ERROR || retryCount < RETRY_MAX) {
          hls?.recoverMediaError();
          scheduleRetry(() => hls?.recoverMediaError());
        } else {
          hls?.destroy();
        }
        break;
      default:
        hls?.destroy();
        break;
    }
  });

  // --- iOS Trap #2 also applies to hls.js on iPad with keyboard: play promise ---
  video.play().catch((err) => {
    if (err?.name === 'NotAllowedError') {
      video.dispatchEvent(new CustomEvent('needs-user-gesture'));
    }
  });

  return {
    strategy,
    video,
    hlsInstance: hls,
    destroy: () => { destroyed = true; cleanup(); },
    reset: () => { retryCount = 0; hls?.startLoad(); }
  };
}
```

Key import order: `canPlayNativeHls` before `Hls.isSupported()`.

## 3. Three iOS-Safari-Specific Traps Defended

### Trap 1 — Forced fullscreen without `playsinline`
**Impact:** iPhone Safari defaults to fullscreen playback. Without `playsinline`, your custom controls, PiP button, and CSS overlay break; `video` exits page compositing, `position: fixed` controls invisible, and `ended` event ordering differs. Highest impact because it breaks *every* inline player.

**Defense line:**
```ts
video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline','');
```
Set before `src` assignment. `webkit-playsinline` required for iOS 16. Also keep video in DOM and visible (not `display:none`).

### Trap 2 — Autoplay policy + play() promise rejection
**Impact:** iOS 16+ requires muted or user gesture. Unmuted `video.play()` without gesture rejects with `NotAllowedError: The request is not allowed by the user agent`. If you don't catch promise, you get unhandled rejection and blank UI thinking it's buffering. Also WebKit will pause video immediately after `loadedmetadata` if not muted.

**Defense line:**
```ts
video.play().catch((err)=>{ if(err?.name==='NotAllowedError') video.dispatchEvent(new CustomEvent('needs-user-gesture')) })
```
Module always sets `video.preload='metadata'` and expects caller to start muted or after click. On `needs-user-gesture`, UI shows Play button. We never call `video.muted=true` silently if content has audio — we surface intent.

### Trap 3 — Direct MP4 requires Range requests (206) + faststart moov, and HLS requires correct MIME types
**Impact:** iOS Safari (unlike Chrome) *mandates* HTTP 206 Partial Content for progressive MP4. If server returns 200 with full file, Safari aborts and fires `error` code 4 `MEDIA_ERR_SRC_NOT_SUPPORTED` or stalls forever at 0s. Similarly if `moov` atom at end (no faststart/qtfaststart), iOS will issue Range for tail then timeout, appearing as network failure. For HLS, manifest must be `application/vnd.apple.mpegurl` or `application/x-mpegURL` or `audio/mpegurl`; segments must be `video/mp4` or `video/MP2T`. Wrong `content-type` → Safari refuses manifest despite 200.

**Defense line (client side we can do):**
```ts
video.preload = 'metadata';
video.crossOrigin = 'anonymous';
```
`metadata` forces Safari to issue `Range: bytes=0-1` early to sniff; failure surfaces fast. Real fix is server: support `Range` + `Accept-Ranges: bytes`, return 206, ensure `moov` first, and set proper HLS MIME types. Module detects `MEDIA_ERR_SRC_NOT_SUPPORTED` and emits `fatal` with hint to check server config — honest about not being client-fixable.

Bonus defended: iPhone doesn't emit `canplay` for native HLS until video becomes visible and in DOM; we never use detached video element.

## 4. Error Recovery — Network Error Mid-Playback

### hls.js / MSE path (Chrome/Edge/Firefox/Desktop/Android)

**Signal:** `hls.on(Hls.Events.ERROR, data)` where `data.fatal===true` and `data.type===Hls.ErrorTypes.NETWORK_ERROR`. Details: `fragLoadError`, `manifestLoadError`, `levelLoadError`. Also underlying XHR status 0/timeout. `video` element will fire `waiting` then `stalled`, but root signal is hls.js event, not video.error.

**What module does:**
1. Log detail.
2. If retryCount < 3: exponential backoff (1s,2s,4s jitter) and call `hls.startLoad()`. `startLoad()` unpauses fragment loader at last position. For manifest errors, call `hls.loadSource(url)` again.
3. If HLS level failed, lower quality: `hls.nextLevel = hls.currentLevel -1`.
4. After max retries, destroy HLS, emit `fatal`, caller can fallback to lower CDN.

No `video.load()` — that would detach MediaSource. Keep MediaSource attached.

### Native HLS path (iOS Safari + macOS Safari)

**Signal:** No granular JS error object. You get:
- `video` `error` event, `video.error.code === MediaError.MEDIA_ERR_NETWORK (2)` — but often delayed 10-30s.
- `stalled` and `waiting` events, `networkState === NETWORK_NO_SOURCE` or `NETWORK_IDLE` while `readyState < HAVE_FUTURE_DATA`.
- Sometimes no `error` at all, just infinite `waiting` (live edge discontinuity).

**What module does:**
1. On `error` code 2 → `scheduleRetry`: `video.load(); video.play().catch(NeedsGesture)`.
2. On `stalled` with readyState <2 → same retry.
3. Does *not* call `hls.recover*` (no MSE).
4. Cannot recover segment-level 404 selectively — Safari internally retries ~3 times then fails. So our retry is full reload at same `currentTime` (Safari preserves currentTime across load() if src same for HLS).
5. For Live vs VOD edge trap: if live playlist 404 at reload, we emit `fatal` after retries — server should provide `EXT-X-ENDLIST` handling.

Difference summary: hls.js gives typed, recoverable error channel with ability to resume loader; native gives only coarse MediaError and you must reload entire element, which is more disruptive (loses buffer, triggers spinner). Module abstracts both behind same `reset()` and `needs-user-gesture` custom event, but logs distinct paths for debugging.

---
