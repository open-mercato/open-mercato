# CRM notes and activity rollup

Extends: .ai/specs/implemented/SPEC-046-2026-02-25-customer-detail-pages-v2.md
Extends: .ai/specs/2026-08-25-crm-channel-shared-visibility.md

## TLDR

CRM operators migrating deal history need to see deal notes and activities on the linked person and company profiles. The current lists filter by the record where each item was saved. This proposal adds an opt-in related-record view of the original items.

## Open Questions

1. ⚠ NEEDS HUMAN CONFIRMATION. Should Notes and Activity History ship together under #4332 or as two deliveries that share the relationship and permission logic? Independent review identified that each surface can deliver value on its own. The combined plan below is available for review while the delivery decision is open.

## Resolved assumptions (autonomous defaults)

| Decision | Default and rationale |
| --- | --- |
| How to resolve relationships | Resolve live relationships when reading. Previously saved records become discoverable immediately, and unlinking removes the related entry on the next read. |
| Access and editing | Require access to the target profile and the originating record type. Show inherited items as read-only on the receiving profile and preserve canonical edit and undo at the source. |
| Company traversal | Follow explicit deal-company links and active person-company membership for people on the deal. Stop after reaching the receiving company. |

## Problem Statement

A note or activity entered on a deal requires opening the deal again to find it, even when the reader is already working in an associated customer profile. The person and company profiles also lack a dedicated comments-backed Notes tab. This makes historical notes easy to miss during a migration.

