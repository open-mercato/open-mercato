# Skill Author Handoff Reassignment

## Goal

Update the GitHub automation skills so PRs that receive `changes-requested` are handed back to the PR author, and issues that have just been fixed are handed back to the issue author, with explicit handoff comments.

## Scope

- Update `.ai/skills/auto-review-pr/SKILL.md`
- Update `.ai/skills/auto-fix-github/SKILL.md`
- Keep the change limited to skill instructions and comment templates

## Non-goals

- No product code changes
- No workflow changes outside the affected auto-skills
- No label policy changes beyond the new author-handoff behavior

## Implementation Plan

### Phase 1: Review Handoff Rules

1. Update `auto-review-pr` so every `changes-requested` outcome reassigns the PR to the original author and posts a clear handoff comment for the next action.
2. Update `auto-fix-github` so a fixed issue is reassigned to the issue author and gets a verification handoff comment after the fix PR is opened.

### Phase 2: Validation And Delivery

1. Re-read the updated skills for consistency with existing lock, label, and carry-forward rules.
2. Open a dedicated PR against `develop` containing only the skill updates.

## Risks

- `auto-review-pr` already has carry-forward logic for fork PRs, so the new reassignment wording must not conflict with the replacement-PR flow.
- `auto-fix-github` currently treats the current user as the long-term owner of the issue, so the new handoff must be explicit enough to avoid ambiguity about who verifies the fix next.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Review Handoff Rules

- [x] 1.1 Update `auto-review-pr` handoff rules and comment templates
- [x] 1.2 Update `auto-fix-github` handoff rules and comment templates

### Phase 2: Validation And Delivery

- [x] 2.1 Re-read the updated skills for consistency
- [ ] 2.2 Open a dedicated PR against `develop`
