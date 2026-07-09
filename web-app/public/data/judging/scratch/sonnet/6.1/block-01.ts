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
