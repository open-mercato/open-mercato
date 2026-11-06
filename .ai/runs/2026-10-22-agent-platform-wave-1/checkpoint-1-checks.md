# Checkpoint 1 — Steps 0.1..1.5

- **Recorded:** 2026-10-22T14:34:48Z
- **Steps:** 0.1, 1.1, 1.2, 1.3, 1.4, 1.5 (commits 23c07ed2d..bed3a53a3)
- **Touched areas:** wave-1 specs; `packages/ai-assistant` MCP exposure (`lib/mcp-exposure.ts`, `lib/http-server.ts`, `lib/mcp-server.ts`, `lib/mcp-dev-server.ts`, `lib/types.ts`, `cli.ts`)
- **Runner:** local mode (no compose `app` container)

| Check | Result | Notes |
|---|---|---|
| `npx jest --config jest.config.cjs` (packages/ai-assistant, full) | ✅ pass | 121 suites, 1629 tests |
| `yarn build:packages` | ✅ pass | |
| `yarn generate` | ✅ pass | no generated-file drift |
| `yarn typecheck` | ✅ pass | 39/39 turbo tasks |
| UI verification | ⏭️ skipped | no Step in this window touched UI |

## Notes
- Commit column in PLAN.md corrected to the final SHAs in this checkpoint (executors record the pre-amend SHA by construction of the flip-then-amend procedure).
- Pushes to the PR branch are blocked by the local permission policy; commits are pushed by the user in batches.
