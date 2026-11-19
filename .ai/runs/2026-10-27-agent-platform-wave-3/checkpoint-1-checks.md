# Checkpoint 1 — Steps 1.1..1.5

- **When:** 2026-10-27
- **Steps covered:** 1.1..1.5 (`5be83a2f0`..`4bb405adb`)
- **Touched areas:** `packages/ai-assistant` (dispatcher port, `defineAgentTool`, `mcpTool` synthesis, structured MCP agent-tool results, `GET /api/ai_assistant/tools?view=mcp`, settings page "MCP exposure" section, ai_assistant i18n)
- **Runner:** local mode (no compose `app` container for this worktree)

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages` | pass | Rebuilt after `yarn generate` so `packages/core/dist/generated` exists |
| `packages/ai-assistant` jest (all suites) | pass | 158/158 suites, 2130 tests |
| `packages/shared` jest `src/lib/ai` | pass | 8 suites, 67 tests |
| `yarn i18n:check-sync` | pass | |
| `yarn i18n:check-usage` | pass | advisory unused-key count only |
| `yarn typecheck` | pass | |
| `yarn lint` | pass | |
| `yarn build:app --force` | pass | see below |
| UI browser check / screenshots | skipped | No dev server runs from this worktree (port 3000 serves an unrelated project). The new section is covered by `components/__tests__/McpExposureSection.test.tsx`; browser evidence is deferred to the final-gate integration run. |

## Notes

- `PendingActionDetailPageClient.test.tsx` failed to load during Steps 1.2–1.5 executor runs (`#generated/entities.ids.generated`, resolved through `@open-mercato/core` `dist/generated`). Cause: `build:packages` ran before `yarn generate` in the fresh worktree. Fixed by rebuilding; not a code defect.
- PLAN.md commit SHAs for 1.1–1.5 corrected to the post-amend values.
