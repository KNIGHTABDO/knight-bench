// Defense line(s) — ensureInlinePlaybackAttributes():
video.setAttribute('playsinline', 'true');
video.setAttribute('webkit-playsinline', 'true');
(video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
