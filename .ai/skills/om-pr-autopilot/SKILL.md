---
name: om-pr-autopilot
description: Open Mercato repo-local extension of the shared `om-pr-autopilot` skill (installed from open-mercato/skills into .agents/skills/). Adds this repo's label taxonomy and QA gate, the concrete diff-scope classification, what a triage-permission `403` means for the claim when the active account hits one, and the install command for a missing companion skill.
---

# PR Autopilot — Open Mercato extension

This file extends the shared `om-pr-autopilot` skill from [open-mercato/skills](https://github.com/open-mercato/skills) (installed at `.agents/skills/om-pr-autopilot/SKILL.md`). Follow the shared skill's full workflow — agentic setup, PR resolution, outer claim, the ten diagnosis signals, the state matrix, chain execution, the summary report, lock release — with the repo-specific rules below layered on top.

The shared skill's own references (`references/diagnose.md`, `references/state-matrix.md`, `references/report-templates.md`, `references/claim-pr.md`, …) live next to it under `.agents/skills/om-pr-autopilot/`; they are not committed here. When the shared skill or any companion it dispatches to is missing, run `yarn install-skills` and re-enter — never improvise a substitute procedure for the claim, worktree, diagnosis, or setup mechanics.

## Diff-scope classification (this repo's layers)

The shared `references/diagnose.md` signal 4 asks for the diff's scope. In this repository, classify against:

- **spec-only** — only `.ai/specs/` or `.ai/specs/enterprise/` (the config's `paths.specs`). A spec-only PR gets the specification review and must never grow into implementation here.
- **docs-only** — `apps/docs/`, root markdown, `AGENTS.md` files, `.ai/skills/`, `.ai/runs/`.
- **UI-touching** — `packages/ui/`, any module's `backend/` or `frontend/` pages and components, and the customer-portal surfaces. This is what drives `needs-qa`.
- **migration/schema** — `migrations/`, `.snapshot-open-mercato.json`, ORM entities under `data/entities.ts`.
- **contract surface** — anything enumerated in `BACKWARD_COMPATIBILITY.md`: auto-discovery files, exported types and signatures, import paths, event IDs, widget spot IDs, API routes, DB schema, DI keys, ACL feature IDs, notification IDs, CLI commands, generated registries. A touch here forces `risk-high` and deeper review.

## Label taxonomy and the QA gate

The label vocabulary, the mutual-exclusion groups, and the priority/risk inference rules are defined in the root `AGENTS.md` → PR Workflow section; read it rather than restating the taxonomy. Three repo rules bind the chain:

- **The QA-approval merge gate is hard.** A PR carrying `needs-qa` without `qa-approved` MUST NOT merge, even when everything else is green. `skip-qa` is the explicit opt-out; never combine it with `needs-qa`/`qa-approved`.
- **Never set the `qa` pipeline label.** It means "manual QA in progress" and is applied by QA reviewers only. This skill and everything it dispatches request QA with `needs-qa` alone.
- **`qa-failed`, `blocked`, and `do-not-merge` are hard blocks** — matrix row 0c stops on them.

## When the active account lacks triage rights

Triage permission here depends on **which account the run is executing as**: a maintainer run assigns and labels normally, an outside-contributor run cannot. Never assume either way — perform the full three-signal claim exactly as the shared `references/claim-pr.md` prescribes, and degrade only in response to a real permission error.

When **assign-pr** or `apply_label` actually returns a `403` (`replaceActorsForAssignable` / `addLabelsToLabelable`), that is an expected outcome for a contributor account, not an incident: the outer claim degrades to the 🤖 claim comment alone, the release path tolerates the absent `in-progress` label, and the intended label set is listed in the summary comment addressed to a maintainer. Do not retry the mutation that failed, and never report a label or an assignee as applied when it was not — the reverse holds too: when the mutations succeed, the claim and the label state machine run in full.

## Validation

This skill dispatches rather than validating; the delegated skills own the gate. When one of them runs it, the ordered `validation.commands` list in `.ai/agentic.config.json` is the CI-mirroring gate, and the Docker-vs-local runner decision in root `AGENTS.md` § Validation Commands applies. Prefer GitHub PR check results over re-running the gate locally, per `.ai/skills/om-auto-review-pr/SKILL.md`.
