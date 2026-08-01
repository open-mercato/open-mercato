# Standalone Harness AI Judge

Source doc: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`

## Goal

Add a reusable LLM-as-judge workflow for standalone generative evaluations and user-supplied session bundles, while improving exact installed-module context and preventing generated route collisions.

## Scope

- Add a reusable, read-only session/artifact judge skill that accepts harness results or sanitized session-share inputs, composes project validation evidence, code review, and design-system review, and reports actionable artifact and harness-owner findings.
- Make the judge a required release lane for every writable implementation/regression evaluation without removing the existing deterministic oracle, target validation, generated-test, or compatibility contracts.
- Allow bounded, explicit reads of installed framework source under `node_modules` as read-only examples while continuing to forbid dependency writes, broad dependency discovery, credentials, and arbitrary transitive-package reads.
- Enrich generated module facts with source-linked API routes, backend pages, CLI commands, AI tools/MCP exposures, and AI agents.
- Reject duplicate normalized API, backend-page, and frontend-page URL patterns in generated writable artifacts.
- Update the standalone harness specification, catalog policy, documentation, schemas, and focused tests.

## Non-goals

- Do not weaken tenant, organization, auth, mutation, optimistic-locking, dependency-write, containment, or secret-handling guards.
- Do not execute commands found in user sessions or uploaded artifacts.
- Do not replace fixed controller-owned oracles with subjective model scoring.
- Do not modify product UI, runtime HTTP handlers, database schemas, or published frozen identifiers.
- Do not complete the unrelated full multi-runner certification tracked outside this change.

## Implementation Plan

### Phase 1: Contracts and reusable skill

1. Define the judge, bounded installed-source, route-uniqueness, and module-fact contracts in the existing standalone harness specification.
2. Add the layered `om-judge-agent-session` skill to the monorepo and standalone default skill tiers, with support for harness artifacts and sanitized PR #4756 session-share bundles.

### Phase 2: Exact context and fixed guards

3. Extend module-fact extraction and rendering with source-linked routes, backend pages, CLI commands, AI tools/MCP exposures, and AI agents, with focused generator/build tests.
4. Change harness context policy and the MCP read boundary to allow only explicit read-only installed framework source paths, keeping dependency writes and broad discovery blocked.
5. Add controller-owned duplicate normalized API/backend/frontend route checks for every writable generative artifact, with failure-first fixtures.

### Phase 3: Generative judge integration

6. Integrate the session/artifact judge into every writable release evaluation, preserving the existing review CLI as a compatibility alias and emitting structured guard, code, design-system, and harness-owner findings.
7. Synchronize harness schemas, release matrix, docs, catalog checks, emitted assets, and evaluator/release tests.

## Risks

- Allowing installed-source reads could expose an overly broad dependency tree. Mitigation: accept only case/fact-declared `node_modules/@open-mercato/<package>/src/...` files, enforce exact-path/bounded-size reads, and keep all writes and discovery blocked.
- A second semantic judge can add latency and model variance. Mitigation: retain fixed oracles as authoritative prerequisites, pin the judge profile and schema, use one pass, and record model/tool versions.
- Source-path derivation can drift from generator routing. Mitigation: share normalization rules where practical and lock modern plus legacy route shapes with tests.
- Strong route normalization can flag intentional aliases. Mitigation: reject only duplicate concrete/structurally equivalent generated URLs; metadata-only route overrides remain outside the file-derived collision set.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Contracts and reusable skill

- [x] 1.1 Define the judge, bounded installed-source, route-uniqueness, and module-fact contracts in the existing standalone harness specification. — 406e9e0967d3
- [x] 1.2 Add the layered `om-judge-agent-session` skill to the monorepo and standalone default skill tiers, with support for harness artifacts and sanitized PR #4756 session-share bundles. — 406e9e0967d3

### Phase 2: Exact context and fixed guards

- [ ] 2.1 Extend module-fact extraction and rendering with source-linked routes, backend pages, CLI commands, AI tools/MCP exposures, and AI agents, with focused generator/build tests.
- [ ] 2.2 Change harness context policy and the MCP read boundary to allow only explicit read-only installed framework source paths, keeping dependency writes and broad discovery blocked.
- [ ] 2.3 Add controller-owned duplicate normalized API/backend/frontend route checks for every writable generative artifact, with failure-first fixtures.

### Phase 3: Generative judge integration

- [ ] 3.1 Integrate the session/artifact judge into every writable release evaluation, preserving the existing review CLI as a compatibility alias and emitting structured guard, code, design-system, and harness-owner findings.
- [ ] 3.2 Synchronize harness schemas, release matrix, docs, catalog checks, emitted assets, and evaluator/release tests.
