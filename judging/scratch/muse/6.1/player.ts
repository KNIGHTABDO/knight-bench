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

