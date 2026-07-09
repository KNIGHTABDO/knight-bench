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
