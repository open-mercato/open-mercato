# Execution Plan: AI Chat Sharing Contract Fixes

**Source spec:** `.ai/specs/2026-05-28-ai-chat-sharing-contract-fixes.md`
**Branch:** `fix/ai-chat-sharing-contract-fixes`
**Author:** adeptofvoltron
**Date:** 2026-05-28

---

## Goal

Fix two contract deviations in AI chat conversation sharing (issue #2189):
1. `participantCount` includes the owner — must exclude it (private → `0`, N viewers → `N`).
2. `DELETE /participants/:userId` returns `204` for a non-existent participant — must return `404`.

## Scope

**Affected files:**
- `packages/ai-assistant/src/modules/ai_assistant/data/repositories/AiChatConversationRepository.ts`
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/conversations/[conversationId]/participants/[userId]/route.ts`
- New/updated error class alongside `AiChatConversationAccessError`

**Non-goals:**
- No UI changes
- No database migrations
- No new API routes
- No ACL changes
- No changes to `addParticipant` or `listParticipants`

---

## Implementation Plan

### Phase 1: Repository and error fixes

**Step 1.1** — Add `AiChatParticipantNotFoundError` class alongside existing error classes.

**Step 1.2** — Fix `getParticipantCount`: add `role: { $ne: 'owner' }` filter so owner is excluded from the count.

**Step 1.3** — Fix `revokeParticipant`: replace `if (!participant) return` with `if (!participant) throw new AiChatParticipantNotFoundError()`.

### Phase 2: Route fix + tests

**Step 2.1** — In `DELETE /participants/[userId]/route.ts`, catch `AiChatParticipantNotFoundError` and return `jsonError(404, ..., 'participant_not_found')`.

**Step 2.2** — Add/update unit tests for both `getParticipantCount` (non-owner filter) and `revokeParticipant` (not-found → throws).

**Step 2.3** — Full validation gate.

---

## Risks

- No contract surface broken — `participantCount` change is a bug correction (existing contract says non-owner only).
- `DELETE` returning 404 instead of 204 is breaking for callers relying on 204-idempotency; per spec, 404 was always the intended behavior and no existing UI code re-calls the endpoint after revoke.

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Repository and error fixes

- [x] 1.1 Add `AiChatParticipantNotFoundError` class — eb597c6bd
- [x] 1.2 Fix `getParticipantCount` to exclude owner — eb597c6bd
- [x] 1.3 Fix `revokeParticipant` to throw on not-found — eb597c6bd

### Phase 2: Route fix + tests

- [x] 2.1 Catch `AiChatParticipantNotFoundError` in DELETE route → 404 — eb597c6bd
- [x] 2.2 Add unit tests — eb597c6bd
- [ ] 2.3 Full validation gate
