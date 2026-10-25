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