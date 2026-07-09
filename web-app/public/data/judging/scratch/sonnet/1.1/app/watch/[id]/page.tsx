"use client";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Player from "../../../components/Player";
import { usePlayer } from "../../../hooks/usePlayer";
import { getActiveProfileId, onProfileChange } from "../../../lib/profiles";

export default function WatchPage() {
  const params = useParams<{ id: string }>();
  const titleId = Array.isArray(params.id) ? params.id[0] : params.id;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    setProfileId(getActiveProfileId());
    return onProfileChange(setProfileId);
  }, []);

  const { progress, seek, play, pause } = usePlayer(videoRef, {
    profileId,
    titleId,
  });

  return (
    <div>
      {/* Assumption: Player.tsx forwards `ref` to its internal <video>
          element -- see PLAN ambiguity notes. */}
      <Player
        ref={videoRef}
        src={`/api/stream/${titleId}`}
        subtitles={[]}
        onProgress={() => {
          /* usePlayer already listens to the underlying video's
             timeupdate event directly via videoRef; this callback is
             left as a no-op passthrough to preserve Player's existing
             prop contract. */
        }}
      />
    </div>
  );
}
