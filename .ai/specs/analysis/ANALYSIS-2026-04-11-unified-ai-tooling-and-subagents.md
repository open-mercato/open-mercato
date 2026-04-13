# Pre-Implementation Analysis: Unified AI Tooling, Module Sub-Agents & Embeddable Chat

## Executive Summary
The spec is not ready for implementation. The core idea is viable, but the document is still a skeleton, leaves architecture-shaping questions unresolved, and currently conflicts with several public AI-extension contracts that already exist in the repo.

The biggest blockers are backward-compatibility planning, auth/write-safety design, and generator/runtime integration. The spec also overstates some current limitations: the repo already has an in-process MCP client and an MCP-to-AI-SDK adapter, so the problem statement needs to distinguish "insufficient for the target UX" from "does not exist".

## Backward Compatibility

### Violations Found
| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Generated file contracts | The spec introduces a new `ai.generated.ts` registry as the main output, but `ai-tools.generated.ts` is already a stable generated contract used by generators, docs, and tests. Replacing or ceasing to emit it would break consumers. Evidence: spec lines 112-113; generated file exists at `apps/mercato/.mercato/generated/ai-tools.generated.ts`; generator contract documented in `packages/cli/AGENTS.md`. | Critical | Keep `ai-tools.generated.ts` and its exports intact. Add `ai.generated.ts` only as an additive artifact or make `ai-tools.generated.ts` a bridge/re-export for at least one minor version. |
| 2 | Type definitions & interfaces | Q2(b) would replace the current `McpToolDefinition`/`AiToolDefinition` contract with AI SDK-native `tool(...)` shape. `McpToolDefinition` is a public stable type with required fields `name`, `description`, `inputSchema`, `handler`. | Critical | Preserve `McpToolDefinition` and `AiToolDefinition` as public contracts. If adding `defineAiTool`, make it emit the current MCP shape and keep module `ai-tools.ts` working unchanged. |
| 3 | Function signatures | `registerMcpTool()` is a documented stable public API exported from `@open-mercato/ai-assistant`. Any replacement or signature shift would be breaking. | Critical | Keep `registerMcpTool(tool, options?)` functional. If a new DSL is introduced, provide a bridge implementation and deprecate gradually with release notes. |
| 4 | Import paths | Q1(a)/Q1(c) imply moving AI APIs to `@open-mercato/ai`. Existing imports from `@open-mercato/ai-assistant` are public. | Warning | Re-export old paths from `@open-mercato/ai-assistant` with `@deprecated` JSDoc and migration guidance before any move. |
| 5 | Auto-discovery file conventions | `ai-tools.ts` is a frozen convention file in `BACKWARD_COMPATIBILITY.md`. The spec adds `ai-agents.ts` additively, which is fine, but it does not state whether `ai-tools.ts` remains supported as a first-class module convention. | Warning | State explicitly that `ai-tools.ts` remains supported and additive new `ai-agents.ts` does not replace it. |
| 6 | API route URLs | The spec adds `/api/ai/...` but does not define coexistence or migration for the existing `/api/chat`, `/api/tools`, and `/api/tools/execute` surfaces. Q8(c) implies possible UI routing replacement without a route-level BC plan. | Warning | Add a route migration table covering current and future endpoints and keep existing routes functional until a documented deprecation window ends. |
| 7 | CLI commands | Existing public commands `mcp:serve` and `mcp:serve-http` are stable CLI contracts. The spec proposes new HTTP/MCP surfaces without saying whether current commands remain canonical. | Warning | Keep existing commands and add any new commands as optional/additive. Document which server owns which surface. |

### Missing BC Section
The spec does not include the required "Migration & Backward Compatibility" section even though it proposes changes to public contract surfaces (`ai-tools.ts`, `registerMcpTool`, generated files, API routes, package placement, CLI/runtime behavior).

## Spec Completeness

