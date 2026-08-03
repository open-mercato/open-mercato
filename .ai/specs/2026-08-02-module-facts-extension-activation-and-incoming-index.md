# Module Facts Bound Extension Activation and Incoming Contribution Index

- **Status:** Proposed — implementation-ready
- **Date:** 2026-08-02
- **Parent:** [Complete Source-Linked Module Extension Contracts](2026-08-02-module-facts-extension-surface-completeness.md)
- **Depends on:** [Source Provenance and Contract Inventory](2026-08-02-module-facts-source-provenance-and-contract-inventory.md)
- **Scope:** `packages/cli` UMES correlation, module-facts/Markdown topology, route/entity activation proof, and standalone harness routing

## TLDR

Distinguish “this entity could host an extension” from “this route or entity actually activates that extension,” and make existing contributions discoverable from both directions. Preserve all published `extensionSurfaces.hosts` and source-owned contribution rows, add an authoritative `activations` layer derived from real call sites, and add compact incoming references to the target module's fact sheet.

This prevents agents from recommending enrichers, guards, interceptors, or widgets merely because a broad host capability exists, while letting a target-module investigation see which optional modules already extend it.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Replace broad host rows with only active hosts? | No. Preserve host rows and add authoritative activations. | Published host arrays and IDs are stable contracts. | ok |
| Q2 | Duplicate full contributions on target modules? | No. Store compact incoming references; retain the full fact on the contributor. | Avoids drift and excessive generated context. | ok |
| Q3 | May inferred naming count as activation? | No. Require a real CRUD-factory option, bridge, registry, or other supported runtime call site. | A plausible target is not proof that runtime invokes the extension. | ok |
| Q4 | How are optional or missing target modules represented? | Keep the source-owned contribution and mark its resolution state deterministically. | Optional integrations must remain module-decoupled and inspectable. | ok |

No assumption needs human confirmation.

## Overview

PR #4810 introduced `extensionSurfaces.hosts` and `extensionSurfaces.contributions`. The contribution facts are valuable: enrichers and interceptors already include targets, phases, behavior metadata, and source paths. The host extractor, however, can advertise generic entity capabilities based on entity presence rather than actual route activation. That makes the catalog useful for discovery but not sufficient for deterministic implementation guidance.

The catalog is also primarily source-oriented. A contributor module shows what it sends elsewhere, but the target module's sheet does not compactly show which installed modules already contribute to it. Developers investigating a host therefore need a repository-wide search or must inspect every other module's fact sheet.

## Problem Statement

The generated catalog currently cannot reliably answer:

- Is response enrichment actually enabled on this route, or does the module merely own an entity with a compatible name?
- Which interceptor bridge invokes this contribution and for which phase/method/path?
- Which mutation guard applies to this concrete entity mutation surface?
- Which installed optional modules already extend this host module, entity, route, spot, or component?
- Is an unresolved contribution intentionally optional, a wildcard target, or a broken reference?
- Which source call site proves the attachment?

Without those answers, standalone guidance can produce code that compiles but is never invoked.

## Goals

- Add authoritative, source-linked activation facts based on real runtime call sites.
- Keep capability/host discovery separate from activation proof.
- Correlate outgoing contributions into compact target-owned incoming indexes.
- Preserve optional-module decoupling, wildcard semantics, and duplicate-module selection.
- Make Markdown and standalone guidance require activation proof for route/entity-bound recommendations.
- Prove bidirectional topology in a fresh standalone harness.

## Non-Goals

- Removing or redefining existing host/contribution facts.
- Adding missing owned-contract provenance; that is the prerequisite spec.
- Publishing exact unified override keys; that is the override-target sibling spec.
- Executing module registries or resolving DI at generation time.
- Introducing direct ORM relationships or runtime dependencies between modules.
- Adding a UI graph, API, database schema, or module activation behavior.

## Proposed Solution

Extend the existing `ModuleExtensionSurfaceFacts` entry with an authoritative activation layer, a compact target-owned incoming index, and one contributor-owned resolution summary per target. Reuse the provenance prerequisite's `ModuleFactSourceRef`/`ModuleFactRef` and the existing UMES contribution discriminant so the new topology is a correlation view over established facts rather than a parallel contribution catalog.

