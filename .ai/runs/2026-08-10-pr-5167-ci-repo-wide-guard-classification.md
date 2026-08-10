# Execution plan — PR #5167 CI stabilization (adopted)

PR: [#5167](https://github.com/open-mercato/open-mercato/pull/5167)
Issues: [#5164](https://github.com/open-mercato/open-mercato/issues/5164), [#5163](https://github.com/open-mercato/open-mercato/issues/5163)
Engine: om-auto-continue-pr (adopted — the PR was opened by `om-auto-create-pr` without a committed `Tracking plan:` line)

## Goal

Reconstructed from the invocation (`/om-auto-continue-pr 5167 fix failing ci`), the PR's own description and
its red check: **make CI green on PR #5167 without weakening any test or gate.** The feature work the PR
describes is already implemented and its `test` job's jest phase is green — only the root-level
`yarn test:scripts` step fails.

## Evidence

- CI run [31405800380](https://github.com/open-mercato/open-mercato/actions/runs/31405800380), job `test`:
  steps 1–20 succeed (`typecheck`, `Test`), step 21 `Test scripts` exits 1. The three unfiltered steps that
  follow it (DS token drift, create-app parity, repo-wide audit guards) never ran because the job aborted.
- The single assertion that fails is `scripts/__tests__/repo-wide-guards.test.mjs` →
  *"no test that audits other packages is left unclassified"*, naming
  `packages/search/src/modules/search/__tests__/global-search-acl.test.ts`.
- That test is genuinely cross-package: its `searchable entity ACL coverage` block walks
  `packages/core/src/modules/*/search.ts` and `packages/checkout/src/modules/*/search.ts` from a repo-root
  anchor. CI's `turbo --filter` selects packages, not paths, so a PR touching only those modules' `search.ts`
  would skip the guard entirely — exactly the drift class `scripts/repo-wide-guards.mjs` exists to prevent
  (#4527, #4534).

**Non-goals**

- No change to the PR's feature work (preset module list, ACL gate, entity filtering, `aclFeatures` backfill).
- No suppression: the new test is classified as a guard that *runs unfiltered*, not as a
  `CROSS_PACKAGE_EXCEPTIONS` entry — it is not covered by any other unconditional CI step.
- The pre-existing, environment-only `fs.inotify` failures in the dev-wrapper and create-app dev-log tests
  are out of scope; they are green in CI and untouched by this PR.

**Assumptions**

- `packages/search` carries a usable `jest.config.cjs` (verified) so it can host its own guard group.
- The remaining queued jobs (`docker-build`, `ephemeral-integration 1–15`) are unrelated to this failure and
  are re-evaluated after the push.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Classify the new cross-package guard

- [ ] 1.1 Add an `@open-mercato/search` group to `REPO_WIDE_GUARDS` listing `global-search-acl.test.ts`
- [ ] 1.2 Verify `node --test scripts/__tests__/repo-wide-guards.test.mjs` and `yarn test:repo-wide-guards` pass

### Phase 2: Validate and report

- [ ] 2.1 Run the configured validation gate
- [ ] 2.2 Push, re-check CI, post the summary comment
