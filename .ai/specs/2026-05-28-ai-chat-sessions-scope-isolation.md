# AI Chat Sessions — Tenant/Org Scope Isolation

## TLDR

**Key Points:**
- `AiChatSessions` persists chat session metadata in `localStorage` under a global, unscoped key (`om-ai-chat-sessions-v1`), causing stale sessions from a previous tenant/org to flash in the dock after a scope switch.
- A second compounding bug: `useAiChat.hydrateFromServer()` does not distinguish a `404` response from a network error — it falls through to `importAiLocalConversation()`, which can **silently import conversations from tenant A onto tenant B's server**.
- Fix: (A) scope the storage key per `tenantId+organizationId` using the existing `organizationEvents` infrastructure; (B) propagate the `404` signal from `loadAiServerTranscript` and short-circuit the import path.

**Scope:**
- `packages/ui/src/ai/AiChatSessions.tsx` — scoped storage key + reactive scope reset
- `packages/ui/src/ai/conversation-store.ts` — expose 404 vs. network-error distinction
- `packages/ui/src/ai/useAiChat.ts` — handle `notFound` from transcript load; add `onConversationNotFound` callback
- `packages/ui/src/ai/AiChat.tsx` — forward `onConversationNotFound` prop
- `packages/ui/src/ai/AiDock.tsx` — wire `onConversationNotFound` to `closeSession`
- Unit tests for all five changed files

**Concerns:**
- The cross-tenant import bug (Problem B) is a **data isolation regression** introduced alongside PR #2023 (conversation sharing). Even though server-side ACL correctly rejects cross-scope requests at read time, the import call creates a new server-side record under the new scope with the previous scope's message content.
- Legacy unscoped `localStorage` entries are **intentionally not migrated** (origin scope is unknown); users lose local-only history that was never synced to the server.

---

## Overview

The AI dock's multi-tab session panel (`AiChatSessionsProvider`) was built before tenant/org switching became a first-class operation. Its session registry is stored under a single, app-global `localStorage` key (`om-ai-chat-sessions-v1`). When a superadmin or multi-org user switches scope via the topbar, the provider re-mounts with the same stale registry — surfacing the previous scope's tab names, last-message timestamps, and (briefly) full transcripts before the server responds with `404`.

The open-source ecosystem (e.g., Linear, Notion) universally scopes client-side caches per workspace identity. This spec aligns Open Mercato with that expectation and eliminates the secondary cross-tenant data leak.

> **Market Reference**: Linear and Notion both namespace their `localStorage` workspaces by team/workspace slug. We adopt the `tenantId:organizationId` compound key, which is already the canonical scope identifier used by `DataTable` and `BackendChromeProvider` via `organizationEvents.ts`.

---

## Problem Statement

### Problem A — Stale session flash after scope switch

`AiChatSessionsProvider` initializes state synchronously from `localStorage` in a `useState` lazy initializer (line 197 of `AiChatSessions.tsx`). Because the storage key is global, the first render after a scope change shows the previous scope's sessions until the server list response overwrites them. For superadmins switching between tenants on shared machines, this means session titles and participant names from other tenants are briefly visible.

### Problem B — Cross-tenant conversation import

When the dock mounts in the new scope with an old `conversationId`, `hydrateFromServer()` in `useAiChat.ts` calls `loadAiServerTranscript()`. The function returns `null` for **any** non-2xx response — including `404`. The caller cannot distinguish "conversation not found in this scope" from "network error". When transcript is `null` and local messages exist, the code proceeds to `importAiLocalConversation()`, which **POSTs the previous scope's messages to the new scope's server** under the same `conversationId`. The server creates a new conversation record on the new tenant — a cross-tenant data write that server-side ACL does not prevent because the request is authenticated and scoped to the current session.

---

## Proposed Solution

### Solution A — Scoped `localStorage` key in `AiChatSessions`

Use `getCurrentOrganizationScope()` from the existing `@open-mercato/shared/lib/frontend/organizationEvents` module to derive a scoped key at mount time. Subscribe to `subscribeOrganizationScopeChanged` inside the provider to reset state and re-fetch from the server when scope changes.