## Data Models

### Activation facts

Add an optional additive collection under the existing extension-surface model:

```ts
type ModuleExtensionContributionKind = ModuleExtensionContributionFact['kind']

type ModuleExtensionActivationKind =
  | 'crud-response-enricher'
  | 'query-enricher'
  | 'mutation-guard'
  | 'api-interceptor-bridge'
  | 'command-interceptor-bridge'
  | 'widget-injection-consumer'
  | 'component-extension-consumer'
  | 'dashboard-host-consumer'

type ModuleExtensionTargetRef = {
  kind: 'module' | 'entity' | 'api-route' | 'command' | 'widget-spot' | 'component' | 'event' | 'notification' | 'wildcard'
  id: string
  moduleId?: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
}

type ModuleExtensionActivation = {
  id: string
  kind: ModuleExtensionActivationKind
  host: ModuleExtensionTargetRef
  contributionKinds: ModuleExtensionContributionKind[]
  phases?: string[]
  source: ModuleFactSourceRef
  bridge?: ModuleFactRef
}

type ModuleExtensionSurfaceFactsAdditions = {
  activations?: ModuleExtensionActivation[]
  incoming?: ModuleIncomingExtensionRef[]
  contributionResolutions?: ModuleContributionResolution[]
}
```

Add `ModuleExtensionSurfaceFactsAdditions` to the existing exported `ModuleExtensionSurfaceFacts` shape; do not introduce a second extension-surface property or rename the public type.

An activation means the selected module's runtime path will query, invoke, merge, or render the named contribution family. `id` must be stable and derived from the host kind and exact normalized runtime identity, not from filesystem order.

Initial activation kinds include:

- CRUD response enricher activation;
- query enricher activation;
- mutation guard activation;
- API interceptor bridge activation;
- command interceptor bridge activation;
- widget injection spot consumption;
- component replacement/wrapper/props consumption;
- dashboard or other registered host consumption already represented by UMES.

The implementation may use narrower discriminated unions where metadata differs, but every fact needs an exact host reference and proof source.

This initial set is closed by an extractor-adapter registry. Its coverage test compares the registry against the existing UMES host capability and contribution-kind enums: every route/entity-bound kind must have an activation adapter or an explicit tested `capability-only` classification. Adding a UMES kind therefore fails CI until its activation behavior is classified. The initial adapters are CRUD response/query enrichment, mutation-guard bridges, API-interceptor bridges, command-interceptor bridges, injection-spot consumers, replaceable-component consumers, and dashboard-host consumers.

### Incoming references

Add compact references after all selected module facts are extracted:

```ts
type ModuleIncomingExtensionRef = {
  contributionId: string
  contributionKind: ModuleExtensionContributionKind
  contributorModuleId: string
  target: ModuleExtensionTargetRef
  activationId?: string
  resolution: 'bound' | 'capability-only' | 'optional-target-missing' | 'wildcard' | 'unresolved'
  source: ModuleFactSourceRef
}
```

The incoming row points to the full contribution fact in the contributor module. It must not duplicate behavior metadata such as timeouts, caching, or payload transforms.

Contributor-owned resolution is recorded separately for every contribution, including states for which no target sheet can own an incoming row:

```ts
type ModuleContributionResolution = {
  contributionId: string
  target: ModuleExtensionTargetRef
  resolution: 'bound' | 'capability-only' | 'optional-target-missing' | 'wildcard' | 'unresolved'
  activationIds: string[]
}
```

This array is the authoritative location for optional-missing, wildcard, and unresolved outcomes. It also gives the contributor a complete resolution summary without modifying the existing contribution union.

### Target identity

Use existing UMES target/fact reference primitives wherever possible. Extend them additively only when a runtime identity cannot be represented. Exact target identities must distinguish, as applicable:

- module;
- entity;
- API route plus method;
- command ID;
- widget spot;
- component ID;
- event or notification ID;
- explicit wildcard target.

Entity names alone are insufficient when two routes or command surfaces activate different extension families.

