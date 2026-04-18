# Step 2.1 — Add `AiAgentDefinition` type and `defineAiTool()` helper

**Commit:** `a6191c741` — `feat(ai-assistant): add AiAgentDefinition type and defineAiTool() helper`
**Scope:** Spec Phase 0 (Alignment Prerequisite), delivery 1553–1554.

## What landed

- New `packages/ai-assistant/src/modules/ai_assistant/lib/ai-agent-definition.ts` — `AiAgentDefinition` type with every optional field from spec §2 (`executionMode`, `defaultModel`, `acceptedMediaTypes`, `requiredFeatures`, `uiParts`, `readOnly`, `mutationPolicy`, `maxSteps`, `output`, `resolvePageContext`, `keywords`, `domain`, `dataCapabilities`) plus five supporting type aliases (`AiAgentExecutionMode`, `AiAgentMutationPolicy`, `AiAgentAcceptedMediaType`, `AiAgentDataOperation`, `AiAgentPageContextInput`, `AiAgentStructuredOutput`, `AiAgentDataCapabilities`) and an identity `defineAiAgent()` helper for author-site type inference.
- New `packages/ai-assistant/src/modules/ai_assistant/lib/ai-tool-definition.ts` — identity `defineAiTool()` builder returning `AiToolDefinition<TInput, TOutput>`, as specified in the spec's §1 "Additive Tool Builder" (thin additive builder over the existing MCP-compatible tool shape).
- Extended `packages/ai-assistant/src/modules/ai_assistant/lib/types.ts` — converted `AiToolDefinition` from a plain alias of `McpToolDefinition` to an interface extending it with optional additive fields: `displayName`, `tags`, `isMutation`, `maxCallsPerTurn`, `supportsAttachments`. All fields are optional, so every existing `aiTools: AiToolDefinition[]` plain-object export stays valid (BC verified by a dedicated test).
- Updated `packages/ai-assistant/src/index.ts` — re-exports `defineAiAgent`, `defineAiTool`, and every `AiAgent*` type so consumers import from `@open-mercato/ai-assistant`.

## Verification

### Unit tests (mandatory)

- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/ai-agent-definition.test.ts` — new suite, 7 tests covering:
  - `defineAiTool` identity behavior (minimal tool)
  - `defineAiTool` preserving all additive focused-agent metadata
  - BC assignability: a `defineAiTool(...)` return value satisfies both `AiToolDefinition` and `McpToolDefinition`
  - BC: a plain-object `AiToolDefinition` authored without the builder still type-checks
  - `defineAiAgent` identity behavior (minimal agent)
  - `defineAiAgent` accepting every optional spec field, including a `resolvePageContext` callback
  - Compile-time shape contract for the minimal `AiAgentDefinition`
- Command: `npx jest --config=jest.config.cjs --forceExit` (from `packages/ai-assistant/`).
- Result: **10 suites, 150 tests — all passing**. New suite passed in 0.237s.

### Typecheck

- Full repo typecheck via `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app` (the `ai-assistant` package has no `typecheck` script so I verified through its consumers).
- Result: failures on `@open-mercato/events` (`sanitize-html`), `@open-mercato/core` (`pdfjs-dist`, `mammoth`, `@dnd-kit/*`, `@tanstack/react-virtual`, implicit-any on `DataTable.tsx`) — **all pre-existing on develop, reproduced by stashing my changes and re-running the same command**. No new diagnostics introduced by this Step.
- Grep `ai-agent-definition|ai-tool-definition|ai-assistant.*lib/types|ai_assistant` against the full typecheck output: **no matches**, confirming the new files do not introduce errors.

### i18n / Playwright / generate / build

- **N/A**. Step 2.1 is types + an identity builder. No user-facing strings, no UI, no generated files, no routes, no database surface. Playwright skipped per skill rules (non-UI Step).

### Scope re-read

- `git diff` touches only: two new `lib/` files, the test file, two lines in `types.ts`, and the index re-exports. No scope creep — no runtime loader, no generator, no policy gate, no CLI command.
- No raw `em.findOne(` / `em.find(` usages introduced (types file only).
- No API response shape change, no event ID, no widget spot ID, no ACL ID, no DI name, no import-path churn for existing consumers.

## BC self-review

- `AiToolDefinition` converted from `type AiToolDefinition = McpToolDefinition` to `interface AiToolDefinition extends McpToolDefinition` with five optional fields. All existing call sites continue to compile because:
  - Assigning an `McpToolDefinition` (no optional fields set) to an `AiToolDefinition` is safe — all new fields are optional.
  - Assigning an `AiToolDefinition` to `McpToolDefinition` is safe — subset compatibility.
  - `aiTools: AiToolDefinition[]` exports in existing modules remain structurally compatible.
- `McpToolDefinition` itself is unchanged (MCP contract surface is frozen).
- No removed exports, no renamed exports. `@open-mercato/ai-assistant` surface grows by `defineAiAgent`, `defineAiTool`, and 8 `AiAgent*` types only.

## Residual risk

- The `defineAiTool()` identity function does not yet feed the runtime tool loader — that is Step 2.3's job (Restore loading of generated `ai-tools.generated.ts`). Until Step 2.3, a module authoring tools with `defineAiTool()` still relies on `registerMcpTool()` at bootstrap to reach the MCP surface. This matches the spec's "additive over the existing contract" framing.
- `AiAgentDefinition` has no generator backing it yet — that is Step 2.2.
