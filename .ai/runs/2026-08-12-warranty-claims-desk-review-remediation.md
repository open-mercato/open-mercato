# Execution plan — remediate the strict review findings on PR #4092

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-08-12 because PR #4092 carried no execution plan.
**PR:** #4092 · **Branch:** `feat/warranty-claims-desk` · **Base:** `develop`
**Author:** @haxiorz — the author explicitly requested that the confirmed review findings be fixed, pushed, verified through CI, and summarized on the PR.

## 🎯 Goal

Make the warranty claims desk safe and ready for another review by correcting every confirmed finding from the strict review of head `f1ec3089700cf423dd4b6e20b5cc467ccff56ad8`, adding regression coverage, passing the repository validation gate, pushing the fixes, and following CI to a terminal green result.

## Scope

- Warranty-claim authorization, AI mutation and attachment boundaries, adjudication, portal uploads, persistent subscribers, SLA delivery, vendor recovery, query indexing, search, and integration cleanup.
- The affected warranty backoffice and portal components, shared sales fixture helper, attachment field callback contract, and localized user-facing strings.
- Regression tests for each behavior changed by the remediation.
- Existing PR metadata, labels, verification evidence, and one final comprehensive summary comment.

## Non-goals

- No feature expansion beyond the already implemented warranty claims specification.
- No database migration application to a local database.
- No history rewrite or force-push.
- No removal of @pkarw or @zielivia as reviewers.
- No wholesale redesign of the portal claim tracker; preserve its approved hierarchy while replacing non-compliant literal visual values with semantic design-system tokens.

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| All confirmed strict-review findings are remaining work | Strict review of exact head `f1ec3089700c`, artifact hash `9955e60eec5e58e780255010deca7699b13746fab60e06c1d6f2d3ee68f0d49b` | high |
| A blind follow-up council found eleven additional actionable gaps | Strict review of exact head `ea625461c781`, subject hash `81031f4a325438164106cbca19eafbc5fc275270857ef0d5aa03bef01812f853`; all 18 provider candidates adjudicated | high |
| A second blind follow-up council found final correctness, concurrency, portal, and design-system gaps | Strict review of exact head `dd883632401e`, subject hash `49a5d9f95a4859b5ab3ecd80ae372104240d9ecc0cc8075fa1bed7b48e3cd4c0`; all 29 provider candidates adjudicated | high |
| A third blind follow-up council found nine final data-integrity, portal-recovery, lookup-concurrency, accessibility, and design-system gaps | Strict review of exact head `6a5203706326`, subject hash `da6f8bd63515ed99df0feb6b83e0c70048e8fcbaadeacbb2c5c27d7585f1060b`; all 18 provider candidates adjudicated, with nine confirmed and nine rejected | high |
| The complete local validation gate is green for the remediation head | `build:packages`, `generate`, `build:packages`, i18n sync/usage, `typecheck`, `build:app`, warranty and UI regressions, design-system lint, hardcoded-i18n audit, diff check, and lessons check passed; the full test run's isolated native worker crash passed immediately when rerun in-band | high |
| Security and data-integrity defects must be corrected before review | Repository authorization, event, AI mutation, module-coupling, and optimistic workflow contracts | high |
| User-facing and integration-helper defects require regression tests | Root AGENTS.md and the PR's existing integration-test commitment | high |
| The branch must be pushed and CI monitored to green | Explicit instruction from @haxiorz in this continuation session | high |

## Assumptions

- The supplied linked worktree is the intended implementation worktree; its unrelated modified `.ai/skills/om-prepare-test-env/SKILL.md` and untracked `output/` belong to the user and will not be staged or changed.
- The strict review's rejected candidates remain non-work and will not be reintroduced as speculative scope.
- The safest attachment remediation is to move the shared secure upload orchestration into the attachments module and resolve it through an optional DI service, preserving the portal API contract.
- Existing PR reviewers remain assigned while @haxiorz owns the implementation lock.

## Risks

- The change spans security, money-adjacent lifecycle behavior, optional-module coupling, event reliability, shared fixtures, and UI surfaces; focused regression tests plus the full configured gate are required.
- Attachment and SLA fixes have partial-failure behavior that is difficult to prove with happy-path tests alone; fault-injection coverage is required.
- UI changes can regress the approved design; retain the existing hierarchy while moving touched literal values to semantic tokens and the established design-system scale.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Implement the warranty and RMA claims desk feature through the reviewed head — f1ec30897

### Phase 2: Security and module boundaries

- [x] 2.1 Fix AI approval, attachment-target authorization, portal vendor-recovery authorization, assignee organization scope, adjudication fail-open behavior, trusted subscriber scope, and portal attachment ownership/quota orchestration — d76af23f4

### Phase 3: Data integrity and lifecycle reliability

- [x] 3.1 Fix overdue status parity, vendor-recovery source indexing and type eligibility, SLA partial-failure retry safety, claim search pagination, and time-driven SLA indicators — 6d211e46d, 748136040

### Phase 4: Test and UI contract remediation

- [x] 4.1 Fix non-idempotent sales fixtures, settings restoration, accessible tabs, clipboard error handling, terminal tracker state, localized search actions, modal/radius/button design-system drift, and associated regression coverage — 6d211e46d, 748136040
- [x] 4.2 Fix follow-up council gaps in list ID filtering, callback stability, conflict surfacing, portal pagination, batched assignee hydration, claim-type normalization, event translation, DataTable compatibility, and semantic visual tokens — 0bec828678
- [x] 4.3 Fix final council gaps in transactional attachment persistence, first-save concurrency, external-intake retry safety, lifecycle guards, replacement pricing, organization-scope refresh, portal errors and visuals, notification parity, and regression coverage — 491f1e20a
- [x] 4.4 Fix terminal council gaps in decimal normalization, scoped registration reads, portal compensation evidence, batched credit validation, stale lookup suppression, combobox semantics, and design-system scale usage — 0ab2d5dfe

### Phase 5: Verification and publication

- [ ] 5.1 Run targeted validation and the complete configured validation gate, then complete the authoritative PR review/autofix pass
- [ ] 5.2 Push the remediation commits, monitor exact-head CI to terminal success, update PR metadata and labels, and post the comprehensive summary comment
