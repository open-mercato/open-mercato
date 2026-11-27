# Relation option authorization and explicit global query scope (#9106)

## TLDR

Relation labels are record reads: the metadata permission alone must not expose system credentials or bypass target entity permissions. Both query engines must reject implicitly global base-table reads.

## Overview and problem statement

`GET /api/entities/relations/options` accepted any registered ORM entity and arbitrary client label fields. It could project and decrypt secrets. Base tables without tenant and organization columns received no isolation predicates from either query engine.

## Proposed solution and architecture

Reuse `classifyRecordsEntity` and `assertEntityAclForRequest`. Reject platform-only and undeclared system targets, require `entities.records.view` for every custom target, and enforce mapped target view grants and additional restricted custom-entity grants before querying data. Declared ORM entities without a mapped requirement retain the existing ACL helper's superadmin fallback; declaration is not a substitute for authorization. Unknown/unresolvable ids retain the empty-list behavior.

Labels may use a trusted module `ce.ts` label, a scoped custom entity's configured label, or fixed `name`, `title`, `code`, `email`, `id` candidates. Trusted camelCase labels also accept their snake_case storage spelling. System labels cannot be overridden with a mutable custom-entity row. Custom registration precedence is organization, tenant, instance. Third-party declared labels remain supported subject to existing target ACL. Route-context fields retain their existing fixed allowlist. Results are capped at 100.

For ORM records, resolve allowed selectors to their actual column using registered metadata. Use the next available safe label when a declaration names a missing column. Projection and search use the same resolved column.

Relation lookup resolves the trusted request organization scope once. Classification, label-definition lookup, target ACL and record queries use that same effective tenant and selected organization. Rejected or explicitly empty scopes fail closed. A resolved finite scope without a selected organization retains its allowed organization filters. The existing resolver controls all-organization selection, including its home-organization behavior for restricted principals.

Basic and hybrid base-table paths refuse tables with neither `tenant_id` nor `organization_id`, before business reads, coverage or decryption. The existing `omitAutomaticTenantOrgScope: true` is the explicit opt-in; hybrid retains its established basic-engine delegation for this flag. Custom document storage keeps its existing tenant isolation. No new query option, dependency or configuration is required.

Relation lookup requires a record policy for attachments and for Staff time entries, projects, tasks, and reports. It identifies these targets by their registered ORM table and requires the canonical entity ID. Time-entry lookup applies the Staff self-scope interceptor and project-access filters. Attachment lookup authorizes metadata for tenant- and organization-scoped IDs before searching or projecting their labels. Both paths use explicit tenant and organization predicates. Staff project, task, and report lookups return 403 until they have an owning relation policy.

## Data models

No schema or entity changes.

## API contracts

Same route, method, parameter names and `{ items: [{ value, label, routeContext? }] }` response. Target authorization failures return 403; unsafe labels return 400. Unknown ids return an empty list. Permitted declared labels remain usable.

## Relation-field feedback

The existing CrudForm relation selector distinguishes loading, empty results and failed authorization/transport requests. A localized retry keeps unrelated draft values and the selected relation intact. Replacing a scoped loader invalidates its rendered options; late responses from a prior loader do not replace current options. Single-select popups remain within the available viewport and wrap long option labels. Existing field/primitive APIs and successful save behavior are unchanged.

## Migration & Backward Compatibility

This is the security tightening requested by #9106. Unsafe arbitrary-column reads and implicit global-table reads cease. No route, HTTP method, response field, signature, import path or entity is removed. Clients should omit `labelField` or select an authorized declared/fixed label, and hold the target's existing read grant. Operators should review metadata-only roles that previously depended on excessive access. Trusted internal global-query callers must explicitly use the existing scope opt-out and encode visibility in filters; do not expose that flag to request parameters. No bridge preserves the vulnerable reads. The dated compatibility entry and upgrade notes document the security exception; named human-maintainer acknowledgment remains required before merge.

## Integration coverage

- Focused route tests: sensitive/undeclared/platform targets, own-view denial, restricted custom ACL, unsafe fields, scoped queries, safe route context, unknown ids and third-party labels.
- The relation HTTP security scenario checks denial for Staff projects, tasks, and reports with their module view grants. Focused tests also cover missing owner policies and declared aliases of protected tables.
- `TC-ENTITIES-9106-owner-policies.spec.ts` exercises the registered Staff and Attachments policies. It checks that staff readers see their own time entries and attachment readers see library files and documents they can access.
- `global-scope.pg.test.ts`, gated by the existing `OM_COUNT_CAP_PG_URL` throwaway-database convention: both real SQL engines reject global reads by default, accept explicit opt-out, and exclude a second tenant's labels.
- `TC-ENTITIES-9106-relation-options-security.spec.ts`: self-created metadata-only role/user and custom entity/record, real authentication, system/feature denial, permitted labels and unsafe field rejection, with teardown. Requires a running test app; execution status belongs to validation evidence.
- The same spec creates a product and a portal user and checks the default label, the existing configured selector, and name search through the relation-options API.
- `TC-ENTITIES-9106-selected-organization.spec.ts`: self-created organizations, actors, grants, definitions and records verify home/selected organization controls, finite all-organization results and rejected selection, with teardown.

- UI unit coverage: loading/403 retry preserves draft and relation values; valid empty results remain distinct; a superseded loader cannot overwrite new feedback. Remote relation paging rejects failures without publishing a partial list.

## Risks & impact review

Implicit global callers now fail instead of reading all tenants. Explicit opt-out preserves intentional trusted global use, with existing caller-owned visibility obligations. Declared ORM targets without mapped read requirements remain limited by the existing superadmin fallback; module declarations do not create a new implicit grant. Global entities cannot be exposed by this generic endpoint. At-rest encryption is not read authorization; ACL must precede query/decryption.

## Final compliance report

Uses existing classification, ACL, encryption read helpers and scope controls. No migrations, dependencies or configuration changes. Staff and Attachments register their own relation-read policies without a dependency from Entities on either module. Runtime integration and full-gate results are recorded in PR evidence; manual QA and independent parent review are not asserted here.

## Changelog

- 2026-11-24: Require owning record policy for each protected relation target and deny Staff project, task, and report options while their policies are unavailable.

- 2026-11-24: Apply owner record-read policies to time-entry and attachment labels. Cover missing policy, Staff filters and attachment owner denial in focused tests.
- 2026-11-20: Repair inherited QA F1 by sharing the existing trusted request organization scope across relation classification, target ACL, definition lookup and data reads. Add focused denied/empty/finite-scope regressions and native HTTP coverage; preserve named compatibility acceptance and personal protected QA requirements.

- 2026-11-16: Added #9106 security fix design, migration guidance and regression/integration coverage. Custom relation labels require record-read access in addition to metadata access, with separate metadata-only denial and authorized-reader controls.

- 2026-11-16: Addressed inherited browser feedback for visible relation lookup states, draft-preserving retry, stale loader isolation and narrow long-label layout.
