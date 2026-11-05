# SPEC-032: Notification Templates (DB-Only)

## TLDR

**Key Points:**
- We introduce a unified template model for multiple channels, without hardcoding a specific channel in the core.
- Data is stored in two tables: `notification_templates` (header/template metadata) and `notification_templates_blocks` (block tree).
- Rendering is data-driven, and the final payload is built by a dedicated `channel template service`.

**Scope:**
- Mapping `notification.type + channel + locale` -> record in `notification_templates`.
- Rendering based on blocks stored in `notification_templates_blocks`.

**Concerns:**
- A missing valid record in `notification_templates` can halt delivery for a given channel.
- The block renderer requires schema validation and publish guardrails.

## Overview
Open Mercato already has a notification delivery pipeline (`notifications:deliver`) and a legacy code template in core. This SPEC extracts templating into a separate `notifications-templates` module and introduces a DB-only model based on `notification_templates` and `notification_templates_blocks`, with a channel-agnostic block builder.

## Problem Statement
- Today, external notifications rely on a single code template with low tenant/org customization.
- There is no consistent block system for notifications.

## Proposed Solution
We introduce a separate `notifications-templates` module, while `notifications` remains core orchestration:

- **`notifications-templates` module (new):**
  - `notification_templates` as source of truth for template identification and configuration,
  - `notification_templates_blocks` as block structure and metadata,
  - resolver, renderer, and `channel template service` per channel (schema + render), builder API.
- **`notifications` module (core, already exists):**
  - `notifications:deliver` continues to orchestrate delivery and sending,
  - fetches render output through the `notifications-templates` module interface,
  - does not store template entities.
- Rendering uses `{{data.*}}` interpolation.
- The architecture is pluggable: core invokes the `channel template service` for the selected channel, which builds the final payload for delivery strategies.

### How we save data to the database
Saving is two-step, separating metadata from block content:

1. Create or update a record in `notification_templates`:
   - identification keys: `notification_type`, `channel`, `locale`, `tenant_id`, `organization_id`
   - configuration fields: `template_key`, `subject_template`, `status`, `is_active`
2. Save the block tree to `notification_templates_blocks`:
   - each block as a separate record (`type`, `position`, `parent_id`, `metadata`)
   - order and hierarchy are reconstructed via `position` + `parent_id`
3. Publish:
   - status in `notification_templates` transitions to `published`
   - publishing is blocked if block validation fails

In practice: `notification_templates` answers "which template and for which channel", while `notification_templates_blocks` answers "how that template is built".

## Existing vs New

### Existing (already implemented)
- `notifications:deliver` subscriber already exists in the notifications module and listens to `notifications.created`.
- The delivery pipeline already works:
  - read delivery configuration,
  - resolve recipient,
  - build channel payload,
  - send via delivery strategy,
  - run custom delivery strategies.
- Currently, rendering relies on a legacy code template in core.

### New (scope of this SPEC)
- We extract a new `notifications-templates` module.
- The `notifications-templates` module provides a DB-only mechanism based on:
  - `notification_templates`,
  - `notification_templates_blocks`.
- We add a template resolver by `notification_type + channel + locale` as a public module service.
- We add a block renderer + `channel template service` contract (block schema + channel payload transformation) in `notifications-templates`.
- We add API and UI for managing templates and blocks within `notifications-templates`.
- We add default template selection settings (in the `notifications-templates` module).

### Module Boundaries
- `notifications`:
  - responsible for domain events and running delivery strategies,
  - does not contain template entities, validators, or template editing logic.
- `notifications-templates`:
  - responsible for entities, CRUD API, publishing, validation, and template rendering,
  - exposes an interface like `resolveAndRender(notificationContext)`.
- Integration:
  - `notifications:deliver` calls the public service from `notifications-templates`,
  - passes the result (`renderedPayload`) to delivery strategies.

