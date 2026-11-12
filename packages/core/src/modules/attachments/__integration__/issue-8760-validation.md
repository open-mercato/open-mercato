# Issue #8760 validation and review

## 2026-11-12 autofix follow-up

Merged current main, preserving both compatibility/upgrade-note additions. The previous CI script failure was lesson-catalog drift; `node --test scripts/__tests__/check-lessons.test.mjs` now passes all 5 tests after that merge.

The inherited security finding is fixed: successful reads protected only by the private read feature now report `protected: true`, activating the existing `private, no-store` headers on both byte routes. Public and opt-out service behavior stays covered. Focused regressions first failed 13 assertions against the old runner; the final attachment run passes **47 suites / 533 tests**. It covers original/download, fresh renders, warm thumbnails, exact/wildcard grants and existing scope/owner denials. TC-ATT-028 also asserts no-store for freshly generated and cached thumbnails and authorized original/download responses.

Validation source: local fallback for the revised, unpublished head (no GitHub checks yet). Runner: local; no compose app container was running. Dependencies installed with `yarn install --immutable`; optional native `cpu-features` emitted a build warning. Package build, generation and template parity pass. The first core typecheck was blocked by missing generated registries in the fresh worktree; the retry passes after generation. This does not claim a complete current-head CI pass.

Earlier TC-ATT-028 HTTP scenarios passed in [CI](https://github.com/open-mercato/open-mercato/actions/runs/42019295881/job/127264268502); that evidence predates the new header assertions. Current-head CI, named human security-waiver acknowledgment, independent re-review and protected manual QA remain merge gates. The sections below preserve the original authoring evidence.

## Scope

Private attachment HTTP bytes only: original/inline, forced download, derived image and warm thumbnail reads. The shared runner option is additive; existing service callers and public partitions preserve their contracts. No schema, dependency, UI, upload or mutation-policy changes.

## Regression evidence

Before the production fix, the expanded runner test had **6 failures and 29 passes**: ungranted read/render, global-private read, revoked token privilege, missing live context and callback admission. All failed because the former runner allowed access. After the fix, the attachment suite passes **46 suites / 524 tests**, including **24 new route cases**. The real runner/feature-policy and route handlers run; only authentication, persistence and storage are synthetic fixtures.

Exact targeted command (also rerun under supported Node 24.22.2):

```sh
MISE_NODE_VERSION=24.22.2 TMPDIR=/tmp yarn workspace @open-mercato/core test --runInBand --testPathPatterns=modules/attachments
```

Coverage includes absent/manage-only grants, token feature spoofing, exact/module/global wildcard grants, live and revoked superadmin, removed read feature, baseline scope denial, owner denial despite a wildcard, public anonymous reads, and denial before original storage or warm-thumbnail lookup.

## Configured validation gate

Runner: local. Docker daemon unavailable. The first attempt hit macOS Unix-socket path length limits in tsx; shortening `TMPDIR` cleared both i18n checks. All configured commands were attempted in order.

| Command | Result |
| --- | --- |
| `yarn build:packages` | PASS |
| `yarn generate` | PASS |
| `yarn build:packages` (after generation) | PASS |
| `yarn i18n:check-sync` | PASS with `TMPDIR=/tmp` |
| `yarn i18n:check-usage` | PASS with `TMPDIR=/tmp`; unused keys advisory only |
| `yarn typecheck` | PASS |
| `yarn test` | Bounded at 300s after 50/51 Turbo tasks succeeded; final workspace completed separately, with its budget regression corrected as below. A single clean full gate remains for CI. |
| `yarn build:app` | PASS |
| `yarn template:sync` (review extension) | PASS |
| `git diff --check` | PASS |

The full test retry used `MISE_NODE_VERSION=24.22.2 TMPDIR=/tmp TURBO_ENV_MODE=loose yarn test`. Core passed 2,678 suites / 26,959 tests. The initial strict-Turbo attempts failed the shared bootstrap child-process socket check; the corrected Node 24 / loose-environment retry passed that workspace.

Continuation: `MISE_NODE_VERSION=24.22.2 TMPDIR=/tmp TURBO_ENV_MODE=loose yarn workspace create-mercato-app test` ran 1,043 tests: 1,033 passed, 6 skipped, 4 failed (three compatibility budget subtests plus their parent). The appended compatibility entry caused those three byte-cap failures. Compacting only this issue's entry to 330 bytes fixed them. The focused command below then passed **6/6 tests**; the other 1,033 passing tests were not repeated for a documentation-only correction.

```sh
cd packages/create-app
MISE_NODE_VERSION=24.22.2 TMPDIR=/tmp node --import tsx --test src/lib/compatibility-context-budget.test.ts
```

No test budgets or assertions were relaxed. The complete single-command full gate is still pending in CI; the split local evidence is not presented as a green `yarn test` invocation.

## Managed HTTP coverage

`yarn mercato test:integration TC-ATT-028` was attempted and exited before tests: container runtime unavailable. The five self-contained scenarios create fresh roles/users with independent grants before login, upload a synthetic PNG, warm the thumbnail cache, check file/download/image paths and anonymous denial, then clean up all created fixtures. They must run in CI or a managed Docker environment before merge; no live HTTP success is claimed.

## Review

Verdict: **request changes / merge blocked** pending human security-waiver acknowledgment, executable HTTP evidence and a clean full CI gate. The source review found no additional code-level correctness blocker: immutable scope baseline precedes the feature gate; the gate precedes both storage and cache access; owner denies remain decisive; public fast paths and existing services stay compatible. This is an authoring-session review, not independent human approval.

`BACKWARD_COMPATIBILITY.md` requires a named human maintainer to waive deprecation steps 1–3. The qualifying argument, client/operator migration and dated entry are present; approval remains pending. `needs-qa` must remain until manual QA signs off. No `qa-approved` label is supplied by this run.

Manual QA: with a synthetic private PNG, verify exact/module-wildcard readers open original and resized content; a same-org principal lacking `attachments.view` gets 403 for inline/download and a warm thumbnail; a cross-org principal remains denied. Recheck a public global image anonymously and an owner-denied record with a generic read grant.
