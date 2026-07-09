'use client';

import { useState, useEffect, useRef } from 'react';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { getProgress, saveProgressThrottled, forceSaveProgress } from '@/lib/db-client';

export function usePlayer(titleId: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [progress, setProgress] = useState(0);
  const activeProfileId = useActiveProfile();

  const activeProfileRef = useRef<string | null>(null);
  useEffect(() => {
    activeProfileRef.current = activeProfileId;
  }, [activeProfileId]);

  // Load progress when active profile and ref are set
  useEffect(() => {
    if (!activeProfileId || !titleId) return;

    let isMounted = true;
    getProgress(activeProfileId, titleId).then((saved) => {
      if (!isMounted || !saved) return;

      const video = videoRef.current;
      if (video) {
        const applySavedTime = () => {
          if (video.duration) {
            video.currentTime = saved.progress * video.duration;
            setProgress(saved.progress);
            video.removeEventListener('loadedmetadata', applySavedTime);
          }
        };

        if (video.readyState >= 1) {
          applySavedTime();
        } else {
          video.addEventListener('loadedmetadata', applySavedTime);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [activeProfileId, titleId]);

  // Hook into video updates and page teardown triggers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (video.duration) {
        const currentProgress = video.currentTime / video.duration;
        setProgress(currentProgress);

        const profileId = activeProfileRef.current;
        if (profileId) {
          saveProgressThrottled(profileId, titleId, currentProgress);
        }
      }
    };

    const handlePause = () => {
      if (video.duration) {
        const currentProgress = video.currentTime / video.duration;
        const profileId = activeProfileRef.current;
        if (profileId) {
          forceSaveProgress(profileId, titleId, currentProgress);
        }
      }
    };

    const handleUnload = () => {
      if (video.duration) {
        const currentProgress = video.currentTime / video.duration;
        const profileId = activeProfileRef.current;
        if (profileId) {
          forceSaveProgress(profileId, titleId, currentProgress);
        }
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('pause', handlePause);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      if (video.duration) {
        const currentProgress = video.currentTime / video.duration;
        const profileId = activeProfileRef.current;
        if (profileId) {
          forceSaveProgress(profileId, titleId, currentProgress);
        }
      }
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('pause', handlePause);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [titleId]);

  const play = () => {
    videoRef.current?.play().catch((err) => console.error('Play aborted:', err));
  };

  const pause = () => {
    videoRef.current?.pause();
  };

  const seek = (time: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
      if (video.duration) {
        setProgress(time / video.duration);
      }
    }
  };

  return {
    progress,
    seek,
    play,
    pause,
    videoRef,
  };
}
