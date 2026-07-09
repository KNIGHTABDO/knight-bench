# Handoff: Offline support (Next.js 15 PWA notes)

Implement offline support: service worker, IndexedDB pending-write queue, reconnect conflict resolution, UI for offline/syncing/conflict. This is your only instruction. Do not expand scope. Do not leave the app broken. Open questions only in the final report (no mid-task asks).

## 1. Scope

### Build
1. **Service worker** — Register SW for app shell + note list/detail offline read. Network-first for note API/data; cache-first or SWR for static assets/shell. After first successful load, open app and show cached notes with network fully off.
2. **IndexedDB pending-write queue** — Enqueue create/update/delete while offline or on network-error API failure. Survive reloads. Drain on reconnect FIFO by enqueue time. Never drop queued ops on restart.
3. **Conflict resolution on reconnect** — Detect server vs local divergence via existing version/etag/`updatedAt`. Default: last-write-wins by timestamp **unless** both sides changed the note since last sync base — then mark **conflict**, no silent overwrite. Conflicted notes stay readable; user chooses local or server (merge only if dual-pane already exists and is trivial).
4. **UI states** — **Offline** banner when `navigator.onLine` is false or equivalent; **Syncing** while queue drains; **Conflict** per-note badge + resolve control on editor/list. Clear chrome when online, queue empty, no unresolved conflicts.

### NON-goals
- Auth redesign, login, or session refresh beyond existing tokens for sync.
- Multi-device realtime collab, CRDTs, OT.
- Background Sync / Push unless already present.
- Schema fields unrelated to versioning/sync metadata.
- Native shells, Electron, non-web targets.
- Offline search indexes; attachment/blob offline (text only unless already cached).
- Analytics, A/B flags, marketing pages.
- Unrelated refactors.
- Cloud CI beyond local verification below.

## 2. Decision authority

**May decide alone:** Workbox vs hand-rolled SW if none exists (prefer repo PWA tooling); IndexedDB wrapper (idb/Dexie) only if no store layer; module placement under existing `lib/`/`features/`; banner placement/styling via existing tokens/components; retry backoff (exponential, cap ≤5 min) for transient online failures.

**Must surface in final report (do not invent product policy):** soft-delete when server rejects delete; timestamp-tie winner (local vs server); conflict UI as modal vs route if neither exists; missing version/`updatedAt`/etag on API (document gap; no silent breaking API); existing SW that conflicts with this plan.

## 3. Verification

Use the repo’s package manager and scripts (do not switch managers):

```bash
# install only if needed — honor existing lockfile
pnpm install   # or npm ci / yarn — match repo
pnpm lint
pnpm typecheck   # or tsc --noEmit if named differently
pnpm test
pnpm build
```

Manual checks (record pass/fail in report):
1. Online load → DevTools offline → open cached note → edit/save (queued) → Offline UI → reconnect → Syncing → note matches server after drain.
2. Divergent local queue + server change → Conflict UI → pick local or server → conflict clears; data matches choice.
3. Reload while offline with pending queue → queue intact; no data loss.
4. Online, empty queue → no Offline/Syncing chrome; no SW registration console errors.

**Done:** checks 1–4 pass; lint/typecheck/test/build green; online create/edit/delete unchanged; queued ops never silently lost; dual-edit conflicts never auto-discard without user choice.

## 4. Constraints

- **Deps:** add only if required; lockfile pins; prefer monorepo packages. No major Next/React bumps. No new global state lib if Context/Zustand/etc. exists — extend it.
- **Layout:** match `app/`, `components/`, `lib/` (or house equivalent). SW registration with existing PWA entry (`next-pwa`, `serwist`, or `public/sw.js`). Module names: offline-queue, sync, conflict (or house names).
- **Migration:** existing notes remain readable. Additive IndexedDB only; versioned upgrades — never wipe stores on prod paths. New sync metadata defaults so pre-offline notes still sync. No migrate-by-delete.
- **Security:** no auth secrets in Cache Storage beyond current practice; queue stays same-origin IndexedDB.

## 5. Failure protocol

If a piece cannot ship: fail closed — online CRUD unchanged; never corrupt server data. Prefer disable offline write + document over half-working silent overwrite. Incomplete: one coherent branch; optional short `OFFLINE_HANDOFF.md` (works / doesn’t / how to test). **Never leave:** broken build or online note CRUD; wiped IndexedDB on load; SW blackscreen (unregister/fallback; revert registration if nav breaks). Report blockers with paths and exact errors.

## 6. Assumptions to verify

Confirm against repo before coding; if false, adapt within Scope; product policy gaps → final report §2.

1. **A1:** Notes CRUD via REST/JSON with per-note `id` and `updatedAt` (or equivalent).
2. **A2:** Next.js 15 App Router; editor is client-side React.
3. **A3:** Manifest exists or is trivial; no prod SW, or SW only precaches shell.
4. **A4:** One active user session per browser profile; no multi-account isolation beyond existing auth.
5. **A5:** Note body is plain text or Markdown string; no OT layer.

## Final report

Files changed; deps added; SW unregister steps; verification summary; A1–A5 true/false; §2 open questions; residual risks.
