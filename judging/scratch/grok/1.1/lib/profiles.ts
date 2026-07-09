/**
 * Profile helpers — still localStorage-backed.
 * Existing exports getProfiles() and setActiveProfile(id) are preserved.
 * Additive: getActiveProfileId(), ACTIVE_PROFILE_CHANGE_EVENT, ACTIVE_PROFILE_STORAGE_KEY.
 */

export type Profile = {
  id: string;
  name: string;
  avatarUrl?: string;
};

const PROFILES: Profile[] = [
  { id: "default", name: "Default", avatarUrl: "/avatars/default.png" },
  { id: "kids", name: "Kids", avatarUrl: "/avatars/kids.png" },
  { id: "guest", name: "Guest", avatarUrl: "/avatars/guest.png" },
];

/** localStorage key for the active profile id */
export const ACTIVE_PROFILE_STORAGE_KEY = "activeProfileId";

/** Same-tab event name fired when the active profile changes */
export const ACTIVE_PROFILE_CHANGE_EVENT = "active-profile-change";

/**
 * Returns the static profile list.
 * (If the real repo already loads profiles differently, keep that implementation
 * and only ensure this export name/signature remains.)
 */
export function getProfiles(): Profile[] {
  return PROFILES.slice();
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Additive helper: read active profile id from localStorage.
 * Falls back to the first profile when unset/invalid.
 */
export function getActiveProfileId(): string {
  const fallback = PROFILES[0]?.id ?? "default";
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
    if (!raw) return fallback;
    if (PROFILES.some((p) => p.id === raw)) return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Existing export — set the active profile id in localStorage.
 * Extended (non-breaking) to notify same-tab listeners so Continue Watching
 * and other client islands can swap without a full page reload.
 */
export function setActiveProfile(id: string): void {
  if (!isBrowser()) return;
  const profiles = getProfiles();
  if (!profiles.some((p) => p.id === id)) {
    return;
  }
  try {
    window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
  } catch {
    // ignore quota / private mode failures
  }
  window.dispatchEvent(
    new CustomEvent(ACTIVE_PROFILE_CHANGE_EVENT, {
      detail: { profileId: id },
    })
  );
}