```
om-ai-chat-sessions-v1                    ← legacy (abandoned, not migrated)
om-ai-chat-sessions-v1:tenantA:org1       ← new scoped key (tenantId:organizationId)
om-ai-chat-sessions-v1:no-tenant:no-org   ← fallback when scope not yet resolved
```

The provider's server sync effect (`listAiServerConversations`) gains `storageKey` as a dependency so it re-fires on scope change.

### Solution B — 404 detection in `conversation-store` + self-healing in `useAiChat`

`loadAiServerTranscript` is updated to return a discriminated union:

```typescript
type LoadTranscriptResult =
  | { ok: true; data: AiServerTranscriptResponse }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false }
```

`hydrateFromServer` in `useAiChat`:
- On `notFound: true`: clear local persisted session (`clearPersistedSession`), clear messages, call `onConversationNotFound?.()` — **do not call `importAiLocalConversation`**.
- On `notFound: false` (network / server error): leave existing local state as-is (current behavior for connection-failed case).

A new `onConversationNotFound?: () => void` callback is threaded: `UseAiChatInput` → `AiChat` props → `DockedChatBody` → `sessions.closeSession(session.id)`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Use existing `organizationEvents` infrastructure | `DataTable` and `BackendChromeProvider` already subscribe to this event; no new IPC mechanism needed. |
| Scope key by `tenantId:organizationId` (not just one) | Superadmins can switch both dimensions; compound key prevents cross-org leakage within the same tenant. |
| No legacy key migration | We cannot determine which scope the unscoped data belongs to. Silent adoption into the wrong scope is worse than empty state (server sync repopulates from authoritative source). |
| Return discriminated union from `loadAiServerTranscript` | Callers need to distinguish "object does not exist" from "network unavailable" — two semantically different error states that require opposite recovery strategies. |
| `onConversationNotFound` callback (not direct context coupling) | `useAiChat` / `AiChat` must remain reusable outside the dock (standalone embeds, portal pages). Coupling them to `AiChatSessions` directly would break module isolation. |
| `om-ai-dock-v1` key NOT scoped | The dock state (`assistant`, `width`, `collapsed`) is UI-configuration only — it contains no conversation data and no cross-scope-sensitive content. Scoping it would disrupt "restore last docked assistant" after scope switch, which is desirable UX. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Scope key by `tenantId` only | Users in multiple orgs within one tenant still see cross-org sessions. Compound key is safer and symmetric with how `DataTable` uses the scope event. |
| Migrate legacy key to current scope on first load | Origin scope is unknown; would silently pollute the new scope with foreign data. The server sync is authoritative and free of this ambiguity. |
| Store scope in the stored JSON instead of in the key | Requires schema migration on every read, more parse-time complexity, and still requires a "did scope change?" check at startup. Key-based namespacing is simpler and idiomatic. |
| Remove `AiChatSessions` localStorage entirely, rely on server only | Introduces a server roundtrip before any session tab is visible; degrades perceived performance. Keeping localStorage as a fast-path cache is correct — just scope it. |

---

## User Stories / Use Cases

- **Superadmin** switching tenant in the topbar sees an **empty or current-scope-correct session list** in the AI dock — no previous tenant's conversation titles flash in.
- **Multi-org user** switching organization within one tenant opens the AI dock and sees only their current org's conversations — no other org's sessions visible.
- **Any user** whose local session entry has been orphaned (e.g., was deleted server-side) sees the stale tab **silently removed** rather than a confusing persistent empty chat that never loads.
- **Developer** embedding `<AiChat>` outside the dock (e.g., portal page) is not broken by the new `onConversationNotFound` prop (it is optional, defaults to no-op).

---

## Architecture

### Component / data flow (before fix)

