# Execution plan: PR priority + QA-approval gate rules

Tracking plan for `om-auto-create-pr`.

## Goal

Make the priority labels first-class across the PR process and the `om-auto-*`
skills, and add a hard merge gate so a PR carrying `needs-qa` cannot be merged
without explicit QA approval — with a documented self-QA exception when the
dedicated QA reviewers have no capacity.

## Scope

- `AGENTS.md` (root) — PR Workflow section: new `qa-approved` / `qa-self-verified`
  meta labels, the QA-approval merge gate, the self-QA exception (no GitHub
  handles — referenced by role only), and broader priority-label guidance for
  auto-skills.
- `.github/workflows/merge-gate.yml` (new) — label-based merge-readiness status
  check that fails when `needs-qa` is present without `qa-approved`, and on hard
  blockers (`do-not-merge`, `blocked`, `qa-failed`, contradictory `needs-qa` +
  `skip-qa`).
- `.github/QA-DEPLOYMENT.md` — short note pointing at the new gate + self-QA path.
- `om-auto-*` skills — apply/infer a priority label and honor the QA-approval
  gate where it makes sense:
  - `om-auto-review-pr` — guess priority when missing; require `qa-approved`
    (or self-QA evidence) before `merge-queue`; never route a `needs-qa` PR to
    `merge-queue` without it.
  - `om-auto-create-pr`, `om-auto-create-pr-loop` — infer + apply a priority on PR open.
  - `om-auto-fix-github`, `om-auto-verify-and-fix-github` — carry the issue's
    priority to the PR (infer when absent).
  - `om-auto-continue-pr`, `om-auto-continue-pr-loop` — preserve priority; never
    force a `needs-qa` PR to `merge-queue` without `qa-approved`.
  - `om-auto-qa-scenarios` — explain how a passing QA route earns `qa-approved`.
  - `om-auto-sec-report-pr` — security findings default to high/extreme priority.

## Non-goals

- No change to branch-protection config itself (the gate is a status check the
  maintainer wires into required checks — documented, not auto-applied).
- No renaming of existing pipeline/category labels.
- No code changes outside `.github/` workflows and `.ai/` skill docs.

## Risks

- The merge gate is only a *signal* until the maintainer marks it a required
  check in branch protection. Documented explicitly so it is not assumed live.
- Label-only CI cannot verify a screenshot; the self-QA path relies on the
  engineer attaching evidence and applying `qa-approved` + `qa-self-verified`
  honestly. The gate enforces the label; the AGENTS.md rule enforces the evidence.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Rules + CI gate

- [x] 1.1 Extend AGENTS.md PR Workflow (qa-approved gate, self-QA exception, priority usage) — 045cd4b72
- [x] 1.2 Add `.github/workflows/merge-gate.yml` label gate — 045cd4b72, hardened in d2910719f (issues:read)
- [x] 1.3 Note the gate + self-QA path in `.github/QA-DEPLOYMENT.md` (+ PR template) — 045cd4b72

### Phase 2: Auto-skill updates

- [x] 2.1 om-auto-review-pr: guess priority + enforce qa-approved gate — 96383b1e9
- [x] 2.2 om-auto-create-pr (+loop): infer/apply priority on PR open — 96383b1e9
- [x] 2.3 om-auto-fix-github + om-auto-verify-and-fix-github: carry issue priority — 96383b1e9
- [x] 2.4 om-auto-continue-pr (+loop): preserve priority + honor qa-approved gate — 96383b1e9
- [x] 2.5 om-auto-qa-scenarios + om-auto-sec-report-pr: QA-approval + priority notes — 96383b1e9

### Phase 3: CI fixes (post-open)

- [x] 3.1 Post-review fix: resolve `audit` job CVEs — pin `@grpc/grpc-js` 1.14.4 (GHSA-5375-pq7m-f5r2, GHSA-99f4-grh7-6pcq) and `esbuild` 0.28.1 (GHSA-gv7w-rqvm-qjhr) via root `resolutions`

### Phase 4: Risk labels (follow-up — same shape as priority)

> Added per maintainer request: extend the label system with `risk-low` / `risk-medium` / `risk-high` exactly the way priority labels were added. Risk = blast radius of the change (orthogonal to priority = urgency). Risk labels already existed in the repo with no description; this phase makes them first-class.

- [x] 4.1 Add risk-label rules + risk-inference rule to root `AGENTS.md` PR Workflow (orthogonal-to-priority framing)
- [x] 4.2 Document risk labels in the canonical taxonomy spec `.ai/specs/implemented/2026-04-13-pr-label-workflow.md` (section, create-cmd, table, Phase 6, descriptions); add GitHub label descriptions
- [x] 4.3 Mirror priority handling for risk across `om-auto-*` skills: create-pr (+loop) apply; fix-github / verify-and-fix-github carry from issue; review-pr infer/preserve/mutually-exclusive; continue-pr (+loop) preserve; qa-scenarios depth-by-risk; sec-report-pr → `risk-low`; prepare-issue `--risk` flag
- [x] 4.4 Add a `risk-*` checklist item to the PR template

## Changelog

- 2026-06-13 — Shipped as PR #3055 against `develop`. `label-gate`, `validate-skills-tiers`, and `lint` checks green. New `qa-self-verified` GitHub label created. Gate still needs to be wired into branch protection as a required check by a maintainer to enforce.
- 2026-06-13 — Phase 4 (follow-up): added `risk-low` / `risk-medium` / `risk-high` labels as first-class signals (blast radius, orthogonal to priority). Mirrored priority handling across all `om-auto-*` skills + `om-prepare-issue` `--risk`, documented in root `AGENTS.md` and the canonical label spec, added a PR-template checklist item, and attached descriptions to the pre-existing GitHub risk labels.
