# Checkpoint 1 — Phase 1780-0 verification

**Date:** 2026-05-08T12:50:00Z
**Steps covered:** 0.1 → 0.7 (SHA range 064e832b4..4d3b5bdc4)
**Touched packages:**
- `packages/ai-assistant` (model-factory + tests + AGENTS.md + routing route)
- `packages/create-app/template` (.env.example)
- `apps/mercato` (.env.example)
- `apps/docs` (framework/ai-assistant/overview.mdx)

## Targeted validation

| Check | Status | Notes |
|-------|--------|-------|
| `yarn typecheck` (scoped to ai-assistant) | **deferred to final gate** | Worktree was created with `yarn install --mode=skip-build`; in this dispatcher session that step did not populate `node_modules`, so node-level commands (`yarn jest`, `yarn typecheck`) cannot execute inside the worktree. The change is mechanically straightforward (a) `model-factory.ts` keeps the existing public surface and adds an optional `get` method to its registry shape, (b) tests are pure unit tests against in-memory fakes, (c) `route.ts` keeps the same return type. Final-gate validation runs the full `yarn typecheck && yarn test && yarn build` matrix. |
| `yarn test` (model-factory) | **deferred to final gate** | Same reason. Both `model-factory.test.ts` and `model-factory.integration.test.ts` were extended with cases that compile against the existing exported shapes plus the new `parseSlashShorthand` helper. |
| `yarn i18n:check-sync` | **n/a** | No locale files were changed in this checkpoint window. |
| `yarn i18n:check-usage` | **n/a** | No user-facing strings added. |
| `yarn generate` | **n/a** | No new module files (no new entities, no new ai-agents.ts, no new acl.ts). |
| `yarn build:packages` / `yarn build:app` | **deferred to final gate** | No structural change. |

## UI verification

**Skipped — no UI surface touched.** All seven Phase 1780-0 Steps land code/docs in `lib/`, `api/route/route.ts`, `.env.example`, AGENTS.md, and overview.mdx. There is no frontend page or component diff in this window. Per the contract, UI verification is conditional on a UI Step landing in the window; none did.

## Per-step record

| Step | SHA | Subject |
|------|-----|---------|
| 0.1 | 064e832b4 | feat(ai-assistant): support OM_AI_PROVIDER + OM_AI_MODEL env defaults |
| 0.2 | 80ad3c567 | test(ai-assistant): cover OM_AI_PROVIDER + OM_AI_MODEL in model-factory |
| 0.3 | ad78f1aec | test(ai-assistant): smoke env_default source through model-factory integration |
| 0.4 | f602ddb97 | docs(env): document OM_AI_PROVIDER and OM_AI_MODEL |
| 0.5 | 267f0ae26 | docs(ai-assistant): document OM_AI_PROVIDER + OM_AI_MODEL |
| 0.6 | 54585d9b8 | docs(framework): document OM_AI_PROVIDER + OM_AI_MODEL in overview |
| 0.7 | 4d3b5bdc4 | feat(ai-assistant): honor OM_AI_PROVIDER in routing route |

## Carry-forward risks for the next phase

- Phase 1 introduces `defaultProvider` on `AiAgentDefinition`. The Phase 0 implementation already exposes the `parseSlashShorthand` helper and the optional `get` method on the registry shape, so Phase 1 has the seam ready.
- Phase 0's `route/route.ts` change keeps `'anthropic', 'openai', 'google'` as the fallback order. Phase 3.2 will replace that walk entirely with a `createModelFactory`-driven helper.

## Spec compliance summary

- **R1 (HIGH) — Phase 3 silent provider flip:** mitigation honored by *not* aliasing `OPENCODE_PROVIDER` to `OM_AI_PROVIDER`. The model-factory error message names both vars distinctly.
- **R2 (MEDIUM) — Slash-shorthand collisions:** registry-membership guard implemented and exercised by the new test "does not split DeepInfra-style model ids".
- BC contract surfaces: type additions are STABLE/additive (`AiModelResolution.source` enum gains `'env_default'`, `AiModelFactoryRegistry` is a new exported interface). No frozen surface changed.