The v2 detail-pages spec lists a Notes-tab test, but its implementation leaves notes in the inline profile fields and deal page. The comments list filters only by `entity_id` and `deal_id`, while canonical interactions already accept typed `person`, `company` and `deal` link entries and return them without using them for profile membership. See [issue #4332](https://github.com/open-mercato/open-mercato/issues/4332).

## Proposed Solution

Open the Notes or Activity History panel on a person or company to find the original items recorded there and those associated through a related deal. Explicit person/company links on canonical activities count as an association on that record. Matching two relationships still produces a single row. Use the live CRM graph and existing JSON link keys, so there is no duplicate persistence or synchronization on edit, delete or undo.

Pipedrive documents deal-to-contact and deal-to-organization activity visibility and requires access to linked items. SuiteCRM shows activity and history panels on contact records and uses a concrete parent for item ownership. The design follows these product patterns using Open Mercato's existing original records and permissions.

- [Pipedrive Activities](https://support.pipedrive.com/en/article/activities)
- [SuiteCRM Contacts](https://docs.suitecrm.com/8.x/user/sales-relationships/contacts/)

## 📝 Delta

### Capability: crm-related-notes-and-activities

#### ADDED Requirement: Related CRM lists

The system SHALL list an original note or activity once for an eligible person or company when the record is directly anchored or a current authorized relationship qualifies it.

##### Scenario: Multiple relationships lead to the same item

- WHEN an activity belongs to a deal and explicitly links the person on that deal
- THEN the related person list returns one row with the original ID

##### Scenario: Access or relationship ends

- WHEN the originating deal becomes inaccessible, deleted, or unlinked and no independent path qualifies
- THEN that deal's item is absent from related results and counts

#### ADDED Requirement: Related notes on customer profiles

The system SHALL show directly anchored and permitted related comments in the Notes tab of person and company v2 profiles.

##### Scenario: Read a deal note from a company

- WHEN a user who can read the company, deal, and comments opens the company Notes tab
- THEN a qualifying deal note shows its source and remains editable from the deal

#### MODIFIED Requirement: Customer profile activity history

The system SHALL show canonical activities matching the profile's authorized related-record scope, and the filters shall use counts from the same scope.

##### Scenario: Browse a related deal activity

- WHEN a user opens the activity history for a linked profile and chooses an activity type
- THEN the list and count both include matching authorized deal activities, with inherited rows shown for reading

Frozen by: `packages/core/src/modules/customers/__integration__/TC-CRM-4332-related-history.spec.ts`

## Architecture

- Keep the work in `customers`. Resolve a live target `CustomerEntity` of kind person or company from the request tenant and allowed organizations. Use the target's organization for every relationship and row match. Missing or inaccessible targets return an empty result through the existing envelope.
- A person matches deals on `customer_deal_people`. A company matches `customer_deal_companies` and deals through a person on a currently active `customer_person_company_links` relationship. Include live, same-tenant, same-organization deals, people and company memberships only. Deal matches require `customers.deals.view` and the company membership path additionally requires `customers.people.view`, evaluated in the target organization.
- A related activity may match an explicit typed person or company link for the target. Require a scoped live source entity and permission to view that source's record kind. Treat activities carrying a deal ID as deal history and require permission to view the scoped deal for any inherited match. Ignore non-CRM linked entity types and require both ID and type to match.
- Apply these alternatives as a union predicate before pagination, counting, encrypted candidate processing and decryption. Keep the existing email visibility predicate mandatory for every match. A relationship is never a conversation share or a grant to read an underlying record. Use existing wildcard-aware authorization and the standard request-scope helpers.
- Keep comments on `makeCrudRoute` and apply the related predicate through its list filtering mechanisms. Disable the CRUD list cache for related comment requests so membership and permissions are evaluated live. Preserve cache behavior for exact reads. Share the interaction matching predicate between the canonical list and its counts route. Preserve native row keys, pagination, and count envelopes.
- Use fixed, indexed relation lookups with bound SQL parameters and no per-row network requests. Use live record predicates for link and source checks. Measure the related query against contacts with many deals and verify related pagination across pages. Use a containment predicate over JSON links if it can use an index. Add a scoped index and snapshot migration if measurements show an unacceptable scan. The baseline proposal adds no mandatory migration or backfill.
- Reuse the request's authenticated actor, resolved organization scope and DI container for the target check and permission lookup. Batch relationship matching in each list/count query. The related route should add a fixed number of setup reads independent of the page size.

## Data Models

The read mode uses `customer_comments.entity_id` and `deal_id`, `customer_interactions.entity_id`, `deal_id` and `linked_entities`, and the existing CRM links. It creates no columns, tables, events, or new data copies. Notes and activity content retain the existing encryption and decryption paths. The matching query reads IDs, kind, lifecycle state, and scope, never labels from the JSON payload.

## API Contracts

| GET route | Additive parameter | Behavior |
| --- | --- | --- |
| `/api/customers/comments` | `scope=related` with UUID `entityId` | Select direct comments and comments on authorized related deals. Preserve offset pagination and response shape. |
| `/api/customers/interactions` | `scope=related` with UUID `entityId` | Select direct interactions, qualifying deal interactions, and scoped typed links. Preserve cursor/sort/filter behavior. |
| `/api/customers/interactions/counts` | `scope=related` with UUID `entityId` | Count the same eligible canonical rows, subject to the route's status filter. |

Requests without `scope=related` retain their current behavior. Rollup requires an explicit target. An explicitly supplied additional `dealId`, status, type, or date constraint is applied as an AND. Validate with the existing Zod and OpenAPI schemas. Preserve existing route-level authentication and required read feature. Use the established validation and server-error responses.

## UI/UX

Add a permission-gated Notes tab to each v2 profile using the existing NotesSection and customer notes adapter. Use related reads for both the first page and load more. A user with notes management can use the existing guarded composer on the current profile. Hide mutation controls on inherited notes while showing the source deal label using the existing comment summary. Keep the original record and its optimistic-lock version as the only mutation target.

Extend the two v2 canonical Activity History views and their type counts with the same related scope. Keep filters, cursor loading, and the existing loading, empty and failure states. An inherited activity has no edit or delete controls on the receiving profile. Legacy activity views, planners, calendar, recency and unrelated counters retain their current queries.

Existing client pages and detail panels own tab state and authenticated HTTP calls. API handlers own relationship and authorization logic. Reuse shared components, lazy tab fetching, translated copy, and semantic tokens. Verify keyboard tab navigation, long text, narrow viewport, and a missing activity-read feature. No new provider or client-side relationship fetch is needed.

## Migration & Backward Compatibility

This is an additive opt-in GET parameter. Existing API callers, history records, mutations, imports and notification events retain their semantics. A rollback removes the new read mode and UI consumption without a data rewrite. Existing typed links and deal references begin to qualify when they are in scope. Source relationship changes apply on the next read.

## Edge Cases & Failure Scenarios

- Multiple matches, expired person-company memberships, soft-deleted records, and links to another organization never create duplicate or out-of-scope rows.
- Requests by read-only viewers retain scrolling and pagination. A private email must satisfy the existing owner/share predicate even where multiple CRM paths match it.
- Passing the target record with the wrong link type does not qualify. A deal may lose all participant links while the source history remains available on the deal to authorized users.
- Report a relationship-query or list failure through existing error handling. Use a visible retry/error state in UI. Do not treat a failed authorization lookup as a grant.

## Risks & Impact Review

| Severity | Failure | Mitigation and residual risk |
| --- | --- | --- |
| High | An expanded list exposes a row or count from an unavailable organization or private email. | Scope every step and require source read permissions. Apply email authorization before counting and paging. Cover cross-organization, denied-source, and private-email cases. |
| Medium | A stale cached list shows a deal after unlinking. | Exclude related comments from list caching, and evaluate current relationships on each request. The already-rendered view updates on its next refresh. |
| Medium | Contacts linked to many deals increase read cost. | Use indexed relation keys, set-based predicates and existing pagination. Verify expected query plans before broadening deployment. |

## Integration Test Coverage

Use self-contained fixtures for a company, two people, a deal, direct and inherited comments, and canonical activities. Validate both related list APIs and interaction counts, with duplicate paths, exact reads, filtered/paginated reads, unlink or soft delete, and permissions. Include a limited role and an organization outside its scope. Exercise private email through the existing visibility test fixtures. Cover Notes and Activity History on both v2 routes, including inherited read-only rows and a normal directly anchored note. Delete test fixtures in teardown.

## Implementation Plan

### Phase 1 — Authorized related reads

1. Characterize the shipped profile timeline with fixtures, and pin exact API behavior for callers without the opt-in.
2. Resolve the scoped target, live deal paths, and source permissions with shared customer query logic. Verify scoped and unlinked relationships.
3. Extend comments and canonical interactions with the opt-in, then apply the matching predicate to interaction counts. Test paging, link deduplication and denied visibility.

### Phase 2 — Profile panels

4. Add permission-gated Notes tabs to person and company v2, and wire related notes pagination through the existing adapter. Keep inherited mutation controls hidden.
5. Enable related reads for canonical Activity History and its counts on both profiles. Exercise profile flows and run targeted API and UI integration coverage.
6. Archive the Delta into `.ai/specs/capabilities/crm-related-notes-and-activities.md`. Run the configured validation gate and inspect the affected screens through the shared browser setup.

## Final Compliance Report

The proposal uses customer module ownership, scoped read queries, existing authorization and encryption, canonical CRUD and UI primitives, and additive request contracts. No new mutation or data migration is required for the baseline. Specification approval is pending the delivery decision.

## Changelog

- 2026-11-25 — Proposed scoped CRM related-record reads and profile panels for #4332.
- 2026-11-25 — Independent scope review found Notes and Activity History can ship independently. Recorded the delivery decision for maintainer review.
