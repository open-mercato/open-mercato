# Stabilize main CI — 2026-11-23 20:11

## Goal
Find and fix current main CI root causes, run this PR's full suite until green, then apply `automerge` after independent review.

## Scope
Start from main `a433fc7e8dc35006424b72bce90685fcb60630d3` on `stabilize/main-2026-11-23-2011`. The exact date slot previously merged as #10411; the 16:00 occurrence is #10452, so this occurrence uses its scheduled time suffix. Existing trusted `stabilize/` and `ci-full` selectors already run all 15 integration shards.

Non-goals: merging into main, weakening assertions, skipping failing checks, unrelated product changes, public contract changes, local database migrations, or taking over other active runs.

## Implementation Plan

### Phase 1: Diagnose and repair
1.1 Investigate the latest main failure and apply demonstrated root-cause fixes with regression coverage.
1.2 Validate the focused fixes and full-suite selection; run the ordered configured gate locally or document unavailable prerequisites and obtain equivalent hosted evidence.

### Phase 2: Full CI and review
2.1 Run this PR's full CI, including all 15 shards, and fix every remaining failure.
2.2 Dispatch one final independent review task, resolve findings, record exact-head evidence, and apply `automerge` after CI and review pass.

## Delegation
One read-only investigation of TC-SALES-9594 and recent CI evidence (no source edits). Parent owns coupled implementation, branch, tracker and validation. One final independent review task after own work is complete. Maximum two child tasks; no other delegation.

## Risks
Latest main run 45212804817 failed in TC-SALES-9594 payment-menu visibility. Related active #10286 owns its own branch; inspect without claiming or changing it. Failures must be diagnosed rather than dismissed because earlier checkpoints passed. Local dependencies may be absent; hosted CI can supply full validation evidence. Main continues moving, so proofs must identify exact SHAs. User explicitly authorizes branch/CI automation edits and monitoring through green despite the skill's default bounded CI follow-up.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Diagnose and repair

- [ ] 1.1 Investigate the latest main failure and apply demonstrated root-cause fixes with regression coverage.
- [ ] 1.2 Validate the focused fixes and full-suite selection; run the ordered configured gate locally or document unavailable prerequisites and obtain equivalent hosted evidence.

### Phase 2: Full CI and review

- [ ] 2.1 Run this PR's full CI, including all 15 shards, and fix every remaining failure.
- [ ] 2.2 Dispatch one final independent review task, resolve findings, record exact-head evidence, and apply `automerge` after CI and review pass.
