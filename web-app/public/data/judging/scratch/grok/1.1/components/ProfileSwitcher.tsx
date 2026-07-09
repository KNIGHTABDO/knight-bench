"use client";

import { useEffect, useState } from "react";
import {
  getActiveProfileId,
  getProfiles,
  setActiveProfile,
  type Profile,
} from "@/lib/profiles";

/**
 * Renders profile avatars and switches the active profile.
 * setActiveProfile already dispatches ACTIVE_PROFILE_CHANGE_EVENT,
 * so Continue Watching updates without a full page reload.
 */
export default function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    setProfiles(getProfiles());
    setActiveId(getActiveProfileId());
  }, []);

  const onSelect = (id: string) => {
    setActiveProfile(id);
    setActiveId(id);
  };

  if (profiles.length === 0) return null;

  return (
    <div className="profile-switcher" role="listbox" aria-label="Profiles">
      {profiles.map((profile) => {
        const selected = profile.id === activeId;
        return (
          <button
            key={profile.id}
            type="button"
            role="option"
            aria-selected={selected}
            className={
              selected
                ? "profile-switcher__avatar is-active"
                : "profile-switcher__avatar"
            }
            onClick={() => onSelect(profile.id)}
            title={profile.name}
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt={profile.name} />
            ) : (
              <span>{profile.name.slice(0, 1)}</span>
            )}
            <span className="profile-switcher__name">{profile.name}</span>
          </button>
        );
      })}
    </div>
  );
}
