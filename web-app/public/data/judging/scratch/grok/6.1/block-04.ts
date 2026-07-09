// Defense line(s):
if (source.supportsByteRange === false) {
  onError?.({
    code: 'MEDIA_ERROR',
    message:
      'Progressive MP4 without byte-range (HTTP 206) will not seek reliably on iOS Safari',
    fatal: false,
    strategy,
  });
}
video.src = source.url;
