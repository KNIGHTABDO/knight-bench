SCORE: 8 (FINAL)
AUTO_CHECKS: 5/5, failures: none
BAND_JUSTIFICATION: This is a complete 7-8 implementation: affine correction, least-squares support, re-sorting, malformed-input handling, negative-time clamping, and overlap-aware binary search all appear and compile. The output explains that active-cue lookup is `O(log n + k)` and preserves legal overlaps instead of silently destroying them. Nine test cases are included and the TypeScript scaffold passes. It misses 9-10 because it does not provide a concrete 1000/1001 framerate table or a stateful monotonic-playback pointer.
UNVERIFIED_CLAIMS: Real subtitle corpus behavior and renderer-specific overlap policy.
RED_FLAGS: none
