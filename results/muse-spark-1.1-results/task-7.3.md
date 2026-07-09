# Critique: localStorage -> IndexedDB Migration Plan

## Flaws

**1. Severity: Critical - Sync vs Async interface mismatch**
Scenario: localStorage is synchronous, IndexedDB is async. Replacing imports 1:1 causes app to get Promise instead of string, or read empty/default. If app then syncs empty state upstream, it overwrites real data (data loss).
Correction: New module must be async (Promise-based). Introduce async storage abstraction and migrate call sites to await. Do not assume same interface.

**2. Severity: Critical - Unverified destructive delete `localStorage.clear()`**
Scenario: Copy to IDB may partially succeed, be aborted, or exceed quota. Code then clears source. On reload IDB is incomplete or empty, source is gone -> permanent data loss. Also `clear()` deletes non-app keys (other libraries, auth).
Correction: Never delete until after full verification (read back all keys + counts/checksum from IDB). Delete only namespaced app keys, not `clear()`. Keep source for N releases or mark deleted lazily, behind flag.

**3. Severity: Critical - Non-idempotent / incorrect "IDB empty" check**
Scenario: Migration crashes after writing 50% of keys (tab closed, quota, transaction timeout on 5MB). Next load IDB is non-empty, so plan skips migration. User loses 50% of notes permanently.
Correction: Use explicit migration state marker: `migrationStatus={not-started|in-progress|done}` stored in both storages + version. If in-progress or hash mismatch, restart/resume. Copy key-by-key with verification, not all-or-nothing empty check.

**4. Severity: Critical - No fallback if IndexedDB unavailable -> bricked app**
Scenario: Safari private mode, storage blocked by policy, Firefox container, IDB open blocked/version upgrade blocked, quota. 40k users include these. Plan deletes old path, so app has no storage.
Correction: Keep localStorage module permanently as fallback. Feature-detect IDB open. If open fails, stay on localStorage, log, retry migration later. App must boot with fallback.

**5. Severity: Major - Multi-tab race condition**
Scenario: User has 2 tabs open. Both see IDB empty, both start copy, both clear localStorage, interleaved writes/overwrites. Results in partial or corrupt state.
Correction: Acquire cross-tab lock via `navigator.locks` or localStorage mutex + BroadcastChannel. Only one migrator runs.

**6. Severity: Major - Big-bang replace + read-before-migrate (order)**
Scenario: Plan replaces all usages to read IDB before migration runs on boot. First render reads empty IDB, shows empty notes, may autosave empty state to IDB/cloud -> clobbers real data.
Correction: Implement IDB module alongside old one. On boot: block app storage reads until migration decides source of truth. Keep old reads primary until migration verified, or use dual-read wrapper that prefers localStorage if not migrated.

**7. Severity: Major - Old module deleted, no rollback**
Scenario: Bug in IDB path discovered at 10% rollout. No way to rollback without code revert and data already cleared. Unrecoverable.
Correction: Keep both modules for at least 2-3 releases behind feature flag. Rollout flagged/canary 1%->100% with kill switch. Only delete old code after telemetry shows >99% success and grace period passed.

**8. Severity: Major - No verification, telemetry, error handling**
Scenario: QuotaExceededError on 5MB user, transaction abort, corrupted data silently accepted. With 40k WAU you won't know failure rate.
Correction: Wrap each IDB operation in try/catch, handle QuotaExceeded, transaction abort. Batch writes (chunk 500KB) to avoid long tx timeout & main-thread jank. Verify byte counts, log success/failure metrics.

**9. Severity: Minor - Copies all localStorage keys unfiltered**
Scenario: Copies auth tokens / third-party keys bloating IDB and causing privacy/compliance issues.
Correction: Migrate only allowlisted app namespace/prefix.

What was okay: Intent of #1 (create dedicated idb-storage module) is correct.

## Corrected Plan

1. Keep localStorage module. Add new async `idb-storage.ts` with async API, feature detection, quota/batch handling. Add `storage.ts` facade that routes to IDB if migrated else localStorage.

2. Implement `migrate.ts` with states (`not-started/in-progress/done/failed`) persisted, cross-tab lock (`navigator.locks` fallback), allowlist of keys, chunked copy (e.g., 100 keys or 500KB per transaction), and read-back verification (count + hash).

3. App boot: facade waits for migrator. If not migrated: acquire lock, try IDB open; if IDB unavailable -> stay on localStorage and skip. Else copy keys idempotently; after each batch verify.

4. Only after full verification, set `migrationDone=true` in IDB and localStorage, switch facade primary to IDB with fallback to localStorage. Do NOT clear localStorage.

5. Update call sites incrementally to await facade, behind feature flag `useIDB`. Dual-write during transition period (write to both, read from IDB if done).

6. Ship flagged off, enable canary 1% -> 10% -> 100% with telemetry: success rate, duration, quota errors, fallback rate. Keep kill switch to revert to localStorage.

7. Retain localStorage data for 2-3 releases / 14-30 days. Then lazily delete only migrated app keys after grace period, never `clear()`.

8. After stable, delete legacy import paths but keep fallback adapter in codebase.
