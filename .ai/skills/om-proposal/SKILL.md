---
name: om-proposal
description: >
  Collaborative pre-spec ideation. Turn a loose idea into a structured proposal that becomes
  the input to om-spec-writing. Use when a team wants to ideate before a spec exists, when you
  hear "let's brainstorm a feature", "capture an idea", "open a proposal", "what should we
  build", "I have a rough idea", "gather the team's thoughts", or before writing a spec for a
  non-trivial feature/module. Collaboration is asynchronous and file-based via `.ai/proposals/`.
---

# om-proposal — Collaborative Pre-Spec Proposals

Proposals are the ideation layer **before** a spec. They live as markdown under
`.ai/proposals/`, committed to git, so teammates contribute **asynchronously**: each person runs
this skill, it surfaces teammates' unanswered questions, and appends new thoughts and answers.
A finished proposal hands off to `om-spec-writing`.

This skill manages the proposal file and the question gate. It delegates the actual idea
exploration to `om-brainstorm` (party mode, Socratic, …).

## File Contract — `.ai/proposals/<YYYY-MM-DD>-<slug>.md`

See [proposal-template.md](references/proposal-template.md) for the exact shape. The headings are
a **stable contract** — `om-brainstorm` and the `om-spec-writing` intake hook depend on them:

- Frontmatter: `title`, `status: open | ready | deferred`, `contributors`, `created`, `updated`.
- `## Idea / Context` — the problem and motivation.
- `## Open Questions` — checklist; each item names an asker and a status `open | answered | deferred`.
- `## Findings` — answers and distilled brainstorm output.
- `## For the spec` — the brief `om-spec-writing` consumes.

A `ready` proposal is moved to `.ai/proposals/ready/`; `deferred` and `open` proposals stay in the
root folder.

## Workflow

### Step 1 — Scan existing proposals

Read every file under `.ai/proposals/` (including `ready/`). Build a list of all
**unanswered (`open`) and `deferred`** questions across proposals, noting which proposal and who
asked each one. If `.ai/proposals/` does not exist yet, create it.

### Step 2 — Surface teammates' open questions

Present the outstanding questions from other proposals to the user, grouped by proposal. For each,
the user may **answer** it (write the answer to `## Findings`, flip the item to `answered`) or
**defer** it. **Always offer "defer" explicitly** — a deferred question is written back with
`status: deferred` and is **never deleted**. Do not pressure the user to answer; deferral is a
first-class outcome.

### Step 3 — Capture what the user wants to add

Ask what the user wants to contribute and to **which** proposal (existing, or a new one — then ask
for a title and derive the `<slug>`). Create the file from the template if new, adding the user to
`contributors` and stamping `updated`.

### Step 4 — Choose a method and explore

Ask which facilitation method to use, then **delegate to `om-brainstorm`** (party mode, Socratic,
5-whys, …). Write the method's output into `## Findings`. New questions raised during exploration
are added to `## Open Questions` as `open`.

### Step 5 — Handoff

When the team considers the proposal complete:
- Ensure `## For the spec` holds a coherent brief and any still-`deferred` questions are listed
  there (so `om-spec-writing` can seed its own Open Questions from them).
- Set `status: ready`, **move the file to `.ai/proposals/ready/`**, and point the user at
  `om-spec-writing` (which will detect and consume the proposal when its intake hook is installed).

## Rules

- MUST offer "defer" for every question; deferred questions persist and are never deleted.
- MUST preserve the section headings exactly — they are the contract the other skills read.
- MUST append, never silently overwrite another contributor's content; update `updated` and
  `contributors` on every edit.
- MUST keep proposals free of secrets/credentials/customer data (they are committed to git).
- MUST NOT write the spec here — that is `om-spec-writing`'s job. This skill only produces the brief.
- Derive `<slug>` as kebab-case from the title; date is `YYYY-MM-DD`.
