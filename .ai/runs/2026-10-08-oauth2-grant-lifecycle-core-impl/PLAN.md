# Execution plan — OAuth2 grant lifecycle, Phase 1 core

- **Run:** `2026-10-08-oauth2-grant-lifecycle-core-impl` (`om-auto-create-pr-loop`, Spec-implementation run)
- **Branch:** `feat/oauth2-grant-lifecycle-core-impl` from `origin/develop` @ `85ee5f16b`
- **Source spec:** `.ai/specs/2026-10-01-oauth2-grant-lifecycle-core.md` (on PR #6910, branch `feat/oauth2-grant-lifecycle-core` @ `9f23ede6c`; not on `develop` yet)
- **Parent App Spec:** `.ai/specs/2026-09-27-app-spec-oauth2-grant-lifecycle.md` (the version on PR #6910 wins on conflict)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | P1a — advisory transaction lock helper in shared | dispatch:capable | done | 7bcbf9d0f |
| 1 | 1.2 | P1b — real-Postgres lock suite and CI step | dispatch | done | 68caa78ff |
| 2 | 2.1 | P2a — OAuth protocol helpers and provider descriptor | dispatch:capable | done | 0913bbe3a |
| 2 | 2.2 | P2b — fake authorization server and fixtures re-export | dispatch | done | pending |
| 3 | 3.1 | P3 — credentials erase, kms and map options, layered read, log query, core real-Postgres gate | dispatch:capable | todo | — |
| 4 | 4.1 | P4a — test-only route, test integration, Playwright helper | dispatch | todo | — |
| 4 | 4.2 | P4b — grant service: completeConnect | dispatch:capable | todo | — |
| 4 | 4.3 | P4c — getAccessToken and Refresh | dispatch:capable | todo | — |
| 4 | 4.4 | P4d — provider data, reads, health | dispatch:capable | todo | — |
| 4 | 4.5 | P4e — Disconnect and cross-cutting suites | dispatch:capable | todo | — |
| 5 | 5.1 | P5 — detail GET field and reauth banner | dispatch | todo | — |
| 6 | 6.1 | P6 — docs, BC section, publish-shape check | dispatch | todo | — |

## Goal

Implement App Spec Phase 1: a tenant-level OAuth2 grant core in `integrations` (cross-process safe refresh, trustworthy status, true disconnect) that no existing integration uses yet, exactly as the feature spec defines it.

## Scope

- `packages/shared`: `lib/db/advisoryLock.ts`, `isTransientLockDbError` in `lib/db/pg-errors.ts`, the explicit `exports` entry, a gated real-Postgres suite.
- `packages/core` `integrations`: `lib/oauth/*` (protocol helpers, descriptor, grant service, health, fake authorization server), credentials and log service additions, the flag-gated test-only route and test integration, the detail GET field, the reauth banner.
- `packages/core/src/helpers/integration/`: `oauthGrantFixtures.ts`, `oauthGrantTestRoute.ts`.
- `packages/cli` integration-test env, `.github/workflows/ci.yml` steps in the existing `documents-multi-instance` job, docs, `BACKWARD_COMPATIBILITY.md`, `UPGRADE_NOTES.md`.

## Non-goals

- No provider integration, no OAuth provider routes (Phase 2, official-modules), no hub migration (Phase 3).
- No migration, no new production route, no new ACL feature, no production dependency, no new CI job.
- No change to the existing integrations routes' organization resolution (module-wide follow-up).
- No edit to the spec files in this PR; spec corrections go to PR #6910.

## Risks

- App Spec Q3 (contract-surface and CI sign-off) and Q7 (consumer gate) are open. The run pauses after Step 2.2 and resumes at Step 3.1 once Q3 has a signal; Steps 1.1–2.2 are Q3 surfaces too, but the least likely to change.
- Step 1.2 changes `.github/workflows/ci.yml` (root AGENTS.md "Ask First", covered by Q3); the PR stays a draft until Q3 is settled.
- The real-Postgres suites need Docker locally; CI on this fork PR runs only after a maintainer approves the workflow runs.
- Package Previews refuses fork heads, so the Q7 consumer gate uses `yarn pack` tarballs or Verdaccio.

## External References

None.

## Implementation Plan

Every Step follows the feature spec's own section of the same id ("Implementation Plan → P…") for files, additions and tests, plus the API Contracts, Mechanics, Test infrastructure and Acceptance criteria it points at. Each Step is one commit, builds, passes its own tests and leaves the app working.

### Phase 1 — shared lock helper

#### 1.1 P1a — advisory transaction lock helper in shared
- `packages/shared/src/lib/db/advisoryLock.ts`: `withAdvisoryXactLock`, `AdvisoryLockUnavailableError`, `AdvisoryLockOptions` (incl. `maxConcurrentHolders`), `AdvisoryLockWaitResult`, re-export of `isTransientLockDbError` (spec: API Contracts → Lock helper; Mechanics → Lock section, incl. Slots on `globalThis` and the back-off).
- `packages/shared/src/lib/db/pg-errors.ts`: `isTransientLockDbError` on the existing chain walker; `isTransientDbError` unchanged.
- Unit tests (A2); `packages/shared/package.json` explicit `exports` entry; `packages/shared/AGENTS.md` `db/` row.
- Commit: `feat(shared): add advisory transaction lock helper`.

#### 1.2 P1b — real-Postgres lock suite and CI step
- `packages/shared/src/lib/db/__tests__/advisoryLock.integration.test.ts` gated on `OM_PG_INTEGRATION=1` with `testcontainers` imported in `beforeAll` (A1), harness acquire timeout.
- `packages/shared/package.json`: `test:pg-integration` script, dev dependencies `testcontainers`, `cross-env`; lockfile.
- `.github/workflows/ci.yml`: a named step in `documents-multi-instance` with `if: ${{ !cancelled() }}`.
- Commit: `test(shared): run the advisory lock suite against real Postgres`.

### Phase 2 — protocol helpers

#### 2.1 P2a — OAuth protocol helpers and provider descriptor
- `packages/core/src/modules/integrations/lib/oauth/{token-endpoint,pkce,authorization,redirect,resource-challenge,descriptor}.ts` and tests (A3, A4 against a throwaway `node:http` server, A5).
- Commit: `feat(integrations): add OAuth2 protocol helpers and provider descriptor`.

#### 2.2 P2b — fake authorization server and fixtures re-export
- `lib/oauth/testing/fakeAuthorizationServer.ts`, `packages/core/src/helpers/integration/oauthGrantFixtures.ts`, tests (A6; A4 contract tests against the fake).
- Commit: `test(integrations): add a fake OAuth2 authorization server`.

### Phase 3 — credentials and logs

#### 3.1 P3 — credentials erase, kms and map options, layered read, log query, core real-Postgres gate
- Per spec P3, including `createCredentialsService(em, encryptionService?, options?: { kms })`, `CredentialsWriteOptions.ensureEncryptionMap`, `readCredentialRowLayered`, `findLatestIntegrationLogsByCodes`, core `test:pg-integration`, CI step (A7).

### Phase 4 — grant service

#### 4.1 P4a — test-only route, test integration, Playwright helper
- Per spec P4a (A8).

#### 4.2 P4b — grant service: completeConnect
- Per spec P4b, incl. Grant saves under the lock and `pgTestOrm.ts` (A9–A15, A23 connect).

#### 4.3 P4c — getAccessToken and Refresh
- Per spec P4c (A16–A22, A23 token, A24, A25 invalidation, A40).

#### 4.4 P4d — provider data, reads, health
- Per spec P4d (A23 provider data, A26 `updateProviderData`, A27, A28).

#### 4.5 P4e — Disconnect and cross-cutting suites
- Per spec P4e, incl. the `__oauth_grant` bundle-fallthrough skip (A23 disconnect, A25 disconnect logs, A26 `disconnect`, A29–A35, A39).

### Phase 5 — detail GET and banner

#### 5.1 P5 — detail GET field and reauth banner
- Per spec P5 (A36, A37, `TC-INT-OAUTH-001`, `TC-INT-OAUTH-002`).

### Phase 6 — docs and publish shape

#### 6.1 P6 — docs, BC section, publish-shape check
- Per spec P6 (A38).
