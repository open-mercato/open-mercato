# SPEC-018-2026-02-04-command-bus-change-inference

## Overview

Standardize audit log change tracking by removing per-command manual `changes` diffs and relying on the CommandBus snapshot diffing to infer changes. This makes change logs consistent across modules (including nested records and custom fields) and eliminates duplicated, error-prone diff logic.

## Problem Statement

Manual `changes` construction in command `buildLog` handlers is inconsistent and often incomplete (e.g., nested profile fields or custom fields). When the manual diff does not include a field, the audit log UI reports "No tracked field changes" even though snapshots show differences. This is happening in customer/company edits and risks recurring across other modules with complex snapshots.

**Scope**: 38 command files across 12 modules still use manual `buildChanges()` and/or `diffCustomFieldChanges()`. Of these, 12 also call `diffCustomFieldChanges()` explicitly, which is redundant — the CommandBus's `buildRecordChangesDeep` already handles custom-field containers (`custom`, `customFields`, `customValues`, `cf`) automatically.

## Proposed Solution

Use CommandBus's snapshot-diff inference as the single mechanism for audit log `changes`. Commands should:

- Provide `snapshotBefore` and `snapshotAfter` (or `captureAfter`) and omit `changes` in metadata.
- Avoid manual `buildChanges`/custom diff logic in `buildLog`.
- Remove explicit `diffCustomFieldChanges()` calls — CommandBus already handles custom fields when they appear in the snapshot under recognized keys.

CommandBus already performs a deep diff, including nested fields and custom-field containers, and produces flattened change keys for UI display.

### How CommandBus Inference Works

1. After command execution, `buildLog()` returns metadata with `snapshotBefore`/`snapshotAfter`.
2. CommandBus checks: if both snapshots exist and `changes` is `undefined`, `null`, or `{}`, it runs `deriveChangesFromSnapshots()`.
3. `buildRecordChangesDeep()` recursively diffs the two snapshots:
   - Nested objects produce dotted keys (e.g., `profile.firstName`).
   - Custom-field containers (`custom`, `customFields`, `customValues`, `cf`) are normalized with `cf_` prefixes automatically.
   - Deep equality handles `Date` objects (ISO comparison), arrays, and nested structures.
4. Result is stored in `action_logs.changes_json` alongside the snapshots.

## Architecture

- CommandBus infers changes when both `snapshotBefore` and `snapshotAfter` are present.
- Command handlers only set `snapshotBefore`/`snapshotAfter` in `buildLog` and skip `changes`.
- UI uses inferred changes without per-module formatting.

## Data Models

No schema changes. Uses existing `action_logs.changes_json` with inferred changes.

## API Contracts

No API changes. Audit log payloads will include inferred `changes` more consistently.

## UI/UX

- "Changed fields" now includes nested and custom field changes derived from snapshots.
- Custom fields already render in a separate section (handled in UI layer).

## Human-Friendly Label Resolution

### Problem

The "Changed fields" table in audit logs and version history displays raw UUIDs for reference fields instead of human-readable names. For example:

- **Role Ids**: `["987e6df0-dce2-417a-a52b-006016dd0175"]` instead of `["Backend Engineer"]`
- **User Id**: `10702c6f-9610-4ec7-897b-72867f3400d6` instead of `"John Smith"`
- **Team Id**: `abc123...` instead of `"Platform Team"`

This applies to both the "Before"/"After" columns in the changes table and the JSON in "Snapshot before"/"Snapshot after" sections.

### Current State

**Field names** go through `humanizeField()` which converts `roleIds` → "Role Ids", `userId` → "User Id" via snake_case/camelCase splitting + title-casing. This is acceptable for most standard fields.

**Field values** are rendered by `renderValue()` in `packages/core/src/modules/audit_logs/lib/display-helpers.tsx` which treats UUIDs as plain strings with no resolution. Arrays of UUIDs render as formatted JSON blocks.

**Change rows** are extracted by `extractChangeRows()` which reads from `changes_json` and has no label lookup capability.

Both the `ActionLogDetailsDialog` (audit logs) and `VersionHistoryDetail` (version history sidebar) share the same rendering pipeline — both will benefit from the fix.

