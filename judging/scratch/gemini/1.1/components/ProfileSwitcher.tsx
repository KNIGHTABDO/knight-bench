'use client';

import React from 'react';
import { getProfiles, setActiveProfile } from '@/lib/profiles';
import { useActiveProfile } from '@/hooks/useActiveProfile';

export default function ProfileSwitcher() {
  const profiles = getProfiles();
  const activeProfileId = useActiveProfile();

  const handleSelect = (id: string) => {
    setActiveProfile(id);
  };

  return (
    <div className="flex items-center space-x-2 bg-gray-900/50 p-1.5 rounded-full border border-gray-800">
      {profiles.map((profile) => {
        const isActive = profile.id === activeProfileId;
        return (
          <button
            key={profile.id}
            onClick={() => handleSelect(profile.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 ${
              isActive
                ? 'bg-red-600 text-white shadow-md scale-105'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {profile.name}
          </button>
        );
      })}
    </div>
  );
}
