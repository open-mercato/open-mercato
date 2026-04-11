# SPEC: Decentralized AI Capability Contract for External Module Repositories

**Date:** 2026-04-11
**Status:** Draft
**Scope:** OSS
**Related:**

- [SPEC-061-2026-03-13-official-modules-lifecycle-management.md](./implemented/SPEC-061-2026-03-13-official-modules-lifecycle-management.md)
- [SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md](./implemented/SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md)
- [SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md](./implemented/SPEC-065-2026-03-14-official-modules-cli-install-and-eject.md)
- [SPEC-067-2026-03-17-cli-standalone-app-support.md](./SPEC-067-2026-03-17-cli-standalone-app-support.md)

## TLDR

- Replace the current AI-assistant migration draft with a stricter architecture built for modules that may live in separate repositories and ship on independent release cadences.
- Treat module AI declarations as a **public compatibility contract**, not as internal source metadata.
- Introduce a two-layer architecture:
  - **AI Capability Control Plane**: versioned manifest catalog, capability indexing, compatibility validation, routing metadata, conflict detection
  - **Turn Execution Plane**: per-request activation plan, Vercel AI SDK loop, structured tool execution, budgets, tracing
- Keep the in-app Vercel AI SDK conversation loop, but make it a thin orchestrator over stable external module contracts rather than a centralized knowledge owner.
- Replace one-shot keyword routing with staged activation planning that can re-route after tool results.
- Keep a fallback discovery/search capability during migration; do not remove Code Mode equivalents until manifest coverage is operationally sufficient.

## Overview

Open Mercato is moving from a centralized AI assistant stack toward a module-driven architecture. That direction is correct, but the original draft still assumes that most modules live in the same repository and can be discovered through app-local code generation and one central tool registry.

That assumption no longer holds. Official and future partner modules may live in separate repositories, be installed into standalone apps, be ejected into app source, and evolve independently from the Open Mercato core release cycle.

This changes the architectural requirement:

- the AI layer is no longer an internal implementation detail
- module AI declarations become a public plugin contract
- routing and orchestration must tolerate partial installation, version skew, stale metadata, and overlapping module domains

This specification defines the correct architecture for that world.

## Problem Statement

The current draft and whiteboard architecture still carry six structural risks that become severe once modules are externalized.

### 1. Decentralized authorship, centralized runtime

The draft gives each module an `ai-manifest.ts`, but still routes all requests through one chat route, one manifest router, one system prompt composer, one generated manifest file, and one shared tool registry.

This is not true decentralization. It is centralized orchestration with distributed declarations.

### 2. `ai-manifest.ts` is modeled as local metadata, not a public contract

The draft manifest shape is sufficient for a monorepo prototype, but insufficient for external package ecosystems because it lacks:

- schema versioning
- compatibility ranges
- stable capability identifiers
- conflict resolution
- deprecation semantics
- ownership and provenance metadata
- runtime freshness or generation epoch metadata

### 3. One-shot fetch-based routing does not survive ambiguity

Keyword or lexical routing can select initial modules cheaply, but complex requests often become clear only after the first tool result. A router that chooses once at request ingress quietly degrades on:

- multi-hop workflows
- cross-domain entities
- user shorthand and domain slang
- partial records that require enrichment from another module

### 4. Prompt composition becomes the hidden integration layer

The draft relies on module `systemContext` fragments and tool selection to coordinate behavior. As module count grows, free-form prompt fragments become:

- conflicting
- hard to debug
- difficult to version
- impossible to validate statically

### 5. Generated manifest discovery is too brittle for external modules

Generator-driven discovery works well for local source trees, but external modules introduce:

- installed package-backed modules
- ejected modules
- standalone app layouts
- independently upgraded modules
- stale generated files

The runtime cannot assume that a single generated file is the source of truth.

### 6. The current architecture does not define operational budgets

Without explicit limits, decentralized orchestration turns into unpredictable latency and fan-out:

- too many active modules
- serial fetch chains
- runaway tool loops
- poor cancellation behavior
- no distinction between low-cost lookup and high-cost execution

