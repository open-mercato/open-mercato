# Step 5.16 — Phase 3 WS-D integration tests (page-context + model-factory + maxSteps)

**Commit (code):** `ccf2d1292`
**Docs-flip commit:** see PLAN.md row 5.16.
**Scope:** additive, test-only. No production code changed.

## Files created

- `packages/core/src/modules/customers/__tests__/ai-agents-context.integration.test.ts`
- `packages/core/src/modules/catalog/__tests__/ai-agents-context.integration.test.ts`
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/model-factory.integration.test.ts`
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/max-steps-budget.integration.test.ts`

All four files follow the per-module placement rule (under the module's own
`__tests__/` directory) and the `*.integration.test.ts` naming convention so
the full-repo Jest run picks them up automatically.

## Test counts

| Suite | Tests | Notes |
|-------|-------|-------|
| `customers/ai-agents-context.integration` | 7 | person / company / deal happy paths, unknown recordType, missing recordId, cross-tenant recordId, throwing service (+ warn spy) |
| `catalog/ai-agents-context.integration` | 6 | catalog_assistant summary projection, SELECTION_CAP=10 enforcement, merchandising_assistant full bundles, cross-tenant missingIds, no-parse fallthrough |
| `ai-assistant/model-factory.integration` | 8 | callerOverride > env > agent default > provider default, no-provider throw, moduleId-undefined skip, empty/whitespace callerOverride fallthrough |
| `ai-assistant/max-steps-budget.integration` | 5 | runAiAgentText positive / undefined / zero maxSteps, runAiAgentObject parity (set / unset) |
| **Total** | **26** | |

## Baselines preserved

- `packages/ai-assistant`: baseline 47/525 → **49/538** (+2 suites, +13 tests).
- `packages/core`: baseline 342/3167 → **344/3180** (+2 suites, +13 tests).
- `packages/ui`: baseline 66/351 → **66/351** (untouched).

## Gate verdicts

- `yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app` → **2 successful, 2 total** (`@open-mercato/ai-assistant` has no typecheck script by design — ts-jest + build step is its gate, as documented in the prior HANDOFF).
- `yarn generate` → **green**. `All generators completed.` Structural cache purge ran normally; no drift in emitted files (test-only change).
- `yarn i18n:check-sync` → **green**. `All translation files are in sync.` No new strings in this Step.

## Mock boundary discipline

- **Customers + catalog context tests** mock `../ai-tools` at the module boundary (same seam Step 5.2's unit tests already use). The tests drive either the production `resolvePageContext` callback exported from `ai-agents.ts` (customers) or the lower-level `hydrateCatalogAssistantContext` / `hydrateMerchandisingAssistantContext` helpers (catalog). No internal helpers were mocked, no DI container, no DB.
- **Model factory tests** use the Step 5.1 public test seam (`CreateModelFactoryDependencies.registry` + `env`) — no process-wide env mutation, no ordering coupling between scenarios.
- **maxSteps tests** stub `ai` (`streamText`, `generateObject`, `streamObject`, `stepCountIs`, `convertToModelMessages`) at the Jest module boundary, same pattern as `agent-runtime.test.ts`. The provider registry is stubbed identically.

## No new public helpers exposed

The Step's Hard-rule #3 anticipated possibly needing a new exported helper to
keep mocks narrow. None was needed:

- Both page-context integration suites reach the agent's production
  `resolvePageContext` callback (customers) or the two `hydrate*Context`
  helpers (catalog) directly — both are already public exports.
- Model factory already exposed `CreateModelFactoryDependencies` as a public
  test seam in Step 5.1.
- Agent runtime already accepts `maxSteps` on the agent definition and
  consumes the AI SDK via the `ai` module, which Jest can stub at the module
  boundary without any internal hook.

## Deliberate scope gap — caller-passed `stopWhen` override

The Step description includes a scenario:

> Caller-passed `stopWhen` overrides agent's `maxSteps`: call
> `runAiAgentText({ maxSteps: 5 })` and assert it wins over agent's
> `maxSteps: 2`.

The current `RunAiAgentTextInput` / `RunAiAgentObjectInput` shapes do NOT
expose a per-call `maxSteps` (or `stopWhen`) override surface — only
`modelOverride`. Introducing such a public field would require production
code changes, and the Step explicitly forbids new production code
(“No new production code in this Step”).

Documenting this as a deliberate gap rather than faking it through a
test-only seam is the right call — the rule in §3 says “expose a proper
public helper instead” of a `__testingOnly_` hatch, and the right forum to
add `maxStepsOverride` is a future Step (most likely a Phase 5 hardening
Step alongside the agent-runtime `resolveAgentModel` migration carried
forward in HANDOFF.md). The remaining five maxSteps-budget assertions
still lock the declared agent policy into the AI SDK call shape, which is
the production behavior that matters.

## BC posture

- 13 new tests across 4 new files. No production code touched. No generator
  output changed. No migration. No i18n additions. No API / event / feature /
  DI key / DB rename.
