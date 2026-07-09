    if (mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && source.type === 'mp4') {
      fetch(source.url, { method: 'HEAD' }).then(res => {
        if (res.headers.get('Accept-Ranges') !== 'bytes') {
          console.error('iOS Playback Stall Warning: Server hosting MP4 does not support HTTP 206 Range Requests.');
        }
      }).catch(() => {});
    }
    