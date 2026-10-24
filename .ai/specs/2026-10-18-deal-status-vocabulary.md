# Tenant Deal Status Vocabulary

## TLDR

Resolve terminal deal statuses from a tenant setting, then an environment default, then the shipped vocabulary. List, aggregate, map, closure commands and Kanban share the same classification while dictionary labels stay localizable.

## Proposed Solution

Use the existing tenant-scoped module configuration service and Deal settings page. Pure status helpers accept an optional resolved vocabulary, preserving existing exports and callers. An authenticated settings endpoint supplies the same vocabulary to browser consumers and accepts guarded updates. Extend the existing settings page; no new entity or migration is needed.

## Implementation Plan

### Phase 1: Configuration and semantics

1. Define and validate the vocabulary; implement tenant/environment/default resolution and compatibility aliases.
2. Add the guarded, undoable settings command and GET/PUT endpoint with optimistic locking.
3. Connect server filtering, closure commands and AI projections to the resolved vocabulary.

### Phase 2: Browser consumers and verification

4. Add the settings editor and supply resolved vocabulary to Kanban and closure controls.
5. Add unit and integration coverage; document operator configuration and compatibility.
6. Run validation, independent review and UI verification; publish the implementation PR.

## Architecture and Data Model

Store `customers/dealStatusVocabulary` in the existing `module_configs` tenant row. A server-only resolver reads the authenticated tenant record (ignoring instance rows), then `OM_CUSTOMERS_DEAL_STATUS_VOCABULARY` JSON, then the shipped fallback. No mutable global vocabulary or cross-tenant cache is introduced. The existing config service supplies tenant-keyed caching and invalidation.

The schema is `{won: string[], lost: string[], closed: string[]}`. Each group requires 1–20 trimmed values of 1–50 characters; case-insensitive cross-group overlaps and assigning legacy aliases to another outcome are invalid. `open` and `in_progress` remain nonterminal. The first value is the preferred spelling for new writes. Historical `win`/`won`, `lost`/`loose`, and `closed` remain read aliases of their original outcomes, including under overrides. Labels continue to come from dictionaries; outcome semantics remain the stable `won` and `lost` identifiers.

`closed` aliases represent terminal statuses without a won/lost outcome. Filtering by a closed alias expands all terminal groups, preserving existing `?status=closed` semantics. Unknown values keep their current nonterminal behavior. The default canonical spellings remain `win`, `lost`, `closed`; the AI writer uses the same canonicalization as commands, so new UI and AI writes agree. No persisted statuses are rewritten.

## API Contracts and Permissions

Add GET/PUT `/api/customers/settings/deal-status-vocabulary`. GET is available to deal viewers and returns `{vocabulary, source: 'tenant'|'env'|'default', updatedAt: string|null}`. PUT requires deal management, accepts `{vocabulary: {...}|null}`, and invokes an undoable settings command with mutation guards and optimistic locking. Null resets to env/default. Scope comes only from authentication. Record versions remain available after reset so subsequent writes can detect conflicts.

All existing routes, helpers, constants and call signatures remain available. Pure helpers accept an optional vocabulary argument; default calls keep the shipped behavior. Server consumers resolve once per operation and pass it explicitly. Browser consumers fetch the resolved configuration with a scope-sensitive React Query key. Configuration failures propagate; malformed stored/env values fall through to the next valid level. There is no environment access in browser modules.

## UI/UX and Frontend Architecture Contract

Extend the existing Deal settings page with three labeled alias fields, help explaining preferred spelling and compatibility reads, save/reset actions, and loading/error/conflict states. Reuse shared primitives, `apiCall`, guarded mutation and semantic tokens. Existing Kanban filters and badges use the same resolved vocabulary. Existing client boundaries stay in place; the small config hook is used only by affected views. No shell provider, heavy dependency, or new bundle-wide bootstrap is added. Loading must not allow a tenant's previous configuration to survive a scope change.

## Migration & Backward Compatibility

No migration or new dependency. Unconfigured tenants retain the exact default terminal set and canonical values. Existing constant exports retain their shapes as default-only compatibility snapshots; request consumers use the resolved vocabulary. Dictionary labels and configured statuses are separate. Resetting the tenant setting reverses the configuration; settings commands support undo. Operators should retain custom historical spellings in their vocabulary if they later change it.

## Edge Cases and Failure Scenarios

Reject empty groups, duplicate assignments and collisions with reserved active/historical tokens. Invalid env JSON falls back to built-ins; malformed tenant data falls back to env. Missing optional config service falls back to env/default, but database failures are not hidden. Concurrent settings updates return the standard 409 conflict. Config writes and undo invalidate the existing service cache.

## Integration Coverage

Ship self-contained coverage for settings GET/PUT/reset, invalid and unauthorized writes, optimistic-lock conflicts and tenant isolation; list plain/advanced status filters; aggregate and map agreement; command closure/reopen semantics; and settings editor plus Kanban canonical selection. Fixtures must be created in setup and removed in finally. Unit tests cover unchanged defaults, env defaults, tenant precedence, invalid config, compatibility aliases and simultaneous tenant resolution. Run the configured ordered validation gate and focused tests, then independent review. Record any unavailable live environment or validation limitation.

## Resolved assumptions (autonomous defaults)

- Keep `win` as the default won spelling to preserve current contracts; accept `won` for historical reads and normalize new AI writes.
- Retain historical aliases under overrides, avoiding invisible persisted deals.
- Use existing tenant settings storage and Deal settings UI; avoid schema changes or a new configuration subsystem.
- Pipeline-stage label lookup retains its existing English compatibility aliases and additionally recognizes configured status tokens; explicit stage semantic metadata is separate scope.

## Changelog

- 2026-10-18: Initial design for issue #5546.

## Research

HubSpot likewise keeps configurable stage names separate from Won/Lost reporting semantics ([official pipeline documentation](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines)). This feature applies that separation to existing status aliases without introducing a stage-model redesign.
