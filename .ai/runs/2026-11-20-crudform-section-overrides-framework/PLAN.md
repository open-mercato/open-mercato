# CrudForm section overrides framework

Source doc: .ai/specs/2026-10-22-crudform-section-overrides-framework.md
Source design PR: #6769
Status: in-progress

## Tasks

> The first todo row is the resume point. Each row corresponds to one implementation commit.

| Phase | Step | Title | Exec | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.1 | Compose and dispatch the forms.sections override domain | dispatch | done | 435c1850a9 |
| 1 | 1.2 | Discover section facts and lazy browser loaders with deterministic parity | dispatch | done | 0d589dcdc1 |
| 1 | 1.3 | Define serializable section, capability, dependency and surface facts | dispatch | done | 498703b028 |
| 1 | 1.4 | Add stable section scopes and pin legacy handle compatibility | dispatch | done | 05f57ef0aa |
| 2 | 2.1 | Match final server capabilities by canonical facts | dispatch | done | 656b6da502 |
| 2 | 2.2 | Build the accepted manifest, host ledger and authenticated resolver | dispatch | done | b57754dc3c |
| 2 | 2.3 | Bind guarded mutation requests to reauthorized providers and resources | dispatch | done | d9107f1124 |
| 2 | 2.4 | Enforce required leaves and scoped default providers | dispatch | done | db7c2bde2d |
| 2 | 2.5 | Compose ambient command lifecycle with the final-input transaction boundary | group:A | done | 744cddf999 |
| 2 | 2.5-review-fix | Keep create-only entity writes and pending effects within the ambient lifecycle | inline | done | bf3c4b1d7a |
| 2 | 2.6 | Add transactional sink discovery, lifecycles and read-back | group:A | done | 24e2c0174d |
| 2 | 2.6-review-fix | Reauthorize scoped sink undo and clean up registered host variants | inline | done | f64d5c9209 |
| 2 | 2.7 | Derive section hosts for qualifying CRUD routes | dispatch | done | e7a8b0b6c4 |
| 2 | 2.7-review-fix | Preserve original CRUD lifecycle and generated route authority | inline | done | 5ba3c6c7f2 |
| 2 | 2.8 | Deliver outbox revisions with monotonic fencing and retry | dispatch | done | 2ce5c71565 |
| 2 | 2.8-review-fix | Pin durable outbox contracts and recover terminal reporting | inline | done | ab8b3fb3e5 |
| 3 | 3.1 | Introduce optional explicit CrudForm identity and composition props | dispatch | done | ab709f0758 |
| 3 | 3.2 | Resolve policies and block mutations until the host is ready | dispatch | done | 6d7ec417bb |
| 3 | 3.3 | Validate and project section fields and payload leaves | dispatch | done | 136886649f |
| 3 | 3.4 | Bind submit, delete and action clients to their own resource versions | dispatch | done | b851023362 |
| 3 | 3.2-review-fix | Fence form readiness by organization and isolate group preferences | dispatch | done | 9df7e6ab6d |
| 4 | 4.1 | Build the non-production framework fixture | dispatch | done | ca63726325 |
| 4 | 4.2 | Verify discovery, resolution, mutations and no-policy compatibility | dispatch | done | b6a4dda37e |
| 4 | 4.3 | Define the discovery, runtime and generator compatibility guarantees | dispatch | done | 1b369c9d4f |
| 4 | 4.4-review-fix | Preserve canonical order with explicit comparators | inline | done | 0183853f77 |
| 4 | 4.4-budget-fix | Account for exact standalone context growth | dispatch | done | 6f500849aa |
| 4 | 4.4 | Run and record the framework validation gates | dispatch | done | 9b5f3a56f2 |
| 5 | 5.1 | Add the single-definition extension authoring API | dispatch | done | 231f803e33 |
| 5 | 5.2 | Derive field-level sections and enforce mandatory refinements | dispatch | done | 0ddc59aa2b |
| 5 | 5.3 | Compile extension declarations into the framework registries and callbacks | dispatch | done | 476ac5f7b5 |
| 5 | 5.4 | Add custom-field, table and external store builders | dispatch | done | e8a39710d7 |
| 5 | 5.5 | Prove wrapper and hand-written fixture manifest parity | dispatch | done | 37868b3c34 |
| 5 | 5.6 | Document the wrapper and stable public imports | dispatch | done | 40389cd644 |
| 6 | 6.1 | Add the example Todo showcase and transaction ownership contract | dispatch | done | 028a2472df |
| 6 | 6.2 | Cover all showcase cases in Playwright and generator tests | dispatch | done | 0c1b32df99 |
| 6 | 6.3 | Register example capabilities and verify template parity | dispatch | done | 9f4313cdc7 |
| 6 | 6.2-lint-fix | Distinguish the Playwright fixture callback from a React hook | self | done | f5510f5eb1 |
| 6 | 6.4 | Refresh standalone harness coverage for each showcase case | dispatch | todo | — |
| 6 | 6.2-audit-review-fix | Keep private sink replay data out of audit responses | self | done | this commit |
| 6 | 6.2-host-review-fix | Keep configured host and sink versions independent and extend compatibility coverage | self | done | this commit |
| 6 | 6.4-packed-budget-fix | Account for the measured rendered scaffold context | self | done | this commit |
| 6 | 6.2-custom-validation-fix | Preserve the complete submitted native field set for validation | self | done | this commit |
| 6 | 6.4-release-config-fix | Accept canonical packed Yarn config and validate in production mode | self | done | this commit |
| 6 | 6.4-release-foundation-fix | Keep OpenAPI temporary output outside protected dependencies and fix scaffold lint | self | done | this commit |
| 6 | 6.4-routing-fix | Give each Todo policy one canonical Example recipe | self | done | this commit |
| 6 | 6.4-final-review-fix | Enforce runtime file ownership, isolate generated-test mode, and publish reference documentation | self | done | this commit |
| 6 | 6.4-live-routing-fix | Clarify the existing-host, independent table, and ERP recipe tasks | self | done | this commit |
| 6 | 6.5 | Record example, harness and integration evidence | dispatch | todo | — |