```
AppShell
  └─ AiChatSessionsProvider
       • useState(() => readPersisted())    ← reads 'om-ai-chat-sessions-v1' globally
       • useEffect([], listServerConversations)
       └─ AiDockProvider
            └─ DockedChatBody
                 └─ LazyAiChat key={session.id} conversationId={session.conversationId}
                      └─ useAiChat.hydrateFromServer()
                           • loadAiServerTranscript() → null (on 404)
                           • importAiLocalConversation()   ← BUG: runs on 404
```

### Component / data flow (after fix)

```
AppShell
  └─ AiChatSessionsProvider
       • useState(() => readPersisted(scopedKey))  ← reads scoped key
       • useEffect([storageKey], listServerConversations) ← re-fires on scope change
       • useEffect([],  subscribeOrganizationScopeChanged → reset state + storageKey)
       └─ AiDockProvider
            └─ DockedChatBody
                 └─ LazyAiChat key={session.id} conversationId={session.conversationId}
                                onConversationNotFound={→ sessions.closeSession}
                      └─ useAiChat.hydrateFromServer()
                           • loadAiServerTranscript() → { ok, notFound }
                           • notFound=true → clearLocal + onConversationNotFound()
                           • notFound=false → keep local (network error)
                           • ok=true → use server data (existing behavior)
```

### Scope change sequence (happy path after fix)

```
topbar: emitOrganizationScopeChanged({ tenantId: 'T2', organizationId: 'O2' })
  → AiChatSessionsProvider.subscribeOrganizationScopeChanged handler
       setStorageKey('om-ai-chat-sessions-v1:T2:O2')
       setState(readPersisted('om-ai-chat-sessions-v1:T2:O2'))  ← empty or T2/O2's cached data
  → storageKey dep change triggers listAiServerConversations()
       → setState(mergeServerConversations(_, serverList))
  → DockedChatBody: session = getActiveSession() → null (empty state)
  → effect: ensureSession() → new session for T2/O2
  → LazyAiChat remounts with new conversationId
  → hydrateFromServer() → loadAiServerTranscript(newConversationId)
       → 404 (new empty conversation) → createAiServerConversation() (existing path)
```

---

## API Contracts

### `loadAiServerTranscript` (updated)

```typescript
// packages/ui/src/ai/conversation-store.ts

export type LoadTranscriptResult =
  | { ok: true; data: AiServerTranscriptResponse }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false }

export async function loadAiServerTranscript(
  conversationId: string,
  options?: { limit?: number },
): Promise<LoadTranscriptResult>
```

### `UseAiChatInput` (updated)

```typescript
// packages/ui/src/ai/useAiChat.ts

export interface UseAiChatInput {
  // ... existing fields unchanged ...
  /**
   * Called when the server returns 404 for the provided conversationId.
   * Use to remove a stale session entry from the session registry (e.g., the
   * dock calls `sessions.closeSession(session.id)` here).
   */
  onConversationNotFound?: () => void
}
```

### `AiChatProps` (updated)

```typescript
// packages/ui/src/ai/AiChat.tsx

export interface AiChatProps {
  // ... existing fields unchanged ...
  /** Forwarded to useAiChat. See UseAiChatInput.onConversationNotFound. */
  onConversationNotFound?: () => void
}
```

### `AiChatSessionsProvider` (updated signature)

No prop changes. The provider reads scope internally via `getCurrentOrganizationScope()` and subscribes via `subscribeOrganizationScopeChanged`. `AppShell` callsite is unchanged.

---

## Internationalization (i18n)

No new user-facing strings. The 404 self-healing is silent (no toast). Rationale: a stale-session removal is a background correction, not a user action — surfacing it as a toast would be noise.

> **Exception (future)**: If the UX team decides a "Session ended in previous workspace" message is helpful, the key would be `ai_assistant.chat.session.scope_changed_removed`. Not included in this spec.

---

## Migration & Compatibility

### localStorage key migration

