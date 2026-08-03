# Standalone Agent Spec-First Routing

- **Status:** Draft
- **Date:** 2026-08-01
- **Revised:** 2026-08-03
- **Scope:** OSS agent instructions and planning skills emitted by `create-mercato-app`
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md), [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md)

## TLDR

Generated standalone agents need a deterministic planning gate: new features and substantial capabilities start from a covering specification, while bug fixes, minor changes, and isolated refactors may proceed directly. A new feature skips the spec only when the user explicitly says so. Put this rule in emitted instructions and planning/scaffold routing, then hand module implementation to `om-module-scaffold`, which uses the shipped, disabled `src/modules/example` tree as its canonical code reference rather than inventing a second teaching module.

## Problem Statement

The emitted standalone harness explains how to build modules and UI but does not consistently decide when design work must precede implementation. Agents can therefore begin a feature with architectural choices still implicit, over-correct by demanding a spec for a bounded fix, or describe a new shadow teaching module instead of reusing the canonical example after the planning gate. This policy remains independently deployable from the canonical example/read behavior and has its own evaluation boundary.

## User-Directed Decision

The 2026-08-01 brief explicitly requires spec-first behavior for new features, permits bug fixes and minor changes without a spec, and permits a feature override only when the user explicitly requests skipping the spec. This is a confirmed requirement, not an autonomous default or open question.

## Decision Contract

The emitted `packages/create-app/template/AGENTS.md` and relevant planning/module/UI skills use the same ordered decision:

1. Search the emitted spec locations for a covering specification before planning implementation.
2. If the request introduces a new user-facing or platform capability, architecture, schema/API contract, cross-module behavior, or multi-phase behavior, create or amend a spec with the installed spec-writing workflow before coding.
3. If the request is a bug fix, minor behavioral correction, small documentation change, dependency maintenance, or isolated refactor with no new architecture/public contract, proceed without creating a spec.
4. If a covering spec exists, implement against and update it rather than creating a duplicate.
5. Skip the spec for a new feature only when the user's current request explicitly says to skip/bypass the spec. Silence, urgency, a “small feature” estimate, or an earlier generic preference is not an override.
6. When classification is genuinely ambiguous and materially changes the workflow, ask one bounded question; do not ask when repository evidence resolves it.

After `spec-first` or `reuse-spec` completes, implementation routing is a one-way handoff: module work loads `om-module-scaffold`, starts at `src/modules/example/README.md`, and adapts only the capability-linked source files. The specification names the relevant example capability IDs and exact paths in its implementation plan when known. It must not propose a shadow teaching module, duplicate the whole example tree, or treat `ratelimit_probe` as a blueprint. If a required ordinary module surface is absent from the canonical inventory, framework-maintenance scope extends `example` and its tests/inventory; downstream app scope follows the owning installed guide until that upstream addition exists.

This handoff does not grant the planning case write access to source, define example-read budgets, or make the spec-first policy an owner of module architecture. Those remain with the canonical-example, example-read-policy, and module-scaffold contracts.

The instruction uses concrete examples and links to the installed spec-writing skill. It must fit the `AGENTS.md` budget and must not duplicate the full spec-writing procedure.

## Scope Boundaries

### In scope

- Emitted root `AGENTS.md` routing and the smallest relevant planning/scaffold skill references.
- Existing-spec discovery and duplicate avoidance.
- A concise handoff from approved module specs to `om-module-scaffold` and the canonical example inventory.
- Focused harness/evaluator coverage for every decision branch.
- Instruction-budget, tier, link, and generated-copy synchronization.

### Out of scope

- Changing the repository's own spec lifecycle or naming conventions.
- Requiring specs for maintenance categories explicitly exempted above.
- Automatically approving a user-authored spec or implementing the feature in the same policy change.
- Canonical-example source, read permissions/budgets, and generic harness-maintenance governance, owned by the linked specs.

## Harness Contract

Add or extend semantically deduplicated cases for:

| Prompt | Required decision | Forbidden behavior |
|---|---|---|
| New multi-step feature | Search specs, then create/amend a spec before code | Starting implementation or treating “small” as an override |
| Bug with reproducible existing behavior | Diagnose/fix directly, update an existing spec only when behavior/contracts change | Creating a speculative feature spec |
| Minor docs/config/refactor change | Proceed directly with bounded plan/validation | Blocking on a new spec |
| New feature with explicit “skip the spec” | Acknowledge override and implement/plan directly | Ignoring the explicit instruction |
| Ambiguous “quick improvement” that adds a contract | Ask one bounded classification question | Silently inferring an override |
| Existing covering spec | Link/reuse it | Creating a duplicate spec |

All six table rows run first as read-only routing cases. Their structured oracle requires `{ decision, reasonCodes, coveringSpecPath? }`, where `decision` is exactly `spec-first`, `direct`, `reuse-spec`, or `ask`; it rejects tool writes and validates the expected decision/reason code rather than exact prose.

Two additional writable proofs establish ordering:

