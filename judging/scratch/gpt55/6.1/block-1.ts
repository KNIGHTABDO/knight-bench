import Hls, { ErrorData, HlsConfig } from 'hls.js';

export type PlaybackStrategy =
  | 'native-hls'
  | 'hls.js'
  | 'progressive-mp4'
  | 'unsupported';

export type PlayerRuntimeError = {
  phase: 'attach' | 'play' | 'network' | 'media' | 'unsupported';
  fatal: boolean;
  message: string;
  original?: unknown;
  mediaErrorCode?: number;
  hlsType?: string;
  hlsDetails?: string;
};

type CommonSourceOptions = {
  url: string;
  mimeType?: string;
  autoplay?: boolean;
  muted?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  startTime?: number;
  crossOrigin?: 'anonymous' | 'use-credentials';
  maxRecoveryAttempts?: number;
  onError?: (error: PlayerRuntimeError) => void;
};

export type HlsSourceInfo = CommonSourceOptions & {
  kind: 'hls';
  isLive?: boolean;
  liveSyncSeconds?: number;
  usesByteRangeSegments?: boolean;
  byteRange?: boolean;
};

export type Mp4SourceInfo = CommonSourceOptions & {
  kind: 'mp4';
  // Keep this as explicit source metadata from ingestion or the CDN config.
  // iOS Safari can fail hard when progressive MP4 range responses are missing.
  byteRange: boolean;
};

export type MkvSourceInfo = CommonSourceOptions & {
  kind: 'mkv';
};

export type SourceInfo = HlsSourceInfo | Mp4SourceInfo | MkvSourceInfo;

export type PlayerHandle = {
  readonly strategy: PlaybackStrategy;
  readonly ready: Promise<void>;
  play(): Promise<void>;
  pause(): void;
  recover(): void;
  destroy(): void;
};

const HLS_MIME_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegURL',
];

const DEFAULT_MP4_MIME = 'video/mp4';
const MEDIA_ERR_NETWORK_CODE = 2;
const MEDIA_ERR_DECODE_CODE = 3;

export function createPlayer(
  video: HTMLVideoElement,
  source: SourceInfo,
): PlayerHandle {
  const disposers: Array<() => void> = [];
  let destroyed = false;
  let hls: Hls | undefined;
  let strategy: PlaybackStrategy = 'unsupported';

  resetMediaElement(video);
  applyMediaElementPolicy(video, source);
  assertSourceCanBeAttempted(video, source);

  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const report = (error: PlayerRuntimeError) => {
    source.onError?.(error);
  };

  try {
    if (source.kind === 'mkv') {
      throw unsupported(
        'MKV/Matroska is not a browser playback source. Remux to MP4/HLS when codecs are compatible, or transcode when they are not.',
      );
    }

    if (source.kind === 'mp4') {
      strategy = 'progressive-mp4';
      attachProgressiveMp4(video, source, report, disposers);
      resolveReady();
    } else if (shouldUseNativeHls(video)) {
      strategy = 'native-hls';
      attachNativeHls(video, source, report, disposers, resolveReady, rejectReady);
    } else if (Hls.isSupported()) {
      strategy = 'hls.js';
      hls = attachHlsJs(video, source, report, disposers, resolveReady, rejectReady);
    } else if (canPlayNativeHls(video)) {
      // Android Chrome and some embedded browsers may expose native HLS.
      // Prefer hls.js when MSE is healthy, but keep a native fallback.
      strategy = 'native-hls';
      attachNativeHls(video, source, report, disposers, resolveReady, rejectReady);
    } else {
      throw unsupported('No native HLS support and hls.js/MSE is not available.');
    }
  } catch (error) {
    const runtimeError = toRuntimeError(error, 'attach', true);
    report(runtimeError);
    rejectReady(error);
    throw error;
  }

  const handle: PlayerHandle = {
    strategy,
    ready,
    async play() {
      await ready;
      await playWithPolicy(video, source, report);
    },
    pause() {
      video.pause();
    },
    recover() {
      if (destroyed) return;

      if (hls) {
        hls.startLoad(Number.isFinite(video.currentTime) ? video.currentTime : -1);
        return;
      }

      recoverNativeElement(video, source, report);
    },
    destroy() {
      destroyed = true;
      for (const dispose of disposers.splice(0)) dispose();
      hls?.destroy();
      hls = undefined;
      resetMediaElement(video);
    },
  };

  if (source.autoplay) {
    void handle.play();
  }

  return handle;
}