## Architecture

### Authoritative Activation Rules

### CRUD routes and enrichers

- Derive response/query enricher activation from the actual `makeCrudRoute` options or the shared normalized CRUD-route descriptor.
- Record whether list, detail, or both paths activate the family when the factory makes that distinction.
- Bind the exact route/entity fact and the source line containing the option or bridge.
- An entity declaration without the activation option remains a capability/host fact only.

### Mutation guards

- Bind only when a mutation route or command calls the supported mutation-guard bridge for the exact entity/action.
- Do not treat page route middleware as mutation guards.
- Do not infer activation from the existence of `data/guards.ts` alone.

### API and command interceptors

- Bind API interceptor contributions to the concrete interceptor bridge and normalized method/path/phase set.
- Bind command interceptors to the command bus/bridge and exact command/phase set.
- Preserve wildcard targets explicitly; never expand them into a guessed list during generation.

### Widgets and component extension

- Bind injection contributions to host spots actually consumed through the supported widget/injection helpers.
- Bind component replacement/wrapper/props contributions to registered replaceable component IDs.
- If an existing host fact already proves consumption, activation may reference it rather than duplicate fields.

### Explicit bridges

Modules that do not use a factory may expose an activation through a supported static bridge declaration. The bridge must be an existing runtime convention or a separately approved additive contract; this implementation must not invent a facts-only manifest that runtime ignores.

### Correlation Algorithm

1. Extract selected module-owned facts and source provenance.
2. Extract existing hosts, contributions, and new activation facts without changing their runtime meaning.
3. Build indexes by normalized module/fact/target identity.
4. For each contribution, resolve its target against selected modules and activations.
5. Append one compact incoming reference to the target module for each matching activation. When only a compatible legacy host exists, append one capability-only row with no `activationId`.
6. Append one contributor-owned resolution row per contribution target. Keep optional-missing, wildcard, and unresolved states there; add them to `incoming` only when a concrete target owner exists.
7. Sort and deduplicate deterministically.

An incoming row's deduplication identity is `contributorModuleId + contributionId + normalized target + (activationId ?? resolution)`. One contribution matching two activations therefore emits two incoming rows and one contributor-owned resolution row whose sorted `activationIds` contains both IDs.

Resolution rules:

- `bound`: an authoritative activation accepts the contribution kind and target.
- `capability-only`: a compatible legacy host exists, but no activation proves runtime use.
- `optional-target-missing`: the contribution targets an optional module not selected in this build.
- `wildcard`: the target is intentionally wildcarded and cannot be assigned to one host.
- `unresolved`: the target should be concrete but no selected host/capability can resolve it.

Generation diagnostics must distinguish `optional-target-missing` from `unresolved`; optional integrations are not build failures.

## API Contracts

No HTTP API is added or changed. The only published output changes are optional fields on each module's existing `ModuleFactsJsonEntry.extensionSurfaces`; the top-level `module-facts.json` record and every existing extension-surface field retain their current shape and meaning.

## Backward Compatibility

- Keep every current `extensionSurfaces.hosts` and `extensionSurfaces.contributions` item and field unchanged.
- Do not change stable host/contribution IDs or reinterpret their semantics.
- Add `activations` and `incoming` as optional properties; current generators emit deterministic arrays according to existing empty-section conventions.
- Keep source-owned contribution facts authoritative.
- Append Markdown sections/columns without renaming current headings.
- Guidance changes may say a host is “available” from the legacy row, but must require a bound activation before claiming runtime invocation.

No HTTP, database, event, ACL, widget, or DI runtime contract changes are introduced.

## Markdown and Guidance

### Module fact sheet

Render three explicitly distinct concepts:

1. **Available extension hosts** — existing capability rows.
2. **Active extension bindings** — exact host/call-site proof with source links.
3. **Incoming installed contributions** — contributor module, kind, target, resolution, activation link, and source link.

Do not merge capability-only and bound rows under an ambiguous “supports” label.

### Standalone system-extension guidance

