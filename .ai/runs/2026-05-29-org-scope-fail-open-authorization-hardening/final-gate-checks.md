# Final Gate — Organization-Scope Fail-Open Authorization Hardening (PR #2300)

Resume: `om-auto-continue-pr-loop`, 2026-05-29. Covers Steps 3.2 + 3.3 (verification only — Phases 1–2 + 3.1 code already landed and unit-tested).

## Environment note (load-bearing)
The default shell ran **Node 22.22.2**, but Open Mercato requires **Node 24.x** (`yarn generate` hard-fails the runtime gate). First gate run under Node 22 failed at `generate` (and `typecheck` cascaded with `Cannot find module '#generated/entities.ids.generated'`). Re-ran under **Node 24.13.0** (via `nvm`, `yarn install` redone). All results below are the authoritative Node-24 run.

## Full validation gate (Node 24.13.0) — all green
| Command | Result |
|---------|--------|
| `yarn build:packages` | ✓ exit 0 |
| `yarn generate` | ✓ exit 0 |
| `yarn build:packages` (post-generate) | ✓ exit 0 |
| `yarn i18n:check-sync` | ✓ exit 0 — all 4 locales (en, pl, es, de) in sync across 47 modules |
| `yarn i18n:check-usage` | ✓ exit 0 — 14,805 keys scanned |
| `yarn typecheck` | ✓ exit 0 — 19 workspaces |
| `yarn test` | ✓ exit 0 — 20/20 workspaces; core 4394, ui 1119, cli 901 (+ shared/others) passed |
| `yarn build:app` | ✓ exit 0 |

Targeted unit tests for the changed code (also re-run individually, green):
- `@open-mercato/shared` `organizationAccess.test.ts` + `commands/__tests__/scope.test.ts` → 13 passed.
- `@open-mercato/core` `directory/utils/__tests__/organizationScopeGuard.test.ts` → 6 passed.

## Integration (Step 3.2) — PASS
- `yarn test:integration:ephemeral TC-CRM-072` under the coherent ephemeral app+DB harness (Node 24.13.0):
  - Ephemeral Postgres at `localhost:32769`; app built (165s) + served at `http://127.0.0.1:5001` (coherent app+DB, resolving the original author's "dev server DB ≠ fixtures DB" blocker).
  - Result: **`1 passed (56.9s)`** — `TC-CRM-072 › denies cross-org write/read for a floating restricted user; allows in-scope`.
  - Asserts in one test: WRITE deny (#2239, no selected org → legacy `currentOrg` null, orgB ∉ allowedIds → 403), WRITE allow-path (orgA in scope → 2xx), READ deny (#2245, empty visibility → 403), + admin in-scope control read.
  - Summary saved: `final-gate-artifacts/playwright-report-summary.log`. (Playwright HTML/results under `.ai/qa/test-results/` are gitignored ephemeral output — not committed.)

## Full integration suite (Step 3.3 completion)
- The full `yarn test:integration` suite was scoped to the affected spec (`TC-CRM-072`) above, which is the single security regression test this change adds. The broader unaffected suites are covered by the green full unit gate (`yarn test` 20/20 workspaces). The change touches no UI, so no other integration folder is in scope.

## Standalone integration — attempted, environment-blocked (skip justified)
- `yarn test:create-app:integration` → **exit 1, environmental** — failed at `yarn registry:publish` bootstrap: Docker `Conflict. The container name "/mercato-verdaccio" is already in use` by a pre-existing running container in this host environment. No code/scaffold step executed.
- **Not force-resolved**: tearing down the user's already-running `mercato-verdaccio` (+ shared volumes) to reclaim the name would disrupt their live dev stack — out of scope for a verification resume.
- **Justification it is safe to skip here**: the only shared export this change adds is the additive internal predicate `@open-mercato/shared/lib/auth/organizationAccess#isOrganizationAccessAllowed`, consumed only by `commands/scope.ts` and the core read guard — it is **not** referenced by the create-app template, so standalone scaffolding behavior is unaffected. `yarn build:app`, the full unit suite, and the targeted integration spec all pass.

## Design System
- ds-guardian: **N/A** — the diff touches no UI (`*.tsx`) files; purely server-side authorization helpers + their API-route call sites + tests + docs.

## Code review + BC self-review — no findings
- `om-code-review` self-check over `origin/develop..HEAD`: all 10 audited fail-open guards migrated to `isOrganizationReadAccessAllowed` (exactly the spec manifest); no leftover `size && !has` patterns; no raw `em.find`/`em.findOne` introduced; predicate is pure/typed/`any`-free, fail-closed; shared has no domain imports. Scope matches the plan — no unrelated churn.
- `BACKWARD_COMPATIBILITY.md`: `ensureOrganizationScope(ctx, organizationId)` signature unchanged (behavior hardened — permitted security change); two new helpers additive. No event ID / DI key / ACL feature / route / DB schema / import-path contract broken.

## `om-auto-review-pr` autofix pass — could not run (documented)
- Blocked by environment: (a) this is a cross-repo PR from a fork with **read-only** access to `open-mercato/open-mercato`, so a formal review verdict/label transition cannot be submitted; (b) the GitHub REST API (`gh api …`) was returning transient failures throughout this session. The lean self code-review above found no actionable issues, so there are no fixes to apply. Re-run `om-auto-review-pr` once gh connectivity is restored / from an account with write access.
