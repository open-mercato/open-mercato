# Step 5.1 — Validation Checks

**Step:** 5.1 — Spec Phase 3 WS-A — Extract shared model factory from
`inbox_ops/lib/llmProvider.ts` into
`@open-mercato/ai-assistant/lib/model-factory.ts`; support
`defaultModel` + `<MODULE>_AI_MODEL` env override.

**Code commit:** `3b86061b4` —
`feat(ai-assistant): extract shared AI model factory with module env-override support (Phase 3 WS-A)`

**Docs-flip commit:** _(this commit)_ —
`docs(runs): mark ai-framework-unification step 5.1 complete`

## Files created

- `packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts`
  — new port `createModelFactory(container)`,
  `AiModelFactory` / `AiModelFactoryInput` / `AiModelResolution`
  interfaces, typed `AiModelFactoryError` with
  `AiModelFactoryErrorCode` union (`no_provider_configured` |
  `api_key_missing`).
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/model-factory.test.ts`
  — 10 unit tests covering resolution order + error surface.
- `packages/core/src/modules/inbox_ops/__tests__/llmProvider.factory.test.ts`
  — 4 regression tests asserting the shim public shape + factory
  delegation.

## Files touched

- `packages/ai-assistant/src/index.ts` — re-export the factory surface
  (additive).
- `packages/ai-assistant/AGENTS.md` — new "Model resolution" section.
- `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` — delegates
  `runExtractionWithConfiguredProvider` model instantiation to
  `createModelFactory({ moduleId: 'inbox_ops' })`, with legacy
  `OPENCODE_*`-era path as fallback to preserve historical error
  messages. `resolveExtractionProviderId` / `createStructuredModel` /
  `withTimeout` unchanged. Adds `__inboxOpsLlmProviderInternal` test
  seam for the regression suite.
- `packages/core/package.json` — `@open-mercato/ai-assistant` added as
  peer + dev dep.
- `packages/core/jest.config.cjs` — added moduleNameMapper entry for
  `@open-mercato/ai-assistant`.
- `yarn.lock` — refreshed by `yarn install` after package.json edit;
  no runtime package versions changed.

## Tests

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| `@open-mercato/ai-assistant` Jest | 30 suites / 353 tests | **31 / 363** | +1 suite / +10 tests (factory unit tests) |
| `@open-mercato/core` Jest | 337 / 3069 | **338 / 3073** | +1 suite / +4 tests (shim regression) |
| `@open-mercato/ui` Jest | 60 / 328 | **60 / 328** | preserved |

All suites green.

## Gate verdicts

- `yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app`
  — **green** (core + app cache-hit / fresh pass; ai-assistant has no
  `typecheck` script, ts-jest acts as the TS gate).
- `yarn generate` — **green**, no drift.
- `yarn i18n:check-sync` — **green** (46 modules × 4 locales, no
  changes; library-only Step).
- `yarn build:packages` — **green** (18 / 18 tasks, 16 cached).

## Key decisions / deviations

1. **Public API of the old `llmProvider.ts` (verified via grep):**
   - `resolveExtractionProviderId(): OpenCodeProviderId`
   - `createStructuredModel(providerId, apiKey, modelId): Promise<AiModel>`
   - `withTimeout<T>(op, timeoutMs, message): Promise<T>`
   - `runExtractionWithConfiguredProvider({ systemPrompt, userPrompt, modelOverride?, timeoutMs }): Promise<{ object, totalTokens, modelWithProvider }>`

   Importers: `packages/core/src/modules/inbox_ops/ai-tools.ts`
   (uses the first three), `packages/core/src/modules/inbox_ops/lib/translationProvider.ts`
   (uses the first three),
   `packages/core/src/modules/inbox_ops/subscribers/extractionWorker.ts`
   (uses `runExtractionWithConfiguredProvider` only).

   **All four exports are preserved unchanged.** The shim is
   source-compatible with every existing importer.

2. **Which caller changed behavior:** Only
   `runExtractionWithConfiguredProvider` — when
   `llmProviderRegistry` has at least one configured provider, the
   factory path wins over the legacy `OPENCODE_MODEL` /
   `resolveOpenCodeModel` flow. For deployments where the registry is
   bootstrapped with the same providers the legacy envs point to
   (default), effective behavior is identical. When the registry is
   empty, the shim falls back to the legacy path exactly as before
   (same error messages, same env precedence). `ai-tools.ts` and
   `translationProvider.ts` still use the legacy helpers directly —
   their behavior is unchanged.

3. **`agent-runtime.ts` migration deferred.** Its inline
   `resolveAgentModel` is behavior-equivalent to the new factory for
   the callers it serves, but still lives outside the shared port.
   Step 5.2+ will migrate it when it touches the production
   `ai-agents.ts` definitions.

## Follow-ups

- Step 5.2+: migrate `agent-runtime.ts` `resolveAgentModel` to
  `createModelFactory(container)` so chat-mode and object-mode runs
  share the module-env-override path.
- Step 5.2+: optionally migrate `inbox_ops/ai-tools.ts` +
  `translationProvider.ts` to the factory once the Phase 3 WS-A agents
  are in place (they currently call the legacy helpers directly).

## Hard-rule deviations

None. One code commit + one docs-flip commit, both pushed. No history
rewrite. BC additive-only at the package-export level.