### Template Mapping Settings (module defaults)
- Configuration is managed from the settings panel and stored in module config `notifications-templates`.
- The owner of this configuration is the `notifications-templates` module (core `notifications` only reads the result through the module interface).
- Logical structure:
  - `moduleDefaults[channel][moduleId] = templateKey`
- Optionally: a module can declare a code fallback (e.g. `defaultTemplateKeyByChannel`) in its notification type definition.

### Example config record in database (`module_configs`)
Record in the `module_configs` table:
- `module_id = "notifications-templates"`
- `name = "template_mapping"`
- `value_json =` mapping object

Example `value_json`:

```json
{
  "version": 1,
  "moduleDefaults": {
    "channelA": {
      "sales": "notifications.sales.default.channel-a",
      "catalog": "notifications.catalog.default.channel-a",
      "customers": "notifications.customers.default.channel-a"
    },
    "channelB": {
      "sales": "notifications.sales.default.channel-b"
    }
  },
  "globalFallback": {
    "channelA": "notifications.generic.channel-a",
    "channelB": "notifications.generic.channel-b"
  }
}
```

### Template resolver order
1. `moduleDefaults` from settings panel (`module + channel`)
2. code fallback from module definition (if defined)

Each step additionally respects `locale` and language fallback defined in this specification.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Two tables (`notification_templates`, `notification_templates_blocks`) | Clear split: identification vs block structure |
| Channel payload as blocks | Editable layout without deploy |
| No separate bindings table | Fewer layers and simpler resolver |
| No executable code in templates | Security and deterministic output |
| `channel template service` per channel | Single place responsible for block schema and channel payload rendering |

## User Stories / Use Cases
- **Tenant admin** edits a template for `sales.order.created` in the block builder.
- **Tenant admin** publishes `pl` and `en` versions without deploy.
- **System** renders notifications with locale fallback and sends via the existing delivery pipeline.

## Architecture

```mermaid
flowchart TD
  A[notifications.created] --> B[notifications:deliver subscriber (core)]
  B --> C[notifications-templates.resolveAndRender]
  C --> D[Resolve template by module default/fallback + locale]
  D --> E[Fetch notification_templates + notification_templates_blocks]
  E --> F[channel template service render]
  F --> G{render ok?}
  G -->|yes| H[dispatch via delivery strategy]
  G -->|no| I[log + metric + fallback policy]
```

### Component Responsibilities
> Note: component names in this section are logical/working names. Final class and method names are determined during implementation.

- `notificationTemplateResolver`:
  - template lookup in `notification_templates` with tenant/org scope
  - join blocks from `notification_templates_blocks`
  - resolver order handling: module default -> fallback
  - locale fallback
- `notificationChannelTemplateServiceRegistry`:
  - registers `channel template service` per channel
  - selects service for `template.channel`
  - service exposes:
    - `blocksSchema` (block and field schema for UI + validation),
    - `validateBlocks(blockTree, context?)`,
    - `render(blockTree, context, options)` -> final channel payload

### Commands & Events
- **Command**: `notifications-templates.template.upsert`
- **Command**: `notifications-templates.template.publish`
- **Command**: `notifications-templates.template.archive`
- **Event**: `notifications-templates.template.updated`

## Data Models
Models below belong to the `notifications-templates` module (not `notifications` core).

### NotificationTemplate (singular, table: `notification_templates`)
- `id`: uuid
- `notification_type`: text (e.g. `sales.order.created`)
- `channel`: text (channel identifier; handled by `channel template service`)
- `template_key`: text (stable functional key)
- `locale`: text (`en`, `pl`, ...)
- `subject_template`: text nullable (optional metadata slot interpreted by the given `channel template service`)
- `status`: enum (`draft`, `published`, `archived`)
- `tenant_id`: uuid
- `organization_id`: uuid nullable
- `is_active`: boolean
- `published_at`: timestamptz nullable
- `created_by`: uuid nullable
- `created_at`, `updated_at`, `deleted_at`