## Proposed Solution

Adopt a **contract-first decentralized AI architecture** with a clear split between control-plane concerns and per-turn execution.

### Core Principles

1. Module AI declarations are public contracts.
2. The app owns orchestration, not domain knowledge.
3. Routing is staged and revisitable, not one-shot.
4. Capability metadata is structured; prompts are secondary.
5. Runtime uses validated installed manifests, not only generated files.
6. Backward compatibility rules apply to AI contracts just like API routes and module registration contracts.

### New Architectural Model

```text
Installed Modules
  ├─ package-backed modules from external repos
  ├─ app-local modules
  └─ ejected modules
          │
          ▼
AI Capability Control Plane
  ├─ manifest loader
  ├─ compatibility validator
  ├─ capability index
  ├─ conflict detector
  ├─ routing metadata store
  └─ manifest catalog snapshot
          │
          ▼
Turn Execution Plane
  ├─ auth + tenant/user context
  ├─ staged router
  ├─ activation plan builder
  ├─ Vercel AI SDK loop
  ├─ structured tool adapter
  ├─ execution journal
  └─ budgets / deadlines / cancellation
```

### Control Plane Responsibilities

The control plane runs at startup, module refresh, install/upgrade, and cache-rebuild boundaries. It is responsible for:

- loading installed manifests from package-backed, app-local, and ejected modules
- validating manifest schema and compatibility
- indexing capabilities for routing
- producing an immutable manifest catalog snapshot
- detecting conflicts and unsupported combinations

### Execution Plane Responsibilities

The execution plane runs per request. It is responsible for:

- resolving auth context
- generating a per-turn activation plan
- selecting the model tier
- exposing only approved capabilities and tools
- preserving structured tool results
- re-routing when intermediate results reveal new module needs
- enforcing deadlines and max fan-out

## Architecture

### 1. Public AI Capability Contract

Replace the thin `AiManifest` with a versioned external contract.

```typescript
export type AiCapabilityManifestV1 = {
  manifestVersion: "1";
  moduleId: string;
  moduleVersion: string;
  packageName?: string;
  source: "app" | "package" | "ejected";
  platformRange?: string;
  testedCoreRange?: string;
  generatedAt?: string;

  displayName: string;
  description: string;
  domains: string[];
  keywords?: string[];

  capabilities: AiCapabilityDefinition[];
  hardDependencies?: AiModuleDependency[];
  softAffinities?: AiModuleAffinity[];

  routingHints?: AiRoutingHints;
  modelPolicy?: AiModelPolicy;
  safetyPolicy?: AiSafetyPolicy;
};
```

Each manifest is versioned and self-describing so that external packages can evolve safely across repositories.

### 2. Capability-Centric Model

Modules do not merely export tools. They export capabilities with stable identities.

```typescript
export type AiCapabilityDefinition = {
  capabilityId: string;
  version: string;
  kind: "query" | "mutation" | "workflow" | "agent" | "search";
  displayName: string;
  description: string;

  entities?: string[];
  intents?: string[];
  sideEffectClass: "read" | "write" | "long_running";
  idempotency: "idempotent" | "non_idempotent" | "unknown";

  requiredFeatures?: string[];
  tools: AiToolContract[];

  operationalRules?: string[];
  disambiguationHints?: string[];
  outputSchemaName?: string;
  latencyClass?: "low" | "medium" | "high";
};
```

This is the unit used by routing and activation. It is more stable than prompt fragments and more precise than module-level matching.

### 3. Staged Routing Instead of One-Shot Routing

The router becomes an activation planner with three stages:

1. **Initial candidate retrieval**
   - lexical match
   - embedding match when available
   - current page/module boost
   - ACL feasibility filter

2. **Activation plan creation**
   - select top capabilities, not just top modules
   - include hard dependencies
   - include a fallback search/discovery capability
   - set budgets and max active modules

3. **Mid-turn re-routing**
   - after a tool result, the planner may add or swap capabilities if the result materially changes the task graph

