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

### Phase 2: Validate and review
2.1 Run the configured validation commands in order and obtain green PR CI including all 15 integration shards. Fix root causes and repeat as necessary.
2.2 Dispatch one final independent review through cezar, applying om-auto-review-pr and compatibility/security/scope checks; address findings before completion.

### Phase 3: Publish outcome
3.1 Update evidence, release claim, promote the draft when complete, and apply automerge only after all CI and review gates pass.

## Risks
Full suite may reveal additional failures after the compile blocker. UI changes require QA evidence and retain the QA merge gate. Remote CI is authoritative for runner-dependent checks. No production or base-branch mutations are authorized or planned. Local runner selection must follow the repository probe.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [ ] 1.1 Independently audit main failure history and existing full-suite selection
- [ ] 1.2 Repair duplicate ComboboxInput declarations with regression coverage

### Phase 2: Validate and review

- [ ] 2.1 Run configured validation and obtain green full-suite PR CI
- [ ] 2.2 Complete final independent review and address findings

### Phase 3: Publish outcome

- [ ] 3.1 Publish evidence and enable guarded automerge after green CI
