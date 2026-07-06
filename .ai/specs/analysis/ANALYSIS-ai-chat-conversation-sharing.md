# Pre-Implementation Analysis: AI Chat Conversation Sharing (Issue #1969)

## Executive Summary

The foundational server-side conversation storage spec (`2026-05-05-ai-chat-server-side-conversation-storage`) has been substantially implemented: all three database entities (`ai_chat_conversations`, `ai_chat_conversation_participants`, `ai_chat_messages`) exist in production schema, the repository contains an explicit `TODO(ai-chat-sharing)` marker identifying exactly where the participant-based access predicate must be wired, and the existing `ai_assistant.conversations.manage` ACL feature is already deployed. Sharing is architecturally ready to add, but there is no dedicated spec for the feature itself. A new spec must be written before implementation can begin — the foundation spec reserves extension points but does not define sharing API contracts, UI, or notification design. The 5 test scenarios from the issue must also be formally captured.

---

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|--------------|
| 1 | API Route URLs | New participant-management routes (`POST/DELETE /api/ai_assistant/ai/conversations/:id/participants`) are net-new; no violation here, but if the existing `PATCH /api/ai_assistant/ai/conversations/:conversationId` is modified to also accept `visibility` changes, that is additive and safe. | None | Verify the PATCH body schema in validators.ts before extending it. |
| 2 | Database Schema | `ai_chat_conversation_participants.role` column currently accepts `'owner' | 'viewer' | 'commenter'` at the ORM level but the DB column is `text` with a default of `'owner'`. Adding `'viewer'` and `'commenter'` rows is additive. No BC violation if no check constraint enforces the enum. | Low | Confirm migration does not add a narrowing check constraint. |
| 3 | ACL Feature IDs | A new `ai_assistant.conversations.share` feature will be added. The existing `ai_assistant.conversations.manage` feature ID MUST NOT be renamed or removed — it is already stored in tenant role configs. | None (new feature) | Add new feature; leave existing ID intact. |
| 4 | Type Interfaces | `AiChatConversation.visibility` field already exists in the entity (`'private' | 'shared' | 'organization'`). If this type is exported and consumed externally, widening from `'private'` to include `'shared'` is non-breaking since the union is already declared. | None | No change needed. |
| 5 | Function Signatures | `AiChatConversationRepository.canAccessConversation` is an internal private helper — not part of any public API. Widening it to also accept participant rows is internal and non-breaking. | None | Internal change only. |

### Missing BC Section

The foundational spec (`2026-05-05-ai-chat-server-side-conversation-storage`) includes a Migration & Backward Compatibility section that covers the server-side storage transition. However, there is **no dedicated spec** for sharing, so there is no BC section for the sharing feature. This is a gap, not a violation of the existing spec.

---

## Spec Completeness

Since no dedicated sharing spec exists, this section evaluates what must be authored before implementation.

### Missing Sections (required per .ai/specs/AGENTS.md)

| Section | Status | Notes |
|---------|--------|-------|
| TLDR & Overview | MISSING | No sharing-specific spec file exists |
| Problem Statement | MISSING | Issue #1969 describes it but it is not in a spec |
| Proposed Solution | MISSING | |
| Architecture | MISSING | Extension point noted in foundation spec Phase 6, but no sharing-specific architecture |
| Data Models | PARTIAL | `ai_chat_conversation_participants` table exists and is deployed; but the sharing-specific fields (`role` values `viewer`/`commenter`, `last_read_at` usage) are not formally specified in a sharing spec |
| API Contracts | MISSING | No spec for `POST /participants`, `DELETE /participants/:userId`, or the sharing invitation flow |
| UI/UX | MISSING | No spec for the sharing dialog, user picker, role selector, or revoke UI |
| Risks & Impact Review | MISSING | |
| Phasing | MISSING | |
| Implementation Plan | MISSING | |
| Integration Test Coverage | MISSING | The 5 test scenarios from Issue #1969 are not documented in any spec |
| Final Compliance Report | MISSING | |
| Migration & Backward Compatibility | MISSING | |

### Incomplete Sections (in foundation spec, not in sharing spec)

- The foundation spec Phase 6 notes "Document future sharing extension points: participants, visibility, share UI, notifications, and access checks" — this is a placeholder, not a specification. It is explicitly deferred.
- The `TODO(ai-chat-sharing)` comment in `AiChatConversationRepository.ts` (line 32-34) confirms the predicate widening is intentionally deferred to the sharing feature.

