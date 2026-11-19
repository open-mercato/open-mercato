# Checkpoint 2 — Steps 1.6, 2.1..2.4

- **When:** 2026-10-27
- **Steps covered:** 1.6, 2.1..2.4 (`1ed6bf8a3`, `891041691`..`abd0e1f0e`)
- **Touched areas:** ai-assistant docs + AGENTS.md; agent_orchestrator (`requiredFeatures` on agents and AGENT.md frontmatter, CLI agent-files generator, `lib/access/agentInvokeAccess.ts` + invoke check in `AgentRuntimeService.run`, run/rerun 403 mapping, delegate / workflow / eval invokers, filtered `GET /agents` + Playground picker, AO i18n); core `workflows` (`failInvokeAgentStep` records the error code)
- **Runner:** local mode

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages` | pass | |
| agent_orchestrator jest | pass | 185 suites, 1715 tests |
| core jest (`workflows` pattern) | pass | 299 suites, 3787 tests |
| cli jest `agent-files` | pass | 2 suites, 22 tests |
| ai-assistant jest | pass | 158 suites, 2130 tests |
| `yarn i18n:check-sync` / `i18n:check-usage` | pass | |
| `yarn typecheck` | pass | |
| `yarn lint` | pass | |
| `yarn build:app --force` | pass | |
| UI browser check / screenshots | skipped | Playground picker change (disabled non-invocable agents). No dev server runs from this worktree, and AO cannot be registered in the ephemeral app; covered by route unit tests. Deferred to the final gate. |
| `yarn agents:check-budget` | pass | run by the 1.6 executor after the ai-assistant AGENTS.md edit |
