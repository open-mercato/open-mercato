# Execution Plan — ACL Dependency Bundles

**Date:** 2026-05-27
**Slug:** acl-dependency-bundles
**Branch:** `feat/acl-dependency-bundles`
**Source comment:** https://github.com/open-mercato/open-mercato/pull/2073#issuecomment (alinadivante QA finding)
**Source spec:** `.ai/specs/2026-05-27-acl-dependency-bundles.md` (created in this run)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Seed run folder (PLAN/HANDOFF/NOTIFY) | done | 50f2129a2 |
| 1 | 1.2 | Write `.ai/specs/2026-05-27-acl-dependency-bundles.md` (audit + per-module dep tables + UI design) | done | b005936ab |
| 2 | 2.1 | Extend `Feature` registry types to carry `dependsOn?: string[]` (no schema change — purely additive) | merged | folded into 2.2 |
| 2 | 2.2 | Add `resolveAclDependencyDiagnostics()` resolver + unit tests in `@open-mercato/shared` | done | ab3abb75e |
| 2 | 2.3 | Forward `dependsOn` through `GET /api/auth/features` | done | d19ad3537 |
| 3 | 3.1 | Declare `dependsOn` for every `customers.*` feature | done | c7d7ac20d |
| 4 | 4.1 | Surface dependency warnings in `AclEditor` (role + user editing both consume) + "auto-add missing" affordance | done | 966f906dc |
| 4 | 4.2 | Unit tests for `AclEditor` warning rendering (jsdom) | merged | folded into 4.1 |
| 5 | 5.1 | Final-gate validation (typecheck + scoped tests + i18n:check-sync) | done | 191ca37b4 |
| 6 | 6.1 | Open PR; file one GitHub issue per remaining module referencing spec + customers reference | done | pending |

Per-module follow-up issues (Phase 6.1):

| # | Module | Issue scope |
|---|--------|-------------|
| 1 | sales | Most urgent — original 2073 finding (sales.orders.view needs channels/settings/statuses deps) |
| 2 | catalog | Product/variant/price-list/inventory dependency tree |
| 3 | auth | Internal: `auth.acl.manage` depends on `auth.roles.list` + `auth.users.list` |
| 4 | configs | Most module pages depend on `configs.manage` indirectly |
| 5 | inbox_ops | Listed by alinadivante as a broken page |
| 6 | customer_accounts (portal) | Portal RBAC parallels admin ACLs |
| 7 | integrations | provider/credentials/health features |
| 8 | data_sync | adapters/runs/mappings deps |
| 9 | workflows | workflow ↔ events ↔ triggers |
| 10 | dashboards | widget visibility depends on owning module |
| 11 | attachments | tied to consuming module (sales/customers) |
| 12 | messages | tied to consuming module |
| 13 | api_keys | self-contained but needs view↔manage pair |
| 14 | audit_logs | view depends on each consuming module's view |
| 15 | notifications | tied to consuming module |
| 16 | perspectives | depends on dictionaries + entities |
| 17 | feature_toggles | self-contained |
| 18 | dictionaries | self-contained but consumed by sales/catalog |
| 19 | business_rules | depends on workflows + entities |
| 20 | translations | needs view↔manage |
| 21 | staff | needs view↔manage |
| 22 | planner | needs view↔manage |
| 23 | shipping_carriers | depends on sales |
| 24 | payment_gateways | depends on sales |
| 25 | webhooks | depends on integrations |
| 26 | scheduler | self-contained |
| 27 | search | self-contained but indexed by other modules |
| 28 | ai_assistant | depends on per-tool modules |
| 29 | checkout | depends on sales + payment_gateways + customers |
| 30 | content | self-contained |
| 31 | onboarding | depends on every module being installed |
| 32 | enterprise/security | enterprise overlay — depends on auth |
| 33 | enterprise/record_locks | enterprise overlay — depends on consuming module |
| 34 | enterprise/sso | depends on auth |
| 35 | gateway_stripe | depends on payment_gateways + sales |
| 36 | storage_s3 | depends on attachments |

## Goal

Stop the silent partial-access UX problem alinadivante surfaced on PR #2073 by letting every feature declare which other features it depends on, and warning the operator *at edit time* when a role/user is being saved with a feature granted while its declared dependencies are missing (or vice versa — when a feature is being removed but other features still selected need it).

## Scope

