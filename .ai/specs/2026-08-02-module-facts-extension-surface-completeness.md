# Complete Source-Linked Module Extension Contracts — Spec Suite Index

- **Status:** Proposed umbrella index — design only, not directly implementable
- **Date:** 2026-08-02
- **Scope:** OSS developer tooling; `packages/cli`, `packages/shared`, package module contracts, and the `packages/create-app` standalone agent harness
- **Source:** merged PR [#4810](https://github.com/open-mercato/open-mercato/pull/4810) and its [UMES catalog spec](2026-08-01-module-extension-point-catalog.md)
- **Related:** [Module Fact-Sheets](2026-06-27-ts-morph-module-fact-sheets.md), [Standalone AI Development Harness](2026-07-24-standalone-ai-development-harness.md), `BACKWARD_COMPATIBILITY.md`

## 📝 TLDR

The audit confirms that backend/frontend pages are already generated with source links, and that response/query enrichers plus API/command interceptors are already emitted as UMES contributions. The missing work is deeper: most public/overrideable module contracts lack uniform provenance, active extension bindings are over-generalized and not indexed from the host side, and the standalone override guide promises exact module keys that generated facts do not comprehensively expose.

Those are three independently shippable capabilities, so this index routes implementation into three cohesive specs:

1. [Source Provenance and Contract Inventory](2026-08-02-module-facts-source-provenance-and-contract-inventory.md)
2. [Bound Extension Activation and Incoming Contribution Index](2026-08-02-module-facts-extension-activation-and-incoming-index.md)
3. [Exact Unified Override Targets](2026-08-02-module-facts-exact-override-targets.md)

Together they answer: **“What can this installed module expose, accept, replace, extend, or depend on; which exact stable key do I use; and where is the defining source?”** Each child spec has its own implementation plan, compatibility boundary, tests, harness refresh, and release proof. This index must never be passed directly to an implementation workflow.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Cover only missing UMES/override facts, or every public and auto-discovered module contract an app can extend, replace, target, or depend on? | Cover the complete public/auto-discovered contract boundary, excluding ordinary internal support files. | The request asks to document everything extensible within modules; partial facts keep agents guessing. | ok |
| Q2 | Replace existing scalar JSON arrays with source-linked objects, or preserve them? | Preserve every legacy shape and add provenance/indexes additively. | Generated fact shapes are STABLE under `BACKWARD_COMPATIBILITY.md`. | ok |
| Q3 | Keep contributions only on their contributor module, or also index them on the host owner? | Keep the full source-owned fact and add a compact host-owned incoming reference. | One target module sheet must expose what already extends it without duplicating definitions. | ok |
| Q4 | Does complete DI documentation include `asValue` registrations? | Include `asFunction`, `asClass`, `asValue`, and supported aliases with safe registration metadata. | Every published DI key is stable and replaceable; classification prevents hiding value/entity registrations. | ok |
| Q5 | Ship one umbrella implementation or split independently usable capabilities? | Split into the three child specs above and keep this file as a non-implementable index. | A fresh-context scope review found that provenance/inventory, extension topology, and override targets each function independently. | ok |

No assumption needs human confirmation.

## 📝 Audit Summary

### Already implemented

| Surface | Current state | Source |
|---|---|---|
| Backend/frontend pages | Route path plus portable `sourcePath`. | [`extractModulePages`](../../packages/cli/src/lib/generators/module-facts.ts) |
| API routes | Methods, per-method auth, and source path. | [`extractApiRoutes`](../../packages/cli/src/lib/generators/module-facts.ts) |
| CLI commands | Legacy `cli: string[]` plus source-linked `cliCommands`. | [`extractCli`](../../packages/cli/src/lib/generators/module-facts.ts) |
| AI tools and agents | Exact ID/name and source path. | [`extractAiTools` / `extractAiAgents`](../../packages/cli/src/lib/generators/module-facts.ts) |
| Response/query enrichers | Outgoing contributions with target, activation metadata, timeout/fallback/cache posture, and source. | [`extractEnrichers`](../../packages/cli/src/lib/generators/module-extension-facts.ts) |
| API/command interceptors | Outgoing contributions with target, phases, and source. | [`extractApiInterceptors` / `extractCommandInterceptors`](../../packages/cli/src/lib/generators/module-extension-facts.ts) |
| Entity extensions, mutation guards, subscribers, browser reactions, component overrides, and selected specialized registries | Outgoing extension contributions. | [`extractModuleExtensionFacts`](../../packages/cli/src/lib/generators/module-extension-facts.ts) |

The child specs extend and correlate these surfaces; they do not create duplicate catalogs.

### Live repository baseline — 2026-08-02

A non-test scan found **70 package module roots / 60 unique module IDs** on `origin/develop`; duplicate IDs continue through existing provider selection.

| Contract family | Roots | Gap owner |
|---|---:|---|
| Backend / frontend pages | 39 / 9 | Spec 1 adds metadata/provenance; Spec 3 adds exact override keys. |
| Backend / frontend page middleware | 1 / 1 | Spec 1 inventories; Spec 3 maps the `guards` override domain. |
| API routes | 47 | Spec 1 completes provenance; Spec 2 binds activation; Spec 3 adds method keys. |
| Domain commands | 19 | Spec 1 emits source-linked facts. |
| Subscribers / workers | 23 / 19 | Spec 1 aligns recursive facts; Spec 3 maps override keys. |
| DI | 41 | Spec 1 emits complete safe registrations; Spec 3 maps safe overrides. |
| Setup / encryption | 48 / 15 | Spec 1 inventories capabilities; Spec 3 maps exact override shapes/keys. |
| Custom entities / entity extensions | 13 / 6 | Spec 1 completes ownership; Spec 2 correlates incoming extensions. |
| Enrichers / mutation guards | 9 / 2 | Spec 2 binds real route/entity activation and incoming refs; Spec 3 maps supported override domains. |
| API / command interceptors | 6 / 2 | Spec 2 binds host bridges; Spec 3 maps exact contribution keys. |
| Notifications / handlers | 17 / 2 | Spec 1 completes provenance; Spec 3 maps exact keys. |
| Search / vector | 11 / 2 | Spec 1 completes provenance/specialist facts. |
| Integration manifests / generator plugins | 7 / 2 | Spec 1 completes singular/array/bundle/plugin facts. |
| Dashboard widgets / injection tables / component overrides | 4 / 24 / 3 | Spec 2 adds incoming/source views; Spec 3 maps override keys. |

Counts are audit evidence, not hard-coded acceptance criteria. Tests derive the live selected module set.

## Research — comparable contract catalogs

- [VS Code contribution points](https://code.visualstudio.com/api/references/contribution-points) demonstrate stable machine-readable contribution kinds and IDs. Open Mercato keeps executable convention sources as authority rather than adding a hand-maintained manifest.
- [Backstage extension blueprints](https://backstage.io/docs/frontend-system/architecture/extension-blueprints/) and [extension overrides](https://backstage.io/docs/frontend-system/architecture/extension-overrides/) separate attachment identity, typed data, additive inputs, and replacement. The child specs preserve those distinctions without replacing UMES.
- [Backstage plugin modules](https://backstage.io/docs/backend-system/architecture/modules/) distinguish host-owned extension points from module-owned contributions. Spec 2 adopts that bidirectional view while preserving optional-module ownership.
- [NestJS custom providers](https://docs.nestjs.com/fundamentals/custom-providers) distinguishes provider token from class/value/factory registration. Spec 1 applies that safe metadata boundary to Awilix facts.

## Suite Boundaries

### Shared goals

- Every public, auto-discovered, targetable, or overrideable module contract is deterministic and source-linked.
- Runtime registries and generated facts reuse one normalized discovery interpretation.
- Legacy module-facts JSON fields and Markdown headings remain compatible.
- Facts never include source bodies, runtime values, secrets, credentials, tenant/user/customer data, or absolute local paths.
- Standalone evaluations fail when exact facts are missing and use installed source only for one named unresolved detail.

### Shared non-goals

- No runtime Platform Map UI/API, database migration, product UI, cache behavior, or registry execution change.
- No rename/cleanup of existing IDs, paths, tokens, or convention files.
- No inventory of arbitrary internal helpers.
- No module-specific exact keys duplicated into conceptual guides.
- No hand-editing generated artifacts.

### Dependency order

```text
Spec 1: provenance + owned contract facts + packaging
           │
           ├──────────────┐
           ▼              ▼
Spec 2: bound topology   Spec 3: exact overrides
           │              ▲
           └──────────────┘
        Spec 3 consumes topology refs where applicable
```

- Spec 1 ships first because Specs 2 and 3 reuse its portable source/fact references.
- Spec 2 may ship independently after Spec 1.
- Spec 3 depends on Spec 1 and consumes Spec 2 activation/incoming references when present; it must still work with empty topology sections.
- Every child implementation invokes `om-refresh-standalone-harness` for its own committed local range and runs its own fresh-scaffold release gate.

## Cross-Suite Compatibility Contract

- The top-level `module-facts.json` remains the v1 compatibility `Record<moduleId, ModuleFactsJsonEntry>`; additive `module-facts.v2.json` carries corrected reader facts with the same record shape.
- Generator diagnostics remain optional fields on the owning module entry (or a separate sibling artifact); no synthetic framework/diagnostics key is added to the root module record.
- New exported properties are optional; current generators emit deterministic empty values.
- Existing arrays/objects keep their current types and required fields; the v1 sidecar also keeps its published values while v2 carries corrections.
- Existing Markdown headings remain; new sections and appended source columns are additive.
- Existing `extensionSurfaces.hosts` rows are not removed or reclassified in this suite. Spec 2 adds an authoritative activation layer and guidance requires an activation for route-bound use.
- Framework facts remain in `framework-extension-points.md`; no fake framework module key is added.
- Exact fact IDs/source/override keys become STABLE/FROZEN according to their underlying contract after publication.

## Suite-Level Risks

### Partial rollout ambiguity

- **Scenario:** Guidance expects an incoming/override fact before its child spec ships.
- **Severity:** High
- **Affected area:** Standalone routing and implementation correctness.
- **Mitigation:** Each child updates only its owned guidance/cases, gates facts by optional fields, and passes a fresh scaffold independently.
- **Residual risk:** During staggered releases, older scaffolds keep their older facts and require version-stamped source escalation.

### Contract/context growth

- **Scenario:** Combined facts exceed harness context budgets.
- **Severity:** Medium
- **Affected area:** Standalone one-shot performance.
- **Mitigation:** Source/fact references instead of bodies/duplication, per-child byte measurements, compact incoming refs, and largest-module budget guards.
- **Residual risk:** Highly extensible modules may eventually require targeted section loading.

### Generated compatibility drift

- **Scenario:** A child changes a legacy key or runtime registry while refactoring readers.
- **Severity:** High
- **Affected area:** Third-party consumers and module activation.
- **Mitigation:** Each child owns BC fixtures and runtime-output parity before publishing new facts.
- **Residual risk:** Undocumented exact-object consumers may reject additive keys and need release-note guidance.

## Final Compliance Report — 2026-08-02

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/skills/om-refresh-standalone-harness/SKILL.md` and references
- `packages/create-app/agentic/shared/ai/skills/om-system-extension/SKILL.md` and references

### Compliance Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| Spec checklist | One independently deployable capability per implementation spec. | Compliant | Fresh-context SPLIT verdict applied; this file is an index and three child specs own implementation. |
| Root + CLI | Deterministic generated output from module source. | Compliant | Child specs require shared normalized readers and parity tests. |
| Root + BC | Preserve generated-file contracts and public IDs. | Compliant | Shared compatibility boundary is additive and forbids host-row removal. |
| Create-app | Keep standalone guidance aligned with generator behavior. | Compliant | Each child owns its packaging/guidance/harness/release gate. |
| Root security | Exclude secrets and scoped user data. | Compliant | Only static contract IDs/metadata/provenance are allowed. |
| Root UI/data rules | UI, schema, locking, and migrations. | N/A | This suite is generated developer tooling with no runtime UI/data mutation. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Scope maps to implementation plans | Pass | Implementation lives only in child specs. |
| Dependencies are acyclic | Pass | Spec 1 precedes Specs 2/3; Spec 3 optionally consumes Spec 2 refs. |
| Compatibility is consistent | Pass | All children inherit the additive suite boundary. |
| Harness ownership is clear | Pass | Each child refreshes only its own facts/behavior range. |

### Non-Compliant Items

None identified.

### Verdict

**Umbrella index approved:** do not implement this file directly; implement the three child specs in dependency order.

## Changelog

### 2026-08-02

- Audited PR #4810, its spec, baseline facts, runtime module discovery, unified overrides, and standalone harness promises.
- Confirmed pages and enrichers/interceptors already exist and isolated the actual provenance, topology, and exact-key gaps.
- Applied the required fresh-context SPLIT verdict by replacing one umbrella implementation plan with this index and three cohesive child specs.

### Review — 2026-08-02

- **Reviewer:** Agent author plus required fresh-context scope reviewer.
- **Security:** Passed.
- **Performance:** Passed with child-spec evidence gates.
- **Cache:** N/A.
- **Commands:** N/A for the index.
- **Risks:** Passed.
- **Scope cohesion:** SPLIT applied; each child is independently deployable.
- **Verdict:** Index approved; child specs are the implementation inputs.
