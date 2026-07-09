"use client";
import { useEffect, useRef } from "react";

type Props = {
  src: string;
  subtitles?: { src: string; lang: string; label: string }[];
  onProgress?: (progressSeconds: number, durationSeconds?: number) => void;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
  onReady?: (el: HTMLVideoElement) => void;
  attachRef?: (el: HTMLVideoElement | null) => void;
};

export default function Player({ src, subtitles, onProgress, poster, autoPlay, className, onReady, attachRef }: Props) {
  const innerRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    attachRef?.(el);
    onReady?.(el);
    return () => {
      attachRef?.(null);
    };
  }, [attachRef, onReady]);

  return (
    <video
      ref={innerRef}
      src={src}
      poster={poster}
      controls
      autoPlay={autoPlay}
      className={className ?? "w-full h-auto max-h-[80vh] bg-black"}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        onProgress?.(v.currentTime, v.duration);
      }}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        onProgress?.(v.currentTime, v.duration);
      }}
      crossOrigin="anonymous"
    >
      {subtitles?.map((s) => (
        <track key={`${s.lang}-${s.src}`} src={s.src} kind="subtitles" srcLang={s.lang} label={s.label} />
      ))}
    </video>
  );
}