### Missing Sections
| Section | Impact | Recommendation |
|---------|--------|---------------|
| Data Models | Impossible to implement provider settings, agent definitions, upload references, session state, or audit data safely. | Add concrete entity/config shapes for agent registry, provider overrides, media references, and any persisted chat/session data. |
| API Contracts | New `/api/ai/...` behavior is underspecified: request body, response stream format, auth modes, error model, and OpenAPI exposure are missing. | Add explicit endpoint contracts for dispatcher/per-agent routes, plus coexistence with `/api/chat` and `/api/tools*`. |
| UI/UX | `<AiChat>` is named, but rendering rules, placement rules, empty/error states, keyboard behavior, i18n, and injection handles are not defined. | Add UI contract for chat states, upload affordances, stream rendering, injected placement, and required keyboard shortcuts. |
| Implementation Plan | Current phasing is high-level only; it is not actionable enough for execution. | Add detailed implementation steps, file ownership, generator changes, and cross-package touch points per phase. |
| Integration Test Coverage | High-risk auth, tenancy, and mutation flows have no declared test matrix. | Add API and UI test scenarios for each auth mode, each execution surface, media upload, and confirmation flow. |
| Migration & Backward Compatibility | Without it, implementation will likely break extension authors and generated-file consumers. | Add a dedicated section covering contracts, bridges, deprecations, and release-note requirements. |

### Incomplete Sections
| Section | Gap | Recommendation |
|---------|-----|---------------|
| Overview | Still marked as skeleton; does not explain how the new stack coexists with existing AI routes, tool registry, or generators. | Replace placeholder text with implementation-accurate architecture summary. |
| Problem Statement | Contains factual overstatements. The repo already has `InProcessMcpClient.createWithAuthContext()` and `convertMcpToolsToAiSdk()`, so tools are not only MCP-bound in practice. | Reframe as "current path is insufficient for embeddable focused agents/UI" rather than "current capability does not exist". |
| Proposed Solution | Leaves key design decisions unresolved (Q1-Q10), so it is not a proposal yet. | Resolve the open questions or convert them into explicit recommended decisions with rationale. |
| Architecture | Does not describe how generated routes work under current frozen auto-discovery conventions or how auth is centralized. | Add generator/runtime architecture, route dispatch strategy, auth context factory, and adapter lifecycle. |
| Risks & Impact Review | Only a short bullet list is present; severity, blast radius, and mitigations are missing. | Expand into concrete failure scenarios with mitigation and residual risk. |
| Final Compliance Report | Empty. | Fill with checklist-style pass/fail against AGENTS, BC, testing, and architecture rules before implementation. |

## AGENTS.md Compliance

### Violations
| Rule | Location | Fix |
|------|----------|-----|
| `packages/ai-assistant/AGENTS.md`: "MUST NOT bypass the MCP server layer — all AI tool access goes through MCP" | Spec TLDR / Proposed Solution lines 5, 97-104, 107 | Either update the package architecture rules first via an explicit ADR/spec delta, or redesign the proposal so direct AI SDK usage is an internal adapter over the existing MCP contract rather than a bypass. |
| Root + `packages/core/AGENTS.md`: API routes must export `openApi` and `metadata` auth guards | Spec lines 12, 42-50, 114 | Define `openApi`, `metadata`, auth guards, and route shape for every new `/api/ai/...` surface. |
| Root + `packages/ui/AGENTS.md`: dialogs/components need keyboard behavior and i18n | Spec lines 6, 14, 105-106, 116 | Specify `Cmd/Ctrl+Enter`, `Escape`, loading/error states, i18n keys, and debug panel behavior for `<AiChat>`. |
| Root + `packages/core/AGENTS.md`: new ACL features must be declared in `acl.ts` and mirrored in `setup.ts` `defaultRoleFeatures` | Spec lines 11, 38, 101, 107 | Define feature IDs for agent visibility and agent execution, and state where they live and how defaults are seeded. |
| `packages/ai-assistant/AGENTS.md`: write operations require explicit question/confirmation handling | Spec lines 97-108 | Add a mutation-safety contract for sub-agents: confirmation handshake, command-only writes, and parity with existing `question` flow / AskUserQuestion behavior. |
| `packages/cli/AGENTS.md`: new convention files require generator support and generated outputs in `.mercato/generated/` | Spec lines 11, 112-113 | Add generator changes for `ai-agents.ts`, output file names, build order, and `yarn generate` / `modules:prepare` expectations. |
| Root + shared/UI ACL rules: feature gating must use wildcard-aware matching | Spec all ACL/tool filtering references | State that all tool and agent gating reuses shared wildcard-aware feature matching helpers; do not invent exact-match filters per surface. |

