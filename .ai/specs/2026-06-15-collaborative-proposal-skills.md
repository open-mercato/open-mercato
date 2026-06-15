# Collaborative Proposal Skills (pre-spec ideation)

> Status: **DRAFT — ready for implementation review**
> Scope: OSS · agentic skills (monorepo `.ai/skills/` + `packages/create-app` standalone shipment)

## TLDR

Add a new group of agentic skills — **collaborative / creative skills** — that let a team
ideate on a feature or module *before* a spec is written. They turn a loose idea into a
structured **proposal** that becomes the input to `om-spec-writing`. Collaboration between
teammates is **asynchronous and file-based**: proposals live as markdown under `.ai/proposals/`,
committed to git; each teammate runs the skill, the skill surfaces teammates' unanswered
questions, and appends new thoughts/answers. "Party mode" and similar methods are
**AI-persona facilitation for a single user**, not real-time multi-human sessions.

This spec (Phase 1) ships the two skills, the proposal file contract, and an **optional**
intake hook inside `om-spec-writing`. Installer-level "skill package" selection is **Phase 2**
(separate spec).

## Resolved decisions (Open Questions gate)

- **Q1 → both.** Skills live in the monorepo `.ai/skills/` *and* are shipped to standalone apps
  via `packages/create-app/agentic/shared/ai/skills/` + `generateShared()`.
- **Q2 → two skills.** `om-proposal` (proposal file + question gate + handoff) delegates to
  `om-brainstorm` (facilitation methods).
- **Q3 → yes, but optional.** `om-spec-writing` consumes a proposal **only when the proposal
  skills are installed**. Mechanism: a `references/proposal-intake.md` fragment that is copied
  into `om-spec-writing` *only* when the proposals group is installed; the SKILL.md step is
  guarded on the presence of that file, so an install without proposals is a clean no-op.
- **Q4 → move to subfolder.** A `ready` proposal is moved to `.ai/proposals/ready/`
  (lifecycle-folder pattern, mirroring `.ai/specs/`), with `status: ready` in frontmatter.

## Problem Statement

The current agentic flow jumps straight from "I have an idea" to `om-spec-writing`. There is no
structured ideation/collaboration phase where multiple teammates can contribute thoughts, raise
doubts, and have open questions tracked and answered before a spec is locked. BMAD-style
facilitation methods (party mode, Socratic questioning, etc.) are unavailable. The result: specs
start from one person's framing, with team doubts surfacing late (during review or QA) instead
of during ideation.

## Proposed Solution

### 1. Proposal file contract — `.ai/proposals/<YYYY-MM-DD>-<slug>.md`

Frontmatter:

```yaml
---
title: <human title>
status: open | ready | deferred
contributors: [<name>, ...]
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---
```

Body sections (stable contract — the skills and the intake hook depend on these headings):

- `## Idea / Context` — the problem and motivation.
- `## Open Questions` — checklist; each item carries an asker and a status
  (`open` / `answered` / `deferred`). Deferred questions persist; they are never deleted.
- `## Findings` — answers and the distilled output of brainstorming sessions.
- `## For the spec` — the brief `om-spec-writing` consumes as its starting point.

Lifecycle: a proposal starts `open`. When the team marks it `ready`, `om-proposal` moves the
file to `.ai/proposals/ready/` and sets `status: ready`. `deferred` proposals stay in the root
folder.

### 2. `om-proposal` skill

Behaviour on invocation:

1. **Scan** `.ai/proposals/*.md` (and `ready/`), surfacing **unanswered/deferred questions** from
   teammates across all open proposals.
2. **Ask** the user those questions one at a time, **always offering "defer"** — a deferred
   question is written back with `status: deferred` and is never lost.
3. **Ask** what the user wants to add and **which method** to use, then delegate facilitation to
   `om-brainstorm`.
4. **Append** new thoughts/answers/findings to the proposal file (creating it if new), updating
   `updated` and `contributors`.
5. **Handoff**: when the proposal is `ready`, move it to `.ai/proposals/ready/` and point the
   user at `om-spec-writing`.

### 3. `om-brainstorm` skill

