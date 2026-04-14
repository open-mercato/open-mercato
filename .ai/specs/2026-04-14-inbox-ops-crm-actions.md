# Inbox-Ops CRM Action Handlers & Foundation

| Field | Value |
|-------|-------|
| **Status** | Approved |
| **Created** | 2026-04-14 |
| **App Spec** | `2026-04-14-inbox-ops-lead-intake-app-spec.md` |
| **Related Specs** | `2026-04-14-inbox-ops-knowledge-base.md` (Spec 2), `2026-04-14-inbox-ops-enrichment.md` (Spec 3) |
| **Depends On** | -- (foundation spec) |
| **Blocked By** | -- |

## TLDR

This is the foundation spec for the Inbox-Ops Lead Intake feature. It delivers three new inbox action handlers (`create_deal`, `update_contact`, `update_deal`), extends all four inbox-ops enum types with CRM-oriented values, declares custom fields on `customers:customer_deal` for lead scoring, and adds acceptance-time dedup logic to the existing `create_contact` handler. All changes are additive-only. No new entities, no new API routes, no new backend pages. Every change stays within the existing `InboxActionDefinition` extensibility contract.

**Key concerns:**
- Custom fields declared by inbox_ops on a customers entity -- requires dependency guard (`tryResolve`)
- `update_deal` handler is the first inbox action to use `splitCustomFieldPayload` -- sets the pattern for future handlers
- Coordinated enum commit across `entities.ts`, `validators.ts`, and `constants.ts` must be atomic to avoid type mismatches
- Acceptance-time dedup in `create_contact` modifies an existing, well-tested handler -- risk of regression

## Technical Approach (Piotr)

| Decision | Rationale |
|----------|-----------|
| **Mode: UMES extension of customers module** | New action handlers extend the customers module's inbox-actions surface without modifying inbox_ops core. Follows bounded-context contract -- inbox_ops defines payload schemas; customers provides execution. |
| **Mechanism: `InboxActionDefinition` registration in `customers/inbox-actions.ts`** | Auto-discovered via generated registry. Same file as existing handlers (`create_contact`, `link_contact`, `log_activity`, `draft_reply`). No new discovery path needed. |
| **`create_deal` via `executeCommand('customers.deals.create', ...)`** | Reuses existing command pattern with full undo/audit support. Command already handles `parseWithCustomFields`, pipeline stage resolution, and person/company linking. |
| **`update_deal` with `splitCustomFieldPayload`** | First inbox action handler to write custom field values. Uses `splitCustomFieldPayload` from `@open-mercato/shared/lib/crud/custom-fields` to separate base fields from `cf_*` / `customFields` entries before passing to the command. |
| **`update_contact` via `executeCommand('customers.people.update'` / `'customers.companies.update'`)** | Dispatches to person or company update based on `entityType`. Passes `relationshipType` and custom fields through the existing command surface. |
| **Acceptance-time dedup on `create_contact`** | Query CRM at execution time (not extraction time). If duplicate found, silently convert to `link_contact` semantics -- return `matchedEntityId` instead of creating. Prevents duplicates from concurrent proposal acceptance. |
| **All enum extensions in one coordinated commit** | Avoids type mismatches between `entities.ts` type unions, `validators.ts` Zod enums, and `constants.ts` feature map. Single commit, single review. |

## Overview

The inbox-ops module currently handles commerce-oriented emails (orders, quotes, shipments). This spec extends it to handle CRM/lead intake emails by adding three new action types and supporting infrastructure. After implementation, the extraction LLM can propose deal creation, contact enrichment, and deal updates -- and users can accept those proposals to execute CRM mutations through the existing review flow.

This is the foundation layer. Spec 2 (Knowledge Base) teaches the LLM *when* to propose these actions. Spec 3 (Enrichment) adds *how* to match emails to existing records. This spec delivers the *what* -- the action handlers that do the actual CRM work.

**App Spec coverage:** SS1.1-1.4 (domain model), SS1.4 "New Action Types", SS1.4 "Custom Fields for Scoring Data", SS1.4 "New Proposal Categories", SS1.4 "New Discrepancy Types", SS2 WF1 "OM readiness" rows for action execution.

## Problem Statement

1. **No deal creation from email.** When a sales rep forwards a lead email, inbox-ops can create a contact but cannot create an associated deal. The rep must manually navigate to CRM and create the deal -- defeating the purpose of the automated intake.

2. **No contact enrichment from email.** When a follow-up email arrives with scoring data or classification updates, there is no action type to update an existing contact's `relationshipType` or custom fields. The data is visible in the proposal summary but not actionable.

