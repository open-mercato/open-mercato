# Plan — AI Chat Sessions: Tenant/Org Scope Isolation

**Source spec:** `.ai/specs/2026-05-28-ai-chat-sessions-scope-isolation.md`
**GitHub issue:** [#2123](https://github.com/open-mercato/open-mercato/issues/2123)
**Branch:** `fix/ai-chat-sessions-scope-isolation`
**Base:** `origin/develop`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 0 | 0.1 | Seed run folder (PLAN/HANDOFF/NOTIFY) | done | a762bca68 |
| 1 | 1.1 | Expose 404 vs network-error from loadAiServerTranscript + update caller | done | c17e8907d |
| 1 | 1.2 | Unit tests: conversation-store 200/404/503 paths | done | abde12fbb |
| 2 | 2.1 | Scope AiChatSessions localStorage key by tenant+org + scope-change reset | done | 636b37d0e |
| 2 | 2.2 | Unit tests: scoped key + scope-change reset | done | de1746a97 |
| 3 | 3.1 | Self-healing 404 in useAiChat hydrateFromServer + onConversationNotFound | done | 783b2ee85 |
| 3 | 3.2 | Forward onConversationNotFound through AiChat props | done | 026110d5f |
| 3 | 3.3 | Wire onConversationNotFound to sessions.closeSession in AiDock | done | 9c364974a |
| 3 | 3.4 | Unit tests: 404 self-healing + AiDock wiring | done | pending |

## Goal

Eliminate two compounding bugs in the AI chat dock when tenant/org scope changes:
- **Bug A**: Stale session metadata flashes from previous scope because `localStorage` key is global.
- **Bug B**: `loadAiServerTranscript` returns `null` for 404, causing `importAiLocalConversation` to silently import previous-scope messages onto the new tenant's server (cross-tenant data write).

## Scope

- `packages/ui/src/ai/conversation-store.ts` — discriminated `LoadTranscriptResult` return
- `packages/ui/src/ai/AiChatSessions.tsx` — scoped storage key + scope-change subscription
- `packages/ui/src/ai/useAiChat.ts` — `onConversationNotFound` callback, 404 short-circuit
- `packages/ui/src/ai/AiChat.tsx` — prop forwarding
- `packages/ui/src/ai/AiDock.tsx` — wire callback to `closeSession`
- New/updated unit tests under `packages/ui/src/ai/__tests__/`

## Non-goals

- No legacy key migration (`om-ai-chat-sessions-v1` stays orphaned by design).
- No scoping of `om-ai-dock-v1` (UI config only, deliberate).
- No new i18n strings (404 self-healing is silent by design).
- No server-side changes — server-side ACL already rejects cross-scope reads correctly.

## Risks (brief)

- Null-scope window at first mount: provider may write `om-ai-chat-sessions-v1:no-tenant:no-org` until scope event arrives. Acceptable — empty state, harmless.
- Users with local-only sessions never synced to server lose history. Acceptable, documented in spec.
- Subscribe handler must batch `setStorageKey + setState` to avoid intermediate render with mismatched key. Verified by React 18 automatic batching.

## External References

None (no `--skill-url` provided).

## Implementation Plan

### Phase 0 — Seed run folder

**Step 0.1** — Seed `PLAN.md`, `HANDOFF.md`, `NOTIFY.md` under `.ai/runs/2026-05-28-ai-chat-sessions-scope-isolation/`. First commit on the branch.

### Phase 1 — Distinguish 404 from network errors

**Step 1.1** — In `packages/ui/src/ai/conversation-store.ts` and `packages/ui/src/ai/useAiChat.ts`:
- Add exported `LoadTranscriptResult` discriminated union type.
- Update `loadAiServerTranscript` to return `{ ok: true, data }` | `{ ok: false, notFound: true }` | `{ ok: false, notFound: false }`.
- Update the single call site in `hydrateFromServer` to destructure the new shape. Behavior remains identical for now (both `notFound: true` and `notFound: false` map to the existing "no transcript" branch). The split-handling lands in Phase 3.

**Step 1.2** — Add unit tests in `packages/ui/src/ai/__tests__/conversation-store.test.ts`:
- Mock fetch returning 200 → `{ ok: true, data: ... }`.
- Mock fetch returning 404 → `{ ok: false, notFound: true }`.
- Mock fetch returning 503 → `{ ok: false, notFound: false }`.
- Mock fetch throwing → `{ ok: false, notFound: false }`.

### Phase 2 — Scope `AiChatSessions` storage key

**Step 2.1** — In `packages/ui/src/ai/AiChatSessions.tsx`:
- Rename `STORAGE_KEY` → `LEGACY_STORAGE_KEY` (kept only as a documented constant for clarity, not read or written by any code path).
- Add `getScopedStorageKey(tenantId, organizationId)` helper.
- Update `readPersisted(key)` and `writePersisted(key, state)` to accept an explicit key parameter.
- In `AiChatSessionsProvider`:
  - Initialize `storageKey` state from `getCurrentOrganizationScope()`.
  - Initialize sessions state with `readPersisted(storageKey)`.
  - Add an effect subscribing to `subscribeOrganizationScopeChanged` → `setStorageKey(newKey)` + `setState(readPersisted(newKey))`.
  - Pass `storageKey` to `writePersisted` in persistence effect.
  - Add `storageKey` to the dependency array of `listAiServerConversations`.

**Step 2.2** — Add unit tests in `packages/ui/src/ai/__tests__/AiChatSessions.test.tsx` (new file):
- Provider reads scoped key on mount given a `getCurrentOrganizationScope` mock.
- Writing a session writes to scoped key (assert via direct `localStorage.getItem`).
- Emitting `emitOrganizationScopeChanged(newScope)` causes the provider to switch keys and reset state to the new key's contents.
- `listAiServerConversations` re-fires on scope change (assert via fetch mock call count).

### Phase 3 — Self-healing 404 in chat hook + props + dock

**Step 3.1** — In `packages/ui/src/ai/useAiChat.ts`:
- Add `onConversationNotFound?: () => void` to `UseAiChatInput`.
- Add `onConversationNotFoundRef = React.useRef(onConversationNotFound)` + the corresponding sync effect (mirrors `onErrorRef`).
- In `hydrateFromServer`, replace existing handling:
  - `transcriptResult.ok === true` → existing path (use `transcriptResult.data`).
  - `transcriptResult.notFound === true` → `updateMessages([])`, `clearPersistedSession(agent, persistKey)`, call `onConversationNotFoundRef.current?.()`, return early. **Do not call `importAiLocalConversation`.**
  - `transcriptResult.notFound === false` → return without changing local state (network error; keep what we have).

**Step 3.2** — In `packages/ui/src/ai/AiChat.tsx`:
- Add `onConversationNotFound?: () => void` to `AiChatProps`.
- Destructure and pass through to `useAiChat`.

**Step 3.3** — In `packages/ui/src/ai/AiDock.tsx`:
- In `DockedChatBody`, add a memoized `handleConversationNotFound` that calls `sessions.closeSession(session.id)` when a session is active.
- Pass to `<LazyAiChat onConversationNotFound={handleConversationNotFound} />`.

**Step 3.4** — Tests:
- In `packages/ui/src/ai/__tests__/AiChat.conversation.test.tsx` (or new file): mock `loadAiServerTranscript` returning `notFound: true` → assert `onConversationNotFound` callback invoked, messages cleared, `importAiLocalConversation` not called.
- In `packages/ui/src/ai/__tests__/AiDock.test.tsx`: simulate stale session, mock `loadAiServerTranscript` returning notFound → assert session removed from registry.

## File Manifest

| File | Action | Phase |
|------|--------|-------|
| `packages/ui/src/ai/conversation-store.ts` | Modify | 1.1 |
| `packages/ui/src/ai/useAiChat.ts` | Modify | 1.2, 3.1 |
| `packages/ui/src/ai/__tests__/conversation-store.test.ts` | Create/Modify | 1.3 |
| `packages/ui/src/ai/AiChatSessions.tsx` | Modify | 2.1 |
| `packages/ui/src/ai/__tests__/AiChatSessions.test.tsx` | Create | 2.2 |
| `packages/ui/src/ai/AiChat.tsx` | Modify | 3.2 |
| `packages/ui/src/ai/AiDock.tsx` | Modify | 3.3 |
| `packages/ui/src/ai/__tests__/AiChat.conversation.test.tsx` | Modify | 3.4 |
| `packages/ui/src/ai/__tests__/AiDock.test.tsx` | Modify | 3.4 |

## Testing Strategy

- **Unit (Jest/jsdom)** per phase, run before each commit.
- **Final gate**: `yarn typecheck`, `yarn test`, `yarn workspace @open-mercato/ui test`, `yarn build:packages`.
- **Manual verification (post-merge, not in scope of this PR)**: superadmin logs in, opens dock in tenant1/org1, sends message, switches scope to tenant2/org2, opens dock — no flash of previous tenant's data.

## Backward Compatibility

- `loadAiServerTranscript` is internal to `packages/ui/src/ai/` and not exported from the package root — return-type change is non-breaking at the package boundary.
- `onConversationNotFound` is an optional addition to both `UseAiChatInput` and `AiChatProps` — no existing callers affected.
- Legacy `om-ai-chat-sessions-v1` localStorage entries are abandoned (not migrated). Documented in spec.
