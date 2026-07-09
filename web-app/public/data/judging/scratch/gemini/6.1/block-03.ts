    if (error.name === 'NotAllowedError') {
      video.muted = true;
      await video.play();
    }
    