# Execution plan — om-pr-autopilot skill

## Goal

Give the PR toolchain a single entry point that takes one open PR, works out
what state it is actually in, and dispatches the right chain of existing `om-*`
skills to drive it to the end — instead of requiring the operator to already
know which skill applies.

## Scope

- New local skill `om-pr-autopilot` under `.ai/skills/`, assigned to the
  `automation` tier.
- A thin `SKILL.md` router plus three `references/` files (diagnosis procedure,
  state matrix, reporting contract).
- Manifest and catalog updates: `.ai/skills/tiers.json`, `.ai/skills/README.md`.

## Non-goals

- No changes to any existing skill. `om-auto-continue-pr`, `om-auto-fix-pr`,
  `om-auto-qa-pr`, `om-auto-review-pr`, and `om-approve-merge-pr` keep their
  current behavior and are invoked verbatim.
- No new merge authority: the dispatcher stops at merge-ready by default and
  never touches the QA gate.
- No changes to the label taxonomy, the pipeline states, or CI.

## Why a dispatcher and not another pipeline skill

The repository already has every execution step. What is missing is the routing
decision — a PR can be an unfinished plan run, an unreviewed but complete
change, a red-CI change, a conflicted branch, or a merge-ready change waiting on
QA, and each of those needs a different skill first. Encoding the diagnosis and
the routing table once removes the guesswork and makes a wrong first step (for
example reviewing a PR whose implementation is not finished) much less likely.

## Implementation plan

### Phase 1: Skill

- 1.1 Write `SKILL.md` — arguments, chaining contract, the diagnose → classify →
  confirm → chain → report workflow, and the safety rules (no implicit merge,
  hard QA gate, no green-by-cheating, review-only on other authors' PRs).
- 1.2 Write `references/diagnose.md` — the ten read-only state signals with the
  tracker operations that produce them, plus the `PR State Report` template.
- 1.3 Write `references/state-matrix.md` — the ordered state → chain table and
  the notes that change the chain (fork, draft, spec-only, overlap with
  `om-auto-fix-pr`).
- 1.4 Write `references/report.md` — the summary-comment template, the label
  derivation rules, and the `403` no-triage fallback.

### Phase 2: Registration

- 2.1 Add `om-pr-autopilot` to the `automation` tier in `.ai/skills/tiers.json`.
- 2.2 Add the catalog row and refresh the tier count in `.ai/skills/README.md`.
- 2.3 Verify with `sh scripts/validate-skills-tiers.sh`.

### Phase 3: Verification

- 3.1 Exercise the diagnosis procedure against real open PRs and confirm every
  command in `references/diagnose.md` runs (including the GraphQL
  unresolved-review-thread query) and that the matrix produces a sensible chain.

## Risks

- **Chain overlap.** `om-auto-fix-pr` already contains review + CI + UI QA, so a
  naive reading of the matrix could run those twice. Mitigated by the explicit
  re-diagnose-between-steps rule and a matrix note.
- **Docs-only change to agent instructions.** The skill is markdown; its real
  behavior depends on the delegated skills staying stable. Mitigated by
  invoking them verbatim and never duplicating their logic here.
- **Operator surprise.** A dispatcher that silently merged would be dangerous —
  hence merge is opt-in via `--allow-merge` and the QA gate is restated as a
  hard rule inside the skill.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Skill

- [ ] 1.1 Write SKILL.md router
- [ ] 1.2 Write references/diagnose.md
- [ ] 1.3 Write references/state-matrix.md
- [ ] 1.4 Write references/report.md

### Phase 2: Registration

- [ ] 2.1 Add the skill to the automation tier in tiers.json
- [ ] 2.2 Add the catalog row and tier count in README.md
- [ ] 2.3 Verify with validate-skills-tiers.sh

### Phase 3: Verification

- [ ] 3.1 Exercise the diagnosis procedure against real open PRs
