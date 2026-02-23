## Summary

**InboxOps Agent** — a new `inbox_ops` core module that turns forwarded email threads into structured ERP actions. Phase 1 MVP delivers the full receive → extract → review → execute pipeline with human-in-the-loop safety.

**The problem:** SMB ops teams in distribution, manufacturing, and ecommerce spend hours daily reading customer emails and manually keying orders, quotes, contacts, and shipment updates into the ERP. Long threads bury critical details, there's no audit trail between "what was agreed in email" and "what was entered in the system", and drafting replies requires constant context-switching.

**The solution:** Employees forward email threads to a per-tenant inbox address. The system parses the thread via LLM, proposes structured actions (create order, update shipment, draft reply, etc.), and presents them for human review. Operators accept, edit, or reject each action — nothing auto-executes.

Fixes #573

---

## Architecture

### End-to-End Pipeline

```mermaid
graph TB
    subgraph "Email Reception"
        Employee["Employee forwards<br/>email thread"]
        Resend["Resend<br/>(inbound email)"]
        Webhook["Webhook Endpoint<br/>(public, signature-verified)"]
        Dedup["Deduplication<br/>(messageId + contentHash)"]
        InboxEmail["InboxEmail Entity<br/>(status: received)"]
    end

    subgraph "LLM Extraction Pipeline"
        Event["Event:<br/>inbox_ops.email.received"]
        Parser["Email Parser<br/>(mailparser + reply-parser)"]
        Matcher["Contact Matcher<br/>(findWithDecryption + fuzzy)"]
        LLM["LLM Extraction<br/>(Vercel AI SDK generateObject)<br/>Zod-validated structured output"]
        PriceVal["Price Validator<br/>(selectBestPrice)"]
        Enrich["Enrichment Layer<br/>(normalize fields, strip<br/>hallucinated IDs, auto-generate<br/>auxiliary actions)"]
    end

    subgraph "Proposal Storage"
        Proposal["InboxProposal<br/>(summary, confidence,<br/>participants, translations)"]
        Actions["InboxProposalAction[]<br/>(9 action types)"]
        Discrepancies["InboxDiscrepancy[]<br/>(price, contact, product)"]
        Notify["Notification<br/>(in-app + email)"]
    end

    subgraph "Human Review UI"
        List["Proposals List Page<br/>(status tabs, pagination)"]
        Detail["Proposal Detail Page<br/>(email thread + action cards)"]
        Controls["Accept / Edit / Reject<br/>per action"]
    end

    subgraph "Execution Engine"
        PermCheck["Cross-Module<br/>Permission Check"]
        Lock["Optimistic Locking<br/>(status === pending?)"]
        Execute["Execute Action<br/>(create order, contact, etc.)"]
        Audit["Audit Trail<br/>(inboxOpsProposalId in metadata)"]
        StatusRecalc["Recalculate<br/>Proposal Status"]
    end

    subgraph "Target Modules"
        Sales["Sales Module<br/>(orders, quotes, shipments)"]
        Customers["Customers Module<br/>(people, companies, activities)"]
        Catalog["Catalog Module<br/>(products)"]
    end

    Employee -->|forwards to<br/>ops-xxx@domain| Resend
    Resend -->|webhook POST| Webhook
    Webhook -->|Svix + HMAC<br/>signature check| Dedup
    Dedup -->|new email| InboxEmail
    InboxEmail -->|emit event| Event

    Event -->|persistent subscriber| Parser
    Parser --> Matcher
    Matcher --> LLM
    LLM --> PriceVal
    PriceVal --> Enrich

    Enrich -->|withAtomicFlush| Proposal
    Enrich -->|withAtomicFlush| Actions
    Enrich -->|withAtomicFlush| Discrepancies
    Proposal -->|event: proposal.created| Notify

    List --> Detail
    Detail --> Controls

    Controls -->|Accept| PermCheck
    PermCheck -->|403 if denied| Lock
    Lock -->|409 if processed| Execute
    Execute --> Audit
    Audit --> StatusRecalc

    Execute --> Sales
    Execute --> Customers
    Execute --> Catalog
```

### Execution Sequence (Accept Action)

