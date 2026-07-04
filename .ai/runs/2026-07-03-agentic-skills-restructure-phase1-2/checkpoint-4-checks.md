# Checkpoint 4 — Phase 3 skills 3.7–3.11 verified

**When:** 2026-07-04 (UTC)
**Steps covered:** 3.7 → 3.11 (SHAs 1835acc6b … c671d0b72)
**Packages touched:** `packages/create-app` (agentic skill markdown only)

## Restructured skills

| Skill | SKILL.md lines (≤60) | Body |
|-------|----------------------|------|
| om-prepare-issue | 42 | instructions.md |
| om-backend-ui-design | 32 | instructions.md (+ kept references/) |
| om-integration-tests | 35 | workflow/{run-and-diagnose,author-test,derive-from-spec}.md |
| om-eject-and-customize | 39 | workflow/step-1..4 |
| om-troubleshooter | 38 | workflow/{diagnostic-flow + 8 problem-area topics} (+ kept references/) |

## Checks

| Check | Result |
|-------|--------|
| `tsc --noEmit` (create-app) | ✅ pass |
| Conformance + wizard + shared tests (non-build) | ✅ 32 pass, 0 fail |
| Every landed `SKILL.md` ≤ 60 lines | ✅ (32–42) |
| Every reference-map link resolves | ✅ (verified per skill at commit time) |
| Frontmatter `description` preserved verbatim | ✅ |

## UI verification

- N/A — skill markdown only.

## Outcome

11 of 14 Phase-3 skills done. Remaining: 3.12 om-data-model-design (611), 3.13 om-module-scaffold (834), 3.14 om-system-extension (858) — the three largest. Then Phase 4 (extend guard to all 21 + docs) + final gate.
