"use client";
import { useEffect, useState } from "react";
import { getProfiles, getActiveProfileId, setActiveProfile, subscribeToActiveProfile, type Profile } from "@/lib/profiles";

export default function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setProfiles(getProfiles());
    setActiveId(getActiveProfileId());
    const unsub = subscribeToActiveProfile((id) => setActiveId(id));
    return unsub;
  }, []);

  const onSelect = (id: string) => {
    if (id === activeId) return;
    setActiveProfile(id);
    setActiveId(id);
  };

  return (
    <div className="flex items-center gap-3">
      {profiles.map((p) => {
        const active = p.id === activeId;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            aria-label={`Switch to ${p.name}`}
            aria-current={active ? "true" : undefined}
            className={`relative flex flex-col items-center gap-1.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${active ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
          >
            <span
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white border-2 transition-colors ${active ? "border-white" : "border-transparent"}`}
              style={{ backgroundColor: p.color ?? "#333" }}
            >
              {p.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatarUrl} alt={p.name} className="w-full h-full rounded-full object-cover" />
              ) : (
                p.name.slice(0, 2).toUpperCase()
              )}
            </span>
            <span className={`text-[11px] ${active ? "text-white" : "text-zinc-400"}`}>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
