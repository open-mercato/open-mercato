# Step 1 — Pre-Flight & Plan the Phase

## Pre-Flight

1. **Identify the spec**: Locate the target spec file in `.ai/specs/`.
2. **Load context**: Read spec fully. Match affected tasks to the **Task → Context Map** in `AGENTS.md` and read all listed files (guides and skills).
3. **Load code-review checklist**: Read `.ai/skills/om-code-review/references/review-checklist.md` — this is the acceptance gate for every phase.
4. **Load lessons**: Read `.ai/lessons.md` for known pitfalls.
5. **Scope phases**: If the user specifies phases (e.g. "phases c-e"), filter to only those. Otherwise implement all phases sequentially.

## Plan the Phase

For **each phase** in the spec, start here. Read the phase from the spec. For each step within the phase:

- Identify files to create or modify (all paths under `src/modules/`)
- Identify which guides and skills apply (use the Task → Context Map in `AGENTS.md`)
- List required exports, conventions, and patterns from the relevant guides
- Note any cross-module impacts (events, extensions, widgets, enrichers)

Present a brief plan to the user before coding.

Then proceed to `step-2-implement-and-test.md`.
