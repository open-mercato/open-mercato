# Analysis: PR #1222 — Decentralized AI Assistant Ideas Worth Adopting

**Date:** 2026-04-13
**Status:** Analysis
**Source:** [PR #1222](https://github.com/open-mercato/open-mercato/pull/1222) (closed — superseded by the official spec)
**Official Spec:** [`2026-04-11-unified-ai-tooling-and-subagents.md`](./2026-04-11-unified-ai-tooling-and-subagents.md)

## Context

PR #1222 contributed two draft specs:

1. **Decentralized AI Assistant** — replacing centralized OpenCode with module-driven AI using `ai-manifest.ts`, Vercel AI SDK chat, retrieval-based routing, and structured prompt composition.
2. **Decentralized AI Capability Contract** — extending the above with a versioned public contract model, control-plane/execution-plane split, staged routing, and external-module ecosystem support.

The official spec (`unified-ai-tooling-and-subagents`) takes a deliberately different, more conservative approach: additive `ai-agents.ts` convention, read-only focused sub-agents, explicit tool whitelists, and full preservation of existing MCP/OpenCode surfaces. Both approaches share the same goal — making AI capabilities module-driven — but differ significantly in scope, risk tolerance, and migration strategy.

This document extracts the ideas from PR #1222 that are worth considering as future enhancements to the official spec, organized by value and feasibility.

---

## High-Value Ideas — Recommended for Future Phases

### 1. AI Manifest Metadata for Routing Context

**PR #1222 concept:** Each module declares an `AiManifest` with `domain`, `keywords`, `dataCapabilities` (entity names, operations, searchable fields, relationships), and `contextDependencies`.

**Why it matters:** The official spec's sub-agents are explicitly addressed by `agentId`. There is no discovery mechanism — the caller must already know which agent to use. As the number of agents grows, a metadata layer that helps route ambiguous user queries to the right agent becomes valuable.

**Recommended adoption path:**
- Add optional `keywords`, `domain`, and `dataCapabilities` fields to `AiAgentDefinition` as non-breaking metadata.
- Use this metadata in a future "agent suggestion" feature where the Command Palette or a general assistant can recommend which focused agent to invoke.
- This is strictly additive and does not conflict with the official spec's explicit-agent-selection model.

**Priority:** Phase 4+ (after the official spec's Phase 3 proves the basic agent model works)

---

### 2. Page Context Resolver

**PR #1222 concept:** Modules declare a `pageContextResolver` function in their manifest that loads record-level context when a user is on a specific page (e.g., viewing Quote #Q-2024-0847). This injects a `[CURRENT RECORD]` section into the system prompt.

**Why it matters:** The official spec already accepts `pageContext` in `AiChatRequest` but treats it as "advisory context only." PR #1222's approach makes the module responsible for hydrating that context into rich, structured data the agent can act on immediately — rather than requiring an extra tool call to look up what the user is viewing.

**Recommended adoption path:**
- Add an optional `resolvePageContext` callback to `AiAgentDefinition`:
  ```typescript
  resolvePageContext?: (ctx: {
    entityType: string
    recordId: string
    container: AwilixContainer
    tenantId: string | null
    organizationId: string | null
  }) => Promise<string | null>
  ```
- When present, the agent runtime calls it before composing the system prompt, injecting the result as additional context.
- This is additive and does not change the existing `pageContext` pass-through.

**Priority:** Phase 3 or 4 (natural fit when building the first production agent)

---

### 3. Structured Prompt Composition with Named Sections

**PR #1222 concept:** Instead of a single `systemPrompt` string, the system prompt is composed from named sections (`[ROLE]`, `[AUTH CONTEXT]`, `[ACTIVE MODULES]`, `[MODULE: X]`, `[GUIDELINES]`), with each module contributing a fragment.

**Why it matters:** The official spec gives each agent a single `systemPrompt` field, which is fine for v1. But as agents gain richer context (page context, cross-module data, operational guidelines), a structured template prevents prompt drift and makes debugging easier — you can inspect which section contributed what.

**Recommended adoption path:**
- Not needed for v1 (single-agent, single-prompt model works).
- When adding multi-agent orchestration or richer context injection in Phase 4+, adopt a prompt-builder utility that concatenates named sections rather than raw string concatenation.
- The specific section structure from PR #1222 (`[ROLE]`, `[AUTH CONTEXT]`, `[ACTIVE MODULES]`, `[GUIDELINES]`) is a reasonable starting point.

**Priority:** Phase 4+ (when prompt complexity warrants it)

---

### 4. Provider/Model Abstraction Layer (`resolveAndCreateAiModel`)

**PR #1222 concept:** A shared `model-factory.ts` with `resolveAndCreateAiModel()` that dynamically imports the correct `@ai-sdk/*` package based on provider selection, with a priority chain: per-module env -> global env -> legacy env -> tier default.

**Why it matters:** The official spec defers to "existing tenant settings and provider resolution" (Decision D6). PR #1222's model factory is a clean, testable utility that consolidates provider logic in one place. The per-module model override (`SALES_AI_MODEL`, `INBOX_OPS_AI_MODEL`) is particularly useful for cost optimization — cheap models for classification, powerful models for complex workflows.

**Recommended adoption path:**
- Extract the model factory pattern from the existing `inbox_ops/lib/llmProvider.ts` into a shared utility inside `@open-mercato/ai-assistant`.
- Support the `defaultModel` override that `AiAgentDefinition` already declares, plus an optional env-based override per agent/module.
- This consolidation should happen when the second agent is built (Phase 3+), to avoid premature abstraction.

**Priority:** Phase 3 (when multiple agents need different models)

---

## Medium-Value Ideas — Worth Tracking

### 5. Context Dependencies Between Modules

**PR #1222 concept:** Modules declare `contextDependencies` — other modules whose tools/context should be co-activated when this module is active. For example, Sales declares dependencies on Customers and Catalog.

**Why it matters:** The official spec's `allowedTools` whitelist is explicit and safe but requires the agent author to enumerate every tool by name. Context dependencies express a higher-level intent ("this agent needs CRM data") that could auto-resolve to the correct tools.

**Recommended adoption path:**
- Not needed for v1 (explicit whitelists are correct for safety).
- Track as a future convenience layer that could auto-expand `allowedTools` based on declared module affinities.
- The companion spec's `hardDependencies` / `softAffinities` distinction is worth preserving if this is adopted.

**Priority:** Phase 4+ (convenience, not correctness)

---

### 6. Versioned Manifest Contract for External Modules

**PR #1222's companion spec concept:** Treat module AI declarations as a versioned public contract with `manifestVersion`, `moduleVersion`, `platformRange`, `testedCoreRange`, `source` (app/package/ejected), and conflict detection.

**Why it matters:** The official spec is designed for monorepo-first development. As the external module ecosystem grows (official modules in separate repos, standalone apps), the AI contract surface will need the same versioning and compatibility guarantees that the rest of the module system has.

**Recommended adoption path:**
- Not needed until external modules ship AI agents.
- When that happens, add `manifestVersion` and `platformRange` to `AiAgentDefinition` following the existing official-module versioning patterns from SPEC-061/064/065.
- The companion spec's control-plane/execution-plane split is over-engineered for current needs but the compatibility validation concept is sound.

**Priority:** When external module AI capabilities become real (post-Phase 4)

---

### 7. Execution Budgets and Deadlines

**PR #1222's companion spec concept:** Explicit operational budgets per turn: `maxSteps`, `maxModules`, `maxParallelToolCalls`, `overallDeadlineMs`, `perToolDeadlineMs`.

**Why it matters:** The official spec has `readOnly` and `maxCallsPerTurn` on individual tools but no turn-level budget. As agents become more capable (especially mutation-capable agents in Phase 4), turn-level budgets prevent runaway tool loops and bound latency.

**Recommended adoption path:**
- Add optional `maxSteps` to `AiAgentDefinition` (the official spec's runtime already passes `maxSteps` to `streamText()`).
- Defer `overallDeadlineMs` and parallel-call limits until there's evidence of runaway behavior.

**Priority:** Phase 4 (mutation-capable agents need tighter controls)

---

## Low-Value / Not Recommended

### 8. Retrieval-Based Module Router (Keyword + Vector)

PR #1222's keyword-scoring router and vector-based routing upgrade are interesting but solve a different problem than the official spec. The official spec deliberately uses explicit agent selection (`?agent=module.agent`) rather than automatic routing. This is the right call for v1 — automatic routing adds complexity, ambiguity, and a whole category of "wrong agent selected" bugs. Not recommended unless the product shifts toward a single unified chat that must auto-select agents.

### 9. Removing OpenCode in Favor of Native Vercel AI SDK Chat

PR #1222 proposes phasing out OpenCode entirely. The official spec explicitly preserves OpenCode and the Command Palette as the general-purpose assistant. This coexistence strategy is safer and more pragmatic. Not recommended.

### 10. Staged Routing with Mid-Turn Re-Routing

The companion spec's staged activation planning with mid-turn re-routing is architecturally interesting but adds significant complexity for marginal benefit. The official spec's explicit agent selection avoids this entire problem space. Not recommended for the foreseeable future.

### 11. Full Control-Plane / Execution-Plane Split

The companion spec proposes a two-layer architecture with a manifest catalog, compatibility validator, capability index, and conflict detector. This is enterprise-grade infrastructure that would be premature for the current stage. The official spec's simpler generated-registry approach is correct until the external module ecosystem actually materializes at scale.

---

## Summary Table

| # | Idea | Value | Effort | Recommended Phase |
|---|------|-------|--------|-------------------|
| 1 | AI manifest metadata for routing/discovery | High | Low | Phase 4+ |
| 2 | Page context resolver | High | Medium | Phase 3-4 |
| 3 | Structured prompt composition | High | Low | Phase 4+ |
| 4 | Shared model factory with per-agent overrides | High | Medium | Phase 3 |
| 5 | Context dependencies between modules | Medium | Medium | Phase 4+ |
| 6 | Versioned manifest contract | Medium | High | Post-Phase 4 |
| 7 | Execution budgets and deadlines | Medium | Low | Phase 4 |
| 8 | Retrieval-based module router | Low | High | Not recommended |
| 9 | Remove OpenCode | Low | High | Not recommended |
| 10 | Staged mid-turn re-routing | Low | High | Not recommended |
| 11 | Control-plane / execution-plane split | Low | Very High | Not recommended |

## Acknowledgment

Credit to @rchrzanwlc for the thorough research and spec drafting in PR #1222. Several ideas — particularly the page context resolver, structured prompt composition, and model factory patterns — are strong contributions that will inform future phases of the official AI tooling spec.

## Changelog

- 2026-04-13: Initial analysis extracted from PR #1222 against the official unified AI tooling spec.