This preserves low initial cost while avoiding brittle static module selection.

### 4. Structured Activation Plan

The execution plane must not infer orchestration from prompt text alone.

```typescript
export type AiActivationPlan = {
  planId: string;
  createdAt: string;
  primaryIntent?: string;

  activeModules: string[];
  activeCapabilities: Array<{
    moduleId: string;
    capabilityId: string;
    reason: string;
    confidence: number;
  }>;

  budgets: {
    maxSteps: number;
    maxModules: number;
    maxParallelToolCalls: number;
    overallDeadlineMs: number;
    perToolDeadlineMs: number;
  };

  fallbackCapabilities: string[];
  catalogVersion: string;
};
```

The activation plan is logged, inspectable, and immutable for the duration of a step boundary.

### 5. Structured Tool Adapter

The current adapter flattens tool results to strings too early. The new adapter keeps structured results internally.

Rules:

- tools return serializable structured objects
- the execution journal stores typed results
- only the final assistant response or debug output is string-rendered
- downstream tools may consume structured outputs without LLM reparsing

### 6. Separation of Prompt Policy and Capability Policy

Replace free-form `systemContext` with structured policy blocks.

```typescript
export type AiCapabilityPolicy = {
  operationalRules?: string[];
  safetyRules?: string[];
  disambiguationHints?: string[];
  workflowHints?: string[];
};
```

Prompt composition then becomes deterministic:

- global system policy
- app policy
- active capability policy summaries
- compact execution journal summary

### 7. Runtime Manifest Loading

The runtime must support three installation states:

- package-backed installed modules
- app-local modules
- ejected modules

Manifest loading order:

1. app-local manifests
2. ejected manifests
3. package-backed manifests
4. generated index as optimization only

If multiple sources resolve to the same `moduleId`, runtime must apply explicit precedence and log the result.

### 8. Compatibility and Conflict Detection

The control plane must fail closed on invalid or ambiguous combinations.

Conflicts include:

- duplicate `moduleId`
- duplicate `capabilityId` with incompatible owners
- incompatible `platformRange`
- missing hard dependency
- deprecated capability selected without fallback
- package-backed module and ejected module both attempting active ownership

### 9. Vercel AI SDK Role

Vercel AI SDK remains the execution engine for:

- streaming
- tool calling
- provider abstraction
- multi-step orchestration

But it must consume the activation plan rather than act as the sole coordination layer. The SDK loop is part of the execution plane, not the control plane.

## Data Models

### `AiCapabilityManifestV1`

```typescript
export type AiCapabilityManifestV1 = {
  manifestVersion: "1";
  moduleId: string;
  moduleVersion: string;
  packageName?: string;
  source: "app" | "package" | "ejected";
  platformRange?: string;
  testedCoreRange?: string;
  generatedAt?: string;

  displayName: string;
  description: string;
  domains: string[];
  keywords?: string[];

  capabilities: AiCapabilityDefinition[];
  hardDependencies?: AiModuleDependency[];
  softAffinities?: AiModuleAffinity[];
  routingHints?: AiRoutingHints;
  modelPolicy?: AiModelPolicy;
  safetyPolicy?: AiSafetyPolicy;
};
```

### `AiToolContract`

```typescript
export type AiToolContract = {
  toolName: string;
  version: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  requiredFeatures?: string[];
  sideEffectClass: "read" | "write" | "long_running";
  confirmationRequired?: boolean;
  latencyClass?: "low" | "medium" | "high";
};
```

### `AiModuleDependency`

```typescript
export type AiModuleDependency = {
  moduleId: string;
  capabilityIds?: string[];
  reason: string;
};
```

### `AiRoutingHints`

```typescript
export type AiRoutingHints = {
  boostKeywords?: string[];
  suppressKeywords?: string[];
  pageContextPrefixes?: string[];
  alwaysIncludeSearch?: boolean;
};
```

### `AiExecutionJournal`

