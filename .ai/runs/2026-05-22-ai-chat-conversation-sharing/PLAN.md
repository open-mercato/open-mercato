# Execution Plan — ai-chat-conversation-sharing

Source spec: .ai/specs/2026-05-22-ai-chat-conversation-sharing.md

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Add `deleted_at` to AiChatConversationParticipant entity | done | 898e7b241 |
| 1 | 1.2 | Generate migration for `deleted_at` + partial index | done | 74e1dd645 |
| 1 | 1.3 | Add `ai_assistant.conversations.share` ACL feature + setup.ts grants | done | c511be5f4 |
| 1 | 1.4 | Implement `loadParticipantFlag` in AiChatConversationRepository | done | d312a07a0 |
| 1 | 1.5 | Widen `canAccessConversation` + update callsites (getById, update, softDelete) | done | d7ca29b89 |
| 1 | 1.6 | Widen `list` query to include participant-accessible conversations | done | 01f93e521 |
| 1 | 1.7 | Add `visibility`, `participantCount`, `isOwner` to serializeAiChatConversation | done | 8eb57aa50 |
| 1 | 1.8 | Implement GET /conversations/:id/participants route | done | 4571e37ad |
| 1 | 1.9 | Implement POST /conversations/:id/participants route | done | 4571e37ad |
| 1 | 1.10 | Implement DELETE /conversations/:id/participants/:userId route | done | 4571e37ad |
| 1 | 1.11 | Add conversation.shared + conversation.unshared events; emit from routes | done | 5945a3cce |
| 2 | 2.1 | Create notifications.ts with ai_assistant.conversation_shared type | done | — |
| 2 | 2.2 | Create subscribers/conversation-shared-notify.ts | todo | — |
| 2 | 2.3 | Create notifications.client.ts renderer | todo | — |
| 2 | 2.4 | Add i18n keys to ai_assistant locale file | todo | — |
| 2 | 2.5 | Implement ConversationShareDialog.tsx component | todo | — |
| 2 | 2.6 | Wire share button in conversation tab header | todo | — |
| 3 | 3.1 | TC-AI-sharing-01: owner access baseline integration test | todo | — |
| 3 | 3.2 | TC-AI-sharing-02: shared participant access integration test | todo | — |
| 3 | 3.3 | TC-AI-sharing-03: non-participant denial integration test | todo | — |
| 3 | 3.4 | TC-AI-sharing-04: manager override integration test | todo | — |
| 3 | 3.5 | TC-AI-sharing-05: cross-tenant denial integration test | todo | — |

---

## Goal

Wire owner-initiated, participant-based sharing for server-side AI chat conversations. A conversation owner can add named users in the same tenant/org as viewers; those users gain immediate read access to the transcript via the existing conversation APIs. Revoke is soft-delete.

## Scope

- `packages/ai-assistant/src/modules/ai_assistant/` — all changes
- DB migration: `deleted_at` nullable column + partial active-participant index on `ai_chat_conversation_participants`
- New ACL feature: `ai_assistant.conversations.share`
- New routes: GET/POST `/participants`, DELETE `/participants/:userId`
- Repository: `loadParticipantFlag`, widened `canAccessConversation`, widened `list`, enriched `serializeAiChatConversation`
- Events: `conversation.shared`, `conversation.unshared`
- Notifications: `notifications.ts`, `notifications.client.ts`, subscriber
- UI: `ConversationShareDialog`, share button in tab header
- Integration tests: 5 TC-AI-sharing-* test cases

## Non-goals

- Commenter write access (`appendMessage` remains owner-only)
- RBAC role-based sharing (individual users only)
- Email / push notifications (in-app only)
- `last_read_at` update endpoint

## Risks

- Cross-tenant isolation in `loadParticipantFlag` — MUST include `tenantId + organizationId` in the EXISTS query
- `visibility` auto-transition must be atomic with participant insert/update
- Notification subscriber must be async (fire-after-commit) to not block the participants route

## External References

None (`--skill-url` not used).

---

## Implementation Plan

### Phase 1 — Predicate + API + ACL + Events + Migration

