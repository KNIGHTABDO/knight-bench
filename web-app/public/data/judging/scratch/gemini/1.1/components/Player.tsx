import React, { forwardRef } from 'react';

interface PlayerProps {
  src: string;
  subtitles?: string;
  onProgress?: (progress: number) => void;
}

const Player = forwardRef<HTMLVideoElement, PlayerProps>(
  ({ src, subtitles, onProgress }, ref) => {
    return (
      <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-lg border border-gray-800">
        <video
          ref={ref}
          src={src}
          controls
          className="w-full h-full"
          onTimeUpdate={(e) => {
            const video = e.currentTarget;
            if (video.duration) {
              const progress = video.currentTime / video.duration;
              onProgress?.(progress);
            }
          }}
        >
          {subtitles && (
            <track
              src={subtitles}
              kind="subtitles"
              srcLang="en"
              label="English"
              default
            />
          )}
        </video>
      </div>
    );
  }
);

Player.displayName = 'Player';
export default Player;