- **New-feature proof:** writable roots are limited to the fixture's `.ai/specs/**`; `src/**`, package manifests, migrations, and generated registries are forbidden. The fixed oracle requires exactly one new or amended correctly named spec with problem, contracts, tests, and phased implementation sections, plus an ordered trace showing the spec write before any implementation attempt. Any source write or placeholder-only spec fails.
- For a module-shaped new-feature proof, the spec's implementation section must route to `om-module-scaffold` and name the relevant canonical example capability IDs/paths when the fixture provides them. The oracle rejects a shadow teaching module, a whole-example copy, `ratelimit_probe` reuse, or any source write during planning.
- **Existing-spec proof:** the only writable path is the exact seeded covering spec. The oracle requires that file to be read/referenced (and amended only when the prompt changes its contract), rejects any second spec, and rejects all source writes during the planning case.

The explicit-skip, bug-fix, minor-change, and ambiguous cases remain read-only because their contract is classification, not successful feature implementation. Their routing oracle proves `direct`/`ask` without granting a broad write root. Case IDs are allocated only after semantic deduplication against the current catalog.

## Testing and Validation

- Focused instruction test proves the rule exists once, links to a valid installed skill, and stays within the instruction budget.
- Tier/preset tests prove all built-in presets emit the rule and required skill references.
- Evaluator unit tests cover the six read-only rows plus the two writable ordering proofs, including negative/ambiguous wording, module-example handoff, duplicate-reference rejection, and write-root rejection.
- Harness cases record fail-before/pass-after evidence and update required catalog, validator, oracle, matrix, counts, docs, and generated copies for their modes.
- Run `yarn agents:check-budget`, the focused create-app tests, affected harness lane, and the configured validation gate.

## Implementation Plan

### Phase 1 — Add the routing rule and keep instructions green

1. Add failing focused tests for the decision table, link resolution, preset emission, and instruction budget.
2. Add the concise emitted instruction, planning-skill route, and canonical-example implementation handoff, making each focused test green before proceeding.
3. Verify existing spec discovery and duplicate avoidance against real emitted paths.

Exit criterion: every preset exposes one consistent rule, all focused tests pass, and instruction budgets remain green.

### Phase 2 — Certify behavior in the harness

1. Semantically deduplicate current cases and add/extend only the missing decision rows.
2. Pair each failing evaluator assertion with its policy/routing implementation and finish the step green.
3. Synchronize mode-specific validators/oracles/release lanes, generated copies, counts, and docs; run the affected certified lane.

Exit criterion: all six routing decisions and both writable ordering proofs are observable and green without whole-output goldens or unrelated write/context access.

## Backward Compatibility

This is an additive agent-workflow policy. It changes generated-agent behavior but no runtime, API, schema, module, or provider contract. Existing explicit user authority remains higher priority, which is why the explicit skip branch is required.

## Risks

| Risk | Mitigation |
|---|---|
| Agents demand specs for every fix | Positive maintenance cases and evaluator negatives. |
| Agents bypass feature specs implicitly | Require a current explicit user instruction; test urgency and “small feature” counterexamples. |
| Planning creates another teaching module or copies the example wholesale | One-way handoff to module-scaffold, exact capability links, and negative writable-oracle assertions. |
| Instruction copies drift | One rule owner, preset/tier/link tests, generated-copy synchronization. |
| The rule exceeds instruction budget | Keep only the decision table and route; spec-writing procedure stays in its skill. |

## Final Compliance Report

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/create-app/template/AGENTS.md`
- `.ai/docs/agent-instructions.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Area | Result |
|---|---|
| Scope cohesion | One independently deployable capability: emitted spec-first routing plus its behavioral proof. |
| User decision | Explicitly confirmed by the 2026-08-01 brief; no open architectural default. |
| Agent authority | Explicit user override is preserved; ambiguous material classification asks once. |
| Example reuse | Planning stays source-read-only and hands module work to the canonical `src/modules/example` inventory without owning its read policy. |
| Instruction budget | Normative decision only in `AGENTS.md`; procedure remains in the owning skill. |
| Testing | Six finite routing oracles, preset/link/budget tests, and an affected certified lane. |
| Runtime/compatibility | No runtime, API, schema, provider, or module behavior changes. |

### Verdict

**Fully specified and ready for implementation after design review.**

## Changelog

- 2026-08-01: Initial draft defined the standalone spec-first decision contract and routing proofs.
- 2026-08-03: Added the one-way module implementation handoff to `om-module-scaffold` and canonical `src/modules/example` capability links; prohibited shadow teaching modules, whole-tree copies, and `ratelimit_probe` reuse.

### Review — 2026-08-03

- **Reviewer:** Agent, with independent cross-spec consistency audit.
- **Scope cohesion:** The fresh pass recommended splitting classification from the post-spec module handoff. The user-selected boundary is retained because the handoff is the terminal route of the same planning decision and contains no source-read policy or module implementation procedure; extracting it would leave `spec-first` without a deterministic next owner.
- **Security:** Passed; planning remains source-read-only and does not broaden context or write roots.
- **Performance:** Passed; the emitted rule stays a concise decision/handoff while procedure remains in skills.
- **Cache:** N/A; this spec changes planning policy only.
- **Commands:** N/A; no runtime command contract changes.
- **Risks:** Passed; over-specification, implicit bypass, duplicate reference architecture, and instruction drift are covered.
- **Verdict:** Approved for design review.
