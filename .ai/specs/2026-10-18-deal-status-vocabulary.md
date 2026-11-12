# Tenant Deal Status Vocabulary

## TLDR

Resolve terminal deal statuses from a tenant setting, then an environment default, then the shipped vocabulary. Status filters, summaries, company/person KPIs, closure commands and browser consumers use the same resolved vocabulary while dictionary labels stay localizable. This PR defines the design; implementation and runtime verification remain in PR #7625.

## Overview

Issue #5546 requests configurable won/lost/closed spellings without changing the meaning of outcomes or hiding historical deals. Reuse the existing configuration service and Deal settings page. The capability includes configuration, consistent consumption, and a warning before reclassifying stored deals; it does not redesign pipeline-stage semantics.

## Problem Statement

`lib/dealStatus.ts` centralizes many aliases, but SQL summaries, dashboard filters, stage-label helpers and several writers also embed English literals. Changing only the shared helpers leaves list filters, summary totals and company/person KPIs disagreeing for the same tenant. UI writes prefer `win`/`lost`, while the AI tool can write `won`/`lost`. Removing a custom terminal alias can also make stored deals appear open without changing any deal row.

## Proposed Solution

Use the existing tenant-scoped module configuration service and Deal settings page. Pure status helpers accept an optional resolved vocabulary, preserving existing exports and callers. An authenticated settings endpoint supplies the same vocabulary to browser consumers and accepts guarded updates. Extend the existing settings page; no new entity or migration is needed.

## Architecture

Store `customers/dealStatusVocabulary` in the existing `module_configs` tenant row. A server-only resolver calls `moduleConfigService.getRecord('customers', 'dealStatusVocabulary', { tenantId })` with the authenticated tenant. Accept the returned value only when `record.source === 'tenant'`: `getRecord` falls back to an instance row, so `source: 'instance'` must be ignored for both vocabulary and tenant version. A valid tenant value wins over `OM_CUSTOMERS_DEAL_STATUS_VOCABULARY` JSON, which wins over the shipped fallback. A tenant row with a null value is a reset: resolve env/default while retaining that tenant row's `updatedAt` for locking. No mutable global vocabulary or cross-tenant cache is introduced. The existing config service supplies tenant-keyed caching and invalidation.

### Consumer inventory and vocabulary delivery

Paths are relative to `packages/core/src/modules/customers/` unless another module is named. The inventory covers direct helper callers, independent literal/SQL classifiers, writers and indirect hosts. Before implementation merge, repeat a repository-wide search for status helper imports and terminal literals; each runtime match must be connected or explicitly justified.

