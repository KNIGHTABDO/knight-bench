# Critique: localStorage → IndexedDB migration plan

## What is fine

- **Directionally using IndexedDB** for multi‑MB notes is correct; localStorage is a poor long‑term store at that size.
- **Introducing a dedicated storage module** with a single abstraction is the right place to hide backend differences.
- **Migrating on (or before) first use after deploy** is the right *window*; the bugs are in *how* emptiness is detected, when source data is destroyed, and sync vs async.

Everything below is a production flaw in the stated plan.

---

## Flaws

### 1. Clearing localStorage before verified durable migration
- **Severity:** Critical  
- **Scenario:** Copy throws mid‑way (quota, abort, tab kill, IDB transaction failure, browser crash). Plan still implies “copy then `clear()`.” Even a “successful” write can fail verification if only `put` is awaited and read‑back is skipped. `localStorage.clear()` then destroys the only remaining copy. ~40k WAUs; a small failure rate is mass user data loss.  
- **Correction:** Migrate inside an explicit multi‑step protocol: (1) snapshot keys/values, (2) write to IDB in a transaction, (3) **read back and checksum/compare every key**, (4) set a durable `migrationComplete` marker in IDB, (5) only then delete **known app keys** from localStorage (never blind `clear()`). On any mismatch, leave localStorage intact and retry next load.

### 2. “If IndexedDB is empty” is a wrong migration gate
- **Severity:** Critical  
- **Scenario A:** App boot (or a racey import) writes default/empty structures into IDB *before* migration runs → IDB is non‑empty → migration skipped → app reads empty/defaults; localStorage still has real notes (orphaned until something clears it, or forever invisible).  
- **Scenario B:** Partial prior migration left some keys in IDB → gate says “not empty” → remaining localStorage keys never migrate.  
- **Scenario C:** User already has unrelated IDB data from another feature/library on the same origin → migration never runs.  
- **Correction:** Gate on an explicit, versioned flag (e.g. `storageSchemaVersion` / `lsToIdbMigrated: v1`), not emptiness. If flag absent and localStorage has app keys → run migration regardless of whether IDB already has rows.

### 3. Async IndexedDB cannot share a true localStorage interface
- **Severity:** Critical  
- **Scenario:** localStorage APIs are synchronous (`getItem` returns a string immediately). IndexedDB is async. “Same interface” either (a) lies and leaves callers with unresolved Promises / empty reads, or (b) forces a sync façade (impossible correctly without blocking hacks). Any code that does `const notes = storage.get('notes'); JSON.parse(notes)` on load races migration and first paint: UI renders empty, autosave writes empty over real data, or crash on Promise-as-string.  
- **Correction:** Make the storage API explicitly async (`async get/set/remove/keys`). Audit and convert **all** call sites. Boot sequence: `await migrateIfNeeded()` then `await hydrateFromStorage()` **before** mounting UI that depends on user data. No sync pretence.

### 4. Migration vs app read/write race on first load after ship
- **Severity:** Critical  
- **Scenario:** Step 2 replaces imports so the app only talks to IDB. Step 3 migrates “on app load” but does not require migration to finish before reads/writes. First session: app reads empty IDB, user sees blank notes, autosave persists empty, then migration may overwrite IDB with localStorage *or* lose because empty IDB write already “won,” or migration runs after empty write and overwrites user edits with old localStorage.  
- **Correction:** Single boot barrier: block data‑dependent app start until migration + initial hydrate complete. While migrating, reject or queue non‑migration writes (or dual‑write only after source of truth is chosen).

### 5. Multi‑tab / multi‑window races
- **Severity:** Critical  
- **Scenario:** User has two tabs open. Both see “not migrated.” Both copy localStorage → IDB; one clears localStorage while the other is mid‑read or still writing notes to localStorage; one tab’s in‑memory state is stale and writes empty/partial data after the other finished. Result: lost notes or flip‑flopping state.  
- **Correction:** Cross‑tab lock (e.g. `navigator.locks` with Web Lock API, or a careful `localStorage` lock + expiry + tab id). Only one migrator. Other tabs wait on `storage`/`BroadcastChannel` for “migration done” then open IDB. After cutover, all tabs use the same IDB + broadcast invalidation for writes.

### 6. `localStorage.clear()` is overly broad and destructive
- **Severity:** Critical (same‑origin collateral) / Major (app‑only if keys are namespaced—but plan says `clear()`)  
- **Scenario:** Same origin holds auth tokens, feature flags, other products’ keys, third‑party SDKs, A/B assignments. `clear()` wipes them → forced logouts, broken billing widgets, lost prefs outside “notes.”  
- **Correction:** Delete only keys you own and successfully migrated (allowlist / known prefix). Never `clear()`.

### 7. No dual‑read / dual‑write safety window; hard cutover + delete old module
- **Severity:** Major  
- **Scenario:** Bug in IDB module or migration ships to 100% traffic. Old module is deleted; no path back to localStorage. Users with failed/partial migration or browsers where IDB is flaky have no recovery. Rollback of the release does not restore already‑cleared localStorage.  
- **Correction:** Phased rollout: (1) ship IDB writer that dual‑writes and migrates without deleting localStorage; (2) dual‑read with IDB preferred after verified migrate; (3) monitor error rates / support tickets; (4) stop writing localStorage; (5) delete migrated keys after N days or remote kill‑switch; keep code path to re‑hydrate from backup keys until metrics are clean. Feature‑flag the cutover.

### 8. “No fallback needed” is false in production
- **Severity:** Major  
- **Scenario:** Private/incognito modes, enterprise policies, storage disabled, full disk / quota, Safari quirks, embedded WebViews, older browsers still in a long tail of 40k WAU. If IDB open fails after localStorage was cleared (or was never readable), app is bricked for that user.  
- **Correction:** Capability detect at startup. If IDB unavailable: keep localStorage path (or in‑memory + warn). Never clear localStorage unless IDB open + verified write succeeded. Surface a non‑destructive error instead of silent empty state.

