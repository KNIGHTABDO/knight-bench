SCORE: 9 (FINAL)
AUTO_CHECKS: 5/5, failures: none
BAND_JUSTIFICATION:
Executed in Node against a six-assertion harness and every behavior passed: basic debounce collapses to the last call, `this` and arguments are preserved via `fn.apply(ctx, args)`, flush with a pending call fires immediately with the last args and does not double-fire afterward, flush with nothing pending is a no-op, and cancel-then-call works normally. The code is 14 lines (well inside the 30-line budget, into the 9–10 "≤20 lines" band), raw with zero prose or comments as instructed, and it clears state (`timer=null;args=ctx=null`) — flush nulls timer before invoking, avoiding reentrancy bugs. Held at 9 rather than 10 only because flush invokes `fn` before nulling `args/ctx` (it clears the timer first but reads args at apply-time), so a reentrant call from within `fn` during flush would see stale args for one tick — a theoretical edge the very top band would sequence more defensively.
UNVERIFIED_CLAIMS: none
RED_FLAGS: none
