# AI Chat Conversation Sharing

## TLDR
**Key Points:**
- Allow conversation owners to share server-side AI chat conversations with explicit users in the same tenant/organization, granting read-only access to the transcript without requiring the global `ai_assistant.conversations.manage` permission.
- Build on the already-deployed `ai_chat_conversation_participants` table and the explicit `TODO(ai-chat-sharing)` predicate stub in `AiChatConversationRepository`.

**Scope:**
- DB migration: add `deleted_at` to `ai_chat_conversation_participants` for soft-delete revoke and audit trail.
- Widen `canAccessConversation` to accept non-deleted participant rows as a valid access path.
- New `GET / POST / DELETE` participant management routes, gated by a new `ai_assistant.conversations.share` ACL feature.
- `visibility` field auto-transitions: `private` ↔ `shared` as non-owner participants are added/removed.
- `ai_assistant.conversation.shared` / `ai_assistant.conversation.unshared` events + in-app notification to newly added participants.
- Sharing dialog UI inside `<AiChat>`: user picker, participant list with role badge, revoke button.
- Integration tests covering all 5 access scenarios from Issue #1969.

**Concerns:**
- The participant predicate JOIN must be fully scoped to `tenant_id + organization_id` to prevent cross-tenant data leaks.
- All non-owner participants are **read-only** (viewer role) in this spec; commenter write access is deferred.
- Participant revoke is soft-delete; `deleted_at` must be added via migration before any participant data can be soft-deleted.

---

## Overview

Open Mercato's AI assistant stores conversation transcripts server-side (since `2026-05-05-ai-chat-server-side-conversation-storage`). Today, a conversation is strictly private: only the owner and users with the `ai_assistant.conversations.manage` admin override can read it. This means teams cannot hand off an investigation, escalate a chat thread to a colleague, or review a teammate's AI-generated analysis without granting full admin access.

This spec adds **owner-initiated, participant-based sharing**: a conversation owner adds a named user as a viewer; that user immediately gains access to the live transcript through the same conversation APIs, without needing any elevated permission. The data model is already deployed (`ai_chat_conversation_participants`); this spec wires the access predicate, adds the management API, adds the sharing UI, and defines the notification path.

> **Market Reference**: Notion and Linear both model document/issue sharing as an additive participants list (owner → viewer → commenter → editor), where the base access level is viewer and write access is explicitly elevated. We adopt their "start read-only, explicit write escalation" pattern: MVP participants are viewer-only; commenter writes are a follow-up. We reject Slack's thread-broadcast model (everyone in the channel sees it) because AI chat transcripts contain sensitive agent inputs and must remain explicitly shared.

---

## Problem Statement

- A conversation owner cannot share a transcript with a colleague without making that colleague a global `ai_assistant.conversations.manage` admin — an over-privileged grant for a one-off share.
- There is no delegation or handoff path: finishing an AI investigation and sharing the context with the person who will act on it requires copying transcript text manually.
- The `TODO(ai-chat-sharing)` comment in `AiChatConversationRepository.ts:32-34` explicitly marks the predicate gap; `canAccessConversation` currently accepts only `ownerUserId === ctx.userId || canManageConversations`.
- The deployed `ai_chat_conversation_participants` table and `visibility` column on `ai_chat_conversations` were reserved specifically for this feature and have never been activated.

---

## Proposed Solution

Three coordinated changes make sharing work:

1. **Access predicate widening** — `canAccessConversation` gains an `isParticipant` flag; callers pre-load the flag from a tenant-scoped EXISTS query on `ai_chat_conversation_participants` before calling the predicate. All existing conversation read paths (get by id, transcript, list) check it.

2. **Participant management API** — three new routes under `/api/ai_assistant/ai/conversations/:conversationId/participants`: list, add, and revoke. Add and revoke are owner-only and require the new `ai_assistant.conversations.share` feature. Revoke uses soft-delete (`deleted_at`).

3. **Sharing UI** — a share button in the `<AiChat>` conversation tab header opens a modal with a user picker, role selector (viewer only for MVP), active participant list, and per-participant revoke button.