| Key | Fate |
|-----|------|
| `om-ai-chat-sessions-v1` (legacy unscoped) | **Orphaned**. Not read, not written, not deleted. Fades naturally as browser storage is cleared. |
| `om-ai-chat-sessions-v1:tenantId:orgId` (new) | Created on first load for each scope. Populated by server sync immediately. |
| `om-ai-dock-v1` | **Unchanged**. No scoping needed (UI config only). |
| `om-ai-chat:agent:conversationId` (per-session transcript cache in `useAiChat`) | **Unchanged**. `conversationId` is a UUID; cross-scope collision is impossible. These keys are orphaned naturally when `AiChatSessions` creates new sessions with new UUIDs after a scope change. |

### API backward compatibility

`loadAiServerTranscript` is an internal module helper used in exactly one place (`useAiChat.ts`). The return type change is non-breaking at the package boundary (it is not exported from `packages/ui/src/ai/index.ts`).

`UseAiChatInput.onConversationNotFound` and `AiChatProps.onConversationNotFound` are optional additions — no existing callers are affected.

---

## Implementation Plan

### Phase 1: Fix `conversation-store.ts` — expose 404 signal

**Goal**: Typed return from `loadAiServerTranscript` that distinguishes 404 from other failures.

1. Add `LoadTranscriptResult` discriminated union type.
2. Update `loadAiServerTranscript` to return `{ ok: true, data }` | `{ ok: false, notFound: boolean }`.
3. Update the single caller in `useAiChat.ts` to destructure the new type (keep behavior identical — `notFound` logic added in Phase 3).
4. Add unit test in `__tests__/conversation-store.test.ts`: mock `fetch` returning 404 → assert `notFound: true`; mock returning 503 → assert `notFound: false`.

### Phase 2: Scope `AiChatSessions` storage key

**Goal**: Provider reads/writes to a `tenantId:organizationId`-scoped key and resets on scope change.

1. Rename `STORAGE_KEY` → `LEGACY_STORAGE_KEY`. Add `getScopedStorageKey(tenantId, organizationId)` helper.
2. Update `readPersisted(key: string)` and `writePersisted(key: string, state)` to accept an explicit key parameter.
3. In `AiChatSessionsProvider`:
   - Initialize `storageKey` state from `getCurrentOrganizationScope()`.
   - Initialize session state with `readPersisted(storageKey)`.
   - Add `useEffect` that subscribes to `subscribeOrganizationScopeChanged` → `setStorageKey(newKey)` + `setState(readPersisted(newKey))`.
   - Pass `storageKey` explicitly to `writePersisted` in the persistence effect.
   - Add `storageKey` to the dependency array of the `listAiServerConversations` effect.
4. Add unit tests:
   - Scope change event → state resets to new scope's data.
   - Writes go to scoped key, not legacy key.
   - Server sync fires on scope change.

### Phase 3: Self-healing 404 in `useAiChat` + `AiChat` + `AiDock`

**Goal**: Stale `conversationId` triggers silent removal rather than cross-scope import.

1. Add `onConversationNotFound?: () => void` to `UseAiChatInput`. Add `onConversationNotFoundRef` (mirrors `onErrorRef` pattern).
2. In `hydrateFromServer`: replace `if (!transcript)` with `if (!transcript.ok)`:
   - `notFound: true` → `updateMessages([])`, `clearPersistedSession(agent, persistKey)`, call `onConversationNotFoundRef.current?.()`, `return`.
   - `notFound: false` → `return` (network error, keep local state).
   - `ok: true` → existing hydration logic using `transcript.data`.
