# Execution plan — remediate deal status vocabulary design review (adopted from PR #7624)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-10-25 because PR #7624 carried no execution plan.
**PR:** #7624 · **Branch:** `spec/deal-status-vocabulary` · **Base:** `main`
**Author:** @haxiorz — this plan records the authorized review remediation.

## Goal

Address the specification findings in review https://github.com/open-mercato/open-mercato/pull/7624#pullrequestreview-5643589933 and request re-review.

## Scope

Amend `.ai/specs/2026-10-18-deal-status-vocabulary.md` and this plan. Keep the PR documentation-only.

## Non-goals

No runtime code, schema, dependencies, pipeline automation, or implementation of #5546. Implementation remains in PR #7625.

## Evidence

| Conclusion | Drawn from | Confidence |
| --- | --- | --- |
| Keep the design separate from implementation | PR description and implementation handoff comment linking #7625 | High |
| Inventory every classification reader/writer, including SQL summary and company/person KPIs | Review by @wojciechszyjka, grounded against customer and dashboard call sites | High |
| Add required sections, reclassification confirmation, explicit ACL/source behavior and env template work | Same changes-requesting review | High |

## Assumptions

The review remediation may clarify the existing feature contract but does not implement it. Runtime validation and UI evidence belong to #7625. The original review remains authoritative until its reviewer re-reviews the amended design.

## Risks

An incomplete consumer inventory would make tenant configuration inconsistent. A design-only reclassification guard must be carried into the implementation and its tests.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Define tenant deal status vocabulary and index the design — f60416c4c74889f091fab6a4d34800778cb8667c

### Phase 2: Specification review remediation

- [x] 2.1 Ground an exhaustive consumer table and endpoint/UI coverage against the codebase — 01405041239d9b57da28e7f3d0dfb63ad98445bb
- [x] 2.2 Add required sections, persisted-deal reclassification confirmation, ACL/source rules and env template wiring — 01405041239d9b57da28e7f3d0dfb63ad98445bb
- [x] 2.3 Review the amended design through all five specification lenses and check the documentation diff — 01405041239d9b57da28e7f3d0dfb63ad98445bb
- [x] 2.4 Publish the corrections, account for all inherited findings and request the original reviewer's re-review — 2674516cdf3ee4b27e921a5cbf5996657cca31d7

## Verification outcome

The amended design was audited through all five specification lenses against existing customer, config and dashboard call sites. All five inherited findings are addressed. `git diff --check upstream/main...HEAD` passes; configured runtime gates are inapplicable to this documentation-only diff. GitHub's reported checks were successful/skipped at review time; required-check configuration is inaccessible to the integration (403), and newly scheduled CI is not certified here.

Re-review was requested from @wojciechszyjka. The original changes-requesting review and pipeline label remain in place pending that review. No self-approval, merge, review dismissal or implementation change was performed. Runtime delivery remains in PR #7625.
