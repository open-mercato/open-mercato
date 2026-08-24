# Execution plan — finish the dashboard diacritics fix without closing the broader locale issue (adopted from PR #5539)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-24 because PR #5539 carried no execution plan.
**PR:** #5539 · **Branch:** `fix/issue-5497-dashboard-diacritics` · **Base:** `develop`
**Author:** @haxiorz — this plan interprets the PR and review intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Ship the verified dashboard comparison-label corrections while keeping issue #5497 open and accurately tracking its remaining repository-wide Polish and Spanish catalog scope.

## Scope

- Preserve the eleven Polish and Spanish dashboard comparison-label corrections and their exact regression assertions.
- Address the requested review change by replacing the closing issue keyword with a non-closing reference.
- Record the dashboard-only coverage on issue #5497 so its remaining locale sweep stays visible.
- Re-run the configured validation gate and the authoritative PR review workflow.

## Non-goals

- Correct every remaining stripped diacritic across all Polish and Spanish catalogs.
- Add or redesign a repository-wide orthography lint rule.
- Reword dashboard labels beyond restoring the intended diacritics.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The existing code and regression test correctly fix eleven dashboard labels. | PR #5539 diff and the completed review by @pkarw | high |
| PR #5539 must not close issue #5497. | Issue #5497's approximately 85-string scope and the requested-change review | high |
| The remaining catalog sweep should stay separate from this small verified fix. | Reviewer's preferred remedy and the PR's dashboard-only title/body/diff | high |
| No inline review feedback remains to address. | GitHub review-thread and inline-comment APIs | high |

## Assumptions

- “Fix issue” means resolving the actionable PR review finding while preserving the broader tracker issue for follow-up, because the review explicitly recommends that narrower and more reversible resolution.
- The existing exact assertions remain the appropriate regression coverage for this PR; the reviewer classified a broader deny-list test as an optional nit that does not affect the verdict.

## Risks

- A closing keyword could be reintroduced later and prematurely retire #5497; the PR body and issue comment will make the intended partial scope explicit.
- The residual locale defects remain user-visible until separate work completes #5497; this PR deliberately does not hide or close that scope.

## External References

- Issue #5497: https://github.com/open-mercato/open-mercato/issues/5497
- Dashboard-only scope note on issue #5497: https://github.com/open-mercato/open-mercato/issues/5497#issuecomment-5389418692
- PR #5539: https://github.com/open-mercato/open-mercato/pull/5539

## Validation Record

- Runner: local, using the bundled Node.js v24.19.0 runtime; no Docker Compose `app` service was running.
- `yarn build:packages` — passed before and after generation.
- `yarn generate` — passed with no tracked generated drift.
- `yarn i18n:check-sync` — passed; all five locale sets are synchronized.
- `yarn i18n:check-usage` — passed with advisory unused-key output only.
- `yarn typecheck` — passed across all configured package tasks.
- `yarn test` — passed across all 33 workspace tasks. Two earlier attempts encountered unrelated Jest worker `SIGSEGV`s under concurrent machine load; both affected suites passed serially, and the final exact full command passed.
- `yarn build:app` — passed; existing Turbopack dynamic-filesystem warnings remained non-blocking.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Restore eleven dashboard comparison-label diacritics and add exact regression assertions — 14a9700

### Phase 2: Address requested review scope correction

- [x] 2.1 Replace the closing issue linkage and record the dashboard-only coverage on issue #5497 — f4da892

### Phase 3: Re-verify and review the final PR

- [ ] 3.1 Run the configured validation gate on the final branch
- [ ] 3.2 Run the authoritative PR review workflow and resolve any actionable findings