- Route entity/route extension recommendations through `activations`, not broad hosts.
- Use `incoming` to detect an already-installed contributor before proposing a duplicate.
- Inspect the full contributor fact by `contributorModuleId + contributionId` when behavior details are needed.
- Escalate to the named activation/contribution source only if the generated fact lacks one exact detail.
- Explain optional-missing and wildcard states without recommending direct cross-module ORM coupling.

## Implementation Plan

### Phase 1 — Activation schema and extraction

- Add optional activation types and stable identity helpers.
- Reuse source references from the prerequisite spec.
- Extract CRUD, guard, interceptor, widget, and component activations from real normalized call sites.
- Add negative fixtures proving entity presence alone does not activate a family.

### Phase 2 — Cross-module incoming correlation

- Build post-selection correlation indexes.
- Resolve exact, optional, wildcard, capability-only, and broken targets.
- Emit compact incoming rows and contributor-owned resolution rows while preserving source ownership.
- Add deterministic duplicate-selection and contribution-deduplication tests.

### Phase 3 — Markdown and diagnostics

- Render separate capability, activation, and incoming sections with source links.
- Add generator diagnostics for unresolved concrete targets without failing valid optional integrations.
- Measure JSON/Markdown growth on the largest selected host.

### Phase 4 — Standalone harness

- Invoke `om-refresh-standalone-harness <from> <to>`.
- Update facts-first routing and case metadata.
- Add failure-first cases where a broad host exists but activation is absent.
- Add an installed optional contributor fixture and a missing-optional-target fixture.
- Run fresh Verdaccio scaffold validation and full release proof.

## Test Plan

### Focused generator tests

- CRUD route with response/query enricher activation.
- Same entity without factory activation yields capability-only, never bound.
- Mutation guard bridge is distinct from page middleware.
- API and command interceptor phases bind to exact host identities.
- Widget spot and replaceable component consumption bind correctly.
- Source link points to the activation call site.
- Exact, wildcard, optional missing, unresolved, and duplicate-provider resolution.
- One contribution matching two activations emits two incoming rows with the documented identities and one sorted resolution summary.
- Existing hosts/contributions golden fixture is unchanged.

### Cross-module fixtures

Use at least:

- one core host plus one installed optional contributor;
- two contributors targeting the same host;
- one contributor targeting two valid activations;
- one optional contributor whose target module is absent;
- one intentionally malformed concrete target;
- one wildcard interceptor.

Assert both the contributor's full outgoing fact and the host's compact incoming reference.

### Standalone cases

| Case | Expected behavior |
|---|---|
| Capability without activation | Agent refuses to claim the extension will run and cites the missing activation. |
| Bound enricher | Agent identifies exact host, activation source, and contributor fact. |
| Existing incoming contribution | Agent finds the installed extension from the host sheet and avoids duplication. |
| Optional target absent | Agent preserves decoupling and explains the non-error state. |
| Wildcard interceptor | Agent reports wildcard semantics without fabricating individual hosts. |

Run focused package tests, `yarn generate`, the configured validation subset, `harness:validate --all`, and `harness:release` in a freshly scaffolded app.

## Acceptance Criteria

- No broad entity/route capability is described as active without a source-linked activation fact.
- Every adapter-registry bridge produces a deterministic activation with an exact host identity, and every UMES route/entity-bound kind has an adapter or tested capability-only classification.
- Every concrete installed contribution has a correct target-owned incoming reference or a tested resolution state.
- Every contribution target has a contributor-owned resolution row, including optional-missing, wildcard, and unresolved outcomes.
- Full contribution behavior remains source-owned and is not duplicated into the incoming index.
- Optional missing modules and wildcards remain valid and do not create forbidden direct dependencies.
- Existing host/contribution arrays and stable IDs remain unchanged.
- Markdown clearly separates capability, activation, and incoming topology and includes portable links.
- Standalone guidance refuses unsupported activation claims and finds already-installed contributors facts-first.
- Fresh standalone package/scaffold and full harness release gates pass.

## Risks & Impact Review

### False activation from static parsing

- **Severity:** High
- **Mitigation:** Require recognized runtime factory/bridge call sites and negative fixtures.
- **Residual risk:** Highly dynamic custom routes may remain capability-only and require source inspection.

