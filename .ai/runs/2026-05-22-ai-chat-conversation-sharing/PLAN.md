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
| 2 | 2.2 | Create subscribers/conversation-shared-notify.ts | done | — |
| 2 | 2.3 | Create notifications.client.ts renderer | done | — |
| 2 | 2.4 | Add i18n keys to ai_assistant locale file | done | — |
| 2 | 2.5 | Implement ConversationShareDialog.tsx component | done | — |
| 2 | 2.6 | Wire share button in conversation tab header | done | 568fbfdd2 |
| 3 | 3.1 | TC-AI-sharing-01: owner access baseline integration test | done | e09edb32d |
| 3 | 3.2 | TC-AI-sharing-02: shared participant access integration test | done | e09edb32d |
| 3 | 3.3 | TC-AI-sharing-03: non-participant denial integration test | done | e09edb32d |
| 3 | 3.4 | TC-AI-sharing-04: manager override integration test | done | e09edb32d |
| 3 | 3.5 | TC-AI-sharing-05: cross-tenant denial integration test | done | e09edb32d |
| 4 | 4.1 | Sync i18n keys to de/es/pl locale files | done | 85b804419 |
| 4 | 4.2 | Fix notification linkHref — open AI dock with shared conversation instead of playground | done | 0b311d73a |
| 4 | 4.3 | Expose `createdByUserId` in serialized messages; render owner messages distinctly for viewers | done | 821c0ab35 |
| 4 | 4.4 | Fix notification "View Conversation" action — navigates to `/backend` instead of deep-link | done | c13b830ec |
| 4 | 4.5 | Fix `deepLinkHandledRef` not reset on chat close — second open of same conversation silently blocked | done | e82b4a902 |
| 4 | 4.6 | Fix shared conversation opens without tab strip — activate session from server sync so normal tabs show | done | f58fd19f3 |
| 4 | 4.7-review-fix-1 | Fix Cmd/Ctrl+Enter shortcut + Content-Type headers in ConversationShareDialog | done | 283fa390c |
| 4 | 4.7-review-fix-2 | Scrub absolute filesystem path from HANDOFF.md | done | f5fe4a824 |
| 5 | qa-fix-1 | Enrich GET /conversations/:id response with isOwner + participantCount (BUG-003) | done | 623b7cb96 |
| 5 | qa-fix-2 | Harden POST /participants: role→viewer-only, userId scope, self-share→400, dup→409 (BUG-001/BUG-007) | done | dc48614ff |
| 5 | qa-fix-3 | Remove canManageConversations bypass from addParticipant/revokeParticipant; block owner-revoke (BUG-002) | done | 4d5e421fd |
| 5 | qa-fix-4 | Fix GET /participants: 403/404 for non-owner/non-manager instead of silent 200 [] (BUG-006) | done | 4eddb9333 |
| 5 | qa-fix-5 | Make setActiveSession idempotent — fix infinite render loop for shared conversation viewers (BUG-008) | done | cc05e44f1 |
| 5 | qa-fix-6 | Hide composer + show read-only banner for participant viewers in AiChat (BUG-009) | done | 873d42f8c |
| 5 | qa-fix-7 | Exclude conversation owner from user picker in ConversationShareDialog (BUG-004) | done | 1c245868a |

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

---

### Phase 4 — Missing i18n, notification link fix, and viewer message rendering

**Step 4.1** — Sync i18n keys to de/es/pl locale files
- Step 2.4 added all `ai_assistant.share.*` and `ai_assistant.notifications.conversation_shared.*` keys **only to `en.json`**.
- Files `de.json`, `es.json`, `pl.json` have none of these keys — the notification title renders as the raw i18n key (`ai_assistant.notifications.conversation_shared.title`) for users in non-English locales.
- Add all missing keys to `de.json`, `es.json`, `pl.json` with the same English text as fallback (proper translations are a follow-up; this unblocks rendering).
- Keys to sync (source: `packages/ai-assistant/src/modules/ai_assistant/i18n/en.json`):
  - `ai_assistant.notifications.conversation_shared.title`
  - `ai_assistant.notifications.conversation_shared.body`
  - `ai_assistant.notifications.conversation_shared.view_button`
  - `ai_assistant.share.dialogTitle`
  - `ai_assistant.share.addParticipant`
  - `ai_assistant.share.participantPlaceholder`
  - `ai_assistant.share.removeParticipant`
  - `ai_assistant.share.noParticipants`
  - `ai_assistant.share.shareButton`
  - `ai_assistant.share.saving`
  - `ai_assistant.share.saved`
  - `ai_assistant.share.dialogDescription` (in JSX fallback, may be missing from en.json too — add if so)
  - `ai_assistant.share.selectUser`
  - `ai_assistant.share.allUsersAdded`
