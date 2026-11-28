# Final gate — PR #7138

**Recorded:** 2026-10-09
**Runner:** local mode (no compose `app` container). macOS host, Node 24.19.0, `TMPDIR=/tmp` (the cezar in-repo TMPDIR breaks tsx IPC pipes). Containers via colima (installed for this run).
**Head at gate:** e32d7426c, rebased onto `develop` at the user's request as 6918eaf3b (the rebase raised no conflicts). One CI-only fix followed: `scripts/__tests__/repo-wide-guards.test.mjs` (new on develop) classified `packages/create-app/src/lib/ci-flag.test.ts` as a cross-package audit (`process.cwd()` plus `scripts/` literals inside its temp scaffold). It is now listed in `CROSS_PACKAGE_EXCEPTIONS` with a reason; guard 16/16.

## `validation.commands`

| Command | Result | Notes |
|---|---|---|
| `yarn build:packages` | ✅ | |
| `yarn generate` | ✅ | |
| `yarn build:packages` | ✅ | |
| `yarn i18n:check-sync` | ✅ | |
| `yarn i18n:check-usage` | ✅ | |
| `yarn typecheck` | ✅ | |
| `yarn test` (`--continue`) | ⚠️ 42/47 tasks green | One failure was caused by this PR and is fixed: `explicit-sort-comparators` flagged `listCiWorkflows`' bare `.sort()` (now has a comparator; guard 6/6). The rest are environment or untouched code: cli `resolve-environment`, `resolver.enterprise` and `agent-files-extension` (location-dependent: the checkout sits inside the monorepo, known); core `progressService` (3 cases, core untouched by this PR); create-app agent-harness sandbox suites (the macOS sandbox hides `/opt/homebrew/opt/libuv`, the macOS counterpart of the bubblewrap failures); docs `test` OOM at the root's 1 GB heap under concurrency, which passes alone at the same heap. `shared` `dynamicLoader.generatedCacheRecovery` passes alone (2/2). |
| `yarn build:app` | ✅ | `Cached: 0` |

PR-owned suites after the last code change: create-app `ci-flag`, `template-ci-workflows`, `workflows-ownership`, `template-build-memory`, `template-ci-script` 36/36; cli `src/lib/testing/__tests__/` 71/71; `scripts/__tests__/preview-workflows.test.mjs` 7/7.

## Integration suite

`yarn test:integration:ephemeral --no-screenshots` (colima Postgres, 1 worker, 53 min): **2,491 passed, 8 failed, 2 flaky, 76 skipped.**

The 8 failures come from the local environment, not from this PR, which touches none of these modules:
- `TC-ONB-001/002/003`, `TC-ONBOARDING-EMAIL-001`, `TC-START-001` ×2: self-service onboarding is off. The monorepo CI sets `SELF_SERVICE_ONBOARDING_ENABLED: 'true'` at workflow level (`.github/workflows/ci.yml:27`); the local `apps/mercato/.env` does not, so the signup form never renders ("waiting for getByLabel('Work email')").
- `TC-DOCUMENTS-009`, `TC-DOCUMENTS-013`: "collaboration response should include token"; CI sets the documents-collab variables (`NEXT_PUBLIC_DOCUMENTS_COLLAB_URL`, `OM_DOCUMENTS_COLLAB_INTEGRATION`) at workflow level.
- Flaky (passed on retry): `TC-CAT-037`, `TC-SALES-ADDR-CONTACT-002`.

The only runner code this PR changes (`--app-only`, `--help`) is opt-in. The default discovery path ran the full suite above.

`yarn test:create-app:integration`: not completed. The first run failed in the harness, not the app. `scripts/test-create-app-integration.ts` waits a hard-coded 240 s for the standalone ephemeral app, and on this host the production build alone took 152 s, so the app reported ready just after the harness gave up. A second run with the deadline raised locally (never committed) reached the suite, but it was stopped when the user asked for a rebase onto develop. The standalone lane in PR CI (`snapshot`/standalone jobs) remains the authority. The PR's own standalone behavior is covered end to end in `checkpoint-2-checks.md`.

## Standalone scaffold end to end

See `checkpoint-2-checks.md`: published `create-mercato-app` ships both workflows, `--check-lockfile`, `--app-only` (empty → exit 0; one app spec → 1 selected), and 5 of 5 fully cold `yarn ci` runs with the Turbopack build cache off pass under 7 GB / 2 vCPU (`oom_kill=0`). With the cache on, 2 of 2 were OOM-killed.

## Style-compliance pass

Skipped: the PR ships no UI (`om-ds-guardian` applies to UI changes only). No `.tsx`, nothing under `packages/ui/src/`.

## Review

Two `om-auto-review-pr`-style review passes on 2bfd64f3d (one posted as a COMMENT review: https://github.com/open-mercato/open-mercato/pull/7138#pullrequestreview-5473240807). Fixed in b77127d57 and e32d7426c:
- Medium: the canary could skip the standalone integration lane. It now runs as the job's last step, on a clean copy taken right after install.
- Medium: the "existing app" copy list missed the `build` script hook (`OM_NEXT_BUILD_NODE_OPTIONS`). Added.
- Low: `head.repo.fork` ignored the runner variables in a repository that is itself a fork. The guard now compares `head.repo.full_name` with `github.repository`.
- Low: `upload-artifact@v4` → `@v7`; the canary report tolerates a missing `memory.peak`; the unused Yarn cache mount was removed.

Not changed (accepted, with reasons):
- `npx playwright install --with-deps` runs even when the app has no specs. It costs about a minute, and skipping it would need the workflow to duplicate the CLI's discovery.
- An env-gated app spec (`requiredEnvVars`) can be counted by the CLI and then dropped by the Playwright config, which then fails with "No tests found" instead of exiting 0. This is an edge case with a loud failure, not a silent pass; listed as a follow-up.
