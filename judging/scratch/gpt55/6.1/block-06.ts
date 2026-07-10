if (
  isIOSWebKit() &&
  source.kind === 'hls' &&
  source.usesByteRangeSegments &&
  source.byteRange !== true
) {
  throw unsupported('This HLS playlist uses byte-range segments, but byte-range support is not confirmed.');
}
