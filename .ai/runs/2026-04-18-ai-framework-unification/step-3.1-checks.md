# Step 3.1 — Verification

**Step:** 3.1 — Spec Phase 1 WS-A — `agent-registry.ts` loads `ai-agents.generated.ts` and exposes a typed lookup API.
**Branch:** `feat/ai-framework-unification`
**Baseline (post-Step 2.5):** 13 suites / 179 tests in `packages/ai-assistant`.

## Unit tests

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
```

Result: **14 suites / 187 tests passed**. New file
`src/modules/ai_assistant/lib/__tests__/agent-registry.test.ts` contributes
1 suite / 8 tests (delta +1 suite, +8 tests vs baseline). All other suites
unchanged.

Covered cases:
- Loader is a no-op (empty registry) when the generated file is absent — the
  dynamic `import('@/.mercato/generated/ai-agents.generated')` throws
  `MODULE_NOT_FOUND` under Jest since `jest.config.cjs` has no mapper for
  `@/.mercato/generated/*`. `console.error` fires exactly once.
- Fixture population + `getAgent(id)` lookup returns the fixture entry;
  unknown id returns `undefined`.
- `listAgents()` is stable-sorted by `id` (tested with 3 agents across 2
  modules).
- `listAgentsByModule('catalog')` filters; unknown module returns `[]`.
- Duplicate id across two modules throws an error naming both module ids.
- Malformed entry (missing `systemPrompt`) is skipped with a
  `console.warn`; valid entry in the same batch still loads.
- `resetAgentRegistryForTests()` clears the cache so a fresh seed re-populates.
- `loadAgentRegistry()` is idempotent — repeat calls do not duplicate
  entries and do not re-warn (single `console.error` across 3 calls).

## Typecheck

```
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```

- `@open-mercato/core:typecheck` → cache hit, green.
- `@open-mercato/app:typecheck` → pre-existing failure unrelated to this
  step (`.mercato/generated/backend-routes.generated.ts(174,12114): error
  TS2307: Cannot find module '../../src/modules/example/backend/customer-tasks/page'`).
  Documented in HANDOFF.md since Step 2.3. Grep of typecheck output for
  `agent-registry`, `ai-agents-generated`, and the new test filename
  returned zero matches — no new diagnostics introduced.

## i18n / Playwright / generate / build

N/A for this Step — no UI surface, no user-facing strings, no module
structure change (new file under an existing module `lib/` folder), no
route changes. Registry is read-only and consumed only by later Steps
(3.2 policy gate, 3.3 dispatcher).

## Backward compatibility

- Surface 2 (Type definitions & interfaces): additive — the `agent-registry`
  exports are new. No existing type narrowed or removed.
- Surface 3 (Function signatures): additive — all exported functions are new.
- Surface 4 (Import paths): additive — new exports in
  `@open-mercato/ai-assistant` added after existing groups; no existing
  export touched.
- Surface 13 (Generated file contracts): unchanged — this Step consumes
  `ai-agents.generated.ts` (already emitted by Step 2.2 via
  `createAiAgentsExtension`) and does not modify the generator output shape.

## Decisions recorded in NOTIFY.md

- Prefer `allAiAgents` (flattened array) over `aiAgentConfigEntries`
  (grouped-by-module) because the grouping is a generator-internal detail;
  the runtime only needs per-agent lookup + module filter.
- Stable-sort by `id` in `listAgents()` keeps diagnostic output (e.g., the
  future `meta.list_agents` tool in Step 3.8) deterministic across processes.
- Duplicate `id` throws at load time (not per-call) so a misconfiguration
  surfaces immediately at boot, consistent with the spec's stated
  per-tenant agent-id uniqueness guarantee (§4).
- Malformed entry → `console.warn` (not throw) so a single bad fixture
  cannot take down the entire registry. Mirrors the same policy
  `registerGeneratedAiToolEntries` applies to tools.
- Kept `seedAgentRegistryForTests` unexported from the package root
  (`index.ts`) — it is an internal testing hook, not a public API.
- Registry stores `AiAgentDefinition` objects verbatim — no projection to a
  subset type. Avoids the additive-field loss flagged in the Step 2.5
  HANDOFF carryover for the tool registry path.