function applyMediaElementPolicy(video: HTMLVideoElement, source: SourceInfo) {
  if (source.crossOrigin) {
    video.crossOrigin = source.crossOrigin;
  }

  // iOS trap defense #1: this must be set before assigning src.
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  // iOS trap defense #2: muted must be set before the autoplaying play() call.
  if (source.autoplay) {
    video.autoplay = true;
    video.muted = source.muted ?? true;
    video.defaultMuted = video.muted;
  } else if (typeof source.muted === 'boolean') {
    video.muted = source.muted;
    video.defaultMuted = source.muted;
  }

  video.preload = source.preload ?? (source.autoplay ? 'auto' : 'metadata');

  // iOS trap defense #3: fail early when ingestion/CDN metadata says byte ranges
  // are not available for source shapes that iOS Safari commonly requires.
  if (isIOSWebKit() && source.kind === 'mp4' && source.byteRange !== true) {
    throw unsupported('iOS Safari progressive MP4 requires reliable HTTP byte-range/206 support.');
  }

  if (
    isIOSWebKit() &&
    source.kind === 'hls' &&
    source.usesByteRangeSegments &&
    source.byteRange !== true
  ) {
    throw unsupported('This HLS playlist uses byte-range segments, but byte-range support is not confirmed.');
  }
}

function assertSourceCanBeAttempted(video: HTMLVideoElement, source: SourceInfo) {
  if (source.kind === 'mkv') {
    throw unsupported('MKV/Matroska must be remuxed or transcoded before browser playback.');
  }

  if (source.kind === 'mp4') {
    const mime = source.mimeType ?? DEFAULT_MP4_MIME;
    if (video.canPlayType(mime) === '') {
      throw unsupported(`This browser did not report support for ${mime}.`);
    }
  }
}

function shouldUseNativeHls(video: HTMLVideoElement): boolean {
  if (!canPlayNativeHls(video)) return false;

  // Native HLS is the primary path on iOS Safari and macOS Safari.
  // On Android Chrome, prefer hls.js/MSE for a more observable ABR/error model.
  return isIOSWebKit() || isDesktopSafari();
}

function canPlayNativeHls(video: HTMLVideoElement): boolean {
  return HLS_MIME_TYPES.some((mime) => video.canPlayType(mime) !== '');
}

function attachProgressiveMp4(
  video: HTMLVideoElement,
  source: Mp4SourceInfo,
  report: (error: PlayerRuntimeError) => void,
  disposers: Array<() => void>,
) {
  attachNativeErrorRecovery(video, source, report, disposers);
  video.src = source.url;
  video.load();

  if (source.startTime && source.startTime > 0) {
    seekWhenMetadataReady(video, source.startTime);
  }
}

function attachNativeHls(
  video: HTMLVideoElement,
  source: HlsSourceInfo,
  report: (error: PlayerRuntimeError) => void,
  disposers: Array<() => void>,
  resolveReady: () => void,
  rejectReady: (error: unknown) => void,
) {
  const nativeMime = HLS_MIME_TYPES.find((mime) => video.canPlayType(mime) !== '');
  if (!nativeMime) {
    throw unsupported('Native HLS was selected, but the media element does not report HLS support.');
  }

  let readySettled = false;
  const settleReady = () => {
    if (readySettled) return;
    readySettled = true;
    resolveReady();
  };
  const failReady = () => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(video.error ?? new Error('Native HLS failed before metadata loaded.'));
  };

  disposers.push(addMediaListener(video, 'loadedmetadata', settleReady, { once: true }));
  disposers.push(addMediaListener(video, 'error', failReady, { once: true }));
  attachNativeErrorRecovery(video, source, report, disposers);

  video.src = source.url;
  video.load();

  if (source.startTime && source.startTime > 0 && !source.isLive) {
    seekWhenMetadataReady(video, source.startTime);
  }
}

