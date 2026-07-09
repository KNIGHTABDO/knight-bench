export type Profile = {
  id: string;
  name: string;
  avatarUrl?: string;
  color?: string;
};

const FALLBACK_PROFILES: Profile[] = [
  { id: "profile-1", name: "Alex", color: "#4F46E5" },
  { id: "profile-2", name: "Sam", color: "#10B981" },
  { id: "profile-3", name: "Kids", color: "#F59E0B" },
];

const STORAGE_KEY = "knight:activeProfileId";
const EVENT_NAME = "knight:active-profile-change";
const LEGACY_KEY = "activeProfileId";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readFromStorage(): string | null {
  if (!isBrowser()) return null;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
}

export function getProfiles(): Profile[] {
  if (!isBrowser()) return FALLBACK_PROFILES;
  try {
    const raw = localStorage.getItem("knight:profiles");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as Profile[];
    }
  } catch {}
  return FALLBACK_PROFILES;
}

export function getActiveProfileId(): string | null {
  const id = readFromStorage();
  if (id) return id;
  const profiles = getProfiles();
  return profiles[0]?.id ?? null;
}

export function getActiveProfile(): Profile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return getProfiles().find((p) => p.id === id) ?? null;
}

export function setActiveProfile(id: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
    localStorage.setItem(LEGACY_KEY, id);
  } catch {}
  try {
    const ev = new CustomEvent(EVENT_NAME, { detail: { id } });
    window.dispatchEvent(ev);
  } catch {
    try {
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {}
  }
}

export type ActiveProfileListener = (newId: string | null) => void;

export function subscribeToActiveProfile(listener: ActiveProfileListener): () => void {
  if (!isBrowser()) return () => {};
  const handler = (e: Event) => {
    const custom = e as CustomEvent;
    if (custom.detail && typeof custom.detail.id === "string") {
      listener(custom.detail.id);
    } else {
      listener(readFromStorage());
    }
  };
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === LEGACY_KEY) {
      listener(e.newValue ?? readFromStorage());
    }
  };
  window.addEventListener(EVENT_NAME, handler as EventListener);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler as EventListener);
    window.removeEventListener("storage", storageHandler);
  };
}
