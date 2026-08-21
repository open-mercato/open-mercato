---
name: om-followup-issue-from-pr
description: Open Mercato repo-local extension of the shared `om-followup-issue-from-pr` skill (installed from open-mercato/skills into .agents/skills/). Pins design-doc detection to .ai/specs/ (+ enterprise/), keeps the `enterprise` label, and hands specs off to om-implement-spec.
---

# Follow-up Issue From PR — Open Mercato extension

This file extends the shared `om-followup-issue-from-pr` skill from [open-mercato/skills](https://github.com/open-mercato/skills) (installed at `.agents/skills/om-followup-issue-from-pr/SKILL.md`). Follow the shared workflow with these repo specifics:

## Spec detection (design-doc mode)

Specs live in `.ai/specs/` (OSS) and `.ai/specs/enterprise/` (Enterprise). Filenames follow `{YYYY-MM-DD}-{kebab-case-title}.md`; legacy `SPEC-*` / `SPEC-ENT-*` names also count as specs. Ignore `.ai/specs/implemented/` — those are done. A follow-up that references a spec in `.ai/specs/enterprise/` gets the `enterprise` category label (via the `apply_label` guard) in addition to the shared labeling rules.

## Tracking-issue template

Use a `## Spec` section (not "Design doc") linking the spec path, and state the pickup path: run `/om-implement-spec` for spec implementation (or `/om-auto-fix-issue` for a scoped bug), noting the spec is actionable only after its spec PR is merged into `develop`.