## Risk Assessment

### High Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Tool contract split-brain between MCP, AI SDK, and callable TS functions | Different surfaces may enforce different validation, ACL, or error semantics, causing subtle security and behavior drift. | Require one canonical DSL that emits all surfaces, plus contract tests that compare validation and execution behavior across MCP, in-process, and HTTP paths. |
| Auth and tenant-context divergence across three execution paths | Cross-tenant leaks or privilege escalation become possible if one path derives context differently or skips guards. | Build a single `AiExecutionContext` factory used by all surfaces and add conformance tests for cookie, JWT, API key, and session-token flows. |
| Mutation safety regression | New sub-agents could perform writes without the current explicit question/confirmation safety model and without command-pattern guarantees. | Separate read-only and write-capable tools, require confirmation for write-capable tool invocation, and mandate command-backed writes only. |
| Breaking generated/public contracts | Existing modules, docs, standalone apps, and tests can break if `ai-tools.generated.ts`, `registerMcpTool`, or `AiToolDefinition` semantics change. | Make all new artifacts additive, preserve old exports, and add a formal deprecation bridge with release notes. |
| Media storage/privacy mistakes | Uploaded PDFs/images could leak across tenants, remain unencrypted, or linger indefinitely without retention controls. | Reuse `attachments` unless there is a strong reason not to, or define transient storage with tenant scope, encryption, TTL, and cleanup workers from day one. |

### Medium Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Route-shape mismatch with current auto-discovery conventions | Per-agent generated routes may be awkward or impossible under frozen `api/<method>/<path>.ts` conventions without extra generator/runtime work. | Prefer a dispatcher route unless there is a compelling need for generated aliases, and document how aliases are created without breaking conventions. |
| Existing runtime/documentation mismatch around `ai-tools.ts` | The current generator still emits `ai-tools.generated.ts`, but `tool-loader.ts` says module AI tools are no longer loaded. Migration on top of an already inconsistent baseline raises failure risk. | Reconcile current runtime behavior first, then write the new spec against the actual baseline. |
| Provider configuration sprawl | Per-agent/provider overrides can create hard-to-debug secret ownership and tenant settings problems. | Start with tenant-level provider defaults and narrow additive per-agent overrides only if justified by concrete use cases. |
| UI rendering strategy lock-in | Choosing RSC `streamUI` too early may break portal/backoffice injection scenarios; choosing tagged-client too late may limit richer UX. | Decide with a compatibility matrix across backoffice pages, portal pages, auth context, and streaming requirements before implementation. |
| Cost/latency explosion | Focused agents plus media upload plus streamed UI can create expensive, slow interactions with poor fallback behavior. | Add request budgets, model defaults, timeout/retry policy, cancellation, and observability before broad rollout. |

### Low Risks
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Naming drift between tool IDs, agent IDs, MCP namespaces, and UI bindings | Harder debugging and documentation, but recoverable. | Add naming conventions and examples for tool IDs, agent IDs, endpoint names, and component handles. |
| Debug panel scope creep | Chat debug UI can become unstable/noisy if protocol events are not versioned. | Define a narrow debug event schema and keep it additive. |
| Per-module MCP endpoints | Useful but optional; risk is mostly extra maintenance. | Treat per-module MCP as a later phase unless a concrete integration requires it in v1. |

## Gap Analysis