## Goal

Let modules add, hide or replace CrudForm sections with matching client and server semantics, and prove the contract with the example Todo showcase.

## Scope

Ship the framework and its executable examples as one implementation PR referencing #6769. The rollout assigns inventory, tracker-link verification and production adopters to independently deployable PRs.

## Risks

- Resolve policies against the final server registry. Block configured hosts while resolution is pending or fails.
- Preserve default form rendering and writes, ordinary command effects, replay behavior and existing component handles.
- Keep final payload enforcement in the transaction and preserve resource scoping and per-resource version checks.

## Implementation Plan

### Phase 1 — data-only contract

#### 1.1 Compose and dispatch the forms.sections override domain

Framework spec item 1. Add `forms.sections` to `ModuleOverrides`, the domain union, composer, dispatcher, tests, docs status table, and package guidance. Preserve existing precedence and `null` semantics.

#### 1.2 Discover section facts and lazy browser loaders with deterministic parity

Framework spec item 2. Add the module-root `form-sections.ts` convention, `defineCrudFormSections`/lazy-runtime helpers, paired server-facts and browser-runtime generated registries, exact contribution lookup, deterministic ordering, disabled-module filtering, and fact/loader parity diagnostics.

#### 1.3 Define serializable section, capability, dependency and surface facts

Framework spec item 3. Add serializable section address, contribution, capability, dependency, mutation-surface, and finite-surface fact types under `packages/shared`; add a package-boundary test preventing React/Zod/UI/domain imports.

#### 1.4 Add stable section scopes and pin legacy handle compatibility

Framework spec item 4. Add `crudFormSectionScope(address)` while preserving `ComponentReplacementHandles.section(scope, sectionId)` unchanged; pin both outputs in compatibility tests.

### Phase 2 — server enforcement

