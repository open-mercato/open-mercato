# Defensive MFA setup and Polish translation maintenance

Goal: fix uncovered setup error responses (#10013) and Polish setup/login labels (#10014).
Scope: enterprise security provider errors, provider page title, Polish dictionary and mocked unit tests.
Non-goals: verifier, authentication, session, rate-limiting, encryption or schema changes; live endpoint tests.
Existing work: #9817 is merged; #9642 and #9838 do not fix these errors/strings.
#9956 already localizes relative registration time; do not duplicate that active work.
Runner: local (no running compose app; fullapp compose probe requires missing JWT_SECRET).
Claim-Run: d20a727d-b7be-434f-b22c-fb61e25cc6ce

## Implementation plan

1. Return existing localized client errors for expected TOTP setup failures.
2. Translate uncovered Polish setup/login labels and the built-in TOTP page title.
3. Verify with mocked unit tests, review, open a non-draft main PR and apply release metadata.

## Risks

Preserve all verification branches and failure cleanup. Unknown failures must remain generic 500s.
Keep needs-qa and all unrelated labels. No manual/live authentication QA is authorized.
The full monorepo validation gate may be limited by worktree dependency/build prerequisites; report exact results.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append commit SHA when landed.

### Phase 1: Focused fixes

- [x] 1.1 Correct setup error mapping and add mocked regressions.
- [x] 1.2 Translate uncovered Polish labels and provider title.

### Phase 2: Verify and publish

- [x] 2.1 Run validation, inspect the diff, and prepare the main PR with milestone and backport metadata.


## Validation outcome

Runner: local. Focused suite: 7 suites, 67 tests passed. Both package builds passed
(42 tasks each); generation completed; i18n sync and usage passed (unused keys advisory).
Broader monorepo typecheck was interrupted after 40/42 tasks and has no final result.
Root tests did not complete: Turbo could not spawn the cache test child process (ENOENT).
App build, template parity and manual QA were not run; the user requested publication
with these limitations documented and QA after merge. No live authentication endpoint
was used. Authentication, verifier and rate-limiting branches are unchanged.
