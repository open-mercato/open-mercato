# Execution plan — passkey enrollment review remediation (adopted from PR #6824)

**Origin:** adopted by `om-auto-continue-pr --adopt auto` on 2026-10-25 because PR #6824 has no tracking plan.
**PR:** #6824 · **Branch:** `codex/fix-6800-passkey-attestation` · **Base:** `main`
**Author:** @haxiorz

## Goal

Finish the independently actionable review remediation while preserving verified passkey enrollment, the current main behavior, and the named human security-exception merge gate.

## Scope

Merge the current PR base, resolve conflicts, validate the resulting security paths, publish the correction, and request re-review.

## Non-goals

No merge, compatibility bridge restoring vulnerable enrollment, human waiver, QA approval, release-policy change, or unrelated refactor.

## Evidence

| Conclusion | Drawn from | Confidence |
| --- | --- | --- |
| Verified WebAuthn enrollment and localized rejection are implemented | PR description, security spec, head `5862cad387674e3006e87e89bcc1d4e99bedce7a` | High |
| Current base conflicts require resolution | Review `5564811872`; current PR base is `main` | High |
| A named human must acknowledge the Emergency Security Exception | Same review, `BACKWARD_COMPATIBILITY.md`, security spec; QA comment `6238527028` explicitly preserves the gate | High |

## Assumptions

The PR metadata's current base `main` supersedes historical `develop` references. Existing QA evidence remains historical evidence for its stated head; the agent will not infer a human waiver from it. The unchecked CLA declaration remains the author's personal attestation.

## Risks

Conflicts may combine main's error-reporting requirements with the provider's localized validation boundary. Both must survive. Removed STABLE payload acceptance remains gated by explicit named human approval.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Require verified registration, preserve signed login, cover legacy rejection and document migration — 5862cad387674e3006e87e89bcc1d4e99bedce7a

### Phase 2: Resolve and publish review remediation

- [x] 2.1 Merge current main and preserve both passkey verification and main changes — 7543cae85002724af0ef768f63e9664ba37f11b9
- [x] 2.2 Run focused validation and review the resulting head using CI-first policy — 7543cae85002724af0ef768f63e9664ba37f11b9; source review and static checks complete, remote checks queued/running, no green CI claim
- [x] 2.3 Publish evidence and request re-review while preserving changes-requested — 7543cae85002724af0ef768f63e9664ba37f11b9; review requested from @wojciechszyjka

- [x] 2.4 Correct the merged lesson catalog count exposed by CI and verify focused checks — CI test job 121197721648; count 153 to 155, validator and 5/5 focused tests passed

- [x] 2.5 Refresh main and reconcile measured compatibility context caps without expanding reads — 75b97e1cb1934492458e32b71983d198cd8491e4 and 9c1dfce5b1d5a03ab72449c7195e5d9d8948adf9
- [x] 2.6 Correct the stale migration release-section reference — ae3be79a3d17885704b7f04c63e23ea8b5382cb7

### Phase 3: Human merge gates

- [ ] 3.1 Obtain named human maintainer acknowledgment of the Emergency Security Exception
- [ ] 3.2 Author confirms the outstanding CLA declaration if still required

## Remediation evidence

- Merged current main `477f2486e5923517c9e762abe541939611c3c49e` without rewriting branch history.
- Resolved the only conflicts in `UPGRADE_NOTES.md` and the harness catalog. Retained both documentation sides; the catalog is byte-identical to main, preserving the larger current budgets.
- `git diff --exit-code HEAD^1 HEAD -- packages/enterprise/src/modules/security` passed on the merge commit: the entire security module is unchanged by the merge.
- Main ancestry, final PR diff whitespace, harness JSON parsing (240 cases), preserved waiver wording, and clean working tree checks passed. Runner: local for these static checks; no running compose app was found.
- Validation source: GitHub checks. The merge-head checks were queued/running, so the CI-first override prohibits duplicate local test/build substitutes. Required-check discovery returned 403; all reported contexts are treated as required. Final-head outcomes must be verified after the documentation progress commit as well.
- The source review reconfirmed response-only enrollment, the localized synchronous/asynchronous validation boundary, unchanged authentication and scope guards, retained real-crypto tests, and two-authenticator integration coverage. No new source defect was found. The security compatibility waiver is still a blocker.
- @wojciechszyjka, who reviewed related proof of concept #6710, was requested through GitHub for re-review on #6824. This is a request for fresh human assessment, not sign-off.
- Historical QA at `5862cad3` is preserved as historical evidence only. This run does not grant QA approval, human waiver, CLA acknowledgment, or merge permission.
## CI count correction follow-up

The test job for `0e97769f53058bbbf074c0b84fd6e88d42feed3f` in run `40202422396` passed the workspace Jest tasks, then failed the root `check-lessons.test.mjs` assertion: the merged catalog contains 155 records and rows while its introduction says 153. All other reported checks completed successfully or were conditionally skipped, including the security integration job.

The focused test reproduced the count failure before the fix (4/5 passed). Changed only the catalog's declared count to 155, preserving every row and record. Afterward, `node packages/create-app/agentic/shared/scripts/check-lessons.mjs --root .` passed, `node --test scripts/__tests__/check-lessons.test.mjs` passed 5/5, and `git diff --check` passed. Runner: local. The initially requested `scripts/check-lessons.mjs` path does not exist; the package script identifies the canonical validator path used above.

No broad Jest rerun or security source change was needed for this documentation correction. The new commit requires fresh exact-head CI; prior-head successful jobs are historical evidence only. The named human Emergency Security Exception acknowledgment remains required. The `license/cla` context succeeded at the preceding head; the PR body's human checkbox was left untouched.

## Measured compatibility-context correction

Current main db279a693eb283f6147b6e1ef24abfeeca6de646 contained no existing budget correction and merged cleanly. Measured final source context: OMH-007/064 = 123775 bytes, minimum cap 123904; OMH-022 = 110831, cap 111616; OMH-057 = 116225, cap 116736; OMH-030 = 125814, existing cap 126976 unchanged. Initial/read/file/forbidden sets and the 12288 root limit are unchanged; emitted root 11971 bytes. The existing test reports independent case subtests and retains every assertion.

The unchanged controller derives knowledge-contract (context-read, evaluator) and independently proves base-plus-test-only exit 1, corrected source head exit 0. Result SHA-256: a2ebd63bb5d6d75e9462e4edfacecf8b72fc4bb688a914e2defdafbcdb89c789. Six focused tests and all five affected fresh-scaffold deterministic cases pass. Lesson validator and five lesson tests also pass; no broad Jest rerun was performed.

Full deterministic catalog validation in the minimal source fixture remains incomplete due to unrelated absent installed/example/template surfaces. Full packed-preset/certified release proof is unavailable: official target-isolation preflight rejects win32. These are explicit unpassed gates, not asset-sync exemptions or waived checks. The local sanitized refresh report records the bounded proof. The separate authorized continuation publishes the concrete correction; fresh-head CI and named human Emergency Security Exception acknowledgment remain required.

The migration-section reference nit was corrected from 0.8.0 → 0.8.1 to the existing 0.8.0 → 0.9.0 heading. Its byte length is unchanged; final measurements and controller proof include the corrected reference. No passkey/security source changed.
