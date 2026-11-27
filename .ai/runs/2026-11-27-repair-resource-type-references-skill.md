# Repair resource type references through an agent skill

## Goal

Replace PR #10647 with an installable maintenance skill and a standalone script for issue #8498.

## Scope

Preserve scoped preview, explicit apply, resource version updates, projection effects, and cache invalidation. Keep the normal resource commands and registered CLI surface intact.

## Implementation Plan

### Phase 1: Rewrite the repair

1. Move the repair into the skill, wire app bootstrap, and adapt the regression tests.
2. Validate the replacement and prepare the pull request.

## Risks

Apply changes historical data. The skill requires a preview and operator approval for the exact scope.

## Validation and handoff

The full local gate passed, including all 51 workspace test tasks and the production app build. The 135 targeted resources tests included disposable PostgreSQL. The standalone preview also ran against a disposable database.

Independent code review identified the event queue acknowledgement gap fixed in 62a8ab56f5. GitHub cannot record formal approval from the PR author, so the replacement remains a draft pending a GitHub reviewer. PR #10647 was closed unmerged after the replacement was published.

## Progress
PR: #10887

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Rewrite the repair

- [x] 1.1 Move the repair into the skill, wire app bootstrap, and adapt the regression tests. — 4473fc7229
- [ ] 1.2 Validate the replacement and prepare the pull request.
