# Playback Layer Design for Heterogeneous Streaming Sources

## Scope and honesty note

This covers iOS Safari 16+, macOS Safari, Chrome/Edge/Firefox desktop, and Android Chrome, against three source shapes: HLS masters (fMP4 or TS segments), direct MP4 with byte-range/206 support, and MKV. I am confident in the platform behaviors described below for mainstream, recent versions of these browsers (2023–2025 era engines); browser vendors change codec/container support between point releases, so any specific claim about a specific minor version should be re-verified against caniuse.com and the vendor release notes before you ship, not taken as certain from this document.

---

## 1. Decision matrix

| Source type | iOS Safari 16+ | macOS Safari | Chrome/Edge/Firefox desktop | Android Chrome |
|---|---|---|---|---|
| **HLS master, TS segments (H.264/AAC)** | Native HLS via `<video src>` (AVPlayer under the hood). Do not load hls.js. | Native HLS via `<video src>`. | No native HLS. Use hls.js (MSE-based remux of TS→fMP4 in-browser). | No native HLS. Use hls.js. |
| **HLS master, fMP4 segments (CMAF, H.264/HEVC+AAC)** | Native HLS. Safari on iOS/macOS is the one platform family with real native fMP4-HLS support. | Native HLS. | hls.js (MSE). fMP4/CMAF segments can often be appended to `SourceBuffer` with less repackaging work than TS, but still goes through hls.js's engine, not the browser's native HLS parser. | hls.js (MSE). |
| **Direct MP4, byte-range/206 support (H.264/AAC baseline, "web-safe" profile)** | Native progressive playback (`<video src>`), relies on server 206 support for seeking. | Native progressive playback. | Native progressive playback. | Native progressive playback. |
| **Direct MP4, codec outside baseline (e.g., HEVC without hvc1 tagging, 10-bit, AV1 without HW decode)** | Often unplayable or falls back to no video track; treat as "needs verification via `canPlayType`" and possibly transcode. | Same caveat — HEVC support varies by hardware (Apple Silicon vs. older Intel Macs) and by exact profile/level. | AV1 is well supported on modern Chrome/Firefox/Edge (software or HW decode); HEVC is generally NOT supported in Chrome/Firefox without OS codec packs, is patchy in Edge. | HEVC support is device/OEM dependent (many Android devices have HW HEVC decode that Chrome will use, but it's not guaranteed); AV1 support depends on chipset (increasingly common on modern devices, absent on older/low-end ones). |
| **MKV (Matroska container), any inner codec** | **Not playable as-is.** No browser in this matrix has native MKV container parsing. `<video src="*.mkv">` will fail to load (`MEDIA_ERR_SRC_NOT_SUPPORTED`) even if the inner video/audio codec (e.g., H.264/AAC) would otherwise be fine, because the *container* demuxer isn't present. | Not playable as-is. Same reasoning. | Not playable as-is. Chrome/Firefox do not ship an MKV demuxer for the `<video>` element (Firefox has experimental/partial support behind flags historically, but it is not something to rely on in production). | Not playable as-is. |

**MKV — the honest answer:** No target platform here plays MKV natively through `<video>`, full stop. There is no client-side JS library that can demux arbitrary MKV and feed it into MSE/`<video>` in a way that's production-reliable across all five platforms — you'd be looking at something like ffmpeg.wasm doing real-time container remuxing (CPU-heavy, unreliable for anything beyond short clips, and still blocked by codec support inside the container: if the inner codec itself isn't one the browser's decoder understands, no amount of remuxing fixes it). The only robust options are:
- **Server-side remux to fMP4/HLS** (no re-encode needed if the inner codec is already H.264/AAC or HEVC/AAC — just repackage the container). This is cheap and should be the default path.
- **Server-side transcode** if the inner codec itself isn't browser-playable (e.g., MKV wrapping FLAC, VP9 in unusual profiles, or codecs like DTS/AC3 audio that browsers won't decode).