### 9. Quota / large payload failures (up to 5MB notes)
- **Severity:** Major  
- **Scenario:** Single large `put` or many keys push against origin quota (especially mobile, low‑storage devices, shared origin usage). Migration throws; if anything still clears localStorage, data is gone. Even without clear, user stuck retrying every load.  
- **Correction:** Handle `QuotaExceededError` explicitly; do not delete source data; optionally migrate key‑by‑key with progress; consider compressing or chunking large note blobs; log/metric failures; show user‑visible recovery guidance if stuck.

### 10. No transactional integrity across the full migration
- **Severity:** Major  
- **Scenario:** Keys migrated one‑by‑one without an all‑or‑nothing strategy + marker. Failure after key 3 of 20 leaves split brain. Next load “IDB not empty” skips rest (interacts with flaw #2).  
- **Correction:** Write all records, verify, then set `migrated=v1` in the **same** IDB database (marker last). Treat absence of marker as “migration incomplete” even if some keys exist; resume or re‑copy from localStorage while it still exists.

### 11. Key/value semantics and non‑app keys
- **Severity:** Major  
- **Scenario:** “Copy all localStorage keys” copies foreign keys into IDB and may later treat them as app state; or app only expects a subset and string values—IDB structured clone of already‑stringified JSON causes double‑encoding when one path parses and another doesn’t. Inconsistent serialization → corrupt notes on read.  
- **Correction:** Migrate only app‑namespaced keys. Preserve exact string values as stored in localStorage (byte‑for‑byte / string‑identical) for v1 so parsers stay unchanged; document encoding once in the storage module.

### 12. Direct `localStorage` usage bypasses the module swap
- **Severity:** Major  
- **Scenario:** Plan only “replace imports of localStorage-module.” Any raw `window.localStorage` access (legacy files, analytics, dynamic import, extension points) keeps writing to LS after cutover → split brain, or user data never migrates.  
- **Correction:** Repo‑wide ban/grep for raw `localStorage` / `sessionStorage` misuse; CI check; migrate or deliberately exclude those keys from the migration allowlist with documented owners.

### 13. Main‑thread jank and timeout risk on large copies
- **Severity:** Minor–Major (Major if it causes users to kill the tab mid‑migration)  
- **Scenario:** 5MB notes + many keys copied on main thread freezes UI; user force‑closes tab mid‑migration → partial state (see #1/#10).  
- **Correction:** Async IDB transactions; yield/progress UI (“Upgrading storage…”); keep source until verify; optional chunked writes.

### 14. No IDB schema versioning / upgrade path
- **Severity:** Minor (becomes Major on second schema change)  
- **Scenario:** First ship uses ad‑hoc object store; later change renames stores without `onupgradeneeded` handling → open fails or data invisible.  
- **Correction:** Versioned `openDB(name, version)` with upgrade migrations from day one; store user data under stable store names.

### 15. Observability and support blind spot
- **Severity:** Major (operational)  
- **Scenario:** Silent migration failures at 1% of 40k WAU ≈ hundreds of users. No counters for migrate success/fail, verify mismatch, quota errors, multi‑tab lock timeouts → you learn from angry tickets after localStorage is gone.  
- **Correction:** Metrics + error reporting on every migration outcome; retain enough diagnostics (key counts, total bytes, schema version) without shipping note contents to logs.

### 16. SSR / non‑browser contexts (if applicable)
- **Severity:** Minor–Major depending on stack  
- **Scenario:** Module imports IDB at top level; SSR or tests crash; or server renders empty and client hydrates wrong.  
- **Correction:** Lazy‑open IDB only in browser; storage init in client boot only.

---

## Corrected plan

1. **Define async storage interface** (get/set/remove/keys/getAll) and an IDB implementation with versioned DB/schema; keep a localStorage implementation behind the same async interface for fallback and dual‑write.
2. **Inventory app keys** (prefix/allowlist); forbid raw `localStorage` via audit/CI; fix all call sites to `await` storage and to boot only after `await storage.initialize()`.
3. **Implement migration gated by schema flag** (`ls→idb v1` absent + allowlisted LS keys present), under a cross‑tab lock: copy allowlisted keys → IDB transaction → **read‑back verify** → set migrated flag → only then remove those LS keys (never `clear()`). On failure, leave LS untouched and report metrics.
4. **Boot order:** open storage → migrate if needed → hydrate → then render data UI; queue or block writes during migrate; BroadcastChannel/lock so other tabs reattach after migrate.
5. **Ship in phases with feature flags:** dual‑write + migrate without delete → verify metrics → prefer IDB reads → stop LS writes → delete migrated keys → remove LS backend only after fallback window; keep IDB failure path that does not destroy LS.
6. **Add quota/error handling, progress UI for large profiles, and dashboards** for migrate success/fail/verify mismatch before 100% cutover.

---

## Mapping: original steps

| Original | Verdict |
|----------|---------|
| 1. New IDB module, “same interface” | Partially fine; must be **async**, not sync‑compatible by wish. |
| 2. Replace all imports | Necessary but insufficient without boot barrier, raw‑LS audit, and call‑site async conversion. |
| 3. If IDB empty → copy → `clear()` | **Reject entirely** — wrong gate, unsafe clear, no verify, no multi‑tab safety. |
| 4. Delete old module | Only after phased cutover + monitoring; not on first ship. |
| 5. Ship; no fallback | Unsafe for 40k WAU and multi‑MB payloads; needs fallback and staged rollout. |