### Design: `_labels` Map in Snapshots

Store an optional `_labels` map inside each snapshot that maps entity IDs to their human-readable display names. Labels are resolved **at snapshot capture time** (not at display time) to preserve historical accuracy — the label reflects what the entity was called when the change happened, even if it's later renamed or deleted.

```typescript
// Example: team-member snapshot with _labels
{
  id: "...",
  userId: "10702c6f-9610-4ec7-897b-72867f3400d6",
  roleIds: ["987e6df0-dce2-417a-a52b-006016dd0175"],
  teamId: "a1b2c3d4-...",
  tags: ["backend", "platform"],
  isActive: true,
  // Label resolution map — resolved at capture time
  _labels: {
    "10702c6f-9610-4ec7-897b-72867f3400d6": "John Smith",
    "987e6df0-dce2-417a-a52b-006016dd0175": "Backend Engineer",
    "a1b2c3d4-...": "Platform Team"
  }
}
```

**Key design decisions:**

1. **Capture-time resolution**: Labels are resolved when the snapshot is created, not when the audit log is viewed. This guarantees:
   - Historical accuracy (shows the name at the time of the change)
   - No missing labels for deleted entities
   - No extra API calls at display time
   - Works with encrypted snapshots (decrypted alongside other fields)

2. **Single flat map per snapshot**: All ID-to-label mappings across all fields in one `_labels` object. Simple to populate and consume. No collision risk since IDs are UUIDs.

3. **Graceful degradation**: If `_labels` is missing (older log entries), the UI falls back to displaying raw values as today. No migration needed.

4. **Excluded from diff**: The `_labels` key is excluded from `buildRecordChangesDeep` so it never appears as a changed field.

### Implementation

#### Phase 1: Infrastructure (shared + UI layer)

##### 1.1. Exclude `_labels` from diff engine

**File**: `packages/shared/src/lib/commands/command-bus.ts`

Add `_labels` to a set of metadata keys that `buildRecordChangesDeep` skips:

```typescript
const SNAPSHOT_META_KEYS = new Set(['_labels', '_fieldLabels'])

function buildRecordChangesDeep(before, after, prefix?) {
  const changes = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (SNAPSHOT_META_KEYS.has(key)) continue          // ← Skip metadata keys
    if (CUSTOM_FIELD_CONTAINER_KEYS.has(key)) { ... }
    // ... rest unchanged
  }
  return changes
}
```

##### 1.2. Create shared label resolution helper

**File**: `packages/shared/src/lib/commands/snapshotLabels.ts` (new)

```typescript
import type { EntityManager } from '@mikro-orm/core'

export type LabelSpec = {
  /** The entity class name or table to query */
  entity: string
  /** IDs to resolve */
  ids: string[]
  /** Field(s) to use as display name (priority order) */
  displayFields?: string[]
}

export type LabelMap = Record<string, string>

/**
 * Batch-resolve entity IDs to human-readable display names.
 * Returns a flat map of id → label.
 *
 * Uses a priority list of display fields: name, displayName, title, label, email, code.
 * Falls back to the first non-null display field found.
 */
export async function resolveSnapshotLabels(
  em: EntityManager,
  specs: LabelSpec[],
): Promise<LabelMap> {
  const labels: LabelMap = {}
  for (const spec of specs) {
    const uniqueIds = [...new Set(spec.ids.filter(Boolean))]
    if (!uniqueIds.length) continue
    const rows = await em.find(spec.entity, { id: { $in: uniqueIds } })
    const displayFields = spec.displayFields ?? [
      'name', 'displayName', 'display_name', 'title', 'label', 'email', 'code',
    ]
    for (const row of rows) {
      const id = String((row as any).id)
      for (const field of displayFields) {
        const value = (row as any)[field]
        if (typeof value === 'string' && value.trim().length) {
          labels[id] = value
          break
        }
      }
    }
  }
  return labels
}

/**
 * Merge multiple label maps into one.
 */
export function mergeLabels(...maps: (LabelMap | undefined | null)[]): LabelMap {
  const result: LabelMap = {}
  for (const map of maps) {
    if (map) Object.assign(result, map)
  }
  return result
}
```

