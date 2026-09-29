# Execution plan — om-pr-autopilot skill

## Goal

Give the PR toolchain a single entry point that takes one open PR, works out
what state it is actually in, and dispatches the right chain of existing `om-*`
skills to drive it to the end — instead of requiring the operator to already
know which skill applies.

## Scope

Revised in Phase 5 per @pkarw's request: the dispatcher itself is agnostic and
ships in the shared collection, and this repository keeps only the stack-specific
override. The phases below are preserved as the historical record of how the run
got here — Phases 1–4 describe the superseded local-only implementation.

- The agnostic skill lives upstream in `open-mercato/skills`
  (open-mercato/skills#65), where it carries its own `SKILL.md` router and
  `references/` (diagnosis, state matrix, reporting, plus its own copies of the
  standard step files), and every tracker read goes through a named descriptor
  operation rather than a `gh` command.
- This repository ships only the thin repo-local override
  `.ai/skills/om-pr-autopilot/SKILL.md` — the diff-scope layers, the label
  taxonomy and QA gate pointer, the degraded-claim path for an account without
  triage rights, and the validation/runner pointer. No `references/` here.
- Registration in `.ai/skills/tiers.json` is `external` (not a tier), so
  `validate-skills-tiers` treats the folder as an override and `install-skills`
  never symlinks it into the harness directories; the `.ai/skills/README.md` row
  moved to the external list accordingly.
- Merge order is cross-repository: open-mercato/skills#65 lands first, then this
  PR — the override is inert until `yarn install-skills` can fetch the shared
  skill.

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

PR: #4525

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Skill

- [x] 1.1 Write SKILL.md router — 0d9f45717
- [x] 1.2 Write references/diagnose.md — 0d9f45717
- [x] 1.3 Write references/state-matrix.md — 0d9f45717
- [x] 1.4 Write references/report.md — 0d9f45717

### Phase 2: Registration

- [x] 2.1 Add the skill to the automation tier in tiers.json — b043fb4cf
- [x] 2.2 Add the catalog row and tier count in README.md — b043fb4cf
- [x] 2.3 Verify with validate-skills-tiers.sh — b043fb4cf

### Phase 3: Verification

- [x] 3.1 Exercise the diagnosis procedure against real open PRs — b043fb4cf

### Phase 4: Review follow-up (om-auto-review-pr, 2026-07-27)

- [x] 4.1 Drop the hardcoded account handle from diagnose.md and state-matrix.md
- [x] 4.2 Split the fork note on ownership — own-fork PRs are pushable
- [x] 4.3 Document the `403` no-triage fallback for the claim step
- [x] 4.4 Add the `update-comment` fallback and list the operation in SKILL.md
- [x] 4.5 Read the specs path from `paths.specs` instead of hardcoding it
- [x] 4.6 Register the skill in the om-help catalog; fix README row ordering
- [x] 4.7 Decide on @pkarw's request — port as an agnostic skill to
      `open-mercato/skills` with a repo-local override here. Decision: do it.

### Phase 5: Split per @pkarw — agnostic upstream + repo-local override

- [x] 5.1 Port the skill to `open-mercato/skills` as an agnostic skill —
      open-mercato/skills#65 (tracker operations instead of `gh`, own copies of
      the standard step files, roster + README + docs entry, `scripts/lint.sh`
      passes)
- [x] 5.2 Reduce `.ai/skills/om-pr-autopilot/` here to a thin override —
      diff-scope layers, label taxonomy + QA gate, the no-triage-rights reality,
      validation pointer; `references/` deleted (they live upstream now)
- [x] 5.3 Move the registration from the `automation` tier to `external` in
      `tiers.json`, and the README row into the external list
- [ ] 5.4 Merge order — this PR waits for open-mercato/skills#65 to land, since
      the override is inert until `yarn install-skills` can fetch the shared
      skill

### Phase 6: Review follow-up (@pkarw, 2026-07-27)

- [ ] 6.1 Blocker — open-mercato/skills#65 must be review-clean and merged first.
      Every finding of its review (3 majors, 5 minors, 2 nits) was addressed on
      2026-07-28 and the branch is `MERGEABLE` again at `d08952c`; the PR still
      shows `CHANGES_REQUESTED` and its `lint` run is `action_required`, both of
      which only a maintainer can clear. Stays open until #65 merges.
- [x] 6.2 Major — make the no-triage fallback conditional on the active caller
      instead of an unconditional repository fact (SKILL.md + frontmatter) — 6f98dd400
- [x] 6.3 Minor — refresh the plan's top-level Scope to describe the upstream
      skill + thin override + external registration + cross-repo merge order — 6f98dd400
