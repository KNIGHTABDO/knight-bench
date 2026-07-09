# Handoff Brief: Next.js 15 PWA Offline Support & Sync

## 1. Scope
**Implement:**
*   **Service Worker:** Register a custom service worker (`public/sw.js`) to cache the App Shell, static assets, and essential routes (`/`, `/notes`) using a cache-first strategy.
*   **IndexedDB Write Queue:** Intercept all write mutations (create, update, delete). If offline, store these operations sequentially in an IndexedDB queue (`pending_writes` store) with timestamps.
*   **Sync Engine:** Trigger synchronization when `navigator.onLine` changes to true. Drain the queue sequentially, sending API requests.
*   **Conflict Resolution:**
    *   Compare client `updatedAt` with server `updatedAt` during sync.
    *   If server is newer, save the local client draft as a new note copy titled `[Original Title] (Offline Copy)` and sync that copy, leaving the server note intact.
    *   Otherwise, overwrite the server version (last-write-wins).
*   **UI Status Indicators:**
    *   Global banner showing network status: `Offline (ReadOnly/Draft Mode)` or `Syncing changes...`.
    *   Per-note status in the editor: `Saved to server`, `Saved offline (pending sync)`, or `Sync error`.

**Non-Goals (Do Not Touch):**
*   Do not modify the backend database schema.
*   Do not modify user authentication routes, middleware, or sessions.
*   Do not implement multi-user real-time collaboration.

## 2. Decision Authority
**Agent Decisions (Make Alone):**
*   Selection of helper libraries for IndexedDB (e.g., `idb` or raw IndexedDB API).
*   Detailed UI styling and placement of status banners/toasts (must align with existing Tailwind design).
*   Service worker caching strategy parameters (e.g., max cache age, max items).

**Escalate/Report (List in Final Report only; do not ask mid-task):**
*   Edge cases where client and server timestamps match exactly but contents differ.
*   If IndexedDB is blocked or unsupported (e.g. Private Browsing mode), how the fallback (e.g. Memory/SessionStorage queue) behaves.
*   Suggestions for API batching if sequential requests exceed acceptable sync latency.

## 3. Verification & Definition of Done
**Measurable Done Criteria:**
1.  **SW Registration:** The Service Worker registers, activates, and intercepts fetches on page reload.
2.  **Offline Persistence:** Simulating offline mode in browser DevTools, edits to notes are saved to IndexedDB and persist through page reload.
3.  **Automatic Sync:** Restoring network connection automatically triggers queue drain and updates the backend database.
4.  **No Data Loss:** Conflicts trigger the creation of a duplicate copy without losing the local edit.
5.  **Build Verification:**
    *   `npm run build` completes successfully.
    *   `npm run lint` passes with no errors or warnings.
    *   `npm run test` (or existing test command) passes.

## 4. Constraints
*   **Dependencies:** Use standard Web APIs (`service-worker`, `CacheStorage`, `IndexedDB`). You may add `idb` (lightweight IndexedDB wrapper) if needed. Do not add heavy service worker libraries (e.g. Workbox) unless already configured.
*   **Conventions:** Put Service Worker in `public/sw.js`. Register it in a client-side component/layout (e.g. `src/components/PWARegister.tsx`).
*   **Migration Safety:** Schema version upgrades for IndexedDB must not corrupt existing client data. Implement robust error boundaries around IndexedDB access.

## 5. Failure Protocol
*   If conflict resolution logic fails to resolve, always save local modifications as a new note copy to prevent data loss.
*   Never leave the main application in a non-compilable state.
*   If an API call fails during sync with a 4xx error (excluding 409/conflict), remove it from the queue and log the failure. If it fails with a 5xx error, retry up to 3 times with exponential backoff before marking it as failed.
*   If unable to complete the sync UI, fallback to a silent sync and output a console warning. Document any partial implementations in the final report.

## 6. Codebase Assumptions (To Verify)
1.  **State Management:** Note editor state uses a global Zustand store or React Context located in `src/store/` or `src/context/` which can be wrapped to handle offline writes.
2.  **API Schema:** Notes are updated via `PATCH /api/notes/[id]` and created via `POST /api/notes`, returning JSON with `updatedAt` properties.
3.  **Next.js Config:** `next.config.js` is set up for standard SSR/Static export without custom bundler overrides.
4.  **Tailwind CSS:** Tailwind is configured and used for styling.
5.  **Tests:** The testing suite uses Vitest/Jest; mocks for network/IndexedDB will be required for unit testing.
