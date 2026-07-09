# Handoff Brief: Offline Support for Notes PWA

## 1. Scope

Build offline support for the existing Next.js 15 note-taking PWA:
- Service worker (via `next-pwa` or hand-rolled `public/sw.js` registered in the root layout) caching app shell + static assets, cache-first for static, network-first for API routes.
- IndexedDB-backed write queue (use `idb` package) that intercepts create/update/delete note operations made while offline and persists them locally.
- On reconnect (`navigator.onLine` + `online` event, cross-checked with a real network probe, not `onLine` alone), replay queued writes against the existing notes API in original order.
- Conflict resolution: if a queued write's `updatedAt`/version no longer matches the server's current value for that note, do NOT silently overwrite. Surface a conflict record (keep both versions) and require explicit UI resolution (see below).
- UI states: a persistent connectivity indicator (offline / syncing / synced / conflict), disabled destructive actions while a note has unresolved conflicts, and a conflict-resolution view (choose local, choose server, or manual merge — manual merge only if trivial to add; otherwise choose-one is sufficient).

**Non-goals — do not touch:**
- Authentication/session logic.
- The notes data model or database schema on the server, beyond adding a version/`updatedAt` field if one does not already exist (see Constraints).
- Any UI unrelated to notes editing/list/sync status (settings, billing, sharing, etc.).
- Push notifications, background sync APIs beyond queue replay, or multi-device real-time collaboration (CRDTs, operational transforms) — last-write-wins-with-conflict-flag is sufficient.
- Test files or CI config for features other than the ones you add.
- Do not upgrade Next.js, React, or any existing dependency version.

## 2. Decision Authority

**Decide alone:** library choice for IndexedDB wrapper (default to `idb` unless one is already present), exact cache-busting/versioning strategy for the service worker, naming of new files/folders (follow existing conventions), exact shape of the conflict UI (modal vs. inline banner), retry/backoff timing for sync.

**Surface as a question in the final report (do not block on it, pick the safer default and flag):** whether notes have a server-side `updatedAt`/version field today (assume yes at field name `updatedAt`; if absent, you added one — flag this as a schema change needing review); whether existing users have data in `localStorage` that must migrate to IndexedDB (assume yes, write a migration, flag for review); whether the app already registers a service worker (assume no; if one exists, flag the collision and describe how you merged them).

## 3. Verification

Before declaring done, run and report exact output of:
- `npm run build` — must succeed with zero errors.
- `npm run lint` — must pass with zero new warnings/errors attributable to your changes.
- `npm test` (or `npm run test` if defined) — all existing tests must still pass; add new tests for the queue (enqueue/dequeue/replay ordering) and conflict detection logic, and they must pass.
- `npm run dev`, then manually verify in a Chromium browser via DevTools: (a) service worker registers (Application tab shows "activated"), (b) toggling Network→Offline lets you create/edit a note and see it queued, (c) toggling back online triggers replay and status changes to "synced", (d) simulate a conflict (edit the same note's server copy via direct API call while offline queue has a pending edit) and confirm the conflict UI appears and both resolution paths work.
- No console errors during the above manual pass.

**Done** = all four checks pass, the manual scenario (a)-(d) is reproducible and described step-by-step in the final report, and no existing functionality (verified by full existing test suite) regressed.

## 4. Constraints

- Dependency policy: only add `idb` (or an equivalent <5kb IndexedDB wrapper) and, if not using hand-rolled SW, `next-pwa`. No other new runtime dependencies without flagging in the report. No new devDependencies beyond testing utilities already in use.
- File conventions: new code under `lib/offline/` (queue, sync, conflict logic) and `components/offline/` (UI). Match existing TypeScript strictness and existing component patterns (check 2-3 existing components before writing new ones).
- Migration safety: any change to note data shape (adding `updatedAt`/version) must be backward-compatible — old notes without the field must be treated as version 0, not crash. Never delete or overwrite existing user data during migration; write new IndexedDB stores additively, migrate `localStorage` data by copying, not moving, until copy is verified.

## 5. Failure Protocol

If a sub-part cannot be completed (e.g., true background sync unsupported in target browsers), ship a working degraded version (e.g., sync-on-focus instead of Background Sync API) and document the gap explicitly in the report — never leave the build broken or tests failing. If forced to stop mid-task, ensure `main`/working branch still builds and all pre-existing tests pass, commit a partial PR with a `WIP:` prefix, and list remaining work as a checklist in the PR description. Never leave the service worker in a state that could cache a broken app shell (test unregister/update path).

## 6. Assumed Context (verify these)

1. **Assumption:** Notes API is REST-ish at `/api/notes` with standard CRUD; confirm actual routes in `app/api/` before wiring the queue.
2. **Assumption:** App uses the App Router (`app/` directory) per Next.js 15 default; confirm no legacy `pages/` router coexists.
3. **Assumption:** Notes are stored per-user with an ID and no field currently marks last-modified time; confirm and add `updatedAt` if missing.
4. **Assumption:** The app is already installable as a PWA (has a manifest) but has no service worker yet; confirm `public/manifest.json` exists and check for any existing `sw.js`.
5. **Assumption:** State management is via React state/fetch, not a global store (Redux/Zustand); if a store exists, the sync status must integrate into it rather than adding a parallel state source.