```typescript
export type AiExecutionJournal = {
  turnId: string;
  catalogVersion: string;
  activationPlanId: string;
  entries: Array<
    | {
        type: "route";
        timestamp: string;
        moduleId: string;
        capabilityId?: string;
        confidence: number;
        reason: string;
      }
    | { type: "tool_call"; timestamp: string; toolName: string; args: unknown }
    | {
        type: "tool_result";
        timestamp: string;
        toolName: string;
        result: unknown;
        durationMs: number;
      }
    | {
        type: "reroute";
        timestamp: string;
        reason: string;
        addedCapabilities: string[];
      }
    | {
        type: "error";
        timestamp: string;
        scope: "router" | "tool" | "model";
        message: string;
      }
  >;
};
```

## API Contracts

### 1. Chat Route

`POST /api/chat`

Responsibilities:

- authenticate request
- load manifest catalog snapshot
- build activation plan
- run Vercel AI SDK execution loop
- stream progress and final response

The route remains centralized, but all routing and tool selection must be based on installed capability contracts.

### 2. Manifest Catalog API

New internal server contract:

```typescript
type ManifestCatalog = {
  version: string;
  manifests: AiCapabilityManifestV1[];
  conflicts: AiManifestConflict[];
  generatedAt: string;
};
```

The catalog is not necessarily exposed publicly, but it is the runtime source used by routing and diagnostics.

### 3. Diagnostics API

Add server- or CLI-accessible diagnostics for installed AI capabilities:

- list manifests
- show conflicts
- show compatibility failures
- show active precedence decisions

This is required for external modules and standalone apps.

### 4. Optional Manifest Export Contract for External Repos

Official external modules MUST export:

- `ai-manifest.ts` source
- compiled runtime artifact under package `dist/`
- package metadata declaring module kind and compatibility

This aligns with official-module package contracts already defined for install/eject and compatibility handling.

## UI / UX

### Debuggability Requirements

The assistant UI must expose enough metadata to debug decentralized routing:

- active modules
- active capabilities
- why they were activated
- reroute events
- tool durations
- conflicts or suppressed modules

This is more important in a decentralized architecture than richer chat cosmetics.

### Failure UX

If a manifest is invalid or incompatible, the user must receive:

- a clear assistant-safe message
- a stable error code
- a suggestion to inspect diagnostics

Do not silently fall back to a broad global tool surface when contracts are invalid.

## Configuration

### Required Configuration

- AI provider env vars remain centralized in app/core config
- manifest schema version support is hardcoded in the platform
- embedding-based routing remains optional and feature-detected

### New Cache and Refresh Inputs

- manifest catalog cache key
- module install/upgrade/eject invalidation hooks
- app startup refresh
- explicit CLI rebuild command for structural changes

## Alternatives Considered

### 1. Keep the original thin `ai-manifest.ts`

Rejected because it is insufficient for cross-repo compatibility, runtime validation, and conflict handling.

### 2. Let each external module own its own full conversation loop

Rejected because it creates fragmented UX, inconsistent auth handling, and no single-turn orchestration for multi-module tasks.

### 3. Use one-shot keyword routing only

Rejected because it is cheap but brittle, especially for semantically ambiguous queries and cross-domain workflows.

### 4. Keep Code Mode as the permanent primary abstraction

Rejected because it centralizes knowledge and hides module semantics, but a fallback discovery capability remains useful during migration and partial manifest adoption.

### 5. Load manifests only from generated files

Rejected because external packages, ejected modules, and standalone apps make codegen lag and path assumptions too risky.

## Implementation Approach

### Phase 1 — Contract Foundation

- add `AiCapabilityManifestV1` types in shared package
- define manifest validation schema
- define capability IDs, dependency contracts, and policy structures
- preserve compatibility by auto-wrapping old `ai-tools.ts`

### Phase 2 — Manifest Catalog Control Plane

- implement runtime manifest loader for app, package, and ejected sources
- build manifest catalog snapshot
- add compatibility and conflict validation
- add diagnostics surface

### Phase 3 — Activation Planning

- replace module-only router with capability-centric staged routing
- implement activation plan type and planner
- add page-context boost and ACL feasibility checks
- include mandatory fallback search/discovery capability