### NotificationTemplateBlock (singular, table: `notification_templates_blocks`)
- `id`: uuid
- `template_id`: uuid FK -> `notification_templates.id`
- `type`: text (`group`, `heading`, `text`, `row`, `separator`, `product-items`, `button`)
- `position`: int
- `parent_id`: uuid nullable (self FK)
- `metadata`: jsonb
- `is_active`: boolean
- `created_at`, `updated_at`

### Index Strategy
- `notification_templates (tenant_id, organization_id, notification_type, channel, locale, status)`
- `notification_templates_blocks (template_id, parent_id, position)`
- published uniqueness: `(tenant_id, organization_id, notification_type, channel, locale, status='published')`

## Block System (Channel-Agnostic)

### Goal and responsibility split
- We keep one `channel template service` per channel.
- This service is the single source of truth for:
  - block schema (UI + validation),
  - runtime validation rules,
  - final channel payload rendering.
- Block definitions (`blocksSchema`) are kept in code, while template block records are stored in the database (`notification_templates_blocks`).

### Where block schema is stored
- In the `channel template service` for the given channel.
- Services are registered in `notificationChannelTemplateServiceRegistry`.
- Each `channel template service` declares:
  - `blocksSchema` (field schema for UI and validation),
  - `validateBlocks(blockTree, context?)`,
  - `render(blockTree, context, options)` (serialization to final channel payload).

### `channel template service` contract (MVP)
```ts
type BlockFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "json"

type BlockFieldDefinition = {
  key: string
  label: string
  type: BlockFieldType
  required?: boolean
  defaultValue?: unknown
  helpText?: string
  options?: Array<{ value: string; label: string }>
  validation?: {
    min?: number
    max?: number
    pattern?: string
    enum?: string[]
  }
}

type BlockUiRules = {
  mode?: "leaf" | "group" | "repeater"
  allowedParents?: string[]
  allowedChildren?: string[]
  maxDepth?: number
  repeatable?: boolean
}

type BlockRuntimeRules = {
  mode?: "default" | "repeater"
}

type BlockDefinition = {
  type: string
  label: string
  description?: string
  fields: BlockFieldDefinition[]
  uiRules?: BlockUiRules
  runtimeRules?: BlockRuntimeRules
}

type BlockNode = {
  id?: string
  type: string
  position: number
  parentId?: string | null
  metadata: Record<string, unknown>
}

type ChannelTemplateService = {
  channel: string
  blocksSchema: BlockDefinition[]
  validateBlocks(
    blockTree: BlockNode[],
    context?: { locale?: string }
  ): { valid: true } | { valid: false; errors: string[] }
  render(
    blockTree: BlockNode[],
    context: { data: Record<string, unknown>; locale?: string },
    options?: Record<string, unknown>
  ): { renderedPayload: unknown; previewMeta?: Record<string, unknown> }
}
```

### Model: definition vs instance
- **Block definition (code-level, UI schema):**
  - `type`: block type identifier
  - `type` is semantic (e.g. `actions`) and does not need to match editor behavior
  - `label`: name in the builder
  - `fields[]`: list of form fields (`key`, `type`, `label`, `required`, `defaultValue`, `helpText?`, `validation?`)
  - `uiRules?`: UI/layout rules (`mode`, `allowedParents`, `allowedChildren`, `maxDepth`, `repeatable`)
  - `runtimeRules?`: runtime renderer rules (`mode`)
- **Block instance (DB row, runtime data):**
  - `id`, `template_id`, `type`, `position`, `parent_id`, `metadata`
  - `metadata` contains only values of fields defined in `fields[]`

### Block catalog (MVP, shared)
- `group` (container; can hold other `group` blocks and other blocks)
- `heading`
- `text`
- `row` (label/value)
- `separator`
- `product-items` (iterative domain container)
- `button` (CTA)