---

## AGENTS.md Compliance

### Violations

| Rule | Status | Notes |
|------|--------|-------|
| Module structure: files in `packages/ai-assistant/` | Compliant | Foundation code is correctly placed |
| API routes export `openApi` | Compliant | All existing conversation routes export `openApi` |
| Zod validation | Compliant | `data/validators.ts` contains schemas for all current routes |
| Tenant scoping | Compliant | Repository asserts `tenantId` and `organizationId` on every method |
| `findWithDecryption` for all reads | Compliant | All repository reads use `findWithDecryption`/`findOneWithDecryption` |
| `setup.ts` declares `defaultRoleFeatures` | Compliant | `ai_assistant.conversations.manage` already granted to admin |
| New feature `ai_assistant.conversations.share` needs `defaultRoleFeatures` | GAP | A new `share` feature must be added to both `acl.ts` and `setup.ts` `defaultRoleFeatures` for appropriate roles |
| ACL wildcard-aware matching | Compliant | Route code uses `hasRequiredFeatures` from `lib/auth` |
| Events: sharing events must use `createModuleEvents()` | GAP | No `ai_assistant.conversation.shared` / `ai_assistant.conversation.unshared` events are declared |
| Notifications: "conversation shared with you" notification type | GAP | No `notifications.ts` entry for share notifications |
| i18n: sharing-related strings need locale keys | GAP | No `ai_assistant.chat.tabs.share` i18n key is implemented yet (reserved in foundation spec) |
| Backend UI: participant management needs CrudForm/modal conventions | GAP | No UI spec; any sharing dialog must follow CrudForm/modal conventions, use `Button`/`IconButton` primitives |
| `useGuardedMutation` for participant add/remove writes | GAP | If the sharing dialog is a non-CrudForm modal, all writes MUST use `useGuardedMutation` |
| Optional chrome fetches suppressing auth redirects | Relevant | The conversation history fetch is already guarded; participant list fetch for the sharing dialog will also need `x-om-forbidden-redirect: 0` if it fetches feature-gated user search |

---

## Risk Assessment

### High Risks

| Risk | Scenario | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Participant predicate bypass | `findOneAccessibleConversation` currently only fetches by `conversationId + tenantId + organizationId + deleted_at = null`. A shared-read caller who is a participant but not the owner calls `getById` → `canAccessConversation` returns `false` because it only checks `ownerUserId == ctx.userId`. The TODO comment in the repository explicitly marks this gap. | All conversation read endpoints (GET transcript, list, update, delete) | Widen `canAccessConversation` to check for an undeleted participant row in `ai_chat_conversation_participants` using a JOIN or sub-query | Medium after implementation; requires negative tests proving non-participants cannot read |
| Cross-tenant data leak via participant lookup | A malicious user in tenant A guesses a `conversationId` from tenant B. The participant table lookup must also be scoped to `tenantId + organizationId`. | Participant lookup JOIN | The participant query MUST include `tenantId` and `organizationId` filters matching the conversation's scope | Low after implementation; high if the JOIN is written without full scope |
| Participant write without transactionality | A `POST /participants` route that creates a participant row without checking the conversation still exists (non-deleted) could create orphaned participant rows | Participant management API | Validate conversation exists and is not deleted within the same transaction as participant creation | Medium |

### Medium Risks

| Risk | Scenario | Affected Area | Mitigation |
|------|----------|---------------|------------|
| Role escalation confusion | Owner shares a conversation as `viewer`, but the future `commenter` role semantics are undefined. If commenter can append messages, the `appendMessage` method currently hard-checks `ownerUserId === ctx.userId` and will reject commenter writes. | `appendMessage` in repository | Explicitly scope write operations per role. MVP viewer/commenter should be read-only; document which roles can write. |
| `appendMessage` owner-only check not widened for shared reads | `appendMessage` (line 398) checks `conversation.ownerUserId !== ctx.userId` and throws. A commenter role that should be allowed to post will be rejected until this check is also extended. | Chat dispatcher persistence path | Extend `appendMessage` to also accept participants with `commenter` role. |
| User picker cross-tenant exposure | A "share with user" picker must search users within the same tenant/org. If it reuses a general user search endpoint without tenant filtering, it could suggest users from other tenants. | Sharing UI | Use tenant-scoped user search endpoints (auth module users API) with `organization_id` filter |
| `last_read_at` update under concurrent reads | If two shared readers open the same conversation simultaneously, `last_read_at` UPDATE conflicts can occur. | Future unread UX | Use UPSERT semantics with timestamp comparison for `last_read_at` updates |
| Performance: participant lookup on every conversation read | Every `getById` call will need a participant lookup JOIN. For tenants with many shared conversations, this could add measurable latency. | All conversation reads | Add the existing `ai_chat_conv_participants_tenant_org_user_conv_idx` index (already in schema); ensure the predicate uses an indexed path |