```mermaid
sequenceDiagram
    participant User as Operator
    participant UI as Proposal Detail Page
    participant API as Accept API Endpoint
    participant RBAC as RBAC Service
    participant Engine as Execution Engine
    participant DB as PostgreSQL
    participant Target as Target Module<br/>(Sales / Customers / Catalog)
    participant Events as Event Bus

    User->>UI: Click "Accept" on action card
    UI->>API: POST /proposals/:id/actions/:actionId/accept

    API->>RBAC: Check inbox_ops.proposals.manage
    RBAC-->>API: OK

    API->>RBAC: Check target module permission<br/>(e.g. sales.orders.manage)
    RBAC-->>API: OK (or 403)

    API->>Engine: executeAction(actionId, userId)
    Engine->>DB: BEGIN TRANSACTION
    Engine->>DB: SELECT action WHERE status = 'pending'
    alt Already processed
        DB-->>Engine: status != 'pending'
        Engine-->>API: 409 Conflict
    else Pending
        Engine->>DB: UPDATE action SET status = 'processing'
        Engine->>Target: Create entity (order/contact/product)
        Target-->>Engine: { entityId, entityType }
        Engine->>DB: UPDATE action SET status = 'executed',<br/>createdEntityId, executedAt
        Engine->>DB: Recalculate proposal status
        Engine->>DB: COMMIT
        Engine->>Events: emit inbox_ops.action.executed
        Engine-->>API: { action, proposal }
    end

    API-->>UI: 200 OK with updated action + proposal
    UI->>UI: Show green checkmark + entity link
```

### Webhook Security (Dual Verification)

```mermaid
graph LR
    subgraph "Resend Production"
        ResendWH["Resend Webhook<br/>(svix-id, svix-timestamp,<br/>svix-signature headers)"]
    end

    subgraph "Dev/Test Scripts"
        HMAC["Custom HMAC SHA256<br/>(X-Webhook-Signature header)"]
    end

    subgraph "Webhook Endpoint"
        Verify{"Verify signature<br/>(try Svix first,<br/>then HMAC)"}
        RateLimit["Rate Limit<br/>(10/min, 100/hr,<br/>1000/day per address)"]
        Replay["Replay Protection<br/>(reject > 5min old)"]
        Size["Payload Size<br/>(max 2MB)"]
        Tenant["Resolve Tenant<br/>(from 'to' address)"]
    end

    ResendWH --> Verify
    HMAC --> Verify
    Verify -->|valid| RateLimit
    Verify -->|invalid| Reject["400 Bad Request"]
    RateLimit --> Replay
    Replay --> Size
    Size --> Tenant
    Tenant --> Process["Parse & Store Email"]
```

### Data Model

```mermaid
erDiagram
    InboxSettings {
        uuid id PK
        string inbox_address UK
        string working_language
        boolean is_active
        uuid organization_id
        uuid tenant_id
    }

    InboxEmail {
        uuid id PK
        string message_id "RFC 822 (dedup primary)"
        string content_hash "SHA-256 (dedup secondary)"
        string forwarded_by_address "encrypted"
        string subject "encrypted"
        string raw_text "encrypted"
        string cleaned_text "encrypted"
        json thread_messages "encrypted JSON"
        string detected_language
        string status "received|processing|processed|needs_review|failed"
        uuid organization_id
        uuid tenant_id
    }

    InboxProposal {
        uuid id PK
        uuid inbox_email_id FK
        string summary "encrypted"
        json participants "encrypted JSON"
        decimal confidence "0.00-1.00"
        string detected_language
        string working_language
        json translations "cached per locale"
        string status "pending|partial|accepted|rejected"
        boolean possibly_incomplete
        uuid organization_id
        uuid tenant_id
    }

    InboxProposalAction {
        uuid id PK
        uuid proposal_id FK
        integer sort_order
        string action_type "9 types"
        string description "encrypted"
        json payload "encrypted, Zod-validated"
        string status "pending|processing|accepted|rejected|executed|failed"
        decimal confidence
        string required_feature
        uuid matched_entity_id "existing entity ref"
        uuid created_entity_id "after execution"
        uuid organization_id
        uuid tenant_id
    }

    InboxDiscrepancy {
        uuid id PK
        uuid proposal_id FK
        uuid action_id FK "nullable"
        string type "price|quantity|contact|currency|date|product|duplicate"
        string severity "warning|error"
        string description
        boolean resolved "auto on action accept"
        uuid organization_id
        uuid tenant_id
    }

    InboxSettings ||--o{ InboxEmail : "tenant inbox"
    InboxEmail ||--o{ InboxProposal : "generates"
    InboxProposal ||--o{ InboxProposalAction : "contains"
    InboxProposal ||--o{ InboxDiscrepancy : "flags"
    InboxProposalAction ||--o{ InboxDiscrepancy : "linked to"
```

---

## Changes

### New Module: `packages/core/src/modules/inbox_ops/`
76 source files | 5 entities | 15 API routes | 4 backend pages | 20 test files | ~16K lines

### Inbound Email Reception
- Public webhook endpoint with **dual signature verification**: Svix (Resend native) + custom HMAC SHA256 for dev/testing
- Rate limiting: 10/min, 100/hour, 1000/day per inbox address
- Deduplication by RFC 822 Message-ID (primary) and content SHA-256 hash (secondary)
- Replay protection (reject >5 min), 2MB payload limit
- Email thread parsing via `mailparser` + `email-reply-parser` — signature stripping, thread splitting, language detection