##### 1.3. Update UI value renderer to use labels

**File**: `packages/core/src/modules/audit_logs/lib/display-helpers.tsx`

Add a label-aware value renderer and update `extractChangeRows` to accept labels:

```typescript
// UUID regex pattern for detecting IDs
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type LabelMap = Record<string, string>

/** Resolve a single value through the label map */
function resolveLabel(value: unknown, labels: LabelMap): unknown {
  if (typeof value === 'string' && UUID_RE.test(value) && labels[value]) {
    return labels[value]
  }
  if (Array.isArray(value)) {
    const resolved = value.map((item) =>
      typeof item === 'string' && UUID_RE.test(item) && labels[item]
        ? labels[item]
        : item
    )
    // Only return resolved if at least one label was found
    if (resolved.some((r, i) => r !== value[i])) return resolved
  }
  return value
}

/** Merge _labels from both snapshots into a single lookup */
export function extractLabelsFromSnapshots(
  snapshotBefore: unknown,
  snapshotAfter: unknown,
): LabelMap {
  const labels: LabelMap = {}
  if (isRecord(snapshotBefore) && isRecord((snapshotBefore as any)._labels)) {
    Object.assign(labels, (snapshotBefore as any)._labels)
  }
  if (isRecord(snapshotAfter) && isRecord((snapshotAfter as any)._labels)) {
    Object.assign(labels, (snapshotAfter as any)._labels)
  }
  return labels
}

/** Updated extractChangeRows with label resolution */
export function extractChangeRows(
  changes: Record<string, unknown> | null | undefined,
  snapshotBefore: unknown,
  snapshotAfter?: unknown,
): ChangeRow[] {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return []
  const before = isRecord(snapshotBefore) ? snapshotBefore : null
  const labels = extractLabelsFromSnapshots(snapshotBefore, snapshotAfter)
  const hasLabels = Object.keys(labels).length > 0

  return Object.entries(changes).map(([field, value]) => {
    let from: unknown
    let to: unknown
    if (isRecord(value) && ('from' in value || 'to' in value)) {
      from = (value as Record<string, unknown>).from ?? before?.[field]
      to = (value as Record<string, unknown>).to ?? null
    } else {
      from = before?.[field]
      to = value
    }
    // Resolve labels for display
    if (hasLabels) {
      from = resolveLabel(from, labels)
      to = resolveLabel(to, labels)
    }
    return { field, from, to }
  }).sort((a, b) => a.field.localeCompare(b.field))
}
```

Update the `ActionLogDetailsDialog` and `VersionHistoryDetail` to pass `snapshotAfter` to `extractChangeRows`.

##### 1.4. Update ActionLogDetailsDialog

**File**: `packages/core/src/modules/audit_logs/components/ActionLogDetailsDialog.tsx`

Change the `extractChangeRows` call to include `snapshotAfter`:

```typescript
const changeRows = React.useMemo(
  () => extractChangeRows(item.changes, item.snapshotBefore, item.snapshotAfter),
  [item.changes, item.snapshotBefore, item.snapshotAfter]
)
```

##### 1.5. Update VersionHistoryDetail

**File**: `packages/ui/src/backend/version-history/VersionHistoryDetail.tsx`

Same change — pass the after snapshot:

```typescript
const changeRows = React.useMemo(
  () => extractChangeRows(item.changes, item.snapshotBefore, item.snapshotAfter),
  [item.changes, item.snapshotBefore, item.snapshotAfter]
)
```

#### Phase 2: Per-Module Snapshot Label Enrichment

Each module's snapshot loader function gains label resolution. The pattern is consistent:

1. After loading the record, collect all reference IDs
2. Batch-resolve them via `resolveSnapshotLabels`
3. Attach `_labels` to the returned snapshot

##### Reference Fields by Module

Below is the complete inventory of reference fields per module that need label resolution, organized by the entity type they reference:

Module: `staff`

