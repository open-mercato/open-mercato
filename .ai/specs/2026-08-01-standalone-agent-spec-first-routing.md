# Standalone Agent Spec-First Routing

- **Status:** Draft
- **Date:** 2026-08-01
- **Revised:** 2026-08-03
- **Scope:** OSS agent instructions and planning skills emitted by `create-mercato-app`
- **Related:** [Standalone Canonical Example Module](./2026-07-31-standalone-canonical-example-module.md), [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md), design-foundation [PR #4277](https://github.com/open-mercato/open-mercato/pull/4277), design-system gallery [PR #4301](https://github.com/open-mercato/open-mercato/pull/4301)

## TLDR

Generated standalone agents need a deterministic planning gate: new features and substantial capabilities start from a covering specification, while bug fixes, minor changes, and isolated refactors may proceed directly. A new feature skips the spec only when the user explicitly says so. Put this rule in emitted instructions and planning/scaffold routing, then hand module implementation to `om-module-scaffold`, which follows visible exact-file links to the shipped, disabled `src/modules/example` tree or declared installed-package references rather than inventing a second teaching module. Every newly planned extension surface must name self-contained integration coverage.

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

After `spec-first` or `reuse-spec` completes, implementation routing is a one-way handoff: module work loads `om-module-scaffold`, starts at the visible link to `src/modules/example/README.md`, consults `.ai/guides/reference-modules/example.md` and the machine row `/example/facts` in `.ai/guides/reference-module-facts.json`, observes that their activations/targets apply only after opt-in, and adapts only the capability-linked source files. Normal fact outputs retain their existing package-only contracts: combined JSON for package modules and enabled-filtered package Markdown; the app-local example exists only in the explicit reference bundle. The specification names the relevant example capability IDs, source-reference IDs, generated fact/contribution/activation/override-target IDs, visible owner links, and exact app-root target paths in its implementation plan when known. A specialist-depth branch names the exact declared `node_modules/@open-mercato/<package>/src/**` reference and package/preset applicability rather than saying only “inspect node_modules.” It must not propose a shadow teaching module, duplicate the whole example tree, or treat `ratelimit_probe` as a blueprint. If a required executable ordinary-module mechanism is absent from the canonical PR #4883 enum ledger, framework-maintenance scope extends `example`, its static fact reader where necessary, reference-fact generation, tests, and inventories; downstream app scope follows the owning installed guide until that upstream addition exists.

For UI-bearing work, the handoff also loads `om-backend-ui-design`. The emitted UI guide remains the normative rule owner; the plan pairs its exact ID and the exact example source ID with direct PR #4301 `familyId`/`entryId` coverage when present, or checked constituent entries for `composite-not-direct`, then names the exact public UI implementation source and local `src/app/globals.css` only for foundations/tokens. It records merged/package SHA `bf25803d7a8c85c8552db9e76c7cc4398d1768be`, derives preset availability from the generated module set, and treats every built-in fresh preset as `source-only`; `/backend/design-system` is advertised only for an explicit activation fixture. The gallery is visual usage evidence, not a rule owner or runtime dependency. Plans must not use a family directory/wildcard, gallery entry alone, copied gallery snippets/rules, invented component API, transitive import permission, a false direct claim for `CrudForm`/`DataTable`, or the workspace-only `apps/mercato/src/app/globals.css` path.

PR #4277 is conditional design-foundation routing, not a default UI implementation owner. Every PR #4301-derived item in the plan carries its PR #4277 applicability/status record, but only a request about tokens, Figma, or design foundations follows that sidecar. Local `src/app/globals.css` remains token truth. The plan may route to `om-figma-design-with-ds` only when a portable copy is emitted and its local opt-in `design` tier is selected, and may name a Code Connect source only as an exact packed `node_modules/@open-mercato/ui/figma/<name>.figma.tsx` record with the Figma role. It records the audited head, requires the final merged/package SHA before certification, keeps gallery-node and Code-Connect-node status/IDs independent, derives their comparison, distinguishes mapped/unmapped/not-applicable coverage including `none`, leaves publication `not-evidenced`, and never implies Figma credentials, network access, Variables operations, push, or publish authority. An unavailable skill, monorepo-only snapshot/exporter, invalid cross-facet tuple, blanket mapping claim, placeholder live node, or incomplete mapping claimed complete fails planning.

Every proposed added or materially changed runtime/discovery extension surface has a traceability row from requirement to source capability/reference, generated fact/topology ID when applicable, implementation phase, and a self-contained integration test; putting a new surface in an existing capability row does not waive this requirement. The row also states whether the mechanism is `emitted-example`, `framework-only`, `catalog-only`, `currently-unbound`, or `negative-fixture`; only the canonical ledger may justify the latter four, and `negative-fixture` is forbidden in activated canonical output. The test creates its own tenant/organization fixtures, declares required modules, cleans up in `finally`, and proves the real API/UI/worker/event path. Unit, type, generator, or harness-routing tests may supplement but never replace that integration row. A spec may group closely coupled surfaces into one end-to-end test only when the assertions explicitly cover every surface. For a long-running DataTable bulk operation, the plan must separately name the bulk-action and operation-progress source-reference IDs and assertions, then cover selected-row start, returned `progressJobId`, queue/worker execution, visible top-bar progress, completion/refresh, partial failure, cancellation, retry/idempotency, and scope in the connected proof.

This handoff does not grant the planning case write access to source, define example-read budgets, or make the spec-first policy an owner of module architecture. Those remain with the canonical-example, example-read-policy, and module-scaffold contracts.

The instruction uses concrete examples and links to the installed spec-writing skill. It must fit the `AGENTS.md` budget and must not duplicate the full spec-writing procedure.

## Scope Boundaries

### In scope

- Emitted root `AGENTS.md` routing and the smallest relevant planning/scaffold skill references.
- Existing-spec discovery and duplicate avoidance.
- A concise handoff from approved module specs to `om-module-scaffold` and the canonical example inventory.
- Visible exact local/installed source-reference IDs and target paths in implementation plans.
- Requirement-to-integration-test traceability for every newly introduced extension surface.
- PR #4883 local reference-fact/topology IDs, explicit disabled/after-opt-in semantics, and permitted enum-ledger classification in module-shaped implementation plans.
- PR #4301 merged/package provenance, direct-or-composite family/entry references, exact rule/example/gallery/UI sources, public-import correlation, local emitted token source, and preset `source-only`/explicit-activation status for UI-bearing implementation plans.
- PR #4277 applicability/status on every design-system item and conditional token/Figma/design-foundation routing to exact locally emitted or packed sources only.
- Focused harness/evaluator coverage for every decision branch.
- Instruction-budget, tier, link, and generated-copy synchronization.

### Out of scope

- Changing the repository's own spec lifecycle or naming conventions.
- Requiring specs for maintenance categories explicitly exempted above.
- Automatically approving a user-authored spec or implementing the feature in the same policy change.
- Canonical-example source, read permissions/budgets, and generic harness-maintenance governance, owned by the linked specs.
- Figma network/plugin/REST execution, credentials, Variables/Code Connect publication, or treating the provisional PR #4277 head as a certified package baseline.

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
- For a module-shaped new-feature proof, the spec's implementation section must route to `om-module-scaffold` and name the relevant canonical example capability IDs, source-reference IDs, generated reference-fact/topology IDs, visible links, exact paths, after-opt-in runtime status, and self-contained integration tests when the fixture provides them. A UI-bearing plan additionally routes to `om-backend-ui-design` and names separate rule-owner/example/gallery/UI source IDs, direct-or-composite coverage, merged/package SHA, preset availability, explicit-activation-only gallery route, local token source when relevant, and a PR #4277 applicability/status record for every design-system item. Only a token/Figma/design-foundation fixture adds the available opt-in design owner or exact role-gated packed Code Connect source. A specialist-depth fixture requires both the local representative mechanism when applicable and an exact declared installed-package source link. The oracle rejects a shadow teaching module, a whole-example copy, `ratelimit_probe` reuse, directory/wildcard-only source hints, package-only omission of the local reference facts, treating a reference activation as currently live, an invented catalog/unbound implementation, gallery-only evidence, copied gallery rules/snippets, invented props/imports, false direct composite coverage, workspace token paths, a runtime dependency edge between `example` and `design_system`, missing design-foundation classification, blanket Code Connect coverage, unavailable design skill, placeholder-as-live node, incomplete-as-complete mapping, monorepo-only snapshot/exporter, credential/network/publish authority, missing extension integration coverage, or any source write during planning.
- **Existing-spec proof:** the only writable path is the exact seeded covering spec. The oracle requires that file to be read/referenced (and amended only when the prompt changes its contract), rejects any second spec, and rejects all source writes during the planning case.

The explicit-skip, bug-fix, minor-change, and ambiguous cases remain read-only because their contract is classification, not successful feature implementation. Their routing oracle proves `direct`/`ask` without granting a broad write root. Case IDs are allocated only after semantic deduplication against the current catalog.

## Testing and Validation

- Focused instruction test proves the rule exists once, links to a valid installed skill, and stays within the instruction budget.
- Tier/preset tests prove all built-in presets emit the rule and required skill references.
- Evaluator unit tests cover the six read-only rows plus the two writable ordering proofs, including negative/ambiguous wording, visible module/installed-source handoff, reference-fact/topology routing, local-reference-versus-normal-package-output semantics, PR #4301 merged-SHA/direct-composite/source-only mapping, PR #4277 per-item applicability and conditional foundation routing, runtime-decoupling rejection, duplicate/dead/directory reference rejection, invalid enum-ledger classification, missing extension-integration-row rejection, and write-root rejection.
- Harness cases record fail-before/pass-after evidence and update required catalog, validator, oracle, matrix, counts, docs, and generated copies for their modes.
- Run `yarn agents:check-budget`, the focused create-app tests, affected harness lane, and the configured validation gate.

## Implementation Plan

### Phase 1 — Add the routing rule and keep instructions green

1. Add failing focused tests for the decision table, link resolution, preset emission, and instruction budget.
2. Add the concise emitted instruction, planning-skill route, and canonical-example implementation handoff, making each focused test green before proceeding.
3. Verify existing spec discovery, duplicate avoidance, exact source-link resolution, and required extension integration-test traceability against real emitted paths.

Exit criterion: every preset exposes one consistent rule, all focused tests pass, and instruction budgets remain green.

### Phase 2 — Certify behavior in the harness

1. Semantically deduplicate current cases and add/extend only the missing decision rows.
2. Pair each failing evaluator assertion with its policy/routing implementation, including exact-link and extension-integration traceability assertions, and finish the step green.
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
| Figma tooling leaks into ordinary UI plans or implies external authority | Keep PR #4277 as a classified conditional sidecar; require emitted/tier/pack evidence and reject credential, network, push, and publication claims. |

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
| Example reuse | Planning stays source-read-only and hands module work to visible exact canonical/installed references without owning their read policy. |
| Integration traceability | Every newly planned extension surface names a self-contained real-path integration test in the requirement/phase matrix. |
| Instruction budget | Normative decision only in `AGENTS.md`; procedure remains in the owning skill. |
| Testing | Six finite routing oracles, preset/link/budget tests, and an affected certified lane. |
| Runtime/compatibility | No runtime, API, schema, provider, or module behavior changes. |

### Verdict

**Fully specified and ready for implementation after design review.**

## Changelog

- 2026-08-01: Initial draft defined the standalone spec-first decision contract and routing proofs.
- 2026-08-03: Added the one-way module implementation handoff to `om-module-scaffold` and canonical `src/modules/example` capability links; prohibited shadow teaching modules, whole-tree copies, and `ratelimit_probe` reuse.
- 2026-08-03: Required visible exact local/installed source-reference links in implementation plans and self-contained integration coverage for every new extension surface, including DataTable bulk-operation progress.
- 2026-08-03: Extended traceability to materially changed surfaces inside existing rows and required separate DataTable bulk-action and operation-progress source/assertion coverage in their connected integration proof.
- 2026-08-03: Added PR #4883 local reference-fact/topology routing, after-opt-in semantics, generated fact IDs and enum-ledger classifications to module-plan traceability, while preserving normal package-output semantics and specialist depth on exact installed-source links.
- 2026-08-03: Added PR #4301 design-system routing for UI-bearing plans: normative UI guide, exact example use, exact gallery entry, exact public UI implementation, optional local token source, and negative coverage for gallery-only or copied guidance.
- 2026-08-03: Pinned PR #4301's merged/package SHA, added honest composite-constituent coverage, required all fresh standalone presets to remain gallery `source-only`, and rejected runtime coupling between `example` and `design_system`.
- 2026-08-03: Added PR #4277 applicability to every design-system plan item and a conditional token/Figma branch that accepts only emitted opt-in owners or exact packed Code Connect files while rejecting provisional, placeholder, completeness, and external-authority overclaims.

### Review — 2026-08-03

- **Reviewer:** Agent, with independent cross-spec consistency audit.
- **Scope cohesion:** The fresh pass recommended splitting classification from the post-spec module handoff. The user-selected boundary is retained because the handoff is the terminal route of the same planning decision and contains no source-read policy or module implementation procedure; extracting it would leave `spec-first` without a deterministic next owner.
- **Security:** Passed; planning remains source-read-only and does not broaden context or write roots.
- **Performance:** Passed; the emitted rule stays a concise decision/handoff while procedure remains in skills.
- **Cache:** N/A; this spec changes planning policy only.
- **Commands:** N/A; no runtime command contract changes.
- **Risks:** Passed; over-specification, implicit bypass, duplicate reference architecture, and instruction drift are covered.
- **Verdict:** Approved for design review.
