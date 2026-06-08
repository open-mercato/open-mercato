Tracking plan: .ai/runs/2026-05-29-org-scope-fail-open-authorization-hardening/PLAN.md
Status: complete

Closes #2239
Closes #2245

## Goal
Close an OWASP A01 fail-open authorization gap where organization-scope checks were **skipped** instead of **denied** when a restricted (non-super-admin) user has no resolvable current organization. One root cause (*empty allowed-org set ⇒ no check*) on two paths — write/command (#2239) and read/detail (#2245) — fixed via shared fail-closed helpers.

## What Changed
- **`ensureOrganizationScope` (shared, #2239)** rewritten on a new pure predicate `isOrganizationAccessAllowed`. `allowedIds === null` is the *only* unrestricted signal; any array (incl. `[]`) requires membership. The legacy `currentOrg` fallback is preserved **only** when `organizationScope` is entirely absent (Pattern C — load-bearing for ~40 system/worker/checkout/scheduler command contexts).
- **Read-path guard (core/directory, #2245)**: new predicate `isOrganizationReadAccessAllowed`; **10** audited fail-open detail-route guards migrated (people/companies/deals + sub-resources) plus the shared `entity-roles-factory` guard. An empty restricted set now denies instead of skipping. (`check-phone` was already fail-closed and is unchanged.)
- Reusable integration fixtures + `TC-CRM-072` spec (cross-org write deny, allow-path regression, cross-org read deny).
- Spec + pre-implementation analysis under `.ai/specs/`.

## Tests
- **25 unit tests, green**: predicate truth table; `ensureOrganizationScope` (incl. the #2239 vector, allow-path regression, and absent-scope-not-deny); read guard (incl. fail-closed empty set).
- `@open-mercato/shared` + `@open-mercato/core`: build + typecheck clean.
- **Integration `TC-CRM-072.spec.ts`: VALIDATED — `1 passed (56.9s)`** under the coherent ephemeral app+DB harness (`yarn test:integration:ephemeral TC-CRM-072`, Node 24.13.0). Closes the prior dev-DB-vs-fixtures-DB blocker.
- **Full validation gate green (Node 24.13.0)**: `yarn build:packages`, `yarn generate`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test` (20/20 workspaces), `yarn build:app` — all ✓.

## Security impact
Strengthens organization-level access control within a tenant (authorization). Behavioral change: a restricted "floating" user (`auth.orgId = null` + concrete/empty org-visibility ACL) is now denied (403) cross-org reads/writes that previously failed open. Cross-tenant was already blocked by `ensureTenantScope`. No secrets, encryption, or auth-token format changed. `ensureOrganizationScope` signature is unchanged (behavior hardened — permitted security change). Two new helpers are additive.

## Backward Compatibility
No contract surface broken. `ensureOrganizationScope` signature unchanged; new predicates are additive. Behavior tightening is a security fix, documented in the spec's Migration & Compatibility section.

## Completed (this resume)
- ✅ Validated `TC-CRM-072.spec.ts` under `yarn test:integration:ephemeral` — `1 passed`.
- ✅ Full validation gate (`yarn test`, `yarn build:app`) under Node 24.
- Standalone `yarn test:create-app:integration` was environment-blocked (pre-existing `mercato-verdaccio` container name conflict, not a code issue) — justified skip; the only added shared export is an additive internal predicate not used by the create-app template.

## Follow-ups (separate issues, out of scope)
- WHERE-clause scoping of single-record loads.
- Migrate Pattern C user-facing command routes to populate a real `organizationScope`.
- Re-audit `packages/enterprise/**`.

## Progress
See the [Tasks table in the plan](.ai/runs/2026-05-29-org-scope-fail-open-authorization-hardening/PLAN.md) — all rows `done`.
