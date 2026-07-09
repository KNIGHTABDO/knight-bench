// Defense line(s):
if (mutedAutoplay) {
  video.muted = true;
  video.setAttribute('muted', '');
}
const p = video.play();