| File / surface | Runtime | Vocabulary delivery and responsibility |
| --- | --- | --- |
| `lib/dealStatus.ts` | Shared pure helpers | Accept optional explicit vocabulary in classification, canonicalization and alias expansion; omitted argument retains defaults. |
| `api/deals/route.ts` | Server | Resolve once per request and pass through plain/advanced status filters and `buildDealListFilters`. |
| `api/deals/aggregate/route.ts` | Server | Resolve once and pass into status expansion before aggregation. |
| `api/deals/map/route.ts` | Server | Pass the same request vocabulary into every `buildDealListFilters` call, including the second search/intersection pass. |
| `api/deals/summary/route.ts` → `lib/dealsSummaryQueries.ts` | Server / SQL | Route resolves and passes vocabulary into query input. Replace literal won/lost predicates for won value, quarterly counts and monthly win-rate series with parameterized alias groups; retain existing `closure_outcome` semantics and tenant/organization/deleted-row predicates. Preserve existing explicit `open`/`in_progress`, overdue and date-window rules. |
| `api/companies/[id]/route.ts` | Server | Pass request vocabulary to active/won deal KPI calculations after normal scope filtering. |
| `api/people/[id]/companies/enriched/route.ts` | Server | Pass request vocabulary to related-company active/won counts and values. |
| `commands/deals.ts` | Server | Resolve from command scope for canonical writes, closure/reopen detection and won/lost event selection; keep event IDs and outcome enums. |
| `lib/closureStage.ts` | Server helper | Receive vocabulary from commands/AI preview for status classification and configured won/lost stage-label candidates, retaining English compatibility labels. |
| `ai-tools/deals-pack.ts` | Server | Resolve from tool scope for previews, closure-stage lookup and canonical status; approved execution uses the same command path. |
| `backend/customers/deals/page.tsx` | Browser | Own the scope-sensitive hook; use vocabulary for badges and preferred quick-filter values while accepting existing URLs. |
| `backend/customers/deals/pipeline/page.tsx` | Browser | Own the hook and pass data through Kanban props; status actions write preferred spellings with stable semantic outcomes. |
| `backend/customers/deals/pipeline/components/StatusFilterPopover.tsx` | Browser | Receive host vocabulary for canonical selections, options and alias matching. |
| `backend/customers/deals/pipeline/components/Lane.tsx` | Browser | Forward host vocabulary to filter/action children; no independent fallback aliases. |
| `backend/customers/deals/pipeline/components/QuickDealDialog.tsx` | Browser | Receive host vocabulary; preserve active choices and derive terminal choices from preferred spellings. |
| `backend/customers/deals/[id]/page.tsx` and `hooks/useDealClosure.ts` | Browser | Host supplies vocabulary to detail closure controls; mutations use preferred spellings and stable `won`/`lost` outcomes. |
| `components/detail/CompanyKpiBar.tsx` | Browser | Receive vocabulary from company/person host for active values, won counts and every local fallback when API KPIs are absent. |
| `components/detail/ActiveDealCard.tsx` | Browser | Receive vocabulary from detail host for active-deal filtering. |
| `components/detail/dashboard/helpers.ts` | Browser pure helpers | Accept optional vocabulary forwarded by company/person dashboard callers for sums, active lists and trends. |
| `components/detail/pipelineStageUtils.ts`, `DealDetailHeader.tsx`, `PipelineStepper.tsx` | Browser | Host forwards vocabulary for configured stage-label recognition; preserve existing won/lost/stalled compatibility labels and stable outcome rendering. |
| `components/linking/adapters/dealAdapter.tsx` | Browser | Linking host passes vocabulary into preferred won/lost filter values; server expansion still accepts legacy filter IDs. |
| `dashboards/widgets/dashboard/pipeline-summary/{widget.client.tsx,config.ts}` under `packages/core/src/modules/` | Browser / pure request builder | Widget obtains scoped vocabulary and passes terminal aliases into `buildPipelineDataRequest`; preserve `closureOutcome is_null`, `all` mode and the default-only `CLOSED_DEAL_STATUSES` export. No server resolver import. |
| `backend/config/customers/deals/page.tsx` and editor | Browser | GET supplies vocabulary/source/version; guarded PUT handles save/reset, impact confirmation and lock conflicts. |

Seed dictionaries/demo fixtures in `cli.ts`, historical migrations and exported default constants retain shipped spellings; they are not tenant request classifiers. Validated `closureOutcome` enum comparisons in stats routes, dialogs and headers remain `won`/`lost`. Dictionary labels and presentation-only message preview colors do not define outcomes. These exceptions must not become alternate classification logic.

## Data Models

The schema is `{won: string[], lost: string[], closed: string[]}`. Each group requires 1–20 trimmed values of 1–50 characters; case-insensitive cross-group overlaps and assigning legacy aliases to another outcome are invalid. `open` and `in_progress` remain nonterminal. The first value is the preferred spelling for new writes. Historical `win`/`won`, `lost`/`loose`, and `closed` remain read aliases of their original outcomes, including under overrides. Labels continue to come from dictionaries; outcome semantics remain the stable `won` and `lost` identifiers.

`closed` aliases represent terminal statuses without a won/lost outcome. Filtering by a closed alias expands all terminal groups, preserving existing `?status=closed` semantics. Unknown values keep their current nonterminal behavior. The default canonical spellings remain `win`, `lost`, `closed`; the AI writer uses the same canonicalization as commands, so new UI and AI writes agree. No persisted statuses are rewritten.

## API Contracts and Permissions

