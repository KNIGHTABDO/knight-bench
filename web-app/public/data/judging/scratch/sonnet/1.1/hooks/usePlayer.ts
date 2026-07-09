"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushProgress, saveProgressThrottled } from "../lib/continueWatching";

export interface UsePlayerOptions {
  profileId?: string | null;
  titleId?: string;
  initialProgressSeconds?: number;
}

export interface UsePlayerResult {
  progress: number;
  seek: (seconds: number) => void;
  play: () => void;
  pause: () => void;
}

// NOTE: `options` is new and optional. Existing callers that only pass
// `videoRef` keep their exact previous behavior (no profile/title -> no
// Continue Watching writes are attempted).
export function usePlayer(
  videoRef: React.RefObject<HTMLVideoElement>,
  options: UsePlayerOptions = {}
): UsePlayerResult {
  const { profileId, titleId, initialProgressSeconds } = options;
  const [progress, setProgress] = useState(initialProgressSeconds ?? 0);
  const progressRef = useRef(progress);
  const durationRef = useRef(0);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const play = useCallback(() => {
    videoRef.current?.play();
  }, [videoRef]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    if (profileId && titleId && durationRef.current > 0) {
      // Force an immediate, untrottled save so pausing never loses progress
      // to the 5-second throttle window.
      void flushProgress(profileId, titleId, progressRef.current, durationRef.current);
    }
  }, [videoRef, profileId, titleId]);

  const seek = useCallback(
    (seconds: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = seconds;
        setProgress(seconds);
      }
    },
    [videoRef]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      durationRef.current = video.duration || 0;
      if (initialProgressSeconds && initialProgressSeconds > 0) {
        video.currentTime = initialProgressSeconds;
      }
    };

    const handleTimeUpdate = () => {
      const next = video.currentTime;
      setProgress(next);
      if (profileId && titleId && durationRef.current > 0) {
        saveProgressThrottled(profileId, titleId, next, durationRef.current);
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      // Flush on unmount / navigation away from the watch page.
      if (profileId && titleId && durationRef.current > 0) {
        void flushProgress(profileId, titleId, progressRef.current, durationRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, profileId, titleId]);

  return { progress, seek, play, pause };
}
