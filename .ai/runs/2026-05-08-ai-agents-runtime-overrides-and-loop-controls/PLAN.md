# Plan — AI Agents Runtime Overrides and Agentic Loop Controls

**Date:** 2026-05-08
**Slug:** `ai-agents-runtime-overrides-and-loop-controls`
**Branch:** `feat/ai-agents-runtime-overrides-and-loop-controls`
**Source specs:**
- `.ai/specs/2026-04-27-ai-agents-provider-model-baseurl-overrides.md` (issue #1780)
- `.ai/specs/2026-04-28-ai-agents-agentic-loop-controls.md` (issue #1782)

> 1782 explicitly depends on 1780. Both specs are intentionally phased ("ships independently — 1 PR per phase"). User has explicitly authorized landing all phases in a single run despite the spec authors' phased plan; the Tasks table below mirrors the spec phasing 1:1 so reviewers can map each commit back to a spec checkbox.

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once committed.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1780-0 | 0.1 | Add `AI_DEFAULT_PROVIDER` + `AI_DEFAULT_MODEL` resolution to `model-factory.ts`; add `'env_default'` to `AiModelResolution.source` | done | 064e832b4 |
| 1780-0 | 0.2 | Update `model-factory.test.ts` with the 5 cases from spec 1780 §Phase 0 Tests | done | pending |
| 1780-0 | 0.3 | Update `model-factory.integration.test.ts` with end-to-end smoke for `AI_DEFAULT_PROVIDER` | done | pending |
| 1780-0 | 0.4 | Update `apps/mercato/.env.example` and `packages/create-app/template/.env.example` | done | pending |
| 1780-0 | 0.5 | Update `packages/ai-assistant/AGENTS.md` "How to Configure AI Providers" table | todo | — |
| 1780-0 | 0.6 | Update `apps/docs/docs/framework/ai-assistant/overview.mdx` with env defaults | todo | — |
| 1780-0 | 0.7 | Replace hardcoded provider order in `api/route/route.ts` with env-aware resolver | todo | — |
| 1780-1 | 1.1 | Add `defaultProvider?: string` to canonical `AiAgentDefinition` | todo | — |
| 1780-1 | 1.2 | Add slash-shorthand parser (`parseModelToken`) honored at every model-axis source | todo | — |
| 1780-1 | 1.3 | Add `agentDefaultProvider` and `<MODULE>_AI_PROVIDER` env axis to `AiModelFactoryInput` | todo | — |
| 1780-1 | 1.4 | Validate `agent.defaultProvider` in `aggregateAiAgents`; warn + register undefined when unknown | todo | — |
| 1780-1 | 1.5 | Wire `runAiAgentText` / `runAiAgentObject` to accept `providerOverride?: string` | todo | — |
| 1780-1 | 1.6 | Update `model-factory.test.ts` and `agent-runtime.test.ts` with Phase 1 cases | todo | — |
| 1780-1 | 1.7 | Update `packages/ai-assistant/AGENTS.md` and `agents.mdx` for `defaultProvider` + slash | todo | — |
| 1780-1 | 1.8 | Update `customers/ai-agents.ts` and `catalog/ai-agents.ts` local `AiAgentDefinition` copies | todo | — |
| 1780-2 | 2.1 | Add `baseURLEnvKeys` to OPENAI/DEEPINFRA/GROQ/TOGETHER/FIREWORKS presets | todo | — |
| 1780-2 | 2.2 | Add `OPENROUTER_PRESET` and `LM_STUDIO_PRESET` to `openai-compatible-presets.ts` | todo | — |
| 1780-2 | 2.3 | Add `baseURL` plumbing to `anthropic.ts` adapter | todo | — |
| 1780-2 | 2.4 | Investigate + wire `@ai-sdk/google` `baseURL` (or document SDK gap) | todo | — |
| 1780-2 | 2.5 | Add `defaultBaseUrl?: string` to `AiAgentDefinition` | todo | — |
| 1780-2 | 2.6 | Add baseURL axis to `model-factory.ts`; thread to `provider.createModel` | todo | — |
| 1780-2 | 2.7 | Add `baseUrlOverride?: string` to `RunAiAgentTextInput` / `RunAiAgentObjectInput` | todo | — |
| 1780-2 | 2.8 | Add adapter tests (openai/anthropic/openrouter/lm-studio presets) | todo | — |
| 1780-2 | 2.9 | Update `.env.example` files and AGENTS.md baseURL columns | todo | — |
| 1780-3 | 3.1 | Migrate `agent-runtime.resolveAgentModel` to `createModelFactory`; delete inline duplicate | todo | — |
| 1780-3 | 3.2 | Replace `api/route/route.ts` hardcoded order with factory-driven helper | todo | — |
| 1780-3 | 3.3 | Unify `inbox_ops/lib/llmProvider.ts` order with factory; legacy `OPENCODE_*` moves to step 5 | todo | — |
| 1780-3 | 3.4 | Remove duplicate `AiAgentDefinition` shapes in `customers/ai-agents.ts` and `catalog/ai-agents.ts` | todo | — |
| 1780-3 | 3.5 | Update AGENTS.md + changelog (Step 5.2 follow-up done) | todo | — |
| 1780-4a | 4a.1 | Add `AiAgentRuntimeOverride` MikroORM entity + migration | todo | — |
| 1780-4a | 4a.2 | `AiAgentRuntimeOverrideRepository` (get/upsert/clear with tenant guards) | todo | — |
| 1780-4a | 4a.3 | `model-factory.ts` accepts `tenantOverride` and `requestOverride`; `allowRuntimeModelOverride: false` short-circuits | todo | — |
| 1780-4a | 4a.4 | `agent-runtime.ts` hydrates override per turn; threads `requestOverride` from dispatcher | todo | — |
| 1780-4a | 4a.5 | Add `allowRuntimeModelOverride?: boolean` to `AiAgentDefinition` | todo | — |
| 1780-4a | 4a.6 | Dispatcher route accepts `provider`/`model`/`baseUrl` query params + 4 typed 400 codes | todo | — |
| 1780-4a | 4a.7 | `AI_RUNTIME_BASEURL_ALLOWLIST` env wired into dispatcher | todo | — |
| 1780-4a | 4a.8 | `PUT`/`DELETE` on `/api/ai_assistant/settings` (Zod + ACL gate) | todo | — |
| 1780-4a | 4a.9 | Extend `GET /api/ai_assistant/settings` response (resolvedDefault, tenantOverride, agents[]) | todo | — |
| 1780-4a | 4a.10 | `GET /api/ai_assistant/ai/agents/:agentId/models` route | todo | — |
| 1780-4a | 4a.11 | Update `openApi` exports for all changed routes | todo | — |
| 1780-4a | 4a.12 | Tests: repository, model-factory override cases, agent-runtime hydration, route validation | todo | — |
| 1780-4b | 4b.1 | `<ModelPicker>` component (stateless, keyboard-accessible, localStorage-persisted) | todo | — |
| 1780-4b | 4b.2 | Wire `<ModelPicker>` into `<AiChat>`; sends `provider`/`model`/`baseUrl` per turn | todo | — |
| 1780-4b | 4b.3 | Editable `AiAssistantSettingsPageClient.tsx` (CrudForm + PUT) | todo | — |
| 1780-4b | 4b.4 | Per-agent override list in settings UI + clear action calling DELETE | todo | — |
| 1780-4b | 4b.5 | Playground turn-summary panel "Provider/Model/BaseURL: x / y / z (source: Σ)" | todo | — |
| 1780-4b | 4b.6 | Add `<ModelPicker>` to playground | todo | — |
| 1780-4b | 4b.7 | i18n keys for picker + settings + 4 dispatcher error codes | todo | — |
| 1780-4b | 4b.8 | Update `overview.mdx` 7-step resolution table + worked examples | todo | — |
| 1780-4b | 4b.9 | Update `agents.mdx` provider/picker subsections | todo | — |
| 1780-4b | 4b.10 | Update `settings.mdx` admin-editable fields | todo | — |
| 1780-4b | 4b.11 | Component tests (settings + picker) | todo | — |
| 1780-4b | 4b.12 | Playwright integration: settings → chat turn → playground summary | todo | — |
| 1782-0 | l0.1 | Add `AiAgentLoopConfig` types to `ai-agent-definition.ts`; reshape `maxSteps` as `loop.maxSteps` alias | todo | — |
| 1782-0 | l0.2 | Resolve effective loop config (caller → tenant override → agent → wrapper default) in runtime | todo | — |
| 1782-0 | l0.3 | Translate `stopWhen` items via `stepCountIs`/`hasToolCall`; pass StopCondition[] to streamText/generateText | todo | — |
| 1782-0 | l0.4 | Wrapper-owned `prepareStep` composing user `prepareStep` + `mergeStepOverrides` enforcing tool-allowlist | todo | — |
| 1782-0 | l0.5 | Reject loop primitives unsupported in object mode (`loop_unsupported_in_object_mode`) | todo | — |
| 1782-0 | l0.6 | Remove dead `(generateArgs as Record<string, unknown>).stopWhen` cast | todo | — |
| 1782-0 | l0.7 | Tests covering Phase 0 surface (definition + runtime composition) | todo | — |
| 1782-1 | l1.1 | Add `loop?` input to `runAiAgentText` / `runAiAgentObject`; gate via `allowRuntimeOverride` | todo | — |
| 1782-1 | l1.2 | Object-mode loop subset (`maxSteps` / `budget` / `onStepFinish` / `onStepStart`) | todo | — |
| 1782-1 | l1.3 | Tests for caller override precedence + object-mode rejection | todo | — |
| 1782-2 | l2.1 | Implement documented `generateText` / `generateObject` callback contract | todo | — |
| 1782-2 | l2.2 | Extend prepared-options bag with `stopWhen` / `prepareStep` / `onStepFinish` / repair / activeTools / toolChoice / abortSignal | todo | — |
| 1782-2 | l2.3 | Wrapper-composed `prepareStep` documented as security-critical contract | todo | — |
| 1782-2 | l2.4 | Tests for native callback path with full bag | todo | — |
| 1782-3 | l3.1 | Migration adding 7 loop columns to `ai_agent_runtime_overrides` | todo | — |
| 1782-3 | l3.2 | Repository validates `loop_stop_when_json` (JSON-safe variants only) and `loop_active_tools_json` subset rule | todo | — |
| 1782-3 | l3.3 | Settings UI "Loop policy" section (read/write/kill-switch) + `<AiChat>` banner when disabled | todo | — |
| 1782-3 | l3.4 | `<MODULE>_AI_LOOP_*` env shorthands lower precedence than DB override | todo | — |
| 1782-3 | l3.5 | Budget enforcement (`maxToolCalls`, `maxWallClockMs`, `maxTokens`) via AbortController | todo | — |
| 1782-3 | l3.6 | Tests for kill-switch + budget aborts + tenant abort reason surfaced | todo | — |
| 1782-4 | l4.1 | `LoopTrace` shape + wrapper aggregator | todo | — |
| 1782-4 | l4.2 | Playground "Loop" panel rendering trace per turn | todo | — |
| 1782-4 | l4.3 | `<AiChat>` debug panel exposes loop trace | todo | — |
| 1782-4 | l4.4 | Dispatcher `?loopBudget=tight\|default\|loose` query param gated by `allowRuntimeOverride` | todo | — |
| 1782-4 | l4.5 | Rename `allowRuntimeModelOverride` → `allowRuntimeOverride` (deprecated alias for one minor) | todo | — |
| 1782-4 | l4.6 | Tests + i18n + integration coverage TC-AI-AGENT-LOOP-{001..006} | todo | — |
| 1782-5 | l5.1 | Add `executionEngine?: 'stream-text' \| 'tool-loop-agent'` to `AiAgentDefinition` | todo | — |
| 1782-5 | l5.2 | Construct `Experimental_Agent` per agent registry entry; wire `prepareCall` + `prepareStep` correctly | todo | — |
| 1782-5 | l5.3 | Mutation-approval integration test for `tool-loop-agent` engine (TC-AI-AGENT-LOOP-006) | todo | — |
| 1782-5 | l5.4 | Document `repairToolCall` engine-specific gap | todo | — |
| 1782-6 | l6.1 | `ai_token_usage_events` table + entity + migration | todo | — |
| 1782-6 | l6.2 | `ai_token_usage_daily` rollup table + UPSERT logic | todo | — |
| 1782-6 | l6.3 | Plumb `sessionId` (rename of `conversationId`, deprecated alias) end-to-end; new `turnId` | todo | — |
| 1782-6 | l6.4 | `recordTokenUsage` collector wired into wrapper-owned `onStepFinish` (detached) | todo | — |
| 1782-6 | l6.5 | Retention worker `workers/ai-token-usage-prune` + reconciliation | todo | — |
| 1782-6 | l6.6 | Read APIs `/api/ai_assistant/usage/daily` and `/api/ai_assistant/usage/sessions[/[sessionId]]` | todo | — |
| 1782-6 | l6.7 | Settings page "Usage" tab consuming the read APIs | todo | — |
| 1782-6 | l6.8 | Tests + integration coverage for token usage + retention worker | todo | — |

## Goal

Promote the unified AI agent framework from a fixed provider/model selection and a single `maxSteps` loop knob to a fully tunable runtime — per-axis provider/model/baseURL overrides at every layer (env, agent, tenant, request, picker), per-tenant runtime override table, declarative + per-call agentic loop controls, operator budgets and kill switches, and end-to-end token usage tracking — without breaking any existing call site.

## Scope

- `packages/ai-assistant/src/modules/ai_assistant/lib/{model-factory,agent-runtime,ai-agent-definition,openai-compatible-presets,llm-adapters/*}.ts`
- `packages/ai-assistant/src/modules/ai_assistant/api/{settings,route,ai/chat,ai/agents/[agentId]/models,usage/*}/route.ts`
- `packages/ai-assistant/src/modules/ai_assistant/data/entities.ts` + new migrations under `migrations/`
- `packages/ai-assistant/src/modules/ai_assistant/frontend/components/AiAssistantSettingsPageClient.tsx`
- `packages/ai-assistant/src/modules/ai_assistant/backend/config/ai-assistant/playground/page.tsx`
- `packages/ai-assistant/src/modules/ai_assistant/i18n/*.json`
- `packages/ui/src/ai/AiChat/*` (new `<ModelPicker>`, hooks)
- `packages/core/src/modules/{customers,catalog}/ai-agents.ts` (Phase 1.8 + 3.4)
- `packages/core/src/modules/inbox_ops/lib/llmProvider.ts` (Phase 3.3)
- `packages/shared/src/lib/ai/llm-provider.ts` (`baseURL` doc tightening)
- `apps/mercato/.env.example`, `packages/create-app/template/.env.example`
- `apps/docs/docs/framework/ai-assistant/{overview,agents,settings,architecture}.mdx`
- `packages/ai-assistant/AGENTS.md`
- Integration tests under `packages/ai-assistant/src/modules/ai_assistant/__integration__/`

## Non-goals

- Re-binding `OPENCODE_PROVIDER` / `OPENCODE_MODEL` to the new framework — explicit non-aliasing decision in spec 1780 §Phase 0.
- Touching OpenCode Code Mode (Docker `opencode-mvp`, `mcp:serve`, `/api/chat` SSE) — explicit non-goal in both specs.
- Persisted `LoopTrace` audit log — out of scope per 1782 §Out of Scope.
- Cross-agent or per-tenant cost ceilings — out of scope per 1782 §Out of Scope.
- Pricing / cost dollar conversion — out of scope per 1782 §Phase 6 ("token counts only").

## Risks

- **R6 (1780)** — per-request `baseUrl` query param is a credential exfiltration vector; mitigated by `AI_RUNTIME_BASEURL_ALLOWLIST` defaulting empty, host-pattern enforcement, picker UI hides the field.
- **R1 (1782)** — user `prepareStep` could smuggle raw mutation handlers; mitigated by `mergeStepOverrides` re-intersecting with wrapper-owned tool map.
- **R7 (1780)** — per-turn model override can burn budget on flagship models; mitigated by `<ModelPicker>` only listing curated `defaultModels`, dispatcher logs `(providerId, modelId, source)` per turn.
- **Phase 3 risk (1780 R1 HIGH)** — call-site cleanup could silently flip a deployment's resolved provider; mitigated by explicitly *not* aliasing `OPENCODE_PROVIDER` to `AI_DEFAULT_PROVIDER`.
- **Scope risk** — single-PR delivery of 12 phases violates the spec authors' own "1 PR per phase" plan. Reviewer fatigue + integration risk are real. The user has explicitly authorized this trade-off.

## External References

None. No `--skill-url` provided.

## Implementation Plan

### Phase 1780-0 — `.env`-driven defaults

Smallest deliverable. Adds `AI_DEFAULT_PROVIDER` + `AI_DEFAULT_MODEL` to `model-factory.ts`, threads them through the resolution chain at the new `'env_default'` source rank (between agent default and provider default), and replaces the hardcoded `order: ['anthropic', 'openai', 'google']` walk in the routing route with the same env-aware resolver.

### Phase 1780-1 — Per-agent provider + slash shorthand

Adds `defaultProvider?: string` to `AiAgentDefinition`, the `<provider>/<model>` slash parser (with registry-membership guard so DeepInfra slashes like `meta-llama/Llama-3.3-70B` aren't mis-parsed), `<MODULE>_AI_PROVIDER` env axis, and `runAiAgentText/Object` `providerOverride` input.

### Phase 1780-2 — baseURL overrides + new presets

Adds `baseURLEnvKeys` to all OpenAI-compatible presets, ships OpenRouter and LM Studio presets, teaches the Anthropic adapter to forward `baseURL`, threads `defaultBaseUrl` / `baseUrlOverride` through agent definition + factory + runtime.

### Phase 1780-3 — Call-site cleanup

Pure refactor. Migrates `agent-runtime.resolveAgentModel` to `createModelFactory`, replaces hardcoded provider order in the routing route, unifies `inbox_ops` resolution order, removes duplicate `AiAgentDefinition` types in customers/catalog modules.

### Phase 1780-4a — Backend persistence + dispatcher API

New `AiAgentRuntimeOverride` entity + migration, repository with tenant guards, factory accepting `tenantOverride`/`requestOverride`, runtime hydrating per turn, dispatcher accepting `provider`/`model`/`baseUrl` query params with 4 typed 400 codes, settings PUT/DELETE, new `/api/ai_assistant/ai/agents/:agentId/models` route, `AI_RUNTIME_BASEURL_ALLOWLIST` enforcement.

### Phase 1780-4b — Chat picker + editable settings + playground

`<ModelPicker>` component, `<AiChat>` integration, editable settings `CrudForm`, playground turn-summary, i18n, docs.

### Phase 1782-0..5 — Loop controls

`AiAgentLoopConfig` shape, wrapper-owned `prepareStep` composition with security guarantees (`mergeStepOverrides`), per-call overrides, native callback bag extension, operator budget table, `LoopTrace`, dispatcher `?loopBudget` preset, `allowRuntimeOverride` rename, opt-in `Experimental_Agent` engine.

### Phase 1782-6 — Token usage tracking

`ai_token_usage_events` + `ai_token_usage_daily` tables, `sessionId` plumbing, detached `recordTokenUsage` collector, retention worker, read APIs, settings "Usage" tab.

## Verification Strategy

- Unit tests scoped to each phase (the spec already lists the named test files per phase).
- Integration tests under `packages/ai-assistant/src/modules/ai_assistant/__integration__/` for `TC-AI-AGENT-LOOP-{001..006}` and the existing `TC-AI-AGENT-SETTINGS-005` extension.
- Per-checkpoint validation per `auto-create-pr-loop` (typecheck + scoped unit tests + i18n when strings change + generate when module structure changes).
- Final gate: full validation gate + `yarn test:integration` + `yarn test:create-app:integration` + `ds-guardian` pass.