3. **No deal updates from email.** Scoring reports that should update deal temperature, lead score, or pipeline stage cannot be executed through the proposal flow.

4. **Missing CRM-oriented vocabulary.** The category, discrepancy, and participant role enums lack values needed for lead intake workflows (`lead_intake`, `ambiguous_match`, `lead`, etc.).

5. **No structured scoring fields.** Deal temperature, lead score, and lead source have no declared custom field definitions, making them inconsistent across tenants and unqueryable.

6. **Duplicate contacts on concurrent acceptance.** When two proposals reference the same person email, accepting both creates duplicate contacts. No dedup check exists at execution time.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Handlers in `customers/inbox-actions.ts`, not in inbox_ops | Bounded context: customers module owns CRM mutation logic. Inbox_ops owns extraction and proposal flow. |
| Custom fields declared in `inbox_ops/ce.ts`, not `customers/ce.ts` | These fields serve the inbox-ops use case (lead scoring). Customers module should not depend on inbox-ops concepts. Dependency guard skips declaration if customers module is absent. |
| `splitCustomFieldPayload` over manual `cf_` prefix parsing | Shared utility handles both `customFields: {}` object form and `cf_<key>` flat form. Consistent with CRUD route pattern. |
| Dedup in `create_contact` handler, not in extraction worker | Extraction happens once; acceptance can happen minutes/hours later. Another proposal may have created the contact in between. Execution-time dedup is the only reliable check. |
| New enum values are additive only | BC contract: `InboxActionType`, `InboxProposalCategory`, `InboxDiscrepancyType`, `ExtractedParticipant.role` are FROZEN surfaces. Only additive changes allowed. |
| `update_contact` dispatches to people.update or companies.update | Contact update semantics differ between person and company. Single handler with `entityType` discriminator avoids two near-identical handlers. |
| No new `classify_lead` action type | Classification is handled via `relationshipType` on `create_contact` / `update_contact`. Knowledge Base guides the LLM on what values to use. Less rigid, more flexible. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Separate `inbox-actions.ts` file per action type | Over-engineering for 3 handlers. Existing file has 4 handlers and is readable at ~350 lines. Adding 3 more keeps it under 600 lines. |
| Custom fields in `customers/customFieldDefaults.ts` | Would couple customers module to inbox-ops domain concepts (lead scoring). The customers module should remain generic. |
| Dedup at extraction time via contactMatcher | Extraction happens once at ingest. Between extraction and acceptance, another proposal may create the contact. Only execution-time dedup prevents the race. |
| Separate `update_person` and `update_company` action types | Forces the LLM to distinguish person vs company at extraction time (often ambiguous from email alone). Single `update_contact` with `entityType` field defers the decision to the matched entity. |
| Custom entity for lead scoring (new table) | Violates "temperature lives on deals, not contacts" invariant. Custom fields on `CustomerDeal` are the OM-idiomatic pattern -- queryable, filterable, admin-configurable. |

## Architecture

```
Email → Webhook → extractionWorker → LLM (with new action types in schema)
                                        ↓
                                   InboxProposal
                                   + InboxProposalAction (type: create_deal | update_contact | update_deal)
                                        ↓
                                   User reviews on /backend/inbox-ops
                                        ↓
                                   Accept action → executionEngine.executeAction()
                                        ↓
                                   executeByType() → getInboxAction(type)
                                        ↓
                                   customers/inbox-actions.ts handler
                                        ↓
                                   executeCommand('customers.deals.create' | 'customers.people.update' | ...)
                                        ↓
                                   CRM record created/updated (with undo token)
```

**No new architectural components.** The entire flow uses existing infrastructure:
- `InboxActionDefinition` registry (auto-discovered via generator)
- `executeByType()` dispatches to registered handler
- `executeCommand()` executes via CommandBus with full undo support
- `splitCustomFieldPayload()` separates custom fields for the command layer

**Cross-module dependency:**
- `inbox_ops/ce.ts` declares fields on `customers:customer_deal` (soft dependency, guarded)
- `inbox_ops/setup.ts` seeds custom field definitions via `tryResolve` (skipped if customers absent)
- `customers/inbox-actions.ts` imports payload schemas from `inbox_ops/data/validators.ts` (existing pattern)

## Data Models

### Enum Extensions (additive-only)

#### `InboxActionType` (entities.ts)

```typescript
export type InboxActionType =
  | 'create_order'
  | 'create_quote'
  | 'update_order'
  | 'update_shipment'
  | 'create_contact'
  | 'create_product'
  | 'link_contact'
  | 'log_activity'
  | 'draft_reply'
  // New CRM action types
  | 'create_deal'
  | 'update_contact'
  | 'update_deal'
```

