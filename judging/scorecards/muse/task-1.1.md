SCORE: 9 (FINAL)
AUTO_CHECKS: 6/6, failures: none
BAND_JUSTIFICATION:
All 7–8 band requirements are met with mechanical confirmation: the scaffold compile passed (`npx tsc --noEmit` exit 0), storage is IndexedDB-only, the Continue Watching row is a client island fed titles by the server page, and profile switching swaps contents without reload via "knight:active-profile-change" CustomEvent plus a storage-event subscription. The throttle is leading+trailing ("Implement leading write immediate, then throttled with trailing timeout (5s)") with a flush on pause, visibilitychange, pagehide, beforeunload, and unmount — which is exactly the 9–10 band's "unload mid-throttle-window loses progress" edge. The schema is versioned with an in-place index upgrade path in `onupgradeneeded`, and the ambiguity analysis (progress metric undefined, server-SQLite vs client-IDB metadata mismatch) catches real risks beyond the prompt. Held at 9 rather than 10 because the plan does not address progress records for deleted profiles and DB_VERSION never advances past 1, so the upgrade path is only exercised defensively.
UNVERIFIED_CLAIMS: none beyond claims not testable from task materials
RED_FLAGS: none