Add GET/PUT `/api/customers/settings/deal-status-vocabulary` with OpenAPI contracts. GET requires `customers.deals.view` and returns `{vocabulary, source: 'tenant'|'env'|'default', updatedAt: string|null}`. PUT requires `customers.deals.manage`, accepts `{vocabulary: {...}|null, reclassificationConfirmation?: {fingerprint: string}}`, and invokes an undoable settings command with mutation guards and optimistic locking. Null resets to env/default. Scope comes only from authentication. Record versions remain available after reset so subsequent writes can detect conflicts. Tenant-wide writes and impact counts must respect organization authorization: deny callers restricted to part of the tenant before counting, rather than exposing cross-scope counts or applying a tenant-wide change with a partial warning.

### Persisted-deal reclassification confirmation

Before any save/reset, compare previous and candidate effective vocabulary, including retained historical aliases, against non-deleted persisted deals in the authorized tenant scope. Count distinct deals whose status classification changes among open, won, lost and closed-without-outcome. Cover alias removal/reassignment, additions that turn unknown statuses terminal, and reset. Do not return deal IDs or titles. Explicit stored outcomes remain unchanged, but the warning still counts status reclassification because status-only readers can change.

When the count is nonzero and current confirmation is absent, write nothing and return `409` with code `deal_status_reclassification_confirmation_required` and `{impact: {affectedDeals: number, fingerprint: string}}`. The fingerprint binds authenticated scope, tenant config version, normalized candidate and impacted status/count groups. The editor displays the count and requires explicit confirmation before retrying the same candidate with the fingerprint and optimistic-lock header; a boolean alone is insufficient. Recompute impact immediately before writing: changed candidate/version/impact groups return refreshed confirmation. Standard optimistic-lock conflicts keep their existing 409 body and take precedence when the setting version is stale. Zero-impact changes need no additional confirmation. Undo uses the same guard so it cannot silently reclassify deals created since the original write. Fingerprints check freshness; they never grant authorization.

All existing routes, helpers, constants and call signatures remain available. Pure helpers accept an optional vocabulary argument; default calls keep the shipped behavior. Server consumers resolve once per operation and pass it explicitly. Browser consumers fetch the resolved configuration with a scope-sensitive React Query key. Configuration failures propagate; malformed stored/env values fall through to the next valid level. There is no environment access in browser modules.

## UI/UX and Frontend Architecture Contract

Extend the existing Deal settings page with three labeled alias fields, help explaining preferred spelling and compatibility reads, save/reset actions, and loading/error/conflict states. The impact response opens a shared confirmation dialog displaying the count; cancel leaves the setting untouched. Localize all strings and reuse shared primitives, `apiCall`, `useGuardedMutation`, optimistic-lock helpers and semantic tokens. Dialogs support Cmd/Ctrl+Enter submit and Escape cancel. Loading must not allow a previous tenant's configuration or a stale confirmation to survive a scope change. Invalidate the config query and dependent deal queries after save/reset/undo.

| Boundary / client ledger | Responsibility and constraints |
| --- | --- |
| Resolver, API routes, commands and SQL builders | Server only; own authenticated scope and env access. |
| Existing settings, deal list/detail/Kanban and company/person browser hosts in the inventory | Retain existing client boundaries for forms, filters and drag/drop; hosts own one scoped query and pass plain vocabulary to helpers/children. |
| New small hook and settings editor leaf | Query state, fields and confirmation only; no heavy dependency; keep each new client file below 300 LOC. |
| Existing dashboard widget | Retain lazy boundary; resolve vocabulary only while mounted. |

Budgets: zero new unallowlisted client roots, zero heavy root imports, no shared shell hydration growth and only small wiring additions to existing large roots. No shell provider or global bootstrap is added. Implementation must record `yarn check:client-boundaries`, hydration/interaction smoke tests for affected routes and a route bundle/build comparison. Existing large client pages are a pre-existing constraint, not a reason to put resolver/editor logic in page roots.

## Migration & Backward Compatibility

No migration or new dependency. Unconfigured helper callers retain the exact default terminal set and canonical values. Existing constant exports retain their shapes as default-only compatibility snapshots; request consumers use the resolved vocabulary. Existing routes, event IDs, outcome enums and signatures are not removed or narrowed. Dictionary labels and configured statuses are separate. Reset and undo reverse the setting through the same conflict and impact-confirmation flow.

