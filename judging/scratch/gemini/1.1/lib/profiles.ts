export interface Profile {
  id: string;
  name: string;
  avatarUrl?: string;
}

const DEFAULT_PROFILES: Profile[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
  { id: '3', name: 'Charlie' },
];

export function getProfiles(): Profile[] {
  return DEFAULT_PROFILES;
}

export function setActiveProfile(id: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('activeProfileId', id);
    // Dispatch event to allow client-side sync without page reload
    window.dispatchEvent(new CustomEvent('active-profile-change', { detail: id }));
  }
}

export function getActiveProfileId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('activeProfileId') || DEFAULT_PROFILES[0].id;
}
