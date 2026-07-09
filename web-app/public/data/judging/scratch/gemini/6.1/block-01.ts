import Hls from 'hls.js';

export interface SourceInfo {
  url: string;
  type: 'hls' | 'mp4' | 'mkv';
}

export interface PlayerController {
  destroy: () => void;
  play: () => Promise<void>;
  pause: () => void;
}

export function createPlayer(
  video: HTMLVideoElement,
  source: SourceInfo
): PlayerController {
  let hlsInstance: Hls | null = null;
  let isDestroyed = false;

  // 1. Check for MKV files
  if (source.type === 'mkv') {
    throw new Error(
      `Source format 'mkv' is not supported natively. The container must be transcoded or remuxed to MP4/HLS.`
    );
  }

  // 2. Correct Feature Detection
  // Nuance: canPlayType returns empty string ("") if unsupported, or "maybe"/"probably" if supported.
  const supportsNativeHLS = 
    video.canPlayType('application/vnd.apple.mpegurl') !== '' ||
    video.canPlayType('audio/mpegurl') !== '';
  
  const supportsMSE = Hls.isSupported();

  // Specifically check for iOS Safari environments
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  let strategy: 'native-hls' | 'hlsjs' | 'progressive' | 'unsupported' = 'unsupported';

  if (source.type === 'hls') {
    // iOS Safari requires Native HLS. On macOS Safari, we prefer native HLS for power/HDR efficiency.
    if (isIOS || supportsNativeHLS) {
      strategy = 'native-hls';
    } else if (supportsMSE) {
      strategy = 'hlsjs';
    }
  } else if (source.type === 'mp4') {
    strategy = 'progressive';
  }

  if (strategy === 'unsupported') {
    throw new Error(`Unsupported playback configuration for source type: ${source.type}`);
  }

  // --- Defensive Initializations for iOS Safari ---
  
  // Trap #1 Defense: Force inline playback attribute to prevent native fullscreen hijack
  video.setAttribute('playsinline', 'true');
  video.playsInline = true;

  // Native Playback (HLS/Progressive) Error Handler
  const handleNativeError = (e: Event) => {
    if (isDestroyed) return;
    const mediaError = video.error;
    if (mediaError) {
      console.error(`Native media error code ${mediaError.code}: ${mediaError.message}`);
      
      // Trap #3 Defense: Check if failure is due to missing HTTP 206 Range support on iOS
      if (mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && source.type === 'mp4') {
        fetch(source.url, { method: 'HEAD' }).then(res => {
          if (res.headers.get('Accept-Ranges') !== 'bytes') {
            console.error('iOS Playback Stall Warning: Server hosting MP4 does not support HTTP 206 Range Requests.');
          }
        }).catch(() => {});
      }

      // Network Error Recovery for Native Engine
      if (mediaError.code === MediaError.MEDIA_ERR_NETWORK) {
        recoverNativePlayback();
      }
    }
  };

  const recoverNativePlayback = () => {
    const lastKnownTime = video.currentTime;
    console.warn(`Attempting native player recovery from network failure at timestamp ${lastKnownTime}s...`);
    
    // Reload source to reset media pipeline
    video.load();

    const onCanPlay = () => {
      video.currentTime = lastKnownTime;
      video.play().catch(err => console.warn('Failed to restart native playback after recovery:', err));
      video.removeEventListener('canplay', onCanPlay);
    };

    video.addEventListener('canplay', onCanPlay);
  };

  video.addEventListener('error', handleNativeError);

  // --- Instantiate Strategies ---
  if (strategy === 'hlsjs') {
    hlsInstance = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
    });

    hlsInstance.loadSource(source.url);
    hlsInstance.attachMedia(video);

    // hls.js Error recovery
    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.warn('Fatal network error in hls.js. Triggering recovery...');
            hlsInstance?.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.warn('Fatal media error in hls.js. Attempting recovery...');
            hlsInstance?.recoverMediaError();
            break;
          default:
            console.error('Fatal unrecoverable player error in hls.js. Destroying instance...');
            destroy();
            break;
        }
      }
    });
  } else {
    // Native HLS or Progressive MP4
    video.src = source.url;
  }

  // --- Controls and Teardown ---
  const play = async () => {
    try {
      await video.play();
    } catch (error: any) {
      // Trap #2 Defense: Fallback to muted playback if autoplay policy rejects the play attempt
      if (error.name === 'NotAllowedError') {
        console.warn('Autoplay blocked. Retrying with muted=true to satisfy browser policy...');
        video.muted = true;
        await video.play();
      } else {
        throw error;
      }
    }
  };

  const pause = () => {
    video.pause();
  };

  const destroy = () => {
    isDestroyed = true;
    video.removeEventListener('error', handleNativeError);
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    video.removeAttribute('src');
    video.load();
  };

  return {
    play,
    pause,
    destroy,
  };
}