- **In scope (this PR):**
  - Type the dependency contract: `Feature.dependsOn?: string[]`.
  - Ship the dependency resolver + diagnostics helper in `@open-mercato/shared`.
  - Expose `dependsOn` via `GET /api/auth/features`.
  - Declare dependencies for the `customers` module — the reference module.
  - Wire the warning UX into the shared `AclEditor` so role-edit and user-edit pages both surface diagnostics.
  - Unit tests for the resolver and the editor.
- **Out of scope (one issue per module):**
  - Declaring `dependsOn` for any module other than `customers`. Each is a per-module issue so the work can be done in parallel.
  - Server-side enforcement of dependencies — this PR ships warnings only. Enforcement (rejecting an ACL save that violates dependencies, or auto-inheriting missing deps server-side) is left as an open question for the spec follow-up.

## Non-goals

- No changes to the RBAC runtime (`rbacService`, `hasFeature`, wildcard semantics).
- No DB schema migrations — `dependsOn` is metadata living next to each feature descriptor.
- No backwards-incompatible changes to the ACL save endpoints.
- No changes to how features are seeded into roles (`setup.ts` `defaultRoleFeatures`).
- No changes to portal/customer_accounts ACL surface (separate issue).

## External References

None — this run is driven directly by alinadivante's QA comment, not by an external skill URL.

## Risks

- **Stale dependency declarations.** If a feature is renamed/removed without updating consumers, the diagnostics will silently lie. Mitigation: the resolver returns an `unknown` bucket for `dependsOn` ids that don't resolve to a known feature; warnings naming them surface in dev and in role-edit UI so authors notice.
- **Cross-module hidden coupling.** Some pages call other modules' APIs (e.g. `sales.orders.view` triggers `sales.channels.manage`). Declaring those as hard dependencies makes the system feel more locked down. We default to **warnings, not blocks** — exactly what alinadivante recommended.
- **Wildcard interaction.** A role granted `customers.*` should NOT trip warnings about specific child features. The resolver normalizes the granted set through `hasFeature` (wildcard-aware) before computing missing deps.
- **Customer portal parity.** Portal feature checks share the wildcard semantics but live in `CustomerRbacService`. Out of scope for this PR; spec notes a follow-up.

## Implementation Plan

### Phase 1 — Spec

- **Step 1.1** Seed the run folder with `PLAN.md`, `HANDOFF.md`, `NOTIFY.md`. (this commit)
- **Step 1.2** Author `.ai/specs/2026-05-27-acl-dependency-bundles.md` — captures the audit, dependency declaration DSL, diagnostics contract, UI mockup, BC story, per-module follow-up matrix.

### Phase 2 — Infra

- **Step 2.1** Extend `Feature` shape (the loose `{ id, title, module }` JSON used by `acl.ts`) so adding `dependsOn` is type-checked across the codebase. The added field is optional — every existing `acl.ts` keeps compiling.
- **Step 2.2** Add `resolveAclDependencyDiagnostics(grantedFeatures, allFeatures)` to `@open-mercato/shared/security/aclDependencies.ts`. Returns:
  - `missingDependencies: { feature: string; missing: string[] }[]` — for each granted feature whose deps are not satisfied (wildcard-aware).
  - `removedRequirements: { dependent: string; required: string }[]` — for each NOT-granted feature whose dependents ARE still granted (i.e. an operator deselected a parent but left children selected).
  - `unknownReferences: { feature: string; missing: string[] }[]` — `dependsOn` ids that don't match any registered feature; surfaced as a dev hint.
- **Step 2.3** Forward `dependsOn` through `GET /api/auth/features` and through the OpenAPI schema.

### Phase 3 — Customers declarations

- **Step 3.1** Populate `customers/acl.ts` with `dependsOn` per the spec's customers audit. Intra-module, view↔manage and widget↔owner pairs.

### Phase 4 — UI

- **Step 4.1** In `AclEditor`, render a diagnostics panel above the module grid. Each issue has: severity (warning), naming the affected feature(s), and a one-click "Add missing dependency" / "Remove dependents" affordance.
- **Step 4.2** Unit-test the panel under both shapes (role-edit and user-edit).

### Phase 5 — Validation

- **Step 5.1** Run `yarn typecheck`, the scoped `core` and `ui` jest suites, and `yarn i18n:check-sync`. Skip `yarn test:integration` unless the dev runtime is bootable.

### Phase 6 — Rollout

- **Step 6.1** Open PR. File one GitHub issue per remaining module (table above) with the same template: "Declare `dependsOn` for `<module>.*` features per spec §<module>". Each issue links to the customers PR as reference.
