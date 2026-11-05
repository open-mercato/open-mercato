# Complete main CI stabilization

## Goal
Keep full CI green after #8806 removed the main prepare failure.

## Scope
The workflow shell fixture inherits FORCE_FULL_SUITE=true from full CI. Give each fixture its own explicit flag and cover both ordinary and forced scope. No production or workflow behavior change.

## Risks
Other full-suite failures can emerge after this unit failure is repaired. #8806 merged externally while tests were pending.

## Progress
PR: #8834

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Repair
- [x] 1.1 Isolate scope fixture environment and verify full-suite regression — 27578b168

### Phase 2: Verify
- [ ] 2.1 Pass full stabilization CI and record review evidence
- [ ] 2.2 Update affected PR heads from fixed main where clean, without carry PRs
