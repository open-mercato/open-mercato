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

## Open Questions

- Are there sub-entity commands (addresses, comments, tags) without `snapshotBefore`/`snapshotAfter` that need snapshot capture added first?
- Are there snapshots that include large arrays/graphs that could be too noisy in diffs? If so, should we prune snapshot data rather than diff manually?
- Should the `example` app command in `apps/mercato` be updated first to serve as the canonical reference for the correct pattern?

## Changelog

### 2026-02-04 (update)

- Expanded file list from 12 to 38 files across 12 modules after full codebase audit.
- Added missing modules: staff (8 files), resources (4 files), customer sub-entity commands (4 files), auth (2 files), directory (2 files), currencies (2 files), planner (1 file), sales/notes, feature_toggles/global, example app.
- Added explicit handling for `diffCustomFieldChanges` removal (12 files use it).
- Added per-file verification checklist.
- Grouped files by module for easier tracking.
- Added example app to scope (serves as user-facing template).
- Added "How CommandBus Inference Works" section documenting the mechanism.

### 2026-02-04

- Initial specification for removing manual audit-log diffs in favor of CommandBus snapshot inference.
