# Stabilize main — 2026-11-10 afternoon verification

## Goal

Verify current main with every integration shard, fix demonstrated CI root causes, and hand off a reviewed green PR with `automerge`.

## Scope

Baseline: `e2f30b299531f4181128530d3722d2df420ac473` on main. The requested dated branch and its follow-up were already used by completed runs (#9125 and #9176); use `stabilize/main-2026-11-10-v3` without rewriting their history. Existing same-repository stabilization branches and `ci-full` already force all 15 shards plus unfiltered unit/type checks.

Source doc: `.ai/specs/implemented/2026-04-10-ci-cd-performance.md`

Non-goals: speculative changes, weakened checks, releases/publication, production changes, or merging into main. If no current defect remains, retain a verification-only ledger and PR rather than inventing a fix.

## Implementation Plan

### Phase 1: Diagnose

1.1 Delegate an independent read-only workflow audit; inspect main CI and current snapshot results. Parent owns tightly coupled fixes and regression tests.

### Phase 2: Validate

2.1 Fix demonstrated remaining failures with regression coverage, if any; run the applicable configured validation gate and full PR CI until green.

### Phase 3: Review and publish

3.1 Dispatch exactly one final independent review of the stabilization branch, validate its evidence, and resolve findings.

3.2 Publish evidence, mark ready, and apply `automerge` only after final-head checks and review pass.

## Risks and initial evidence

- Latest main full CI 42812961362 succeeded, including all 15 integration shards and coverage. Previous four full CI runs also succeeded.
- Main snapshot 42812961550 is still running; preceding snapshot 42812120251 succeeded. A pending run is not a demonstrated failure.
- Initial scope is verification only. Code changes require tests and the configured ordered validation gate. A docs-only result follows the skill's docs-only validation exemption; hosted full CI remains mandatory for this operator's request.
- Operator authorization covers branch naming, workflow repairs, waiting for green, and the final `automerge` label; these override skill defaults.

## Run identity

Claim-Run: 4afca090-4a88-42be-a66e-e9da567d2738
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Diagnosis and validation evidence

- Independent read-only audit `111e29a2` found no actionable current main failure. Parent inspected its report and verified its zero-file delta against inherited tip `ffb1e6030`; no child changes were merged. Current main full CI [42812961362](https://github.com/open-mercato/open-mercato/actions/runs/42812961362), CodeQL [42812961079](https://github.com/open-mercato/open-mercato/actions/runs/42812961079), and dependency audit [42839721741](https://github.com/open-mercato/open-mercato/actions/runs/42839721741) passed.
- Historical snapshot failures were three TC-PORTAL-013 isolation-guard assertions: the Playwright process lacked `OM_INTEGRATION_TEST`. Merged #9176 supplies that flag in both standalone lanes; subsequent snapshot [42812120251](https://github.com/open-mercato/open-mercato/actions/runs/42812120251) passed. Latest snapshot [42812961550](https://github.com/open-mercato/open-mercato/actions/runs/42812961550) remains pending at this checkpoint, with publishing successful and standalone tests running. Historical Yarn minimum-age rejection recovered in later installations; no new dependency defect is claimed.
- Old manual QA deployment failed because `/app/AGENTS.md` was absent during the package build. Merged #9125 supplies both required root guides in the preview image stages. This run did not deploy or rerun that historical workflow; main Docker checks do not build the separate QA preview Dockerfile.
- Existing full-suite selection works without source changes. Parent re-ran the unchanged scope and merge-coverage regressions: 37 passed, zero failed. Runner: local, selected after no running compose app was found. This checkout has no installed dependencies; a temporary Node resolve hook maps only `yaml` to the cockpit's already installed package. No installation or repository changes were needed for these checks. The PR changes only this ledger, so the skill's docs-only gate applies; manual re-read and `git diff --check` pass. Full hosted PR validation is still mandatory before final handoff.
- Branch-protection required-check enumeration returned HTTP 404 (`Required status checks not enabled`). Inspect every reported PR check conservatively, including conditional skips. Initial PR CI [42840242283](https://github.com/open-mercato/open-mercato/actions/runs/42840242283) selected all 15 shards; no module filter was applied. New ledger pushes require fresh final-head validation.
- Reviewed head `15660f9fca03e1e7ce9f61954183aa5f09e9c56d` passed [full PR CI 42841940052](https://github.com/open-mercato/open-mercato/actions/runs/42841940052): all 15 integration shards, merge coverage, package build/generation/rebuild, app build, i18n checks, unfiltered type/unit/script tests, repository guards, lint, timezone, Docker and multi-instance checks. All 31 executed PR checks passed; three conditional checks intentionally skipped. [PR verification evidence](https://github.com/open-mercato/open-mercato/pull/9234#issuecomment-6771053483) records the validation source and limits.
- The one [final independent review](https://github.com/open-mercato/open-mercato/pull/9234#issuecomment-6771200896), task `7f02da79`, approved exact head `15660f9fca` with no findings or edits. Parent read its evidence, verified the zero-file reviewer delta and confirmed the reported hosted results. GitHub rejected native self-approval because the same App authored the PR; the independent verdict comment does not satisfy any native approval gate. This later commit only updates the verification ledger and lies outside that exact-SHA review; it changes no source or tests. No child changes were merged.
- Baseline snapshot [42812961550](https://github.com/open-mercato/open-mercato/actions/runs/42812961550) subsequently passed publication and standalone integration. Main advanced to `43f920900b3097ec534a9e4f4bb8b93e4b17036f`; its [full CI 42842222646](https://github.com/open-mercato/open-mercato/actions/runs/42842222646) passed, while its [snapshot 42842222685](https://github.com/open-mercato/open-mercato/actions/runs/42842222685) remains in progress at this checkpoint. No pending workflow is represented as passed.

## Final publication gate

This ledger update starts a fresh full-suite run. The PR remains draft with `Status: in-progress` until that final head passes every applicable check and the outstanding main snapshot is resolved. Publication evidence and final readiness/`automerge` actions are recorded in PR #9234's body and timeline to avoid another documentation push invalidating the final-head check results. No runtime defect was demonstrated and no corrective code was added.

## Progress

PR: #9234

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose

- [x] 1.1 Independently audit current main workflows and confirm remaining failures — ffb1e6030; audit 111e29a2 validated, no remaining defect established

### Phase 2: Validate

- [x] 2.1 Fix demonstrated defects and pass applicable validation with full PR CI — 15660f9fca; full CI 42841940052 green, no remaining defect found

### Phase 3: Review and publish

- [x] 3.1 Complete final independent review and resolve findings — 15660f9fca; review 7f02da79 approved, no findings
- [ ] 3.2 Publish evidence and apply automerge after final-head checks pass — final publication is tracked in the PR body and timeline under the gate above
