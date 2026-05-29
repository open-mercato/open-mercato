# Execution Plan — Organization-Scope Fail-Open Authorization Hardening

Source spec: `.ai/specs/2026-05-29-org-scope-fail-open-authorization-hardening.md`
Pre-implementation analysis: `.ai/specs/analysis/ANALYSIS-2026-05-29-org-scope-fail-open-authorization-hardening.md`
Closes: #2239 (write/command path), #2245 (read/detail path)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Add `isOrganizationAccessAllowed` predicate + truth-table unit test | done | 5848120d3 |
| 1 | 1.2 | Rewrite `ensureOrganizationScope` on the predicate; scope unit tests (absent-scope-not-deny + allow-path regression) | done | 5848120d3 |
| 2 | 2.1 | Add `isOrganizationReadAccessAllowed` predicate + unit test | done | 13144945d |
| 2 | 2.2 | Migrate 10 fail-open detail-route guards + `entity-roles-factory` | done | 13144945d |
| 3 | 3.1 | Integration fixture infra (org/ACL/null-home-org) + `TC-CRM-072.spec.ts` | done | e1b9259ff |
| 3 | 3.2 | Validate `TC-CRM-072.spec.ts` under a coherent app+DB harness (`yarn test:integration:ephemeral`) | todo | — |
| 3 | 3.3 | Full validation gate (`yarn test`, `yarn build:app`) | todo | — |

## Goal
Close an OWASP A01 fail-open authorization gap where organization-scope checks are **skipped** instead of **denied** when a restricted (non-super-admin) user has no resolvable current organization — fixed once via shared, fail-closed authorization helpers consumed by both the command (write) and detail-route (read) paths.

## Scope
- Rewrite `ensureOrganizationScope` to fail closed (`allowedIds === null` is the only unrestricted signal); preserve the legacy `currentOrg` fallback only when `organizationScope` is entirely absent (Pattern C — load-bearing for ~40 system/worker call sites).
- Add a shared read-path predicate and migrate all 10 audited fail-open detail-route guards (customers) + the shared `entity-roles-factory` guard.
- Unit tests at all three layers; integration fixtures + spec.

## Non-goals
- Deferred (tracked as follow-ups): WHERE-clause scoping of single-record loads (Q2-b); migrating Pattern C user-facing command routes to populate a real `organizationScope`; re-auditing `packages/enterprise/**` and provider packages.

## Risks
- Tightens create/update/read authorization for "floating" restricted users — deliberate; covered by allow-path regression unit test.
- The absent-scope legacy fallback is load-bearing; switching it to deny would break payment/scheduled-command flows. Guarded by a dedicated unit test (`organizationScope == null ⇒ legacy, not deny`).

## Changelog
- 2026-05-29: Plan created; Phases 1–2 complete, Phase 3 partial (fixtures + spec written, end-to-end validation pending). Opened as draft PR open-mercato/open-mercato#2300 — remaining items (3.2, 3.3) to finish over the weekend.
- 2026-05-29: `om-auto-continue-pr-loop` resume — migrated legacy flat plan (`.ai/runs/<slug>.md`) into this run folder with a `## Tasks` table, `HANDOFF.md`, and `NOTIFY.md`. Resume point: Step 3.2.
