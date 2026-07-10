'use client';

import { useEffect, useRef } from 'react';

type Subtitle = {
  src: string;
  srcLang: string;
  label: string;
  default?: boolean;
};

type ProgressUpdate = {
  positionSeconds: number;
  durationSeconds: number;
};

type PlayerProps = {
  src: string;
  subtitles?: Subtitle[];
  onProgress?: (progress: ProgressUpdate) => void;
};

export default function Player({ src, subtitles = [], onProgress }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    if (!video || !onProgress) {
      return;
    }

    const handleTimeUpdate = () => {
      onProgress({
        positionSeconds: video.currentTime,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
      });
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('pause', handleTimeUpdate);
    video.addEventListener('ended', handleTimeUpdate);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('pause', handleTimeUpdate);
      video.removeEventListener('ended', handleTimeUpdate);
    };
  }, [onProgress]);

  return (
    <video ref={videoRef} controls playsInline preload="metadata" src={src}>
      {subtitles.map((subtitle) => (
        <track
          key={`${subtitle.srcLang}-${subtitle.src}`}
          src={subtitle.src}
          srcLang={subtitle.srcLang}
          label={subtitle.label}
          default={subtitle.default}
          kind="subtitles"
        />
      ))}
    </video>
  );
}