The `conversation.visibility` field transitions automatically: `private` → `shared` on first non-owner participant added; `shared` → `private` when the last non-owner participant is soft-deleted. This allows the UI to surface a "shared" badge on the conversation tab without a separate API call.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Pre-load `isParticipant` flag at route layer, pass to predicate | Keeps `canAccessConversation` a pure, fast predicate. Avoids N+1 by doing a single EXISTS query per conversation access. |
| Soft-delete revoke with `deleted_at` | Matches the soft-delete pattern used on conversations and messages. Provides an audit trail; participant history survives revoke. |
| Owner-only add/remove | Avoids complex delegation chains in MVP. A participant cannot re-share. |
| `visibility` auto-transition | Decouples the share state indicator from the participant count query. The UI can render a share badge from the conversation summary without fetching participants. |
| Read-only viewer for all non-owner participants | `appendMessage` currently hard-checks owner; enabling commenter writes requires a separate design pass. Deferred explicitly. |
| User picker scoped to `ai_assistant.view` grantees | A user who cannot access the AI chat panel cannot usefully participate. Filtering to feature holders also prevents sharing to users in the same org but a different product context. |
| `GET /participants` open to owner + manager, not shared readers | Participants can see they have access (the transcript loads), but the full participant list is privileged metadata. Viewer can see the participant count from the serialized conversation object. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Hard-delete for revoke | No audit trail; violates the soft-delete convention used for conversations and messages throughout this module. |
| RBAC role-based sharing (share with "all admins") | Adds a `rbac_role_id` column and a JOIN to the role membership table. Deferred: individual user sharing covers the primary use case; role-based is a follow-up. |
| Storing participant check in `canAccessConversation` via a DB lookup | Would make the predicate impure and require injecting a repository dependency into a static helper. Pre-loading at the route layer is cleaner. |
| Showing full participant list to all viewers | Participant enumeration is sensitive metadata. Viewer access grants transcript read, not org-member discovery. |

---

## User Stories / Use Cases

- **Operator** wants to **share an AI analysis conversation with a colleague** so that **the colleague can read the full transcript without being made an AI admin**.
- **Operator** wants to **revoke a share** so that **a user who no longer needs access cannot read the transcript**.
- **Operator** wants to **see who a conversation is shared with** so that **they can manage access from the chat UI**.
- **Shared viewer** wants to **open a conversation shared with them** so that **they can read the transcript using normal AI chat navigation**.
- **Administrator** wants to **see shared conversations in the manage view** so that **they can audit sharing activity across the team**.

---

## Architecture

```text
<AiChat> tab header
  └─ Share button (gated: ai_assistant.conversations.share, owner only)
       └─ <ConversationShareDialog>
            ├─ GET /api/ai_assistant/ai/conversations/:id/participants   (list)
            ├─ POST /api/ai_assistant/ai/conversations/:id/participants  (add)
            └─ DELETE /api/ai_assistant/ai/conversations/:id/participants/:userId (revoke)

Conversation read paths (get, transcript, list):
  AiChatConversationRepository
    ├─ loadParticipantFlag(tenantId, orgId, conversationId, userId)  [new]
    └─ canAccessConversation(row, { userId, canManageConversations, isParticipant })  [widened]

Events (packages/ai-assistant/src/modules/ai_assistant/events.ts):
  ai_assistant.conversation.shared   → subscribers/conversation-shared-notify.ts
  ai_assistant.conversation.unshared → (audit/log only in MVP)

Notifications:
  notifications.ts  → type: ai_assistant.conversation_shared
  notifications.client.ts → renderer for "X shared a conversation with you"
```

### Module Placement

All changes live inside `packages/ai-assistant/src/modules/ai_assistant/`:

