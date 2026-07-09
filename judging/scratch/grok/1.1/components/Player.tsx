"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "@/hooks/usePlayer";
import { getProgress } from "@/lib/continueWatching";
import { getActiveProfileId } from "@/lib/profiles";

export type SubtitleTrack = {
  src: string;
  srcLang?: string;
  label?: string;
  default?: boolean;
};

export type PlayerProps = {
  src: string;
  subtitles?: SubtitleTrack[];
  onProgress?: (payload: {
    currentTime: number;
    duration: number;
    paused: boolean;
  }) => void;
  /** When provided, enables per-profile continue-watching persistence */
  titleId?: string;
};

/**
 * Video element wrapper.
 * Existing props (src, subtitles, onProgress) preserved.
 * Optional titleId enables IndexedDB progress + resume.
 */
export default function Player({
  src,
  subtitles = [],
  onProgress,
  titleId,
}: PlayerProps) {
  const [initialPosition, setInitialPosition] = useState<number | undefined>(
    undefined
  );
  const [resumeReady, setResumeReady] = useState(!titleId);

  // Load saved position for active profile before binding the media hook.
  useEffect(() => {
    if (!titleId) {
      setResumeReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const row = await getProgress(getActiveProfileId(), titleId);
        if (!cancelled) {
          setInitialPosition(row?.positionSeconds ?? 0);
          setResumeReady(true);
        }
      } catch {
        if (!cancelled) {
          setInitialPosition(0);
          setResumeReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [titleId]);

  const { videoRef, play, pause, isPlaying, progress, duration, seek } =
    usePlayer({
      titleId,
      onProgress,
      initialPositionSeconds: resumeReady ? initialPosition : undefined,
    });

  // Avoid mounting <video> until resume position is known to reduce flash-at-0.
  if (titleId && !resumeReady) {
    return (
      <div className="player player--loading" aria-busy="true">
        Loading player…
      </div>
    );
  }

  return (
    <div className="player">
      <video ref={videoRef} src={src} controls playsInline preload="metadata">
        {subtitles.map((track) => (
          <track
            key={track.src}
            kind="subtitles"
            src={track.src}
            srcLang={track.srcLang}
            label={track.label}
            default={track.default}
          />
        ))}
      </video>
      {/* Optional lightweight controls if the host UI expects them;
          native controls remain for accessibility. */}
      <div className="player__chrome" aria-hidden={false}>
        <button type="button" onClick={() => (isPlaying ? pause() : play())}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <span>
          {formatTime(progress)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={progress}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Seek"
        />
      </div>
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
