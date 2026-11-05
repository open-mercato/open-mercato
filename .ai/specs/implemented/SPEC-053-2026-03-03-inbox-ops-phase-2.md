# SPEC-053: InboxOps Agent — Phase 2

**Date**: 2026-03-03
**Status**: Specification
**Module**: `inbox_ops` (`packages/core/src/modules/inbox_ops/`)
**Parent**: [SPEC-037](./SPEC-037-2026-02-15-inbox-ops-agent.md) (Phase 1 — Implemented)
**Related**: Issue #573, Issue #414 (Messages), PR #569 (Messages Module — Merged), PR #682 (Phase 1), PR #760 (Phase 1 Fixes)

---

## TLDR

**Key Points:**
- Phase 2 of the InboxOps module, building on the fully implemented Phase 1 (email reception, LLM extraction, proposal review UI, action execution engine)
- Integrates with the now-merged messages module (PR #569), adds MCP AI tools, email categorization, and production hardening
- All features directly sourced from team feedback: @pkarw (messages integration), @fto-aubergine (categorization, MCP tools), @pkarw (integration tests)

**Scope:**
- Messages module integration: register InboxOps as a message type, link emails to messages, draft replies via messages infrastructure
- Email categorization: LLM-classified categories (RFQ, Order, Complaint, etc.) with UI filtering
- MCP AI tools: expose proposal queries and email categorization to AI Assistant / OpenCode
- Hardening: enhanced search indexing, cache implementation, Playwright integration tests

**Concerns:**
- Messages module integration adds a runtime dependency — module must degrade gracefully if messages module is disabled
- Adding `category` column requires a database migration on an existing table with production data

---

## 1) Overview

SPEC-037 delivered the InboxOps MVP: a four-stage pipeline (receive → extract → review → execute) that turns forwarded email threads into structured ERP action proposals. Phase 1 is merged and working (PR #682, PR #760).

Phase 2 addresses gaps identified during UAT and feature requests from team members. The messages module (PR #569) has merged into `develop` on 2026-02-25, unblocking the critical integration that @pkarw requested in issue #573. @fto-aubergine's suggestions for email categorization and MCP tools are now implementable. @pkarw's explicit request for integration tests (issue #703) is also captured.

**Package Location:** `packages/core/src/modules/inbox_ops/`

> **Market Reference**: Continues from SPEC-037's study of [Front App](https://front.com) (AI email automation). Phase 2 specifically adopts Front's **email categorization labels** (automatic tagging of inbound emails as RFQ, Support, Order, etc.) and **API tool integrations** (programmatic access to inbox intelligence for automations).

---

## 2) Problem Statement

Phase 1 feedback identified these gaps:

1. **No messages module integration**: InboxOps operates as an island — emails and draft replies don't appear in the unified messages UI, duplicating communication infrastructure. @pkarw: *"It should be integrated with #414 — adding email accounts for the messages so they can pull messages from email or internals using the same UI and the same interpretation/dispatching mechanism."*

2. **No email categorization**: Operators must manually scan proposal lists to find urgent items (complaints, RFQs). @fto-aubergine: *"Maybe each message could be categorized to predefined lists of categories, e.g. RFQ, issue etc."*

3. **No AI assistant integration**: The AI assistant / OpenCode cannot query InboxOps proposals or categorize emails programmatically. @fto-aubergine: *"For this module you can create dedicated ai-tools file... that would provide the MCP and OpenCode dedicated tools to handle specific tasks creation."*

4. **Incomplete production hardening**: Cache strategy defined in SPEC-037 section 16.1 but not implemented. Search indexing exists but doesn't include the new category field. No Playwright integration tests. @pkarw (issue #703): *"Add the integration tests based on mockup email fixture."*

---

## 3) Proposed Solution

Four independently shippable phases that build incrementally on Phase 1:

**Phase 2a — Messages Module Integration**: Register `inbox_ops.email` as a message type in the messages module registry. Create `message_objects` links between `InboxEmail` and `message` entities. Route sent draft replies through the messages module's email forwarding infrastructure instead of direct Resend calls, creating dual audit trail (Activity + message record).

**Phase 2b — Email Categorization**: Add a `category` field to `InboxProposal` with an enum of business-relevant types (RFQ, Order, Order Update, Complaint, Shipping Update, Inquiry, Payment, Other). The LLM extraction prompt is extended to classify emails during proposal creation. The proposals list UI gains a category filter dropdown.

**Phase 2c — MCP AI Tools**: Create `ai-tools.ts` following the `packages/search/src/modules/search/ai-tools.ts` pattern. Expose tools for listing/querying proposals, getting proposal details, accepting actions, and categorizing emails. Enables AI Assistant access via Cmd+K and programmatic OpenCode access.

**Phase 2d — Hardening**: Implement the cache strategy from SPEC-037 section 16.1 (tag-based invalidation for counts and settings endpoints). Enhance search indexing to include category field. Create Playwright integration tests covering the full receive → propose → review → accept workflow with mock email fixtures.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Messages integration via type registry (not direct coupling) | Allows InboxOps to function independently if messages module is disabled |
| Category stored on `InboxProposal` (not `InboxEmail`) | Category is a semantic classification of intent, which is determined during extraction — not an attribute of the raw email |
| MCP tools follow search module pattern exactly | Proven pattern, auto-discovered by ai-assistant generator, no new infrastructure needed |
| Cache tags reuse SPEC-037 section 16.1 design verbatim | Already reviewed and approved in Phase 1 compliance report |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Tight coupling to messages module (direct imports) | Violates module isolation. InboxOps must work standalone |
| Category on `InboxEmail` instead of `InboxProposal` | An email may spawn multiple proposals (reprocess); category belongs to the interpreted proposal |
| Custom MCP integration layer | Over-engineered. The `ai-tools.ts` auto-discovery pattern is sufficient |
| Redis cache for proposals list | Over-provisioned. List queries need fresh data (status changes); only counts and settings benefit from caching |

---

## 4) Data Models

### 4.1 Modified Entity: InboxProposal

Add one new column:

```typescript
// packages/core/src/modules/inbox_ops/data/entities.ts — InboxProposal class

@Property({ name: 'category', type: 'text', nullable: true })
category?: InboxProposalCategory | null
```

New type definition:

```typescript
export type InboxProposalCategory =
  | 'rfq'
  | 'order'
  | 'order_update'
  | 'complaint'
  | 'shipping_update'
  | 'inquiry'
  | 'payment'
  | 'other'
```

**Migration**: `ALTER TABLE inbox_proposals ADD COLUMN category text NULL;`
Add index: `CREATE INDEX idx_inbox_proposals_category ON inbox_proposals (organization_id, tenant_id, category);`

No other entity modifications. Existing entities (`InboxSettings`, `InboxEmail`, `InboxProposalAction`, `InboxDiscrepancy`) remain unchanged.

### 4.2 New Type: Messages Integration

No new entities. Integration uses the messages module's existing entities via FK IDs:

```typescript
// Integration uses message_objects table from messages module
// InboxOps creates message_objects records linking:
//   entityModule: 'inbox_ops'
//   entityType: 'inbox_email'
//   entityId: <InboxEmail.id>
```

---

## 5) API Contracts

### 5.1 Modified Endpoints

#### GET /api/inbox_ops/proposals

Add `category` to query parameters and response items.

- **New query param**: `category` (optional, comma-separated values from `InboxProposalCategory`)
- **Response item change**: Add `category: InboxProposalCategory | null` to each proposal item

```typescript
// Updated query schema — validates each comma-separated value against the enum
const categoryEnum = z.enum(['rfq', 'order', 'order_update', 'complaint', 'shipping_update', 'inquiry', 'payment', 'other'])

const listQuerySchema = z.object({
  // ... existing params
  category: z.string().optional().transform((val) =>
    val ? val.split(',').map((v) => categoryEnum.parse(v.trim())) : undefined
  ),
})

// Updated response item
interface ProposalListItem {
  // ... existing fields
  category: InboxProposalCategory | null
}
```

**Query strategy**: The category filter translates to a parameterized `WHERE category IN ($1, $2, ...)` clause — values are never interpolated into SQL strings.

#### GET /api/inbox_ops/proposals/counts

Add category breakdown to counts response.

```typescript
// Updated response
interface ProposalCounts {
  // ... existing status counts
  byCategory: Record<InboxProposalCategory, number>
}
```

**Query strategy**: Use a single `SELECT category, COUNT(*) FROM inbox_proposals WHERE organization_id = $1 AND tenant_id = $2 AND is_active = true GROUP BY category` query. This is O(1) queries regardless of category count, not N+1. The existing `idx_inbox_proposals_category` composite index covers this scan.

#### GET /api/inbox_ops/proposals/:id

Add `category` to the proposal detail response. No other changes.

### 5.2 New Endpoints

#### POST /api/inbox_ops/proposals/:id/categorize

Manually re-categorize a proposal. Requires `inbox_ops.proposals.manage`.

- **Request**: `{ category: InboxProposalCategory }`
- **Response**: `{ ok: true, category: string, previousCategory: string | null }`
- **Errors**:
  - `400` — Invalid category value (Zod validation failure)
  - `403` — Missing `inbox_ops.proposals.manage` permission
  - `404` — Proposal not found or belongs to another tenant
- **Validation**: Zod schema validates category against enum
- **Atomicity**: Single `em.flush()` — category update is a scalar mutation on one entity, no transaction wrapper needed. Cache invalidation runs post-flush (non-transactional; stale cache self-corrects via 30s TTL)
- **Undo**: Categorization is an idempotent, non-destructive metadata update. The previous category is returned in the response for UI-level undo (re-POST with `previousCategory`). No formal `CommandHandler` registration — categorization does not create or destroy entities and has no side effects beyond cache invalidation. This is an explicit architectural exception: the Command pattern applies to mutations with side effects (entity creation, external service calls, notifications), not to single-field metadata updates. See SPEC-037 section 10.5 for the boundary definition

### 5.3 MCP AI Tools (via ai-tools.ts)

These are not HTTP endpoints — they are registered MCP tools discovered by the ai-assistant module generator.

#### inbox_ops_list_proposals

Query proposals with filtering. Requires `inbox_ops.proposals.view`.

```typescript
inputSchema: z.object({
  status: z.enum(['pending', 'partial', 'accepted', 'rejected']).optional(),
  category: z.enum(['rfq', 'order', 'order_update', 'complaint', 'shipping_update', 'inquiry', 'payment', 'other']).optional(),
  limit: z.number().int().min(1).max(50).optional().default(10),
  dateFrom: z.string().optional(), // ISO 8601
  dateTo: z.string().optional(),
})
```

Returns: `{ total, proposals: [{ id, summary, status, category, confidence, actionCount, createdAt }] }`

#### inbox_ops_get_proposal

Get full proposal detail. Requires `inbox_ops.proposals.view`.

```typescript
inputSchema: z.object({
  proposalId: z.string().uuid(),
})
```

Returns: `{ proposal: { id, summary, status, category, confidence, actions: [...], discrepancies: [...] } }`

#### inbox_ops_accept_action

Accept a specific proposal action. Requires `inbox_ops.proposals.manage` + target module permission.

```typescript
inputSchema: z.object({
  proposalId: z.string().uuid(),
  actionId: z.string().uuid(),
})
```

Returns on success: `{ ok: true, createdEntityId, createdEntityType }`

Error responses (same as HTTP endpoint):
- `{ error: 'Action not found' }` — proposal or action ID invalid
- `{ error: 'Action already processed', status: 'accepted' }` — 409 conflict, optimistic locking
- `{ error: 'Insufficient permissions', requiredFeature: 'sales.orders.manage' }` — 403, user lacks target module permission
- `{ error: 'Execution failed', detail: '...' }` — target module mutation failed

The handler delegates to the same `executionEngine.executeAction()` used by the HTTP endpoint — no parallel permission or locking logic.

#### inbox_ops_categorize_email

Classify an email thread into a category. Requires `inbox_ops.proposals.view`.

```typescript
inputSchema: z.object({
  text: z.string().min(1).max(10000).describe('Email or text content to categorize (max 10K chars)'),
})
```

Returns: `{ category: string, confidence: number, reasoning: string }`

**Cost control**: Input capped at 10,000 characters (not 50K — categorization needs far less context than full extraction). Uses a lightweight prompt (category enum + short reasoning) with expected token usage of ~200-400 tokens per call. Same `OPENCODE_PROVIDER`/`OPENCODE_MODEL` configuration as extraction. No separate rate limiting beyond MCP server's existing per-session throttling

---

## 6) Architecture

### 6.1 Messages Module Integration Flow

```
InboxOps receives email via webhook
  → Creates InboxEmail entity
  → Creates message record via messages module API (type: 'inbox_ops.email')
  → Creates message_objects link (entityModule: 'inbox_ops', entityType: 'inbox_email')
  → Extraction pipeline runs as before
  → When draft reply is sent:
    → Creates message record (type: 'inbox_ops.reply') instead of direct Resend call
    → Messages module handles email delivery via its Resend integration
    → Creates Activity on customer record (existing behavior)
```

### 6.2 Module Independence Strategy

InboxOps MUST function when the messages module is disabled:

```typescript
// In lib/messagesIntegration.ts
export async function createMessageRecord(email: InboxEmail, ctx: RequestContext): Promise<string | null> {
  try {
    const messagesService = ctx.container.resolve('messagesService')
    if (!messagesService) return null // messages module not available
    // ... create message + message_objects
    return messageId
  } catch {
    return null // graceful degradation
  }
}
```

- All messages integration calls are wrapped in try/catch with null return
- Draft reply sending falls back to direct Resend API when messages module is unavailable
- InboxOps pages never import messages module components directly

**Side-effect reversibility**: If `createMessageRecord()` fails after `InboxEmail` is successfully persisted, the result is an InboxEmail without a messages module link. This is the **intended graceful degradation** — the InboxEmail is fully functional in InboxOps UI without the message link. No rollback of the InboxEmail creation is attempted. Orphaned `message_objects` records (if message creation succeeds but InboxEmail flush fails) are tolerated — messages module renders them as "entity not found" previews, which is harmless

### 6.3 MCP Tools Auto-Discovery

```
packages/core/src/modules/inbox_ops/ai-tools.ts
  → Export: aiTools (AiToolDefinition[])
  → Discovered by: npm run modules:prepare
  → Registered in: apps/mercato/.mercato/generated/ai-tools.generated.ts
  → Served by: @open-mercato/ai-assistant MCP server
```

### 6.4 Content Security — Email Rendering

The new `InboxEmailContent.tsx` and `InboxEmailPreview.tsx` components render email content in the browser. Email bodies, subject lines, and sender names are untrusted user-controlled input.

**Rendering strategy**:
- **Email body**: Rendered as **plain text only** using the existing `cleanedText` field (already HTML-stripped by `htmlToPlainText.ts` in Phase 1). Raw HTML (`rawHtml`) is never rendered in the browser. If rich rendering is needed in the future, it must use an iframe sandbox with `srcdoc` and CSP `sandbox` attribute.
- **Subject lines and sender names**: Rendered via React JSX text interpolation (auto-escaped by React's default XSS protection). No `dangerouslySetInnerHTML`.
- **Category badges**: Rendered from the enum value mapped to an i18n key — never from raw API strings. Unknown values fall back to the `inbox_ops.category.other` key.

### 6.5 Events

No new events required. Existing events from Phase 1 (`events.ts`) cover all new flows:
- `inbox_ops.proposal.created` — fires after categorization is assigned
- `inbox_ops.reply.sent` — fires whether sent via messages module or direct Resend

### 6.6 Cache Strategy (from SPEC-037 section 16.1)

| Endpoint | Strategy | TTL | Tags | Invalidation Trigger |
|----------|----------|-----|------|---------------------|
| `GET /api/inbox_ops/proposals/counts` | Memory | 30s | `inbox_ops:counts:{tenantId}` | Action accept/reject/edit; new proposal; categorize |
| `GET /api/inbox_ops/settings` | Memory | 5min | `inbox_ops:settings:{tenantId}` | Settings update |
| All other GET endpoints | No cache | — | — | Status changes frequently |

---

## 7) UI/UX

### 7.1 Proposals List — Category Filter

Add a category filter dropdown to the proposals list page (`backend/inbox-ops/page.tsx`):

- Position: In the `FilterBar` alongside the existing status filter
- Component: `Select` dropdown with "All Categories" default + individual category options
- Visual: Each category gets a color-coded badge (reuse `Badge` component)
- URL state: `?category=rfq,order` (comma-separated, synced with URL params)

Category badge colors:

| Category | Color | Icon |
|----------|-------|------|
| RFQ | blue | `file-question` |
| Order | green | `shopping-cart` |
| Order Update | amber | `refresh-cw` |
| Complaint | red | `alert-triangle` |
| Shipping Update | purple | `truck` |
| Inquiry | slate | `help-circle` |
| Payment | emerald | `credit-card` |
| Other | gray | `tag` |

### 7.2 Proposal Detail — Category Display

Show category badge in the proposal detail header, next to the confidence badge. Include an "Edit" pencil icon that opens a dropdown for manual recategorization.

### 7.3 Messages Integration (Minimal UI Impact)

When messages module is active:
- **Proposal detail page only** (not the list page) shows a "View in Messages" link if a linked message exists. The link is resolved by a single query on `message_objects` filtered by `entityModule='inbox_ops'` and `entityId=<inboxEmailId>`. This is a single query on the detail page — **no N+1 risk** on the proposals list page, which does not show message links.
- Sent draft replies show "Sent via Messages" instead of "Sent via Email"

No new pages required.

---

## 8) Internationalization (i18n)

New translation keys (added to all 4 locales + template locales):

| Key | Default (en) |
|-----|-------------|
| `inbox_ops.category` | Category |
| `inbox_ops.category.all` | All Categories |
| `inbox_ops.category.rfq` | RFQ |
| `inbox_ops.category.order` | Order |
| `inbox_ops.category.order_update` | Order Update |
| `inbox_ops.category.complaint` | Complaint |
| `inbox_ops.category.shipping_update` | Shipping Update |
| `inbox_ops.category.inquiry` | Inquiry |
| `inbox_ops.category.payment` | Payment |
| `inbox_ops.category.other` | Other |
| `inbox_ops.category.uncategorized` | Uncategorized |
| `inbox_ops.view_in_messages` | View in Messages |
| `inbox_ops.sent_via_messages` | Sent via Messages |
| `inbox_ops.recategorize` | Change Category |

---

## 9) Implementation Plan

### Phase 2a: Messages Module Integration

> **Prerequisite**: Messages module merged (PR #569 — confirmed merged 2026-02-25)

1. Create `lib/messagesIntegration.ts` with graceful degradation (try/catch + null fallback when messages module unavailable).
2. In the extraction subscriber (`subscribers/extractionWorker.ts`), after creating `InboxEmail`, call `createMessageRecord()` to register the email as a message with type `inbox_ops.email` and link via `message_objects`.
3. Update `message-types.ts` to define the `inbox_ops.email` message type with custom `ContentComponent` that renders the email thread viewer.
4. Update `message-objects.ts` to define the `inbox_ops:inbox_email` object type with preview showing subject/sender/status.
5. In `lib/executionHelpers.ts`, update draft reply sending to prefer messages module infrastructure when available — create a message record (type `inbox_ops.reply`) and let the messages module handle Resend delivery. Fall back to direct Resend call when messages module is unavailable.
6. Add `inbox_ops.view_in_messages` and `inbox_ops.sent_via_messages` i18n keys to all 8 locale files.
7. Run `npm run modules:prepare`.

**Testable**: Forward an email → InboxOps email appears in messages inbox. Accept a draft reply → reply message record created in messages module. Disable messages module → InboxOps continues to work independently.

### File Manifest — Phase 2a

| File | Action | Purpose |
|------|--------|---------|
| `lib/messagesIntegration.ts` | Create | Messages module bridge with graceful degradation |
| `message-types.ts` (inbox_ops module) | Modify | Add `inbox_ops.email` and `inbox_ops.reply` message type definitions. This file already exists at `packages/core/src/modules/inbox_ops/message-types.ts` — it is an InboxOps-owned file discovered by the messages module's generator, NOT a file in the messages module |
| `message-objects.ts` (inbox_ops module) | Modify | Add `inbox_ops:inbox_email` object type definition. Same pattern — InboxOps-owned file at `packages/core/src/modules/inbox_ops/message-objects.ts` |
| `subscribers/extractionWorker.ts` | Modify | Call `createMessageRecord()` after email persistence |
| `lib/executionHelpers.ts` | Modify | Route draft reply sending through messages module |
| `components/messages/InboxEmailContent.tsx` | Create | Message content renderer for inbox emails |
| `components/messages/InboxEmailPreview.tsx` | Create | Message object preview for inbox emails |
| i18n files (8 files) | Modify | Add messages integration keys |

---

### Phase 2b: Email Categorization

1. Add `InboxProposalCategory` type and `category` column to `InboxProposal` entity in `data/entities.ts`.
2. Add index on `(organization_id, tenant_id, category)`.
3. Generate database migration: `yarn db:generate`.
4. Update the LLM extraction prompt (`lib/extractionPrompt.ts`) to include category classification in the Zod output schema. Add category to the `extractionOutputSchema` with the enum values.
5. In `subscribers/extractionWorker.ts`, assign the extracted category to the proposal during creation.
6. Add `category` to proposals list query schema and response in `api/proposals/route.ts`.
7. Add `byCategory` breakdown to `api/proposals/counts/route.ts`.
8. Create `POST /api/inbox_ops/proposals/:id/categorize` endpoint in `api/proposals/[id]/categorize/route.ts` with `openApi` export.
9. Update the proposals list page (`backend/inbox-ops/page.tsx`) to add category filter dropdown and category badges on proposal rows.
10. Update proposal detail page (`backend/inbox-ops/proposals/[id]/page.tsx`) to show category badge with inline edit dropdown.
11. Add all `inbox_ops.category.*` i18n keys to 8 locale files.
12. Update `search.ts` to include `category` in `fieldPolicy.searchable` and `buildSource` fields.

**Testable**: Forward email → proposal created with auto-classified category. Filter proposals by category in list UI. Manually recategorize a proposal. Search by category.

### File Manifest — Phase 2b

| File | Action | Purpose |
|------|--------|---------|
| `data/entities.ts` | Modify | Add `category` column + type to `InboxProposal` |
| `migrations/Migration*.ts` | Create | Add `category` column + index |
| `lib/extractionPrompt.ts` | Modify | Add category to LLM extraction schema |
| `subscribers/extractionWorker.ts` | Modify | Assign extracted category to proposal |
| `api/proposals/route.ts` | Modify | Add category query param + response field |
| `api/proposals/counts/route.ts` | Modify | Add byCategory breakdown |
| `api/proposals/[id]/categorize/route.ts` | Create | Manual categorization endpoint |
| `backend/inbox-ops/page.tsx` | Modify | Add category filter + badges |
| `backend/inbox-ops/proposals/[id]/page.tsx` | Modify | Show category badge + edit |
| `search.ts` | Modify | Add category to search config |
| `data/validators.ts` | Modify | Add category Zod schema |
| i18n files (8 files) | Modify | Add category keys |

---

### Phase 2c: MCP AI Tools

1. Create `ai-tools.ts` at module root exporting `aiTools: AiToolDefinition[]`.
2. Implement `inbox_ops_list_proposals` tool: query proposals by status, category, date range. Resolve `queryEngine` from DI container. Requires `inbox_ops.proposals.view`.
3. Implement `inbox_ops_get_proposal` tool: fetch proposal detail with actions and discrepancies. Requires `inbox_ops.proposals.view`.
4. Implement `inbox_ops_accept_action` tool: accept a specific action via execution engine. Requires `inbox_ops.proposals.manage` + target module permission (resolved from `InboxProposalAction.requiredFeature`).
5. Implement `inbox_ops_categorize_email` tool: standalone LLM-based text categorization using the shared OpenCode provider. Returns `{ category, confidence, reasoning }`. Requires `inbox_ops.proposals.view`.
6. Run `npm run modules:prepare` to regenerate `ai-tools.generated.ts`.

**Testable**: Open AI Assistant (Cmd+K) → query "list pending inbox proposals" → tool returns results. Ask "categorize this text as an email type" → returns classification.

### File Manifest — Phase 2c

| File | Action | Purpose |
|------|--------|---------|
| `ai-tools.ts` | Create | MCP tool definitions (4 tools) |

---

### Phase 2d: Hardening — Cache, Search, Integration Tests

1. **Cache implementation**: In `di.ts`, register cache tags. In `api/proposals/counts/route.ts`, wrap the count query with memory cache (TTL 30s, tag `inbox_ops:counts:{tenantId}`). In `api/settings/route.ts` GET handler, wrap with memory cache (TTL 5min, tag `inbox_ops:settings:{tenantId}`). In all write endpoints that affect counts (accept, reject, categorize, new proposal), invalidate `inbox_ops:counts:{tenantId}`.
2. **Search enhancement**: Update `search.ts` to add `category` to `fieldPolicy.searchable`, update `buildSource` to include category in text and fields, update `formatResult` subtitle to include category.
3. **Playwright integration tests**: Create test fixtures in `__integration__/` covering:
   - TC-INBOX-P2-001: Full webhook → extraction → proposal → accept → entity creation flow (mock email fixture)
   - TC-INBOX-P2-002: Category filter in proposals list
   - TC-INBOX-P2-003: Manual categorization via UI
   - TC-INBOX-P2-004: Text submission via API → extraction → proposal
   - TC-INBOX-P2-005: MCP tools via API (if testable)
4. Add i18n keys for `inbox_ops.recategorize`.

**Testable**: Counts endpoint returns cached result on repeated calls. Search returns proposals filtered by category. All Playwright tests pass.

### File Manifest — Phase 2d

| File | Action | Purpose |
|------|--------|---------|
| `di.ts` | Modify | Register cache tags |
| `api/proposals/counts/route.ts` | Modify | Add memory cache wrapper |
| `api/settings/route.ts` | Modify | Add memory cache wrapper |
| `api/proposals/[id]/actions/[actionId]/accept/route.ts` | Modify | Invalidate counts cache |
| `api/proposals/[id]/actions/[actionId]/reject/route.ts` | Modify | Invalidate counts cache |
| `api/proposals/[id]/reject/route.ts` | Modify | Invalidate counts cache |
| `api/proposals/[id]/categorize/route.ts` | Modify | Invalidate counts cache |
| `subscribers/extractionWorker.ts` | Modify | Invalidate counts cache on new proposal |
| `search.ts` | Modify | Enhance search config with category |
| `__integration__/TC-INBOX-P2-001.spec.ts` | Create | End-to-end proposal flow test |
| `__integration__/TC-INBOX-P2-002.spec.ts` | Create | Category filter test |
| `__integration__/TC-INBOX-P2-003.spec.ts` | Create | Manual categorization test |
| `__integration__/TC-INBOX-P2-004.spec.ts` | Create | Text submission test |

---

## 10) Migration & Backward Compatibility

All Phase 2 changes are **additive-only** per `BACKWARD_COMPATIBILITY.md`:

| Change | BC Classification | Impact |
|--------|-------------------|--------|
| New `category` column on `inbox_proposals` | ADDITIVE-ONLY | Nullable column with default NULL. Existing API consumers see `category: null` |
| New `byCategory` field in counts response | ADDITIVE-ONLY | New response field. Existing consumers ignore unknown fields |
| New `POST /api/inbox_ops/proposals/:id/categorize` endpoint | ADDITIVE-ONLY | New endpoint, no existing route conflict |
| Modified `GET /api/inbox_ops/proposals` response (adds `category` field) | ADDITIVE-ONLY | New optional field in response items |
| New `ai-tools.ts` exports | ADDITIVE-ONLY | New MCP tools, no existing tool conflicts |
| Search `formatResult` subtitle change (adds category) | STABLE | Subtitle format is presentation-only, not a contract surface |
| Messages type registrations in `message-types.ts`, `message-objects.ts` | ADDITIVE-ONLY | New type registrations, no existing types modified |

No breaking changes. No deprecation protocol needed. No data backfill required.

---

## 11) Risks & Impact Review

### Messages Module Unavailability

- **Scenario**: The messages module is disabled or fails during InboxOps operation. Draft reply sending could break, or email-to-message linking could throw unhandled errors.
- **Severity**: Medium
- **Affected area**: Draft reply delivery, message audit trail
- **Mitigation**: All messages integration calls wrapped in try/catch with null return. Draft reply sending falls back to direct Resend API. `messagesIntegration.ts` resolves the messages service via DI with optional chaining — returns null if service is not registered. No import-time dependency on messages module.
- **Residual risk**: When messages module is unavailable, InboxOps emails don't appear in unified messages. Acceptable — InboxOps has its own complete UI.
- **Detection**: `console.error('[inbox_ops:messages]')` logs on integration failures. Existing application log monitoring catches these. Blast radius: single tenant's messages view — InboxOps UI unaffected.

### Category Migration on Existing Data

- **Scenario**: Adding `category` column to `inbox_proposals` table with production data. Existing proposals will have `NULL` category.
- **Severity**: Low
- **Affected area**: Proposals list filtering, category counts
- **Mitigation**: Column is nullable (`text NULL`). UI treats null as "Uncategorized" with a distinct badge. Category filter's "All" option includes uncategorized proposals. No backfill required — existing proposals are already reviewed and don't need categorization. Future proposals will be categorized during extraction.
- **Residual risk**: None — additive column with nullable default is a safe migration.
- **Detection**: Standard migration failure logs. Blast radius: deployment only — no runtime impact.

### LLM Category Accuracy

- **Scenario**: The LLM misclassifies an email category (e.g., labels a complaint as an inquiry), leading operators to miss urgent items.
- **Severity**: Medium
- **Affected area**: Proposal triage efficiency
- **Mitigation**: (1) Category is advisory, not actionable — it only affects list filtering, not execution. (2) Manual recategorization available via UI dropdown and API endpoint. (3) Confidence score from Phase 1 already flags low-certainty extractions. (4) All proposals still appear in the "All" / "Pending" view regardless of category.
- **Residual risk**: Low. Misclassification degrades triage convenience but does not affect data integrity or execution correctness.
- **Detection**: Monitor recategorization rate (manual overrides) via processing log. High override rate suggests prompt tuning needed. Blast radius: single proposal — no cascading effects.

### MCP Tool Permission Escalation

- **Scenario**: An AI Assistant user invokes `inbox_ops_accept_action` without proper permissions, bypassing the UI's permission checks.
- **Severity**: High
- **Affected area**: RBAC integrity
- **Mitigation**: (1) Each MCP tool declares `requiredFeatures` checked before handler execution. (2) `inbox_ops_accept_action` handler calls the same execution engine as the HTTP endpoint, which verifies both `inbox_ops.proposals.manage` AND the target module permission (e.g., `sales.orders.manage`). (3) Optimistic locking prevents duplicate execution. The MCP layer adds no new permission bypass vectors.
- **Residual risk**: None — same permission enforcement as HTTP endpoints.
- **Detection**: MCP server audit logs capture tool invocations with user context. Blast radius: same as HTTP endpoint — isolated to single action.

### Cache Stale Data

- **Scenario**: Counts endpoint returns stale data after a proposal status change because cache invalidation failed.
- **Severity**: Low
- **Affected area**: Proposals list tab counts
- **Mitigation**: (1) Cache TTL is 30 seconds — stale data is self-correcting. (2) Cache tags are tenant-scoped, preventing cross-tenant stale reads. (3) All write paths explicitly invalidate the counts tag. (4) Cache miss falls through to fresh database query.
- **Residual risk**: None meaningful. Worst case is 30 seconds of stale counts.
- **Detection**: Not operationally detectable (stale counts are invisible to monitoring). Self-corrects via TTL. Blast radius: single tenant's proposal count display.

### Tenant Data Isolation (Messages Integration)

- **Scenario**: Creating message_objects records that link InboxEmail to messages could leak data if tenant scoping is incorrect.
- **Severity**: High
- **Affected area**: Multi-tenant security
- **Mitigation**: `messagesIntegration.ts` passes `tenantId` and `organizationId` from the InboxOps request context to all messages module API calls. Messages module enforces its own tenant isolation. No shared global state.
- **Residual risk**: None beyond existing platform tenant isolation guarantees.
- **Detection**: Standard tenant isolation tests in CI. Blast radius: cross-tenant data exposure (critical if triggered, but multiple isolation layers prevent it).

---

## 12) Integration Test Coverage

### API Coverage

1. `POST /api/inbox_ops/extract` with text input → email created, extraction triggered, proposal with category.
2. `GET /api/inbox_ops/proposals?category=rfq` → returns only RFQ proposals.
3. `GET /api/inbox_ops/proposals/counts` → includes `byCategory` breakdown.
4. `POST /api/inbox_ops/proposals/:id/categorize` → updates category, invalidates cache.
5. `POST /api/inbox_ops/proposals/:id/actions/:actionId/accept` → creates entity, invalidates cache.

### Key UI Path Coverage

1. Proposals list with category filter dropdown → filters proposals by selected category.
2. Proposal detail shows category badge → inline edit dropdown changes category.
3. Category badges display correct colors and icons in proposals list.

### Existing Automated Coverage (from Phase 1)

- `__integration__/TC-INBOX-001.spec.ts` — proposals list, settings page rendering
- `lib/__tests__/` — email parser, contact matcher, price validator, extraction schemas, translation provider

---

## Final Compliance Report — 2026-03-03 (Rev. 1)

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/search/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Messages integration uses FK IDs via `message_objects`. No direct ORM link to messages entities |
| root AGENTS.md | Filter by `organization_id` for tenant-scoped entities | Compliant | All queries continue to scope by tenant. Messages integration passes tenant context |
| root AGENTS.md | Validate all inputs with zod | Compliant | New category endpoint uses Zod validation. MCP tool inputs validated via Zod schemas |
| root AGENTS.md | Use `findWithDecryption`/`findOneWithDecryption` | Compliant | No changes to encrypted field access patterns |
| root AGENTS.md | Never expose cross-tenant data | Compliant | MCP tools receive tenant context. Cache keys are tenant-scoped |
| root AGENTS.md | Use DI (Awilix) to inject services | Compliant | MCP tools resolve services from DI container. Messages integration resolves `messagesService` via DI |
| root AGENTS.md | Modules must remain isomorphic and independent | Compliant | InboxOps degrades gracefully without messages module. No import-time dependency |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | New categorize endpoint exports `openApi` |
| packages/core/AGENTS.md | Events: use `createModuleEvents()` with `as const` | Compliant | No new events — reuses Phase 1 events |
| packages/events/AGENTS.md | Event IDs: `module.entity.action` (singular, past tense) | Compliant | No new events |
| packages/cache/AGENTS.md | Tag-based invalidation | Compliant | Tags declared per SPEC-037 section 16.1: `inbox_ops:counts:{tenantId}`, `inbox_ops:settings:{tenantId}` |
| packages/search/AGENTS.md | Search config via `search.ts` | Compliant | Existing `search.ts` enhanced with category field |
| packages/search/AGENTS.md | MUST define `fieldPolicy.excluded` for sensitive fields | Compliant | `metadata` and `participants` already excluded in Phase 1 |
| packages/ai-assistant/AGENTS.md | MCP tools via `ai-tools.ts` export `aiTools` | Compliant | New `ai-tools.ts` follows search module pattern exactly |
| packages/ui/AGENTS.md | Use shared primitives (`DataTable`, `Badge`) | Compliant | Category filter uses `Select`, badges use `Badge` |
| packages/ui/AGENTS.md | Every dialog: Cmd/Ctrl+Enter submit, Escape cancel | Compliant | No new dialogs |
| packages/ui/AGENTS.md | i18n: `useT()` client-side | Compliant | All new strings use i18n keys |
| spec-checklist | All mutations represented as commands | Compliant | Categorize mutation exempted: single-field metadata update with no side effects — documented exception in section 5.2. MCP accept reuses Phase 1 execution engine |
| spec-checklist | Undo/rollback behavior specified | Compliant | Categorize: idempotent re-POST with `previousCategory` (section 5.2). Messages integration: intentional graceful degradation (section 6.2). MCP accept: delegates to Phase 1 execution engine |
| spec-checklist | Side-effect reversibility documented | Compliant | Messages integration reversibility documented in section 6.2 |
| spec-checklist | i18n keys planned for all user-facing strings | Compliant | Full key table in section 8 |
| spec-checklist | Pagination limits defined (`pageSize <= 100`) | Compliant | MCP tool `inbox_ops_list_proposals` capped at 50 |
| spec-checklist | Migration/backward compatibility strategy | Compliant | Section 10 covers all changes as ADDITIVE-ONLY per BACKWARD_COMPATIBILITY.md |
| spec-checklist | XSS protections documented | Compliant | Section 6.4 documents rendering strategy for email content components |
| spec-checklist | N+1 risks addressed | Compliant | Category counts: single GROUP BY (section 5.1). Message link: detail page only (section 7.3) |
| .ai/qa/AGENTS.md | Integration tests self-contained, create fixtures in setup | Compliant | Test plan uses API-based fixtures |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `category` field appears in entity, API query/response, and MCP tool schemas |
| API contracts match UI/UX section | Pass | Category filter in UI maps to `?category=` query param; badge colors match |
| Risks cover all write operations | Pass | Categorize, cache invalidation, messages integration, MCP accept all covered |
| Commands defined for all mutations | Pass | Categorize exempted with documented exception (section 5.2); MCP accept reuses Phase 1 engine |
| Cache strategy covers all read APIs | Pass | Counts and settings cached; list and detail intentionally uncached |
| N+1 risks addressed | Pass | Category counts: single GROUP BY; message links: detail page only |
| XSS protections documented | Pass | Section 6.4 covers email content rendering strategy |
| Backward compatibility reviewed | Pass | Section 10 covers all changes per BACKWARD_COMPATIBILITY.md |
| Integration tests cover affected paths | Pass | 5 API paths + 3 UI paths defined |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved for implementation.

---

## Changelog

### 2026-03-03 (Rev. 1)

- Addressed review findings: added XSS rendering strategy (section 6.4), categorize mutation undo/command exception (section 5.2), N+1 analysis for category counts and message links, MCP tool error responses, operational detection to all risks, backward compatibility section (section 10), side-effect reversibility for messages integration (section 6.2), Zod enum validation for category filter, byCategory query strategy
- Updated compliance matrix and internal consistency check to cover reviewed items

### 2026-03-03

- Initial Phase 2 specification based on team feedback from issue #573, PR #682, PR #760, issue #703
- Scope: Messages module integration (Phase 2a), email categorization (Phase 2b), MCP AI tools (Phase 2c), hardening with cache/search/tests (Phase 2d)
- Excluded from scope: Command Pattern & Undo (separate SPEC), generic extraction engine, attachments, NER, multi-channel support
- Note: Text extraction API endpoint (`POST /api/inbox_ops/extract`) already implemented in Phase 1 — no Phase 2 work needed
- Messages module (PR #569) confirmed merged 2026-02-25, unblocking Phase 2a
