'use client';

export type Profile = {
  id: string;
  name: string;
  avatarUrl: string;
};

export const PROFILE_CHANGED_EVENT = 'knight-bench:profile-changed';

const ACTIVE_PROFILE_STORAGE_KEY = 'knight-bench-active-profile';

const profiles: Profile[] = [
  {
    id: 'default',
    name: 'Default',
    avatarUrl: '/profiles/default.png',
  },
];

function canUseStorage() {
  return typeof window !== 'undefined' && 'localStorage' in window;
}

function emitProfileChanged(profileId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(PROFILE_CHANGED_EVENT, {
      detail: { profileId },
    }),
  );
}

export function getProfiles() {
  return profiles;
}

export function getActiveProfileId() {
  const fallbackProfileId = profiles[0]?.id ?? 'default';

  if (!canUseStorage()) {
    return fallbackProfileId;
  }

  return window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY) ?? fallbackProfileId;
}

export function setActiveProfile(id: string) {
  if (canUseStorage()) {
    window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
  }

  emitProfileChanged(id);
}

export function subscribeActiveProfile(listener: (profileId: string) => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const onProfileChanged = (event: Event) => {
    const profileId = (event as CustomEvent<{ profileId?: string }>).detail?.profileId;

    if (profileId) {
      listener(profileId);
    }
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_PROFILE_STORAGE_KEY && event.newValue) {
      listener(event.newValue);
    }
  };

  window.addEventListener(PROFILE_CHANGED_EVENT, onProfileChanged);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(PROFILE_CHANGED_EVENT, onProfileChanged);
    window.removeEventListener('storage', onStorage);
  };
}