| Snapshot | Reference Field | References Entity | Display Field |
| --- | --- | --- | --- |
| TeamMember | `userId` | User | name / email |
| TeamMember | `teamId` | StaffTeam | name |
| TeamMember | `roleIds[]` | StaffTeamRole | name |
| TeamRole | `teamId` | StaffTeam | name |
| Activity | `memberId` | StaffTeamMember | displayName |
| Activity | `authorUserId` | User | name / email |
| Address | `memberId` | StaffTeamMember | displayName |
| Comment | `memberId` | StaffTeamMember | displayName |
| Comment | `authorUserId` | User | name / email |
| JobHistory | `memberId` | StaffTeamMember | displayName |
| LeaveRequest | `memberId` | StaffTeamMember | displayName |
| LeaveRequest | `submittedByUserId` | User | name / email |
| LeaveRequest | `decidedByUserId` | User | name / email |
| LeaveRequest | `unavailabilityReasonEntryId` | DictionaryEntry | label |

Module: `resources`

| Snapshot | Reference Field | References Entity | Display Field |
| --- | --- | --- | --- |
| Resource | `resourceTypeId` | ResourceType | name |

Module: `catalog`

| Snapshot | Reference Field | References Entity | Display Field |
| --- | --- | --- | --- |
| Product | `taxRateId` | SalesTaxRate | name |
| Product | `statusEntryId` | DictionaryEntry | label |
| Variant | `productId` | CatalogProduct | title |
| Variant | `statusEntryId` | DictionaryEntry | label |
| Variant | `taxRateId` | SalesTaxRate | name |
| Category | `parentId` | CatalogProductCategory | name |
| Category | `rootId` | CatalogProductCategory | name |
| Offer | `productId` | CatalogProduct | title |
| Offer | `channelId` | SalesChannel | name |
| Price | `priceKindId` | CatalogPriceKind | title |
| Price | `variantId` | CatalogProductVariant | name / sku |
| Price | `productId` | CatalogProduct | title |
| Price | `offerId` | CatalogOffer | title |
| Price | `channelId` | SalesChannel | name |
| Price | `userId` | User | name / email |
| Price | `customerId` | CustomerEntity | displayName |

Module: `sales`

| Snapshot | Reference Field | References Entity | Display Field |
| --- | --- | --- | --- |
| Channel | `statusEntryId` | DictionaryEntry | label |
| TaxRate | `channelId` | SalesChannel | name |
| TaxRate | `productCategoryId` | CatalogProductCategory | name |
| Note | `authorUserId` | User | name / email |
| Note | `contextId` | SalesOrder/Quote/etc. | orderNumber / quoteNumber |

Module: `customers`

| Snapshot | Reference Field | References Entity | Display Field |
| --- | --- | --- | --- |
| Person | `entity.ownerUserId` | User | name / email |
| Person | `profile.companyEntityId` | CustomerCompany | displayName |
| Company | `entity.ownerUserId` | User | name / email |
| Deal | `deal.ownerUserId` | User | name / email |
| Deal | `people[]` | CustomerPerson | displayName |
| Deal | `companies[]` | CustomerCompany | displayName |
| Comment | `entityId` | CustomerEntity | displayName |
| Comment | `authorUserId` | User | name / email |
| Comment | `dealId` | CustomerDeal | title |
| TagAssignment | `tagId` | CustomerTag | label |

Module: `auth`

| Snapshot | Reference Field | References Entity | Display Field |
| --- | --- | --- | --- |
| User | `roles[]` | Role | name |

Module: `directory`

| Snapshot | Reference Field | References Entity | Display Field |
| --- | --- | --- | --- |
| Organization | `parentId` | Organization | name |

Module: `feature_toggles`

| Snapshot | Reference Field | References Entity | Display Field |
| --- | --- | --- | --- |
| Override | `toggleId` | FeatureToggle | name |

##### Example: Staff Team Members Loader

