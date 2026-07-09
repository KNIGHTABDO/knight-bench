"use client";
import { useCallback, useEffect, useState } from "react";
import { getActiveProfileId, onProfileChange } from "../lib/profiles";
import { ContinueWatchingEntry, getContinueWatching } from "../lib/continueWatching";

export interface UseContinueWatchingResult {
  entries: ContinueWatchingEntry[];
  activeProfileId: string | null;
  loading: boolean;
}

export function useContinueWatching(): UseContinueWatchingResult {
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ContinueWatchingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (profileId: string | null) => {
    if (!profileId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await getContinueWatching(profileId);
      setEntries(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const current = getActiveProfileId();
    setActiveProfileId(current);
    void refresh(current);

    // Re-query whenever the active profile changes (same tab or cross tab).
    const unsubscribeProfile = onProfileChange((id) => {
      setActiveProfileId(id);
      void refresh(id);
    });

    // Re-query whenever a throttled/immediate progress write happens
    // (e.g. the user is actively watching something on another page/tab).
    let latestProfileId: string | null = current;
    const handleUpdate = () => {
      void refresh(latestProfileId);
    };
    window.addEventListener("continue-watching-updated", handleUpdate);

    const unsubscribeProfileTracking = onProfileChange((id) => {
      latestProfileId = id;
    });

    return () => {
      unsubscribeProfile();
      unsubscribeProfileTracking();
      window.removeEventListener("continue-watching-updated", handleUpdate);
    };
  }, [refresh]);

  return { entries, activeProfileId, loading };
}