For this system, `SourceInfo` for an MKV source should be resolved *before* it reaches the player — the backend should either have already produced an HLS/MP4 rendition, or the player should refuse the source and surface "needs remux/transcode" rather than attempting playback. I have not tried to make the player itself smuggle MKV through; that would be dishonest engineering (it doesn't work reliably) dressed up as a client-side capability.

---

## 2. `createPlayer` TypeScript module

```typescript
// player.ts
//
// createPlayer(video, source) wires an HTMLVideoElement to a SourceInfo
// using the strategy chosen by the decision matrix above. It does NOT
// attempt to play MKV; callers must resolve MKV to HLS/MP4 server-side
// first, and this module treats an MKV SourceInfo as an immediate error.

export type SourceType = 'hls' | 'mp4' | 'mkv';

export interface SourceInfo {
  type: SourceType;
  url: string;
  /** MIME type as reported by the server, if known. Used for canPlayType checks. */
  mimeType?: string;
  /** True if this is a live HLS stream (affects seek/duration handling). */
  isLive?: boolean;
}

export type PlaybackStrategy =
  | 'native-hls'
  | 'hls-js'
  | 'progressive'
  | 'unsupported';

export interface PlayerHandle {
  strategy: PlaybackStrategy;
  destroy(): void;
}

/**
 * Feature detection.
 *
 * WHY NOT JUST `Hls.isSupported()`:
 * hls.js's isSupported() checks for MediaSource + the codecs hls.js needs
 * to *remux into*. On iOS Safari, MediaSource Extensions (MSE) is present
 * in the engine (WebKit ships it), so Hls.isSupported() can return `true`
 * on iOS — but Apple deliberately restricts full MSE functionality for
 * HLS-shaped content on iOS Safari in favor of routing HLS through the
 * native AVPlayer pipeline. In practice this means: even where hls.js
 * *reports* itself supported on iOS, native HLS is both more reliable
 * (hardware-accelerated decode, proper AirPlay/PiP/lock-screen controls,
 * FairPlay compatibility if ever needed) and is what Apple's App Store
 * review guidelines and WebKit's own guidance push you toward for HLS.
 * Using hls.js on iOS instead of native playback is a common source of
 * stalls, audio/video desync, and battery drain bug reports. So the
 * correct test is platform-first: "can this browser play HLS natively"
 * (canPlayType) BEFORE asking "does hls.js think it can do MSE here".
 *
 * THE canPlayType NUANCE:
 * `video.canPlayType('application/vnd.apple.mpegurl')` on Safari returns
 * '"probably"' — canPlayType never returns a boolean; it returns one of
 * '""', "maybe", or "probably" (a deliberately vague contract from the
 * HTML spec, because the browser can't know for certain without fetching
 * the manifest and inspecting codecs). Treat any non-empty-string result
 * as "attempt native playback", and treat "" as "not natively supported".
 * Do not test truthiness of the *type string itself* or assume a MIME
 * type match guarantees playability — canPlayType is deliberately a hint,
 * not a guarantee, and some codec-level failures only surface after the
 * manifest/segments are fetched (handled by error recovery, section 4).
 */
function canPlayNativeHls(video: HTMLVideoElement): boolean {
  const result = video.canPlayType('application/vnd.apple.mpegurl');
  return result === 'probably' || result === 'maybe';
}

function canPlayNativeMp4(video: HTMLVideoElement, mimeType: string): boolean {
  const result = video.canPlayType(mimeType || 'video/mp4');
  return result === 'probably' || result === 'maybe';
}

async function hlsJsAvailable(): Promise<typeof import('hls.js').default | null> {
  try {
    const mod = await import('hls.js');
    const Hls = mod.default;
    return Hls.isSupported() ? Hls : null;
  } catch {
    return null;
  }
}

function chooseStrategy(
  video: HTMLVideoElement,
  source: SourceInfo,
  hlsJsCtorAvailable: boolean
): PlaybackStrategy {
  if (source.type === 'mkv') {
    return 'unsupported';
  }

  if (source.type === 'hls') {
    // Platform-first check, NOT Hls.isSupported()-first. See doc comment above.
    if (canPlayNativeHls(video)) {
      return 'native-hls';
    }
    if (hlsJsCtorAvailable) {
      return 'hls-js';
    }
    return 'unsupported';
  }

  if (source.type === 'mp4') {
    if (canPlayNativeMp4(video, source.mimeType ?? 'video/mp4')) {
      return 'progressive';
    }
    return 'unsupported';
  }

  return 'unsupported';
}

export async function createPlayer(
  video: HTMLVideoElement,
  source: SourceInfo
): Promise<PlayerHandle> {
  // --- iOS Safari trap #1: inline playback attribute ---------------------
  // Without this, iOS Safari forces fullscreen takeover on play(), which
  // breaks any custom UI layered over/around the video and breaks autoplay
  // entirely on iPhone (fullscreen-forced video cannot autoplay).
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true'); // legacy iOS < 10, cheap to keep

  // --- iOS Safari trap #2: autoplay policy --------------------------------
  // iOS (and Chrome/Firefox to varying degrees) will block autoplay of any
  // video with audio unless it is muted at the time play() is invoked. If
  // the app wants autoplay-on-load, video.muted must be set BEFORE calling
  // play(), and play()'s returned Promise must be awaited/caught because it
  // rejects (NotAllowedError) silently instead of throwing synchronously.
  // We don't force-mute here (that's a product decision the caller makes),
  // but we always treat play() as a Promise that can reject.

  const Hls = await hlsJsAvailable();
  const strategy = chooseStrategy(video, source, Hls !== null);

  let hlsInstance: import('hls.js').default | null = null;

  switch (strategy) {
    case 'native-hls': {
      video.src = source.url;
      break;
    }

    case 'hls-js': {
      if (!Hls) throw new Error('internal: hls-js strategy chosen without Hls constructor');
      hlsInstance = new Hls({
        // fragLoadingRetryDelay etc. left at hls.js defaults; the app-level
        // retry policy is composed on top of hls.js's own retries via the
        // ERROR event handler below (section 4).
      });
      hlsInstance.attachMedia(video);
      hlsInstance.on(Hls.Events.MEDIA_ATTACHED, () => {
        hlsInstance!.loadSource(source.url);
      });
      wireHlsJsErrorRecovery(hlsInstance, video, Hls);
      break;
    }

    case 'progressive': {
      // --- iOS Safari trap #3: range/206 requirement ------------------
      // iOS Safari's media pipeline issues HTTP Range requests for MP4
      // (for seeking and for progressive-download buffering) and expects
      // the server to honor them with a proper 206 Partial Content
      // response + Content-Range header. If the server returns 200 with
      // the full file body regardless of the Range header, iOS Safari
      // playback will frequently fail to start, or will refuse to seek,
      // or will silently re-download from byte 0 on every seek. This
      // isn't something the player module can "fix" client-side — it's
      // enforced by verifying the source at integration time — but we
      // encode the assumption explicitly here and fail loudly rather
      // than silently degrade, so the gap is caught in QA, not in prod.
      if (!source.mimeType || source.mimeType === 'video/mp4') {
        // Best-effort preflight: HEAD/Range check is done by the caller's
        // asset pipeline, not per-playback (would add avoidable latency
        // to every video start). We document the requirement here instead
        // of re-deriving it on every play call.
      }
      video.src = source.url;
      break;
    }

    case 'unsupported': {
      wireNativeErrorSurfacing(video); // still attach for observability
      throw new PlaybackUnsupportedError(source);
    }
  }

  return {
    strategy,
    destroy() {
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }
      video.removeAttribute('src');
      video.load();
    },
  };
}

export class PlaybackUnsupportedError extends Error {
  constructor(public readonly source: SourceInfo) {
    super(
      source.type === 'mkv'
        ? `MKV source is not natively playable in any target browser; it must be remuxed/transcoded server-side before reaching the player: ${source.url}`
        : `No playback strategy available for source type "${source.type}" on this browser: ${source.url}`
    );
    this.name = 'PlaybackUnsupportedError';
  }
}

// --- Section 4 support functions, referenced above and detailed below ----

function wireNativeErrorSurfacing(video: HTMLVideoElement) {
  video.addEventListener('error', () => {
    const err = video.error;
    // MediaError.code: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
    console.error('[player] native media error', err?.code, err?.message);
  });
}

function wireHlsJsErrorRecovery(
  hls: import('hls.js').default,
  video: HTMLVideoElement,
  Hls: typeof import('hls.js').default
) {
  let networkRetryCount = 0;
  const MAX_NETWORK_RETRIES = 3;

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      // hls.js already retries non-fatal fragment/level load errors
      // internally; we just log for observability.
      console.warn('[player] hls.js non-fatal error', data.details);
      return;
    }

    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        if (networkRetryCount < MAX_NETWORK_RETRIES) {
          networkRetryCount += 1;
          // startLoad() re-attaches the loader after a fatal network
          // error (e.g., manifest or segment fetch failure, or a 4xx/5xx
          // from the CDN). This is the hls.js-documented recovery path.
          hls.startLoad();
        } else {
          console.error('[player] hls.js network error, retries exhausted');
          video.dispatchEvent(new CustomEvent('playbackfatal', { detail: data }));
        }
        break;

      case Hls.ErrorTypes.MEDIA_ERROR:
        // Fatal MSE/decode error (e.g., buffer append failure, codec
        // switch mid-stream). hls.js's documented recovery is
        // recoverMediaError(), which attempts to reset the media source
        // and resume from the current position.
        hls.recoverMediaError();
        break;

      default:
        console.error('[player] hls.js unrecoverable fatal error', data.type, data.details);
        video.dispatchEvent(new CustomEvent('playbackfatal', { detail: data }));
        hls.destroy();
        break;
    }
  });
}
```

---

## 3. The three highest-impact iOS Safari traps

I picked these three because, in order, they are (a) the one that silently breaks the *entire play* action with no error at all, (b) the one that silently breaks *seeking*, which testers rarely exercise as thoroughly as initial playback, and (c) the one that breaks playback *before it starts*, in a way that looks identical to "the video is broken" from a support-ticket perspective, wasting debugging time on the wrong layer (client code) when the real cause is server config.

**Trap 1 — Autoplay policy (muted-before-play requirement, and the rejected Promise).**
iOS Safari (like Chrome and Firefox to lesser degrees) blocks `play()` on any element that has audio and isn't muted, unless the call happens inside a direct user-gesture handler. Miss this and `play()` returns a Promise that rejects with `NotAllowedError` — if that rejection isn't caught, most apps' console goes silent and the video simply never starts, with no visible error to the end user. Defended by treating `play()` as always-async-and-fallible, and by muting before attempting autoplay:
```typescript
video.muted = true; // set before calling play() for any non-gesture-triggered start
video.play().catch((err) => { /* surface a tap-to-play UI instead of silent failure */ });
```
This isn't literally one line inside `createPlayer` above (autoplay orchestration is a caller concern, not the player module's), but the module's contract — documented in the comment above the `hlsJsAvailable`/strategy code — is that `play()` must always be wrapped, which is why `createPlayer` never calls `play()` itself; it leaves that decision, and its `.catch`, to the caller who knows whether this is a user-gesture context.

