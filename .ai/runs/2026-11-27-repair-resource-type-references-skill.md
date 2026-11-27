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

## Progress
PR: #10887

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Rewrite the repair

- [x] 1.1 Move the repair into the skill, wire app bootstrap, and adapt the regression tests. — 4473fc7229
- [ ] 1.2 Validate the replacement and prepare the pull request.