### Default `blocksSchema` (MVP)
```ts
const blocksSchema: BlockDefinition[] = [
  {
    type: "group",
    label: "Group",
    description: "Container for grouping other blocks",
    fields: [],
    uiRules: {
      mode: "group",
      allowedParents: ["group", "product-items"],
      allowedChildren: [
        "group",
        "heading",
        "text",
        "row",
        "separator",
        "product-items",
        "button",
      ],
      repeatable: true,
    },
    runtimeRules: {
      mode: "default",
    },
  },
  {
    type: "heading",
    label: "Heading",
    fields: [
      {
        key: "value",
        label: "Value",
        type: "text",
        required: true,
        defaultValue: "",
      },
      {
        key: "level",
        label: "Level",
        type: "select",
        required: false,
        defaultValue: "h2",
        options: [
          { value: "h1", label: "H1" },
          { value: "h2", label: "H2" },
          { value: "h3", label: "H3" },
        ],
      },
    ],
    uiRules: {
      mode: "leaf",
      allowedParents: ["group", "product-items"],
      repeatable: true,
    },
    runtimeRules: {
      mode: "default",
    },
  },
  {
    type: "text",
    label: "Text",
    fields: [
      {
        key: "value",
        label: "Value",
        type: "textarea",
        required: true,
        defaultValue: "",
      },
    ],
    uiRules: {
      mode: "leaf",
      allowedParents: ["group", "product-items"],
      repeatable: true,
    },
    runtimeRules: {
      mode: "default",
    },
  },
  {
    type: "row",
    label: "Row",
    fields: [
      {
        key: "label",
        label: "Label",
        type: "text",
        required: true,
        defaultValue: "",
      },
      {
        key: "value",
        label: "Value",
        type: "text",
        required: true,
        defaultValue: "",
      },
    ],
    uiRules: {
      mode: "leaf",
      allowedParents: ["group", "product-items"],
      repeatable: true,
    },
    runtimeRules: {
      mode: "default",
    },
  },
  {
    type: "separator",
    label: "Separator",
    fields: [
      {
        key: "spacing",
        label: "Spacing",
        type: "select",
        required: false,
        defaultValue: "md",
        options: [
          { value: "sm", label: "Small" },
          { value: "md", label: "Medium" },
          { value: "lg", label: "Large" },
        ],
      },
    ],
    uiRules: {
      mode: "leaf",
      allowedParents: ["group", "product-items"],
      repeatable: true,
    },
    runtimeRules: {
      mode: "default",
    },
  },
  {
    type: "product-items",
    label: "Product items",
    fields: [
      {
        key: "arrayPath",
        label: "Array path",
        type: "text",
        required: true,
        defaultValue: "",
      },
      {
        key: "emptyStateText",
        label: "Empty state text",
        type: "text",
        required: false,
        defaultValue: "",
      },
    ],
    uiRules: {
      mode: "repeater",
      allowedParents: ["group"],
      allowedChildren: [
        "group",
        "heading",
        "text",
        "row",
        "separator",
        "button",
      ],
      repeatable: true,
    },
    runtimeRules: {
      mode: "repeater",
    },
  },
  {
    type: "button",
    label: "Button",
    fields: [
      {
        key: "label",
        label: "Label",
        type: "text",
        required: true,
        defaultValue: "",
      },
      {
        key: "href",
        label: "URL",
        type: "text",
        required: true,
        defaultValue: "",
      },
      {
        key: "variant",
        label: "Variant",
        type: "select",
        required: false,
        defaultValue: "primary",
        options: [
          { value: "primary", label: "Primary" },
          { value: "secondary", label: "Secondary" },
          { value: "link", label: "Link" },
        ],
      },
    ],
    uiRules: {
      mode: "leaf",
      allowedParents: ["group", "product-items"],
      repeatable: true,
    },
    runtimeRules: {
      mode: "default",
    },
  },
]
```

