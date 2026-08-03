# Module Facts Exact Unified Override Targets

- **Status:** Proposed — implementation-ready
- **Date:** 2026-08-02
- **Parent:** [Complete Source-Linked Module Extension Contracts](2026-08-02-module-facts-extension-surface-completeness.md)
- **Depends on:** [Source Provenance and Contract Inventory](2026-08-02-module-facts-source-provenance-and-contract-inventory.md)
- **Related:** [Bound Extension Activation and Incoming Contribution Index](2026-08-02-module-facts-extension-activation-and-incoming-index.md)
- **Scope:** exact module-specific unified override facts, framework catalog correlation, Markdown/guidance, and standalone harness case `OMH-089`

## TLDR

Keep the framework extension-point catalog as the authority for supported override domains and merge/replace modes, then add the missing module-specific layer: every selected module fact sheet lists each exact key that can be used in `modules.ts`, its domain, mode, referenced fact, and defining source.

The implementation must distinguish similarly named but different contracts. In particular, `overrides.guards` targets backend/frontend page route middleware; `data/guards.ts` mutation guards are not override entries in that domain. The standalone harness must reject domain-only answers and prove representative exact keys, including a safe DI override.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Duplicate framework domain prose in each module? | No. Reference framework facts for modes and emit only concrete module targets. | Keeps one authority for override semantics. | ok |
| Q2 | Include only currently populated domains? | Emit exact targets for every domain the selected module actually exposes; keep the framework domain catalog complete separately. | Empty domains should not produce invented keys. | ok |
| Q3 | Treat mutation guards as `overrides.guards`? | No. Only page route middleware maps to that domain unless a future dedicated mutation-guard override contract is approved. | The runtime types are distinct despite the shared word “guard.” | ok |
| Q4 | Can exact keys be inferred from filenames alone? | Only when the runtime override resolver uses that same normalized convention; otherwise bind to the actual registry/parser. | Facts must match accepted runtime keys exactly. | ok |

No assumption needs human confirmation.

## Overview

PR #4810 added framework-level UMES facts and standalone guidance for extension modes. It can tell an agent that API routes, pages, workers, subscribers, widgets, notifications, DI, ACL, setup, encryption, and other domains are overrideable. It does not consistently tell the agent the exact key for a particular installed module entry.

The gap matters because override keys are domain-specific. API routes use a method plus normalized `/api/...` path, pages use application route paths, DI uses container tokens, event subscribers and workers use registry identities, and nested domains such as widgets or AI contain their own keyed registries. Guessing a key produces a silent no-op or replaces the wrong entry.

The existing standalone case `OMH-089` promises exact keys across override domains. The current facts can satisfy only some domains directly, so the evaluation can reward plausible domain-level advice instead of an executable override.

## Problem Statement

Developers and agents lack one deterministic answer to:

- Which exact property/key under `modules.<moduleId>.overrides` targets this installed contract?
- Does the domain replace, merge, wrap, disable, or apply another supported mode?
- Which generated fact proves the target exists?
- Where is the target registered or discovered in source?
- Is a “guard” a page route middleware override or an unrelated mutation guard?
- Are module-specific keys present after packaging a standalone app?

Conceptual documentation cannot enumerate changing module-specific keys safely. The generated module facts must provide them.

## Goals

- Emit every exact unified override target exposed by each selected module.
- Correlate each target to the framework domain/mode fact, module fact, and source.
- Match runtime normalization and nested override shapes exactly.
- Clearly separate unsupported similarly named registries.
- Keep framework-wide domains out of fake module entries.
- Make standalone evaluations require executable exact-key answers.

## Non-Goals

- Adding new unified override domains or changing override runtime behavior.
- Making mutation guards overrideable through `overrides.guards`.
- Replacing the framework extension-point catalog.
- Describing active cross-module contribution bindings; use the topology sibling spec.
- Serializing DI runtime values or executing registries.
- Adding runtime UI/API/database surfaces.

## Proposed Solution

Project exact module-specific targets from the runtime override schema and normalized owned facts through one exhaustive adapter registry. Each target carries a structured path, the applicable runtime mode, a shared fact reference, and portable provenance. Unsupported dynamic entries produce per-module diagnostics; they never become guessed targets or non-module keys at the generated document root.

## Data Models

Add an optional module-specific collection:

```ts
type ModuleOverrideMode = 'disable-replace' | 'replace' | 'additive'

type ModuleOverrideTargetNote =
  | 'safe-metadata-only'
  | 'page-middleware-not-mutation-guard'

type ModuleOverrideTarget = {
  id: string
  domain: ModuleOverrideDomain
  key?: string
  path: string[]
  modes: ModuleOverrideMode[]
  factRef: ModuleFactRef
  source: ModuleFactSourceRef
  notes?: ModuleOverrideTargetNote[]
}

type ModuleFactsJsonEntry = ExistingModuleFactsJsonEntry & {
  overrideTargets?: ModuleOverrideTarget[]
  overrideTargetDiagnostics?: ModuleOverrideTargetDiagnostic[]
}
```

Definitions:

- `domain` is the exact top-level domain accepted by the unified override schema.
- `key` is the runtime lookup key when the domain is a keyed record.
- `path` is the complete property path below `overrides`, preserving nested registries such as `['widgets', 'injection', spotId]`.
- `modes` reference the supported operations already established by the framework extension-point catalog.
- `factRef` points to the module-owned fact being overridden.
- `source` points to the registry, convention file, or defining entry used by runtime normalization.
- `notes` is the closed `ModuleOverrideTargetNote` enum; it is not free-form prose. Framework-only settings are never emitted as module targets.

`id` is deterministically derived from the JSON-serialized tuple `[moduleId, domain, path]`, so segment boundaries cannot collide. `path` rather than a concatenated display string is the lossless authority.

For a keyed-record domain, `key` must equal the terminal key-bearing `path` segment after runtime normalization; it is repeated only as a convenience for consumers that do not render paths. For singleton or structured domains whose terminal path identifies a property rather than a lookup key, omit `key`. A contract test asserts this invariant for every adapter.

Add a deterministic per-module diagnostic collection through `ModuleFactsJsonEntry.overrideTargetDiagnostics`. Reuse the existing module-facts diagnostic renderer where practical, but never add a non-module key or diagnostics array at the generated document root:

```ts
type ModuleOverrideTargetDiagnostic = {
  code: 'missing-owned-fact' | 'missing-source' | 'unsupported-dynamic-key' | 'unknown-framework-domain'
  moduleId: string
  domain: ModuleOverrideDomain
  candidatePath?: string[]
  source?: ModuleFactSourceRef
}
```

Diagnostics sort by `moduleId`, `domain`, `code`, then path/source. They contain no source snippets or runtime values. Release validation fails for missing adapter/domain coverage; per-module dynamic-key diagnostics remain visible and explicitly prevent a fabricated target. A compatibility test asserts that every root key still identifies a selected module and that a legacy root record remains readable unchanged.

## Framework and Module Responsibilities

### Framework catalog

`framework-extension-points.md` / its JSON source continues to define:

- available override domains;
- supported modes and value shapes;
- merge/replace/disable semantics;
- global restrictions and security rules;
- framework-only settings such as `nav.groupOrder`.

Do not create a synthetic framework module merely to attach global keys.

### Module fact sheet

Each module emits only targets it actually exposes after selected-module resolution. A target must correlate to:

1. a runtime override parser/registry entry;
2. a module-owned fact from the provenance prerequisite;
3. an applicable framework domain/mode definition;
4. a portable defining source.

If one of these cannot be proven, emit a diagnostic rather than an invented target.

## Required Domain Coverage

The implementation audits the runtime unified override type/parser and covers every currently supported nested domain. The expected inventory includes:

| Domain/path family | Exact target identity |
|---|---|
| `ai.agents` | agent ID |
| `ai.tools` | tool ID/name used by the resolver |
| `ai.extensions` and AI file overrides | extension/override ID and full nested path |
| `routes.api` | uppercase method plus normalized `/api/...` route key |
| `routes.pages` | backend/frontend application route path |
| `events.subscribers` | subscriber registry ID |
| `workers` | worker registry ID/name |
| `widgets.injection` | injection spot/contribution key shape accepted by runtime |
| `widgets.components` | replaceable component ID plus supported replace/wrap/props path |
| `widgets.dashboard` | dashboard widget ID |
| `notifications.types` | notification type ID |
| `notifications.handlers` | handler ID |
| `interceptors` | exact interceptor contribution key/target identity |
| `commandInterceptors` | exact command interceptor key/target identity |
| `enrichers` | exact response/query enricher key where runtime supports override |
| `guards` | backend/frontend page route middleware identity only |
| `cli` | CLI command ID/name |
| `setup` | supported setup hook/profile override path |
| `acl` | ACL feature ID |
| `di` | Awilix registration token |
| `encryption` | entity/config key accepted by the override resolver |

