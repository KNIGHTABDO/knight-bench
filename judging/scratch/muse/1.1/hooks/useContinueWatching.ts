"use client";
import { useEffect, useState, useCallback } from "react";
import { getActiveProfileId, subscribeToActiveProfile } from "@/lib/profiles";
import { getContinueWatchingList, type ProgressRecord } from "@/lib/progressStore";

export function useContinueWatching(hideThreshold = 0.95) {
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [items, setItems] = useState<ProgressRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (profileId: string | null) => {
    if (!profileId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await getContinueWatchingList(profileId, { hideThreshold });
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [hideThreshold]);

  useEffect(() => {
    setActiveProfileId(getActiveProfileId());
    const unsub = subscribeToActiveProfile((newId) => {
      setActiveProfileId(newId);
    });
    return unsub;
  }, []);

  useEffect(() => {
    void load(activeProfileId);
  }, [activeProfileId, load]);

  const refresh = useCallback(() => {
    void load(activeProfileId);
  }, [activeProfileId, load]);

  useEffect(() => {
    const onFocus = () => refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  return { items, loading, activeProfileId, refresh };
}
