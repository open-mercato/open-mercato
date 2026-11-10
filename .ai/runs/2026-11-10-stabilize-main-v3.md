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

## Progress

PR: #9234

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose

- [x] 1.1 Independently audit current main workflows and confirm remaining failures — ffb1e6030; audit 111e29a2 validated, no remaining defect established

### Phase 2: Validate

- [ ] 2.1 Fix demonstrated defects and pass applicable validation with full PR CI

### Phase 3: Review and publish

- [ ] 3.1 Complete final independent review and resolve findings
- [ ] 3.2 Publish evidence and apply automerge after final-head checks pass