```typescript
async function loadTeamMemberSnapshot(
  em: EntityManager,
  id: string,
): Promise<TeamMemberSnapshot | null> {
  const member = await findOneWithDecryption(em, StaffTeamMember, { id }, ...)
  if (!member) return null

  // Collect reference IDs for label resolution
  const labelSpecs: LabelSpec[] = []
  if (member.userId) {
    labelSpecs.push({ entity: 'User', ids: [member.userId], displayFields: ['name', 'email'] })
  }
  if (member.teamId) {
    labelSpecs.push({ entity: 'StaffTeam', ids: [member.teamId] })
  }
  if (member.roleIds?.length) {
    labelSpecs.push({ entity: 'StaffTeamRole', ids: member.roleIds })
  }
  const _labels = await resolveSnapshotLabels(em, labelSpecs)

  return {
    id: member.id,
    // ... existing fields ...
    userId: member.userId ?? null,
    roleIds: Array.isArray(member.roleIds) ? member.roleIds : [],
    tags: Array.isArray(member.tags) ? member.tags : [],
    _labels,
  }
}
```

##### Priority Order for Label Resolution

Not all reference fields are equally important. Prioritize:

1. **High impact** — Fields shown prominently and frequently changed:
   - `userId` / `authorUserId` / `ownerUserId` → User name
   - `roleIds` / `roles` → Role name
   - `teamId` → Team name
   - `statusEntryId` → Dictionary entry label
   - `memberId` → Team member displayName
   - `productId` → Product title

2. **Medium impact** — Less frequently changed but still confusing as UUIDs:
   - `channelId` → Channel name
   - `taxRateId` → Tax rate name
   - `resourceTypeId` → Resource type name
   - `parentId` (categories/orgs) → Parent name
   - `companyEntityId` → Company display name

3. **Low impact / skip** — Structural IDs rarely shown in changes:
   - `tenantId` / `organizationId` — Already resolved in audit log header
   - `dictionaryId` — Structural, rarely changes
   - `priceKindId` — Already has `priceKindCode` resolved alongside

#### Phase 3: Custom Field Label Resolution (optional enhancement)

Custom fields already have their `cf_`/`cf:` prefixes stripped by `normalizeChangeField()`. For even better display, add a `_fieldLabels` map that provides the custom field's configured label instead of the machine key:

```typescript
{
  custom: {
    "brand_name": "Acme Corp",
    "warranty_months": 24
  },
  _fieldLabels: {
    "cf_brand_name": "Brand Name",
    "cf_warranty_months": "Warranty (Months)"
  }
}
```

In the UI, `humanizeField` would first check `_fieldLabels` before falling back to the string transformation. This is a lower priority enhancement since `humanizeField` already produces acceptable results for most field names.

### Rendering Pipeline (After Changes)

```text
Snapshot captured with _labels → CommandBus diffs (skips _labels) → changes_json stored
                                                                           ↓
                                                      extractChangeRows(changes, snapBefore, snapAfter)
                                                                           ↓
                                                      merges _labels from both snapshots
                                                                           ↓
                                                      for each change row:
                                                        resolveLabel(from, labels) → display name or original
                                                        resolveLabel(to, labels)   → display name or original
                                                                           ↓
                                                      humanizeField(field) → "Role Ids" (field name stays same)
                                                      renderValue(resolvedFrom) → "Backend Engineer"
                                                      renderValue(resolvedTo) → "Staff Engineer"
```

### Migration & Backward Compatibility

- **No database migration**: `_labels` is stored inside the existing JSONB `snapshot_before`/`snapshot_after` columns.
- **Old entries unchanged**: `extractLabelsFromSnapshots` returns `{}` when `_labels` is absent, so `resolveLabel` is a no-op and the raw value renders as before.
- **Gradual rollout**: Each module can be updated independently. As modules are updated, their new audit log entries start showing labels.

### Testing Strategy

1. **Unit tests** for `resolveSnapshotLabels`:
   - Verifies batch loading of entity display names
   - Handles missing/deleted entities gracefully (no crash, just no label)
   - Handles empty ID arrays

2. **Unit tests** for `resolveLabel`:
   - UUID string → resolved label
   - UUID array → array with resolved labels
   - Non-UUID string → returned as-is
   - Missing label → returned as-is (graceful degradation)

3. **Integration tests** per module:
   - Create entity → update entity → verify `_labels` populated in snapshot
   - Verify audit log "Changed fields" shows human-readable names
   - Verify undo still works (undo uses raw IDs from snapshot, not labels)

