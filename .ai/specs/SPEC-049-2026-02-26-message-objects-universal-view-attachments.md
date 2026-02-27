# SPEC-049 — Universal Message Object Attachments

| Field | Value |
|---|---|
| **ID** | SPEC-049 |
| **Date** | 2026-02-26 |
| **Status** | In Progress |
| **Author** | Claude Code |
| **Module(s)** | sales, catalog, customers, resources, staff, currencies, packages/ui |

---

## TLDR

Introduce **generic message object attachments** for a broad set of entity types across multiple modules. An attachment displays a rich preview of an entity (name, icon, status, optional metadata), links the reader to the entity's detail page, and is designed to support additional actions as modules evolve.

The work splits into three tracks:
1. **Generic UI components** in `@open-mercato/ui` — a reusable Preview + Detail pair that any module can use, eliminating the need to write custom widget code per module. The Detail component renders a `view` link and any additional module-defined actions using the same pattern as existing module-specific widgets.
2. **Message-object type definitions** — new or extended `message-objects.ts` files for every requested module/entity, using the generic components directly.
3. **SendObjectMessageDialog integration** — add the compose trigger to the relevant backend detail/list pages so users can actually attach these entities when composing a message.

---

## Problem Statement

The message-objects registry already supports `customers`, `sales`, and `staff` modules. Every other business entity (sales channel, product category, resource, currency, team role) has no message attachment story.

Additionally, modules that do have definitions (customers people/companies, staff teams/team-members) are missing the `SendObjectMessageDialog` trigger on their actual UI pages, so users cannot initiate the attach flow from those pages.

Two duplication problems compound this:
- Each module writes its own `Preview` + `Detail` component even though the rendering logic is nearly identical across modules.
- The lucide icon name is already stored in `MessageObjectTypeDefinition.icon` but no generic renderer uses it.

---

## Proposed Solution

### 1. Generic UI Components — `MessageObjectPreview` & `MessageObjectDetail`

Create two reusable components in `packages/ui/src/backend/messages/`:

**`MessageObjectPreview.tsx`**
- Accepts `ObjectPreviewProps` (standard interface)
- Resolves the icon name from props via `icon` field (falls back to a generic `box` icon if unresolved)
- Renders: `[Icon] Title · Subtitle [Status badge] [Action-required badge]`
- Renders `ObjectPreviewData.metadata` as key/value rows when present
- Identical visual structure to the existing customer/sales previews — consistent UX across modules

**`MessageObjectDetail.tsx`**
- Accepts `ObjectDetailProps`
- Wraps `MessageObjectPreview`
- Locates the `view` action and wraps the preview in a `<Link>` (resolves `{entityId}` placeholder)
- Renders any additional actions (beyond `view`) as buttons with loading state — same pattern as `CustomerMessageObjectDetail`
- Fully extensible: modules declare extra actions in their `message-objects.ts` definition; no component changes required

**Component registration approach**

Current implementation registers `MessageObjectPreview` and `MessageObjectDetail` directly in module `message-objects.ts` definitions. Wrapper components are optional and only needed when a module requires custom rendering.

### 2. Message-Object Type Definitions per Module

| Module | Entity Type | Status | entityId | View Href |
|--------|-------------|--------|----------|-----------|
| `sales` | `channel` | **New entry** (extend existing `message-objects.ts`) | `sales:sales_channel` | `/backend/sales/channels/{entityId}` |
| `catalog` | `category` | **New file** | `catalog:catalog_product_category` | `/backend/catalog/categories/{entityId}` |
| `customers` | `person` | Already defined — UI page integration only | `customers:customer_person_profile` | `/backend/customers/people/{entityId}` |
| `customers` | `company` | Already defined — UI page integration only | `customers:customer_company_profile` | `/backend/customers/companies/{entityId}` |
| `resources` | `resource` | **New file** | `resources:resources_resource` | `/backend/resources/{entityId}` |
| `staff` | `team` | Already defined — UI page integration only | `staff:staff_team` | `/backend/staff/teams/{entityId}` |
| `staff` | `team_member` | Already defined — UI page integration only | `staff:staff_team_member` | `/backend/staff/team-members/{entityId}` |
| `staff` | `team_role` | **New entry** (extend existing `message-objects.ts`) | `staff:staff_team_role` | `/backend/staff/team-roles/{entityId}` |
| `staff` | `my_availability` | **New entry** — links to member's own availability page | `planner:planner_availability_rule_set` | `/backend/staff/my-availability` |
| `currencies` | `currency` | **New file** | `currencies:currency` | `/backend/currencies/{entityId}` |