### LLM Extraction Pipeline
- Persistent event subscriber on `inbox_ops.email.received`
- Vercel AI SDK `generateObject()` with shared OpenCode provider contract
- Zod-enforced structured output: summary, participants, proposed actions, discrepancies, draft replies, confidence score
- Email content in `<email_content>` XML delimiters to resist prompt injection
- Business rule guardrails: max quantity 10K, max order value $1M, max 20 actions/proposal
- **Contact matching**: exact email via `findWithDecryption`, fuzzy name via query engine
- **Price validation**: `selectBestPrice` with channel/customer/quantity context, configurable threshold (default 5%)
- **Auto-generated auxiliary actions**: `create_contact` for unknown participants, `link_contact` for matched CRM contacts, `create_product` for unmatched catalog products
- **Enrichment**: normalizes LLM field name variations, strips hallucinated productIds, resolves missing currency codes from channel defaults, validates draft reply addresses against parsed headers

### 9 Action Types

| Action | What it does | Required permission |
|--------|-------------|-------------------|
| `create_order` | Creates SalesOrder (or SalesQuote if Quote→Order flow required) | `sales.orders.manage` |
| `create_quote` | Creates SalesQuote | `sales.quotes.manage` |
| `update_order` | Typed operations: quantity changes, delivery dates, notes | `sales.orders.manage` |
| `update_shipment` | Updates tracking, carrier, status via dictionary lookup | `sales.shipments.manage` |
| `create_contact` | Creates Person or Company with `source: 'inbox_ops'` | `customers.people.manage` |
| `create_product` | Creates catalog product for unmatched line items | `catalog.products.manage` |
| `link_contact` | Links email participant to existing CRM contact | `customers.people.manage` |
| `log_activity` | Logs email/call/meeting activity on contact record | `customers.activities.manage` |
| `draft_reply` | Generates contextual reply draft with ERP data, sendable via Resend | `inbox_ops.replies.send` |

### Execution Engine
- **Cross-module permission enforcement**: accepting `create_order` requires both `inbox_ops.proposals.manage` AND `sales.orders.manage`
- **Optimistic locking**: checks `action.status === 'pending'` within transaction, returns 409 on concurrent accept
- **Proposal status recalculation**: all accepted → `accepted`, all rejected → `rejected`, mix → `partial`
- **Audit trail**: stores `inboxOpsProposalId` + `inboxOpsActionId` in created entity's `metadata` JSONB
- **Discrepancy auto-resolution**: creating a contact resolves `unknown_contact`, creating a product resolves `product_not_found` and back-patches `productId` into related order line items
- **Duplicate prevention**: checks existing contacts by email before creating
- **Quote→Order flow**: detects tenant's SalesChannel config and auto-switches `create_order` to `create_quote`

### Backend UI (4 pages)
- **Proposals List** (`/backend/inbox-ops`) — status tabs with counts, pagination, search, empty state with setup instructions
- **Proposal Detail** (`/backend/inbox-ops/proposals/:id`) — responsive two-panel layout (email thread left, AI summary + action cards right), Accept All with confirmation dialog
- **Processing Log** (`/backend/inbox-ops/log`) — all received emails with processing status
- **Settings** (`/backend/inbox-ops/settings`) — forwarding address with copy button, working language selector, active toggle

### Translation Support
- Configurable working language per tenant in Settings
- On-demand proposal translation via LLM (summary + action descriptions)
- Cached translations stored in `InboxProposal.translations` JSONB
- `POST /api/inbox-ops/proposals/:id/translate` endpoint

### RBAC (5 features)

| Permission | Admin | Employee | Description |
|------------|:-----:|:--------:|-------------|
| `inbox_ops.proposals.view` | x | x | View proposals |
| `inbox_ops.proposals.manage` | x | x | Accept/reject/edit actions |
| `inbox_ops.settings.manage` | x | | Configure inbox settings |
| `inbox_ops.log.view` | x | | View processing log |
| `inbox_ops.replies.send` | x | x | Send draft replies |

### Other
- **i18n**: All 4 locales (en, de, es, pl) + template locales
- **User guide**: `apps/docs/docs/user-guide/inbox-ops.mdx` — full setup walkthrough (Resend domain, webhook, env vars, verification, troubleshooting)
- **Shared AI utilities**: OpenCode provider/model resolution extracted to `packages/shared/src/lib/ai/` for reuse across InboxOps and AI Assistant
- **Events**: 14 domain events (`inbox_ops.email.received`, `inbox_ops.proposal.created`, `inbox_ops.action.executed`, etc.)
- **Notifications**: In-app + email notification on proposal creation targeting `inbox_ops.proposals.manage` users
- **`.env.example`**: Updated both `apps/mercato/` and `packages/create-app/template/` with all InboxOps env vars

