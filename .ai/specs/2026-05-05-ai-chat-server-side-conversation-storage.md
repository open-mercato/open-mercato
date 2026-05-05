# AI Chat Server-Side Conversation Storage

## TLDR
**Key Points:**
- Move typed AI chat session metadata and message transcripts from browser `localStorage` into tenant-scoped database storage owned by the `ai_assistant` module.
- Keep the first release backward-compatible by lazily importing existing local drafts into the server store, then using server APIs as the source of truth.

**Scope:**
- Persist AI chat conversations, messages, UI parts, attachment references, and tab metadata server-side.
- Add owner-scoped APIs that later support chat sharing without changing the data model again.
- Update `<AiChat>`, `useAiChat`, `AiChatSessionsProvider`, and docs to use the server store with a local fallback only for offline/quota/privacy failures.

**Concerns:**
- Chat transcripts can contain sensitive tenant data, so every read/write must be scoped by `tenant_id`, `organization_id`, and authenticated user access.
- The migration must not erase existing browser-only transcripts.

## Overview
The typed AI framework currently stores multi-session tab metadata in `localStorage` through `AiChatSessionsProvider` and stores each conversation transcript through `useAiChat` under keys such as `om-ai-chat:<agent>:<conversationId>`. The backend chat dispatcher only receives the current message array and a stable `conversationId`; it does not own durable transcript history.

This spec introduces server-side conversation storage for the new typed AI chat surface (`POST /api/ai_assistant/ai/chat?agent=...`). The immediate benefit is durable conversations across devices and browsers for the same user. The architectural benefit is that conversations become real tenant-scoped records that can later be shared with teammates, linked to entities, searched, audited, and governed by retention policy.

> **Market Reference**: Chatwoot and Dify both model conversations as first-class server records with participant/access metadata and append-only message history. This spec adopts that durable conversation/message split and rejects unrestricted global history: Open Mercato must enforce tenant, organization, RBAC, and ownership boundaries on every operation.

## Problem Statement
Today, AI chat persistence has these limitations:

- Conversations disappear when a user clears browser storage or switches device/browser.
- There is no server-side record to share, audit, search, retain, export, or delete.
- Multi-tab chat metadata and messages are split across browser keys, which makes migration to collaboration harder.
- Pending AI actions already use `conversationId` for idempotency, but the corresponding conversation is not an entity.
- Attachment references and AI UI parts can survive in rendered local state, but they are not consistently tied to a durable chat record.

## Proposed Solution
Add server-owned AI chat conversation storage under `packages/ai-assistant/src/modules/ai_assistant/`. The database becomes the source of truth for typed AI chat sessions and transcripts. The browser keeps only short-lived in-memory state and, optionally, a small migration/fallback buffer.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Store conversations in `ai_assistant` | The chat dispatcher, agent registry, pending actions, and policies already live there. |
| Use `conversation_id` as the stable public identifier | Existing clients and pending-action idempotency already pass this value. |
| Separate conversations, messages, and participants | Avoid unbounded arrays and make future sharing additive. |
| Owner-only MVP with participant-ready schema | Delivers durable history now while avoiding premature shared-edit UI. |
| Lazy client migration | Existing local transcripts are only available in the browser that created them. Import them when the user next opens chat. |
| Append server messages from the chat API path | The request/streaming path already has the authenticated user, agent id, page context, and final assistant text. |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|--------------|
| Keep `localStorage` and sync only metadata | Does not solve cross-device, retention, sharing, or audit foundations. |
| Store full transcript JSON on one conversation row | Unbounded blob growth, poor query/index behavior, difficult per-message retention and sharing. |
| Reuse `ai_pending_actions` | Pending actions are mutation approval records with TTL semantics; chat history needs different lifecycle and access rules. |
| Implement full shared conversations in MVP | Sharing requires UI, permissions, notifications, and conflict semantics; this spec prepares the model but keeps first delivery small. |

