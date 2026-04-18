# Step 2.5 — Checks

**Step title:** Spec Phase 0 — Unit tests: existing `ai-tools.ts` modules still register and execute; new discovery paths are additive.

**Scope:** TESTS ONLY. Phase 2 closeout — cross-cutting regression + additivity coverage for Phase 0's four deliverables (2.1–2.4). No production-code edits.

## Files touched

- Added `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/phase-0-additive-contract.test.ts` — 12 tests across 4 `describe` blocks:
  1. restored module-tool loading is additive — existing modules still register (4 tests)
  2. `defineAiTool()` return value is compatible with the plain-object shape (3 tests)
  3. `ai-agents.generated.ts` discovery is additive — does not break `ai-tools.generated.ts` consumption (3 tests)
  4. generator output is stable across runs (2 tests)

## Unit tests

### `packages/ai-assistant`

```
PASS src/modules/ai_assistant/lib/__tests__/phase-0-additive-contract.test.ts
... (all 13 suites)
Test Suites: 13 passed, 13 total
Tests:       179 passed, 179 total
```

Baseline before Step 2.5 was 12 suites / 167 tests. Delta: +1 suite, +12 tests. No regressions.

### `packages/cli`

```
Test Suites: 33 passed, 33 total
Tests:       787 passed, 787 total
```

Unchanged from baseline. The generator-stability describe in the new ai-assistant suite imports `createAiAgentsExtension()` via a relative path into `packages/cli/src/lib/generators/extensions/ai-agents.ts` instead of adding a second cli test — one new file only, per spec.

## Typecheck

`yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app`:

- `@open-mercato/core:typecheck` — green (cache hit).
- `@open-mercato/app:typecheck` — fails on the SAME pre-existing stale entry documented since Step 2.3:
  `.mercato/generated/backend-routes.generated.ts(174,12114): error TS2307: Cannot find module '../../src/modules/example/backend/customer-tasks/page'`.
  Unrelated to this Step.
- `grep` of the typecheck output for `phase-0-additive` produced zero matches — new file contributes no diagnostics.

## i18n / Playwright / Generate / Build

- i18n — N/A (tests only, no user-facing strings).
- Playwright — N/A (no UI surface).
- `yarn generate` — N/A (no module structural change).
- `yarn build` — N/A (tests-only Step, not a merge gate here).

## BC contract surfaces (per `BACKWARD_COMPATIBILITY.md`)

- Surface 2 (Type definitions & interfaces): no production types modified — test file only.
- Surface 4 (Import paths): no public re-exports changed.
- Surface 13 (Generated file contracts): no generator output touched. Stability is *asserted* by the new test, not modified.
- Surfaces 1, 3, 5–12: not touched.

## Notable decisions

- Used fixture-based plain-object tools (`makePlainAiTool`) rather than relying on any specific business module's real `ai-tools.ts`. The regression is about the *contract*, not about any specific module's current tools. This keeps the test stable even if catalog / customers tool packs migrate to `defineAiTool()` later.
- Did not duplicate Step 2.3's existing `tool-loader.test.ts` coverage. Where this Step overlaps (plain-object registration, idempotency, silent missing-tools), the assertions here are re-framed around the Phase 0 *contract* wording and expand the matrix (both builder and plain-object shapes through the same loader path).
- The "both shapes register through the same loader path" assertion documents actual current behavior: `registerGeneratedAiToolEntries` maps to `McpToolDefinition` and drops additive-only fields (`displayName`, `tags`, `isMutation`, `maxCallsPerTurn`, `supportsAttachments`) at registration time. Phase 3 WS-A (Step 3.1) is the right place to preserve those fields when the agent runtime lands — called out here for traceability.
- Generator-stability describe invokes `createAiAgentsExtension()` twice, compares empty-fixture outputs byte-for-byte, and also calls `generateOutput()` twice on the same instance. The whole-fixture idempotency case is already covered by `packages/cli/.../output-snapshots.test.ts`; this Step adds only the focused additive assertion.
- Test file is 255 lines (~ target 250); kept under with no comments except the describe names.