#### 2.1 Match final server capabilities by canonical facts

Framework spec item 5. Register post-override semantic capabilities from enrichers/interceptors/guards and declarative display-only providers. Match canonical serialized facts, not ids alone.

#### 2.2 Build the accepted manifest, host ledger and authenticated resolver

Framework spec item 6. Dispatch `forms.sections` in server and client bootstrap, reject server-only-gated entries, and publish the configured-host ledger. Build the accepted manifest/fingerprint at server bootstrap and implement the exact authenticated resolve endpoint, strict Zod/body/cardinality/uniqueness bounds, metadata/provider features, OpenAPI/status map, canonical token encoding/limits, blocking failure response, and safe diagnostics.

#### 2.3 Bind guarded mutation requests to reauthorized providers and resources

Framework spec item 7. Add guarded façade helpers and a shared parser/builder for the eight protected headers. Validate token schema/current client/server fingerprint, reauthorized host assertion, mode, route, request operation, mutation target, mutation surface, exact resource-binding ids, and delegated provider after auth/ACL/scoped-target gates and before domain mutation; reject `target-required` providers without an atomic lock/CAS declaration; then collect/run mutation guards plus the legacy bridge, revalidate modified payloads against the policy/domain contracts, and run post-success callbacks through error reporting. Return the exact `extension_policy_mismatch` 409 body for policy mismatches.

#### 2.4 Enforce required leaves and scoped default providers

Framework spec item 7a. Add `requiredLeaves` facts and the schema-drift contract helper; enforce exact-once required-leaf coverage at bootstrap; add leaf-default provider discovery/runtime; map hidden-leaf validation failures to `crud_form_section_hidden_field_invalid`.

#### 2.5 Compose ambient command lifecycle with the final-input transaction boundary

Framework spec item 7b. Add final-input enforcement at the transactional command seam and prove ambient command lifecycle compatibility for ordinary and atomic replay callers.

#### 2.5-review-fix Keep create-only entity writes and pending effects within the ambient lifecycle

Ensure create-only custom entities reuse the outer transaction and attempt all committed queued effects when one effect fails.

#### 2.6 Add transactional sink discovery, lifecycles and read-back

Framework spec item 7b. Add sink and leaf-default discovery from `form-sections.ts`, `defineCrudFormSectionSink`, the `extensions.<moduleId>` façade namespace, façade-owned transactions passing `transactionalEm` plus an owned `transactionLifetime`, first implementing §9 normal command lifecycle composition and §6 final-input enforcement (prove sink rollback removes all data/audit changes and suppresses all success effects; prove commit effects exactly once and preserve legacy/replay contracts), after-commit sink callbacks with `extensionWarnings`, the auto-registered `_extensions` detail enricher, sink-version locking, and undo/delete hooks.

#### 2.6-review-fix Reauthorize scoped sink undo and clean up registered host variants

Bind historical undo to exact sink and source facts and grants. Limit lifecycle cleanup to parent hard deletion and include registered sibling variants.

#### 2.7 Derive section hosts for qualifying CRUD routes

Framework spec item 7c. Add `defineCrudRouteSectionHost` and the generator that derives provider facts, `requiredLeaves`, the thin guarded façade, and lock mode for qualifying `makeCrudRoute` hosts; reject non-qualifying hosts with a diagnostic naming the failed qualifier.

#### 2.7-review-fix Preserve original CRUD lifecycle and generated route authority

Reuse original parsers, mapping, API interception and synchronous lifecycle at the guarded boundary. Check route-shape collisions, require explicit delete behavior, and attach committed operation metadata.

#### 2.8 Deliver outbox revisions with monotonic fencing and retry

Framework spec item 7d. Add `outbox` sinks: the `outboxColumns` mixin, revision-qualified outcome writes, provider-enforced monotonic remote fencing, retained identity/revision tombstones across delete/restore, post-commit coalesced enqueue, sweeper, `deliver`/`validateExternal` hooks with timeout and abort signal, backoff and terminal `failed` state, `__sync` read-back, `<sinkId>.retry` section-action façade, compensating delete/undo delivery, credentials and `url-safety`/`host-pinning` enforcement.