## User Stories / Use Cases
- **Operator** wants to **reopen an AI chat on another device** so that **work is not tied to one browser profile**.
- **Operator** wants to **keep multiple AI chat sessions per agent** so that **different investigations do not overwrite each other**.
- **Administrator** wants to **prepare for shared AI chats** so that **team handoff can be added without a schema rewrite**.
- **Developer** wants to **tie pending AI actions to durable conversations** so that **mutation approvals can be explained from the surrounding chat context**.

## Architecture
The storage layer is owned by `@open-mercato/ai-assistant`:

```text
<AiChat> / AiChatSessionsProvider
  ├─ GET /api/ai_assistant/ai/conversations?agent=...
  ├─ POST /api/ai_assistant/ai/conversations
  ├─ PATCH /api/ai_assistant/ai/conversations/:conversationId
  ├─ DELETE /api/ai_assistant/ai/conversations/:conversationId
  └─ POST /api/ai_assistant/ai/chat?agent=...
        ├─ persist user message before model call
        ├─ runAiAgentText(...)
        └─ persist assistant message + UI parts after stream completion
```

### Module Placement
- Entities: `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts`
- Validators: `packages/ai-assistant/src/modules/ai_assistant/data/validators.ts`
- Repository/service: `packages/ai-assistant/src/modules/ai_assistant/data/repositories/` and `lib/conversation-storage.ts`
- API routes: `packages/ai-assistant/src/modules/ai_assistant/api/ai/conversations/...`
- UI adapter: `packages/ui/src/ai/conversation-store.ts`, consumed by `AiChatSessions.tsx` and `useAiChat.ts`

### Commands & Events
Mutations must be represented by command-style helpers even if implemented as service methods in MVP:

- **Command**: `ai_assistant.conversation.create`
- **Command**: `ai_assistant.conversation.rename`
- **Command**: `ai_assistant.conversation.close`
- **Command**: `ai_assistant.conversation.reopen`
- **Command**: `ai_assistant.conversation.delete`
- **Command**: `ai_assistant.message.append`
- **Event**: `ai_assistant.conversation.created`
- **Event**: `ai_assistant.conversation.updated`
- **Event**: `ai_assistant.conversation.deleted`
- **Event**: `ai_assistant.message.created`

Undo behavior:
- Create: undo by soft-deleting the conversation and messages.
- Rename/close/reopen: undo by restoring the prior scalar values.
- Delete: soft delete only; undo by clearing `deleted_at`.
- Append message: undo by soft-deleting the message; never physically remove in the user-facing command.

### Cache Strategy
Do not cache MVP conversation reads. Chat history is user-specific, security-sensitive, and small enough for direct indexed queries. If later cached, keys must include `tenantId`, `organizationId`, and `userId`, and writes must invalidate `ai_assistant:conversation:<id>` and `ai_assistant:conversation-list:<userId>`.

## Data Models
All new entities use UUID primary keys and standard `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at`, and `is_active` columns where applicable.

### AiChatConversation (Singular, table: `ai_chat_conversations`)
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | Internal primary key. |
| `tenant_id` | uuid/text | Required tenant scope. |
| `organization_id` | uuid/text | Required organization scope. |
| `conversation_id` | text | Stable client/runtime id, unique within tenant/org/user-visible scope. |
| `agent_id` | text | Typed agent id, e.g. `catalog.merchandising_assistant`. |
| `owner_user_id` | text | Authenticated staff user that created/imported the conversation. |
| `title` | text nullable | User-provided tab name. |
| `status` | text | `open` or `closed`. |
| `visibility` | text | MVP value: `private`; future values: `shared`, `organization`. |
| `page_context` | jsonb nullable | Last known page/entity context. |
| `last_message_at` | timestamptz nullable | Used for list ordering. |
| `imported_from_local_at` | timestamptz nullable | Marks lazy browser migration. |

Indexes:
- Unique: `(tenant_id, organization_id, conversation_id)`
- List: `(tenant_id, organization_id, owner_user_id, agent_id, status, last_message_at DESC)`
- Cleanup/search prep: `(tenant_id, organization_id, deleted_at)`

