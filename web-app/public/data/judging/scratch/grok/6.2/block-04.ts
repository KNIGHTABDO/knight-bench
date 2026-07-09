const syncer = new SubtitleSyncer();
syncer.parseSRT(srtFileText);

// User taps: subtitle line at 120.0s is spoken at video 125.5s
//            subtitle line at 3600s is spoken at video 3755.2s
syncer.applyAnchors([
  { subtitleTime: 120.0, videoTime: 125.5 },
  { subtitleTime: 3600.0, videoTime: 3755.2 },
]);
// → scale ≈ (3755.2 - 125.5) / (3600 - 120) ≈ 1.0424  (≈ 25/23.976)
// → offset ≈ 125.5 - scale * 120

// During playback:
video.addEventListener("timeupdate", () => {
  const active = syncer.getActiveCues(video.currentTime);
  render(active);
});

// Save:
const corrected = syncer.exportSRT();
