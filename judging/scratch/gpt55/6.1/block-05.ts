if (isIOSWebKit() && source.kind === 'mp4' && source.byteRange !== true) {
  throw unsupported('iOS Safari progressive MP4 requires reliable HTTP byte-range/206 support.');
}
