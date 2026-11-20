# Stabilize main — 2026-11-09

## Goal

Verify main with the full CI suite on an isolated stabilization PR, fix demonstrated root causes, and apply `automerge` only after green CI and independent review.

## Scope

Branch: `stabilize/main-2026-11-09`, based on `main` at `3e5aadf0fb29a66a0f3b8e0d50d1c9159b378afc`. The explicit branch name and CI monitoring requirement override the skill's default branch prefix and no-wait reporting policy.

The existing workflow already supports `ci-full` and same-repository `stabilize/*` branches, including all 15 integration shards and unfiltered unit/type checks. Preserve that implementation unless verification demonstrates a defect.

Non-goals: unrelated refactors, suppressing tests, weakening gates, production changes, or merging the PR.

Source doc: `.ai/specs/implemented/2026-04-10-ci-cd-performance.md`

## Implementation Plan

### Phase 1: Diagnose and verify scope

1.1 Independently investigate recent main failures and whether fixes already landed. Dispatch one read-only investigation task; reserve the second and final subtask for final review.

1.2 Verify existing full-suite selection, record diagnosis, and implement only demonstrated remaining defects with regression coverage.

### Phase 2: Validate and review

2.1 Run the applicable validation gate and the PR's full CI suite; fix root causes until all applicable checks pass.

2.2 Dispatch one final independent review using `cez task create --kind review --review-of stabilize/main-2026-11-09`, validate its evidence, and address findings before completion.

2.3 Publish final evidence, mark ready, and apply `automerge` only after successful checks and review.

## Risks

- Main's latest full CI is already green: https://github.com/open-mercato/open-mercato/actions/runs/42633763976. The preceding run failed integration shard 10/15: https://github.com/open-mercato/open-mercato/actions/runs/42628912043. Do not invent corrective changes if investigation confirms resolution.
- Hosted checks may reveal flakes or infrastructure failures; distinguish those from product defects and preserve failure evidence.
- Adding `ci-full` does not itself schedule a run; the stabilization branch selects the full suite on the initial PR event and subsequent pushes.
- No UI changes are planned. A documentation-only outcome uses the skill's docs-only validation exemption; any code changes require the configured full ordered gate.

## Diagnosis and validation evidence

- The preceding failure happened during initialization, before Playwright: auth setup printed usage and then initialization aborted. The actual password is masked, so attributing that particular failure to its prefix remains an inference.
- Reproduced an unfixed incompatibility: base64url randomness can start with `--`; `mercato init` forwards the password as a separate argument, while the auth argument parser treats such a value as another flag. The generated password now starts with its existing `aA1!` policy characters, retaining every random byte and the same length. No CLI or application contract changes.
- `scripts/__tests__/ci-bootstrap-password.test.mjs` executes the actual workflow generator with deterministic random output. Before the fix, the leading `--` case fails; after the fix, all three cases pass, including entropy and password-policy assertions. Runner: local (`timeout 30 node --test scripts/__tests__/ci-bootstrap-password.test.mjs`).
- First full PR CI passed all 15 shards, unfiltered type/unit checks, builds, timezone, documents, and lint: https://github.com/open-mercato/open-mercato/actions/runs/42662855709. A new full CI run is required for the password fix.
- Snapshot registry propagation and CodeQL download failures recovered externally; no product defect was established for either.
- Fixed-head full CI passed: https://github.com/open-mercato/open-mercato/actions/runs/42676794053 at `b5b0b52c9da0645218dee71c61b1aaebcd67a715`. All 15 integration shards and merge-coverage succeeded; all 35 reported PR checks passed or were intentionally skipped. Hosted checks cover package builds, generation, app build, i18n checks, full type/unit/script tests, lint, and template parity. The i18n usage check remains advisory under the existing workflow.
- Final independent reviewer `b0a93ef5` approved the exact fixed head with no findings or code changes: https://github.com/open-mercato/open-mercato/pull/9090#issuecomment-6750051623. The reviewer independently reran the regression (3/3 pass), verified failure against the pre-fix generator (2 fail/1 pass), and traced the real auth parser. GitHub refused native self-approval because author and reviewer share the bot account; the linked comment is the authoritative review.
- Parent independently confirmed the reviewed diff, regression results, all 15 successful shards, and all 35 pass/skip checks. Branch-protection enumeration returned HTTP 403, so publication conservatively requires every reported check to pass or be intentionally skipped.
- The final ledger commit changes only this plan. Its full CI must also be green before draft promotion and the `automerge` label; live publication is recorded in the PR timeline and final run summary. The reviewed workflow and regression test remain unchanged.

## Progress

PR: #9090

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and verify scope

- [x] 1.1 Independently investigate recent main failures and whether fixes already landed — bd8b2687f1
- [x] 1.2 Verify existing full-suite selection and address demonstrated remaining defects — bd8b2687f1

### Phase 2: Validate and review

- [x] 2.1 Run applicable validation and full PR CI until green — b5b0b52c9d; full run 42676794053
- [x] 2.2 Complete final independent review and address findings — b5b0b52c9d; approved, no findings
- [x] 2.3 Publish evidence, mark ready, and apply automerge — final publication gated on final-head checks; see PR #9090 timeline