### Low Risks

| Risk | Scenario |
|------|----------|
| Foundation spec not in `implemented/` folder | The foundation spec is in `.ai/specs/` root, not `.ai/specs/implemented/`. Implementation appears complete (entities deployed, repository active, routes live), but the spec lifecycle state is stale. This creates confusion about what is done vs pending. |
| Notification delivery for offline users | "X shared a conversation with you" notifications require the target user to be online (or the notification bell to be visible). The notification delivery system is in-app only at MVP; email/push notifications are not in scope. |

---

## Gap Analysis

### Critical Gaps (Block Implementation)

| Gap | Why it Blocks |
|-----|---------------|
| No dedicated sharing spec | Per `AGENTS.md` and `.ai/specs/AGENTS.md`, non-trivial features require a spec before implementation. Sharing is a multi-file, multi-phase feature touching API, DB, UI, ACL, events, and notifications. |
| `TODO(ai-chat-sharing)` in repository not resolved | The `canAccessConversation` predicate currently only accepts `ownerUserId == ctx.userId` or `canManageConversations`. Participant-based access is explicitly stubbed out and must be implemented as the core of this feature. |
| No API spec for participant management endpoints | `POST /api/ai_assistant/ai/conversations/:id/participants` and `DELETE /api/ai_assistant/ai/conversations/:id/participants/:userId` do not exist and have no schema, response shape, or error contract defined. |
| No new ACL feature for sharing | The issue requests `ai_assistant.conversations.share` (or equivalent). Currently only `ai_assistant.view` and `ai_assistant.conversations.manage` exist. A share-specific feature must be added, granted to appropriate default roles, and synced via `yarn mercato auth sync-role-acls`. |

### Important Gaps (Should Address)

| Gap | Notes |
|-----|-------|
| No sharing events declared | `ai_assistant.conversation.shared` and `ai_assistant.conversation.unshared` events should be declared in `events.ts` using `createModuleEvents()` as per the Events convention. These enable audit logs, workflow triggers, and notification subscribers. |
| No share notification type | The issue implies shared users should be notified. A `notifications.ts` entry for `ai_assistant.conversation_shared` must be added with a client renderer. |
| No sharing UI spec | The sharing dialog (who to share with, what role, current participants list, revoke button) has no design or spec. The i18n key `ai_assistant.chat.tabs.share` was reserved in the foundation spec but not implemented. |
| 5 integration test scenarios not documented | Issue #1969 explicitly lists 5 test cases (owner access, shared participant access, non-participant denial, manager override access, cross-tenant denial). These must be captured in a spec's Integration Test Coverage section and implemented in `__integration__/` (not `.ai/qa/tests/`). |
| `appendMessage` owner-only restriction | Line 398 in `AiChatConversationRepository.ts` hardchecks owner. Future `commenter` role support requires this to be parameterized. Should be designed before committer access is added. |
| Foundation spec should be moved to `implemented/` | Per `.ai/specs/AGENTS.md`, fully implemented specs move to `.ai/specs/implemented/` via `git mv`. The foundation spec (`2026-05-05-ai-chat-server-side-conversation-storage.md`) is at least Phase 1-4 complete and should be reviewed for closure. |

### Nice-to-Have Gaps

| Gap | Notes |
|-----|-------|
| `visibility` field not surfaced in API response | `serializeAiChatConversation` in `lib/conversation-storage.ts` should include `visibility` in the response once `shared` becomes a valid value, so the UI can render share status. |
| `last_read_at` update endpoint | Issue mentions `last_read_at` for future unread/share UX. A lightweight `POST /participants/:userId/read` or PATCH on the participant could update this field. |
| Bulk share (share with role) | Sharing with an entire role is mentioned in the issue. The participant model stores `user_id` — role-based sharing would need a separate `role_id` column or a different design pattern. |

