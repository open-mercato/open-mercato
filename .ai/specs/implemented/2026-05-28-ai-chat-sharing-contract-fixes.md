# AI Chat Sharing — Contract Fixes

## TLDR

**Key Points:**
- Two non-breaking contract deviations in the AI chat sharing feature (shipped in PR #2023) require correction.
- Fix 1: `participantCount` in `GET /conversations/:id` must count only non-owner active participants (`0` for private), not all participants (including owner).
- Fix 2: `DELETE /participants/:userId` must return `404` when the target is not an active participant, not `204`.
- Both fixes are pure backend behavioural corrections: no migration, no UI change, no contract widening.

**Scope:**
- `AiChatConversationRepository.getParticipantCount()` — add `role: { $ne: 'owner' }` filter.
- `AiChatConversationRepository.revokeParticipant()` — throw a typed `AiChatParticipantNotFoundError` when target row is absent.
- `DELETE /participants/[userId]/route.ts` — catch the new error and return `404`.

---

## Overview

The AI chat conversation sharing feature (`2026-05-22-ai-chat-conversation-sharing.md`) defines `participantCount` as *"count of non-owner active participants; `0` for private"* and specifies that revoking a non-participant returns `404`. Both constraints were missed during implementation. This spec documents the corrections so they can be implemented and reviewed against the source contract.

---

## Problem Statement

### Problem 1 — `participantCount` includes the owner

`AiChatConversationRepository.getParticipantCount` (line 714) counts every `deleted_at IS NULL` row for the conversation, including the owner's participant row. Consequently:

- A private (owner-only) conversation reports `participantCount: 1` instead of `0`.
- A conversation shared with N viewers reports `participantCount: N + 1` instead of `N`.

The parent spec is unambiguous: the owner is excluded from the count.

### Problem 2 — Revoke returns `204` for a non-existent participant

`revokeParticipant` (line 698) contains `if (!participant) return`. Because the function returns `void`, the route handler cannot distinguish "row found and soft-deleted" from "row not found"; it always responds `204 No Content`. The parent spec requires `404` when no active participant row is matched.

---

## Proposed Solution

### Fix 1 — Filter owner out of `getParticipantCount`

Add `role: { $ne: 'owner' }` to the MikroORM `count` call:

```ts
// AiChatConversationRepository.ts
async getParticipantCount(...): Promise<number> {
  return this.em.count(AiChatConversationParticipant, {
    tenantId,
    conversationId,
    deletedAt: null,
    role: { $ne: 'owner' },
    ...(organizationId ? { organizationId } : {}),
  } as FilterQuery<AiChatConversationParticipant>)
}
```

No migration needed — the `role` column already exists and is indexed via the partial unique constraints.

### Fix 2 — Return 404 when participant is absent

Two-part change:

**Part A — New typed error** in `data/errors.ts` (or alongside `AiChatConversationAccessError`):

```ts
export class AiChatParticipantNotFoundError extends Error {
  constructor(message = 'Participant not found or already revoked.') {
    super(message)
    this.name = 'AiChatParticipantNotFoundError'
  }
}
```

**Part B — Throw in `revokeParticipant`** instead of silent return:

```ts
// AiChatConversationRepository.ts line 698
if (!participant) {
  throw new AiChatParticipantNotFoundError()
}
```

**Part C — Catch in DELETE route handler:**

```ts
// participants/[userId]/route.ts
} catch (err) {
  if (err instanceof AiChatParticipantNotFoundError) {
    return jsonError(404, 'Participant not found or already revoked.', 'participant_not_found')
  }
  if (err instanceof AiChatConversationAccessError) {
    return jsonError(403, err.message || 'Access denied.', 'forbidden')
  }
  return jsonError(500, 'Internal server error.', 'internal_error')
}
```

### Design decisions

| Decision | Rationale |
|---|---|
| New error class vs. returning `boolean` | Throwing preserves `revokeParticipant`'s `void` return type and follows the existing error-propagation pattern in the repo (`AiChatConversationAccessError`). Changing the return type to `{ found: boolean }` would be a wider change and requires updating all callers. |
| Error class location | Placed alongside `AiChatConversationAccessError` in the same errors file for consistency. |
| `participant_not_found` error code | Distinct from `conversation_not_found` (already used in the route) so API clients can differentiate. |

---

## Affected Files

| File | Change |
|---|---|
| `packages/ai-assistant/src/modules/ai_assistant/data/repositories/AiChatConversationRepository.ts` | Fix 1: add `role: { $ne: 'owner' }` to `getParticipantCount`. Fix 2: throw `AiChatParticipantNotFoundError` when participant absent. |
| `packages/ai-assistant/src/modules/ai_assistant/data/errors.ts` (or equivalent) | Add `AiChatParticipantNotFoundError` class. |
| `packages/ai-assistant/src/modules/ai_assistant/api/ai/conversations/[conversationId]/participants/[userId]/route.ts` | Catch `AiChatParticipantNotFoundError` → 404. |

---

## API Contract After Fix

### `GET /api/ai_assistant/ai/conversations/:id`

| Scenario | `participantCount` before | `participantCount` after |
|---|---|---|
| Private conversation (owner only) | `1` | `0` |
| Shared with 1 viewer | `2` | `1` |
| Shared with N viewers | `N + 1` | `N` |

### `DELETE /api/ai_assistant/ai/conversations/:id/participants/:userId`

| Scenario | Status before | Status after |
|---|---|---|
| Active participant revoked | `204` | `204` (unchanged) |
| Non-existent userId | `204` | `404` |
| Already-revoked participant | `204` | `404` |
| Caller is not owner | `403` | `403` (unchanged) |
| Target is the owner | `403` | `403` (unchanged) |

---

## Implementation Plan

### Phase 1 — Repository and error fixes

**Step 1.1** — Locate or create the errors file for `AiChatConversationAccessError`. Add `AiChatParticipantNotFoundError` alongside it. Export from the module's public barrel if needed.

**Step 1.2** — In `AiChatConversationRepository.getParticipantCount`, add `role: { $ne: 'owner' }` to the MikroORM filter.

**Step 1.3** — In `AiChatConversationRepository.revokeParticipant`, replace `if (!participant) return` with `if (!participant) throw new AiChatParticipantNotFoundError()`.

### Phase 2 — Route fix and validation

**Step 2.1** — In `DELETE /participants/[userId]/route.ts`, add a `catch` branch for `AiChatParticipantNotFoundError` that returns `jsonError(404, ..., 'participant_not_found')` before the existing `AiChatConversationAccessError` branch.

**Step 2.2** — Run validation:
```bash
yarn workspace @open-mercato/ai-assistant build
yarn workspace @open-mercato/ai-assistant test
yarn typecheck
```

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---|---|
| Existing callers of `revokeParticipant` expect silent void on not-found | Low | Only one caller: the DELETE route handler. It is updated in Phase 2. |
| UI showing wrong participant count in sharing dialog | Low | The dialog reads `participants` list length directly, not `participantCount`. The field is informational. |
| Double-revoke now returns 404 instead of 204 | Low — by design | This is the correct spec behaviour. Idempotent callers should handle 404 as "already done". |

---

## Backward Compatibility

- `participantCount` changing from `N+1` to `N` is a **bug fix** — any caller relying on the old (wrong) count has a broken assumption and benefits from the correction.
- `DELETE` returning `404` on missing participants is a **breaking change only for callers that incorrectly relied on 204-idempotency**. The parent spec always required `404`; this is an implementation correction, not a contract change. No existing UI code re-calls the revoke endpoint on 2xx/4xx; it navigates away.

---

## Integration Coverage

Per AGENTS.md and the parent spec, the following scenarios must be covered by integration tests (`.ai/qa/`):

| ID | Scenario | Expected |
|---|---|---|
| TC-SHARE-FIX-01 | GET conversation with only owner → `participantCount: 0` | ✅ |
| TC-SHARE-FIX-02 | GET conversation shared with 2 viewers → `participantCount: 2` | ✅ |
| TC-SHARE-FIX-03 | DELETE active participant → `204` | ✅ |
| TC-SHARE-FIX-04 | DELETE non-existent userId → `404` with `participant_not_found` code | ✅ |
| TC-SHARE-FIX-05 | DELETE already-revoked participant → `404` with `participant_not_found` code | ✅ |

---

## Final Compliance Report

| Check | Status |
|---|---|
| No new migrations required | ✅ |
| No new API routes | ✅ |
| Tenant/org scoping untouched | ✅ |
| Encryption paths untouched | ✅ |
| No new ACL features | ✅ |
| No UI changes | ✅ |
| No new production dependencies | ✅ |
| Error class follows existing naming convention | ✅ |
| Route error responses use existing `jsonError` helper | ✅ |

---

## Changelog

| Date | Author | Summary |
|---|---|---|
| 2026-05-28 | spec-writing | Initial spec for issue #2189 — two contract deviations in AI chat sharing |