#### 2.8-review-fix Pin durable outbox contracts and recover terminal reporting

Reject stale undo and incompatible durable intents, isolate sink mappings, and retry terminal notifications without redelivery.

### Phase 3 — UI integration

#### 3.1 Introduce optional explicit CrudForm identity and composition props

Framework spec item 8. Add optional `formVariant`, `formOperation`, `resourceId`, and runtime descriptor/composition-validator inputs to `CrudForm`; require explicit identity only for policy-enabled surfaces.

#### 3.2 Resolve policies and block mutations until the host is ready

Framework spec item 9. Implement the resolver/readiness state and section adapter using the generated runtime registry plus current injection/component registries. Consult the server ledger before the identity path.

#### 3.3 Validate and project section fields and payload leaves

Framework spec item 10. Validate explicit section projections, then composition; project custom-field definitions before the existing gate; deep-merge payload leaves and reject collisions.

#### 3.4 Bind submit, delete and action clients to their own resource versions

Framework spec item 11. Add immutable bound clients to submit/delete contexts and `runSectionMutation` to group/widget contexts. Test parent update/delete, child update/delete, create, policy-header protection, and overlapping requests.

#### 3.2-review-fix Fence form readiness by organization and isolate group preferences

Reject stale feature grants, settle registration failures, check actual header and form widget dependencies, and preserve the legacy group preference when applying policy composition.

### Phase 4 — framework proof and docs

#### 4.1 Build the non-production framework fixture

Framework spec item 12. Add a non-production framework fixture that proves one display addition, one hide, one replacement, duplicate leaf/custom-field ownership rejection, `ids`/`all` definition-set matching, capability mismatch, and configured-host blocking failure without importing a domain module.

#### 4.2 Verify discovery, resolution, mutations and no-policy compatibility

Framework spec item 13. Add framework tests for discovery/loader parity, server/client dispatch and gating, add/hide/replace, display-only add, capability/dependency/custom-field mismatch, protected-token reconstruction under server reauthorization, semantic descriptor drift without a round-trip bump, no-op allow/deny, override precedence, bootstrap pending/failure, manifest mismatch, finite alternatives, ungrouped bypass, and observable no-policy equivalence.

#### 4.3 Define the discovery, runtime and generator compatibility guarantees

Framework spec item 14. Update `BACKWARD_COMPATIBILITY.md`, module-development/framework docs, package guides, and the unified-overrides status table with the new auto-discovery and generated-registry contracts.

#### 4.4-review-fix Preserve canonical order with explicit comparators

Address the repository-wide sort audit with explicit UTF-16 ordering wherever the new framework serialized or compared sorted strings.

#### 4.4-budget-fix Account for exact standalone context growth

Treat the targeted standalone byte-cap failures as a compatibility regression. Preserve access rules, initial limits, and prior slack while accounting for the measured additions to each required file.

#### 4.4 Run and record the framework validation gates

Framework spec item 15. Run `yarn workspace @open-mercato/shared test`, `yarn workspace @open-mercato/shared build`, `yarn workspace @open-mercato/ui test`, `yarn workspace @open-mercato/ui build`, `yarn generate`, `yarn check:client-boundaries`, `yarn template:sync`, `git diff --check`, and the configured validation gate. Record command, exit status, and artifact/diff evidence for every gate.

### Phase 5 — single-definition authoring wrapper

#### 5.1 Add the single-definition extension authoring API

Framework spec item 16. Add `@open-mercato/ui/backend/crud-form-extensions` with `defineCrudFormExtension` and the `hide`/`replace`/`modify`/`add`/`field.*`/`store.*` builders. Builders return plain data and server callbacks only; reuse the `InjectionFieldWidget` field shape and `CrudField` renderers.

#### 5.2 Derive field-level sections and enforce mandatory refinements