All new definitions use `MessageObjectPreview` and `MessageObjectDetail` from `@open-mercato/ui`.

### 3. SendObjectMessageDialog Integration

Add `<SendObjectMessageDialog>` to the detail (and where appropriate, list/table row-actions) pages for every entity above. Each integration passes:
- `object.entityModule` — the module name
- `object.entityType` — the entity type string
- `object.entityId` — the record ID
- `object.previewData` — lightweight preview populated from the page's already-loaded data
- `viewHref` — direct link to the entity detail page
- `lockedType="messages.defaultWithObjects"` — default; can be overridden per context

---

## Architecture Notes

### Icon Resolution in Generic Components

`MessageObjectTypeDefinition.icon` holds a lucide icon name string (e.g., `"user-round"`, `"building2"`). The generic components resolve this to a React component using a dynamic lookup:

```typescript
// packages/ui/src/backend/messages/MessageObjectPreview.tsx
import { icons } from 'lucide-react'

function resolveIcon(name: string): LucideIcon {
  const key = name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('') as keyof typeof icons
  return icons[key] ?? Box
}
```

This avoids maintaining an explicit allowlist while staying tree-shakeable at the module level.

### Action Extensibility in MessageObjectDetail

`MessageObjectDetail` follows the exact same action rendering contract as `CustomerMessageObjectDetail`:
- `view` action → preview wrapped in `<Link href={resolvedHref}>`
- Any other action with `href` → rendered as `<Button asChild><Link>`
- Any other action with `commandId` or `onAction` callback → rendered as `<Button onClick>` with loading state

Modules add future actions (e.g., assign, archive, approve) by appending entries to their `actions` array in `message-objects.ts`. No component changes are needed.

### loadPreview Pattern

Each new module creates `lib/messageObjectPreviews.ts` following the established pattern:
- Uses `findOneWithDecryption` (GDPR compliance)
- Guards with `typeof window !== 'undefined'` — browser returns a lightweight fallback, server loads real data
- Maps entity status to a standard status color (`'green' | 'red' | 'amber' | 'gray' | 'blue'`)
- Returns `{ title, subtitle, status, statusColor, metadata? }` conforming to `ObjectPreviewData`

### Metadata Labels and i18n

Metadata labels MUST be translated with `t()`/`resolveTranslations().t` in both compose-time previews (`SendObjectMessageDialog`) and server-side `loadPreview` results. Raw English keys are not used in UI payloads.

### No Widget Injection Table Changes

Message object components are **not** registered via the widget injection system. They are imported directly in `message-objects.ts` and stored in the in-memory registry at bootstrap. No `injection-table.ts` changes are needed.

### Backward Compatibility

- Adding new entries to existing `message-objects.ts` files is additive — no breaking changes.
- The generic components are new exports from `@open-mercato/ui` — additive.
- `SendObjectMessageDialog` is already exported from `@open-mercato/ui` — no API changes.
- Run `npm run modules:prepare` after creating/modifying `message-objects.ts` files.

---

## Entity Field Mapping

### sales → channel
| Field | Usage |
|---|---|
| `name` | `optionLabelField`, preview title |
| `status` (entry ID) | `optionSubtitleField`, preview status |
| Icon | `store` |

### catalog → category
| Field | Usage |
|---|---|
| `name` | `optionLabelField`, preview title |
| `description` | `optionSubtitleField`, preview subtitle |
| Icon | `tag` |