---

## Remediation Plan

### Before Implementation (Must Do)

1. **Write a new dedicated spec** `YYYY-MM-DD-ai-chat-conversation-sharing.md` in `.ai/specs/`. Required sections: TLDR, Overview, Problem Statement, Proposed Solution, Architecture (widened predicate + new routes), Data Models (no new tables needed; clarify participant `role` semantics), API Contracts (POST/DELETE participants routes + visibility field in existing responses), UI/UX (sharing dialog + user picker), Events (`conversation.shared`, `conversation.unshared`), Notifications, Risks & Impact Review, Phasing (P1: participant predicate + API; P2: sharing UI + notifications; P3: commenter write access), Integration Test Coverage (all 5 scenarios from issue), Final Compliance Report, Migration & Backward Compatibility.
2. **Add `ai_assistant.conversations.share` to `acl.ts`** and grant it in `setup.ts` `defaultRoleFeatures` for `admin` and `employee`. Run `yarn mercato auth sync-role-acls` after.
3. **Move the foundation spec to `implemented/`** if all 6 phases are confirmed complete. Do a Phase 6 completion check (docs, integration tests for local import, cross-browser restore).
4. **Run `pre-implement-spec` analysis on the new spec once written** to confirm BC compliance and identify remaining gaps before coding begins.

### During Implementation (Add to Spec)

1. **Participant predicate**: Widen `canAccessConversation` (and `findOneAccessibleConversation`) in `AiChatConversationRepository` to perform an EXISTS check on `ai_chat_conversation_participants` for the calling `userId` + conversation scope. This is the core of the `TODO(ai-chat-sharing)` block.
2. **Participant management routes**: `POST /api/ai_assistant/ai/conversations/:conversationId/participants` and `DELETE /api/ai_assistant/ai/conversations/:conversationId/participants/:userId`. Both require the caller to be the conversation owner and must be transactional. Export `openApi` on each. Require `ai_assistant.conversations.share` feature.
3. **Event emission**: Emit `ai_assistant.conversation.shared` from the POST participants route and `ai_assistant.conversation.unshared` from the DELETE route.
4. **Notification subscriber**: Create `subscribers/conversation-shared-notify.ts` to emit an in-app notification to the newly added participant.
5. **`visibility` field update**: When the first non-owner participant is added, automatically update `conversation.visibility` from `'private'` to `'shared'` in the same transaction. When the last non-owner participant is removed, revert to `'private'`.
6. **API response**: Include `visibility` and `participantCount` in `serializeAiChatConversation` output so the UI can show sharing state.
7. **Integration tests**: Implement all 5 scenarios (owner, shared participant, non-participant, manager, cross-tenant) in `packages/ai-assistant/src/modules/ai_assistant/__integration__/TC-AI-sharing-*.spec.ts` — not under `.ai/qa/tests/`.

### Post-Implementation (Follow Up)

1. **Update `ai_assistant.chat.tabs.share` i18n key** — it was reserved in the foundation spec but not added to locale files. Add it once the UI is built.
2. **Review `appendMessage` for commenter write access** — scope this separately once commenter semantics are defined. MVP can treat all non-owner participants as read-only.
3. **Sharing from the AI chat UI** — surface the share button in `AiChatSessions.tsx` tab menu, gated by `ai_assistant.conversations.share`.
4. **Retention/hard-delete policy for participant rows** — currently `ai_chat_conversation_participants` has no `deleted_at` column, making hard-delete the only option when revoking sharing. Consider adding a soft-delete column for auditability before shipping revoke.

---

## Recommendation

**Needs spec first — then ready to implement.**

The foundational infrastructure is fully in place: database schema, repository, and API routes are all live. The `TODO(ai-chat-sharing)` marker in `AiChatConversationRepository.ts` is exactly the right hook point. However, a dedicated spec must be written before any code is touched. The spec must at minimum define the participant management API contracts, the widened access predicate logic, the new ACL feature (`ai_assistant.conversations.share`), sharing events, and the 5 integration test scenarios from the issue. Implementation can proceed in approximately one sprint once the spec is approved.

---

## Changelog

### 2026-05-22
- Initial pre-implementation analysis for Issue #1969 (AI Chat Conversation Sharing).
