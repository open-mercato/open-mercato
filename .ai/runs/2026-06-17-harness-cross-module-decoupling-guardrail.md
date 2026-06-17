# Execution plan: cross-module decoupling guardrail in the agent harness

## Goal

Make the agent harness enforce the cross-module decoupling principle (events + widget injection + FK-id/snapshot for the sanctioned channels; `tryResolve` soft-optional for optional integrations) so that code-review FLAGS a hard cross-module coupling and spec-writing FORCES the author to declare the integration mechanism, dependency direction, and module-absent behavior — without bloating every-session context.

## Context

Surfaced while designing "products in deals" (CRM) with an optional effect on warehouse stock (WMS). CTO Piotr Karwatka set the direction: do it via events + widget injection so the modules are truly hard-separated. Events + injection give a genuinely decoupled pattern, but that is the hardness of the *pattern*, not of *enforcement*. An 8-surface harness audit (this run's source analysis) found:

- Two of three "wrong ways" are already guarded: cross-module ORM relations and direct business-logic imports/calls for side-effects.
- The soft-optional `tryResolve`-in-try/catch mechanism, the "hard `requires` on an optional integration is wrong" rule, and the dependency-direction rule ("the optional consumer owns the glue") are documented NOWHERE in the harness (grep: zero hits), despite being real production practice (`shipping_carriers`, `payment_gateways`, `inbox_ops`).

## Scope

Docs/harness-only. One detail home (per-package `packages/core/AGENTS.md`), one always-loaded routing pointer (root `AGENTS.md` Task Router), two enforcement skill checklists + one skill heuristic, and one scaffold-time doc bullet.

## Non-goals

- No product code changes; no new guard test (the existing `packages/core/src/__tests__/module-decoupling.test.ts` is referenced, not modified).
- No new top-level Architecture/Never bullet in root `AGENTS.md` (would bloat every-session context and duplicate existing lines).
- No edits to `module-dependencies.mdx`, BC contract surfaces, `om-implement-spec`/`om-pre-implement-spec`, or `om-create-agents-md` (rejected by the audit as redundant or off-budget).

## Verification corrections baked in

1. `tryResolve` is a per-module local helper wrapping `container.resolve()` in try/catch — never phrased as a `container.tryResolve(...)` method.
2. The detail home is a NEW `### Cross-Module Coupling` section, not the setup-scoped `### Decoupling Rules`, so pointers resolve to real content.
3. No edit restates the ORM/import bans (they exist at root `AGENTS.md`:30/268, `packages/core/AGENTS.md`:24, om-code-review checklist).
4. The decoupling test is named in the checklists + router row so "degrade when absent" is verifiable.

## Risks

- Low. Docs-only; no runtime behavior changes. Worst case is wording drift, mitigated by a diff re-read and the code-review self-pass.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Detail home

- [ ] 1.1 Add `### Cross-Module Coupling` section to `packages/core/AGENTS.md` after `### Decoupling Rules`

### Phase 2: Routing pointer

- [ ] 2.1 Add one Task Router row to root `AGENTS.md` after the Extensions row

### Phase 3: Enforcement skills

- [ ] 3.1 Add soft-optional/direction bullet to om-code-review `references/review-checklist.md` § 1
- [ ] 3.2 Add mechanism/direction/absent-behavior bullet to om-spec-writing `references/spec-checklist.md` § 2
- [ ] 3.3 Extend om-spec-writing `SKILL.md` heuristic #5 (Module Isolation) for optional peers

### Phase 4: Scaffold-time doc

- [ ] 4.1 Add optional-peer bullet to `.ai/docs/module-development.md` Module Rules

## Changelog

- Plan drafted.