---

## Architecture Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| LLM integration | Vercel AI SDK `generateObject()` + shared OpenCode provider | Reuses existing config, avoids parallel provider stacks, Zod validation in one place |
| Email provider | Resend inbound webhooks | Consistent with existing outbound email setup |
| Execution model | Human-in-the-loop proposals | LLM accuracy insufficient for unsupervised order creation |
| Data storage | Own `InboxEmail` entity (not Messages module) | Messages module (PR #569) not yet merged — forward-compatible for Phase 2a migration |
| Webhook security | Dual verification (Svix + HMAC) | Svix for production Resend, HMAC for dev/testing scripts |
| Cross-module refs | FK IDs only, no ORM relationships | Per project convention — modules remain independent |

---

## Configuration

### Required
```env
RESEND_API_KEY=re_...                          # Fetch full email content
RESEND_WEBHOOK_SIGNING_SECRET=whsec_...        # Svix signature verification
INBOX_OPS_DOMAIN=your-id.resend.app            # Receiving domain
OPENCODE_PROVIDER=anthropic                    # LLM provider (anthropic/openai/google)
ANTHROPIC_API_KEY=sk-ant-...                   # Provider API key
```

### Optional tuning
```env
INBOX_OPS_WEBHOOK_SECRET=...                   # Custom HMAC for dev testing
INBOX_OPS_LLM_MODEL=...                        # Override default model
INBOX_OPS_LLM_TIMEOUT_MS=90000                 # LLM timeout (default 90s)
INBOX_OPS_CONFIDENCE_THRESHOLD=0.5             # Below this → needs_review
INBOX_OPS_MAX_TEXT_SIZE=204800                  # Max text to LLM (200KB)
INBOX_OPS_PRICE_MISMATCH_THRESHOLD=0.05        # 5% tolerance
```

---

## How to Test

1. Configure env vars (see user guide: `apps/docs/docs/user-guide/inbox-ops.mdx`)
2. Start the dev server (`yarn dev`)
3. Forward a test email to your tenant's inbox address (visible at `/backend/inbox-ops/settings`)
4. Watch the Processing Log (`/backend/inbox-ops/log`) — email should appear within seconds
5. After ~30s, a proposal appears at `/backend/inbox-ops` with extracted actions
6. Review, accept, or reject actions — accepted orders/contacts appear in their respective modules

For local testing without Resend, use the HMAC webhook scripts:
```bash
scripts/test-inbox-webhook.sh        # English order email
scripts/test-inbox-webhook-polish.sh # Polish language test
scripts/test-inbox-webhook-quote.sh  # Quote request test
```

---

## Specification

**Does a spec exist for this feature/module?**
- [x] Yes

**Spec file path:** `.ai/specs/SPEC-029-2026-02-15-inbox-ops-agent.md`

## Testing

- Unit tests for email parser, webhook validation, dedup logic, extraction Zod schemas
- Unit tests for contact matcher, price validator, translation provider
- API route tests for action accept (permission verification, optimistic locking, idempotency)
- API route tests for email reprocess (supersede/409 behavior)
- Shared OpenCode provider/model resolution tests
- Manual webhook testing scripts in `scripts/test-inbox-webhook*.sh`

```bash
yarn test packages/core/src/modules/inbox_ops/
yarn test packages/shared/src/lib/ai/
```

## Checklist

- [ ] This pull request targets `develop`.
- [x] I have read and accept the Open Mercato Contributor License Agreement (see `docs/cla.md`).
- [x] I updated documentation, locales, or generators if the change requires it.
- [x] I added or adjusted tests that cover the change.
- [ ] I added or updated integration tests in `.ai/qa/tests/` (or documented why integration coverage is not required).
- [x] I created or updated the spec in `.ai/specs/` with a changelog entry (if applicable).

**Integration tests note:** Playwright integration tests are planned for Phase 2d. Phase 1 covers unit tests and API route tests for core extraction and execution logic.

## Linked issues

Fixes #573

---

## Phase 2 Roadmap

| Phase | Scope | Blocked by |
|-------|-------|-----------|
| **2a** | Messages module integration — register as message type, use for draft replies and threading | PR #569 merge |
| **2b** | Command pattern & undo — register `CommandHandler` instances for all mutations | — |
| **2c** | MCP AI tools — `inbox_ops_categorize_message`, `inbox_ops_query_proposals`, etc. | — |
| **2d** | Hardening — cache strategy, full search indexing, Playwright integration tests, data retention | — |
| **2e** | Advanced — generic extraction engine (YAML schemas), attachment/PDF processing, NER reference linking, usage stats | Separate SPEC |
