# Handoff Brief: Offline Support for Next.js 15 PWA Notes

## 1. Scope
Build offline support for the existing Next.js 15 PWA note-taking app:
- Register and ship a production-safe service worker that precaches the app shell and runtime-caches safe static assets.
- Add IndexedDB-backed persistence for notes needed while offline.
- Queue pending create/update/delete writes when offline or when server writes fail due to network loss.
- Replay queued writes on reconnect with retry/backoff and idempotency protection.
- Detect server/local conflicts during replay and expose conflict UI allowing keep local, keep remote, or merge manually.
- Add visible UI states for offline, syncing, synced, failed sync, and conflict.
- Preserve existing online behavior and server API contract unless a minimal additive field is required for conflict detection.

NON-goals:
- Do not redesign the app, navigation, editor, auth, or API architecture.
- Do not replace the database, ORM, auth provider, styling system, or state-management library.
- Do not add collaborative real-time editing.
- Do not introduce push notifications or background periodic sync unless already present.
- Do not delete or rewrite existing notes, migrations, tests, or app routes unrelated to offline behavior.

## 2. Decision Authority
You may decide alone:
- IndexedDB wrapper shape, store names, queue schema, and internal service names.
- Service-worker registration location and cache names.
- Conservative runtime caching rules for static assets and GET note reads.
- UI copy for offline/syncing/conflict states, keeping it concise.
- Test structure and helper utilities.

You must surface in the final report, not mid-task:
- Any API/schema field you add for conflict detection, such as `updatedAt`, `version`, or `clientMutationId`.
- Any behavior that may alter last-write-wins semantics.
- Any browser limitation that prevents full automation of a verification step.
- Any assumption below that proved false and how you adapted.

## 3. Verification
Before declaring done, run exactly these checks from the repo root, substituting the package manager already used by the project:
- Install check if needed: `npm install` / `pnpm install` / `yarn install` only when dependencies changed or lockfile is missing.
- Static checks: existing lint command, usually `npm run lint`.
- Type checks: existing typecheck command if present, otherwise `npx tsc --noEmit`.
- Unit tests: existing test command if present.
- Production build: existing build command, usually `npm run build`.
- Manual PWA check in a production build: start the built app, load it in Chromium, verify service worker registration, reload offline, create/edit/delete a note offline, reconnect, and confirm the queued write reaches the server.
- Conflict check: simulate same note changed remotely and locally while offline, reconnect, and verify conflict UI blocks silent overwrite until the user chooses a resolution.

Done means: all automated checks pass; no uncaught console errors in the manual flow; offline reload shows the notes shell; queued writes survive page reload; queue drains after reconnect; conflicts are visible and resolvable; existing online CRUD still works.

## 4. Constraints
Dependency policy:
- Prefer built-in browser APIs and existing project dependencies.
- Add a small IndexedDB helper only if the project has no suitable abstraction; justify it in the final report.
- Do not add a heavyweight offline framework unless the app already uses it.

File/folder conventions:
- Follow existing `app/`, `components/`, `lib/`, `hooks/`, and `public/` conventions.
- Put the service worker under `public/` unless the project already has a worker build pipeline.
- Put IndexedDB, queue, sync, and conflict utilities under the existing client-side library area.

Migration safety:
- Existing user data must remain readable without manual migration.
- Any schema/API change must be additive and backward-compatible.
- IndexedDB version upgrades must be monotonic, guarded, and non-destructive.
- Never clear all IndexedDB, localStorage, cookies, or server notes as part of normal operation or tests.

## 5. Failure Protocol
If you cannot complete everything, leave a partial PR that still builds and preserves current online behavior. Gate incomplete offline UI behind a disabled code path or feature flag; do not leave broken service-worker registration, infinite sync loops, destructive migrations, or swallowed write failures. Add clear TODO comments only at exact incomplete points. In the final report, list completed work, skipped work, failed verification commands with output summary, and the smallest next step.

## 6. Assumptions To Verify
- Assumption 1: The app uses the Next.js App Router with client components for the note editor and list.
- Assumption 2: Notes have `id`, `title`, `content`, `createdAt`, and `updatedAt`; if no version field exists, `updatedAt` can support conflict detection.
- Assumption 3: Auth already exists and note API routes scope reads/writes to the current user.
- Assumption 4: The product supports single-user note editing; conflicts are cross-device or stale-tab conflicts, not multi-cursor collaboration.
- Assumption 5: The app is already installable as a PWA or has a manifest; this task adds reliable offline behavior, not branding changes.
