# Main CI stabilization — 2026-11-13 14:50

## Goal
Restore green CI from main and verify all fixes together on one draft PR against main.

## Scope
Fix demonstrated CI failures without weakening validation. Preserve the existing trusted `stabilize/` / `ci-full` full-suite switch and PR concurrency isolation. Main currently fails package compilation because ComboboxInput duplicates its id declarations.

Non-goals: unrelated feature changes, contract changes, dependency upgrades, base-branch merges, or skipped/flaky-test suppression.

The earlier `stabilize/main-2026-11-13` branch belongs to closed PR #9425. Preserve it; use `stabilize/main-2026-11-13-1450` from origin/main instead. Explicit operator branch naming overrides the skill's fix/ prefix.

## Implementation Plan

### Phase 1: Diagnose and repair
1.1 Independently audit main failure history and existing full-suite selection (read-only child).
1.2 Repair duplicate ComboboxInput declarations with regression coverage; address further demonstrated failures on this branch.
1.3 Remove the footer-test setup race between tab navigation and opening dialogs, without weakening layout assertions.

### Phase 2: Validate and review
2.1 Run the configured validation commands in order and obtain green PR CI including all 15 integration shards. Fix root causes and repeat as necessary.
2.2 Dispatch one final independent review through cezar, applying om-auto-review-pr and compatibility/security/scope checks; address findings before completion.

### Phase 3: Publish outcome
3.1 Update evidence, release claim, promote the draft when complete, and apply automerge only after all CI and review gates pass.

## Validation evidence

All eight configured commands pass locally, including the full 51-task unit gate and production app build. Local runner prerequisites: short TMPDIR passed through Turbo, and user-local Info-ZIP unzip (no dependency or workflow changes).

PR CI 43437843458 passes builds, full unit/script/guard checks, Docker, timezone, durability, and 13 completed integration shards. Shard 7 reveals TC-CRM-7495 failing after its narrow-screen tab navigation unmounts the dialog; the correct deal was returned by search. Trace call@93 opens the modal at 656.8s; the pending `?tab=deals` RSC navigation started at 656.7s completes after the search, and the modal disappears. TC-CRM-7497 also flakes at the same tab-to-dialog transition. Both footer tests now start at `?tab=deals`; their layout and selection assertions remain intact. Managed ephemeral filtered verification passed all five TC-CRM-749* cases without retries, including both repaired footer tests (4.6s / 4.9s). The original remote run settled with all 14 other shards passing. The repaired head d1b0ffef38 passed full CI 43445668730, including all 15 shards and coverage aggregation: 31 reported checks succeeded and four non-applicable checks skipped. Both repaired footer cases passed first attempt in shard 7 (6.4s / 8.2s); that shard passed all 243 tests.

Runner: local (no configured compose app running). Immutable install completed. Combobox unit/dialog suites: 45 tests passed. Existing ci-full selection regressions: 25 tests passed. No DS token, appearance, or public contract change.

## Final review and publication

Independent review: https://github.com/open-mercato/open-mercato/pull/9455#issuecomment-6856517956 — approve, no findings, reviewed d1b0ffef38. The reviewer explicitly accepts clerical plan-progress/evidence updates only after that SHA; source/test/config changes require new review. GitHub rejected a native approving review because the reviewer authenticates as the authoring App. The recorded independent verdict does not replace any eligible native approval required at merge.

`automerge` was confirmed after the repaired head passed all reported checks, as explicitly requested. Timeline inspection showed that pkarw had already promoted the draft and applied `automerge` plus `automerge-force` at 15:15 UTC; those human actions are preserved. This task performs no merge and retains its owned claim during the final full-suite recheck triggered by this clerical completion record. Release only after that final head is green; normal merge gates remain in force.

## Risks
Full suite may reveal additional failures after the compile blocker. UI changes require QA evidence and retain the QA merge gate. Remote CI is authoritative for runner-dependent checks. No production or base-branch mutations are authorized or planned. Local runner selection must follow the repository probe.

## Progress
PR: #9455

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [x] 1.1 Independently audit main failure history and existing full-suite selection — 959f274d68 (read-only audit accepted; 25 routing regressions rerun)
- [x] 1.2 Repair duplicate ComboboxInput declarations with regression coverage — 8d916f51fe

- [x] 1.3 Remove the footer-test setup race between tab navigation and opening dialogs — 9509d0ec81

### Phase 2: Validate and review

- [x] 2.1 Run configured validation and obtain green full-suite PR CI — d1b0ffef38 (CI 43445668730: all 15 shards and coverage green; 31 successful checks, 4 non-applicable skips)
- [x] 2.2 Complete final independent review and address findings — d1b0ffef38 (independent approval without findings: PR #9455 comment 6856517956)

### Phase 3: Publish outcome

- [x] 3.1 Publish evidence and enable guarded automerge after green CI — d1b0ffef38 (evidence published; operator-requested label confirmed after green CI; existing human merge labels preserved)
