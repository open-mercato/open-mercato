---
name: om-auto-continue-pr-loop
description: Open Mercato repo-local extension of the shared `om-auto-continue-pr-loop` skill (installed from open-mercato/skills into .agents/skills/). Pins the spec-completion gates (OM integration suites + om-ds-guardian), the .ai/specs/enterprise spec scope, and legacy flat-plan resume support.
---

# Auto Continue PR Loop — Open Mercato extension

This file extends the shared `om-auto-continue-pr-loop` skill from [open-mercato/skills](https://github.com/open-mercato/skills) (installed at `.agents/skills/om-auto-continue-pr-loop/SKILL.md`). Follow the shared workflow with these repo specifics:

- **Spec sources**: `.ai/specs/` or `.ai/specs/enterprise/` (enterprise scope); run-folder contract in `.ai/runs/README.md`.
- **Legacy plan format**: PRs opened before the run-folder migration may carry `Tracking plan: .ai/runs/<date>-<slug>.md` (flat file). Honor it: create `.ai/runs/<date>-<slug>/`, move the flat plan in as `PLAN.md`, and initialize `HANDOFF.md`/`NOTIFY.md` as part of the resume's first commit.
- **Spec-completion gates**: "the repo's integration suite" means `yarn test:integration` plus `yarn test:create-app:integration` when template-synced surfaces changed; "any style-compliance pass" means the `om-ds-guardian` skill when UI was touched.
- **Validation runner**: pick Docker vs local per root `AGENTS.md` § Validation Commands before running the gate.
