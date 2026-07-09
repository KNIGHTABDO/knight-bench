"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  flushProgressAndNotify,
  saveProgressThrottled,
} from "@/lib/continueWatching";
import { getActiveProfileId } from "@/lib/profiles";

/** Cap resume position so we do not land past the completion threshold. */
const COMPLETE_SAFE_RESUME = 0.95;

export type UsePlayerOptions = {
  /** When set, progress is persisted per active profile + this title */
  titleId?: string;
  /** Optional external progress callback (existing Player prop surface) */
  onProgress?: (payload: {
    currentTime: number;
    duration: number;
    paused: boolean;
  }) => void;
  /** Optional initial seek position (e.g. resume from Continue Watching) */
  initialPositionSeconds?: number;
};

export type UsePlayerResult = {
  progress: number;
  seek: (timeSeconds: number) => void;
  play: () => void;
  pause: () => void;
  /** Additive helpers for Player.tsx (non-breaking) */
  videoRef: RefObject<HTMLVideoElement | null>;
  isPlaying: boolean;
  duration: number;
};

/**
 * Manages play state and progress.
 * Public surface still exposes { progress, seek, play, pause }.
 * When titleId is provided, writes throttled progress to IndexedDB
 * for the current active profile (max one write / 5s + trailing flush).
 */
export function usePlayer(options: UsePlayerOptions = {}): UsePlayerResult {
  const { titleId, onProgress, initialPositionSeconds } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const didInitialSeek = useRef(false);
  const durationRef = useRef(0);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  /** Queue a throttled durable write (≤1 / 5s per profile+title). */
  const queueSave = useCallback(
    (currentTime: number, mediaDuration: number) => {
      if (!titleId) return;
      saveProgressThrottled({
        profileId: getActiveProfileId(),
        titleId,
        positionSeconds: currentTime,
        durationSeconds: mediaDuration,
      });
    },
    [titleId]
  );

  /**
   * Stash the latest snapshot into the throttle buffer (if provided),
   * then force-flush pending writes and notify Continue Watching islands.
   */
  const flushSave = useCallback(
    async (currentTime?: number, mediaDuration?: number) => {
      if (!titleId) return;
      const profileId = getActiveProfileId();
      if (typeof currentTime === "number") {
        saveProgressThrottled({
          profileId,
          titleId,
          positionSeconds: currentTime,
          durationSeconds:
            typeof mediaDuration === "number"
              ? mediaDuration
              : durationRef.current,
        });
      }
      await flushProgressAndNotify(profileId, titleId);
    },
    [titleId]
  );

  const seek = useCallback((timeSeconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    const d = el.duration;
    const next =
      Number.isFinite(d) && d > 0
        ? Math.min(Math.max(0, timeSeconds), d)
        : Math.max(0, timeSeconds);
    el.currentTime = next;
    setProgress(next);
  }, []);

  const play = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    void el
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }, []);

  const pause = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    setIsPlaying(false);
    void flushSave(el.currentTime, el.duration || durationRef.current);
  }, [flushSave]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const handleTimeUpdate = () => {
      const t = el.currentTime;
      const d = el.duration;
      setProgress(t);
      if (Number.isFinite(d) && d > 0) setDuration(d);
      queueSave(t, Number.isFinite(d) ? d : 0);
      onProgress?.({
        currentTime: t,
        duration: Number.isFinite(d) ? d : 0,
        paused: el.paused,
      });
    };

    const handleLoadedMetadata = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
      if (
        !didInitialSeek.current &&
        typeof initialPositionSeconds === "number" &&
        initialPositionSeconds > 0
      ) {
        didInitialSeek.current = true;
        const capped =
          Number.isFinite(d) && d > 0
            ? Math.min(initialPositionSeconds, d * COMPLETE_SAFE_RESUME)
            : initialPositionSeconds;
        el.currentTime = capped;
        setProgress(capped);
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => {
      setIsPlaying(false);
      void flushSave(el.currentTime, el.duration || 0);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      // Ending at ~100% triggers delete-on-complete in putProgress.
      void flushSave(el.duration || el.currentTime, el.duration || 0);
    };

    el.addEventListener("timeupdate", handleTimeUpdate);
    el.addEventListener("loadedmetadata", handleLoadedMetadata);
    el.addEventListener("play", handlePlay);
    el.addEventListener("pause", handlePause);
    el.addEventListener("ended", handleEnded);

    return () => {
      el.removeEventListener("timeupdate", handleTimeUpdate);
      el.removeEventListener("loadedmetadata", handleLoadedMetadata);
      el.removeEventListener("play", handlePlay);
      el.removeEventListener("pause", handlePause);
      el.removeEventListener("ended", handleEnded);
      void flushSave(el.currentTime, el.duration || 0);
    };
  }, [queueSave, flushSave, onProgress, initialPositionSeconds]);

  // Flush when tab is hidden / page is closing.
  useEffect(() => {
    if (!titleId) return;

    const onHide = () => {
      const el = videoRef.current;
      void flushSave(el?.currentTime, el?.duration || durationRef.current);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [titleId, flushSave]);

  return {
    progress,
    seek,
    play,
    pause,
    videoRef,
    isPlaying,
    duration,
  };
}
