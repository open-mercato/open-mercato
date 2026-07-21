# Phase 1 — Scoping (docs → Epic/Story tree) + the completeness gate

The full Phase-1 procedure `om-gap-analysis` runs before any verification: read all client materials, produce one structured MD with an Epic → Story tree where every story has an empty gap-analysis placeholder, then pass the completeness gate.

## Steps

1. **Project slug** — kebab-case (`dental-clinic`, `b2b-marketplace`). Drives output filenames. Ask if unclear.
2. **Read all inputs.** Walk the input directory. Track each fact's source — you cite it in the story `**Source**` field.
3. **Extract requirements** across inputs: explicit feature requests, pain points in transcripts, integrations, compliance/multi-tenancy/GDPR/audit needs, reporting.
4. **Group into Epics** (4–10). A coherent area of value. Not one giant epic, not fifty tiny ones.
5. **Break each Epic into Stories** small enough for a single subagent to verify in one pass (1–3 acceptance criteria, one bounded capability). User/role perspective where possible.
6. **Suggest priority and dependencies.** P0 (blocking foundation), P1 (core), P2 (nice-to-have). Dependencies reference Story IDs.
7. **Write the MD** to `.ai/gap-analysis/<project>.md` (create the dir). Template below.
8. **Run the completeness gate (Phase 1.5), still in this session** — it edits the MD interactively. Only after the gate returns 0:

   > Phase 1 + completeness gate complete. Saved `<full-path>`.
   > Next: run `/clear`, then re-invoke om-gap-analysis with: `Run gap-analysis phase 2 on <full-path>`

**Do not start Phase 2 in the same session, and do not `/clear` until `bin/gap-checklist-gate` returns 0.**

Story IDs (`Epic.Story`, e.g. `2.4`) are stable — never renumber after Phase 1.

## MD tree template

```markdown
---
project: <slug>
generated: <ISO date>
sources:
  - inputs/requirements.md
  - inputs/transcript-2026-04-15.txt
phase: 1-scoped
total_epics: <n>
total_stories: <n>
coverage_categories:
  - negative-path
  - abuse-case
  - race-condition
  - tenant-isolation
  - data-privacy
  - audit-log
---
<!-- coverage_categories is the completeness checklist bin/gap-checklist-gate enforces per epic.
     Extend it per domain when a run needs more (e.g. clinical-data-retention).
     Do NOT put inline `#` comments on the list or on coverage lines — the gate parses
     those literally. Use HTML comments on their own line, like this one. -->

# Gap Analysis — <Project Display Name>

> This file is the source of truth across all three phases.

## Epic 1: <Epic name>
**Goal**: <one-sentence outcome>
**Business value**: <why it matters to the client>

#### Coverage
<!-- Populated in Phase 1.5; checked by bin/gap-checklist-gate before Phase 2.
     Each category is EITHER a real story ref (`Story <id>`) OR `out-of-scope: <reason>` — never blank. -->
- negative-path: Story 1.2
- abuse-case: out-of-scope: <reason the client confirmed>
- race-condition: Story 1.4
- tenant-isolation: Story 1.3
- data-privacy: out-of-scope: <reason>
- audit-log: Story 1.5

### Story 1.1: <Story title>
- **Description**: <as a [role], I want [capability], so that [outcome]>
- **Acceptance criteria**:
  - [ ] <criterion>
- **Source**: <source-file>:<location or quote>
- **Priority**: P0 | P1 | P2
- **Dependencies**: <story IDs, or "none">
- **Status**: pending

#### Gap analysis
<!-- Filled by phase 2 via the gate. Do not edit by hand. -->
- **Verdict**: ⚪ not yet analyzed
- **Evidence**:
- **Criteria coverage**:
- **Grounding query**:
- **Grounding source**:
- **Gaps**:
- **Effort**:
- **Suggested implementation path**:
- **Upstream pipeline**:
- **Investigated**:
```

## Phase 1.5 — Completeness gate (before `/clear` → Phase 2)

**Why this exists.** Phase 2 verifies *whatever stories the tree contains*. A happy-path-only tree — "user books an appointment", nothing about double-booking, cancellation, permission denial, concurrency, GDPR, audit — yields a confident, complete-*looking* backlog that silently omits the hard 20%. Phase 1 only *mentions* NFRs, and a mention does not bind. So completeness is enforced **structurally**: a deterministic check outside the model loop.

**The check is `bin/gap-checklist-gate`, not a prose reminder.** Every epic must address each category in the MD's `coverage_categories` list, satisfied one of two ways: a real `Story <id>` reference **or** `out-of-scope: <reason>`. Blank, reasonless, or a reference to a story not in the MD all fail.

**Steps:**

1. **Populate the per-epic `#### Coverage` blocks.** For each epic, propose the missing negative-path / NFR stories *or* the explicit `out-of-scope: <reason>` for each unaddressed category, and write them into the block (adding the stories to the tree where needed). When `om-app-spec-writing` or another requirements skill is installed, delegate the story-critique to it — populating is authoring work; it is not what binds.
2. **Run the gate:**
   ```bash
   <skill-dir>/bin/gap-checklist-gate .ai/gap-analysis/<project>.md
   ```
   - **exit 0** → every epic covers every category. Proceed to `/clear` → Phase 2.
   - **exit 1** → at least one epic has a category in neither state (the gate prints which epic + which category). **Do not start Phase 2.** Go back to step 1 for the flagged epics.
3. **Only on exit 0**, hand off to Phase 2.

**Known limitation (scope it honestly, mirror `gap-validate-finding`).** A green checklist means *these declared dimensions are addressed*, **not** *the tree is complete*. A dimension not on the list (i18n, data-migration, observability) passes untouched — that is the price of decidability. You cannot enumerate every missing story, but you *can* decide "does each epic have a negative-path story or an explicit N/A per fixed category." Extend `coverage_categories` per domain when a run needs more; do not replace the gate with prose.