- Repository: `data/repositories/AiChatConversationRepository.ts` (widened predicate + participant helpers)
- Participant routes: `api/ai/conversations/[conversationId]/participants/route.ts`
- Participant routes (DELETE): `api/ai/conversations/[conversationId]/participants/[userId]/route.ts`
- Events: `events.ts` (add `conversation.shared`, `conversation.unshared`)
- Notifications: `notifications.ts` (new file), `notifications.client.ts` (new file)
- Notification subscriber: `subscribers/conversation-shared-notify.ts`
- ACL: `acl.ts` (add `ai_assistant.conversations.share`)
- Setup: `setup.ts` (grant to `admin`, `employee`)
- Migration: new migration file for `deleted_at` column on `ai_chat_conversation_participants`
- UI — sharing dialog: `components/ConversationShareDialog.tsx`
- UI — share button wire-up: `components/AiChatSessions.tsx` or equivalent tab header component

### Commands & Events

**Commands** (write operations, undoable):
- `ai_assistant.conversation.participant.add` — adds a participant; undo is soft-delete
- `ai_assistant.conversation.participant.revoke` — soft-deletes a participant; undo is clearing `deleted_at`

**Events** (appended to existing `events.ts`):
- `ai_assistant.conversation.shared` — emitted after a non-owner participant is added
- `ai_assistant.conversation.unshared` — emitted after a participant is soft-deleted

Undo behavior:
- Add participant: undo by soft-deleting the row (same as revoke).
- Revoke participant: undo by clearing `deleted_at` on the participant row and resetting `visibility` if needed.

### Cache Strategy