### AiChatConversationParticipant (Singular, table: `ai_chat_conversation_participants`)
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | Internal primary key. |
| `tenant_id` | uuid/text | Required tenant scope. |
| `organization_id` | uuid/text | Required organization scope. |
| `conversation_id` | text | FK by stable conversation id or internal FK id, chosen during implementation. |
| `user_id` | text | Staff user id. |
| `role` | text | MVP values: `owner`; future: `viewer`, `commenter`. |
| `last_read_at` | timestamptz nullable | Future unread/share UX. |

Indexes:
- Unique: `(tenant_id, organization_id, conversation_id, user_id)`
- Access lookup: `(tenant_id, organization_id, user_id, conversation_id)`

### AiChatMessage (Singular, table: `ai_chat_messages`)
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | Internal primary key. |
| `tenant_id` | uuid/text | Required tenant scope. |
| `organization_id` | uuid/text | Required organization scope. |
| `conversation_id` | text | Stable conversation id. |
| `client_message_id` | text nullable | Client-side message id for idempotent imports/retries. |
| `role` | text | `user`, `assistant`, or `system`; UI should normally show user/assistant only. |
| `content` | text | Markdown/plain text transcript content. |
| `ui_parts` | jsonb nullable | Serializable `AiChatMessageUiPart[]`. |
| `attachment_ids` | jsonb nullable | Array of attachment ids referenced by the message. |
| `files_metadata` | jsonb nullable | Safe file names/types for display; no base64 previews. |
| `model` | text nullable | Resolved model for assistant messages when available. |
| `metadata` | jsonb nullable | Debug-light metadata only; never raw provider secrets or credentials. |
| `created_by_user_id` | text nullable | Staff user id for user messages/import owner. |

Indexes:
- Unique when available: `(tenant_id, organization_id, conversation_id, client_message_id)`
- Transcript: `(tenant_id, organization_id, conversation_id, created_at ASC)`
- Cleanup: `(tenant_id, organization_id, deleted_at)`

## API Contracts
All routes MUST export `openApi` and declare `metadata.POST/GET/PATCH/DELETE` with `requireAuth: true` and `requireFeatures: ['ai_assistant.view']`. All input schemas use Zod. All queries filter by `tenant_id`, `organization_id`, and an access predicate for the authenticated user.

### List Conversations
- `GET /api/ai_assistant/ai/conversations?agent=<module.agent>&status=open|closed&limit=50&cursor=<cursor>`
- Response `200`:

```json
{
  "items": [
    {
      "conversationId": "uuid",
      "agentId": "catalog.merchandising_assistant",
      "title": "Pricing work",
      "status": "open",
      "visibility": "private",
      "createdAt": "2026-05-05T10:00:00.000Z",
      "updatedAt": "2026-05-05T10:10:00.000Z",
      "lastMessageAt": "2026-05-05T10:10:00.000Z"
    }
  ],
  "nextCursor": null
}
```

### Create Conversation
- `POST /api/ai_assistant/ai/conversations`
- Request:

```json
{
  "agentId": "catalog.merchandising_assistant",
  "conversationId": "optional-client-generated-uuid",
  "title": "Optional title",
  "pageContext": { "pageId": "catalog.products", "entityType": "catalog.product", "recordId": "..." }
}
```

- Response `201`: conversation summary.
- Idempotency: if the same accessible `conversationId` already exists, return `200` with the existing summary.

### Get Conversation Transcript
- `GET /api/ai_assistant/ai/conversations/:conversationId?limit=100&before=<cursor>`
- Response `200`:

