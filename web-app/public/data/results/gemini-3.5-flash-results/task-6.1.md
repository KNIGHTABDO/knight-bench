# Playback Layer Architecture: Cross-Platform Web Streaming

This document details the design and implementation of a robust, cross-platform playback layer for a web streaming application targetting iOS Safari (16+), macOS Safari, Chrome/Edge/Firefox desktop, and Android Chrome.

---

## 1. Decision Matrix: Source Type × Platform Playback Strategy

The following matrix describes how different source types are mapped to appropriate playback engines depending on the platform.

| Source Type | iOS Safari (16+) | macOS Safari | Chrome/Edge/Firefox (Desktop) | Android Chrome |
| :--- | :--- | :--- | :--- | :--- |
| **HLS (fMP4/TS)** | **Native HLS**<br>(Direct `src` binding) | **Native HLS** *or* **hls.js (MSE)**<br>(Native is preferred for power & HDR; `hls.js` is preferred for custom ABR control) | **hls.js (MSE)**<br>(Native HLS not supported) | **hls.js (MSE)**<br>(Fallback to native HLS exists on some devices but `hls.js` is highly recommended for consistency) |
| **Direct MP4 (Byte-Range)** | **Direct Progressive**<br>(Requires HTTP 206 / byte-range support) | **Direct Progressive** | **Direct Progressive** | **Direct Progressive** |
| **MKV** | ❌ **Not Playable**<br>(Requires Remux/Transcode) | ❌ **Not Playable**<br>(Requires Remux/Transcode) | ❌ **Not Playable**<br>(Requires Remux/Transcode) | ❌ **Not Playable**<br>(Requires Remux/Transcode) |

### Note on MKV (Matroska) Playback
The MKV container is **not natively supported** by any modern web browser. While MKV files often wrap standard and highly compatible web codecs (such as H.264 video and AAC audio), the Matroska container parser is not included in HTML5 media engines. Consequently, playing an MKV source requires either:
1. **Server-Side Remuxing/Transcoding**: Rewrap the stream into a fragmented MP4 (fMP4) or TS container for HLS delivery.
2. **Client-Side Demuxing**: Utilizing a heavy WebAssembly/JavaScript demuxer (like a compiled version of FFmpeg or specialized mux.js configurations) to demux the MKV container on-the-fly and feed elementary streams into the browser's Media Source Extensions (MSE). This is computationally expensive, impacts battery life, and is highly prone to audio/video desync.

---

## 2. TypeScript Module Implementation

Here is the complete implementation of the `createPlayer` module. 

### Why `Hls.isSupported()` Alone is the Wrong Test on iOS Safari
Checking `Hls.isSupported()` checks whether **Media Source Extensions (MSE)** are supported by the browser. 
- On **iPhone (iOS Safari)**, MSE is disabled/not supported for `<video>` elements to save battery and memory, so `Hls.isSupported()` returns `false`.
- However, iOS Safari has a built-in, native HLS decoder that operates directly via the standard `<video src="url.m3u8">` pipeline.
- If an application relies solely on `Hls.isSupported()` to determine if it can play HLS, it will erroneously conclude that HLS is unsupported on iOS and fail to load the stream.
- Therefore, the correct feature detection logic must also query `HTMLVideoElement.canPlayType('application/vnd.apple.mpegurl')`.

```typescript
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
```

---

## 3. iOS-Safari-Specific Traps and Defenses

We defend against the following three high-impact traps specific to iOS Safari:

### Trap 1: Native Fullscreen Hijack (Lack of `playsinline`)
*   **The Trap**: By default on iOS Safari, playing a video triggers the iOS native fullscreen media player. This removes the video element from the inline DOM layout and breaks custom UI controllers, overlay overlays, volume sliders, and custom subtitles.
*   **Justification**: Custom video controls and playback experiences are standard requirements. Fullscreen takeover degrades user experience and completely breaks complex web app layout integration.
*   **Defense Code Line**:
    ```typescript
    video.setAttribute('playsinline', 'true');
    video.playsInline = true;
    ```

### Trap 2: Autoplay/Gesture Lockout (`NotAllowedError`)
*   **The Trap**: iOS Safari enforces a strict autoplay policy. Programmatic calls to `video.play()` will reject with a `NotAllowedError` if the video contains audio and the action was not initiated by a direct user gesture (e.g. `touchstart` / `click`).
*   **Justification**: Auto-playing feeds (like dashboards or silent headers) will fail silently, freezing on the first frame and degrading perceived app reliability.
*   **Defense Code Line**:
    ```typescript
    if (error.name === 'NotAllowedError') {
      video.muted = true;
      await video.play();
    }
    ```

### Trap 3: Strict HTTP 206 Range Request Requirements for Progressive MP4
*   **The Trap**: Unlike desktop browsers that gracefully fallback to downloading the entire video file if the hosting server returns `200 OK` without range headers, iOS Safari's native AVPlayer *strictly* demands HTTP Range Requests (`206 Partial Content`) to demux progressive MP4s. If the server does not support byte ranges, iOS Safari fails completely with an uninformative error or a crossed-out play icon.
*   **Justification**: In heterogeneous source delivery, servers might occasionally serve static assets from standard object storage missing Range configurations, completely halting iOS client streams.
*   **Defense Code Line**:
    ```typescript
    if (mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && source.type === 'mp4') {
      fetch(source.url, { method: 'HEAD' }).then(res => {
        if (res.headers.get('Accept-Ranges') !== 'bytes') {
          console.error('iOS Playback Stall Warning: Server hosting MP4 does not support HTTP 206 Range Requests.');
        }
      }).catch(() => {});
    }
    ```

---

## 4. Error Recovery: Network Errors Mid-Playback

Handling network drops differs fundamentally between `hls.js` and the native HTML5 player pipeline.

### hls.js (MSE-based engine)
*   **Signal**: Receives a callback event via the `Hls.Events.ERROR` channel. The payload contains `data.fatal === true` and `data.type === Hls.ErrorTypes.NETWORK_ERROR`.
*   **Module Action**:
    1. The module captures the network error inside the custom event handler.
    2. Since it is a network error (e.g. failing to fetch manifest or segments), `hlsInstance.startLoad()` is called. This triggers a retry mechanism, restarting the internal loader thread without wiping buffer data or resetting the media pipeline.
    3. If the network recovery fails repeatedly, the playback will eventually bubble up to an unrecoverable handler where `destroy()` is called to notify application telemetry.

### Native HLS (iOS / macOS native player)
*   **Signal**: Receives a standard HTML5 `<video>` element `error` event. The browser sets the error property of the video element, which is captured via `video.error.code === MediaError.MEDIA_ERR_NETWORK`.
*   **Module Action**:
    1. Unlike `hls.js`, the native media engine does not provide low-level segment retry hooks. We must reset the media pipeline.
    2. The controller captures `video.currentTime` to remember the user's playback position.
    3. The module triggers a hard reload via `video.load()`, which clears the pipeline and requests the manifest from the beginning.
    4. An event listener is registered for the `canplay` hook. Once fired, the player restores `video.currentTime = lastKnownTime` and calls `video.play()` to resume playback.