No caching for participant reads. The participant list and conversation access checks are security-sensitive and must always reflect the live database state. If conversation summaries are later cached (per the foundation spec's forward note), cache keys must include the `userId` because `visibility` and participant membership affect what each user sees. Every participant add/revoke must invalidate `ai_assistant:conversation-list:<userId>` for the affected user and the owner.

---

## Data Models

### AiChatConversationParticipant — schema change

Existing columns are unchanged. One new column is added via migration:

| Column | Type | Notes |
|--------|------|-------|
| `deleted_at` | `timestamptz null` | Soft-delete timestamp. `null` = active participant. Non-null = revoked. |

The existing unique indexes remain valid (they do not filter on `deleted_at`). A **new partial index** is needed for the hot-path access check:

```sql
create index "ai_chat_conv_participants_active_conv_user_idx"
  on "ai_chat_conversation_participants" ("tenant_id", "organization_id", "conversation_id", "user_id")
  where "deleted_at" is null;
```

No new tables. No changes to `ai_chat_conversations` or `ai_chat_messages`.

### Serialized conversation object — additions

`serializeAiChatConversation` gains two new fields, both safe to add (additive change, no existing field removed):

| Field | Type | Notes |
|-------|------|-------|
| `visibility` | `'private' \| 'shared' \| 'organization'` | Already exists in entity; expose in the response |
| `participantCount` | `number` | Count of non-owner active participants; `0` for private |
| `isOwner` | `boolean` | `true` when the caller is the conversation owner |

---

## API Contracts

All new routes live under `/api/ai_assistant/ai/conversations/[conversationId]/participants/`.
All require `requireAuth: true` and `requireFeatures: ['ai_assistant.view']` in route `metadata`.
All inputs validated with Zod. All queries filter by `tenant_id`, `organization_id`.

### List Participants

```
GET /api/ai_assistant/ai/conversations/:conversationId/participants
```

Access: conversation owner **or** `ai_assistant.conversations.manage`. Shared viewers cannot enumerate the participant list.

Response `200`:
```json
{
  "participants": [
    {
      "userId": "uuid",
      "role": "owner",
      "addedAt": "2026-05-22T10:00:00.000Z",
      "user": { "id": "uuid", "name": "Alice Smith", "email": "alice@example.com" }
    },
    {
      "userId": "uuid",
      "role": "viewer",
      "addedAt": "2026-05-22T11:00:00.000Z",
      "user": { "id": "uuid", "name": "Bob Jones", "email": "bob@example.com" }
    }
  ]
}
```

Response `403`: caller is a shared viewer (not owner, not manager).
Response `404`: conversation not found or not accessible to caller.

---

### Add Participant

```
POST /api/ai_assistant/ai/conversations/:conversationId/participants
```

Access: conversation **owner only**. Requires `ai_assistant.conversations.share` feature.

Request:
```json
{ "userId": "uuid", "role": "viewer" }
```

Validation rules:
- `userId` must be a valid UUID referencing a staff user in the same `organization_id`.
- `role` must be `"viewer"` (only supported role in this spec; `"commenter"` is rejected with `400`).
- Cannot add the owner as a participant (already implicit).
- Cannot add a user already an active participant (returns `409 Conflict`).
- If a soft-deleted row exists for this user, restore it (clear `deleted_at`) instead of creating a duplicate.

Response `201`:
```json
{
  "participant": {
    "userId": "uuid",
    "role": "viewer",
    "addedAt": "2026-05-22T11:00:00.000Z",
    "user": { "id": "uuid", "name": "Bob Jones", "email": "bob@example.com" }
  }
}
```

Response `400`: invalid role or self-share.
Response `409`: user is already an active participant.
Response `403`: caller is not the owner or lacks `ai_assistant.conversations.share`.

Side effects (in the same transaction or immediately after commit):
1. If `conversation.visibility === 'private'`, update to `'shared'`.
2. Emit `ai_assistant.conversation.shared` event (async, after commit).

---

### Revoke Participant

```
DELETE /api/ai_assistant/ai/conversations/:conversationId/participants/:userId
```

Access: conversation **owner only**. Requires `ai_assistant.conversations.share` feature.
Cannot revoke the owner themselves.

Response `200`:
```json
{ "ok": true }
```

Side effects (in the same transaction or immediately after commit):
1. Soft-delete the participant row: set `deleted_at = now()`.
2. Count remaining non-owner active participants. If count = 0, update `conversation.visibility` to `'private'`.
3. Emit `ai_assistant.conversation.unshared` event (async, after commit).

Response `403`: caller is not the owner or lacks `ai_assistant.conversations.share`.
Response `404`: participant row not found or already revoked.

---

### Updated: Existing Conversation Routes

`GET /api/ai_assistant/ai/conversations` (list) and `GET /api/ai_assistant/ai/conversations/:conversationId` (get + transcript) both gain:

- Shared viewers now receive `200` for conversations they are an active participant in.
- The conversation serialization now includes `visibility`, `participantCount`, and `isOwner`.
- Internal change only: no URL, method, or existing response field change.

---

## Internationalization (i18n)

New keys required (namespace: `ai_assistant`):

```
chat.share.button_label            = "Share"
chat.share.dialog_title            = "Share conversation"
chat.share.add_user_placeholder    = "Search by name or email…"
chat.share.add_button              = "Add"
chat.share.role.viewer             = "Viewer"
chat.share.participants_title      = "People with access"
chat.share.owner_label             = "Owner"
chat.share.revoke_button           = "Remove access"
chat.share.revoke_aria             = "Remove access for {{name}}"
chat.share.empty_state             = "Only you have access to this conversation."
chat.share.already_shared_error    = "This user already has access."
chat.share.self_share_error        = "You cannot share a conversation with yourself."
chat.share.user_not_found_error    = "User not found."
notifications.conversation_shared.title  = "Conversation shared with you"
notifications.conversation_shared.body   = "{{ownerName}} shared an AI conversation with you: "{{title}}""
```

---

## UI/UX

### Share Button

Location: conversation tab header (same row as the tab rename control), visible only when:
- The caller is the conversation owner, AND
- The caller has `ai_assistant.conversations.share` feature.

Uses lucide-react `Share2` icon (size `size-4`). Icon-only button with `aria-label={t('chat.share.button_label')}`. Renders a `<StatusBadge variant="info">` pill showing participant count when `participantCount > 0`.

### Conversation Share Dialog

A standard `<Dialog>` (from `@open-mercato/ui/primitives/dialog`). Supports `Cmd/Ctrl+Enter` to submit the add-user form and `Escape` to close.

```
┌─────────────────────────────────────────┐
│ Share conversation              [✕]      │
│─────────────────────────────────────────│
│ [Search by name or email…]  [Viewer ▾]  │
│                                 [Add]   │
│─────────────────────────────────────────│
│ People with access                      │
│                                         │
│  Alice Smith (you)           Owner      │
│  Bob Jones                   Viewer [✕] │
│                                         │
│ ─── or ───                              │
│ Only you have access to this            │
│ conversation.    (EmptyState)           │
└─────────────────────────────────────────┘
```

Design System requirements:
- User search input: `<FormField label={t('chat.share.add_user_placeholder')}>` wrapping a combobox/autocomplete input.
- Role selector: `<Select>` with `viewer` as the only option (grayed-out `commenter` with tooltip "Coming soon" is acceptable but optional).
- Participant list: plain list of rows; each row uses `text-sm` for name, `text-xs text-muted-foreground` for email.
- Role badge: `<StatusBadge variant="neutral">` for viewer, `<StatusBadge variant="warning">` for owner.
- Revoke button: icon-only `<Button variant="ghost" size="icon">` with lucide-react `X` (size `size-4`) and `aria-label={t('chat.share.revoke_aria', { name })}`.
- Empty state: `<EmptyState description={t('chat.share.empty_state')} />` shown when only the owner row exists.
- Error flash: `flash(t('chat.share.already_shared_error'), 'error')` on 409.
- All writes wrapped in `useGuardedMutation(...).runMutation(...)` (dialog is not a `CrudForm`). Include `retryLastMutation` in the injection context.

---

## Migration & Compatibility

### Database Migration

One migration adds a single nullable column and one partial index. No backfill required (all existing rows have `null` as the effective state, which means active, consistent with the new semantics).

```sql
-- up
alter table "ai_chat_conversation_participants"
  add column "deleted_at" timestamptz null;

create index "ai_chat_conv_participants_active_conv_user_idx"
  on "ai_chat_conversation_participants" ("tenant_id", "organization_id", "conversation_id", "user_id")
  where "deleted_at" is null;

-- down
drop index if exists "ai_chat_conv_participants_active_conv_user_idx";
alter table "ai_chat_conversation_participants" drop column if exists "deleted_at";
```

Can be deployed without downtime. The migration is backward-compatible: existing rows get `deleted_at = null` (active), which is the correct state.

### API Backward Compatibility

- No existing routes removed, renamed, or narrowed.
- `serializeAiChatConversation` gains new optional fields (`visibility`, `participantCount`, `isOwner`). Existing consumers that do not read these fields are unaffected.
- The `ai_assistant.conversations.manage` feature ID is unchanged.
- Shared readers now receive `200` from conversation read endpoints they previously received `403` or `404` from. This is an intentional widening, not a breaking change.

### ACL Feature Sync

After adding `ai_assistant.conversations.share` to `acl.ts` and `setup.ts`:
```bash
yarn mercato auth sync-role-acls
```

---

## Implementation Plan

### Phase 1 — Predicate + API + ACL + Events + Migration

1. Add `deleted_at` column to `AiChatConversationParticipant` entity (`data/entities.ts`).
2. Run `yarn db:generate` to emit the migration; review SQL and partial index.
3. Add `ai_assistant.conversations.share` to `acl.ts`. Grant to `admin` and `employee` in `setup.ts` `defaultRoleFeatures`. Run `yarn mercato auth sync-role-acls`.
4. Add `loadParticipantFlag(tenantId, orgId, conversationId, userId): Promise<boolean>` to `AiChatConversationRepository` — a single EXISTS query on `ai_chat_conversation_participants` where `deleted_at IS NULL`.
5. Widen `canAccessConversation` to accept `isParticipant?: boolean`; update all three callsites (`getById`, `update`, `softDelete`) to pre-load the flag when `!ctx.canManageConversations && ownerUserId !== ctx.userId`.
6. Update `list` query to include conversations where the caller is a non-deleted participant (add a UNION or OR clause on `conversation_id IN (SELECT conversation_id FROM ai_chat_conversation_participants WHERE user_id = :userId AND deleted_at IS NULL AND ...)`).
7. Add `participantCount` and `visibility` to `serializeAiChatConversation` output. Add `isOwner`.
8. Implement `GET /api/ai_assistant/ai/conversations/:conversationId/participants/route.ts` — list active participants with user metadata. Zod-validate `conversationId`.
9. Implement `POST /api/ai_assistant/ai/conversations/:conversationId/participants/route.ts` — add participant. Handle restore-of-soft-deleted case. Atomically update `visibility`. Export `openApi`.
10. Implement `DELETE /api/ai_assistant/ai/conversations/:conversationId/participants/[userId]/route.ts` — soft-delete participant. Atomically recompute `visibility`. Export `openApi`.
11. Add `conversation.shared` and `conversation.unshared` events to `events.ts` using `createModuleEvents()` with `as const`. Emit from POST and DELETE route handlers respectively.

### Phase 2 — UI + Notifications

1. Create `notifications.ts` declaring notification type `ai_assistant.conversation_shared` (fields: `conversationId`, `conversationTitle`, `ownerUserId`, `ownerName`, `targetUserId`).
2. Create `subscribers/conversation-shared-notify.ts` — subscribe to `ai_assistant.conversation.shared`; create in-app notification for `targetUserId` using the notification service.
3. Create `notifications.client.ts` — renderer for `ai_assistant.conversation_shared`: title from i18n, body with owner name and conversation title, link to open the conversation.
4. Add i18n keys to the `ai_assistant` locale file (all keys listed in the i18n section above).
5. Implement `components/ConversationShareDialog.tsx` — dialog with user search, participant list, add/revoke using `useGuardedMutation`. Follow DS requirements from the UI/UX section.
6. Wire the share button in the conversation tab header component (gated by `isOwner && hasFeature('ai_assistant.conversations.share')`). Render `<StatusBadge>` pip when `participantCount > 0`.

### Phase 3 — Integration Tests

Implement in `packages/ai-assistant/src/modules/ai_assistant/__integration__/`:

1. **TC-AI-sharing-01-owner-access** — owner can read their own conversation (baseline, ensures predicate widening does not regress owner access).
2. **TC-AI-sharing-02-participant-access** — shared viewer can load transcript after being added as participant; cannot update, cannot delete.
3. **TC-AI-sharing-03-non-participant-denial** — a user with `ai_assistant.view` but no participant row receives `403` / `null` from get-by-id.
4. **TC-AI-sharing-04-manager-override** — a user with `ai_assistant.conversations.manage` can read conversations they do not own and are not a participant in.
5. **TC-AI-sharing-05-cross-tenant-denial** — a user from a different tenant cannot access a conversation even by guessing the `conversationId`.

Each test: create required fixtures via API in setup, assert response codes and body shapes, clean up all created records in `finally`.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `data/entities.ts` | Modify | Add `deleted_at` to `AiChatConversationParticipant` |
| `migrations/Migration<timestamp>_ai_assistant.ts` | Create | Add `deleted_at` column + partial index |
| `acl.ts` | Modify | Add `ai_assistant.conversations.share` |
| `setup.ts` | Modify | Grant `ai_assistant.conversations.share` to admin and employee |
| `data/repositories/AiChatConversationRepository.ts` | Modify | `loadParticipantFlag`, widen `canAccessConversation`, widen `list`, add `serializeAiChatConversation` fields |
| `api/ai/conversations/[conversationId]/participants/route.ts` | Create | GET + POST participant management |
| `api/ai/conversations/[conversationId]/participants/[userId]/route.ts` | Create | DELETE (revoke) |
| `events.ts` | Modify | Add `conversation.shared`, `conversation.unshared` |
| `notifications.ts` | Create | `ai_assistant.conversation_shared` notification type |
| `notifications.client.ts` | Create | In-app notification renderer |
| `subscribers/conversation-shared-notify.ts` | Create | Event → notification subscriber |
| `components/ConversationShareDialog.tsx` | Create | Sharing dialog UI |
| `i18n/<locale>.json` | Modify | New `chat.share.*` and `notifications.conversation_shared.*` keys |

---

## Risks & Impact Review

### Data Integrity Failures

**Risk: Non-transactional participant + visibility update**
- **Scenario**: `POST /participants` creates the participant row but crashes before updating `conversation.visibility`. Conversation stays `private` even though a participant exists.
- **Severity**: Medium
- **Affected area**: `visibility` accuracy in UI; no security impact (access predicate checks participant rows, not `visibility`).
- **Mitigation**: Wrap participant insert and visibility update in a single ORM transaction.
- **Residual risk**: Low. `visibility` is a display field; the access predicate is authoritative.

**Risk: Duplicate participant on concurrent add**
- **Scenario**: Two requests add the same user simultaneously, both pass the "no active participant" check before either commits.
- **Severity**: Low
- **Affected area**: `ai_chat_conversation_participants` unique constraint.
- **Mitigation**: The existing unique index on `(tenant_id, organization_id, conversation_id, user_id)` will cause a unique constraint violation on the second insert. The route catches this and returns `409 Conflict`.
- **Residual risk**: Low. DB constraint is the safety net.

### Cascading Failures & Side Effects

**Risk: Notification subscriber failure blocks conversation read**
- **Scenario**: The `conversation-shared-notify` subscriber throws; if the event bus is synchronous, the add-participant request fails.
- **Severity**: Medium
- **Affected area**: `POST /participants` reliability.
- **Mitigation**: Emit event **after** the transaction commits (fire-and-forget / async). Use persistent subscriber so delivery retries on failure without blocking the main path.
- **Residual risk**: Low. In-app notification may be delayed on subscriber failure but does not affect sharing itself.

### Tenant & Data Isolation Risks

**Risk: Cross-tenant participant lookup**
- **Scenario**: Participant EXISTS check omits `tenant_id` / `organization_id` filter; a user from another tenant shares the same internal `user_id` UUID and gains access.
- **Severity**: Critical
- **Affected area**: All conversation read paths widened by the new predicate.
- **Mitigation**: `loadParticipantFlag` MUST filter by `tenantId`, `organizationId`, `conversationId`, `userId`, `deleted_at IS NULL`. This is enforced in code and verified by TC-AI-sharing-05.
- **Residual risk**: Low after mitigation. Cross-tenant denial test is mandatory.

**Risk: User picker returns cross-tenant users**
- **Scenario**: The sharing dialog's user search endpoint doesn't filter by `organization_id`, surfacing users from sibling organizations.
- **Severity**: High
- **Affected area**: User search in sharing dialog.
- **Mitigation**: User search must call the existing tenant-scoped auth module users API (already filtered by `organization_id`). The server-side POST /participants additionally validates the target `userId` is in the same `organization_id` before inserting.
- **Residual risk**: Low.

### Migration & Deployment Risks

**Risk: Migration on large participant table**
- **Scenario**: Adding `deleted_at` to a large `ai_chat_conversation_participants` table takes a lock and causes downtime.
- **Severity**: Low
- **Affected area**: Deployment window.
- **Mitigation**: `ALTER TABLE ... ADD COLUMN ... NULL` with no default is a metadata-only operation in PostgreSQL 11+ (no table rewrite). The partial index creation is `CREATE INDEX CONCURRENTLY`-eligible if needed. For the initial rollout (few rows), standard migration is fine.
- **Residual risk**: Very low.

### Operational Risks

**Risk: `list` query performance with participant UNION**
- **Scenario**: A user is a participant in many shared conversations across many agents. The UNION or OR clause in the list query becomes a full scan.
- **Severity**: Medium
- **Affected area**: `GET /conversations` list endpoint.
- **Mitigation**: The `ai_chat_conv_participants_active_conv_user_idx` partial index (added in this spec) covers the participant lookup path. The query plan should index-scan on `(tenant_id, organization_id, user_id, conversation_id) WHERE deleted_at IS NULL`. Monitor query explain on first deployment.
- **Residual risk**: Low. Flag for review if a tenant accumulates >10 000 shared conversations per user.

---

## Final Compliance Report

```markdown
## Final Compliance Report — 2026-05-22

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/ai-assistant/AGENTS.md`
- `packages/core/AGENTS.md` (sections: Access Control, API Routes, Events)
- `packages/ui/AGENTS.md` (sections: CrudForm, DataTable, Notifications)
- `packages/core/src/modules/auth/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Participant → conversation via FK id; no cross-module ORM |
| root AGENTS.md | Filter by `organization_id` | Compliant | All queries scope by `tenantId + organizationId` |
| root AGENTS.md | Modules must remain isomorphic and independent | Compliant | No new cross-module ORM links |
| root AGENTS.md | Zod validation for all inputs | Compliant | `conversationId`, add/revoke body schemas validated at route layer |
| root AGENTS.md | `findWithDecryption` for entity queries | Compliant | Repository uses existing `findOneWithDecryption`/`findWithDecryption` |
| root AGENTS.md | `setup.ts` declares `defaultRoleFeatures` | Compliant | New `ai_assistant.conversations.share` granted to admin + employee |
| root AGENTS.md | ACL features — never rename stored IDs | Compliant | `ai_assistant.conversations.manage` unchanged; new feature added |
| root AGENTS.md | Events via `createModuleEvents()` | Compliant | `conversation.shared` / `conversation.unshared` declared with `as const` |
| root AGENTS.md | Cross-module side effects via events | Compliant | Notification subscriber via events.ts, not direct import |
| packages/core/AGENTS.md | API routes export `openApi` | Compliant | All three new routes export `openApi` |
| packages/core/AGENTS.md | `metadata` exports per-method `requireAuth` / `requireFeatures` | Compliant | No top-level `export const requireAuth` |
| packages/ai-assistant/AGENTS.md | Encryption maps for PII | N/A | Participant table stores only `user_id` UUID and timestamps — not PII columns requiring encryption maps |
| packages/ui/AGENTS.md | Non-CrudForm writes via `useGuardedMutation` | Compliant | Share dialog is not a CrudForm; all writes use `useGuardedMutation` |
| packages/ui/AGENTS.md | Dialog supports Cmd+Enter / Escape | Compliant | Specified in UI/UX section |
| packages/ui/AGENTS.md | i18n keys for all user-facing strings | Compliant | All strings listed in i18n section |
| root AGENTS.md (DS Rules) | No hardcoded status colors | Compliant | StatusBadge variants; no `text-red-*` / `bg-green-*` |
| root AGENTS.md (DS Rules) | No arbitrary text sizes | Compliant | `text-sm`, `text-xs` — no `text-[13px]` |
| root AGENTS.md (DS Rules) | lucide-react icons, no inline svg | Compliant | `Share2`, `X`, `Users` from lucide-react |
| root AGENTS.md (DS Rules) | `aria-label` on icon-only buttons | Compliant | Revoke button has `aria-label` with user name |
| root AGENTS.md | Boy Scout rule on touched files | Compliant | No existing DS violations expected in new files |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `deleted_at` migration aligns with soft-delete revoke in DELETE route |
| API contracts match UI/UX section | Pass | Dialog calls GET/POST/DELETE participants; response shapes used in list render |
| Risks cover all write operations | Pass | Add, revoke, and visibility update all covered |
| Commands defined for all mutations | Pass | `participant.add` and `participant.revoke` commands declared |
| Cache strategy covers all read APIs | Pass | No caching for participant reads; forward note on invalidation if conversation list is cached |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved, ready for implementation.
```

---

## Changelog

### 2026-05-22
- Initial specification. Answers applied: UI included in scope (Q1), soft-delete revoke with `deleted_at` (Q2), participant roles on individual users only (Q3).

### Review — 2026-05-22
- **Reviewer**: Agent (spec-writing skill)
- **Security**: Passed — cross-tenant isolation covered in risks + TC-05; participant lookup scoping enforced at query layer
- **Performance**: Passed — partial index on active participants; list query UNION path flagged for monitoring
- **Cache**: Passed — no caching; forward invalidation note included
- **Commands**: Passed — add + revoke commands declared with undo semantics
- **Risks**: Passed — 5 risks documented with severity, mitigation, residual risk
- **Verdict**: Approved
