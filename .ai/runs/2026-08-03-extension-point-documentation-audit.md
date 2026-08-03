# Extension Point Documentation Audit

## Overview

Goal: turn the complete, source-linked extension and override fact inventory from PR #4883 into an exhaustive audit of the official documentation, then close every verified documentation and navigation gap in a separate docs-only PR.

Source implementation: PR #4883 (`feat/module-facts-source-linked-contracts`), inspected read-only from `.ai/tmp/om-auto-review-pr/pr-4883-20260803-1138` and refreshed against its latest GitHub head before finalization.

## Scope

- Generate an evidence matrix from every extension/override fact family emitted by PR #4883.
- Require a valid portable source link for every audited fact; anonymous or repository-local-only facts are gaps, not covered facts.
- Audit all official documentation under `apps/docs/docs/` plus authoritative sidebars and indexes.
- Extend existing pages or add focused pages where semantics, activation, precedence, discovery, or source navigation are missing.
- Keep published guidance accurate for `develop`; clearly mark facts that depend on PR #4883 until that implementation merges.

## Non-goals

- Modify PR #4883, its branch, or its review worktree.
- Change extension runtime behavior, generator schemas, or public contracts.
- Rewrite unrelated module, integration, or UI documentation.
- Document enterprise-only implementation details in OSS documentation.

## Implementation Plan

### Phase 1: Inventory and coverage audit

1. Generate the extension/override fact inventory from PR #4883 and map each domain and family to its portable source link.
2. Audit all official documentation, sidebars, and indexes against that inventory and record covered, partial, and missing facts.

### Phase 2: Official documentation coverage

1. Add or extend focused official documentation so every verified fact family is discoverable and accurately explained.
2. Wire the resulting pages into authoritative navigation and cross-links without duplicating runtime semantics.

### Phase 3: Verification and publication

1. Refresh the inventory against PR #4883's latest head, resolve any drift, and validate all documented source links.
2. Run docs-only validation, self-review, breaking-change review, and publish the separate labeled PR.

## Risks

- PR #4883 may change during review. Mitigation: record its head SHA in the audit and regenerate/compare immediately before final validation.
- Generated facts can look authoritative while lacking portable source evidence. Mitigation: make source-link validity an explicit matrix column and reject anonymous facts.
- A single large catalog can become stale or duplicate domain guides. Mitigation: use a concise canonical catalog that links to focused existing docs and to runtime sources.
- Docs on `develop` must not claim an unmerged output contract is already shipped. Mitigation: describe stable extension semantics from current runtime and isolate PR-dependent generator wording.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Inventory and coverage audit

- [x] 1.1 Generate source-linked extension and override fact inventory — 2fa370e4e
- [x] 1.2 Audit official docs and record coverage gaps — 2fa370e4e

### Phase 2: Official documentation coverage

- [ ] 2.1 Close verified documentation gaps
- [ ] 2.2 Wire authoritative navigation and cross-links

### Phase 3: Verification and publication

- [ ] 3.1 Refresh PR #4883 inventory and validate portable source links
- [ ] 3.2 Validate, self-review, and publish the documentation PR