The SQL summary currently counts literal `win` but not historical `won` without `closureOutcome`; parameterized alias groups correct that inconsistency. Disclose this reader-consistency correction in implementation release notes and regression tests; it requires no row rewrite and preserves existing outcome predicates and open/time-window rules.

Document `OM_CUSTOMERS_DEAL_STATUS_VOCABULARY` JSON, precedence, canonical first entries, historical aliases, reset and confirmation in module/operator docs. Add the example to `apps/mercato/.env.example`, run `yarn template:sync:fix`, and commit mirrored `packages/create-app/template/.env.example` in #7625. Env/template files are not changed by this design PR.

## Edge Cases and Failure Scenarios

Reject empty groups, duplicate assignments and collisions with reserved active/historical tokens. Invalid env JSON falls back to built-ins; malformed tenant data falls back to env. Missing optional config service falls back to env/default, but database failures are not hidden. Instance rows never shadow env/default. Concurrent updates return the standard 409 conflict; stale impact confirmations return their distinct response. Config writes and undo invalidate the existing service cache and dependent browser queries.

## Risks & Impact Review

| Concrete failure scenario | Severity | Affected area | Mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| SQL or a company/person fallback misses a tenant alias, making KPIs disagree | High | Summary SQL, APIs, browser KPIs, dashboard | Exhaustive inventory, parameterized SQL groups and shared override fixtures across readers | Future consumers can bypass helpers; repeat the search at implementation review. |
| Removing/reassigning an alias or resetting silently makes stored deals open | High | Stored-deal reporting/settings | Server count and candidate/version/impact-bound confirmation for save/reset/undo | Deals can change after the final snapshot; the count is observed, not a permanent population guarantee. No row is rewritten. |
| Instance or previous-tenant data is used | High | Tenant isolation | `source === 'tenant'`, authenticated scope, tenant/organization query keys and scope-switch tests | Config/cache availability remains a dependency. |
| Partial organization access reveals counts or changes unseen organizations | High | Settings authorization | Deny partial-scope tenant-wide writes before calculating impact; no IDs/titles returned | Authorized tenant-wide operators can intentionally affect all organizations after confirmation. |
| Two editors save/confirm stale data | Medium | Config/editor | Existing lock header plus recomputed fingerprint; clear confirmation on candidate/scope change | Operators must reload/reconfirm after conflict. |
| Malformed config or DB outage produces inconsistent fallback | Medium | Resolver/browser | Validate levels; invalid values fall through, infrastructure errors surface, stale scope data is not rendered | Invalid env configuration uses built-ins until corrected. |
| Recognizing historical `won` increases previously undercounted SQL totals | Medium | Won totals/win-rate series | Explicit consistency correction, regression fixtures and release-note disclosure | Reports may increase without stored-row changes. |

## Integration Coverage

Implementation PR #7625 must ship self-contained fixtures, including an override such as won `['signed']`, lost `['declined']`, closed `['archived']`; custom rows without `closureOutcome`, historical aliases, active/unknown statuses and explicit-outcome rows. Create fixtures through APIs where possible and remove them in finally; do not depend on seeds.

| Path / surface | Required assertions |
| --- | --- |
| Settings GET/PUT/reset and undo | Explicit ACL denial, partial-organization denial, invalid input, tenant isolation, instance row ignored, env/default precedence, reset version, mutation guards and optimistic-lock conflict. |
| Reclassification flow | Removing `signed` reports count and writes nothing; confirm applies the candidate; changed candidate/version/impact groups refresh confirmation. Cover reassignment, newly terminal unknowns, reset, undo, zero-impact changes, cancel, and no IDs/titles in errors. |
| `/api/customers/deals` plain/advanced filters, `/aggregate`, `/map` | Custom/historical alias agreement, closed-all-terminal, map search/intersection and tenant/organization scope. |
| `/api/customers/deals/summary` | `signed`/`declined` contribute correctly to won values, quarter counts and monthly win rates; `archived` contributes to neither outcome. Test historical `won`, explicit outcomes, parameter binding, deleted/organization scope and unchanged explicit open/overdue/date rules. |
| `/api/customers/companies/:id`, `/api/customers/people/:id/companies/enriched` | Same override fixtures produce correct active counts/values and won counts/values; preserve historical aliases and each reader's existing outcome contract. |
| Deal commands and approved AI mutation | Preferred spellings, closure-stage lookup, won/lost events, reopen and stable enum; pending-action approval remains required. |
| Company/person detail UI | Verify `CompanyKpiBar`, `ActiveDealCard` and dashboard helper totals/trends under overrides, including local fallback when API KPIs are absent. |
| Settings, deal list/detail and Kanban UI | Hydration, save/reset confirmation/conflict, canonical selection/actions, badges, QuickDealDialog, stage recognition and tenant switching without stale vocabulary. |
| Linking picker / dashboard pipeline-summary | Custom aliases give correct filters and open/all totals; preserve `closureOutcome is_null`, lazy loading and unknown-active behavior. |

