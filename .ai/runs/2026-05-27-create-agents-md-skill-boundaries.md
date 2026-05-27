# Run plan — Align `create-agents-md` skill with Always/Ask First/Never/Validation Commands convention

**Date:** 2026-05-27
**Slug:** create-agents-md-skill-boundaries
**Branch:** fix/create-agents-md-skill-boundaries
**Base:** develop (refs/janitor/origin/develop @ be2275040)
**Follow-up to:** PR #2082 (`docs: organize AGENTS.md agent instructions`)

## Overview

PR #2082 reorganized all 31 project-owned `AGENTS.md` files into a consistent four-section boundary structure (`Always`, `Ask First`, `Never`, `Validation Commands`) and documented that convention in the root `AGENTS.md` under `## Boundary Labels for Agent Rules`. The reviewer (`pkarw`, re-review of head `785204e`) approved the PR with a single Low finding:

> `.ai/skills/create-agents-md/SKILL.md` still prescribes the old `## MUST Rules` heading. The per-rule pattern (`**MUST [verb]** — [rationale]`) is preserved inside the new sections, so the skill is not contradicted at the rule level, but new AGENTS.md generated via the skill would not match the new structure. … A small follow-up PR can migrate them and update the create-agents-md skill.

This run updates the skill so that future invocations produce AGENTS.md files matching the merged convention.

### External References

- None. No `--skill-url` arguments were passed. The authoritative source is the merged PR #2082 diff and the root `AGENTS.md` "Boundary Labels for Agent Rules" section.

## Goal

Update `.ai/skills/create-agents-md/SKILL.md` so that agents who invoke this skill generate AGENTS.md files with the new `Always / Ask First / Never / Validation Commands` structure, matching the convention already applied to all 31 project-owned AGENTS.md files in PR #2082 and documented in the root `AGENTS.md`.

## Scope

- Update `.ai/skills/create-agents-md/SKILL.md`:
  - File-structure template uses `Always / Ask First / Never / Validation Commands` headings (in that order).
  - Per-rule pattern `**MUST [verb]** — [rationale]` is preserved (the reviewer explicitly called this out as preserved and correct).
  - Verification checklist updated to require the four boundary headings.
  - Anti-patterns and reference examples updated to point at canonical post-#2082 files (e.g. `packages/cache/AGENTS.md`).
  - Cross-link to root `AGENTS.md` → "Boundary Labels for Agent Rules" so the skill stays aligned with the authoritative definition.

## Non-goals

- **Not** migrating the other stale docs the reviewer flagged (`apps/docs/docs/framework/widget-injection.md`, `packages/{cache,ui,queue,search}/agentic/standalone-guide.md`). The user brief is explicit: "update the create agents md skill". A separate follow-up PR can handle docs migration; folding it in here would widen scope and dilute review.
- **Not** changing any AGENTS.md files. PR #2082 already did that work.
- **Not** changing the underlying rule-writing pattern (`**MUST [verb]** — [rationale]`). The reviewer confirmed it is preserved by the new structure and not contradicted at the rule level.
- **Not** touching root `AGENTS.md`. The "Boundary Labels for Agent Rules" section is already authoritative.

## Risks

- **Low** — Docs-only change to a skill file. No runtime, contract, generator, schema, ACL, event ID, widget spot ID, route, or DI surface is touched. Skill files are agent-facing instructions, not code.
- **Stale references** — If any other doc references the old "MUST Rules" heading in this skill, those should still resolve since the per-rule pattern `**MUST …**` is preserved. The skill still teaches MUST rules — it just nests them under the new boundary headings.
- **External-skill conflicts** — None; no external `--skill-url` was supplied.

## Implementation Plan

### Phase 1: Update the skill

- Step 1.1: Replace the `## MUST Rules` heading in the file-structure template with the four boundary headings (`## Always`, `## Ask First`, `## Never`, `## Validation Commands`) in the order documented in root `AGENTS.md`.
- Step 1.2: Update the "MUST Rules Requirements" section to "Boundary Rules Requirements" (or equivalent) — keep the minimum-rule count guidance but re-frame it as "minimum rules under Always" since that is where MUST/MUST NOT rules now live.
- Step 1.3: Refresh the verification checklist so it asserts all four boundary headings exist and are populated.
- Step 1.4: Refresh reference examples to point at the post-#2082 canonical files (`packages/cache/AGENTS.md`, `packages/queue/AGENTS.md`, etc.). Confirm those files still exemplify the points the skill claims.
- Step 1.5: Add a short pointer at the top of the skill linking to root `AGENTS.md` → "Boundary Labels for Agent Rules" as the authoritative source.

### Phase 2: Self-review and validation

- Step 2.1: Diff the SKILL.md change and confirm the per-rule pattern `**MUST [verb]** — [rationale]` is preserved.
- Step 2.2: Manually verify that each reference example (e.g. `packages/cache/AGENTS.md`) actually contains the four boundary headings in the post-#2082 tree.
- Step 2.3: Run docs-relevant validation: a grep for the four headings in the referenced AGENTS.md files, plus `node --check`/markdown sanity (no real linter exists for this skill file). Repo-wide build/test/lint gates do not apply to a single skill file, but record what was run.

### Phase 3: PR open + auto-review

- Step 3.1: Commit each phase's work with a conventional-commit subject (`docs(skills): …`).
- Step 3.2: Push, open the PR against develop, body templated per `auto-create-pr` SKILL.md.
- Step 3.3: Apply pipeline labels: `review`, plus `skip-qa` and `documentation` (docs-only, no customer-facing behavior).
- Step 3.4: Run the `auto-review-pr` skill in autofix mode against the new PR; apply any actionable findings as new commits (never amend).
- Step 3.5: Post the comprehensive summary comment per the skill's step 12.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Update the skill

- [ ] 1.1 Replace `## MUST Rules` with four boundary headings in the file-structure template
- [ ] 1.2 Re-frame "MUST Rules Requirements" as boundary-rules requirements
- [ ] 1.3 Refresh verification checklist for the four headings
- [ ] 1.4 Refresh reference examples to point at post-#2082 canonical files
- [ ] 1.5 Add pointer to root `AGENTS.md` → "Boundary Labels for Agent Rules"

### Phase 2: Self-review and validation

- [ ] 2.1 Confirm per-rule MUST pattern is preserved in the new template
- [ ] 2.2 Verify referenced AGENTS.md files exemplify the four boundary headings
- [ ] 2.3 Run grep/sanity validation and record it

### Phase 3: PR open + auto-review

- [ ] 3.1 Commit phases with conventional-commit subjects
- [ ] 3.2 Push and open PR against develop
- [ ] 3.3 Apply `review`, `skip-qa`, `documentation` labels with comments
- [ ] 3.4 Run `auto-review-pr` autofix pass and address findings
- [ ] 3.5 Post the comprehensive summary comment