#### `InboxProposalCategory` (entities.ts)

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
  // New CRM categories
  | 'lead_intake'
  | 'lead_enrichment'
  | 'lead_followup'
```

#### `InboxDiscrepancyType` (entities.ts)

```typescript
export type InboxDiscrepancyType =
  | 'price_mismatch'
  | 'quantity_mismatch'
  | 'unknown_contact'
  | 'currency_mismatch'
  | 'date_conflict'
  | 'product_not_found'
  | 'duplicate_order'
  | 'other'
  // New CRM discrepancy types
  | 'ambiguous_match'
  | 'low_confidence_match'
  | 'duplicate_contact'
  | 'stale_contact'
  | 'pending_intake_match'
```

#### `ExtractedParticipant.role` (entities.ts)

```typescript
role: 'buyer' | 'seller' | 'logistics' | 'finance' | 'other'
  // New CRM participant roles
  | 'lead' | 'referrer' | 'reporter' | 'decision_maker'
```

### New Payload Schemas (validators.ts)

#### `createDealPayloadSchema`

```typescript
export const createDealPayloadSchema = z.object({
  title: z.string().trim().min(1).max(300),
  source: z.string().trim().max(200).optional(),
  pipelineId: uuid().optional(),
  stageId: uuid().optional(),
  personId: uuid().optional(),
  companyId: uuid().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().trim().max(4000).optional(),
})

export type CreateDealPayload = z.infer<typeof createDealPayloadSchema>
```

#### `updateContactPayloadSchema`

```typescript
export const updateContactPayloadSchema = z.object({
  entityId: uuid(),
  entityType: lowercaseContactType,
  relationshipType: z.string().trim().max(200).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().trim().max(4000).optional(),
})

export type UpdateContactPayload = z.infer<typeof updateContactPayloadSchema>
```

#### `updateDealPayloadSchema`

```typescript
export const updateDealPayloadSchema = z.object({
  dealId: uuid(),
  stageId: uuid().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().trim().max(4000).optional(),
})

export type UpdateDealPayload = z.infer<typeof updateDealPayloadSchema>
```

### Extraction Output Schema Extensions (validators.ts)

The `extractedActionSchema.actionType` enum gains the three new values:

```typescript
export const extractedActionSchema = z.object({
  actionType: z.enum([
    'create_order',
    'create_quote',
    'update_order',
    'update_shipment',
    'create_contact',
    'create_product',
    'link_contact',
    'log_activity',
    'draft_reply',
    // New
    'create_deal',
    'update_contact',
    'update_deal',
  ]),
  // ... rest unchanged
})
```

The `extractedParticipantSchema.role` enum gains four new values:

```typescript
export const extractedParticipantSchema = z.object({
  name: z.string(),
  email: z.string(),
  role: z.enum([
    'buyer', 'seller', 'logistics', 'finance', 'other',
    // New
    'lead', 'referrer', 'reporter', 'decision_maker',
  ]),
})
```

The `extractedDiscrepancySchema.type` enum gains five new values:

```typescript
export const extractedDiscrepancySchema = z.object({
  type: z.enum([
    'price_mismatch', 'quantity_mismatch', 'unknown_contact',
    'currency_mismatch', 'date_conflict', 'product_not_found',
    'duplicate_order', 'other',
    // New
    'ambiguous_match', 'low_confidence_match', 'duplicate_contact',
    'stale_contact', 'pending_intake_match',
  ]),
  // ... rest unchanged
})
```

The `inboxProposalCategoryEnum` gains three new values:

```typescript
export const inboxProposalCategoryEnum = z.enum([
  'rfq', 'order', 'order_update', 'complaint',
  'shipping_update', 'inquiry', 'payment', 'other',
  // New
  'lead_intake', 'lead_enrichment', 'lead_followup',
])
```

### REQUIRED_FEATURES_MAP Extension (constants.ts)

```typescript
export const REQUIRED_FEATURES_MAP: Record<InboxActionType, string> = {
  // ... existing entries
  create_deal: 'customers.deals.manage',
  update_contact: 'customers.people.manage',
  update_deal: 'customers.deals.manage',
} as const
```

Note: `update_contact` maps to `customers.people.manage` as the default. The handler checks `customers.companies.manage` at runtime when `entityType === 'company'`. **Design exception:** This is the only action type where `REQUIRED_FEATURES_MAP` and runtime checks diverge. The map provides the default gate; the handler performs an additional `userHasFeature('customers.companies.manage')` check for company entities. Future action types with entity-type polymorphism should follow this same pattern.

### ACTION_PAYLOAD_SCHEMAS Extension (validators.ts)

```typescript
const ACTION_PAYLOAD_SCHEMAS: Record<string, z.ZodType> = {
  // ... existing entries
  create_deal: createDealPayloadSchema,
  update_contact: updateContactPayloadSchema,
  update_deal: updateDealPayloadSchema,
}
```

### Custom Fields Declaration (inbox_ops/ce.ts)

```typescript
import { cf } from '@open-mercato/shared/modules/dsl'