**Step 1.1** — Add `deleted_at` to `AiChatConversationParticipant` entity
- In `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts`, add `@Property({ nullable: true }) deletedAt?: Date` to the `AiChatConversationParticipant` entity (match the snake_case `deleted_at` column naming convention via `@Property({ fieldName: 'deleted_at', nullable: true })`).

**Step 1.2** — Generate migration for `deleted_at` + partial index
- Run `yarn db:generate` in the ai-assistant package context.
- Review the emitted migration SQL: confirm it adds `alter table "ai_chat_conversation_participants" add column "deleted_at" timestamptz null;` and a partial index `create index ... where "deleted_at" is null`.
- If `yarn db:generate` emits unrelated migrations, delete them; keep only the intended SQL.

**Step 1.3** — Add `ai_assistant.conversations.share` ACL feature + setup.ts grants
- In `acl.ts`: add `{ id: 'ai_assistant.conversations.share', title: 'Share AI Assistant Conversations', module: 'ai_assistant' }`.
- In `setup.ts` `defaultRoleFeatures`: grant `ai_assistant.conversations.share` to admin and employee roles.
- Note: `yarn mercato auth sync-role-acls` is a runtime command, not needed in CI; document it in a code comment.

**Step 1.4** — Implement `loadParticipantFlag` in `AiChatConversationRepository`
- Add private method `loadParticipantFlag(em, tenantId, organizationId, conversationId, userId): Promise<boolean>` that runs a single EXISTS query on `ai_chat_conversation_participants` scoped by all 4 fields plus `deleted_at IS NULL`.

**Step 1.5** — Widen `canAccessConversation` + update callsites
- Change `canAccessConversation` signature to accept `ctx: { userId: string; canManageConversations: boolean; isParticipant?: boolean }`.
- Add `|| ctx.isParticipant === true` to the return expression.
- In `getById`, `update`, and `softDelete`: when `!ctx.canManageConversations && row.ownerUserId !== ctx.userId`, pre-load `isParticipant` via `loadParticipantFlag` before calling `canAccessConversation`.
- Note: `softDelete` and `update` must still reject viewers (read-only); add a separate `isOwner` check for those write paths.

**Step 1.6** — Widen `list` query
- In the `list` method, add a sub-query / OR clause: include conversations where the caller has a non-deleted participant row. The existing `list` already returns owner conversations; UNION with `conversation_id IN (SELECT conversation_id FROM ai_chat_conversation_participants WHERE user_id = :userId AND deleted_at IS NULL AND tenant_id = :tenantId AND organization_id = :orgId)`.
- Ensure the aggregate sort by `last_message_at DESC` still applies across the union.

**Step 1.7** — Enrich `serializeAiChatConversation`
- Add `visibility: row.visibility`, `participantCount: number` (requires a COUNT query — add a `getParticipantCount(em, tenantId, orgId, conversationId): Promise<number>` helper), and `isOwner: row.ownerUserId === ctx.userId` to the serialized output.

**Step 1.8** — GET /participants route
- Create `api/ai/conversations/[conversationId]/participants/route.ts`.
- Access: owner OR `ai_assistant.conversations.manage`.
- Query: load all active (`deleted_at IS NULL`) participant rows for the conversation; join or load the user display info (name, email) from the auth module users API or entity.
- Response: `{ participants: [...] }`.
- Export `openApi`, declare `metadata.GET` with `requireAuth: true, requireFeatures: ['ai_assistant.view']`.

**Step 1.9** — POST /participants route
- Same file as GET (both handled in `route.ts`).
- Access: conversation owner AND `ai_assistant.conversations.share` feature.
- Validate: `userId` is UUID in same org, `role` is `'viewer'`, not owner, not already active participant.
- Restore soft-deleted row if exists; otherwise insert.
- Atomically update `conversation.visibility` to `'shared'` if it was `'private'`.
- Export `openApi`, `metadata.POST`.

**Step 1.10** — DELETE /participants/:userId route
- Create `api/ai/conversations/[conversationId]/participants/[userId]/route.ts`.
- Access: conversation owner AND `ai_assistant.conversations.share` feature. Cannot revoke self (owner).
- Soft-delete: set `deleted_at = now()`.
- Atomically recompute `visibility`: count remaining non-deleted non-owner participants; if 0, set `visibility` to `'private'`.
- Export `openApi`, `metadata.DELETE`.