```json
{
  "conversation": { "conversationId": "uuid", "agentId": "catalog.merchandising_assistant", "status": "open" },
  "messages": [
    {
      "id": "uuid",
      "clientMessageId": "msg_123",
      "role": "user",
      "content": "Find products at risk.",
      "uiParts": [],
      "attachmentIds": [],
      "files": [],
      "createdAt": "2026-05-05T10:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

### Update Conversation
- `PATCH /api/ai_assistant/ai/conversations/:conversationId`
- Request:

```json
{ "title": "New title", "status": "closed" }
```

- Response `200`: updated conversation summary.
- Only owner can update in MVP.

### Delete Conversation
- `DELETE /api/ai_assistant/ai/conversations/:conversationId`
- Response `200`: `{ "ok": true }`
- Soft-deletes conversation and messages in one transaction.

### Import Local Conversation
- `POST /api/ai_assistant/ai/conversations/import`
- Request:

```json
{
  "conversation": { "conversationId": "uuid", "agentId": "catalog.merchandising_assistant", "title": "Imported chat", "status": "open" },
  "messages": [
    { "clientMessageId": "msg_1", "role": "user", "content": "Hello", "uiParts": [], "attachmentIds": [], "files": [] }
  ]
}
```

- Response `200`: imported conversation summary and imported message count.
- Limits: max 100 messages per import request, max message content length enforced by validator, no base64 preview persistence.

### Chat Dispatcher Persistence
- Existing route remains: `POST /api/ai_assistant/ai/chat?agent=<module.agent>`
- Existing request fields remain valid. `conversationId` continues to be optional for backward compatibility.
- If `conversationId` is omitted, the server may create one and include it in a metadata SSE chunk in a later phase; MVP UI should continue sending a generated id.
- The dispatcher persists the latest user message before model execution and the final assistant message after stream completion. If stream completion fails after the model started, persist a failed assistant metadata marker only if the UI needs retry state; do not fabricate assistant content.

## Internationalization (i18n)
Add or update keys in `packages/ai-assistant/src/modules/ai_assistant/i18n/*.json`:

- `ai_assistant.chat.storage.sync_failed`
- `ai_assistant.chat.storage.import_failed`
- `ai_assistant.chat.storage.offline_local_fallback`
- `ai_assistant.chat.tabs.share` (reserved for future shared UX, not rendered in MVP)

## UI/UX
- Existing tabs remain visually unchanged in MVP.
- `AiChatSessionsProvider` hydrates sessions from the server once the chat surface opens.
- `useAiChat` hydrates messages for the active `conversationId` from the server.
- Existing `localStorage` keys are treated as import candidates. After successful import, mark a lightweight browser flag such as `om-ai-chat-imported:<agent>:<conversationId>` to avoid repeated imports.
- If the server store is unavailable, show a subtle non-blocking sync warning and keep the current in-memory transcript. Do not silently reintroduce durable `localStorage` as the primary store.

## Configuration
Optional configuration keys may be added later, but MVP should use hardcoded safe defaults:

- Conversation list page size: 50.
- Message hydration limit: 100 newest messages per request.
- Import batch size: 100 messages.
- Retention: no automatic deletion in MVP beyond user soft delete.

## Migration & Backward Compatibility
This is additive and must not remove existing public API fields or route behavior.

- Keep accepting `conversationId` in `POST /api/ai_assistant/ai/chat`.
- Keep local-only chats readable long enough to import them.
- Do not rename existing UI exports (`AiChat`, `AiChatSessionsProvider`, `useAiChat`) or remove props.
- Browser migration is lazy because server code cannot read each user's local storage.
- Once imported, the server store becomes authoritative for that conversation. Local import markers can be cleared safely without deleting server records.
- Attachment previews stored as `data:` URLs in local messages must not be persisted to the database. Persist attachment ids and safe file metadata only.

## Implementation Plan

### Phase 1: Server Data Model
1. Add `AiChatConversation`, `AiChatConversationParticipant`, and `AiChatMessage` entities under `ai_assistant`.
2. Add Zod validators and inferred types for conversation create/update/import/message payloads.
3. Generate and review the database migration and `migrations/.snapshot-open-mercato.json` changes.
4. Add repository tests for tenant/org/user scoping and idempotent conversation creation.

### Phase 2: Conversation APIs
1. Implement list/create/get/update/delete/import routes with `openApi` exports.
2. Implement a DI-resolved conversation service/repository with transaction boundaries for create/import/delete.
3. Add API route tests for auth, feature gating, tenant isolation, import idempotency, pagination, and soft delete.

### Phase 3: Chat Dispatcher Writes
1. Update the chat dispatcher/runtime boundary to ensure a conversation exists before dispatch.
2. Persist user messages idempotently by `clientMessageId`.
3. Persist final assistant content and UI parts after stream completion.
4. Add tests proving repeated retries do not duplicate messages or pending actions.

### Phase 4: UI Server Store Adapter
1. Add a small `conversation-store` adapter in `packages/ui/src/ai/`.
2. Update `AiChatSessionsProvider` to load/update tab metadata through server APIs.
3. Update `useAiChat` to hydrate/persist messages through server APIs while preserving current in-memory streaming behavior.
4. Keep local fallback limited to import detection and non-durable failure recovery.

### Phase 5: Local Storage Import
1. Detect legacy keys `om-ai-chat:<agent>` and `om-ai-chat:<agent>:<conversationId>`.
2. Import conversations only after the authenticated user opens the matching agent surface.
3. Strip base64 previews and transient blob URLs before upload.
4. Mark successfully imported local conversations to avoid repeat imports.

### Phase 6: Docs, Tests, and Sharing Readiness
1. Update framework docs that currently describe `AiChatSessions.tsx` as `localStorage` persistence.
2. Add integration coverage for cross-refresh restore, cross-browser restore through API fixtures, import from local storage, and tenant isolation.
3. Document future sharing extension points: participants, visibility, share UI, notifications, and access checks.

## File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts` | Modify | Add conversation/message entities. |
| `packages/ai-assistant/src/modules/ai_assistant/data/validators.ts` | Modify/Create | Add Zod schemas. |
| `packages/ai-assistant/src/modules/ai_assistant/data/repositories/AiChatConversationRepository.ts` | Create | Encapsulate scoped persistence. |
| `packages/ai-assistant/src/modules/ai_assistant/lib/conversation-storage.ts` | Create | Service-level command helpers. |
| `packages/ai-assistant/src/modules/ai_assistant/api/ai/conversations/**/route.ts` | Create | Conversation APIs. |
| `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts` | Modify | Persist chat messages around dispatcher execution. |
| `packages/ui/src/ai/conversation-store.ts` | Create | Client adapter for server persistence. |
| `packages/ui/src/ai/AiChatSessions.tsx` | Modify | Move session metadata source of truth to server. |
| `packages/ui/src/ai/useAiChat.ts` | Modify | Move transcript source of truth to server. |
| `apps/docs/docs/framework/ai-assistant/architecture.mdx` | Modify | Update persistence architecture docs. |
| `apps/docs/docs/framework/ai-assistant/attachments.mdx` | Modify | Clarify preview/import behavior. |

## Testing Strategy
- Unit tests for validators and repository scoping.
- API tests for all conversation endpoints, including forbidden cross-tenant and cross-user access.
- Dispatcher tests for idempotent message persistence and assistant-message persistence on successful streams.
- UI tests for tab creation, rename, close/reopen, refresh restore, and local import.
- Integration tests for all affected API paths:
  - `GET /api/ai_assistant/ai/conversations`
  - `POST /api/ai_assistant/ai/conversations`
  - `GET /api/ai_assistant/ai/conversations/:conversationId`
  - `PATCH /api/ai_assistant/ai/conversations/:conversationId`
  - `DELETE /api/ai_assistant/ai/conversations/:conversationId`
  - `POST /api/ai_assistant/ai/conversations/import`
  - `POST /api/ai_assistant/ai/chat?agent=...`
- Key UI paths:
  - Open AI dock, create tab, send message, refresh, verify transcript remains.
  - Open same user in a second browser context, verify conversation list and transcript load.
  - Seed legacy localStorage, open chat, verify import and no duplicate import on refresh.

## Risks & Impact Review

#### Cross-Tenant Transcript Leak
- **Scenario**: A conversation lookup filters by `conversation_id` but forgets `tenant_id` or `organization_id`, returning another tenant's transcript.
- **Severity**: Critical
- **Affected area**: AI Assistant APIs, UI chat history, pending action context.
- **Mitigation**: Centralize all reads/writes in a repository that requires tenantId and organizationId; add negative tests with same `conversationId` across tenants.
- **Residual risk**: Low after repository tests; direct ORM use outside the repository remains a code-review risk.

#### Cross-User Private Chat Exposure
- **Scenario**: User A can guess or obtain User B's `conversationId` and read a private transcript.
- **Severity**: High
- **Affected area**: Conversation APIs and future sharing model.
- **Mitigation**: MVP access predicate requires owner or participant row. Conversation creation always writes an owner participant in the same transaction.
- **Residual risk**: Low; future sharing must extend the participant predicate carefully.

#### Duplicate Messages During Retries
- **Scenario**: Network retry or stream reconnection appends the same user or assistant message multiple times.
- **Severity**: Medium
- **Affected area**: Transcript quality, pending action explanation, model context.
- **Mitigation**: Preserve `clientMessageId`; enforce unique index where available; service performs idempotent append.
- **Residual risk**: Medium for assistant stream completion if provider returns different content after retry; acceptable because user can see and delete duplicate attempts.

#### Local Import Data Loss
- **Scenario**: The UI clears or marks a local conversation as imported before the server transaction commits.
- **Severity**: High
- **Affected area**: Existing browser-only chat history.
- **Mitigation**: Mark imported only after `POST /import` returns success; never remove local data in MVP, only add an imported marker.
- **Residual risk**: Low; local storage can still be manually cleared by the user or browser.

#### Storage Growth
- **Scenario**: Long-running tenants accumulate large transcripts and UI part JSON.
- **Severity**: Medium
- **Affected area**: Database size, query performance, backup volume.
- **Mitigation**: Normalize messages into rows, cap import/message sizes, index list and transcript access patterns, and defer retention worker until usage data is known.
- **Residual risk**: Medium; no automatic retention in MVP means admins need future retention controls.

#### Sensitive Data Retention
- **Scenario**: AI chats include customer data, credentials pasted by users, or commercially sensitive notes that now persist server-side.
- **Severity**: High
- **Affected area**: Security, compliance, exports, backups.
- **Mitigation**: Authenticated owner-only access in MVP; no raw provider secrets in metadata; soft delete; future retention/export/delete controls tracked as follow-up.
- **Residual risk**: Medium because user-entered sensitive text can still be stored intentionally.

#### Streaming Persistence Partial Failure
- **Scenario**: User message is persisted, model call succeeds, but assistant-message persistence fails after streaming to the browser.
- **Severity**: Medium
- **Affected area**: Transcript completeness after refresh.
- **Mitigation**: Log structured errors, leave UI in-memory transcript intact for current session, and show a sync warning. Persist user message before model call so the user can retry.
- **Residual risk**: Medium; exact streamed assistant text may be lost if persistence fails after completion.

## Final Compliance Report — 2026-05-05

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/ai-assistant/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Always filter by `organization_id` for tenant-scoped entities | Compliant | Every model/API requires tenant and organization scope. |
| root AGENTS.md | Validate all inputs with zod | Compliant | API contracts require validators in `data/validators.ts`. |
| root AGENTS.md | API routes MUST export `openApi` | Compliant | Required for every new route. |
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Conversation rows store IDs only; no cross-module ORM relation. |
| packages/ai-assistant/AGENTS.md | Agent dispatch goes through typed AI dispatcher | Compliant | Existing chat route remains the dispatch path. |
| packages/ui/AGENTS.md | Use shared UI primitives and i18n for user-facing text | Compliant | UI changes preserve current tabs and add i18n keys. |
| BACKWARD_COMPATIBILITY.md | API route URLs are stable | Compliant | Existing chat route and request fields remain valid. |
| BACKWARD_COMPATIBILITY.md | Database schema is additive-only | Compliant | Adds new tables/indexes only. |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Conversation/message fields map to list/get/import APIs. |
| API contracts match UI/UX section | Pass | UI uses list/get/create/update/delete/import paths. |
| Risks cover all write operations | Pass | Create/update/delete/import/message append risks included. |
| Commands defined for all mutations | Pass | Command-style operations listed. |
| Cache strategy covers all read APIs | Pass | MVP explicitly avoids cache for security-sensitive reads. |

### Non-Compliant Items
None.

### Verdict
Fully compliant: Approved — ready for implementation.

## Changelog
### 2026-05-05
- Initial specification for moving typed AI chat conversations from `localStorage` to server-side database storage.

### Review — 2026-05-05
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