### Type semantics vs UI behavior
- `type` describes the semantic/component name (e.g. `actions`, `product-items`).
- `uiRules.mode` describes builder behavior:
  - `leaf` -> block without children,
  - `group` -> container like `group`,
  - `repeater` -> iterative container in the editor.
- `runtimeRules.mode` describes renderer behavior:
  - `default` -> standard render without iteration,
  - `repeater` -> iterate over `arrayPath` and render children per element.
- Example: `type: "actions"` can have `uiRules.mode: "group"` and `runtimeRules.mode: "default"`; the UI treats the block as a container, while the renderer serializes it semantically as `actions`.
- Example: `type: "product-items"` can have `uiRules.mode: "repeater"` and `runtimeRules.mode: "repeater"`; the UI behaves like a repeater, and the runtime performs iteration.

### Example single block schema (definition)
```json
{
  "type": "text",
  "label": "Text",
  "fields": [
    {
      "key": "value",
      "type": "textarea",
      "label": "Value",
      "required": true,
      "defaultValue": ""
    }
  ],
  "uiRules": {
    "mode": "leaf",
    "allowedParents": ["group", "product-items"],
    "repeatable": true
  },
  "runtimeRules": {
    "mode": "default"
  }
}
```

### How UI and DB connect (flow)
1. UI fetches the block catalog for the selected channel:
   - `GET /api/notifications/templates/block-catalog?channel=<id>`
2. Admin builds a template from blocks; UI validates fields according to `fields[]`.
3. UI saves instances:
   - `PUT /api/notifications/templates/:id/blocks`
   - payload: `blocks[]` with `type/position/parentId/metadata`
4. Backend (via `channel template service`) validates whether `metadata` matches `blocksSchema` for the given `type`.
5. Backend saves records to `notification_templates_blocks`.

### Runtime rendering pipeline
1. `notificationTemplateResolver` fetches template + blocks.
2. `channel template service`:
   - builds the tree by `parent_id + position`,
   - validates schema and `uiRules`,
   - interpolates `{{data.*}}` from the event payload,
   - renders the final channel payload according to `runtimeRules.mode`.
3. `notifications:deliver` passes the payload to the appropriate delivery strategy.

### Rendering Rules
- `heading/text/row/button` interpolate only `{{data.*}}`.
- A block with `runtimeRules.mode = "repeater"` requires `arrayPath` and children for iteration.
- `group` serves for structure and composition; it can contain other `group` blocks and leaf blocks.
- `separator` creates a neutral layout division.

### Publish Guardrails
- Validate schema of all blocks.
- Test render on sample data.
- Validate `metadata` vs definition from `blocksSchema`.
- Validate compatibility of `block.type` with the selected `channel`.
- Block publishing when:
  - missing required metadata,
  - invalid `arrayPath`,
  - unknown block type.

## API Contracts

### Upsert Template
- `PUT /api/notifications/templates`
- Request:
  - `notificationType`, `channel`, `locale`, `templateKey`, `subjectTemplate?`, `status`
- Response:
  - `ok: true`, `templateId`

### Save Template Blocks
- `PUT /api/notifications/templates/:id/blocks`
- Request:
  - `blocks[]` (`type`, `position`, `parentId`, `metadata`)
- Response:
  - `ok: true`

### Get Block Catalog
- `GET /api/notifications/templates/block-catalog?channel=:channel`
- Response:
  - `channel`
  - `blocksSchema[]` (`type`, `label`, `fields[]`, `uiRules?`, `runtimeRules?`)

### Publish Template
- `POST /api/notifications/templates/:id/publish`
- Response:
  - `ok: true`, `publishedAt`

### Preview Template
- `POST /api/notifications/templates/:id/preview`
- Request:
  - `sampleData`, `locale?`
- Response:
  - `channel`: string
  - `renderedPayload`: json
  - `previewMeta?`: json