4. **Backward compatibility test**:
   - Render an old audit log entry without `_labels` → should display as before

## Configuration

None.

## Alternatives Considered

1. **Keep manual diffs and expand lists**
   - Rejected: ongoing maintenance burden, easy to miss nested fields.
2. **Hybrid manual + inferred**
   - Rejected: ambiguity over source of truth and inconsistent output.

## Implementation Approach

1. **Remove manual `changes` in `buildLog`** when snapshots are present.
2. **Remove `diffCustomFieldChanges` calls** — ensure the snapshot includes custom fields under a recognized key so CommandBus diffs them automatically.
3. **Ensure `snapshotAfter` exists** (via `captureAfter` or explicit fetch) for update commands. Sub-entity commands (addresses, comments, tags) may need snapshot capture added if not already present.
4. **Clean unused imports** (`buildChanges`, `diffCustomFieldChanges`, change-key constants, etc.).
5. **Verify audit logs** for representative records across all affected modules.

## Files/Places To Fix

Remove manual `changes` assignments in `buildLog` (or equivalent) and rely on snapshots. Grouped by module:

### catalog (6 files)

- `packages/core/src/modules/catalog/commands/products.ts`
- `packages/core/src/modules/catalog/commands/variants.ts`
- `packages/core/src/modules/catalog/commands/categories.ts`
- `packages/core/src/modules/catalog/commands/offers.ts`
- `packages/core/src/modules/catalog/commands/priceKinds.ts`
- `packages/core/src/modules/catalog/commands/prices.ts`

### sales (3 files)

- `packages/core/src/modules/sales/commands/configuration.ts` (5 update commands)
- `packages/core/src/modules/sales/commands/documents.ts` (update/adjustment flows)
- `packages/core/src/modules/sales/commands/notes.ts`

### staff (8 files) — uses both `buildChanges` and `diffCustomFieldChanges`

- `packages/core/src/modules/staff/commands/activities.ts`
- `packages/core/src/modules/staff/commands/addresses.ts`
- `packages/core/src/modules/staff/commands/comments.ts`
- `packages/core/src/modules/staff/commands/job-histories.ts`
- `packages/core/src/modules/staff/commands/leave-requests.ts`
- `packages/core/src/modules/staff/commands/team-members.ts` — also `diffCustomFieldChanges`
- `packages/core/src/modules/staff/commands/team-roles.ts` — also `diffCustomFieldChanges`
- `packages/core/src/modules/staff/commands/teams.ts` — also `diffCustomFieldChanges`

### resources (4 files) — uses both `buildChanges` and `diffCustomFieldChanges`

- `packages/core/src/modules/resources/commands/activities.ts`
- `packages/core/src/modules/resources/commands/resource-types.ts` — also `diffCustomFieldChanges`
- `packages/core/src/modules/resources/commands/resources.ts` — also `diffCustomFieldChanges`
- `packages/core/src/modules/resources/commands/comments.ts`

### customers — sub-entity commands (4 files)

- `packages/core/src/modules/customers/commands/tags.ts`
- `packages/core/src/modules/customers/commands/addresses.ts`
- `packages/core/src/modules/customers/commands/comments.ts`
- `packages/core/src/modules/customers/commands/dictionaries.ts` (2 instances)

### auth (2 files) — also `diffCustomFieldChanges`

- `packages/core/src/modules/auth/commands/users.ts`
- `packages/core/src/modules/auth/commands/roles.ts`

### directory (2 files)

- `packages/core/src/modules/directory/commands/organizations.ts` — also `diffCustomFieldChanges`
- `packages/core/src/modules/directory/commands/tenants.ts`

### feature_toggles (2 files)

- `packages/core/src/modules/feature_toggles/commands/global.ts`
- `packages/core/src/modules/feature_toggles/commands/overrides.ts`

### dictionaries (1 file)

- `packages/core/src/modules/dictionaries/commands/factory.ts`

### currencies (2 files)

- `packages/core/src/modules/currencies/commands/currencies.ts`
- `packages/core/src/modules/currencies/commands/exchange-rates.ts`

