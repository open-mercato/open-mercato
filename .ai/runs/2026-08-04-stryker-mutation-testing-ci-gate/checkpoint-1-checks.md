# Checkpoint 1 — Phase 1 closed (Steps 1.1, 0b.1, 1.2, 1.3, 1.4, 1.5)

**Timestamp:** 2026-08-04T07:32:00Z
**Runner:** local (no compose `app` container running, so not Docker mode)
**Steps covered:** 6 landed commits — `723419941`, `641325d9a`, `cdc409d00`, `2fed7cd92`, `63b68afb2`, `089fcad52`

## Targeted validation

| Check | Command | Result |
|-------|---------|--------|
| Script unit tests (the suite CI runs at `ci.yml:515`) | `yarn test:scripts` | ✅ **463 passed / 0 failed**, including the 44 new tests added by this phase |
| Dependency install is reproducible | `yarn install --immutable` | ✅ exit 0 |
| Stryker resolves | `yarn stryker --version` | ✅ `9.6.1` |
| Packages build | `yarn build:packages` → `yarn generate` → `yarn build:packages` | ✅ exit 0 |

New tests by file: `stryker-create-config.test.mjs` (10), `stryker-scope.test.mjs` (14),
`stryker-mutation-changed.test.mjs` (7), `stryker-workflow.test.mjs` (10), plus
`stryker-report.test.mjs` (13) written for Step 2.1 and landing with it.

## Spec Test criteria verified

| Step | Spec criterion | Result |
|------|----------------|--------|
| 1.1 | `yarn install --immutable` succeeds; `yarn stryker --version` resolves | ✅ both |
| 0b.1 | The run completes and produces a score; if not, Phase 1 ships `shared` only | ✅ criterion **not** met by `core` → `shared`-only allowlist shipped, as specified |
| 1.2 | Unit test asserting factory output for a given package name | ✅ 10 tests |
| 1.2 | `stryker run --mutate src/lib/boolean.ts` in `packages/shared` reproduces the pilot's 93.3 % | ✅ **93.33 %** (28 killed / 2 survived / 2 errors), 1 m 27 s, 615.92 tests per mutant |
| 1.3 | In-scope included; `.tsx`, `api/`, deleted excluded; cap truncates and reports; empty diff → empty matrix | ✅ all six, plus dedup/ordering |
| 1.4 | Running on a dirty tree exits non-zero without invoking Stryker | ✅ asserted directly (`strykerCalls` empty, exit code 1) |
| 1.5 | The workflow runs on this PR and reports a score | ⏳ pending — verifiable only once the PR runs CI; workflow invariants are unit-asserted meanwhile |

The `boolean.ts` reproduction is the headline result: **93.33 % against the pilot's 93.3 %**, through
the new factory rather than the pilot's hand-written JSON. Wall time moved from 1 m 18 s to 1 m 27 s
and tests-per-mutant from 530 to 615.92, consistent with `develop` having gained tests since the
pilot — the cost driver is still fan-in.

## Blockers hit and resolved

1. **`packages/shared`'s suite needs built packages.** Stryker's initial dry run failed with
   `Cannot find module '@open-mercato/cache' from 'src/lib/crud/cache.ts'` in a fresh worktree.
   The suites resolve sibling packages through `dist/`. Fixed by building; the workflow now carries
   an explicit `Build packages` step before the mutation run, with a comment explaining why.
2. **An interrupted `inPlace` run leaves ~4 966 modified files.** Measured twice during Phase 0b.
   Cause: Stryker's `disableTypeChecks` default injects `// @ts-nocheck` before mutating, and
   `inPlace: true` writes that to real files. `git checkout -- packages/core` recovers fully. This
   is why the local wrapper's clean-tree guard is a hard stop.
3. **Environment hazard worth recording.** Background tasks here are killed at a 10-minute cap, and
   a detached measurement survived several `pkill` attempts because the sandbox silently dropped the
   signals — it re-instrumented `packages/core` mid-run. Killing required `dangerouslyDisableSandbox`,
   and `pgrep` sees these processes while `ps` did not. No two `inPlace` runs may share a package.

## Not run at this checkpoint, and why

- **Full `validation.commands` gate** — deferred to the final gate (step 9), per the checkpoint
  contract. `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build:app` run there.
- **Integration tests / browser QA** — none applicable. This change adds no application code, no
  route, and no UI; its only developer-facing surface is a GitHub Actions job summary. No
  screenshots exist to capture.