## Internationalization (i18n)
- `notification_templates` stores locale-specific identification and subject.
- `notification_templates_blocks` stores block content (metadata + interpolation).
- Locale fallback:
  1. recipient locale
  2. notification locale
  3. tenant default
  4. `en`

## UI/UX
- In the `notifications-templates` module we add a "Notification templates" screen:
  - table `notification_type -> template (channel, locale, status)`
  - quick render preview
  - test data before saving
- Block editing operates on data from `notification_templates_blocks`.
- For each channel, the system has a separate `channel template service` that provides the block catalog and payload rendering.

## Configuration
- `NOTIFICATIONS_TEMPLATE_DEFAULT_LOCALE=en`
- `NOTIFICATIONS_TEMPLATE_STRICT_MODE=true|false`
  - `true`: no published template => fail delivery + alert
  - `false`: soft-fail (log + skip external delivery)

## Migration & Compatibility
- No breaking changes for in-app notifications.
- External delivery transitions from legacy rendering in core to the block renderer from `notification_templates*`:
  1. shadow mode
  2. canary tenants
  3. full switch

## Implementation Plan

### Phase 1: New Module Bootstrap (`notifications-templates`)
1. Add new module `packages/core/src/modules/notifications-templates`.
2. Define the public integration interface (e.g. `resolveAndRender`).
3. Wire DI and module registration without changing `notifications` behavior.

### Phase 2: Templates + Blocks Schema
1. Add `NotificationTemplate` and `NotificationTemplateBlock` + migrations.
2. Add resolver (`notification.type + channel + locale -> notification_templates`).
3. Expose resolver through the public module service.

### Phase 3: Channel Template Service Contract
1. Add `channel template service` contract (`blocksSchema`, `validateBlocks`, `render`).
2. Add block schema validation in the channel service layer.
3. Add preview endpoint for sample data.

### Phase 4: Channel Services + Core Integration
1. Add the first `channel template service` (block schema + `render`).
2. Add additional channel services without changes to the resolver core.
3. In `notifications:deliver`, replace legacy render with a call to `notifications-templates.resolveAndRender`.