### resources → resource
| Field | Usage |
|---|---|
| `name` | `optionLabelField`, preview title |
| `description` | optional preview subtitle (module-specific) |
| metadata | intentionally omitted (title-only preview) |
| Icon | `package` |

### staff → team_role
| Field | Usage |
|---|---|
| `name` | `optionLabelField`, preview title |
| `description` | `optionSubtitleField`, preview subtitle |
| Icon | `shield` |

### staff → my_availability
| Field | Usage |
|---|---|
| `name` | `optionLabelField`, preview title (rule set name) |
| `description` | `optionSubtitleField`, preview subtitle |
| Icon | `calendar-clock` |
| href | `/backend/staff/my-availability` (not `{entityId}` — links to the member's own page) |

### currencies → currency
| Field | Usage |
|---|---|
| `name` | `optionLabelField`, preview title |
| `code` | `optionSubtitleField`, preview subtitle |
| `code`, `name`, `symbol`, `decimalPlaces` | included in preview metadata (translated labels) |
| Icon | `coins` |

### Metadata rollout (implemented)
| Module | Entity | Metadata fields |
|---|---|---|
| `currencies` | `currency` | code, name, symbol, decimal places |
| `customers` | `person` | phone number, job title |
| `customers` | `deal` | value amount, probability |
| `customers` | `company` | phone number, industry |
| `sales` | `quote` | amount |
| `sales` | `channel` | contact email, website URL |
| `resources` | `resource` | none (title-only by decision) |
| `example` | `todo` | done status |
| `staff` | `team_member` | team, user email, roles |
| `catalog` | `product` | excluded from metadata scope |

---

## Phasing

### Phase 1 — Generic UI Components (Foundation)

**Steps:**
1. Create `packages/ui/src/backend/messages/MessageObjectPreview.tsx` implementing `ObjectPreviewProps`. Uses lucide `icons` map to resolve icon name string from the `icon` prop. Renders icon + title + subtitle + status badge + action-required badge.
2. Create `packages/ui/src/backend/messages/MessageObjectDetail.tsx` implementing `ObjectDetailProps`. Wraps `MessageObjectPreview`. Locates the `view` action and renders preview inside a `<Link>`. Renders all remaining actions as buttons with loading state.
3. Export both components from `packages/ui/src/backend/messages/index.ts`.
4. For each module/entity in scope, create thin wrapper components in `packages/core/src/modules/<module>/widgets/messages/<Entity>MessageObjectPreview.tsx` and `<Entity>MessageObjectDetail.tsx`. Each wrapper passes the correct `icon` string and registers itself in `message-objects.ts` as `PreviewComponent` / `DetailComponent`.
5. Write unit tests for icon resolution edge cases (unknown icon → fallback, kebab-case → PascalCase conversion).

**Acceptance:** Both generic components render correctly with a mock `ObjectPreviewProps`. `MessageObjectDetail` renders a view link and additional action buttons when provided. Each module wrapper forwards props correctly to the generic components.

---

### Phase 2 — Message Object Definitions (New Modules)

**Steps:**
1. **catalog** — Create `packages/core/src/modules/catalog/message-objects.ts` with entity type `category`. Create `packages/core/src/modules/catalog/lib/messageObjectPreviews.ts` with `loadCatalogCategoryPreview` using `findOneWithDecryption` on `CatalogProductCategory`. Add i18n keys: `catalog.messageObjects.category.title`.
2. **resources** — Create `packages/core/src/modules/resources/message-objects.ts` with entity type `resource`. Create `packages/core/src/modules/resources/lib/messageObjectPreviews.ts` with `loadResourcePreview`. Add i18n keys: `resources.messageObjects.resource.title`.
3. **currencies** — Create `packages/core/src/modules/currencies/message-objects.ts` with entity type `currency`. Create `packages/core/src/modules/currencies/lib/messageObjectPreviews.ts` with `loadCurrencyPreview`. Add i18n keys: `currencies.messageObjects.currency.title`.

**Acceptance:** `GET /api/messages/object-types?messageType=default` returns entries for `catalog/category`, `resources/resource`, `currencies/currency`.

---

### Phase 3 — Message Object Definitions (Existing Module Extensions)

**Steps:**
1. **sales** — Append `channel` entry to `packages/core/src/modules/sales/message-objects.ts`. Add `loadSalesChannelPreview` to the existing `lib/messageObjectPreviews.ts` (or create it). Add i18n key: `sales.messageObjects.channel.title`.
2. **staff** — Append `team_role` entry to `packages/core/src/modules/staff/message-objects.ts`. Add `loadStaffTeamRolePreview` to the existing `lib/messageObjectPreviews.ts`. Add i18n key: `staff.messageObjects.teamRole.title`.
3. **staff** — Append `my_availability` entry to `packages/core/src/modules/staff/message-objects.ts`. Add `loadStaffAvailabilityPreview` loading from `PlannerAvailabilityRuleSet`. Note the view href links to `/backend/staff/my-availability` without an entity placeholder (since it's always "my" page). Add i18n key: `staff.messageObjects.myAvailability.title`.
4. Run `npm run modules:prepare` to regenerate the message-objects registry.

**Acceptance:** Object-types API returns updated entries for sales channel, staff team_role, and staff my_availability.

---

### Phase 4 — SendObjectMessageDialog on UI Pages

**Steps:**
1. **customers/people detail page** — Add `<SendObjectMessageDialog>` with `object.entityType="person"` and `object.entityModule="customers"`. Pass `previewData={{ title: person.displayName, subtitle: person.primaryEmail }}`.
2. **customers/companies detail page** — Add `<SendObjectMessageDialog>` with `object.entityType="company"` and `object.entityModule="customers"`.
3. **sales/channels detail page** — Add `<SendObjectMessageDialog>` with `object.entityType="channel"` and `object.entityModule="sales"`.
4. **catalog/categories detail page** — Add `<SendObjectMessageDialog>` with `object.entityType="category"` and `object.entityModule="catalog"`.
5. **resources detail page** — Add `<SendObjectMessageDialog>` with `object.entityType="resource"` and `object.entityModule="resources"`.
6. **staff/teams detail page** — Add `<SendObjectMessageDialog>`.
7. **staff/team-members detail page** — Add `<SendObjectMessageDialog>`.
8. **staff/team-roles detail page** — Add `<SendObjectMessageDialog>`.
9. **staff/my-availability page** — Add `<SendObjectMessageDialog>` with `object.entityType="my_availability"` and `object.entityModule="staff"`. Since this is the member's own page, `entityId` should be the member's `availabilityRuleSetId`.
10. **currencies detail page** — Add `<SendObjectMessageDialog>` with `object.entityType="currency"` and `object.entityModule="currencies"`.

**Acceptance:** User can open the message composer from each entity's detail page with the entity pre-attached as a message object.

---

### Phase 5 — Integration Tests

**Steps:**
1. Write integration test: navigate to a customers person detail page, click the compose button, verify the message composer opens with the person entity pre-populated.
2. Write integration test: compose a message with a catalog category attached, send it, verify the message appears in the thread with the correct preview.
3. Write integration test: compose a message with a currency attached, send it, verify preview renders icon + name + code.

**API paths to cover:**
- `GET /api/messages/object-types?messageType=default` → includes all 10 new/extended entity types
- `POST /api/messages` with `objects` containing a `catalog:category` reference → 200
- `GET /api/messages/{id}` → response includes object preview data for attached entities

**UI paths to cover:**
- `/backend/customers/people/{id}` → SendObjectMessageDialog trigger is present
- `/backend/catalog/categories/{id}` → SendObjectMessageDialog trigger is present

---

## Implementation Checklist

### Generic UI Components (`packages/ui/src/backend/messages/`)
- [ ] `MessageObjectPreview.tsx` — lucide dynamic icon, preview layout
- [ ] `MessageObjectDetail.tsx` — wraps preview, view link + extensible action buttons
- [ ] Exported from `packages/ui/src/backend/messages/index.ts`

### catalog module
- [ ] `widgets/messages/CatalogCategoryMessageObjectPreview.tsx` — wrapper, passes `icon="tag"`
- [ ] `widgets/messages/CatalogCategoryMessageObjectDetail.tsx` — wrapper, passes `icon="tag"`
- [ ] `message-objects.ts` with `category` type referencing wrapper components
- [ ] `lib/messageObjectPreviews.ts` — `loadCatalogCategoryPreview`
- [ ] i18n key: `catalog.messageObjects.category.title`

### resources module
- [ ] `widgets/messages/ResourceMessageObjectPreview.tsx` — wrapper, passes `icon="package"`
- [ ] `widgets/messages/ResourceMessageObjectDetail.tsx` — wrapper, passes `icon="package"`
- [ ] `message-objects.ts` with `resource` type referencing wrapper components
- [ ] `lib/messageObjectPreviews.ts` — `loadResourcePreview`
- [ ] i18n key: `resources.messageObjects.resource.title`

### currencies module
- [ ] `widgets/messages/CurrencyMessageObjectPreview.tsx` — wrapper, passes `icon="coins"`
- [ ] `widgets/messages/CurrencyMessageObjectDetail.tsx` — wrapper, passes `icon="coins"`
- [ ] `message-objects.ts` with `currency` type referencing wrapper components
- [ ] `lib/messageObjectPreviews.ts` — `loadCurrencyPreview`
- [ ] i18n key: `currencies.messageObjects.currency.title`

### sales module extension
- [ ] `widgets/messages/SalesChannelMessageObjectPreview.tsx` — wrapper, passes `icon="store"`
- [ ] `widgets/messages/SalesChannelMessageObjectDetail.tsx` — wrapper, passes `icon="store"`
- [ ] Append `channel` to `sales/message-objects.ts` referencing wrapper components
- [ ] Add `loadSalesChannelPreview` to sales previews lib
- [ ] i18n key: `sales.messageObjects.channel.title`

### staff module extension
- [ ] `widgets/messages/StaffTeamRoleMessageObjectPreview.tsx` — wrapper, passes `icon="shield"`
- [ ] `widgets/messages/StaffTeamRoleMessageObjectDetail.tsx` — wrapper, passes `icon="shield"`
- [ ] `widgets/messages/StaffAvailabilityMessageObjectPreview.tsx` — wrapper, passes `icon="calendar-clock"`
- [ ] `widgets/messages/StaffAvailabilityMessageObjectDetail.tsx` — wrapper, passes `icon="calendar-clock"`
- [ ] Append `team_role` and `my_availability` to `staff/message-objects.ts` referencing wrapper components
- [ ] Add preview loaders for both
- [ ] i18n keys: `staff.messageObjects.teamRole.title`, `staff.messageObjects.myAvailability.title`

### Registry regeneration
- [ ] `npm run modules:prepare` run after all `message-objects.ts` changes

### UI page integrations
- [ ] customers/people detail
- [ ] customers/companies detail
- [ ] sales/channels detail
- [ ] catalog/categories detail
- [ ] resources detail
- [ ] staff/teams detail
- [ ] staff/team-members detail
- [ ] staff/team-roles detail
- [ ] staff/my-availability page
- [ ] currencies detail

### Integration Tests
- [ ] Compose API coverage for all 10 entity types
- [ ] UI trigger presence on key pages

---

## Migration & Backward Compatibility

All changes are purely additive:
- New `message-objects.ts` files do not affect existing module behaviour.
- New entries appended to existing `message-objects.ts` files are additive (registry uses a map, no conflicts).
- Generic UI components are new exports — no existing imports break.
- No database migrations required.
- No event ID changes.
- No ACL feature ID changes.

---

## Open Questions

_None — all decisions resolved during research._

---

## Changelog

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-02-26 | Initial draft |
| 0.2 | 2026-02-26 | Rename ViewOnly→Generic; Detail component is fully action-extensible |
| 0.3 | 2026-02-26 | Rename Generic→MessageObject for component names |
| 0.4 | 2026-02-26 | Document metadata rendering in generic components, translated metadata labels, direct component registration approach, and implemented metadata rollout matrix |