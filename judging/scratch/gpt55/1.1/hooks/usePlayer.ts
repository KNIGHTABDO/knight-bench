'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushPendingProgress, getProgressForTitle, saveProgressThrottled } from '@/lib/watchProgress';
import { getActiveProfileId, subscribeActiveProfile } from '@/lib/profiles';

type UsePlayerOptions = {
  titleId?: string | number;
};

type ProgressUpdate = {
  positionSeconds: number;
  durationSeconds: number;
};

export function usePlayer(options: UsePlayerOptions = {}) {
  const { titleId } = options;
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const profileIdRef = useRef<string | null>(null);
  const mediaElementRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    profileIdRef.current = getActiveProfileId();

    return subscribeActiveProfile((profileId) => {
      profileIdRef.current = profileId;

      if (!titleId) {
        setProgress(0);
        return;
      }

      void getProgressForTitle(profileId, titleId).then((record) => {
        setProgress(record?.progress ?? 0);
      });
    });
  }, [titleId]);

  useEffect(() => {
    if (!titleId) {
      return;
    }

    const profileId = profileIdRef.current ?? getActiveProfileId();
    profileIdRef.current = profileId;

    void getProgressForTitle(profileId, titleId).then((record) => {
      setProgress(record?.progress ?? 0);
    });
  }, [titleId]);

  useEffect(() => {
    const flush = () => flushPendingProgress();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingProgress();
      }
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);

    return () => {
      flushPendingProgress();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, []);

  const onProgress = useCallback(
    (update: ProgressUpdate) => {
      const nextProgress =
        update.durationSeconds > 0 ? update.positionSeconds / update.durationSeconds : 0;

      setProgress(Math.min(1, Math.max(0, nextProgress)));

      if (!titleId || !profileIdRef.current) {
        return;
      }

      saveProgressThrottled({
        profileId: profileIdRef.current,
        titleId,
        positionSeconds: update.positionSeconds,
        durationSeconds: update.durationSeconds,
      });
    },
    [titleId],
  );

  const seek = useCallback((nextProgress: number) => {
    const clampedProgress = Math.min(1, Math.max(0, nextProgress));

    setProgress(clampedProgress);

    if (mediaElementRef.current?.duration) {
      mediaElementRef.current.currentTime = mediaElementRef.current.duration * clampedProgress;
    }
  }, []);

  const play = useCallback(() => {
    setIsPlaying(true);
    void mediaElementRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    setIsPlaying(false);
    mediaElementRef.current?.pause();
    flushPendingProgress();
  }, []);

  return {
    progress,
    seek,
    play,
    pause,
    isPlaying,
    onProgress,
    mediaElementRef,
  };
}