3. Add `onConversationNotFound?: () => void` to `AiChatProps`. Forward it to `useAiChat`.
4. In `DockedChatBody` (`AiDock.tsx`): add `handleConversationNotFound = () => sessions.closeSession(session.id)` and pass as `onConversationNotFound` to `LazyAiChat`.
5. Add unit tests:
   - `hydrateFromServer` with 404 → messages cleared, `clearPersistedSession` called, callback invoked, `importAiLocalConversation` NOT called.
   - `hydrateFromServer` with 503 → local state retained, callback NOT invoked.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/ui/src/ai/conversation-store.ts` | Modify | Add `LoadTranscriptResult` type; update `loadAiServerTranscript` return |
| `packages/ui/src/ai/AiChatSessions.tsx` | Modify | Scoped key, scope-change subscription, server sync dep |
| `packages/ui/src/ai/useAiChat.ts` | Modify | `onConversationNotFound` input; 404 handling in `hydrateFromServer` |
| `packages/ui/src/ai/AiChat.tsx` | Modify | Forward `onConversationNotFound` prop |
| `packages/ui/src/ai/AiDock.tsx` | Modify | Wire `onConversationNotFound` → `sessions.closeSession` |
| `packages/ui/src/ai/__tests__/conversation-store.test.ts` | Modify | 404 vs. 503 mock tests |
| `packages/ui/src/ai/__tests__/AiChatSessions.test.ts` | Create | Scoped key tests, scope-change reset tests |
| `packages/ui/src/ai/__tests__/AiChat.test.tsx` | Modify | `onConversationNotFound` forwarding test |
| `packages/ui/src/ai/__tests__/AiDock.test.tsx` | Modify | `closeSession` called on 404 test |

### Testing Strategy

**Unit tests** (Jest/jsdom):
- `conversation-store`: `loadAiServerTranscript` discriminated union for 200, 404, 503, network failure.
- `AiChatSessions`: (a) initial read from scoped key; (b) scope change → state reset to new scope; (c) `writePersisted` uses scoped key; (d) `listAiServerConversations` re-fires on scope change.
- `useAiChat`: `hydrateFromServer` with `notFound: true` → no import call; with `notFound: false` → keep messages; with `ok: true` → existing tests pass unchanged.
- `AiDock`: scope-changed stale session → `closeSession` called via `onConversationNotFound`.

**Integration tests** (Playwright — per `.ai/qa/AGENTS.md`):
- `GET /api/ai_assistant/ai/conversations/:id` returns 404 for out-of-scope conversation → dock shows empty session, no cross-tenant import.

---

## Frontend Architecture Contract

### 1. Server/Client Boundary Map

| Surface | Server root | Client islands | Data owner | Notes |
|---------|-------------|----------------|------------|-------|
| `AiChatSessionsProvider` | — | `AiChatSessionsProvider` (already `"use client"`) | `localStorage` + server API | No change to boundary |
| `AiDock.tsx` | — | `AiDockProvider`, `DockedChatBody` (already `"use client"`) | `localStorage` + `AiChatSessions` context | No change to boundary |
| `useAiChat.ts` | — | Client hook (already `"use client"`) | `localStorage` + streaming API | No change to boundary |

### 2. `"use client"` Ledger

No new `"use client"` files added. All modified files are already client components.

### 3. Client Blob Guardrail

No new heavy dependencies introduced. Changes are purely control-flow modifications within existing files.

### 4. Budgets

| Budget | Target | This spec |
|--------|--------|-----------|
| New `"use client"` files | 0 | 0 ✓ |
| Files over 300 LOC touched | — | All under limit ✓ |
| Heavy browser libraries at provider root | 0 | 0 ✓ |

### 5. Provider / Bootstrap Scope

| Provider | Global? | Scope | Change |
|----------|---------|-------|--------|
| `AiChatSessionsProvider` | Yes (AppShell root) | App-wide | Now reads from scoped key; adds one `window.addEventListener` subscription via `subscribeOrganizationScopeChanged` |

The added subscription follows the exact same pattern used by `DataTable` and `BackendChromeProvider` — no new global state or broadcast mechanism introduced.

### 6. Test and Evidence Plan

- Hydration smoke: existing `AiDock.test.tsx` covers provider mount — extended with scope-change scenario.
- `yarn workspace @open-mercato/ui test` must pass green after all phases.

---

## Risks & Impact Review

### Data Integrity Failures

- **State reset on scope change is synchronous**: `setState(readPersisted(newKey))` runs inside the scope-change event handler. React 18 batches this with `setStorageKey`, so both state updates commit in the same render cycle. No intermediate render with mismatched key/state.
- **Persistence effect ordering**: `writePersisted(storageKey, state)` runs after render with the new `storageKey`. The empty-state write to the new key is immediately overwritten by the server sync in the same or next microtask. Old key is never touched after scope change.

### Tenant & Data Isolation Risks

#### Risk: Legacy key retains previous tenant data in browser

- **Scenario**: User switches tenant, `om-ai-chat-sessions-v1` (legacy) retains old data; a future code path inadvertently reads it.
- **Severity**: Low
- **Affected area**: `AiChatSessions.tsx` only
- **Mitigation**: After this fix, the legacy key is never read or written by any production path. It is a dormant dead entry.
- **Residual risk**: Third-party code or a future developer could accidentally reference the legacy key name. Mitigation: document the deprecation in the constant comment.

#### Risk: Cross-tenant import during scope transition window (Problem B)

- **Scenario**: Without fix B, a conversationId from the previous scope triggers `importAiLocalConversation` in the new scope.
- **Severity**: Critical (present bug, removed by this spec)
- **Affected area**: `ai_assistant` module — conversation data on new tenant's server
- **Mitigation**: Discriminated `notFound` return from `loadAiServerTranscript` short-circuits the import path entirely. Import is only called when transcript is genuinely absent for a reason other than 404.
- **Residual risk**: None after fix is deployed.

#### Risk: Null-scope bucket polluted before first scope event

- **Scenario**: `getCurrentOrganizationScope()` returns `{tenantId: null, orgId: null}` at mount; provider writes to `om-ai-chat-sessions-v1:no-tenant:no-org`. Scope event fires shortly after; provider switches to correct scoped key. The null-scope bucket has empty state written into it.
- **Severity**: Low
- **Affected area**: `localStorage` only — no user-visible impact
- **Mitigation**: The null-scope key contains only empty state `{ sessions: [], activeByAgent: {} }`. No sensitive data. It is effectively a harmless ghost entry.
- **Residual risk**: Minor `localStorage` bloat. Acceptable.

### Migration & Deployment Risks

#### Risk: Existing users lose local-only conversation history

- **Scenario**: Users who had sessions stored only in `om-ai-chat-sessions-v1` (never synced to server) will not see them after the fix, because we do not migrate the legacy key.
- **Severity**: Medium (UX regression for a small subset)
- **Affected area**: Users who only use local storage and never connected to a server (e.g., fresh installs with no internet during first session, or rare offline use cases)
- **Mitigation**: `listAiServerConversations` immediately repopulates sessions that were synced. The comment in `AiChatSessions.tsx` already documents "server is the source of truth." Local-only sessions were always at risk of loss.
- **Residual risk**: Accepted. Documented in changelog. Migration guide: users who want to preserve history should export before deploying.

---

## Final Compliance Report — 2026-05-28

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | UI-only change, no ORM |
| root AGENTS.md | Never expose cross-tenant data or skip tenant/organization scoping | Compliant | Fix explicitly adds scoping |
| root AGENTS.md | Use `apiCall`/`apiCallOrThrow` — never raw `fetch` | Compliant | `conversation-store.ts` uses its own internal `requestJson` which is not a public API surface; `useAiChat.ts` uses `apiFetch` |
| root AGENTS.md | No `any` types | Compliant | All new types are explicitly typed |
| packages/ui/AGENTS.md | Use `useGuardedMutation` for non-`CrudForm` writes | N/A | No new write UI |
| packages/ui/AGENTS.md | No hardcoded user-facing strings | Compliant | No new UI strings |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| API contracts match implementation plan | Pass | `LoadTranscriptResult` defined in both sections |
| Risks cover all write operations | Pass | localStorage writes, server import path covered |
| No new cross-module ORM | Pass | UI-only change |
| Backward compatibility preserved | Pass | All new props are optional; `AppShell` callsite unchanged |
| Test coverage declared for all changed paths | Pass | Unit + integration tests defined per phase |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved for implementation.

---

## Changelog

### 2026-05-28
- Initial specification (GitHub issue #2123)