This table is an audit seed, not a second runtime schema. Implementation must derive the final list from the current unified override types/parser and fail a coverage test when a new domain is added without a target extractor or explicit `framework-only` classification. Every emitted target's top-level `domain` must be a member of the runtime `ModuleOverrideDomain` union; nested segments such as `subscribers` live only in `path`.

## Exact-Key Rules

### API routes

- Use the runtime's canonical uppercase method and normalized route path.
- Record one target per supported method.
- Do not infer methods absent from the route metadata.
- Include the route fact/source and framework modes.

### Pages and guards

- Page targets use the exact application path accepted by the page override resolver.
- `guards` targets backend/frontend `PageRouteMiddleware` convention entries.
- Add the closed note `page-middleware-not-mutation-guard` to the domain description or affected targets.
- `data/guards.ts` mutation guards may remain extension contribution/activation facts but cannot appear under `overrideTargets` with domain `guards`.

### DI

- Use the exact registration token, correlated to the rich DI fact.
- Include registration kind to let guidance choose a safe compatible override.
- Never include the original `asValue` payload, constructed service, or factory/class body.
- Harness modifications must use a benign, isolated test token/provider and restore/clean the fixture.

### Nested widgets and AI

- Preserve the nested path expected by runtime; do not flatten keys ambiguously.
- Correlate replacement, wrapper, props, injection, dashboard, agent, tool, extension, and file-override facts to their distinct paths and supported modes.

### Interceptors, enrichers, subscribers, and workers

- Use the registered contribution/entry ID actually consumed by the override resolver.
- When topology activation facts exist, link `factRef` or a supplemental reference to them; absence of the topology sibling must not prevent the override target from representing a valid registry entry.
- Wildcard target semantics do not change the override entry's own exact registry key.

## Architecture

Build override targets from a registry of domain adapters tied to the unified override schema:

```ts
type OverrideTargetAdapter = {
  domain: ModuleOverrideDomain
  collect(moduleFacts: ModuleFactsJsonEntry): ModuleOverrideTarget[]
  frameworkOnly?: boolean
}
```

Requirements:

- Adapter coverage is checked against the actual top-level/nested override schema.
- Adapters consume normalized owned facts; they do not rescan source independently unless the runtime key is unavailable in those facts.
- Any necessary rescan uses the same parser/normalizer as runtime and the provenance generator.
- The framework catalog and module target generation share domain identifiers and mode enums.
- Output sorts by domain, then path segments, then source.

## Markdown and Guidance

### Module Markdown

Add an **Exact override targets** section with columns:

- domain;
- exact `modules.<moduleId>.overrides...` path/key;
- supported modes;
- referenced fact;
- source.

Render paths as copyable code, but generate them from structured `path` data. Mark global/framework-only domains only in the framework document, not in module sheets.

### Standalone guidance

- Start from the user's target fact and follow its `overrideTargets` reference.
- Require an exact module ID, domain path, and key before proposing code.
- Consult framework facts for value shape/mode semantics.
- Never translate a mutation guard into `overrides.guards`.
- Escalate only to the named source when the fact cannot answer one exact remaining detail.
- Prefer the smallest safe override and preserve module ownership/optional coupling.

## API Contracts

No HTTP API is added or changed. Generated JSON gains only the optional per-module `overrideTargets` and `overrideTargetDiagnostics` fields, and generated Markdown gains one additive section. The root record remains `Record<moduleId, ModuleFactsJsonEntry>` with no synthetic framework or diagnostics key.

## Backward Compatibility

- `overrideTargets` is optional and additive.
- Existing `frameworkExtensionPoints`, module facts, and UMES rows keep their shape and semantics.
- No current runtime override path/key/mode changes.
- Exact IDs/paths published by the new facts become stable according to the underlying runtime contract.
- Existing Markdown headings remain; the new section is additive.
- If implementation discovers that current docs name a key the runtime does not accept, correct the docs with an upgrade note; do not silently change runtime behavior under this spec.

No HTTP, DB, event emission, ACL runtime, or UI contract changes are introduced.

## Implementation Plan

### Phase 1 — Runtime schema audit and shared types

- Enumerate every nested unified override domain and supported mode from the actual parser/types.
- Add shared domain/path/mode types and `overrideTargets` to module facts.
- Add a coverage test requiring an adapter or explicit framework-only classification for every domain.

### Phase 2 — Target adapters

- Implement adapters for routes/pages, subscribers/workers, widgets, notifications, AI, interceptors/enrichers, CLI, setup, ACL, DI, encryption, and page middleware guards.
- Correlate every entry to owned facts and portable source references.
- Add negative correlation diagnostics and mutation-guard/page-guard separation tests.