export const entities = [
  {
    id: 'inbox_ops:inbox_proposal',
    label: 'Inbox Proposal',
    description: 'LLM-extracted action proposals from forwarded email threads.',
    labelField: 'summary',
    showInSidebar: false,
    defaultEditor: false,
    fields: [],
  },
]

/**
 * Custom fields declared on customers:customer_deal for lead scoring.
 * These fields serve the inbox-ops lead intake use case.
 * The seeding in setup.ts uses tryResolve to skip if customers module is absent.
 */
export const LEAD_SCORING_DEAL_FIELDS = [
  cf.select('temperature', ['HOT', 'WARM', 'COOL', 'COLD'], {
    label: 'Temperature',
    description: 'Deal urgency signal — HOT (contact today), WARM (48h), COOL (passive), COLD (no action).',
    filterable: true,
  }),
  cf.number('lead_score', {
    label: 'Lead Score',
    description: 'Qualification score from 0 to 100.',
    filterable: true,
  }),
  cf.text('lead_source', {
    label: 'Lead Source',
    description: 'Origin of the lead (e.g., email, referral, conference).',
    filterable: true,
  }),
]

export default entities
```

### Custom Field Seeding (inbox_ops/setup.ts)

```typescript
// In seedDefaults():
async seedDefaults({ em, tenantId, organizationId, container }) {
  // Dependency guard: skip if customers module or data engine not available
  let dataEngine: DataEngine | null = null
  try {
    dataEngine = container.resolve('dataEngine') as DataEngine
  } catch {
    return // customers module not enabled, skip custom field seeding
  }

  const targetEntityId = 'customers:customer_deal'
  // Check if entity exists in registry before attempting to seed
  try {
    const entityRegistry = container.resolve('entityRegistry') as EntityRegistry
    const entityDef = entityRegistry.get(targetEntityId)
    if (!entityDef) return
  } catch {
    return
  }

  for (const field of LEAD_SCORING_DEAL_FIELDS) {
    // Idempotent: skip if field already exists
    const existing = await dataEngine.getCustomFieldDefinition({
      entityId: targetEntityId,
      fieldKey: field.key,
      tenantId,
      organizationId,
    })
    if (!existing) {
      await dataEngine.createCustomFieldDefinition({
        entityId: targetEntityId,
        ...field,
        tenantId,
        organizationId,
      })
    }
  }
}
```

## API Contracts

**No new API routes.** All changes operate through existing surfaces:

| Surface | Change | Impact |
|---------|--------|--------|
| `POST /api/inbox-ops/proposals/:id/actions/:actionId/accept` | Now accepts `create_deal`, `update_contact`, `update_deal` action types | Existing route, new action type values dispatched by `executeByType()` |
| `GET /api/inbox-ops/proposals` | `category` filter now accepts `lead_intake`, `lead_enrichment`, `lead_followup` | Additive filter values |
| `POST /api/inbox-ops/extract` | LLM extraction output now includes new action types in `proposedActions` | Schema extension only, no endpoint change |
| `GET /api/inbox-ops/proposals/:id` | Response may include actions with new types | Existing response shape, new `actionType` values in action objects |

**OpenAPI impact:** The `extractedActionSchema` enum in the extraction route's OpenAPI spec gains three values. The `inboxProposalCategoryEnum` in the proposal list query schema gains three values. Both are additive and do not require version bumps.

### Undo Semantics

| Handler | Undo Behavior |
|---------|--------------|
| `create_deal` | Soft-deletes the created deal (standard `customers.deals.create` undo) |
| `update_contact` | Reverts person/company fields to their previous values (standard command undo snapshot) |
| `update_deal` | Reverts deal fields and custom field values to their previous state (standard command undo snapshot) |
| `create_contact` (dedup case) | No undo needed — linking an existing entity is non-destructive |

## Backward Compatibility

| Surface | Classification | Change | BC Impact |
|---------|---------------|--------|-----------|
| `InboxActionType` type union | FROZEN | Add `create_deal`, `update_contact`, `update_deal` | Additive-only. Existing code using `switch` on action type will hit `default` case for new values (safe -- `executeByType` uses registry lookup, not switch). |
| `InboxProposalCategory` type union | FROZEN | Add `lead_intake`, `lead_enrichment`, `lead_followup` | Additive-only. Existing category filters pass through; UI renders unknown categories with fallback label. |
| `InboxDiscrepancyType` type union | FROZEN | Add 5 new values | Additive-only. Existing discrepancy rendering uses generic fallback for unknown types. |
| `ExtractedParticipant.role` | FROZEN | Add `lead`, `referrer`, `reporter`, `decision_maker` | Additive-only. Existing role display uses generic "Other" fallback. |
| `InboxActionDefinition` interface | STABLE | No changes to interface | New handlers implement existing interface. |
| `REQUIRED_FEATURES_MAP` | Internal | Add 3 entries | Internal constant, not a contract surface. |
| `ACTION_PAYLOAD_SCHEMAS` | Internal | Add 3 entries | Internal validation map, not a contract surface. |
| `create_contact` handler | Internal | Add dedup check before creation | Behavioral change: duplicate contacts now return `matchedEntityId` instead of `createdEntityId`. The execution engine treats both as success. |
| `inbox_ops/ce.ts` | Module file | Add `LEAD_SCORING_DEAL_FIELDS` export | New export, does not modify existing `entities` export. |
| Custom fields on `customers:customer_deal` | Additive | 3 new custom field definitions | Additive-only. Existing custom fields on deals are unchanged. New fields are optional and tenant-scoped. |

**No breaking changes.** All modifications are additive extensions to FROZEN or STABLE surfaces.

## Commit Plan

### Commit 1: Coordinated enum extensions + extraction output schema + feature map

**Scope:** Add all new enum values to type unions, Zod schemas (including extraction output schemas), feature map, and extraction output schema extensions in a single atomic commit. This covers both the internal type system and the LLM-facing extraction contract.

**Pattern:** Additive-only type/enum extension

**Files:**
- `packages/core/src/modules/inbox_ops/data/entities.ts` -- extend `InboxActionType`, `InboxProposalCategory`, `InboxDiscrepancyType`, `ExtractedParticipant.role`
- `packages/core/src/modules/inbox_ops/data/validators.ts` -- extend `inboxProposalCategoryEnum`, `extractedActionSchema.actionType`, `extractedParticipantSchema.role`, `extractedDiscrepancySchema.type` (both internal Zod enums and extraction output Zod enums)
- `packages/core/src/modules/inbox_ops/lib/constants.ts` -- add `create_deal`, `update_contact`, `update_deal` to `REQUIRED_FEATURES_MAP`

**Delivers:** All new enum values recognized by TypeScript, Zod validation, feature mapping, and LLM extraction output schemas

**Depends on:** --

### Commit 2: New payload schemas

**Scope:** Add Zod schemas and types for the three new action payloads. Register them in `ACTION_PAYLOAD_SCHEMAS`.

**Pattern:** Zod schema definition (follows existing `createContactPayloadSchema` pattern)

**Files:**
- `packages/core/src/modules/inbox_ops/data/validators.ts` -- add `createDealPayloadSchema`, `updateContactPayloadSchema`, `updateDealPayloadSchema`, type exports, and `ACTION_PAYLOAD_SCHEMAS` entries

**Delivers:** Payload validation for new action types

**Depends on:** Commit 1 (action type enum values)

### Commit 3: Custom fields declaration in ce.ts

**Scope:** Declare `LEAD_SCORING_DEAL_FIELDS` (temperature, lead_score, lead_source) as custom fields on `customers:customer_deal` in `inbox_ops/ce.ts`.

**Pattern:** Cross-module custom field declaration (new pattern for inbox_ops)

**Files:**
- `packages/core/src/modules/inbox_ops/ce.ts` -- add `LEAD_SCORING_DEAL_FIELDS` export with `cf.select`, `cf.number`, `cf.text`

**Delivers:** Custom field definitions available for seeding

**Depends on:** --

### Commit 4: Seed custom fields in setup.ts

**Scope:** Add `seedDefaults` implementation to inbox_ops `setup.ts` that creates custom field definitions on `customers:customer_deal` with dependency guard.

**Pattern:** `tryResolve` dependency guard + idempotent seeding

**Files:**
- `packages/core/src/modules/inbox_ops/setup.ts` -- add `seedDefaults` with `dataEngine` resolution, entity registry check, and field creation loop

**Delivers:** Custom fields auto-created on tenant initialization (when customers module is present)

**Existing tenants:** The `seedDefaults` function is idempotent, but only runs during `mercato init`. For existing tenants, run `mercato entities install --tenant <tenantId>` to install the custom field definitions declared in `ce.ts`. This command is idempotent and safe to re-run.

**Depends on:** Commit 3

### Commit 5: Implement `create_deal` action handler

**Scope:** Add `create_deal` handler to `customers/inbox-actions.ts`. Uses `executeCommand('customers.deals.create', ...)` with person/company linking and custom field pass-through.

**Pattern:** Follows existing `executeCreateContactAction` pattern

**Files:**
- `packages/core/src/modules/customers/inbox-actions.ts` -- add `executeCreateDealAction` function and `InboxActionDefinition` entry

**Handler implementation:**
- Build command input: `{ title, source, pipelineId, pipelineStageId: stageId, personIds: [personId], companyIds: [companyId], organizationId, tenantId, ...customFields }`
- Call `executeCommand(hCtx, 'customers.deals.create', input)`
- Return `{ createdEntityId: result.dealId, createdEntityType: 'customer_deal' }`
- `promptSchema`: document payload shape for LLM
- `promptRules`: "For create_deal: always set source to 'inbox_ops'. When a contact was just created in the same proposal, reference it via personId or companyId."
- `requiredFeature`: `'customers.deals.manage'`

**Delivers:** Users can accept `create_deal` actions from proposals

**Depends on:** Commits 1, 2

### Commit 6: Implement `update_contact` action handler

**Scope:** Add `update_contact` handler to `customers/inbox-actions.ts`. Dispatches to `customers.people.update` or `customers.companies.update` based on `entityType`.

**Pattern:** Follows existing handler pattern with entityType discriminator

**Files:**
- `packages/core/src/modules/customers/inbox-actions.ts` -- add `executeUpdateContactAction` function and `InboxActionDefinition` entry

**Handler implementation:**
- Validate `entityId` exists in CRM
- Build command input based on `entityType`:
  - Person: `{ id: entityId, relationshipType, organizationId, tenantId, ...customFields }`
  - Company: `{ id: entityId, relationshipType, organizationId, tenantId, ...customFields }`
- If `notes` provided, additionally call `executeCommand(hCtx, 'customers.interactions.create', ...)` to log the enrichment as an activity
- Call `executeCommand(hCtx, commandId, input)`
- Return `{ createdEntityId: entityId, createdEntityType: entityType === 'company' ? 'customer_company' : 'customer_person' }`
- `requiredFeature`: `'customers.people.manage'` (runtime check for company type uses `userHasFeature`)

**Delivers:** Users can accept `update_contact` actions to enrich existing CRM records

**Depends on:** Commits 1, 2

### Commit 7: Implement `update_deal` action handler with splitCustomFieldPayload

**Scope:** Add `update_deal` handler to `customers/inbox-actions.ts`. First handler to use `splitCustomFieldPayload` for custom field integration.

**Pattern:** New pattern: `splitCustomFieldPayload` in inbox action handler

**Files:**
- `packages/core/src/modules/customers/inbox-actions.ts` -- add `executeUpdateDealAction` function and `InboxActionDefinition` entry

**Handler implementation:**
- Import `splitCustomFieldPayload` from `@open-mercato/shared/lib/crud/custom-fields`
- Validate `dealId` exists via `findOneWithDecryption` on `CustomerDeal` (resolved via `resolveEntityClass`)
- Build update input: `{ id: dealId, pipelineStageId: stageId, organizationId, tenantId }`
- If `customFields` provided, merge into input using `splitCustomFieldPayload` to produce `cf_*` prefixed keys
- If `notes` provided, additionally call `executeCommand(hCtx, 'customers.interactions.create', ...)` with the deal's linked contact
- Call `executeCommand(hCtx, 'customers.deals.update', input)`
- Return `{ createdEntityId: dealId, createdEntityType: 'customer_deal' }`
- `requiredFeature`: `'customers.deals.manage'`
- `promptSchema`: document payload shape for LLM
- `promptRules`: "For update_deal: when updating temperature or lead_score from a scoring email, pass values in customFields object. Use field keys: temperature (HOT/WARM/COOL/COLD), lead_score (0-100), lead_source (free text)."

**Delivers:** Users can accept `update_deal` actions to modify deal stage and custom fields

**Depends on:** Commits 1, 2

### Commit 8: Acceptance-time dedup check on `create_contact`

**Scope:** Modify the existing `executeCreateContactAction` to check for duplicate contacts by email at execution time. If a duplicate is found, convert to link semantics.

**Pattern:** Execution-time guard (modifies existing handler)

**Files:**
- `packages/core/src/modules/customers/inbox-actions.ts` -- modify `executeCreateContactAction`

**Implementation:**
- The existing handler already has a dedup check in `executeCreateContactAction`. It queries for existing contacts by `primaryEmail` before creating.
- Current behavior: if duplicate found, returns the existing entity ID as `createdEntityId` and `matchedEntityId`.
- This commit refines the dedup to also check company name for `type === 'company'` entities, and ensures the dedup check uses `findWithDecryption` with broader search (not just `primaryEmail` exact match but also case-insensitive comparison on decrypted emails).
- No behavioral change to the happy path (contact not found, creates normally).

**Note:** The existing handler already has basic dedup. This commit extends it to be more robust for the lead intake use case -- broader email matching, company name matching for company-type contacts.

**Delivers:** Reduced duplicate contacts when multiple proposals reference the same person

**Depends on:** --

### Commit 9: i18n labels, ActionCard updates, requiredFeature mappings

**Scope:** Add user-facing labels for new action types, categories, and discrepancy types.

**Pattern:** i18n key addition (follows existing `inbox_ops.action_type.*` pattern)

**Files:**
- `apps/mercato/src/i18n/en.json` -- add keys:
  - `inbox_ops.action_type.create_deal`: "Create Deal"
  - `inbox_ops.action_type.update_contact`: "Update Contact"
  - `inbox_ops.action_type.update_deal`: "Update Deal"
  - `inbox_ops.action.desc.create_deal`: "Create deal \"{title}\" for {personName}"
  - `inbox_ops.action.desc.update_contact`: "Update {entityType} {entityName}"
  - `inbox_ops.action.desc.update_deal`: "Update deal \"{dealTitle}\""
  - `inbox_ops.category.lead_intake`: "Lead Intake"
  - `inbox_ops.category.lead_enrichment`: "Lead Enrichment"
  - `inbox_ops.category.lead_followup`: "Lead Follow-up"
  - `inbox_ops.discrepancy.ambiguous_match`: "Multiple CRM records match"
  - `inbox_ops.discrepancy.low_confidence_match`: "Low confidence match"
  - `inbox_ops.discrepancy.duplicate_contact`: "Duplicate contact detected"
  - `inbox_ops.discrepancy.stale_contact`: "Stale contact (no recent activity)"
  - `inbox_ops.discrepancy.pending_intake_match`: "Pending intake proposal exists"
- `packages/create-app/template/src/i18n/en.json` -- mirror same keys

**Delivers:** All new action types, categories, and discrepancies display with proper labels in the UI

**Depends on:** Commit 1

## Integration Test Coverage

### TC-CRM-001: Create deal from proposal

**Scenario:** Forward an email that mentions a new contact and business opportunity. Accept the `create_deal` action.

**Setup:** Ensure tenant has a pipeline with at least one stage. Create a person contact via API.

**Steps:**
1. Create an inbox proposal with a `create_deal` action (payload: `{ title: "Test Deal", personId: <contactId>, source: "inbox_ops" }`)
2. Accept the action via `POST /api/inbox-ops/proposals/:id/actions/:actionId/accept`
3. Verify response: `success: true`, `createdEntityId` is a valid UUID
4. Verify deal exists in CRM via `GET /api/customers/deals/:dealId`
5. Verify deal is linked to the person contact

### TC-CRM-002: Update contact with enrichment data

**Scenario:** Accept an `update_contact` action that sets `relationshipType` on an existing person.

**Setup:** Create a person contact via API.

**Steps:**
1. Create an inbox proposal with an `update_contact` action (payload: `{ entityId: <personId>, entityType: "person", relationshipType: "Agency Partner" }`)
2. Accept the action
3. Verify response: `success: true`
4. Verify person's `relationshipType` updated via `GET /api/customers/people/:personId`

### TC-CRM-003: Update deal with custom fields (splitCustomFieldPayload)

**Scenario:** Accept an `update_deal` action that sets temperature and lead_score custom fields.

**Setup:** Create a person, create a deal linked to person. Ensure lead scoring custom fields are seeded.

**Steps:**
1. Create an inbox proposal with an `update_deal` action (payload: `{ dealId: <dealId>, customFields: { temperature: "HOT", lead_score: 85 } }`)
2. Accept the action
3. Verify response: `success: true`
4. Verify deal custom fields updated via `GET /api/customers/deals/:dealId`

### TC-CRM-004: Create contact dedup at acceptance time

**Scenario:** Two proposals reference the same email. Accept both `create_contact` actions.

**Setup:** None (contacts created during test).

**Steps:**
1. Create proposal A with `create_contact` (payload: `{ type: "person", name: "Jane Doe", email: "jane@test.com" }`)
2. Accept proposal A's `create_contact` action
3. Create proposal B with `create_contact` (payload: `{ type: "person", name: "Jane D.", email: "jane@test.com" }`)
4. Accept proposal B's `create_contact` action
5. Verify proposal B returns `matchedEntityId` (same as proposal A's `createdEntityId`)
6. Verify only one contact with `jane@test.com` exists in CRM

### TC-CRM-005: Create deal with pipeline stage

**Scenario:** Accept a `create_deal` action that specifies a pipeline and stage.

**Setup:** Create a pipeline with stages via API. Create a person contact.

**Steps:**
1. Create an inbox proposal with `create_deal` (payload includes `pipelineId`, `stageId`, `personId`)
2. Accept the action
3. Verify deal created with correct pipeline and stage assignment

### TC-CRM-006: Update deal stage transition

**Scenario:** Accept an `update_deal` action that changes the pipeline stage.

**Setup:** Create a deal at stage A. Pipeline has stages A -> B.

**Steps:**
1. Create an inbox proposal with `update_deal` (payload: `{ dealId, stageId: <stageBId> }`)
2. Accept the action
3. Verify deal stage updated to stage B

### TC-CRM-007: Missing feature permission blocks action

**Scenario:** User without `customers.deals.manage` attempts to accept `create_deal`.

**Steps:**
1. Create a user with only `inbox_ops.proposals.manage` (no deals permission)
2. Create an inbox proposal with `create_deal` action
3. Attempt to accept the action as the restricted user
4. Verify 403 response

### TC-CRM-008: New categories in proposal list filter

**Scenario:** Filter proposals by `lead_intake` category.

**Steps:**
1. Create a proposal with category `lead_intake`
2. Query `GET /api/inbox-ops/proposals?category=lead_intake`
3. Verify the proposal appears in results
4. Query with `category=rfq`
5. Verify the `lead_intake` proposal does not appear

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual Risk |
|------|----------|------------|---------------|
| `update_deal` handler sets invalid custom field values (e.g., temperature = "SUPER_HOT") | Medium | Custom field validation happens at the `setCustomFieldsIfAny` layer -- invalid values rejected with clear error. Handler wraps in try/catch and surfaces validation errors. | Low -- standard CRUD validation applies. Tenant can customize field options via admin UI. |
| Dedup check in `create_contact` produces false positive (different person, same email) | Medium | Dedup returns `matchedEntityId` with `matchedEntityType`, so user sees the linked entity and can reject if wrong. This is a "safe default" -- linking is less harmful than duplicating. | Low -- user can undo the link or manually correct. |
| `splitCustomFieldPayload` produces unexpected key format for command layer | Low | `parseWithCustomFields` in the command handler normalizes both `cf_*` and `customFields` formats. Test coverage in commit 7. | Very Low -- well-tested utility in shared package. |
| inbox_ops `ce.ts` declares fields on absent `customers:customer_deal` entity | Medium | Dependency guard in `setup.ts` uses `tryResolve`. Field declaration in `ce.ts` is metadata-only (no DB impact without seeding). Generator handles missing entity IDs gracefully. | Low -- tested pattern used by other cross-module extensions. |
| Coordinated enum commit introduces type mismatch if partially applied | High | Single atomic commit for all enum changes. CI type-check catches mismatches. | Very Low -- standard TypeScript compilation guards. |
| Existing `create_contact` handler regression from dedup changes | Medium | Commit 8 extends the existing dedup logic in `executeCreateContactAction`. Unit tests cover happy path, duplicate found, and no-email scenarios. Integration test TC-CRM-004 validates end-to-end. | Low -- existing tests + new tests provide good coverage. |
| New action types not recognized by extraction prompt | Low | `buildExtractionSystemPrompt` dynamically loads all registered actions. New handlers with `promptSchema` and `promptRules` are automatically included. No manual prompt editing needed. | Very Low -- auto-discovery via generated registry. |
| `update_contact` with `entityType: 'company'` checks `customers.people.manage` instead of `customers.companies.manage` | Medium | Handler performs runtime `userHasFeature` check for company type. `REQUIRED_FEATURES_MAP` uses `customers.people.manage` as default (covers the common case). | Low -- runtime check is explicit in handler code. |

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-04-14 | AI-assisted | Initial spec creation. Covers all 9 commits for CRM action handlers, enum extensions, custom fields, dedup, and i18n. |
| 2026-04-14 | Review | Added existing tenant migration note for custom field seeding (`mercato entities install`). |