**Step 1.11** — Add events + emit
- In `events.ts`, add to the existing `createModuleEvents` call (or create a second one if events are split by entity):
  - `conversation.shared`: payload `{ conversationId, ownerUserId, targetUserId, role, tenantId, organizationId }`
  - `conversation.unshared`: payload `{ conversationId, ownerUserId, targetUserId, tenantId, organizationId }`
- Emit `conversation.shared` after successful commit in the POST /participants handler.
- Emit `conversation.unshared` after successful commit in the DELETE /participants/:userId handler.

### Phase 2 — UI + Notifications

**Step 2.1** — Create `notifications.ts`
- New file `packages/ai-assistant/src/modules/ai_assistant/notifications.ts`.
- Export `notificationTypes` array containing one entry: `{ id: 'ai_assistant.conversation_shared', module: 'ai_assistant', ... }` following the `NotificationTypeDefinition` shape from `@open-mercato/core`.

**Step 2.2** — Create subscriber
- New file `subscribers/conversation-shared-notify.ts`.
- Export default handler + `metadata: { event: 'ai_assistant.conversation.shared', persistent: true, id: 'ai-conversation-shared-notify' }`.
- When fired, call the notification service to create an in-app notification for the target user.

**Step 2.3** — Create `notifications.client.ts`
- New file `notifications.client.ts`.
- Export renderers for `ai_assistant.conversation_shared`: title from `useT('notifications.conversation_shared.title')`, body with owner name and conversation title, action link to open the conversation.

**Step 2.4** — Add i18n keys
- In `packages/ai-assistant/src/modules/ai_assistant/i18n/` (or wherever the ai_assistant locale file lives), add all keys listed in the spec's i18n section under `chat.share.*` and `notifications.conversation_shared.*`.

**Step 2.5** — Implement `ConversationShareDialog.tsx`
- New file `components/ConversationShareDialog.tsx`.
- Props: `{ conversationId: string; onClose: () => void }`.
- On mount: fetch participant list via `apiCall` GET /participants.
- User search: combobox backed by auth users API scoped to same org.
- Add: `useGuardedMutation` POST /participants; on 409 show flash error.
- Revoke: `useGuardedMutation` DELETE /participants/:userId; confirm with `useConfirmDialog`.
- DS: `<Dialog>`, `<FormField>`, `<StatusBadge>`, `<EmptyState>`, `<Button variant="ghost" size="icon">`, lucide-react icons `Share2`/`X`/`UserPlus`.
- Keyboard: `Cmd/Ctrl+Enter` to submit add-user form, `Escape` to close.

**Step 2.6** — Wire share button
- In the `AiChatSessions` tab header (or the component that renders tab controls), add an icon button with `Share2` icon.
- Gate: `isOwner && hasFeature('ai_assistant.conversations.share')`.
- When `participantCount > 0`, render a `<StatusBadge variant="info">` pill with the count.
- On click: open `<ConversationShareDialog>`.

### Phase 3 — Integration Tests

All tests in `packages/ai-assistant/src/modules/ai_assistant/__integration__/`.

**Step 3.1** — TC-AI-sharing-01: owner access baseline
- Create a conversation as user A. GET /:id → 200. Ensure predicate widening did not break owner access.

**Step 3.2** — TC-AI-sharing-02: shared participant read access
- Create conversation as user A. POST /participants with user B. GET /:id as user B → 200 + transcript. PATCH /:id as user B → 403. DELETE /:id as user B → 403.

**Step 3.3** — TC-AI-sharing-03: non-participant denial
- Create conversation as user A. User B has `ai_assistant.view` but no participant row. GET /:id as user B → 403/null.

**Step 3.4** — TC-AI-sharing-04: manager override
- Create conversation as user A. User C has `ai_assistant.conversations.manage`. GET /:id as user C → 200 (no participant row needed).

**Step 3.5** — TC-AI-sharing-05: cross-tenant denial
- Create conversation in tenant X. User in tenant Y guesses the `conversationId`. GET /:id as tenant-Y user → 403/null.
