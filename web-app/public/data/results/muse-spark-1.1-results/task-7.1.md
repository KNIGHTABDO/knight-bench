# Offline Support Handoff — Next.js 15 PWA Notes

## 1. Scope

Exactly build:
- **Service Worker:** `public/sw.js`. Precache shell: `/`, `/offline`, `/_next/static/*`. Runtime: `GET /api/notes*` NetworkFirst (5s timeout) -> cache fallback; images CacheFirst (max 60); navigation NetworkFirst -> `/offline`. Versioned caches, delete old on activate. Registration in `src/lib/pwa/registerSW.ts`, invoked from client component in `app/layout.tsx`.
- **IndexedDB Queue:** DB `notes-offline` v1 via `idb`. Stores: `pendingOps` {key autoInc, id, opType: 'create'|'update'|'delete', payload, baseUpdatedAt, clientTs, attempts}, `notesCache`, `conflicts`. All write paths (create/update/delete) must intercept fetch failure/offline and enqueue; queue must persist reload/close.
- **Sync on Reconnect:** Trigger on `window.online` + `visibilitychange` to visible + interval 30s if queue non-empty. FIFO flush. Fetch `existing /api/notes` endpoints only. Retry with backoff 1s,2s,4s,8s,16s (max 5). Do not drop ops on 5xx.
- **Conflict Resolution:** Conflict if server `updatedAt > baseUpdatedAt` or 409. On conflict: move to `conflicts` store with {serverVersion, localVersion}, keep queue op paused. UI actions: `useServer`, `useLocalForce` (PUT `?force=true` or header `x-force:1` after confirming API), `merge` (open editor with both). Resolution removes conflict and dequeues.
- **UI States:** Hook `src/hooks/useOfflineStatus.ts` -> `{isOffline, isSyncing, pendingCount, conflicts[]}`. Component `src/components/pwa/OfflineIndicator.tsx` in header: offline=gray dot "Offline", syncing=yellow spinner "Syncing N", conflict=red "N conflicts". Note row shows cloud-off icon if pending, editor banner for offline/conflict with aria-live polite.

NON-Goals — DO NOT TOUCH:
- Auth, billing, `/api/auth/*`, middleware.ts auth logic.
- Server DB schema; no new backend routes/tables. If force param missing, surface question, do not create new route.
- Tiptap/editor package upgrade or markdown serialization.
- `next.config.js` except pwa header for SW; no Dockerfile, Vercel config, env.
- Background Sync API, Periodic Sync, Push, Notifications.
- Deleting or re-keying existing `localStorage` or IndexedDB data.

## 2. Decision Authority

May decide alone:
- Internal file names inside `src/lib/offline/*`, variable names, Tailwind classes.
- Exact badge copy (max 3 words), icon set (use lucide existing).
- Cache max age ±50%, IDB wrapper choice within constraint.
- Test placement/co-location.

Must surface in final REPORT.md as Questions (cannot ask mid-task, must pick best spec-compliant path now):
- Existing SW or `next-pwa` found? What you did.
- API missing `updatedAt`/409/force support? Fallback used.
- QuotaExceeded handling chosen.
- Any §6 assumption false.
- Any scope trimmed.

## 3. Verification

Commands (all must pass):
```
npm run lint
npm run typecheck
npm run build
npm test -- offline
```

Manual proof (log results in REPORT.md):
1. DevTools offline: create note -> reload -> still visible, `pendingOps` count 1 in IDB.
2. Online: queue flushes, pendingCount 0, network PUT/POST observed.
3. Conflict: offline edit note A, while offline change A on server via curl to newer updatedAt, go online -> conflict badge red, diff shows both.
4. Offline navigation to `/` serves shell; `/notes` falls back to cache.

Done = measurably: SW registers in production build, passes 1-4, unit tests for queue/conflict + integration for `useOfflineStatus`, no console throws on 3x offline toggle, pending ops survive reload.

## 4. Constraints

- Deps: No server deps. Client only `idb@^7.1.0` allowed pre-approved. `workbox-window ^7.1.0` allowed if justified; pin exact. No localForage, no zustand/jotai addition.
- Files: SW at `public/`. Logic `src/lib/offline/db.ts, queue.ts, sync.ts, conflicts.ts`. PWA `src/lib/pwa/*`. Hooks `src/hooks/*`. UI `src/components/pwa/*`. Follow existing ts alias `@/*`.
- Migration safety: One-time import from `localStorage.getItem('notes-draft')` if present -> to IDB; set flag `lsMigrated` in IDB, never delete LS key. IDB upgrades additive only, wrapped try/catch, keep queue on error. Never wipe `notesCache` without explicit user action.
- Limits: Queue capped 100 ops; exceed -> block edit with error toast "Offline limit reached — go online". SW fetch handler must not cache POST/PUT/DELETE.

## 5. Failure Protocol

- Never leave: build failing, auth broken, existing notes unreadable, or SW serving stale auth responses.
- If blocked: feature-flag `process.env.NEXT_PUBLIC_ENABLE_OFFLINE !== 'false'` to disable registration. Keep `npm run build` green.
- Partial PR allowed: include REPORT.md checklist (done/todo), reproduce steps, skipped tests marked `// TODO OFFLINE: reason`. Do not fake pass with mocks that bypass queue logic.
- If conflict UI incomplete, ship detection only (never auto-delete server or local); disable force button with message "Update available — manual copy required".

## 6. Context — 5 Load-Bearing Facts (Assumptions to Verify)

1. ASSUMPTION TO VERIFY: App Router Next 15, api at `src/app/api/notes/route.ts` and `[id]/route.ts`, returning `{id,title,content,updatedAt:string}`; concurrency via updatedAt check returning 409.
2. ASSUMPTION TO VERIFY: No SW currently; no `next-pwa` config; static assets in `public/`.
3. ASSUMPTION TO VERIFY: Clerk for auth, single-user notes, no shared/collaborative notes — conflicts only self-device vs server.
4. ASSUMPTION TO VERIFY: Current offline handling none; drafts only in `localStorage 'notes-draft'`; no IndexedDB yet.
5. ASSUMPTION TO VERIFY: Product expects offline-first create/edit/delete preserved as intent; if note deleted server-side while offline edited, must surface conflict not silent drop.

If any false, implement minimal adaptation and log under "Assumption Violations" in final report.