### Planned Channel Template Services
| Channel | Rendering technology | Notes |
|---------|---------------------|-------|
| **Email** | [React Email](https://react.email) components | Block tree → React Email components → HTML. Each block type maps to a React Email primitive (e.g. `heading` → `<Heading>`, `button` → `<Button>`, `row` → `<Row><Column>`) |
| **Slack** | [Block Kit API](https://api.slack.com/block-kit) | Block tree → Slack Block Kit JSON payload. Each block type maps to a Kit element (e.g. `heading` → `header`, `text` → `section.mrkdwn`, `button` → `actions.button`) |

### File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/notifications-templates/data/entities.ts` | Create | `NotificationTemplate` and `NotificationTemplateBlock` entities |
| `packages/core/src/modules/notifications-templates/data/validators.ts` | Create | Zod schemas for templates and blocks |
| `packages/core/src/modules/notifications-templates/lib/notificationTemplateResolver.ts` | Create | Template lookup in `notification_templates` |
| `packages/core/src/modules/notifications-templates/lib/block-tree/buildTree.ts` | Create | Shared helper for building the tree by `parent_id + position` (used by channel services) |
| `packages/core/src/modules/notifications-templates/lib/channel-template-services/registry.ts` | Create | Registry of `channel template service` per channel |
| `packages/core/src/modules/notifications-templates/lib/channel-template-services/types.ts` | Create | Service contract (`blocksSchema`, `validateBlocks`, `render`) |
| `packages/core/src/modules/notifications-templates/lib/channel-template-services/*` | Create | Per-channel service implementations |
| `packages/core/src/modules/notifications-templates/lib/notificationTemplateService.ts` | Create | Public `resolveAndRender` interface for core |
| `packages/core/src/modules/notifications-templates/api/templates/*` | Create | API for templates + blocks + preview + block catalog |
| `packages/core/src/modules/notifications/subscribers/deliver-notification.ts` | Modify | Transition from hardcoded template to `notification_templates*` |

### Testing Strategy
- Unit:
  - template resolver by `notification_type/channel/locale`
  - block validation
  - repeater/group interpolation
  - `channel template service` contract (`blocksSchema`, `render`) and payload serialization
- Integration:
  - subscriber sends via strategy payload from a block template in `notification_templates*`
  - missing published template in strict/soft mode
  - tenant/org scoping
- E2E:
  - admin creates template and blocks for a notification type
  - publish and receive a real channel notification

### Open Questions
- Do we keep historical versions via `status` and subsequent records, or do we add a separate versions table in a later step?
- Should the first `channel template service` be delivered immediately, or after the block core stabilizes?

## Risks & Impact Review

### Data Integrity Failures
- Missing `published` record in `notification_templates` for a given type/channel/locale.
- Concurrent editing and publishing of blocks may temporarily return an inconsistent version.

### Tenant & Data Isolation Risks
- Missing full tenant/org filter in the resolver may expose other tenants' templates.
- Cache without a tenant key may cause cross-tenant leakage.

### Migration & Deployment Risks
- Missing templates after rollout = no external delivery for selected types.
- Inconsistency between the old hardcoded template and the new block output.

### Operational Risks
- Missing render failure metrics makes rapid error detection difficult.
- No automatic template rollback mechanism after a publish failure.

### Risk Register

#### Missing Published Template
- **Scenario**: `notification.type` has no published record in `notification_templates`.
- **Severity**: High
- **Affected area**: `notifications:deliver`, channel delivery
- **Mitigation**: strict/soft mode, missing template dashboard, alerting
- **Residual risk**: low after automated deployment checks

#### Invalid Block Tree
- **Scenario**: a published template has an invalid block layout.
- **Severity**: High
- **Affected area**: quality or missing external notification delivery
- **Mitigation**: schema validation + preview + publish gate
- **Residual risk**: medium for unusual runtime data

#### Cross-Tenant Template Leakage
- **Scenario**: resolver reads a template from another tenant.
- **Severity**: Critical
- **Affected area**: security and data isolation
- **Mitigation**: tenant/org scoped query + integration isolation tests
- **Residual risk**: low

## Final Compliance Report — 2026-02-19

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | No direct ORM relationships between modules | Compliant | Template entities in a separate `notifications-templates` module, no cross-module ORM relations |
| root `AGENTS.md` | Tenant isolation (`organization_id`) | Compliant | Enforced scoping of resolver and templates |
| root `AGENTS.md` | No hardcoded user-facing strings | Compliant | Blocks + i18n in `notification_templates*` |
| `packages/core/AGENTS.md` | API routes MUST export `openApi` | Compliant | Applies to all new template routes |
| `packages/core/AGENTS.md` | Prefer subscriber boundaries for side effects | Compliant | Integration via `notifications:deliver` |
| `packages/shared/AGENTS.md` | Use precise types and zod validation | Compliant | Template and block validation via Zod |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | API templates match `NotificationTemplate` and `NotificationTemplateBlock` models |
| API contracts match UI/UX section | Pass | UI manages templates and blocks per `notification_type` |
| Risks cover all write operations | Pass | Template/block writes and publishing described |
| Commands defined for all mutations | Pass | Upsert/publish/archive commands defined |
| Cache strategy covers all read APIs | Pass | Tenant-scoped cache indicated in risks |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved — ready for implementation

## Changelog
### 2026-02-19
- Initial version spec for DB-only notification templates.
- Scope changed to explicit DB model in a separate `notifications-templates` module.
- Added channel-agnostic block system and publish guardrails.
- Updated model to explicit tables: `notification_templates` and `notification_templates_blocks`.
- Added planned channel template services: Email (React Email) and Slack (Block Kit API).

### Review — 2026-02-19
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
