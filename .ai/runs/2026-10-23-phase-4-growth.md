# Execution plan — land PR #6867 (phase 4 — growth) past review (adopted from PR #6867)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` (run by hand) on 2026-10-23 because PR #6867 carried no execution plan.
**PR:** #6867 · **Branch:** `phase/4-growth` · **Base:** `main`
**Author:** @michalper — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal
Resolve the `CHANGES_REQUESTED` review on PR #6867: fix the real `main` merge conflict, close the PII-oracle gap on `rescore`/`segments/overlap`, fix the referral-conversion timing defect, land the easy-scoped minors, and land the phase-4 spec file.

## Scope
`packages/marketing-automation` growth-phase surfaces: segments overlap, lead scoring/rescore, referrals, price watches (demand), lead routing, score-rules pagination, sweep/bulk actions, CSV export. Plus the `.ai/specs` phase-4 doc and the phased-delivery roadmap line.

## Non-goals
Rebasing/force-pushing; touching PRs #6865/#6866; a new "best referrers" aggregation query if it requires new query-engine work beyond this phase.

## Evidence
| Conclusion | Drawn from | Confidence |
|---|---|---|
| Blocker: real conflict vs `main` in 5 shared files | om-auto-review-pr comment 2026-10-22, orchestrator brief | high |
| PII-oracle gap on rescore/segments-overlap | om-auto-review-pr review findings (major #2) | high |
| Referral conversion timing bug | om-auto-review-pr review findings (major #3), orchestrator brief | high |
| Six minor issues (error reporting, 50k cap notice, CSV cap notice, score-rules pagination, referrers view, lead-routing nav gating) | orchestrator brief items 4–9 | high |

## Assumptions
- Follow #6865/#6866 convention for the phase-4 spec roadmap line (one line per phase PR).
- "best referrers" view (#8) is skipped if it needs a new aggregation query beyond this phase's scope.

## Risks
- `risk-high` already applied; merge-conflict resolution on shared infra files (Dockerfile, package.json, eslint config, yarn.lock) carries real build risk — mitigated by full validation gate.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Phase-4 growth feature set (segments/scoring/referrals/watches/routing) + 20 integration specs — bc00783fb

### Phase 2: Merge conflict resolution

- [ ] 2.1 Merge `origin/main`, resolve the 5 known-conflicting files on the merits, check for drift overlap in CrudForm/DataTable/channel-resend/module-registry/i18n

### Phase 3: Blocker/major fixes

- [ ] 3.1 Gate `rescore` and `segments/overlap` routes behind `customers.people.view`; extend guard tests for the oracle pattern
- [ ] 3.2 Fix referral-conversion timing defect; add before/after ordering test

### Phase 4: Minor fixes

- [ ] 4.1 Route sweep/bulk-action error catches through `reportError`
- [ ] 4.2 Surface the 50k bulk-action candidate cap to the user
- [ ] 4.3 Add a capped-export indicator to the CSV export
- [ ] 4.4 Fix score-rules pagination past 100 rows and its truncation note
- [ ] 4.5 Gate the lead-routing nav entry behind its page's ACL feature
- [ ] 4.6 Decide on "best referrers" view (#8) — implement if small, else document as skipped

### Phase 5: Spec + validation + review

- [ ] 5.1 Land `.ai/specs/2026-10-20-marketing-automation-phase-4-growth.md` + roadmap line
- [ ] 5.2 Full validation gate
- [ ] 5.3 Self-review pass, push, outcome comment, finalize
