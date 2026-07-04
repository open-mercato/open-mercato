# Checkpoint 3 — Phase 3 skills 3.1–3.6 verified

**When:** 2026-07-04 (UTC)
**Steps covered:** 3.1 → 3.6 (SHAs 6aeef49ed … a2510f2f4)
**Packages touched:** `packages/create-app` (agentic skill markdown only)

## Restructured skills (thin SKILL.md + instructions.md / workflow/; existing references/ kept)

| Skill | SKILL.md lines (≤60) | Body |
|-------|----------------------|------|
| om-trim-unused-modules | 40 | instructions.md |
| om-spec-writing | 33 | instructions.md (+ kept references/) |
| om-help | 44 | workflow/mode-1-navigation.md + mode-2-knowledge.md (+ kept references/) |
| om-code-review | 32 | instructions.md (+ kept references/) |
| om-implement-spec | 34 | workflow/step-1..4 |
| om-auto-upgrade-0.4.10-to-0.5.0 | 42 | instructions.md |

## Checks

| Check | Result |
|-------|--------|
| `tsc --noEmit` (create-app) | ✅ pass (no TS touched) |
| Conformance + wizard + shared tests (non-build) | ✅ 32 pass, 0 fail |
| Every landed `SKILL.md` ≤ 60 lines | ✅ (32–44) |
| Every reference-map link resolves | ✅ (verified per skill at commit time) |
| Frontmatter `description` preserved verbatim | ✅ (executors diffed vs HEAD) |
| `{{PROJECT_NAME}}` preserved where present (om-spec-writing) | ✅ |

## Notes

- These 14 Phase-3 skills are not yet enforced by `agentic-skills-conformance.test.ts` (its `RESTRUCTURED_SKILLS` list still holds the 7 Phase-2 skills); Step 4.1 extends the list to all 21.
- Build-dependent tests (`module-facts-build` — runs `node build.mjs` needing `@open-mercato/cli/dist`) deferred to the final gate (`yarn build:packages` first), same as prior runs.

## UI verification

- N/A — skill markdown only. No Playwright.

## Outcome

6 of 14 Phase-3 skills done, all green. Continuing 3.7–3.14, then Phase 4 (extend guard + docs), then final gate.
