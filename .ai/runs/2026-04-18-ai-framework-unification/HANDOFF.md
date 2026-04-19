# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T02:10:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.1 **complete**. Phase 3 WS-A
model-factory extraction landed; the `inbox_ops/lib/llmProvider.ts`
module is now a thin BC shim that delegates to `createModelFactory`.
Next: Step 5.2 — Production `ai-agents.ts` files with
`resolvePageContext` callbacks that hydrate record-level context.
**Last commit (code):** `3b86061b4` — `feat(ai-assistant): extract shared AI model factory with module env-override support (Phase 3 WS-A)`

## What just happened

- New port `createModelFactory(container)` lives at
  `packages/ai-assistant/src/modules/ai_assistant/lib/model-factory.ts`.
  Exposes `AiModelFactory`, `AiModelFactoryInput`, `AiModelResolution`,
  typed `AiModelFactoryError` (`no_provider_configured` /
  `api_key_missing`). Resolution order: `callerOverride` →
  `<MODULE>_AI_MODEL` env → `agentDefaultModel` → provider default.
- `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` is now a thin
  BC shim. Public surface (`resolveExtractionProviderId`,
  `createStructuredModel`, `withTimeout`,
  `runExtractionWithConfiguredProvider`) is unchanged; model
  instantiation inside `runExtractionWithConfiguredProvider` now routes
  through the factory first and falls back to the legacy
  `OPENCODE_*`-era helpers only when the registry has no configured
  provider — this preserves the historical error messages existing
  tests / consumers rely on.
- `@open-mercato/ai-assistant` is now a peer + dev dependency of
  `@open-mercato/core`; `packages/core/jest.config.cjs` learned the
  corresponding `moduleNameMapper`.
- `packages/ai-assistant/AGENTS.md` gained a "Model resolution" section
  documenting the factory and the `<MODULE>_AI_MODEL` env pattern.
- Test deltas:
  - ai-assistant: 30/353 → **31/363** (+1 suite `model-factory.test.ts`,
    +10 tests).
  - core: 337/3069 → **338/3073** (+1 suite
    `llmProvider.factory.test.ts`, +4 tests).
  - ui: 60/328 preserved.
- Typecheck (`@open-mercato/core` + `@open-mercato/app`) green;
  `yarn generate` green with no drift; `yarn i18n:check-sync` green
  (46 modules × 4 locales); `yarn build:packages` green.
- `agent-runtime.ts`'s inline `resolveAgentModel` was intentionally
  **NOT** migrated in this Step — follow-up listed in
  `step-5.1-checks.md`. Step 5.2+ will migrate production agents at
  their own pace.

## Open follow-ups carried forward

- **`agent-runtime.ts`** still has its own inline `resolveAgentModel`.
  Migrate it to `createModelFactory` in Step 5.2 so every chat-mode and
  object-mode run also honors `<MODULE>_AI_MODEL` / `agentDefaultModel`
  via the shared port. Behavior-equivalent today, but the duplicate
  logic will drift otherwise.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
  Considered out of scope for 5.1 because the public shim preserves
  them; revisit after 5.2.
- **Portal customer login UI helper** still missing from
  `packages/core/src/modules/core/__integration__/helpers/` — carried
  from Phase 2. TC-AI-INJECT-010 retains its deferred-UI-smoke
  placeholder.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.

## Next concrete action

- **Step 5.2** — Spec Phase 3 WS-A — Production `ai-agents.ts` files
  with real `resolvePageContext` callbacks that hydrate record-level
  context (CRM person/company, catalog product/category). Agents land
  behind their own feature flags; integrate with the new model factory
  so callers get the uniform `modelOverride` → env → agent default
  → provider default resolution path.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed after
  4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11; Step
  5.1 is the 7th Step since. Main coordinator should run the full
  validation gate + integration suites + ds-guardian sweep before Step
  5.2 lands.
- Phase 3 WS-A is library-only; the next natural pause is after Step
  5.2 (first production agent using the new factory) for an additive-
  contract spot-check.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 is healthy — reuse for Phase 5
  Step 5.2 validation.
- Database / migration state: clean, untouched this Step (library-only
  change, no routes, no DB).
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`); the
  ai-assistant package still has no `typecheck` script — its Jest
  suite acts as the TS gate via `ts-jest`.
- `yarn.lock` touched because of the new `@open-mercato/ai-assistant`
  peer dep on `@open-mercato/core`; no runtime package versions
  changed.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