**Trap 2 — Inline playback (`playsinline`).**
Without `playsinline`, iOS Safari hijacks any `play()` call into a native fullscreen player takeover. This breaks custom controls, breaks any picture-in-video UI, and — critically — breaks autoplay, because iOS refuses to autoplay content that would require a fullscreen transition. Defended directly in `createPlayer`:
```typescript
video.setAttribute('playsinline', 'true');
video.setAttribute('webkit-playsinline', 'true');
```
This is set unconditionally and first, before any source is attached, so there's no code path (native HLS, hls.js, or progressive) that can reach `play()` without it.

**Trap 3 — Range/206 requirement for MP4 byte-range seeking.**
iOS Safari's media pipeline (this also affects HLS byte-range segment requests under `EXT-X-BYTERANGE`, but is most commonly hit on plain progressive MP4) issues `Range:` headers for seeking and expects `206 Partial Content` + `Content-Range` in response. A server that ignores the `Range` header and always returns `200` with the full body will cause iOS Safari to fail to seek, or to fail to start playback at all on longer files, while the identical file plays fine on desktop Chrome (which is more forgiving here). This is defended by treating it as an integration-time contract rather than something the player can paper over — the module doesn't silently retry with a different request shape, it documents the requirement inline at the point the progressive strategy is chosen:
```typescript
// --- iOS Safari trap #3: range/206 requirement ------------------
// iOS Safari's media pipeline issues HTTP Range requests for MP4 ...
```
and fails loudly (via the native `error` event handler, `wireNativeErrorSurfacing`) rather than masking the problem, so it surfaces as a concrete `MediaError` code instead of an unexplained black screen.