- Run `yarn i18n:check-sync` after to confirm all locales are in sync.

**Step 4.2** — Fix notification `linkHref` — open AI dock with shared conversation instead of playground
- Current state: `notifications.ts` and `conversation-shared-notify.ts` hardcode `linkHref: '/backend/config/ai-assistant/playground'`. The playground requires `ai_assistant.settings.manage` — a regular user (viewer) does not have this feature, so the page returns 403.
- Fix in `notifications.ts`: the `actions[0].href` and `linkHref` must be accessible to any user with `ai_assistant.view`.
- The AI chat opens via the topbar dock/launcher — there is no dedicated per-conversation URL. The correct deep-link pattern is to append `?openAiConversation=<conversationId>` to `/backend`. The `AiAssistantLauncher` (in `packages/ui/src/ai/AiAssistantLauncher.tsx`) should read this query param on mount and auto-open the conversation in the dock.
- Implementation steps:
  1. In `AiAssistantLauncher.tsx`, on mount read `searchParams.get('openAiConversation')`. If set, call the existing `openConversation(conversationId)` mechanism (or session resume) to pre-load the conversation in the dock and open it.
  2. In `notifications.ts`, change `actions[0].href` to `/backend?openAiConversation=CONVERSATION_ID`. Since the type definition cannot know the conversationId at definition time, set `href` to `/backend` as a static fallback in the type def.
  3. In `conversation-shared-notify.ts`, override `linkHref` with `/backend?openAiConversation=${payload.conversationId}` so the subscriber passes the full dynamic URL. This already overrides `typeDef.linkHref` via the `options.linkHref` argument to `buildNotificationFromType`.
  4. The notification action in `notifications.ts` should also be changed from `href` (static) to use the dynamic `linkHref` from the notification row — check if `NotificationTypeDefinition.actions[].href` supports a `linkHref` passthrough; if not, keep the static `/backend` and rely solely on the notification-level `linkHref`.

**Step 4.3** — Expose `createdByUserId` in serialized messages; render owner messages distinctly for viewers
- Current state: `serializeAiChatMessage` in `conversation-storage.ts` does NOT include `createdByUserId`. `SerializedAiChatMessage` has no `senderUserId` field. The conversation GET route returns messages where every `role: 'user'` message appears to belong to the caller, so a viewer sees the owner's messages rendered as their own (right-aligned "my" bubbles, etc.).
- Fix — backend:
  1. Add `senderUserId: string | null` to `SerializedAiChatMessage` interface (mapped from `row.createdByUserId`).
  2. Update `serializeAiChatMessage` to include `senderUserId: row.createdByUserId ?? null`.
  3. In the conversation detail GET route (`[conversationId]/route.ts`), pass the caller's `userId` alongside the transcript so the response can include `callerUserId` at the conversation level (already partly done via `serializeAiChatConversation` `enrich.callerUserId`).