### planner (1 file) — also `diffCustomFieldChanges`

- `packages/core/src/modules/planner/commands/availability-rule-sets.ts`

### example app (1 file)

- `apps/mercato/src/modules/example/commands/todos.ts` — serves as a template for users, should demonstrate the correct pattern

### Already clean (confirm only)

These primary entity commands already rely on snapshot inference:

- `packages/core/src/modules/customers/commands/companies.ts`
- `packages/core/src/modules/customers/commands/people.ts`
- `packages/core/src/modules/customers/commands/deals.ts`
- `packages/core/src/modules/customers/commands/activities.ts`

### Verification checklist per file

For each file above:

1. Confirm `snapshotBefore` and `snapshotAfter` (or `captureAfter`) are set in `buildLog`.
2. If snapshots are missing, add them rather than keeping manual diffs.
3. Ensure custom-field data is included in the snapshot under a recognized key (`custom`, `customFields`, `customValues`, or `cf`) so CommandBus auto-diffs it.
4. Remove the `changes` property from the `buildLog` return.
5. Remove `diffCustomFieldChanges()` calls and any manual merging of custom-field changes.
6. Clean up unused imports: `buildChanges`, `diffCustomFieldChanges`, module-specific `*_CHANGE_KEYS` constants.

## Migration Path

No data migration required. New changes will be inferred automatically; existing log entries remain unchanged.

## Success Metrics

- Audit log "Changed fields" populated whenever snapshots differ.
- Nested profile/custom field changes appear consistently.
- No module-specific diff logic remains in update command logs.
- `buildChanges` and `diffCustomFieldChanges` have zero call sites in command files (only the definitions in `packages/shared` remain for potential external use).
- Reference fields (user IDs, role IDs, entity IDs) display human-readable labels in audit log changes.
- `_labels` map present in snapshots for all commands with reference fields.
- Older audit log entries without `_labels` continue to render correctly (graceful degradation).

## Open Questions

- Are there sub-entity commands (addresses, comments, tags) without `snapshotBefore`/`snapshotAfter` that need snapshot capture added first?
- Are there snapshots that include large arrays/graphs that could be too noisy in diffs? If so, should we prune snapshot data rather than diff manually?
- Should the `example` app command in `apps/mercato` be updated first to serve as the canonical reference for the correct pattern?
- Should `_labels` resolution be opt-in per snapshot loader or automatic via a decorator/wrapper around all loaders?
- For nested snapshot objects (e.g., `PersonSnapshot.entity.ownerUserId`), should the `_labels` map be flat (keyed by UUID) or nested to match the snapshot structure? Flat is simpler since UUIDs are globally unique.

## Changelog

### 2026-02-04 (label resolution)

- Added "Human-Friendly Label Resolution" section with full design for `_labels` map in snapshots.
- Analyzed all 38+ command files across 12 modules for reference fields needing label resolution.
- Documented complete inventory of reference fields per module (50+ fields across 8 modules).
- Designed 3-phase implementation: infrastructure (diff exclusion + shared helper + UI renderer), per-module enrichment, optional custom field labels.
- Added `resolveSnapshotLabels` shared helper specification.
- Added UI rendering pipeline changes for `extractChangeRows` and `renderValue`.
- Prioritized reference fields by impact (high/medium/low).
- Added testing strategy and backward compatibility guarantees.
- Added new open questions about nested snapshot label maps and opt-in vs automatic resolution.

### 2026-02-04 (file audit)

- Expanded file list from 12 to 38 files across 12 modules after full codebase audit.
- Added missing modules: staff (8 files), resources (4 files), customer sub-entity commands (4 files), auth (2 files), directory (2 files), currencies (2 files), planner (1 file), sales/notes, feature_toggles/global, example app.
- Added explicit handling for `diffCustomFieldChanges` removal (12 files use it).
- Added per-file verification checklist.
- Grouped files by module for easier tracking.
- Added example app to scope (serves as user-facing template).
- Added "How CommandBus Inference Works" section documenting the mechanism.

### 2026-02-04

- Initial specification for removing manual audit-log diffs in favor of CommandBus snapshot inference.
