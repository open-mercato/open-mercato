# Module Facts Source Provenance and Contract Inventory

- **Status:** Proposed — implementation-ready
- **Date:** 2026-08-02
- **Parent:** [Complete Source-Linked Module Extension Contracts](2026-08-02-module-facts-extension-surface-completeness.md)
- **Depends on:** merged PR [#4810](https://github.com/open-mercato/open-mercato/pull/4810)
- **Scope:** `packages/cli` module-facts generation and Markdown, module discovery readers, generated-file compatibility, and `packages/create-app` standalone harness packaging

## TLDR

Make the generated module fact sheet the deterministic, source-linked inventory of every public or auto-discovered contract owned by an installed module. Preserve all existing JSON shapes, add portable provenance alongside them, fill the currently absent command/worker/middleware/setup/encryption/rich-DI/custom-entity/AI-extension/generator-plugin families, and close recursive-subscriber plus vector/integration coverage gaps in the established rich contribution facts.

This spec does not decide whether another module actively attaches to those contracts and does not define unified override keys. Those are the responsibilities of the sibling topology and override-target specs.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Which files qualify for inventory? | Public, auto-discovered, targetable, replaceable, or dependency-bearing module contracts only. | Arbitrary internal helpers are not extension contracts and would make facts noisy. | ok |
| Q2 | May source-linked objects replace legacy scalar arrays? | No. Keep legacy fields byte-compatible and add optional provenance/index fields. | Published generated schemas are stable contract surfaces. | ok |
| Q3 | What DI registrations are visible? | Functions, classes, values, and supported aliases, with static metadata only. | Every registered token can affect extension behavior, but runtime values may be sensitive. | ok |
| Q4 | Should runtime and fact discovery be separate parsers? | No. Extract or reuse a normalized reader shared with runtime discovery wherever practical. | Parallel parsers drift and produce misleading documentation. | ok |

No assumption needs human confirmation.

## Overview

PR #4810 added the Unified Module Extension Surface (UMES) catalog and correlated many outgoing contributions. The pre-existing module-facts generator already covers pages, API routes, CLI commands, AI tools, and AI agents with source paths. Other sections remain scalar-only, omit their existing source metadata in Markdown, or are absent despite being discovered by runtime conventions.

The repository audit on 2026-08-02 found 70 package module roots representing 60 selected module IDs. Among those roots were 41 DI registries, 48 setup files, 19 workers, 23 subscriber roots, 19 command roots, 15 encryption declarations, 13 custom-entity declarations, 7 integration manifests, and 2 generator plugins. Counts are evidence only; implementation tests must discover the current selected module set rather than freeze these numbers.

## Problem Statement

An app developer or coding agent cannot answer all of these questions from generated facts alone:

- Where is this entity, event, ACL feature, DI token, search declaration, notification, or setup hook defined?
- Which commands, workers, middleware, encryption declarations, integration bundles, and generator plugins does the module own?
- Is a DI token registered as a class, factory, value, or alias, and with which safe lifetime/injection mode?
- Does the fact describe what runtime actually discovers, including nested subscriber directories?
- Will the same facts be present after publishing and installing a standalone app package?

The fallback is broad source search. That is slow, non-deterministic, and sometimes impossible in the installed package because the relevant source was not packaged.

## Goals

- Give every owned contract fact a stable portable reference to its defining source.
- Cover the complete public and auto-discovered module contract boundary.
- Preserve current `ModuleFacts` and Markdown consumers additively.
- Reuse runtime discovery semantics instead of implementing approximations.
- Keep output deterministic across local monorepo and installed standalone contexts.
- Prove facts-first routing and source escalation in the standalone harness.

## Non-Goals

- Active extension bindings or host-side incoming contribution indexes.
- Exact keys accepted by `modules.ts` unified overrides.
- Executing modules, resolving DI containers, importing runtime values, or evaluating registrations.
- Cataloging private helpers, React components that are not discovery surfaces, or arbitrary exports.
- Adding a runtime API, Platform Map UI, persistence, migrations, or telemetry.
- Renaming existing IDs, filenames, or convention paths.

## Proposed Solution

Extend the existing module-facts entry additively with one shared provenance/reference vocabulary and source-linked owned-contract facts only for families that have no richer established representation. Existing rich facts remain authoritative and receive provenance-index entries; they are not copied into a second payload. Runtime discovery and fact generation must consume the same normalized reader, or prove parity with one shared fixture where package boundaries prevent code reuse.

## Data Models

### Provenance and reference primitives

Add an exported optional provenance model in the shared module-facts contract:

```ts
export type ModuleFactSourceRef = {
  sourcePath: string
  exportName?: string
  line?: number
}

export type ModuleFactRef = {
  factSection: string
  factKey: string
}

export type ModuleFactSourceKind =
  | 'module-metadata'
  | 'entity'
  | 'event'
  | 'acl-feature'
  | 'api-route'
  | 'di-registration'
  | 'search'
  | 'vector'
  | 'notification'
  | 'cli-command'
  | 'backend-page'
  | 'frontend-page'
  | 'ai-tool'
  | 'ai-agent'
  | 'ai-extension'
  | 'command'
  | 'subscriber'
  | 'worker'
  | 'page-middleware'
  | 'setup'
  | 'encryption'
  | 'custom-entity'
  | 'integration'
  | 'generator-plugin'
  | 'extension-host'
  | 'extension-contribution'

export type ModuleOwnedContractKind =
  | 'module-metadata'
  | 'command'
  | 'worker'
  | 'page-middleware'
  | 'setup'
  | 'encryption'
  | 'di-registration'
  | 'custom-entity'
  | 'ai-extension'
  | 'generator-plugin'

export type ModuleFactSafeScalar = string | number | boolean | null

export type ModuleOwnedContractFact = {
  kind: ModuleOwnedContractKind
  id: string
  source: ModuleFactSourceRef
  metadata?: Record<string, ModuleFactSafeScalar | ModuleFactSafeScalar[]>
}

export type ModuleOwnedContracts = Partial<
  Record<ModuleOwnedContractKind, ModuleOwnedContractFact[]>
>
```

`sourcePath` uses the existing canonical representation: a POSIX-normalized portable installed-source path that includes the `sourceRoot` prefix (for example `node_modules/@open-mercato/core/src/modules/customers/acl.ts`). It is not a second path relative to `sourceRoot`, and it must never be an absolute workstation path. Markdown renders that exact portable path as a link from the generated document. `line` is optional because AST recovery can fail after transforms; consumers must use the path and exported symbol as the stable identity.

Add a deterministic provenance index without replacing legacy fields:

```ts
export type ModuleFactSourceEntry = {
  kind: ModuleFactSourceKind
  id: string
  source: ModuleFactSourceRef
}

export type ModuleFactsJsonEntry = ExistingModuleFactsJsonEntry & {
  factSources?: ModuleFactSourceEntry[]
  ownedContracts?: ModuleOwnedContracts
  factDiagnostics?: ModuleFactDiagnostic[]
}

export type ModuleFactDiagnostic = {
  code: 'duplicate-source' | 'unresolved-static-contract'
  kind: ModuleFactSourceKind
  id: string
  source?: ModuleFactSourceRef
}
```

`kind + id` is unique inside one module. When multiple declarations claim the same identity, select one canonical source using the same convention/provider precedence as runtime discovery and emit a deterministic duplicate-source diagnostic for the rejected declarations. Entries sort first by `kind`, then `id`; `sourcePath` is only a final deterministic tie-breaker while assembling candidates. Existing source-bearing rich fields remain unchanged.

### Owned contract families

`ownedContracts` adds source-linked facts only where a richer established field does not already exist. Established rich facts are referenced through `factSources` and `ModuleFactRef`; they are never copied into `ownedContracts`. The concrete family types may be narrower discriminated unions in implementation, but the public JSON projection must follow this ownership table:

| Family | Projection | Required safe fields | Authoritative convention |
|---|---|---|---|
| Module metadata | New `ownedContracts` fact | module ID, version/metadata flags, required module IDs, ejectable state, source | `index.ts` metadata used by module selection |
| Domain commands | New `ownedContracts` fact | command ID, source | recursive `commands/*.ts` discovery |
| Subscribers | Reuse `extensionSurfaces.contributions[kind=subscriber]`; add `factSources` entry and make its reader recursively match runtime | subscriber ID, event patterns when statically declared, source | the same recursive subscriber scanner used at runtime |
| Workers | New `ownedContracts` fact | worker ID, queue/name metadata when static, source | the runtime worker scanner |
| Page middleware | New `ownedContracts` fact | surface (`backend` or `frontend`), middleware ID or export, source | `backend/middleware.ts`, `frontend/middleware.ts` |
| Setup | New `ownedContracts` fact | present hooks, exported default-role/profile identifiers when static, source | `setup.ts` recognized exports |
| Encryption | New `ownedContracts` fact | entity IDs and declared encrypted fields only when statically safe, source | `encryption.ts` |
| DI registrations | New `ownedContracts` fact; keep legacy `diTokens` | token, registration kind, provider symbol if static, lifetime, injection mode, source | `di.ts` registration map |
| Custom entities/fields | New `ownedContracts` fact | owned entity or field-set ID and source | `ce.ts`, custom-field DSL convention files |
| Search/vector | Reuse `searchEntities` plus `extensionSurfaces.contributions[kind=specialized-registry]`; add `factSources` entries | indexed entity or provider ID, search kind, source | `search.ts`, `vector.ts`, and current runtime readers |
| Integrations | Reuse `extensionSurfaces.contributions[kind=specialized-registry]`; add `factSources` entries and complete its array/bundle reader | integration IDs, bundle membership, manifest kind, source | `integration.ts` singular/array/bundle exports |
| AI tools/agents | Reuse existing rich facts and specialized-registry contributions; add `factSources` entries | stable ID/name and source | `ai-tools.ts`, `ai-agents.ts` |
| AI extensions/file overrides | New `ownedContracts` fact only when no established rich field represents the export | extension ID, file override target if declared, source | AI extension and override convention files |
| Generator plugins | New `ownedContracts` fact | plugin ID/name and source | `generators.ts` `generatorPlugins` export |

Existing rich page, route, CLI, tool, and agent facts remain authoritative. Their source references are also added to `factSources` so consumers can use one uniform provenance lookup.

### Safe page metadata

The current page facts already contain route path and source. Add only statically declared metadata that affects extensibility or access:

- auth/customer-auth requirement presence;
- feature/customer-feature identifiers;
- navigation visibility/group/order identifiers when declared;
- page context or extension spot identifiers exposed by metadata.

Do not serialize executable guards, translation results, React nodes, or arbitrary metadata values. Exact unified override page keys belong to the override-target sibling spec.

### Complete DI facts

The current `diTokens: string[]` must remain. Add rich registration facts covering all supported Awilix registration forms:

```ts
type ModuleDiRegistrationFact = {
  token: string
  registrationKind: 'function' | 'class' | 'value' | 'alias'
  providerSymbol?: string
  lifetime?: 'singleton' | 'scoped' | 'transient'
  injectionMode?: 'classic' | 'proxy'
  source: ModuleFactSourceRef
}
```

Requirements:

- Recognize `asFunction`, `asClass`, `asValue`, and the alias form supported by the repository's Awilix version and DI DSL.
- Resolve static object spreads and local constants only through the same bounded AST utilities used by module-facts generation.
- Record `providerSymbol` only when it is a local/static identifier.
- Never import or execute `di.ts` to inspect it.
- Never serialize the value passed to `asValue`, factory/class bodies, credentials, configuration payloads, or inferred runtime types.
- Keep `diTokens` derived from the normalized rich facts plus any legacy fallback so no current token disappears.

## Architecture

### One normalized discovery path

For each convention family:

1. Locate the runtime scanner or parser.
2. Extract a pure normalized reader when the runtime code currently mixes filesystem discovery with registration.
3. Have runtime registration and module-facts generation consume that reader, or add parity fixtures when sharing would introduce a runtime/package dependency cycle.
4. Transform normalized facts into the additive JSON and Markdown models.

The generator must not import module code. All extraction remains static and side-effect free.

### Deterministic generation

- Select duplicate module IDs with the existing provider-selection rules.
- Normalize separators to `/`.
- Sort every emitted collection by its stable identity.
- Deduplicate identical candidates, then select one canonical source per `kind + id` using runtime convention/provider precedence; report non-identical rejected declarations deterministically.
- Emit empty optional arrays consistently according to the existing generator convention.
- Keep Markdown relative links valid from the generated output directory.

### Markdown rendering

Update the module Markdown sheet so that:

- existing source-bearing rows actually render clickable source links;
- scalar sections gain a `Source` column through `factSources` or `ownedContracts`;
- missing optional metadata renders as `—`, never guessed text;
- source links use repository-relative paths and optional line anchors supported by the renderer;
- sections with no facts retain current empty/omission behavior.

## API Contracts

No HTTP API changes are introduced. Generated-file changes are additive:

- preserve the top-level `Record<moduleId, ModuleFactsJsonEntry>` shape;
- preserve all existing properties, types, and required fields;
- add only optional exported properties in the shared type;
- keep existing Markdown headings and append columns/sections;
- version any standalone prompt schema marker that depends on the new facts;
- document the additions in `UPGRADE_NOTES.md` if the implementation changes a published import or generated contract expectation.

## Implementation Plan

### Phase 1 — Contract and provenance

- Add `ModuleFactSourceRef`, source kinds, `factSources`, and `ownedContracts` types in the current shared module-facts contract.
- Add compatibility fixtures that load a pre-change JSON sample with the new reader.
- Centralize stable IDs, path normalization, sorting, and deduplication.

### Phase 2 — Existing fact provenance

- Correlate source references for entities, events, ACL features, DI tokens, search/vector declarations, notifications, CLI, pages, routes, AI tools/agents, and current extension facts.
- Render the already-available UMES contribution sources in Markdown.
- Add safe page metadata.

### Phase 3 — Missing owned families

- Add new owned facts for domain commands, workers, page middleware, setup, encryption, rich DI, custom-entity/field ownership, AI extensions/file overrides, and generator plugins.
- Extend the established subscriber and specialized-registry readers for recursive subscribers, vector facts, and integration arrays/bundles; reference those rich facts instead of duplicating their payloads in `ownedContracts`.
- Align each reader with runtime discovery and add parity fixtures.
- Run `yarn generate` after changing auto-discovery inputs or generated registries.

### Phase 4 — Standalone packaging and harness

- Invoke `om-refresh-standalone-harness <from> <to>` for the implementation range.
- Ensure the create-app package includes every reader/template/source file required to generate the facts after packing.
- Update the system-extension guidance to treat the fact sheet as authoritative and source as escalation for one unresolved named detail.
- Add/refresh facts-only cases for provenance and each newly represented contract family.
- Add a deliberate failure-first fixture where the fact is absent, so a plausible source-only answer fails.

## Test Plan

### Unit and contract tests

- Golden JSON and Markdown output for every contract family.
- Legacy fixture compatibility: no existing field disappears or changes type.
- Cross-platform path normalization and deterministic ordering.
- No absolute path, source body, function body, runtime value, secret-like key/value, tenant ID, user ID, or customer ID appears.
- DI fixtures for function, class, value, alias, lifetime, injection mode, spread, and unresolved dynamic registration.
- Recursive nested subscriber and worker fixtures match runtime discovery.
- Integration-array/bundle and generator-plugin fixtures cover all supported declaration shapes.
- Duplicate module ID selection matches runtime provider selection.
- Duplicate declarations of one `kind + id` select the runtime-authoritative source and emit deterministic rejected-source diagnostics.
- Established subscriber, search, vector, integration, tool, and agent facts gain `factSources` references without duplicating their payloads in `ownedContracts`.
- Every top-level `module-facts.json` key still resolves to a selected module ID; diagnostics remain inside the owning module entry.

### Runtime parity tests

For each shared or parallel reader, use one fixture tree to compare:

- files runtime discovery would register;
- files/facts the generator reports;
- stable IDs and source paths after selection.

Dynamic declarations that cannot be resolved statically must produce an explicit diagnostic or partial fact, never a fabricated value.

### Standalone harness cases

| Case | Required proof |
|---|---|
| Facts provenance | Agent cites the exact generated fact and portable source path without broad search. |
| DI classification | Agent distinguishes a value token from factory/class registration and does not reveal its value. |
| Worker/subscriber discovery | Nested contract is present and points to the runtime-discovered source. |
| Setup/encryption safety | Agent reports only hook/entity/field identifiers allowed by the schema. |
| Installed packaging | Fresh Verdaccio scaffold contains and generates the same fact families. |

Run `harness:validate --all`, then the full `harness:release` gate after package build/publish/scaffold. The release proof must come from a fresh app, not the monorepo checkout.

## Acceptance Criteria

- Every selected module's public/auto-discovered owned contract is either represented or explicitly classified out of scope by a tested rule.
- Every represented fact has a portable source reference, including current UMES contributions in Markdown.
- Pages keep their existing path/source behavior and gain only safe static metadata.
- `diTokens` remains compatible while rich DI facts cover function, class, value, and alias registrations safely.
- Runtime and generated discovery agree for recursive and specialized convention families.
- JSON/Markdown output is deterministic on repeated generation.
- No generated output leaks executable bodies, runtime values, credentials, scoped data, or absolute paths.
- The facts and required sources survive package packing and a fresh standalone scaffold.
- Focused tests, `yarn generate`, the configured validation subset, `harness:validate --all`, and `harness:release` pass.

## Risks & Impact Review

### Static analysis overclaims dynamic declarations

- **Severity:** High
- **Mitigation:** Emit only statically proven fields, preserve unresolved diagnostics, and compare against runtime fixture discovery.
- **Residual risk:** Third-party modules with computed registries may expose only a partial fact and require source escalation.

### Facts expose sensitive DI values

- **Severity:** High
- **Mitigation:** Schema excludes values and bodies; security tests reject secret-like content and absolute paths.
- **Residual risk:** A token name itself may reveal architecture, which is already part of the published DI contract.

### Generated context grows too large

- **Severity:** Medium
- **Mitigation:** Central provenance index, references instead of source snippets, stable deduplication, and byte-budget assertions for the largest module.
- **Residual risk:** Large third-party modules may need targeted section loading later.

### Runtime/parser drift

- **Severity:** High
- **Mitigation:** Shared normalized readers or mandatory parity fixtures for every family.
- **Residual risk:** Runtime conventions added without updating the reader; CI coverage must make this visible.

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
| Root `AGENTS.md` | Preserve generated contract surfaces. | Compliant | Additive JSON/Markdown boundary and legacy fixtures. |
| `BACKWARD_COMPATIBILITY.md` | Do not remove stable fields/imports. | Compliant | No existing field is replaced; new properties are optional. |
| `packages/cli/AGENTS.md` | Deterministic, static generation and runtime-aligned discovery. | Compliant | Normalized readers, sorting, and parity tests. |
| `packages/create-app/AGENTS.md` | Keep standalone packaged artifacts aligned. | Compliant | Pack, fresh-scaffold, validation, and release gates. |
| Root security rules | Do not expose secrets or scoped data. | Compliant | Explicit safe schema and negative tests. |
| Spec cohesion | One independently deployable capability. | Compliant | This spec owns only source-linked owned contract inventory. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match generated contracts | Pass | New fields are optional per-module fields; the root module record is unchanged. |
| Existing rich facts remain authoritative | Pass | The projection table references subscriber/search/vector/integration/AI facts instead of duplicating them. |
| Risks cover extraction and packaging | Pass | Static overclaiming, sensitive metadata, context growth, and reader drift are covered. |
| Test plan covers every new family | Pass | Unit, parity, compatibility, and fresh standalone release gates are specified. |

### Non-Compliant Items

No non-compliant item or required human confirmation was identified.

### Verdict

**Fully compliant:** approved as the prerequisite implementation specification for source-linked owned contract inventory.

## Changelog

### 2026-08-02

- Split source provenance and owned contract inventory from extension topology and override-key work.
- Specified additive source references, complete safe DI classification, runtime discovery parity, and standalone package/harness proof.
- Kept established rich extension/search/AI facts authoritative and made root-record compatibility an explicit regression gate.

### 2026-08-03 — Implemented

- Added the additive provenance vocabulary (`ModuleFactSourceRef`, `ModuleFactRef`, `ModuleFactSourceKind`, `factSources`, `factDiagnostics`) and `ownedContracts` families (module-metadata, command, worker, page-middleware, setup, encryption, di-registration, custom-entity, ai-extension, generator-plugin) to `packages/cli/src/lib/generators/module-facts.ts`, with rich Awilix DI classification (`asFunction`/`asClass`/`asValue`/alias) and legacy `diTokens` preserved.
- Aligned the subscriber reader to runtime recursion and completed integration array/bundle coverage; added `factSources` provenance without duplicating rich payloads; added safe static page metadata and Markdown source columns/sections.
- Provenance index (`factSources`) covers fact kinds lacking an inline source; kinds already carrying `sourcePath`/`source` are referenced by identity, keeping the aggregate JSON within the determinism byte guard.
- Verified additively: `@open-mercato/cli` suite green (no legacy field/count change; customers golden fixture unchanged), determinism + no-leak negatives covered by `module-facts.owned-contracts.test.ts`.
- Deferred (infra-gated): the fresh-Verdaccio scaffold `harness:release` proof runs in Linux CI with Docker + a model runner; the deterministic packaging path is covered by the create-app byte-identical fact-index test.

## Review — 2026-08-02

- **Fresh-context scope verdict:** KEEP after canonicalizing portable source paths and duplicate-source selection.
- **Security:** Passed with value/body/path exclusion requirements.
- **Performance:** Passed with deterministic deduplication and byte-budget evidence.
- **Compatibility:** Passed as an additive generated-contract change.
- **Scope:** Cohesive; topology and override targets are explicit sibling specs.
- **Verdict:** Ready for implementation after parent suite approval.

### 2026-08-03 — Code-review corrections

- `factSources` is now the uniform provenance index the spec calls for: every proven `(kind, id)` is emitted. Kinds whose declaration site is already serialized inline (api routes, pages, CLI commands, AI tools/agents, owned contracts, UMES hosts and contributions) emit a typed `factRef` pointer instead of a duplicated source ref, and `factKey` is omitted when it equals the entry `id`. `ModuleFactIndexRef` is the pointer shape; `packages/cli/src/lib/generators/module-fact-sources.ts` is the single lookup that resolves either projection (including the extra hop for `fact-ref` hosts).
- Fixed two `fact-ref` host references that pointed at keys absent from the referenced section: query-lifecycle hosts now key into `searchEntities` by entity id, and api-entity hosts carry a real declaration source for the `api/**` file that declares the enricher or mutation-guard resource.
- Markdown renders a resolved Source cell for entities, events, ACL features, DI tokens, search entities, notifications, UMES hosts and UMES contributions; activation rows render the activation id and bridge instead of a bare kind; contribution resolutions render as their own source-linked section.
- Page metadata follows the runtime companion-file convention (`page.meta.*`, then `meta.*`) and the runtime `PageMetadata` contract keys with `resolvePageRouteMetadata` alias precedence (`pageGroup ?? group`, `pageGroupKey ?? groupKey`, `pageOrder ?? order`, plus `pageContext`); the non-contract `pageContextId` / `extensionSpotId` aliases were dropped. 212 backend pages that previously emitted no metadata now do.
- Worker facts derive the runtime id (`metadata.id ?? <module>:workers:<path>`) so id-less root and nested workers are no longer dropped, and resolve `queue` / `name` through local constants. A worker declaring no queue is not registered by runtime and is reported as a diagnostic instead of a contract.
- The determinism byte guard was raised explicitly, with the reason recorded in `module-facts.bc-guard.test.ts`.
