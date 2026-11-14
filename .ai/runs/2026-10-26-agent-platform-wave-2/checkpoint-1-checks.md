# Checkpoint 1 — Steps 0.1..1.5

- **When:** 2026-10-26
- **Steps:** 0.1, 1.1, 1.2, 1.3, 1.4, 1.5 (`9d5d8802e`..`d6051d574`)
- **Touched areas:** `@open-mercato/ai-assistant` (`lib/agent-call-contract.ts`, `lib/agent-call-observer.ts`, `lib/agent-definition-hash.ts`, `lib/agent-runtime.ts`, `lib/agent-registry.ts`, `lib/ai-agent-definition.ts`, `src/index.ts`, tests); observability spec changelog
- **Runner:** local mode (no compose `app` container)

| Check | Result |
|---|---|
| `yarn build:packages` + `yarn generate` (fresh worktree) | ✅ pass, no tracked files changed |
| `packages/ai-assistant` jest (all suites) | ✅ 144 suites, 1946 tests passed |
| App typecheck (`apps/mercato/scripts/typecheck.mjs`, covers ai-assistant) | ✅ exit 0 |
| `yarn lint` | ✅ 0 errors (10 pre-existing warnings in `apps/mercato/src/modules/example`) |
| UI verification | ⏭️ skipped — no UI touched in this window |

## Notes
- Phase 0 spike findings are recorded in the observability spec (2026-10-26 entry) and pinned by `lib/__tests__/ai-sdk-call-level-hooks.spike.test.ts`.
- Pre-existing defect found (not part of this run): the `tool-loop-agent` engine never passes the composed system prompt to `ToolLoopAgent` (`lib/agent-runtime.ts`, construction settings lack `instructions`). Reported to the user for a separate issue/PR.
- Tasks-table SHAs corrected to post-amend values in this checkpoint commit.