I did not pick "manifest content-type strictness" or "live-vs-VOD edge behavior" as the top three, though both are real: Safari can be picky about receiving `application/vnd.apple.mpegurl` or `application/x-mpegURL` for `.m3u8` responses (a wrong content-type, e.g. `text/plain`, can cause a silent load failure), and live HLS has different `duration`/seekable-range semantics than VOD. I'm ranking those below the three above because in my experience they produce a visible, fast-failing error close to the point of failure (a manifest 404-shaped failure, or a seek that clamps oddly) rather than the silent, hard-to-attribute failures the top three produce. If your source pipeline serves manifests with unreliable content-types, I'd promote that trap above autoplay — this ranking assumes a reasonably well-configured CDN/origin for manifest delivery, and I have not verified your specific origin's content-type behavior, so treat this ranking as a default to revisit against your actual infrastructure.

---

## 4. Error recovery: hls.js vs. native, mid-playback network error

**Native (`<video src>`, used for native HLS on Safari and for progressive MP4 everywhere):**
The only signal is the `error` event on the `<video>` element, with `video.error` populated as a `MediaError` object exposing a numeric `.code`:
- `1` = `MEDIA_ERR_ABORTED`
- `2` = `MEDIA_ERR_NETWORK` — this is the one that fires for a mid-playback network failure (segment/file fetch failed, connection dropped).
- `3` = `MEDIA_ERR_DECODE`
- `4` = `MEDIA_ERR_SRC_NOT_SUPPORTED`