- Fix — frontend:
  1. The `AiChat` component loads a shared (read-only) conversation via `initialMessages`. For each loaded message, if `role === 'user'` AND `senderUserId !== currentUserId` (i.e. the owner's message being viewed by a participant), render the message as a read-only "other user" bubble — left-aligned, muted styling, prefixed with a label such as the owner's name or a generic "Owner" label.
  2. The `AiChatMessage` type in `useAiChat.ts` should accept the optional `senderUserId` field so the renderer can access it.
  3. Ensure that viewer-loaded messages do NOT get submitted to the chat dispatcher — the conversation is read-only for participants (no `appendMessage` access); the textarea should be hidden or disabled when `isOwner === false`.

**Step 4.4** — Fix notification "View Conversation" action — navigates to `/backend` instead of deep-link

Root cause (two contributing issues):

**Issue A — `notifications.ts` action `href` is static `/backend`:**
- `notifications.ts:16` defines `href: '/backend'` on the "view" action. The backend action route returns this static URL, so `NotificationItem.handleAction()` calls `router.push('/backend')` — no `openAiConversation` param, chat never opens.
- Fix: change `href` to `'/backend?openAiConversation={sourceEntityId}'`. The backend action route already performs `.replace('{sourceEntityId}', notification.sourceEntityId)`, so this is the established template pattern.

**Issue B — `ConversationSharedRenderer.handleView()` ignores `notification.linkHref` when a viewAction exists:**
- Current code navigates to `notification.linkHref` only in the `!viewAction` branch. When `viewAction` is present, it delegates entirely to `onAction()` and relies on the action result's `href`. This means that even if Issue A is fixed, the renderer itself never falls back to `linkHref`.
- Fix: after `await onAction(viewAction.id)`, also navigate to `notification.linkHref` if the action result did not provide its own `href`. More simply: always call `router.push(notification.linkHref)` after a successful `onAction()` call (the backend already handles marking the notification as actioned independently of where the user ends up).

Files to change:
- `packages/ai-assistant/src/modules/ai_assistant/notifications.ts` — `actions[0].href`
- `packages/ai-assistant/src/modules/ai_assistant/widgets/notifications/ConversationSharedRenderer.tsx` — `handleView()`

**Step 4.5** — Fix `deepLinkHandledRef` not reset on chat close — second open of same conversation silently blocked

Root cause:
- `AiAssistantLauncher.tsx` uses `deepLinkHandledRef` (a `React.useRef<string | null>`) to guard against double-handling the same deep-link conversation ID. When the chat closes, `setDeepLinkConversationId(null)` is called (line 664) but `deepLinkHandledRef.current` is **not** reset.
- Consequence: the next time the user navigates to `/backend?openAiConversation=<same-id>`, the second effect sees `deepLinkHandledRef.current === deepLinkConversationId` → `true` → returns early without fetching or opening the chat.
- This bites on every "re-open same shared conversation" interaction: close the chat, click the notification again — nothing happens.

Fix: in the `onOpenChange` handler in `AiAssistantLauncher.tsx` (around line 664), reset the ref alongside clearing state:
```typescript
if (!open) {
  setDeepLinkConversationId(null)
  deepLinkHandledRef.current = null  // ← add this line
}
```

File to change:
- `packages/ui/src/ai/AiAssistantLauncher.tsx`

---

### Phase 5 — QA Bug Fixes

**Step qa-fix-1** — Enrich GET /conversations/:id response with isOwner + participantCount (BUG-003)

Root cause: `serializeAiChatConversation(transcript.conversation)` in `api/ai/conversations/[conversationId]/route.ts` is called without the `enrich` argument, so `isOwner` is always `null` and `participantCount` is always `0`.

Fix:
1. Add `getParticipantCount(em, tenantId, orgId, conversationId): Promise<number>` to `AiChatConversationRepository` — COUNT WHERE `conversation_id = :id AND tenant_id = :tenantId AND organization_id = :orgId AND deleted_at IS NULL`.
2. In the GET handler (around line 215), after loading the transcript:
   - Fetch `participantCount` via the new method.
   - Pass `enrich: { callerUserId: callerCtx.userId, participantCount }` to `serializeAiChatConversation`.

Files:
- `packages/ai-assistant/src/modules/ai_assistant/data/repositories/AiChatConversationRepository.ts`
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/conversations/[conversationId]/route.ts`

**Step qa-fix-2** — Harden POST /participants: role→viewer-only, userId scope, self-share→400, dup→409 (BUG-001/BUG-007)

Root cause: `addParticipantBodySchema` allows `role: 'commenter'` (spec says viewer-only); no tenant/org scope check on `userId`; no self-share guard; no 409 for duplicate active participant.

Fix in `api/ai/conversations/[conversationId]/participants/route.ts`:
1. Change `role: z.enum(['viewer', 'commenter']).default('viewer')` → `role: z.literal('viewer').default('viewer')` (or `z.enum(['viewer'])`).
2. Before calling `repo.addParticipant`, load the target user from the auth repository scoped to `(tenantId, organizationId)`. If not found → 400 `{ error: 'User not found in this organization' }`.
3. If `userId === callerCtx.userId` → 400 `{ error: 'Cannot share a conversation with yourself' }`.
4. In `AiChatConversationRepository.addParticipant`, if an active (non-deleted) participant row already exists → throw a new `AiChatConversationDuplicateParticipantError`; catch it in the route and return 409 `{ error: 'User is already a participant' }`.

Files:
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/conversations/[conversationId]/participants/route.ts`
- `packages/ai-assistant/src/modules/ai_assistant/data/repositories/AiChatConversationRepository.ts`

**Step qa-fix-3** — Remove canManageConversations bypass from addParticipant/revokeParticipant; block owner-revoke (BUG-002)

Root cause: `addParticipant` and `revokeParticipant` allow any user with `ai_assistant.conversations.manage` to mutate participants of conversations they don't own. The spec says only the conversation owner can share.

Fix in `AiChatConversationRepository`:
1. `addParticipant` (line ~575): change ownership guard from `if (conv.ownerUserId !== ctx.userId && !canManageConversations(ctx))` to `if (conv.ownerUserId !== ctx.userId)`.
2. `revokeParticipant` (line ~634): same — remove `&& !canManageConversations(ctx)` from the guard.
3. `revokeParticipant`: add guard that `targetUserId !== conv.ownerUserId` (cannot revoke the owner row if one exists).

File:
- `packages/ai-assistant/src/modules/ai_assistant/data/repositories/AiChatConversationRepository.ts`

**Step qa-fix-4** — Fix GET /participants: 403/404 for non-owner/non-manager instead of silent 200 [] (BUG-006)

Root cause: `AiChatConversationRepository.listParticipants` returns `[]` silently when `canAccessConversation` fails; the GET route surfaces this as `200 { participants: [] }` for any authenticated user who guesses a UUID.

Fix in `AiChatConversationRepository.listParticipants`:
- Change the early return from `return []` to throw `AiChatConversationNotFoundError` (or `AiChatConversationAccessError`) when the caller is neither the owner nor a manager.
- In the GET route, catch the error and return 403 (access denied) or 404 (not found) accordingly — use the same pattern as other routes in the file.

Files:
- `packages/ai-assistant/src/modules/ai_assistant/data/repositories/AiChatConversationRepository.ts`
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/conversations/[conversationId]/participants/route.ts`

**Step qa-fix-5** — Make setActiveSession idempotent — fix infinite render loop for shared conversation viewers (BUG-008)

Root cause: `setActiveSession` in `AiChatSessions.tsx` always writes a new sessions array (via `lastUsedAt: Date.now()`), which invalidates the `api` `useMemo`, which creates a new `sessions` reference, which re-runs the `useEffect` in `AiAssistantLauncher.tsx` that calls `setActiveSession` again — infinite loop.

Fix in `packages/ui/src/ai/AiChatSessions.tsx`, inside the `setActiveSession` callback:
```typescript
const setActiveSession = React.useCallback(
  (sessionId: string) => {
    update((prev) => {
      const target = prev.sessions.find((s) => s.id === sessionId)
      if (!target || target.status !== 'open') return prev
      // ← ADD: skip update if this session is already active for its agent
      if (prev.activeByAgent[target.agentId] === sessionId) return prev
      const sessions = prev.sessions.map((s) =>
        s.id === sessionId ? { ...s, lastUsedAt: Date.now() } : s,
      )
      return {
        sessions,
        activeByAgent: { ...prev.activeByAgent, [target.agentId]: sessionId },
      }
    })
  },
  [update],
)
```

File:
- `packages/ui/src/ai/AiChatSessions.tsx`

**Step qa-fix-6** — Hide composer + show read-only banner for participant viewers in AiChat (BUG-009)

Root cause: when a participant (non-owner) opens a shared conversation, `isOwner` is `false` (now fixed by qa-fix-1), but the `AiChat` component still renders the textarea/send button and allows message submission. Messages from non-owners go through `appendMessage` which throws an `AiChatConversationAccessError`, resulting in a silent error for the user.

Fix in `packages/ui/src/ai/AiChat.tsx` (or the component that renders the input area):
1. Accept `isReadOnly?: boolean` prop (or derive it from `isOwner === false`).
2. When `isReadOnly` is true:
   - Hide the message composer (textarea + send button).
   - Render a read-only banner below the message list: e.g. `<p className="text-muted text-sm text-center py-2">You are viewing this conversation as a participant.</p>`.
3. The `AiAssistantLauncher` or the component that renders `AiChat` for shared conversations should pass `isReadOnly={!session?.isOwner}` (once `isOwner` is correctly populated by qa-fix-1).

Files:
- `packages/ui/src/ai/AiChat.tsx`
- `packages/ui/src/ai/AiAssistantLauncher.tsx` (pass the prop)

**Step qa-fix-7** — Exclude conversation owner from user picker in ConversationShareDialog (BUG-004)

Root cause: `availableUsers` in `ConversationShareDialog.tsx` filters out existing participants but NOT the conversation owner — so the owner appears in the "add" dropdown and selecting them results in a confusing 400 error from the backend self-share guard (added in qa-fix-2).

Fix in `packages/ui/src/ai/ConversationShareDialog.tsx`:
- Receive the `ownerUserId` (already available via `conversation.isOwner` or pass as prop).
- In the `availableUsers` filter, also exclude the owner: `users.filter((u) => !participantIds.has(u.id) && u.id !== ownerUserId)`.
- Also exclude `currentUserId` (self) from the picker for completeness.

File:
- `packages/ui/src/ai/ConversationShareDialog.tsx`