### Critical Gaps (Block Implementation)
- Canonical contract is unresolved: Q2 leaves the most important BC and implementation decision open.
- Migration plan is missing: no explicit bridge for `ai-tools.ts`, `registerMcpTool`, `AiToolDefinition`, `ai-tools.generated.ts`, `/api/chat`, `/api/tools`, or CLI commands.
- Auth/session model is incomplete: cookies/JWT/API key/session-token/in-process flows are not unified into one contract.
- Mutation confirmation model is absent: the spec does not say how write-capable sub-agents preserve current confirmation guarantees.
- API contracts are missing: request/response/stream/error models for `/api/ai/...` are unspecified.
- Generator plan is incomplete: `ai-agents.ts` discovery, generated outputs, and route generation/dispatch are not defined.
- Test matrix is missing: no declared integration coverage for the most failure-prone paths.
- Current-state baseline is inaccurate: the document ignores existing in-process AI SDK bridge pieces and existing standard-auth tool routes.

### Important Gaps (Should Address)
- Feature/ACL design: missing feature IDs, module ownership, and `setup.ts` defaults.
- Data model/storage plan: missing persisted config/session/media entities and retention semantics.
- UI spec: missing injection spots, replacement handles, keyboard interactions, i18n, and loading/error states.
- Observability: no plan for audit logging, cost telemetry, rate limiting, cancellation, retries, or tracing.
- Namespace/routing strategy: no stable rule for module IDs, agent IDs, MCP names, and endpoint aliases.
- Compatibility with existing command palette/debug flows: coexistence is stated but not operationally defined.

### Nice-to-Have Gaps
- Eval fixtures and regression datasets for agent behavior.
- A minimal component registry contract for streamed UI parts.
- Explicit rollout plan for early adopter modules vs general availability.

## Remediation Plan

### Before Implementation (Must Do)
1. Add a "Migration & Backward Compatibility" section: cover `ai-tools.ts`, `registerMcpTool`, `AiToolDefinition`, generated files, import paths, existing routes, and CLI commands.
2. Resolve Q1-Q10 into explicit chosen decisions: a skeleton with unresolved core questions is not implementable.
3. Correct the problem statement against actual code: acknowledge `InProcessMcpClient.createWithAuthContext()`, `convertMcpToolsToAiSdk()`, and `/api/tools*` auth-backed routes, then explain why they are insufficient.
4. Pick a canonical additive contract: safest path is current MCP-compatible shape or a new DSL that emits the current MCP shape without breaking modules.
5. Define write safety: confirmation flow, command-only mutations, undo/logging expectations, and failure behavior.
6. Define the HTTP route strategy: dispatcher vs aliases, auth guards, OpenAPI, response stream schema, error schema, and coexistence with `/api/chat`.

### During Implementation (Add to Spec)
1. Add generator details: discovery of `ai-agents.ts`, output filenames, route generation/dispatch, and `yarn generate` effects.
2. Add ACL/data/storage details: feature IDs, default role features, provider settings ownership, media storage, retention, and encryption rules.
3. Add UI contract: `<AiChat>` props, injection/replacement handles, i18n, keyboard behavior, debug protocol, and portal/backoffice compatibility.
4. Add an execution-context design: one source of auth/tenant/session truth shared by MCP, in-process, and HTTP surfaces.
5. Add observability and operational controls: rate limits, audit logs, cancellation, timeout policy, tracing, and cost telemetry.
6. Add integration test coverage: matrix by auth mode, surface, write confirmation, media upload, ACL filtering, and tenant isolation.

### Post-Implementation (Follow Up)
1. Publish deprecations only after bridges exist: annotate old exports and routes with `@deprecated`, document in release notes, and keep them alive for at least one minor version.
2. Reconcile docs and AGENTS: update `packages/ai-assistant/AGENTS.md`, root AGENTS references, and any docs that still describe obsolete tool-loading behavior.
3. Add regression tests around generated outputs and public imports: protect `ai-tools.generated.ts`, package exports, and route compatibility from future accidental breakage.

## Recommendation
Needs spec updates first.

The safest path is to rework this into an additive migration spec, not a replacement spec. Treat the existing MCP tool contract, generated outputs, and public package exports as frozen surfaces; then define the new sub-agent/UI stack as a layered extension that compiles down to those contracts where possible.
