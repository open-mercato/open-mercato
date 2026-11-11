# CRM interaction recency

**Date:** 2026-10-22 · **Status:** Draft · **Issue:** [#7700](https://github.com/open-mercato/open-mercato/issues/7700)

## 📝 TLDR

Show when a person, company or deal was last contacted using the latest completed call, email or meeting visible to the current viewer. Compute the value from canonical interactions at read time so reopening, deleting, relinking, editing occurrence time and undo immediately produce the correct result. Do not count notes/tasks, substitute record modification time, or disclose the occurrence of private email through a globally shared timestamp.

## Resolved assumptions (autonomous defaults)

| ID | Question | Default and rationale |
|---|---|---|
| R1 | Does recency include private emails the caller cannot read? | No. Use exactly the existing interaction visibility policy, including author, conversation-share and shared-channel access. Privacy cannot be weakened by aggregation. |
| R2 | Does the computed field require a physical column? | No. Add a nullable computed API field backed by a batched query. One persisted value cannot represent different viewers' authorized sets. |
| R3 | Are filtering and sorting required in Phase 1? | Display and export only. The issue requests a computed timestamp, not recency segmentation; a sortable/filterable projection is a separately designed extension. No page-local sorting that pretends to be global. |
| R4 | What counts as completed? | Canonical `done` and defensive legacy `completed`, with real `occurredAt`; canceled, planned, custom-open and undated rows never count. |
| R5 | Do indirectly related interactions count? | No. Person/company uses exact `entityId`; deal uses exact `dealId`. Participants, linkedEntities JSON, company memberships and hierarchy do not imply contact. |
| R6 | What about legacy activity tables? | Read canonical `CustomerInteraction` only. Existing activity/todo command bridges already write canonical rows. Do not infer completion from an API compatibility projection that substitutes scheduled time. |

## 📝 Overview and Problem Statement

At audited HEAD `0c886d0a14c02106ff2abc9728be36c04c5a2ccd`, `CustomerInteraction` has `status`, `occurredAt`, `scheduledAt`, `entity` and nullable `dealId`; customer entities/deals have no last-contacted field. `interactionStatus.ts` distinguishes open/terminal status, but its terminal set includes canceled. `mapInteractionRecordToActivitySummary` can substitute `scheduledAt` for missing `occurredAt`; that display adapter is not evidence that a contact happened.

HubSpot's [contact property documentation](https://knowledge.hubspot.com/properties/hubspots-default-contact-properties) separates last contacted, last activity and last modified. A [community report about modification timestamps](https://community.hubspot.com/t/reporting-on-last-modified-and-updates/102345) illustrates how routine workflow updates make modification time an unreliable proxy for the business event someone wants to report. These sources support separating meanings; the exact qualifying types here come from #7700.

As a rep, I need a correct last-contact date alongside the next planned interaction. As an email owner, I need hidden correspondence to remain hidden even when colleagues view contact summaries. As an operator correcting a wrongly linked meeting, I need both affected records' dates to reflect the correction immediately.

## 📝 Proposed Solution

Introduce one customers-local batch query service/helper used by list/detail response composition. Its input is validated entity or deal IDs plus trusted tenant/org/viewer context; its output is a map of ID to nullable ISO timestamp. It selects no titles, bodies, addresses, recipients or other message content. APIs enrich their normal authorized records after shared caching and ordinary pagination.

The query computes `MAX(occurred_at)` over records satisfying all of:

1. Same trusted tenant and permitted organization, `deleted_at IS NULL`.
2. `interaction_type IN ('call','email','meeting')`.
3. `status IN ('done','completed')`; do not call the broader terminal-status helper.
4. `occurred_at IS NOT NULL AND occurred_at <= requestNow`.
5. Exact requested `entity_id` or `deal_id` association.
6. The existing authorized email visibility predicate, including current conversation-share and shared-mailbox grants.

Use one captured UTC `requestNow` for the whole response; date rendering uses the user's locale/timezone. Future-dated completed records remain excluded until their recorded occurrence time is reached or corrected. This does not tighten existing interaction-write validation or rewrite old records. Null means no qualifying contact visible to this caller, not a claim that the business has never contacted the customer.

Rejected alternatives: updating a stored global maximum can expose private mail and becomes wrong on delete/reopen/relink; relying only on `customers.interaction.completed` misses imported already-completed rows, general PUT, direct integration writes and undo; an event-maintained per-user projection multiplies privacy invalidation and storage. Read-time aggregation is the smallest correct first release.

## 📝 Architecture

All domain code stays in customers, primarily a new `lib/interactionRecency.ts` plus existing route response composition. Reuse `applyEmailVisibilityFilter`, conversation-share loaders, shared-channel visibility resolution, feature-policy authorization, and trusted organization-scope resolution. API keys have no personal author bypass. The reserved `customers.email.view_private` feature remains inert; no admin bypass is introduced.

For callers lacking `customers.interactions.view`, recency is `null` and the UI hides the field. Existing person/company/deal view permissions still authorize the surrounding record. This additional read check never blocks an otherwise authorized parent record response. A wildcard-aware feature helper is mandatory. All-org selections partition the IDs by authorized organization and apply the exact scope, not the actor's arbitrary default organization.

The batch is bounded to the route page/export batch (maximum 100 IDs). Group by parent ID in SQL, reuse request-local share/grant resolution, and return `null` for IDs without qualifying rows. No N+1 loop and no ORM load of every interaction. Parent existence/access is established by the caller's regular record read before invoking the helper. Bind parameters; never interpolate identifiers or values from request text.

Privacy must be applied before `MAX`, not after taking the newest row. Otherwise a hidden newest email can mask an older visible meeting or leak its date. Conversation-level grants are resolved for the bounded set of relevant people; deal pages use the same scoped source-person grant semantics as canonical interactions and must not infer a grant merely from company/deal membership.

### Response caching and freshness

No cache of recency is introduced. Compose it after any shared parent payload cache is read, and ensure the cached object is copied before adding the field. Never mutate and re-store a shared cached object with caller-specific data. Detail routes with an early cached-response return must be refactored to route both hit and miss through the same final authorized enrichment. List/export lifecycle hooks must likewise execute this enrichment after cache retrieval; test the real hit path, not only the query helper.

If the existing hook point occurs before serialization/caching, wrap the route's final response composition locally rather than broadening shared factory contracts. Parent responses remain private/no-store at the HTTP boundary for this caller-specific field. Optional future caching must key on principal, scope and live visibility state and requires a separate design; a short TTL alone is not authorization.

The next request reflects committed interaction edits and changed sharing grants. Wire explicit refresh propagation as part of this capability: person/company details currently omit `ActivitiesSection.onDataRefresh`; pass the existing parent detail refetch callback there. Extend the deal `useDealActivities` mutation success path, which currently refreshes activities only, to invoke its parent deal/detail refresh callback. Cover create, completion/status/time/link edits, delete and undo. Reuse existing callbacks/query invalidation and await the authoritative parent refresh; do not optimistically infer recency from the one edited row. Off-page sharing changes become visible on the next record fetch under existing navigation behavior. There is no new event or queue dependency. The [completion-event reliability spec](2026-07-20-customer-interaction-completion-event-reliability.md) is relevant but unimplemented at the baseline; this feature does not assume that it has shipped or that completion events are exactly once.

## 📝 Data Models

| Logical owner | API field | Definition |
|---|---|---|
| Person/company list item | `last_contacted_at` | Nullable ISO-8601 UTC timestamp, computed from authorized exact-entity interactions. |
| Person detail `person` / company detail `company` | `lastContactedAt` | Same computed timestamp and semantics. |
| Deal list/detail | Existing route naming convention: list `last_contacted_at`, detail `deal.lastContactedAt` | Exact `deal_id` contacts only. |

There is no new mutable entity, physical timestamp column, foreign key, default backfill or manual override. Computed metadata is never accepted in POST/PUT payloads; explicitly supplied `lastContactedAt` or `last_contacted_at` is rejected with a translated 400 read-only-field error rather than silently implying it was saved.

Add two partial indexes to canonical interactions: `(tenant_id, organization_id, entity_id, occurred_at DESC)` and `(tenant_id, organization_id, deal_id, occurred_at DESC)`, each restricted to non-deleted completed (`done`/`completed`) call/email/meeting rows with non-null `occurred_at`; the deal index also requires non-null `deal_id`. Include only stable predicates, not `now()`. Name new indexes uniquely and keep existing ones. Migration and snapshot follow repository tooling; adding a computed field does not fabricate historical events.

Timestamp/status/reference queries select no encrypted content; all parent display-name reads still use decryption helpers. The timestamp itself is personal interaction metadata, so its access matches the underlying interactions. Do not add it to tenant-global search documents, public webhooks, portal APIs, AI tools, or shared analytics as part of this change.

## 📝 API Contracts

Add the fields above to `GET /api/customers/people`, `/companies`, `/deals` and their existing `[id]` detail routes, plus their normal authenticated exports. Keep route URLs, response envelopes, existing fields and CRUD guards unchanged. Update `openApi` schemas with explicit read-only/nullable/date-time documentation and the caller-visible scope statement. List enrichers return one output per input in the original order.

This release adds no filter/sort key. Hide sorting/filter controls for the new column; attempts to use the newly named `sortField=lastContactedAt`/`last_contacted_at` or recency filter keys return translated 400 unsupported-field errors. Existing valid sorting/filtering/counts stay unchanged. Export produces the same caller-visible dates as the corresponding list and cannot bypass recency authorization.

If the aggregate query or visibility lookup fails, return the existing server-error response for that read, not a misleading `null`/older cached date. The frontend uses its normal error/retry state; logging contains sanitized operation/scope diagnostics without contact IDs or email metadata. A catch that records the failure also calls `reportError` under repository policy.

## 📝 UI/UX and Frontend Architecture Contract

Person, company and deal detail summaries display Last contacted next to Next interaction where that concept is present. Render `—` for null, with help text saying that only completed calls, emails and meetings visible to the viewer count. A timestamp is read-only and never makes the form dirty. Lists gain an optional display-only date column, not a default extra required column. Create/edit forms do not add an input.

| Surface / client ledger | Boundary and rationale |
|---|---|
| Existing person/company/deal detail clients | Continue rendering fetched data in existing summary components; no new top-level client root. Existing client roots are retained legacy exceptions. |
| Existing list clients | Add formatted optional column metadata to current `DataTable`; no new stateful root or provider. |
| `LastContactedValue` | Prefer existing date/value renderer; if a leaf is needed, it is stateless and introduces no `use client` directive. |

Use current locale date helpers, semantic text tokens, `LoadingMessage`/`ErrorMessage`, and all five i18n locales. No heavy dependencies, polling loop, new global bootstrap/provider, or custom graph. Route hydration must remain clean. Require `yarn check:client-boundaries`, a production bundle diff with zero new dependency chunks and at most 3 KiB gzip route growth, and a query-profile sample for 100 parents/100,000 interactions. Target at most one aggregate query plus bounded share/channel resolution per response, with warm aggregate p95 below 150 ms on the documented benchmark environment; if exceeded, improve indexes/query shape before enabling the field, rather than caching private results globally.

## 📝 Migration and Backward Compatibility

All fields are additive nullable read results. No existing column is renamed/removed and no historical `updated_at`, scheduled time or task completion is reinterpreted as a contact date. `/api/customers/activities` and deprecated activity command bridges stay functional. Legacy `customer_activities` records that have not been migrated to canonical interactions are not silently assigned a completion status; the existing interaction-unification migration remains their upgrade path, and the UI help/docs disclose canonical-only coverage.

No command's undo payload changes. Update, complete, cancel, delete, restore and relink already mutate the canonical source; the next authorized read recomputes the result. This is also the rollback plan: disable/remove the new enrichment while leaving additive indexes intact. No database migration is applied during the design PR.

## 📝 Edge Cases & Failure Scenarios

Canceled calls with an old `occurredAt` do not count. Completing a task does not count. A completed contact with null time is excluded; `createdAt`, `updatedAt` and `scheduledAt` are never substitutes. A deal's interaction may also advance its explicit person/company entity, but other linked people/companies receive no synthetic contact. Editing the latest timestamp backward can expose the prior maximum. A private email newer than a public meeting is visible only to permitted viewers; API-key/admin access follows the same policy as interaction lists. Changing a shared channel to private removes its hidden date on the next request.

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Timestamp leaks hidden email existence | High | Filter before aggregation; same policy and after-cache enrichment; author/admin/API-key matrix tests. | Viewer-visible timestamps can differ, documented deliberately. |
| Canceled/task/future activity counted | High | Exact type, success-status and occurred-time predicates. | Bad imported metadata may require source correction. |
| Shared cached detail bypasses privacy | High | Hit/miss converge through authorized final enrichment; copy cached objects; no-store HTTP. | Must test actual route wrappers. |
| Large history causes list latency | Medium | Two scoped partial indexes, batched aggregate and benchmark gate. | Recency sorting/segmentation deferred. |
| Operators interpret null as never contacted | Medium | Explicit visible/canonical scope in labels/docs. | Historical legacy-only records need canonical migration. |

## 🧪 Integration and Test Coverage

Every changed GET/list/detail/export route receives self-contained API coverage for the three parent kinds, tenant/org isolation, missing interaction permission, wildcard grants, and same data on cache hit/miss. Assert source types, `done`/`completed`, canceled/planned/custom statuses, null/future/tied dates, no task/note fallback, direct deal linking, and bounded pagination order/count preservation. Reject write attempts and unsupported sort/filter keys.

Privacy fixtures include owner, coworker, admin, API key, conversation share, shared mailbox, private mailbox under the same owner, and a grant/channel privacy change between two cached parent reads. Mutation tests exercise canonical POST as completed, generic PUT, complete/cancel endpoints, delete, relink, occurrence correction and command undo/redo; each must change only the correct parent's next read. Compatibility `/activities` writes are tested through their bridge; legacy rows alone never fabricate completed evidence.

Browser tests load people/companies/deals lists and detail pages, enable the optional column, verify locale formatting/null help and permission hiding, mutate an interaction and observe summary refresh, and exercise query failure/retry. Fixtures are created per test and cleaned up; no seeded data or live email provider is required.

## Final Compliance Report — 2026-10-22

Reviewed root, core/customers, shared, UI/backend, cache/events, QA/specs guides and backward-compatibility contract. Scope is one computed read capability; no cross-module relation or new write model. Tenant/org and existing privacy constraints apply before aggregation; cache hit/miss semantics are explicit; typed API outputs, indexing, standard UI and all affected path tests are covered. No new PII content column or encryption mechanism is introduced. Data/API/UI and undo semantics are consistent. Verdict: ready for design review with R1–R6 surfaced; performance/privacy evidence remains mandatory at implementation.

## Changelog

- 2026-10-22 — Initial autonomous draft; adopted viewer-authorized read-time aggregation to avoid private-email metadata leakage and stale write projections.

## 📋 Phasing and Implementation Plan

1. **Lock semantics with fixtures.** Add a customers-local typed batch query helper and qualifying/visibility matrix tests. Add only the supporting indexes and snapshot; existing endpoints remain unchanged.
2. **Integrate authorized responses.** Extend all six list/detail routes and exports after cache retrieval, update read-only OpenAPI schemas, and verify cache hit/miss, no permission and scope behavior.
3. **Expose read-only UI.** Add detail summary values and optional list columns with i18n, help text and unsupported-sort guard. Run browser hydration, refresh and failure-state tests.
4. **Verify every source mutation.** Exercise direct interaction create/update/action/delete/relink, compatibility bridge, sharing changes and undo/redo; prove no event/queue dependency.
5. **Measure and release.** Run query benchmark and client/bundle evidence, scoped suites and configured gates with selected runner. Publish canonical/visible-only semantics and keep existing contracts intact.