Facilitation methods, adapted from [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
core-skills (attribution in `references/`):

- **Party mode** — AI role-plays a panel of personas (architect, PM, skeptic, end-user, …) that
  debate the idea. Single user; the personas are simulated, not real teammates.
- **Socratic** — the skill interrogates the idea with probing questions to expose assumptions.
- Additional lightweight methods (e.g. "5 whys", "yes-and") as `references/methods.md` entries.

Output of any method is written back into the active proposal's `## Findings` by `om-proposal`.

### 4. Optional intake hook in `om-spec-writing`

- Add `om-spec-writing/references/proposal-intake.md` describing: detect a matching
  `.ai/proposals/**/<slug>.md`, read its `## For the spec` + resolved `## Open Questions`, and use
  it as the starting brief (seeding the spec's own Open Questions from any still-`deferred` items).
- Add one guarded line to `om-spec-writing/SKILL.md` Workflow Step 1:
  *"Proposal intake (optional): if `references/proposal-intake.md` is present, follow it before
  initializing the spec file."*
- The reference file is copied by `generateShared()` **only** when the proposals group ships.
  Absent file ⇒ the guarded step is a no-op ⇒ zero behaviour change for installs without proposals.

### 5. Wiring

- **Monorepo**: create both skills under `.ai/skills/om-proposal/` and `.ai/skills/om-brainstorm/`;
  add the `references/proposal-intake.md` to `.ai/skills/om-spec-writing/` and the guarded SKILL.md
  step. Register in `.ai/skills/om-help/references/skills-catalog.md` and `workflow-sequences.md`
  with the chain **proposal → spec → implement**. Add a Task Router row in root `AGENTS.md`.
- **Standalone**: mirror both skills into
  `packages/create-app/agentic/shared/ai/skills/{om-proposal,om-brainstorm}/`, add the intake
  fragment to the create-app `om-spec-writing`, and extend `generateShared()` in
  `packages/create-app/src/setup/tools/shared.ts` to copy them (flat list, Phase 1) plus the
  guarded intake reference. Update `om-help` references shipped to standalone.

## Phasing

### Phase 1 — Skills + contract + optional intake (this spec)

| Step | Deliverable |
|------|-------------|
| 1.1 | Proposal file contract documented (frontmatter + sections) — captured in `om-proposal/references/proposal-template.md`. |
| 1.2 | `om-proposal` SKILL.md (scan → question gate w/ defer → method choice → append → ready-handoff/move). |
| 1.3 | `om-brainstorm` SKILL.md + `references/methods.md` (party mode, Socratic, +light methods) with BMAD attribution. |
| 1.4 | `om-spec-writing` optional intake: `references/proposal-intake.md` + guarded SKILL.md step (both monorepo + create-app copies). |
| 1.5 | Monorepo wiring: `om-help` catalog + workflow-sequences entries; root `AGENTS.md` Task Router row. |
| 1.6 | Standalone wiring: mirror skills into `agentic/shared/ai/skills/`; extend `generateShared()` copy list + intake fragment; update shipped `om-help` references. |
| 1.7 | Tests: extend `packages/create-app/src/setup/tools/shared.test.ts` to assert the new skills + intake fragment are generated. |

### Phase 2 — Installer skill-package selection (deferred, separate spec)

Refactor `generateShared()` from a flat copy list to a **group manifest**, add a wizard prompt
(`wizard.ts`) asking which skill packages to install, and gate the proposals group (and its
`om-spec-writing` intake fragment) on that selection. Out of scope here.

## Backward Compatibility

- **Additive only.** New skills + new reference files. No existing skill is removed or renamed.
- The `om-spec-writing` change is a single guarded step keyed on an optional file; installs
  without the proposals group are byte-for-byte unaffected in behaviour.
- `generateShared()` gains copies; existing copied skills are untouched. No contract-surface
  removal (see `BACKWARD_COMPATIBILITY.md` — auto-discovery / CLI surfaces unchanged).

## Testing & Verification

- `packages/create-app/src/setup/tools/shared.test.ts`: assert `om-proposal`, `om-brainstorm`,
  and `om-spec-writing/references/proposal-intake.md` are written to the target dir.
- Manual: run `om-proposal` in a scratch repo — verify it creates `.ai/proposals/<date>-<slug>.md`,
  surfaces a seeded deferred question, defers correctly, and moves to `ready/` on completion.
- Manual: run `om-spec-writing` with and without the intake fragment present — confirm it consumes
  the proposal when present and is a no-op when absent.
- `yarn test:create-app` smoke (skills present in scaffold).

## Out of Scope

- Real-time multi-human collaboration (out of model for Claude skills).
- Installer package-selection mechanism (Phase 2, separate spec).
- Cross-tool parity for Codex/Cursor of the new skills (skills are Claude-oriented; revisit if needed).

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Skills + contract + optional intake | Done | 2026-06-15 | All steps 1.1–1.7 implemented; `shared.test.ts` 6/6 green; create-app typecheck clean. |
| Phase 2 — Installer skill-package selection | Not Started | — | Deferred to a separate spec. |

### Phase 1 — Detailed Progress
- [x] 1.1 Proposal file contract — `.ai/skills/om-proposal/references/proposal-template.md`
- [x] 1.2 `om-proposal` SKILL.md (scan → defer-aware question gate → method → append → ready/move)
- [x] 1.3 `om-brainstorm` SKILL.md + `references/methods.md` (party mode, Socratic, 5-whys, yes-and; BMAD attribution)
- [x] 1.4 `om-spec-writing` optional intake: `references/proposal-intake.md` + guarded SKILL.md step (monorepo + create-app)
- [x] 1.5 Monorepo wiring: `om-help` skills-catalog + workflow-sequences (§0); root `AGENTS.md` Task Router row
- [x] 1.6 Standalone wiring: mirrored skills into `agentic/shared/ai/skills/`; `generateShared()` copy calls + intake; shipped `om-help` references updated
- [x] 1.7 Tests: `shared.test.ts` asserts new skills + intake ship and are wired into `generateShared()`

> Note: standalone delivery also requires `yarn build` in `packages/create-app` (esbuild + `build.mjs` copies `agentic/` → `dist/agentic/`) before publishing; source-level wiring + tests are green.