Unit tests cover unchanged helper defaults/export shapes, env/tenant precedence, ignored instance rows, invalid config, aliases, fingerprints, SQL predicates and simultaneous tenant resolution. Run the ordered implementation validation gate and focused tests, then independent review and live UI verification. Record unavailable validation/environment limitations. This documentation PR runs only documentation-applicable checks and manual diff review.

## Resolved assumptions (autonomous defaults)

- Keep `win` as the default won spelling to preserve current contracts; accept `won` for historical reads and normalize new AI writes.
- Retain built-in historical aliases under overrides; require confirmation before reclassifying custom persisted statuses.
- Use existing tenant settings storage and Deal settings UI; avoid schema changes or a new configuration subsystem.
- Pipeline-stage label lookup retains its existing English compatibility aliases and additionally recognizes configured status tokens; explicit stage semantic metadata is separate scope.

## Final Compliance Report

| Requirement | Design evidence / implementation gate |
| --- | --- |
| Required spec structure | Overview, Problem Statement, Architecture, Data Models, API Contracts, concrete risk records and this report are present. |
| Tenant/organization isolation and RBAC | Authenticated scope, named existing ACLs, source rejection, full-scope writes and integration assertions. |
| Compatibility | Additive helper arguments, retained exports/defaults/events/outcomes/historical aliases; SQL consistency correction disclosed. |
| Mutation mechanisms | Guarded undoable command, lock header, confirmed reclassification, shared UI/API helpers and invalidation. |
| UI, i18n and performance | Existing leaf boundaries, shared tokens/primitives, localized confirmation, budgets and evidence plan. |
| Coverage and operator docs | Consumer-by-consumer integration table and env/create-app parity work required in #7625. |
| Completion evidence | Review remediation changes design only. Runtime tests, full gates, screenshots and deployment remain pending in #7625; do not move this spec to `implemented/`. |

## Changelog

- 2026-10-18: Initial design for issue #5546.
- 2026-10-25: Address PR #7624 review with consumer inventory/coverage, required sections, persisted-deal confirmation, explicit ACL/source handling and env/template wiring. Implementation remains in #7625.

## Research

HubSpot likewise keeps configurable stage names separate from Won/Lost reporting semantics ([official pipeline documentation](https://knowledge.hubspot.com/object-settings/set-up-and-customize-pipelines)). This feature applies that separation to existing status aliases without introducing a stage-model redesign.

## Implementation Plan

### Phase 1: Configuration and semantics

1. Define/validate vocabulary and tenant/environment/default resolution, explicit instance-source rejection and compatibility aliases.
2. Add the guarded undoable command and GET/PUT contract with ACL/full-scope authorization, optimistic locking and reclassification confirmation for save/reset/undo.
3. Connect every server consumer in the inventory, including parameterized summary SQL, company/person KPI readers, closure commands and AI projections; test preserved outcome/scope rules.

### Phase 2: Browser consumers and verification

4. Add editor/confirmation and supply scoped vocabulary to every browser consumer in the inventory, including company/person fallback KPIs, Kanban/detail writers, linking filters and dashboard widget.
5. Ship the coverage table; document operator configuration, SQL consistency correction and compatibility; wire the env example and mirror it via `yarn template:sync:fix`.
6. Run ordered implementation validation, independent review, client-boundary/performance evidence and UI verification; update implementation PR #7625. This design PR does not execute these implementation phases.
