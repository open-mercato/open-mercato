# Execution plan — QA gate: automated-verification exemption for changes with no UI surface

## Goal

Amend the `needs-qa` / `skip-qa` rules in `AGENTS.md` so that a change with no manually exercisable UI surface, shipping automated tests for the behavior it changes, takes `skip-qa` instead of `needs-qa` — replacing manual clicking that cannot happen with executable proof that already runs in CI.

## Why now (measured, not asserted)

Snapshot of `open-mercato/open-mercato` taken 2026-07-24:

- 171 open PRs; 152 non-draft.
- **38 non-draft PRs are blocked on nothing but the QA signature**: code review approved, CI green, no conflicts, `merge-queue` applied — held only because they carry `needs-qa` without `qa-approved`. That is the single largest blocker in the queue, ahead of failing CI (21) and conflicts (31).
- Across all 91 open PRs carrying `needs-qa`, **42 touch no UI-rendering file at all** — no `.tsx` outside tests, nothing under `packages/ui/src/`, no `**/components/**`. There is literally no screen for a QA reviewer to click through.
- **42 of those 42 ship automated test files in the same PR.** Zero exceptions. Every one of them already carries the verification that manual QA is being asked to duplicate.
- Exactly **one** open PR in the whole repository currently carries `qa-approved`.

The queue is not short of QA work performed; it is short of QA work that manual exercise can meaningfully perform. Examples from the 42: "block redirect-hop SSRF in sync-akeneo", "enforce inbound webhook timestamp replay window", "scope S3 list prefixes to tenant namespace", "cap the organizations list pageSize". None of these are verifiable by clicking; all of them are verifiable by the tests they ship.

## Scope

- `AGENTS.md` — the `needs-qa` bullet, the `skip-qa` bullet, and one new bullet defining the exemption and its conditions.

## Non-goals

- Do not weaken the QA-approval merge gate itself. A PR carrying `needs-qa` still MUST NOT merge without `qa-approved`.
- Do not touch `.ai/agentic.config.json` (`qaGate: true` stays), any `om-auto-*` skill, any CI workflow, or any label definition.
- Do not relabel any existing PR. This change defines the rule; applying it to the open queue is a separate maintainer decision.
- Do not carve out `security` or `risk-high` as automatically exempt or automatically disqualified — the criterion is the presence of a manually exercisable surface, not the risk band.

## Implementation Plan

### Phase 1: Land the plan and open the draft PR

- Commit this plan, push the branch to the contributor fork, open a draft PR against `develop`.

### Phase 2: Amend AGENTS.md

- Qualify the `needs-qa` bullet: it presumes a surface a reviewer can exercise by hand.
- Extend the `skip-qa` bullet with the new category and point at the definition.
- Add the exemption bullet: what counts as a UI-rendering file, the mandatory test-coverage condition, the translation-only case, and the reviewer's explicit override back to `needs-qa`.

### Phase 3: Validate and summarize

- Docs-only run: re-read the diff, confirm no rule contradicts the QA-approval merge gate or the `qa`-label rules, and post the summary comment with the measured numbers.

## Risks

- **The rule could be read as "security changes skip QA."** Mitigated by stating explicitly that the criterion is the absence of an exercisable surface, that risk band does not qualify or disqualify a PR, and that a reviewer may always override back to `needs-qa` with a stated reason.
- **Author conflict of interest.** The author has PRs sitting in the affected queue. Disclosed in the PR body; the supporting numbers are reproducible from the GitHub API so the argument does not rest on the author's word.
- **The maintainer may prefer a different mechanism** (more QA capacity, triage permissions, automated `qa-approved`). This PR is a proposal on a policy surface the repository's own rules put under "Ask First"; it is expected to be decided by the maintainer, not merged on the author's judgment.

## Progress

PR: #4448

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Land the plan and open the draft PR

- [x] 1.1 Commit the execution plan and push the branch — 543df237f
- [x] 1.2 Open the draft PR against `develop` — 543df237f

### Phase 2: Amend AGENTS.md

- [x] 2.1 Qualify the `needs-qa` bullet — 239785290
- [x] 2.2 Extend the `skip-qa` bullet — 239785290
- [x] 2.3 Add the automated-verification exemption bullet — 239785290

### Phase 3: Validate and summarize

- [x] 3.1 Re-read the diff for contradictions with the QA-approval merge gate — 239785290
- [x] 3.2 Post the summary comment and flip the PR to ready