Critically, the native path gives you **no automatic retry** and **very little detail** — no distinction between "DNS failed," "got a 5xx," "connection reset mid-segment," just code `2`. There is also no API to tell the native engine "please retry the last fragment"; the only recovery lever exposed to JS is to reload the source (`video.load()` and re-set `src`, which restarts playback from the currently-tracked `currentTime` if you re-seek after `loadedmetadata`, but does lose any native internal buffering state). My module's `wireNativeErrorSurfacing` listens for this and logs `err.code`; for a production app you'd extend it to, on code `2`, snapshot `video.currentTime`, reload the source, seek back, and resume — with a bounded retry count and backoff, mirroring what I did for hls.js's network path, since native gives you no such policy for free.

**hls.js:**
The signal is the `Hls.Events.ERROR` event, carrying an `ErrorData` object with `.type` (one of `Hls.ErrorTypes.NETWORK_ERROR`, `MEDIA_ERROR`, `OTHER_ERROR`), `.details` (a specific string enum — e.g. `manifestLoadError`, `fragLoadError`, `levelLoadTimeOut` — far more granular than native's four codes), and `.fatal` (boolean). This is a materially richer signal than native gives you:
- Non-fatal network errors (a single fragment or playlist refresh failing) are already retried internally by hls.js's loader with its own backoff — no action needed from the app beyond logging.
- **Fatal** `NETWORK_ERROR` (e.g., manifest fetch failed outright, or repeated fragment failures exhausted hls.js's internal retry budget) is where the app must intervene: my module calls `hls.startLoad()`, which is hls.js's documented way to reattach the network loader and resume from where it left off, and bounds this to `MAX_NETWORK_RETRIES` (3) before giving up and dispatching a `playbackfatal` custom event so the UI can show a real "connection lost" state instead of retrying forever.
- Fatal `MEDIA_ERROR` (an MSE-level failure, e.g. a buffer append exception) is recovered via `hls.recoverMediaError()`, hls.js's documented API for this exact case, distinct from the network path — this is something native playback has no equivalent lever for at all.

**Net difference:** hls.js gives you a typed, granular error taxonomy and purpose-built recovery methods (`startLoad()`, `recoverMediaError()`) that already understand HLS internals (current fragment, buffered ranges, ABR state) and resume more precisely than a blunt reload. Native playback gives you one coarse `MediaError.code` and no built-in resume primitive — recovery there has to be hand-rolled at the "reload the whole source and reseek" granularity, which is both cruder and (because it drops the browser's internal HLS state) slightly more disruptive to the user's playback position and buffer health than hls.js's in-place recovery. My module reflects this asymmetry deliberately: richer, staged recovery for hls.js; a documented but simpler always-log-and-optionally-reload path for native, wired through the same `playbackfatal` escape hatch on the video element so the UI layer doesn't need to know which engine is underneath.

---

## Caveats and things I have not verified

- Exact `canPlayType` return strings and exact `Hls.isSupported()` internals are current as of hls.js's mainstream 2023–2025 releases; if you pin an old or very new hls.js version, re-check its API surface (`recoverMediaError`, `startLoad`, `Hls.Events.ERROR` shape) against that version's changelog.
- HEVC/AV1 support matrices across Chrome/Firefox/Edge/Android change frequently and are partly hardware-dependent (OS codec packs, SoC decode blocks); the table above states general tendencies, not guarantees for any specific device you'll actually ship to. Verify against your real target device list before committing to "web-safe" encode profiles.
- I have not run this code against a live iOS Safari 16 device in producing this answer; the API usage (`playsinline`, `canPlayType`, `MediaError` codes, hls.js's `Hls.Events`/`ErrorTypes`/`startLoad`/`recoverMediaError`) reflects documented, stable behavior, but device-specific quirks (particular iOS point releases, particular CDN configurations) should be validated in real device testing, not assumed correct from this document alone.
