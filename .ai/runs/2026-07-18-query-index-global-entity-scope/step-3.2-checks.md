# Step 3.2 checks — managed feature-toggle integration

Runner: managed ephemeral Docker environment (local host launcher).

## Passed

- Isolated `TC-FT-001` Playwright scenario: 1 passed.
  - The app and database were created by `yarn test:integration:ephemeral:start`.
  - The scenario verified the feature-toggle `entity_indexes` projection has explicit `organization_id = null` and `tenant_id = null` after create and update, and is absent after delete.

## Repository-wide suite blocker

`yarn test:integration:ephemeral` initializes and builds successfully, but Playwright then fails before test execution. Discovery includes stale sibling `.worktrees` that are not in the configured ignore list, producing missing stale `dist` imports and duplicate `@playwright/test` loads. This is independent of the feature test and its source files.
