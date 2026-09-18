# Checkpoint 1 — Phase 1 (Safety identifiers)

**Steps covered:** 1.1 → 1.4-fix (SHA range `18962f889`..`f3d4a8d0c`)
**Packages touched:** `@open-mercato/shared` (lib/ai), `@open-mercato/ai-assistant` (llm-adapters, model-factory, agent-runtime)
**Date:** 2026-06-10

## Scope of the window
- 1.1 — additive `endUserIdentifier` / `mapEndUserIdentifier` / `supportsInputModeration` on the shared LLM provider contract.
- 1.2 — `safety-identifier.ts` HMAC helper (`deriveAiSafetyIdentifierSecret`, `computeEndUserIdentifier`).
- 1.3 — OpenAI/Anthropic adapter `mapEndUserIdentifier`; `supportsInputModeration: true` on the native OpenAI preset only.
- 1.4 — runtime threads the identifier (best-effort, fail-open) through `resolveAgentModel` → factory → merged `providerOptions` on streamText / ToolLoopAgent / preparedOptions; resolution now also carries `supportsInputModeration`.

## Checks

| Check | Result | Notes |
|-------|--------|-------|
| `yarn workspace @open-mercato/shared jest src/lib/ai` | ✅ pass | 4 suites / 46 tests (contract + safety-identifier + registry + opencode). |
| ai-assistant `jest llm-adapters model-factory.test llm-bootstrap` | ✅ pass | 5 suites / 138 tests incl. new identifier-mapping + moderation-capability cases. |
| `yarn generate` | ✅ pass | Produced ephemeral `#generated/*` barrels required by downstream packages. |
| `yarn typecheck` (full) | ✅ pass (21/21) | Run 1 failed only on `@open-mercato/sync-akeneo` (`#generated/entities.ids.generated` missing — fresh-worktree barrel, unrelated). Run 2 (after `yarn generate`) surfaced a real type error: `providerOptions: Record<string, unknown>` not assignable to the AI SDK `SharedV2ProviderOptions` at the streamText + ToolLoopAgent call sites. Fixed in Step `1.4-fix` (`as never` cast, matching the file's existing `stopWhen as never` style). Run 3 clean: **21/21 successful**. |
| i18n checks | n/a | Phase 1 adds no user-facing strings / locale files. |
| UI / Playwright | n/a | Phase 1 is pure contract + runtime logic; no UI surface touched. |

## Notes
- No `em.find(`/`em.findOne(` introduced in changed files (no DB access in Phase 1).
- Contract changes are additive-only (new optional members) per `BACKWARD_COMPATIBILITY.md`.
- `providerOptions` typed as `Record<string, unknown>`; the SDK wants `SharedV2ProviderOptions` so the call sites cast `as never` (Step 1.4-fix), consistent with the surrounding `stopWhen as never` / `prepareStep as never` style.
- **Phase 1 verdict: GREEN.** Safety identifiers ship independently; ready to proceed to Phase 2 (moderation gate).