### Cross-module correlation creates coupling

- **Severity:** High
- **Mitigation:** Correlation is generated documentation only; runtime ownership and optional selection remain unchanged.
- **Residual risk:** Consumers may misread incoming facts as hard dependencies; resolution labels and guidance must prevent this.

### Duplicate or excessive topology

- **Severity:** Medium
- **Mitigation:** Compact references, stable tuple deduplication, source-owned full facts, and byte-budget measurements.
- **Residual risk:** Wildcard-heavy ecosystems may still need filtered loading later.

### Legacy consumers interpret new rows incorrectly

- **Severity:** Medium
- **Mitigation:** Add optional sibling arrays and retain old semantics/headings.
- **Residual risk:** Exact-object consumers may need release notes despite additive JSON.

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
| Root `AGENTS.md` | No direct cross-module ORM relationship; preserve optional integration. | Compliant | Correlation is generated documentation with explicit optional states. |
| `BACKWARD_COMPATIBILITY.md` | Preserve stable generated hosts/contributions and IDs. | Compliant | Existing arrays remain unchanged; activations/incoming are additive. |
| `packages/cli/AGENTS.md` | Deterministic static generation. | Compliant | Exact call-site extraction, stable sorting, and parity fixtures. |
| `packages/create-app/AGENTS.md` | Standalone guidance and packaging stay aligned. | Compliant | Refresh skill, failure-first cases, and fresh release gate. |
| Spec cohesion | One independently deployable capability. | Compliant | This spec owns only extension topology and bidirectional correlation. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Activation identities match target identities | Pass | The shared target reference distinguishes route methods and all supported host kinds. |
| Incoming rows point to source-owned contributions | Pass | Incoming facts remain compact and never duplicate contribution behavior. |
| Resolution cardinality is defined | Pass | One target can resolve to multiple activation IDs with deterministic ordering. |
| Optional-module behavior remains decoupled | Pass | Missing optional targets are contributor-owned non-error outcomes. |

### Non-Compliant Items

No non-compliant item or required human confirmation was identified.

### Verdict

**Fully compliant:** approved after the provenance prerequisite as the implementation specification for authoritative bidirectional extension topology.

## Changelog

### 2026-08-02

- Split authoritative activation and incoming topology from owned fact provenance and exact override targets.
- Preserved all legacy host/contribution facts while defining source-linked bindings and target-side references.
- Defined the shared target, activation, and contribution-kind identities used by the additive topology fields.

### 2026-08-03 — Implemented

- Added `ModuleExtensionSurfaceFactsAdditions` (`activations`, `incoming`, `contributionResolutions`) to `packages/shared/src/modules/widgets/extension-points.ts` and the closed extractor-adapter registry in `module-extension-facts.ts` (compile-time exhaustive `Record` + runtime coverage test) deriving activations from real call sites; entity presence alone stays `capability-only`, never `bound`.
- Built the post-selection cross-module correlation (`correlateIncomingExtensions`) emitting compact target-owned incoming rows and contributor-owned resolutions (bound / capability-only / optional-target-missing / wildcard / unresolved), with the documented two-activation cardinality and deterministic dedup/sort; three distinct Markdown sections (available hosts / active bindings / incoming).
- Verified additively: existing hosts/contributions golden fixtures unchanged; `@open-mercato/cli` + `@open-mercato/shared` suites green. The bc-guard byte budget was raised for the additive topology layers (no contribution payloads duplicated).
- Deferred (infra-gated): the fresh-scaffold `harness:release` proof runs in Linux CI with Docker + a model runner.

## Review — 2026-08-02

- **Fresh-context scope verdict:** KEEP after defining contributor-owned resolution storage, multi-activation cardinality, and the closed bridge-adapter coverage rule.
- **Security:** Passed; only static contract identifiers and paths are emitted.
- **Performance:** Passed with compact references and byte-budget evidence.
- **Compatibility:** Passed; legacy arrays and IDs are preserved.
- **Scope:** Cohesive; owned inventory and override syntax are explicit dependencies/non-goals.
- **Verdict:** Ready for implementation after the provenance prerequisite.
