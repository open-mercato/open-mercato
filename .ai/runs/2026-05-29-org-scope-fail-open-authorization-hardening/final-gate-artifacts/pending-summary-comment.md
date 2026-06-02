## 🤖 `om-auto-continue-pr` — resume summary

**Tracking plan:** `.ai/runs/2026-05-29-org-scope-fail-open-authorization-hardening/PLAN.md`
**Run folder:** `.ai/runs/2026-05-29-org-scope-fail-open-authorization-hardening/`
**Branch:** `fix/org-scope-fail-open-authorization-hardening`
**Resume point:** 3.2 → 3.3 (all Tasks rows now `done`)
**Final status:** complete

### Summary of changes in this resume
This resume was **verification-only** — Phases 1–2 + Step 3.1 (the predicate, the rewritten `ensureOrganizationScope`, the read guard, all 10 migrated detail-route guards, and 25 unit tests) had already landed. No production code changed in this resume.
- Migrated the legacy flat plan (`.ai/runs/<slug>.md`) into a per-spec run folder with a `## Tasks` table, `HANDOFF.md`, and `NOTIFY.md` (`714ea491f`).
- Validated **Step 3.2**: `TC-CRM-072.spec.ts` now passes under a coherent app+DB harness (closing the prior "dev DB ≠ fixtures DB" blocker).
- Completed **Step 3.3**: full validation gate green.
- Files touched in this resume: run-folder docs only (`PLAN.md`, `HANDOFF.md`, `NOTIFY.md`, `final-gate-checks.md`, `final-gate-artifacts/playwright-report-summary.log`).

### External references honored
- Spec `External References` (OWASP ASVS V4 Access Control / Saltzer & Schroeder "fail-safe defaults"; Django object-level perms; Rails Pundit) were already adopted in Phases 1–2 and required no change. Nothing new consulted this resume.

### Verification phases completed (this resume)
- **Checkpoint verification:** `final-gate-checks.md` (+ `final-gate-artifacts/playwright-report-summary.log`). One final checkpoint covering Steps 3.2–3.3.
- **Environment note:** the project requires **Node 24.x**; the default shell was Node 22, which hard-fails `yarn generate` (and cascades `typecheck`). The whole gate was re-run under **Node 24.13.0**.
- **Full validation gate (Node 24.13.0):** `yarn build:packages` ✓, `yarn generate` ✓, `yarn build:packages` ✓, `yarn i18n:check-sync` ✓, `yarn i18n:check-usage` ✓, `yarn typecheck` ✓, `yarn test` ✓ (20/20 workspaces; core 4394, ui 1119, cli 901 + others), `yarn build:app` ✓.
- **Targeted integration (Step 3.2):** `yarn test:integration:ephemeral TC-CRM-072` → **`1 passed (56.9s)`** on a coherent ephemeral stack (ephemeral Postgres `localhost:32769` + app `127.0.0.1:5001`). Asserts WRITE deny (#2239), WRITE allow-path, READ deny (#2245), + admin control read in one test.
- **Standalone integration:** `yarn test:create-app:integration` attempted, **environment-blocked** — Docker container-name conflict on the pre-existing `mercato-verdaccio` container (failed at `registry:publish` before any code ran). Not force-resolved (would tear down the user's running stack). Safe to skip here: the only shared export added is the additive internal predicate `isOrganizationAccessAllowed`, not referenced by the create-app template, so scaffolding behavior is unaffected; `build:app` + unit + targeted integration all pass.
- **ds-guardian pass:** N/A — the diff touches no UI (`*.tsx`) files.
- **Self code-review (`om-code-review`):** no findings — all 10 audited fail-open guards routed through `isOrganizationReadAccessAllowed` (exactly the spec manifest); no leftover `size && !has`; no raw `em.find`/`em.findOne` introduced; predicate pure/typed/`any`-free; shared has no domain imports; scope matches the plan.
- **BC self-review (`BACKWARD_COMPATIBILITY.md`):** no findings — `ensureOrganizationScope(ctx, organizationId)` signature unchanged (behavior hardened — permitted security change); two new helpers additive; no event ID / DI key / ACL feature / route / DB schema / import-path contract broken.
- **`om-auto-review-pr` autofix pass:** could not run — this is a cross-repo PR from a fork with read-only upstream access (no review-verdict/label permission) and the GitHub REST API was failing transiently this session. The lean self-review found nothing actionable, so there are no fixes to apply.

### How to verify
- **Manual smoke test:** create two orgs (A, B) in one tenant; create a person in each. Create a non-super-admin user with org-visibility ACL = `[A]` and `customers.*`, then null their home org (`users.organization_id = NULL`) and log in. With **no** selected org: `PUT /api/customers/people` on the org-B person → **403** (was 200); on the org-A person → **2xx**. With visibility = `[]`: `GET /api/customers/people/{orgB-person}` → **403** (was 200). Super-admin and an in-scope user are unaffected.
- **Areas to spot-check in the diff:** `packages/shared/src/lib/auth/organizationAccess.ts` (predicate truth table), `packages/shared/src/lib/commands/scope.ts` (Pattern C absent-scope fallback preserved), `packages/core/src/modules/directory/utils/organizationScopeGuard.ts` (empty-set ⇒ deny), and the 10 migrated `customers/api/**` guards.
- **Commands the reviewer can re-run** (under **Node 24**): `yarn build:packages && yarn generate && yarn typecheck && yarn test`; targeted: `yarn workspace @open-mercato/shared test` + `yarn workspace @open-mercato/core test`; integration: `yarn test:integration:ephemeral TC-CRM-072`.
- **Rollback plan:** `git revert 5848120d3 13144945d` (the two fix commits) restores prior behavior; the change is pure authorization logic — no DB migration, no data backfill, nothing to reverse.

### What can go wrong (risk analysis)
- **Most likely regression:** over-denial of a legitimate "floating" but correctly-scoped user (`auth.orgId = null` + valid `allowedIds`). Mitigated by the predicate allowing when `organizationId ∈ allowedIds`; the allow-path is asserted by both a unit test and the in-scope leg of `TC-CRM-072`.
- **Second-order effects:** ~30 command call sites use `ensureOrganizationScope` transitively. The Pattern C absent-scope legacy fallback is explicitly preserved (and unit-tested) so payment/scheduled-command/worker flows that construct `organizationScope: null` are unchanged. No events/subscribers touched.
- **Tenant/isolation risks:** strengthens org isolation **within** a tenant; cross-tenant was already blocked by `ensureTenantScope`. No cross-tenant surface touched.
- **BC impact:** No contract surface changes — signature unchanged, helpers additive.
- **Residual risk accepted:** (1) standalone create-app integration not executed here (env container conflict; justified above); (2) `om-auto-review-pr` not run (read-only fork + gh outage) — re-run from a write-access account once gh is healthy; (3) deferred follow-ups remain open per the spec (Pattern C user-route scope population, WHERE-clause record-load scoping, enterprise/provider re-audit).
