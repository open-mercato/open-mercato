# CrudForm section adoption rollout

**Scope:** Every form host except the catalog product edit proof
**Status:** Draft follow-up
**Depends on:** `.ai/specs/2026-09-30-catalog-product-form-section-policy.md`

## TLDR

Roll the generic `forms.sections` contract out to every remaining `CrudForm` host after the framework and catalog product edit proof land. This includes other catalog forms. It is deliberately separate from the generic contract so host binding can ship incrementally without turning the framework change into a repository-wide flag day.

The source of truth is the generated merge-head inventory, not the snapshot below. At source SHA `7187041c2`, the repository contains 139 `CrudForm` invocations in 131 production TSX files; 102 invocations in 98 files are grouped, 59 are syntactically hosted, and 43 are unbound. `external/official-modules` was absent and must be scanned whenever present.

## Rollout contract

- Bind only grouped invocations diagnosed as unbound; reuse existing `injectionSpotId`/`entityId`/`entityIds` identities.
- Reusable forms declare finite legal surface entries combining `hostId | null`, `formVariant`, `formOperation`, exact ordered sections, and fact references; generation verifies all callers against one exact entry rather than independent arrays.
- Runtime-varying forms resolve one exact surface entry. Conditional schemas are never unioned.
- Single-mutation field-only forms may use the standard projector. Component groups, derived payloads, delegated submit/delete, multiple calls, or secondary writes require a domain adapter.
- Ungrouped forms remain compatibility-only and bypass the section manifest/readiness path.
- Each host lands with its own unit/integration coverage and may advertise add/hide/replace only after the matching server capabilities resolve.

## Migration waves

| Wave | Hosts | Required work |
|---|---|---|
| 0 — remaining catalog | Category and price forms; product-variant create/edit; compound product create | Reuse existing hosts, declare create/edit variants, and keep product create ineligible until its adapter covers attachment transfer, conversions, variants, prices, inbox completion, and cleanup. |
| 1 — simple CRUD | API keys; availability policies; currencies/exchange rates; devices; directory; customer groups; feature toggles; scheduler; webhooks | Add stable host/operation ids, distinguish create/update only when ownership differs, and verify standard projection behavior. |
| 2 — explicit custom adapters | Attachments; auth users/roles; customer-account roles; planner/resources; staff full/compact projects, teams, roles, and members; warranty registration/troubleshooting/vendor policy | Preserve ACL, custom-field, attachment, delegated mutation, partial-success, project self-assignment, and secondary-write semantics in domain descriptors. |
| 3 — customer/sales variants | Customer company/person pages and dialogs; calendar/activity/task/deal forms; sales channels/offers/documents/lines/adjustments/payments/shipments | Declare address/tag/customer/media/price/watcher side writes, order/quote hosts, optional hosted paths, action surfaces, and exact runtime variants. |
| 4 — high-variance editors | Checkout `LinkTemplateForm`; business rules/sets; entity editors; EUDR; warranty claims; workflow edge/node editors; enterprise security | Bind unhosted surfaces; declare checkout link/template mode, dynamic endpoints, preview/publish, attachment transfer and locking; enumerate other component groups and mode/type variants; retain fail-closed diagnostics until every domain capability is implemented. |
| 5 — examples/apps | Todo create/edit; UMES handler demo; app modules and official modules present at merge head | Keep demos explicitly non-mutating where applicable, mirror template-owned files, and prove third-party authoring ergonomics. |

The minimum collision set is: Todo create/edit; auth users/roles; customer company/person page/dialog/quick-create; customer-account roles; business-rule sets; EUDR evidence submissions; both same-page entity editors; staff full/compact projects; sales quote/order documents, lines, and adjustments; warranty claim modes; workflow node types; and DealForm association states.

## Acceptance criteria

1. Regenerated inventory records the audited SHA and contains every production invocation, including official modules when present.
2. Every grouped invocation is either section-ready or has an actionable blocking diagnostic; no dynamic expression is accepted from syntax alone.
3. Every declared runtime variant matches the exact rendered ordered section ids in tests.
4. Every complex host has a domain-owned descriptor/capability pair and preserves its no-policy payload, endpoint selection, side-effect order, and locking behavior.
5. Ungrouped representative forms preserve immediate rendering and submit behavior without manifest/readiness access.
6. Adoption can merge wave by wave; incomplete hosts remain behavior-identical and cannot advertise unsafe overrides.

## Validation

For each wave, run the repository generator and the smallest affected package tests/typecheck first, plus integration tests for every changed API path and key UI path. The final wave reruns the merge-head inventory, standalone harness, template sync where applicable, and the configured add/hide/replace browser fixture.