Framework spec item 17. Add the `CrudFormFieldGranularSection` interface and the pure derivation functions: field removal with refinement pruning, `mandatory` refinement rejection, field addition, presentation patch, and derived round-trip ids. Unit-test that unpatched fields keep byte-identical validation and projection.

#### 5.3 Compile extension declarations into the framework registries and callbacks

Framework spec item 18. Extend the generator to compile each extension into §1 overrides/contributions, §2 derived descriptors, §8 leaf defaults, §6 scoped mutation guards for `validate.server`, and §9 sinks. Extract browser-registry literals without importing the file, report cross-module conflicts, and print the compiled summary.

#### 5.4 Add custom-field, table and external store builders

Framework spec item 19. Implement the generic stores: `store.customField` (definition seeding through `ce.ts`), `store.table` (generic upsert/enricher/lock/undo/delete sink), and `store.external` (outbox sink over the contributing module's own mirror entity built from the `outboxColumns` mixin; nothing generated).

#### 5.5 Prove wrapper and hand-written fixture manifest parity

Framework spec item 20. Rebuild the Phase 4 framework fixture as one `defineCrudFormExtension` and prove it compiles to the same manifest fingerprint as the equivalent hand-written declarations.

#### 5.6 Document the wrapper and stable public imports

Framework spec item 21. Document the wrapper as the primary recipe in the module-development guide and the standalone harness (`om-refresh-standalone-harness`), with the hand-written primitives as the advanced path. Add the new import path and builders to `BACKWARD_COMPATIBILITY.md`.

### Phase 6 — examples, integration tests, standalone harness

#### 6.1 Add the example Todo showcase and transaction ownership contract

Framework spec item 22. Adopt the example `TodoForm` through the §10 derived adapter with variants `default` and `showcase`; add the showcase pages; add the live recipes C1, C2, C4–C11 (§12.1) to `apps/mercato/src/modules/example/form-sections.ts` with the in-process fake `exampleExternalErp` client, the new entities with migrations/snapshots, and i18n keys; add C3 to the QA fixture app. Make `example.todos.create|update|delete` honor `CommandRuntimeContext.transactionalEm` (they do not today): use the provided em and its locks, with no fork or commit of their own. Implement §6 final-input enforcement and §9 transaction-lifetime composition before declaring `extensionSinkSupport: 'host-transaction'` on the todo host, with a contract test proving the entire §9 rollback/commit lifecycle, including custom fields, action logs, snapshots, interceptors and success effects.

#### 6.2 Cover all showcase cases in Playwright and generator tests

Framework spec item 23. Add `TC-EXAMPLE-FORM-001` … `TC-EXAMPLE-FORM-012` under `apps/mercato/src/modules/example/__integration__/`, with self-contained API fixtures and both API and UI assertions; add the generator unit tests for the generation-time cases.

#### 6.3 Register example capabilities and verify template parity

Framework spec item 24. Register capability ids `example.crud-form-extensions.c1` … `c12` in `references/surface-inventory.json` and `references/surface-map.md`; mirror the example module to the create-app template with `yarn template:sync:fix`.

#### 6.4 Refresh standalone harness coverage for each showcase case

Framework spec item 25. Run `om-refresh-standalone-harness` over the implementing range to add one harness case per matrix row with `context.exampleRoots`, and link the standalone router plus the module-development guide to the example recipes; each case must fail before and pass after its owner change.

#### 6.5 Record example, harness and integration evidence

Framework spec item 26. Record `yarn test:integration` (filtered to `TC-EXAMPLE-FORM`), the generator unit tests, `yarn template:sync`, and the harness run as evidence. Phases 1–5 steps that implement a case are not complete until that case's example, test, and harness entry exist.

## Verification

Use targeted workspace tests at each step, then checkpoint the integration and browser evidence. Before marking the implementation PR ready, run the spec gates, the configured validation sequence, the Open Mercato integration and applicable template suites, the design system pass and independent core-team review.