function attachHlsJs(
  video: HTMLVideoElement,
  source: HlsSourceInfo,
  report: (error: PlayerRuntimeError) => void,
  disposers: Array<() => void>,
  resolveReady: () => void,
  rejectReady: (error: unknown) => void,
): Hls {
  const config: Partial<HlsConfig> = {
    enableWorker: true,
    lowLatencyMode: source.isLive === true,
    backBufferLength: source.isLive ? 30 : Infinity,
  };

  if (source.crossOrigin === 'use-credentials') {
    config.xhrSetup = (xhr) => {
      xhr.withCredentials = true;
    };
  }

  const hls = new Hls(config);
  const scheduler = createRetryScheduler(source.maxRecoveryAttempts ?? 3);
  let readySettled = false;
  let mediaRecoveryAttempts = 0;

  const settleReady = () => {
    if (readySettled) return;
    readySettled = true;
    resolveReady();
  };

  const failReady = (error: unknown) => {
    if (readySettled) {
      report(toRuntimeError(error, 'media', true));
      return;
    }
    readySettled = true;
    rejectReady(error);
  };

  hls.on(Hls.Events.MEDIA_ATTACHED, () => {
    hls.loadSource(source.url);
  });

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (source.startTime && source.startTime > 0 && !source.isLive) {
      video.currentTime = source.startTime;
    }
    settleReady();
  });

  hls.on(Hls.Events.FRAG_LOADED, () => {
    scheduler.reset();
    mediaRecoveryAttempts = 0;
  });

  hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
    report({
      phase: data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'media',
      fatal: data.fatal,
      message: `hls.js error: ${data.type}/${data.details}`,
      hlsType: data.type,
      hlsDetails: data.details,
      original: data,
    });

    if (!data.fatal) {
      // hls.js is already retrying internally for non-fatal load/buffer errors.
      return;
    }

    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      scheduler.schedule(() => {
        hls.startLoad(Number.isFinite(video.currentTime) ? video.currentTime : -1);
      });
      return;
    }

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveryAttempts < 2) {
      mediaRecoveryAttempts += 1;
      hls.recoverMediaError();
      return;
    }

    failReady(new Error(`Fatal hls.js error: ${data.type}/${data.details}`));
  });

  hls.attachMedia(video);

  disposers.push(() => {
    scheduler.dispose();
    hls.destroy();
  });

  return hls;
}

function attachNativeErrorRecovery(
  video: HTMLVideoElement,
  source: HlsSourceInfo | Mp4SourceInfo,
  report: (error: PlayerRuntimeError) => void,
  disposers: Array<() => void>,
) {
  const scheduler = createRetryScheduler(source.maxRecoveryAttempts ?? 3);

  const onError = () => {
    const code = video.error?.code;
    const message = video.error?.message || 'Native media element error.';

    report({
      phase: code === MEDIA_ERR_NETWORK_CODE ? 'network' : 'media',
      fatal: true,
      message,
      mediaErrorCode: code,
      original: video.error,
    });

    if (code === MEDIA_ERR_NETWORK_CODE) {
      scheduler.schedule(() => recoverNativeElement(video, source, report));
      return;
    }

    if (code === MEDIA_ERR_DECODE_CODE) {
      // A decode error usually means a bad rendition/codec/segment, not a retryable CDN blip.
      return;
    }
  };

  const onStalledOrWaiting = () => {
    report({
      phase: 'network',
      fatal: false,
      message: 'Native playback stalled or is waiting for data.',
    });
  };

  disposers.push(addMediaListener(video, 'error', onError));
  disposers.push(addMediaListener(video, 'stalled', onStalledOrWaiting));
  disposers.push(addMediaListener(video, 'waiting', onStalledOrWaiting));
  disposers.push(() => scheduler.dispose());
}

