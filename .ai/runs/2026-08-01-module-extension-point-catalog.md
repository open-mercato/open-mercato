# Execution Plan — Module Extension-Point Catalog

Source doc: .ai/specs/2026-08-01-module-extension-point-catalog.md

## Goal

Generate a complete, deterministic, bidirectional catalog of every package-provided UMES host and contribution so standalone agents can select exact extension contracts without bulk source inspection.

## Scope

- Add serializable extension-point declaration and fact contracts in `packages/shared`.
- Bind the audited package-module UI hosts to canonical declarations without changing IDs or runtime behavior.
- Extend CLI module-fact extraction with host/contribution correlation, framework facts, compatibility guards, and deterministic Markdown/JSON output.
- Update standalone create-app guidance and harness coverage to consume the new facts.
- Preserve all existing generated shapes, IDs, activation, scoping, ordering, failure, and override semantics.

## Non-goals

- No runtime introspection API, Platform Map change, database migration, new dependency, or rendered application UI.
- No app-owned module fact generation in this phase.
- No renaming or normalization of existing host IDs, registry IDs, event IDs, routes, or override keys.
- No hand edits to generated artifacts.

## Implementation Plan

### Phase 1: Canonical host taxonomy and parity

1. Add shared serializable types, declaration helpers, and bound-family descriptors.
2. Add canonical `extension-points.ts` declarations for audited UI-host modules and bind host call sites without changing behavior.
3. Project event, entity, API, command, browser, and query-lifecycle host capabilities from existing facts.
4. Add repository-wide bound/unbound parity guards and eliminate unclassified first-party host sites.

### Phase 2: Contribution extraction and correlation

5. Factor reusable readers for additive UMES conventions and specialized registries.
6. Normalize outgoing contributions, activation, phases, operations, features, scope, contract details, overrides, and round-trip identities.
7. Correlate targets to exact, pattern, framework, fact-reference, or optional-external hosts and reject unresolved first-party targets.

### Phase 3: Generated facts and compatibility

8. Extend module fact types and deterministic Markdown/JSON rendering with sanitized extension-surface diagnostics.
9. Preserve legacy `hostTokens` and existing fact sections while generating per-module and framework extension catalogs.
10. Add repository-wide compatibility, determinism, output-size, and extraction-time evidence.

### Phase 4: Standalone routing and harness

11. Update create-app extension routing to prefer target module facts, the framework catalog, and specialist routes.
12. Strengthen OMH-088/OMH-089 and targeted harness cases across the complete UMES taxonomy.
13. Add optional UMES umbrella-spec provenance that passes both with and without source-checkout access.
14. Add the optional upstream/repository-relative UMES link to generated extension guidance while keeping facts sufficient offline.
15. Update compatibility/module-development documentation and run focused plus full validation.

## Risks

- Host declarations can drift from runtime bindings; parity tests must fail on both undeclared and unbound surfaces.
- Normalizing heterogeneous registries can lose activation, scope, timeout, fallback, ordering, or override semantics; discriminated facts and reader fixtures must preserve them.
- The catalog can increase standalone context size and generator duration; deterministic byte/time evidence must keep growth bounded.
- Frozen IDs and public generated shapes are compatibility surfaces; migrations must byte-preserve existing addresses and remain additive.
- The spec deliberately retains one atomic delivery after a documented maintainer waiver of fresh-context split recommendations; intermediate phases must not publish an incomplete public projection.

## Progress

PR: #4810

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Canonical host taxonomy and parity

- [x] 1.1 Add shared serializable types, declaration helpers, and bound-family descriptors. — e96969f29
- [x] 1.2 Add canonical host declarations and bind audited UI call sites. — e96969f29
- [x] 1.3 Project existing-fact host capabilities. — a2ff3136f
- [x] 1.4 Add bound/unbound parity guards. — a2ff3136f

### Phase 2: Contribution extraction and correlation

- [x] 2.1 Factor reusable convention and registry readers. — a2ff3136f, 5fda9356a
- [x] 2.2 Normalize complete outgoing contribution details. — a2ff3136f, 5fda9356a
- [x] 2.3 Correlate targets and reject unresolved first-party contracts. — a2ff3136f

### Phase 3: Generated facts and compatibility

- [x] 3.1 Extend deterministic ModuleFacts Markdown/JSON output. — a2ff3136f
- [x] 3.2 Preserve legacy facts and add framework catalogs. — 0d62b3a07
- [x] 3.3 Add compatibility, determinism, size, and timing evidence. — a2ff3136f

### Phase 4: Standalone routing and harness

- [x] 4.1 Route standalone agents through module/framework facts. — 0d62b3a07
- [x] 4.2 Expand OMH-088/OMH-089 and targeted harness cases. — 0d62b3a07
- [x] 4.3 Add optional UMES spec provenance coverage. — 0d62b3a07
- [x] 4.4 Add optional UMES guidance links. — 0d62b3a07
- [ ] 4.5 Update contracts/docs and pass focused/full validation.