### Phase 3 — Markdown and facts-first routing

- Render copyable exact paths/keys with modes, fact refs, and source links.
- Update standalone system-extension guidance to require the exact target and framework mode before code generation.
- Keep conceptual guides free of module-specific key lists.

### Phase 4 — Harness and release proof

- Invoke `om-refresh-standalone-harness <from> <to>`.
- Strengthen `OMH-089` so domain-only or plausible guessed answers fail.
- Add representative exact-key cases across all domain families, including a safe DI override and the page/mutation guard distinction.
- Validate packed artifacts in a fresh Verdaccio scaffold and run the full release gate.

## Test Plan

### Generator tests

- One golden target for every adapter/domain family.
- Coverage failure when a runtime override domain has neither an adapter nor `framework-only` classification.
- API method/path normalization and page-path exactness.
- Nested widget and AI path round-trip without flattening loss.
- Exact DI token and registration-kind correlation without values.
- Page middleware appears under `guards`; mutation guard never does.
- Missing fact/source correlation yields a deterministic diagnostic, not a guessed key.
- Repeated generation produces byte-identical JSON/Markdown.

### Runtime contract tests

For representative entries, feed the generated `domain + path + key` into the same resolver/validator used by `modules.ts` and assert it selects the intended entry. Include negative tests for:

- lowercased or missing API methods;
- UI filesystem paths instead of application route paths;
- flattened nested keys;
- mutation guard IDs under page `guards`;
- unknown DI tokens;
- framework-only `nav.groupOrder` attached to a module target.

### Standalone harness

`OMH-089` and related cases must require:

| Case | Required answer evidence |
|---|---|
| API route override | Module ID, exact `METHOD /api/path`, supported mode, fact/source. |
| Page override | Exact application route and mode, not filesystem path. |
| Page guard | Correct middleware target and explicit distinction from mutation guards. |
| Worker/subscriber | Exact registry key and source. |
| Widget/AI nested override | Complete path segments and correct mode. |
| DI override | Exact benign token, registration kind, safe replacement shape, no original value. |
| Framework-only setting | Correctly sourced from framework facts, with no fake module key. |

At least one failure-first case must make a plausible domain-only answer incorrect. Run `harness:validate --all`, then `harness:release` against a freshly packed and scaffolded app.

## Acceptance Criteria

- Every runtime unified override domain has a tested adapter or explicit framework-only classification.
- Every actual selected-module override entry has an exact domain/path/key, modes, fact reference, and portable source.
- Generated targets round-trip through the runtime resolver for representative domain families.
- `overrides.guards` contains only page route middleware targets; mutation guards never appear there.
- DI facts expose all exact tokens safely without runtime values or bodies.
- Framework-only settings remain only in framework facts.
- Existing facts and runtime override behavior remain unchanged.
- `OMH-089` fails domain-only/guessed answers and passes executable exact-key answers.
- Facts survive package packing and a fresh standalone scaffold.
- Focused tests, generation, configured validation, `harness:validate --all`, and full `harness:release` pass.

## Risks & Impact Review

### Generated key disagrees with runtime normalization

- **Severity:** High
- **Mitigation:** Adapter inputs come from normalized owned facts and keys round-trip through the runtime resolver.
- **Residual risk:** A highly dynamic third-party registry may require a diagnostic/source escalation rather than a target.

### Guard terminology causes unsafe overrides

- **Severity:** High
- **Mitigation:** Separate facts, closed note, negative tests, and harness case explicitly distinguish page and mutation guards.
- **Residual risk:** External prose may retain the ambiguous term; generated facts remain authoritative.

### DI override exposes or destabilizes values

- **Severity:** High
- **Mitigation:** Metadata-only schema and benign isolated harness fixtures.
- **Residual risk:** Consumers can still choose an incompatible implementation; registration kind and framework semantics reduce the chance.

### Adapter list drifts from runtime domains

- **Severity:** High
- **Mitigation:** Exhaustive coverage test against the runtime schema.
- **Residual risk:** Runtime types that are not introspectable may need a shared declarative domain registry in a separately reviewed refactor.

