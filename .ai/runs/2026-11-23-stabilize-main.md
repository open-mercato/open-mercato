# Stabilize main CI — 2026-11-23

## Goal
Diagnose main CI failures, repair their root causes, and verify every full-suite PR check before adding `automerge`.

## Scope
Use `stabilize/main-2026-11-23` from main at d45d98f51a. Reuse the existing trusted `ci-full`/`stabilize/` full-suite selection. Limit fixes to evidenced CI failures and regression coverage.

Non-goals: merge into main, bypass checks, weaken assertions, change public contracts, apply local database migrations, or change unrelated product behavior.

## Implementation Plan

### Phase 1: Diagnose and repair
1.1 Inspect current and recent main failures; reproduce and fix any remaining root causes with regression coverage.
1.2 Verify the existing full-suite selector and run the configured validation gate using the local runner or exact CI evidence where local prerequisites block execution.

### Phase 2: Verify and review
2.1 Run all 15 integration shards and all other CI checks on this PR, correcting failures until green.
2.2 Dispatch one independent final review, address findings, record evidence, and apply automerge only after green CI and approval.

## Risks
Main continues moving; evidence is tied to this branch's exact head. Full CI can take an hour. Existing main failures may already be fixed; do not invent fixes. Local dependency/tool availability may require hosted CI for the configured gate. The user explicitly authorized stabilization branch naming, CI workflow fixes, draft PR creation, and CI monitoring through completion.

## Delegation
One independent read-only investigation of recent failure signatures; parent owns all coupled implementation and validation. One final independent review after implementation (maximum two child tasks).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [ ] 1.1 Inspect current and recent main failures; reproduce and fix any remaining root causes with regression coverage.
- [ ] 1.2 Verify the existing full-suite selector and run the configured validation gate using the local runner or exact CI evidence where local prerequisites block execution.

### Phase 2: Verify and review

- [ ] 2.1 Run all 15 integration shards and all other CI checks on this PR, correcting failures until green.
- [ ] 2.2 Dispatch one independent final review, address findings, record evidence, and apply automerge only after green CI and approval.
