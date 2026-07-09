video.muted = true; // set before calling play() for any non-gesture-triggered start
video.play().catch((err) => { /* surface a tap-to-play UI instead of silent failure */ });
