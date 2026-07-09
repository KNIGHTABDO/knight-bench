"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveProfileId } from "@/lib/profiles";
import { saveProgress, getProgress } from "@/lib/progressStore";

type Options = {
  titleId?: string;
  duration?: number | null;
  autoResume?: boolean;
};

type LegacyOptions = string;

export type UsePlayerOptions = Options | LegacyOptions | undefined;

type PlayerState = {
  progress: number;
  duration: number | null;
  isPlaying: boolean;
  isReady: boolean;
};

function normalizeOptions(input: UsePlayerOptions): Options {
  if (!input) return {};
  if (typeof input === "string") return { titleId: input };
  return input;
}

export function usePlayer(input?: UsePlayerOptions) {
  const opts = normalizeOptions(input);
  const titleId = opts.titleId;
  const autoResume = opts.autoResume ?? true;

  const [state, setState] = useState<PlayerState>({
    progress: 0,
    duration: opts.duration ?? null,
    isPlaying: false,
    isReady: false,
  });

  const lastWriteRef = useRef<number>(0);
  const pendingRef = useRef<{ progress: number; duration: number | null } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const titleIdRef = useRef<string | undefined>(titleId);
  const durationRef = useRef<number | null>(opts.duration ?? null);

  useEffect(() => {
    titleIdRef.current = titleId;
  }, [titleId]);

  useEffect(() => {
    if (opts.duration !== undefined) durationRef.current = opts.duration ?? null;
  }, [opts.duration]);

  const scheduleSave = useCallback((progressSeconds: number, durationSeconds: number | null) => {
    const profileId = getActiveProfileId();
    const tid = titleIdRef.current;
    if (!profileId || !tid) return;
    if (progressSeconds < 1) return;
    const now = Date.now();
    const elapsed = now - lastWriteRef.current;
    pendingRef.current = { progress: progressSeconds, duration: durationSeconds };

    const doSave = async () => {
      const p = pendingRef.current;
      if (!p) return;
      const pid = getActiveProfileId();
      const t = titleIdRef.current;
      if (!pid || !t) return;
      try {
        await saveProgress({
          profileId: pid,
          titleId: t,
          progressSeconds: p.progress,
          durationSeconds: p.duration,
        });
        lastWriteRef.current = Date.now();
        pendingRef.current = null;
      } catch {}
    };

    if (elapsed >= 5000) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      void doSave();
    } else if (!timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        void doSave();
      }, 5000 - elapsed);
    }
  }, []);

  const flushPending = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const p = pendingRef.current;
    if (!p) return;
    const pid = getActiveProfileId();
    const tid = titleIdRef.current;
    if (!pid || !tid) return;
    try {
      await saveProgress({
        profileId: pid,
        titleId: tid,
        progressSeconds: p.progress,
        durationSeconds: p.duration,
      });
      lastWriteRef.current = Date.now();
      pendingRef.current = null;
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!titleId) return;
      const pid = getActiveProfileId();
      if (!pid) return;
      try {
        const rec = await getProgress(pid, titleId);
        if (cancelled) return;
        if (rec && rec.progressSeconds > 1 && rec.percent <= 0.95) {
          setState((s) => ({
            ...s,
            progress: rec.progressSeconds,
            duration: rec.durationSeconds ?? s.duration,
            isReady: true,
          }));
        } else {
          setState((s) => ({ ...s, isReady: true }));
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, isReady: true }));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [titleId]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") void flushPending();
    };
    const onBeforeUnload = () => {
      void flushPending();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onBeforeUnload);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onBeforeUnload);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flushPending();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [flushPending]);

  const handleProgress = useCallback(
    (progressSeconds: number, durationSeconds?: number) => {
      const dur = typeof durationSeconds === "number" && !Number.isNaN(durationSeconds) ? durationSeconds : durationRef.current;
      if (dur !== null && dur !== undefined) durationRef.current = dur;
      setState((s) => ({
        ...s,
        progress: progressSeconds,
        duration: dur ?? s.duration,
      }));
      scheduleSave(progressSeconds, dur ?? null);
    },
    [scheduleSave]
  );

  const seek = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
    }
    setState((s) => ({ ...s, progress: seconds }));
  }, []);

  const play = useCallback(() => {
    videoRef.current?.play().catch(() => {});
    setState((s) => ({ ...s, isPlaying: true }));
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setState((s) => ({ ...s, isPlaying: false }));
    void flushPending();
  }, [flushPending]);

  const attach = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && state.progress > 1 && autoResume) {
      const t = state.progress;
      const onMeta = () => {
        if (el.duration && t < el.duration * 0.95) {
          try {
            el.currentTime = t;
          } catch {}
        }
        el.removeEventListener("loadedmetadata", onMeta);
      };
      el.addEventListener("loadedmetadata", onMeta);
      if (el.readyState >= 1) {
        try {
          if (!el.duration || t < el.duration * 0.95) el.currentTime = t;
        } catch {}
      }
    }
  }, [state.progress, autoResume]);

  return {
    progress: state.progress,
    duration: state.duration,
    isPlaying: state.isPlaying,
    isReady: state.isReady,
    seek,
    play,
    pause,
    handleProgress,
    attach,
  };
}
