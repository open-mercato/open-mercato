# Actual deal close dates

Extends: .ai/specs/2026-10-18-deal-status-vocabulary.md
Supersedes: .ai/specs/2026-10-22-crm-deal-closure-integrity.md — sections: close-date rules for terminal-to-terminal changes and historical migration in Proposed Solution and Migration & Backward Compatibility

## TLDR

Sales teams need historical deal reports that survive later edits. Persist the first terminal transition of each closure cycle and use its date for realized reporting. Keep the historical date unknown when the system cannot establish it.

## Overview

This slice implements [#6745](https://github.com/open-mercato/open-mercato/issues/6745). It covers timestamp persistence, filters, analytics and the existing stats display. Stage outcome settings, closure history, manual date corrections and new close or reopen controls belong to separate work. The forecast timeline continues to use its expected close date.

## Problem Statement

The deal stats endpoint derives the close date and sales-cycle length from the last modification. Weekly counts, quarterly rank and summary win/loss metrics also use the modification clock. A seller who updates a title, owner or notes can move an earlier closure into the current reporting period.

## Prior spec drift

- The [closure integrity spec](2026-10-22-crm-deal-closure-integrity.md) proposes outcome-specific stage rules, a stored timestamp and historical estimates. `CustomerDeal` has no stored close timestamp. Its stage history keeps one row per deal and stage, so a replay or later visit can replace the prior event time. #6745 requires unknown historical actual close dates to stay null.
- The [vocabulary spec](2026-10-18-deal-status-vocabulary.md) defines tenant-scoped terminal aliases. `lib/dealStatus.ts` on main uses built-in aliases. [PR #9815](https://github.com/open-mercato/open-mercato/pull/9815) carries the configured resolver and supersedes closed PR #7625. The close-date implementation targets main after #9815 lands. [PR #6760](https://github.com/open-mercato/open-mercato/pull/6760) closed without merging and used a built-in `no_decision` token.

## Resolved assumptions (autonomous defaults)

| Question | Decision | Rationale |
| --- | --- | --- |
| How should stats expose an unknown close date? | Keep the required stats `closedAt` string as a deprecated bridge. Add nullable `actualClosedAt` to stats and nullable `closedAt` to ordinary deal reads. | Existing stats clients continue to parse the response. New consumers can distinguish a stored date from an unknown one. |
| Which configuration defines a terminal deal? | Use the tenant vocabulary from #9815. A token in the `closed` group, such as configured `no_decision`, is terminal with a null outcome. | The same tenant setting governs status handling across commands and reports. |
| Does a terminal-to-terminal correction restart the date? | Keep the first date until an explicit reopen. | A change in outcome classification within a single closure cycle has no new entry into terminal state. |

## Proposed Solution

Capture the time once on the server, alongside the deal's status and outcome change. Clear it on a transition back to active. Preserve the value, including null, on a same-cycle retry or a normal edit. Switch realized reporting windows to the stored timestamp.

## 📝 Delta

### Capability: deal-closure-reporting

#### ADDED Requirement: Actual close date per closure cycle

The system SHALL persist the first terminal timestamp per closure cycle and make it available as a read-only nullable field.

##### Scenario: Close, retry, edit and reopen

- WHEN a deal is created terminal or transitions from active to won, lost or a configured neutral terminal status
- THEN the stored date records that write, and it survives repeated closure requests and unrelated edits
- WHEN the deal reopens and later closes again
- THEN the date clears at reopen and the subsequent close records a fresh date

#### MODIFIED Requirement: Date-based deal outcome reporting

The system SHALL measure realized close periods, rank and sales cycle using the stored date. Terminal rows with an unknown date SHALL be omitted from bounded close-date results and have no sales-cycle duration.

##### Scenario: Historical closure is edited across a reporting boundary

- WHEN a deal closed in the previous reporting period is edited in the current period
- THEN the realized outcome stays in the previous period and the sales-cycle duration stays the same

Frozen by: `packages/core/src/modules/customers/__integration__/TC-CRM-6745-deal-actual-close-date.spec.ts`

## Architecture

- Resolve transitions in `customers.deals.create` and `customers.deals.update` using the effective persisted status and outcome and the deal tenant's vocabulary. Follow the existing command path for REST, AI, bulk and import callers. An explicit won/lost outcome remains a terminal signal. A neutral terminal selection clears any carried won/lost outcome. Unrelated saves and stage-only moves that leave the effective disposition the same preserve the date. Configuration changes alone perform no deal writes. If an administrator reclassifies a status, a previously stored date survives subsequent terminal writes until an explicit reopen.
- Read the prior state under the scoped deal row lock in the same transaction as the status, outcome and date update. Keep existing optimistic version checks and after-commit side effects. Failures roll back the transition. A retry that still finds the deal in a terminal cycle preserves its date, and a stale version is handled through the current conflict path.
- Include the field in undo, delete/restore and replay snapshots. Restore the exact captured date, including explicit null. An older snapshot lacking the field cannot supply a historical date. Where such an undo does not change closure state, preserve a live date. Where it restores a different closure state, restore an unknown date rather than fabricating one.
- Keep list, map and aggregate range predicates aligned, including parameter binding and cache keys. Rotate the cached stats response schema or namespace at cutover and keep existing scoped invalidation for writes and undo.

## Data Models

Add nullable `customer_deals.closed_at` as PostgreSQL `timestamptz`, mapped to `CustomerDeal.closedAt`. The field has no foreign keys. The migration adds the column and a scoped partial index on `(tenant_id, organization_id, closed_at)` for non-deleted rows with a known close date. Confirm the stats and summary query plans with realistic scope sizes. Existing indexes stay available. No reliable historical source is used for the initial migration, so preexisting rows start with null. The deployment does not infer dates from forecasts, modification times or mutable stage snapshots.

## API Contracts

| Surface | Behavior |
| --- | --- |
| `GET /api/customers/deals` and `GET /api/customers/deals/map` | Expose `closed_at` or `closedAt` following each route's existing item casing. Accept optional ISO timestamp bounds `closedAtFrom` and `closedAtTo`. Both bounds are inclusive and either bound excludes null dates. |
| `GET /api/customers/deals/aggregate` | Use the same inclusive range and null behavior and apply the filter before grouping. |
| `GET /api/customers/deals/:id` | Return nullable `closedAt` using the existing deal serializer and tenant and organization guards. |
| `GET /api/customers/deals/:id/stats` | Add nullable `actualClosedAt` as the authoritative value. Every response includes the existing `closedAt` compatibility string, using the stored date when present and the legacy modification timestamp when absent. Compute the same-outcome weekly count and sales cycle with the stored date. Return null rank for a selected deal without a known date inside the ranked quarter. Keep the won/lost stats error contract for deals without a won/lost outcome. |
| `GET /api/customers/deals/summary` | Use the close date for period-based won value, win rate, and won/lost trend queries. Preserve window boundaries and organization and tenant scope. Neutral terminal deals are reachable through date-filtered deal queries and remain outside the win-rate numerator and denominator. |
| Deal query and analytics metadata | Expose the field as a nullable timestamp and allow date filtering and grouping. Keep the default date dimension for existing creation and forecast measures. |
| Deal mutations | No new close-date input. Add Zod validation for range and response fields. Keep existing payloads, permissions, events and response envelopes. |

## UI/UX

The existing won popup reads the new stats field when present. An explicit null uses its unavailable-date display. A legacy API response that omits the field can still render its old value. Existing loss and won dialogs show an unavailable sales-cycle value for unknown dates. The Deals summary uses corrected period metrics through its existing endpoint. This is a data presentation change in existing components with no new route, control or layout.

## Migration & Backward Compatibility

Deploy the additive column before runtime writers and readers. Existing `closureOutcome` remains `won | lost | null`, and `updatedAt` remains the mutation version. Keep the stats `closedAt` compatibility bridge for at least one minor release. Document its deprecation and the difference between unknown dates and legacy modification timestamps in `UPGRADE_NOTES.md`. Roll back application code with the column and known historical values intact.

## Risks & Impact Review

| Risk | Mitigation and remaining effect |
| --- | --- |
| Historical reports shrink at cutover | Document that unknown dates are excluded from period results. Unknown terminal deals stay visible in unbounded reads. |
| Concurrent mutation or old undo replaces a known date | Use the locked, scoped prior row. Test simultaneous close requests, reopen and rollback, delete/restore and snapshots from before migration. |
| Tenant-specific neutral status leaks into won or lost reporting | Use one tenant-scoped resolver for writes and classification. Independently verify another tenant can keep the same raw token active. |
| Mixed-version rollout serves stale results | Apply the column before runtime rollout, version incompatible cached projections, and report the exact merged vocabulary commit in the implementation PR. |

## Integration Coverage

Add `TC-CRM-6745-deal-actual-close-date.spec.ts` under the Customers module. Create and clean up isolated deal, organization and vocabulary fixtures. Cover terminal creation, won/lost/neutral close, reopen/reclose, retries, a non-closure edit spanning a reporting period, historical null rows, list/detail/map/aggregate/summary/stats responses, and unauthorized access. Reclassify a previously terminal alias and verify that edits and later terminal selections preserve a known date until explicit reopen. Exercise the existing won display and Deals summary with a known and unknown date. Reuse existing stage, AI, bulk and undo suites for entry-point regression coverage. Use a disposable migrated database for historical rows and close-date SQL tests, and unit tests with controlled time for date-window edges.

## Research

Odoo's lead model stores a read-only close date, derives the duration from it and preserves the date when a deal moves between won stages. ERPNext's CRM guide defines expected closing as a forecast and treats closing an opportunity as a different workflow. Open Mercato follows that separation and excludes unknown actual dates from realized period calculations. [Odoo CRM model](https://github.com/odoo/odoo/blob/19.0/addons/crm/models/crm_lead.py) · [ERPNext CRM guide](https://docs.frappe.io/erpnext/crm)

## Implementation Plan

### Phase 1 — Persist and report actual closure dates

1. **Characterize existing reporting.** Run a focused integration test showing today's stats and reporting periods follow a subsequent edit. Commit the passing characterization before changing behavior.
2. **Persist timestamp and restore it through undo.** Verify the merged tenant vocabulary contract on main. Add the entity field, migration, snapshot support and scoped transition logic. Validate fault rollback, normal edits and concurrent retries.
3. **Cut over readers.** Add API projections and filters, analytics metadata and period query changes. Update the stats consumers, upgrade notes and integration coverage with the new assertions. Regenerate discovery output and run the configured gates.
4. **Archive the Delta.** Add the realized reporting requirements to `.ai/specs/capabilities/deal-closure-reporting.md` with the merged implementation evidence.

## Final Compliance Report

The design uses the existing customers commands and scoped routes, adds a nullable column, and keeps client writes and optimistic locking on their current contracts. Runtime checks belong to the implementation PR after #9815 lands.

## Changelog

- 2026-11-24. Specify the persisted close date, tenant-configured terminal states, compatibility bridge and reporting cutover for #6745.