function recoverNativeElement(
  video: HTMLVideoElement,
  source: HlsSourceInfo | Mp4SourceInfo,
  report: (error: PlayerRuntimeError) => void,
) {
  const wasPlaying = !video.paused && !video.ended;
  const resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;

  video.pause();
  video.removeAttribute('src');
  video.load();

  video.src = source.url;
  video.load();

  const restore = () => {
    try {
      if (source.kind === 'hls' && source.isLive) {
        seekNearLiveEdge(video, source.liveSyncSeconds ?? 3);
      } else if (resumeAt > 0) {
        video.currentTime = resumeAt;
      }
    } catch (error) {
      report(toRuntimeError(error, 'media', false));
    }

    if (wasPlaying || source.autoplay) {
      void playWithPolicy(video, source, report);
    }
  };

  video.addEventListener('loadedmetadata', restore, { once: true });
}

async function playWithPolicy(
  video: HTMLVideoElement,
  source: SourceInfo,
  report: (error: PlayerRuntimeError) => void,
) {
  try {
    await video.play();
  } catch (error) {
    const domError = error as DOMException;
    report({
      phase: 'play',
      fatal: domError.name !== 'AbortError',
      message:
        domError.name === 'NotAllowedError'
          ? 'Autoplay was blocked. Start playback from a user gesture or use muted autoplay.'
          : domError.message || 'video.play() failed.',
      original: error,
    });
    throw error;
  }
}

function seekWhenMetadataReady(video: HTMLVideoElement, seconds: number) {
  const seek = () => {
    try {
      video.currentTime = seconds;
    } catch {
      // Some native live or not-yet-seekable streams reject early seeks.
    }
  };

  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    seek();
  } else {
    video.addEventListener('loadedmetadata', seek, { once: true });
  }
}

function seekNearLiveEdge(video: HTMLVideoElement, liveSyncSeconds: number) {
  const ranges = video.seekable;
  if (ranges.length === 0) return;

  const last = ranges.length - 1;
  const start = ranges.start(last);
  const end = ranges.end(last);
  video.currentTime = Math.max(start, end - liveSyncSeconds);
}

function createRetryScheduler(maxAttempts: number) {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    schedule(fn: () => void) {
      if (attempts >= maxAttempts) return;
      attempts += 1;
      const delayMs = Math.min(1000 * 2 ** (attempts - 1), 8000);
      if (timer) clearTimeout(timer);
      timer = setTimeout(fn, delayMs);
    },
    reset() {
      attempts = 0;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

function resetMediaElement(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  while (video.firstChild) video.removeChild(video.firstChild);
  video.load();
}

function addMediaListener<K extends keyof HTMLMediaElementEventMap>(
  video: HTMLVideoElement,
  event: K,
  listener: (event: HTMLMediaElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  const typedListener = listener as EventListener;
  video.addEventListener(event, typedListener, options);
  return () => video.removeEventListener(event, typedListener, options);
}

function unsupported(message: string) {
  return new UnsupportedSourceError(message);
}

export class UnsupportedSourceError extends Error {
  readonly strategy = 'unsupported' as const;

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSourceError';
  }
}

function toRuntimeError(
  error: unknown,
  phase: PlayerRuntimeError['phase'],
  fatal: boolean,
): PlayerRuntimeError {
  if (error instanceof UnsupportedSourceError) {
    return { phase: 'unsupported', fatal: true, message: error.message, original: error };
  }

  if (error instanceof Error) {
    return { phase, fatal, message: error.message, original: error };
  }

  return { phase, fatal, message: String(error), original: error };
}

function isIOSWebKit(): boolean {
  const ua = navigator.userAgent;
  const platform = navigator.platform;

  // iPadOS desktop-mode Safari can report MacIntel with touch points.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isDesktopSafari(): boolean {
  const ua = navigator.userAgent;
  const vendor = navigator.vendor;

  return (
    /Apple/i.test(vendor) &&
    /Safari/i.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/i.test(ua) &&
    !isIOSWebKit()
  );
}