## Final Compliance Report — 2026-08-02

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/shared/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule source | Requirement | Status | Evidence in this spec |
|---|---|---|---|
| Root `AGENTS.md` | Preserve public override contracts and avoid unsafe mutation bypass. | Compliant | Facts mirror runtime only; no new domains or behavior. |
| `BACKWARD_COMPATIBILITY.md` | Keep override keys/modes and generated fields stable. | Compliant | Additive target catalog; runtime keys unchanged. |
| `packages/cli/AGENTS.md` | Deterministic facts and source correlation. | Compliant | Structured paths, adapter coverage, sorting, resolver round-trip. |
| `packages/create-app/AGENTS.md` | Standalone exact-key guidance must match packaged runtime. | Compliant | Strengthened OMH-089 and fresh release proof. |
| Root security rules | Never expose DI values/secrets. | Compliant | DI facts and tests are metadata-only. |
| Spec cohesion | One independently deployable capability. | Compliant | This spec owns only exact unified override target facts. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Domain names match runtime | Pass | Top-level domains derive from `ModuleOverrideDomain`; nested names live in structured paths. |
| Keys and paths round-trip | Pass | The terminal-key invariant and runtime resolver tests cover keyed domains. |
| Diagnostics preserve root compatibility | Pass | Diagnostics are optional per-module fields, never root keys. |
| Framework-only settings remain separate | Pass | `nav.groupOrder` stays in framework facts and cannot become a module target. |

### Non-Compliant Items

No non-compliant item or required human confirmation was identified.

### Verdict

**Fully compliant:** approved after the provenance prerequisite as the implementation specification for exact unified override targets.

## Changelog

### 2026-08-02

- Split module-specific exact override targets from general provenance and extension topology.
- Defined exhaustive domain adapters, exact structured paths, page/mutation guard separation, and standalone exact-key proof.
- Aligned domain names with `ModuleOverrideDomain` and constrained diagnostics to per-module entries.

### 2026-08-03 — Implemented

- Added `packages/cli/src/lib/generators/module-override-targets.ts`: a closed adapter registry keyed to the runtime `ModuleOverrideDomain` union (16 domains; `nav` classified framework-only), emitting per-module `overrideTargets` (exact `domain`/`path`/`key`, supported `modes` from the framework override-host catalog, `factRef`, portable `source`, closed `notes`) and per-module `overrideTargetDiagnostics`.
- Enforced the terminal-key invariant and runtime round-trip (API method/path + page-route keys fed back through the real appliers/normalizers); DI targets expose token + registration kind with no values; `overrides.guards` maps to page middleware only (mutation guards excluded with the `page-middleware-not-mutation-guard` note); framework-only `nav.groupOrder` never becomes a module target. Added the copyable **Exact override targets** Markdown section.
- Updated the standalone `om-system-extension` override guidance (`unified-overrides.md`) to route agents through `overrideTargets`/`overrideTargetDiagnostics`, require a bound `activation` before claiming runtime invocation, check the `incoming` index, and keep the page-vs-mutation-guard distinction.
- Verified additively: `@open-mercato/cli` suite green incl. adapter-coverage, round-trip positive/negative, DI no-values, and byte-identical regeneration; bc-guard JSON cap raised for the exhaustive per-entry targets. Also de-corrupted internal composite dedup/sort keys (NUL-byte separators → collision-proof `JSON.stringify` tuples), restoring the touched generators to valid UTF-8.
- Deferred (infra-gated): strengthening `OMH-089` and the fresh-scaffold `harness:release` exact-key proof run in Linux CI with Docker + a model runner; the deterministic `harness:validate --all` catalog and cases.json expansion are the documented follow-up.

## Review — 2026-08-02

- **Fresh-context scope verdict:** KEEP after defining `key`/`path` invariants and deterministic diagnostic storage.
- **Security:** Passed with metadata-only DI and no runtime execution.
- **Performance:** Passed; adapters consume existing normalized facts.
- **Compatibility:** Passed; generated target facts are additive and runtime behavior is unchanged.
- **Scope:** Cohesive; framework semantics and topology remain linked dependencies.
- **Verdict:** Ready for implementation after the provenance prerequisite.

### 2026-08-03 — Code-review corrections

- AI file contracts are split by mode. `aiAgentOverrides` (previously ignored) and `aiToolOverrides` are keyed replace-or-disable maps and emit exact `ai.agents.<id>` / `ai.tools.<id>` targets; additive `aiAgentExtensions` patches stay in the keyless `ai.extensions` array. Only keys are read — replacement definitions and `null` disables are never serialized.
- `notifications.handlers.<id>` targets are emitted from the reactive-handler contributions, keyed by the declared handler id the runtime applier keys on; a handler declaring no id yields a diagnostic instead of a target.
- `setup.defaultCustomerRoleFeatures` is emitted when `setup.ts` declares customer-role profiles.
- An override host the framework catalog does not describe no longer defaults to `disable-replace`: it emits the previously unused `unknown-framework-domain` diagnostic and no target.