### Phase 4 — Execution Plane Upgrade

- keep Vercel AI SDK loop
- switch tool exposure to activation-plan-scoped capabilities
- preserve structured tool outputs
- add reroute hook after tool results
- add budgets and deadlines

### Phase 5 — Migration and Deletion

- migrate core modules to full manifests
- keep Code Mode or equivalent discovery fallback until coverage is proven
- remove legacy OpenCode-only assumptions after one stable minor cycle

## Migration Path

### Backward Compatibility

- existing `ai-tools.ts` remains valid during transition
- modules without full manifests are auto-wrapped into minimal capability manifests
- generated manifest files remain as build-time optimizations, not sole runtime truth

### External Module Compatibility

External module packages must be updated to export the new manifest contract and declare compatibility metadata aligned with official-module package rules.

### Deletion Criteria for Legacy Fallback

Fallback discovery may be removed only when:

- all first-party modules expose validated capability manifests
- package-backed external modules can be loaded in standalone apps
- activation plan diagnostics are stable
- regression coverage demonstrates no major capability loss versus legacy discovery

## Success Metrics

- module AI capabilities can be installed from external packages without core code changes
- manifest conflicts are surfaced deterministically before runtime failures
- ambiguous queries recover through staged rerouting instead of silent dead ends
- median multi-module turn latency remains bounded under explicit budgets
- support/debug time decreases because activation reasons and tool traces are inspectable

## Open Questions

- should third-party non-official modules use the exact same manifest contract from day one, or should official modules validate the approach first?
- should capability embeddings be generated at publish time, install time, or runtime?
- how much manifest policy should be statically linted in external module CI?
- should long-running capabilities integrate directly with queue/progress modules in the first version of the contract?

## Risks & Impact Review

| Risk                                              | Severity | Affected Area                    | Failure Scenario                                                 | Mitigation                                                        | Residual Risk                  |
| ------------------------------------------------- | -------- | -------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| Contract too complex for module authors           | Medium   | External module adoption         | Authors skip manifests or misuse fields                          | Provide wrappers, templates, linting, docs                        | Moderate during early adoption |
| Staged routing adds latency                       | Medium   | Chat responsiveness              | Extra planning step slows simple queries                         | Use cheap first-pass retrieval, reroute only on need              | Low if budgets are enforced    |
| Runtime manifest loading gets path handling wrong | High     | Standalone apps, ejected modules | Installed module not visible to assistant                        | Reuse standalone-app resolver patterns, add diagnostics           | Medium until heavily tested    |
| Capability conflicts block installs               | Medium   | Marketplace UX                   | Two modules expose overlapping capability ownership              | Explicit precedence rules, diagnostics, safe fail-closed behavior | Low                            |
| Prompt policy still grows too large               | Medium   | Model quality                    | Too many active capabilities create instruction noise            | Capability-scoped activation, compact policy summaries            | Low                            |
| Legacy fallback remains too long                  | Medium   | Architecture integrity           | Teams keep relying on global search/execute instead of manifests | Define deletion criteria and telemetry                            | Medium                         |

## Final Compliance Report

### Alignment With Existing Platform Direction

- Aligns with official-module external repository and lifecycle specs
- Aligns with standalone-app support requirements
- Preserves Vercel AI SDK as the execution engine
- Avoids re-centralizing knowledge into one global Code Mode abstraction

### Backward Compatibility

- additive initial rollout
- old `ai-tools.ts` survives transition
- generated files remain supported as optimization
- no immediate break to package-backed or app-local modules

### Why This Spec Replaces the Earlier Draft

The earlier decentralized AI assistant draft is directionally correct but underestimates the impact of external repositories and independent module release cycles. This spec supersedes it as the recommended target architecture because it treats module AI declarations as public contracts rather than internal metadata.

## Changelog

### 2026-04-11

- Initial specification
- Reframed the assistant architecture around public AI capability contracts
- Added control-plane and execution-plane split for external module ecosystems
- Replaced one-shot routing with staged activation planning
