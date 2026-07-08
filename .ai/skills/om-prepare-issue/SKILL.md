---
name: om-prepare-issue
description: Open Mercato repo-local extension of the shared `om-prepare-issue` skill (installed from open-mercato/skills into .agents/skills/). Adds the --enterprise spec scope, duplicate-spec checks across both spec trees, and the om-implement-spec/om-auto-fix-github pickup path.
---

# Prepare Issue — Open Mercato extension

This file extends the shared `om-prepare-issue` skill from [open-mercato/skills](https://github.com/open-mercato/skills) (installed at `.agents/skills/om-prepare-issue/SKILL.md`). Follow the shared workflow with these repo specifics:

- **`--enterprise` (optional argument)**: write the spec under `.ai/specs/enterprise/` (commercial scope) instead of the default `.ai/specs/`; the spec PR then also carries the `enterprise` category label.
- **Duplicate check**: before writing, check both `.ai/specs/` and `.ai/specs/enterprise/` for an existing spec covering the same area — extend or supersede instead of duplicating, confirming direction with the user. Skim `.ai/lessons.md` for known pitfalls in the area.
- **Spec methodology**: the repo-local `om-spec-writing` skill (`.ai/skills/om-spec-writing/SKILL.md`) applies in full, including the compliance-review gate and OM spec template.
- **Tracking issue**: state the pickup path — `/om-implement-spec` for the spec implementation (or `/om-auto-fix-github` for a scoped bug), actionable only after the spec PR is merged into `develop`.
