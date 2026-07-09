// lib/profiles.ts
// Profile identity storage. Existing exports (getProfiles, setActiveProfile)
// are unchanged in signature and behavior. New exports (getActiveProfileId,
// onProfileChange) are additive only.

export interface Profile {
  id: string;
  name: string;
  avatarUrl: string;
}

const PROFILES_KEY = "app:profiles";
const ACTIVE_PROFILE_KEY = "app:activeProfileId";
const PROFILE_CHANGED_EVENT = "profile-changed";

const DEFAULT_PROFILES: Profile[] = [
  { id: "p1", name: "Alex", avatarUrl: "/avatars/1.png" },
  { id: "p2", name: "Sam", avatarUrl: "/avatars/2.png" },
];

export function getProfiles(): Profile[] {
  if (typeof window === "undefined") return DEFAULT_PROFILES;
  const raw = window.localStorage.getItem(PROFILES_KEY);
  if (!raw) return DEFAULT_PROFILES;
  try {
    return JSON.parse(raw) as Profile[];
  } catch {
    return DEFAULT_PROFILES;
  }
}

export function setActiveProfile(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  // NEW: notify same-tab listeners (e.g. the Continue Watching island)
  // so they can update without a full page reload. This is additive --
  // existing callers of setActiveProfile do not need to change.
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT, { detail: { id } }));
}

/**
 * NEW: returns the currently active profile id, or null if none is set
 * (or if called on the server, where there is no localStorage).
 */
export function getActiveProfileId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY);
}

/**
 * NEW: subscribe to active-profile changes. Fires on same-tab switches
 * (via setActiveProfile) and on cross-tab switches (via the native
 * `storage` event). Returns an unsubscribe function.
 */
export function onProfileChange(callback: (id: string | null) => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ id: string }>).detail;
    callback(detail?.id ?? getActiveProfileId());
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key === ACTIVE_PROFILE_KEY) {
      callback(event.newValue);
    }
  };

  window.addEventListener(PROFILE_CHANGED_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorageEvent);

  return () => {
    window.removeEventListener(PROFILE_CHANGED_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorageEvent);
  };
}
