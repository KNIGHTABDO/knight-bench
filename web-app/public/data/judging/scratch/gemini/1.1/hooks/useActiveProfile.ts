'use client';

import { useState, useEffect } from 'react';
import { getActiveProfileId } from '@/lib/profiles';

export function useActiveProfile() {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setActiveId(getActiveProfileId());

    const handleProfileChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      setActiveId(customEvent.detail);
    };

    window.addEventListener('active-profile-change', handleProfileChange);
    return () => {
      window.removeEventListener('active-profile-change', handleProfileChange);
    };
  }, []);

  return activeId;
}
