# Standalone reference and harness contracts

Source spec: `.ai/specs/2026-07-31-standalone-canonical-example-module.md`

Companion source specs:

- `.ai/specs/2026-08-01-standalone-harness-knowledge-governance.md`
- `.ai/specs/2026-08-01-standalone-harness-example-read-policy.md`
- `.ai/specs/2026-08-01-standalone-agent-spec-first-routing.md`

Spec PR: #4728
Issue: #4729

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed; per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add failure-first knowledge-change manifest and classifier tests | dispatch:capable | done | 16bdbdfec |
| 1 | 1.2 | Implement the knowledge-change schema and controller validator | dispatch:capable | done | fd16be15e |
| 1 | 1.3 | Strengthen both harness-evolution workflows with the shared governance contract | dispatch:standard | done | b2d426aef |
| 1 | 1.4 | Add synchronization fixtures and machine-enforced asset/count/hash checks | dispatch:capable | done | bad3b8bd2 |
| 2 | 2.1 | Add failing example-root schema, path-security, and compatibility fixtures | dispatch:capable | done | 5b0ac4268 |
| 2 | 2.2 | Implement capability-scoped example-root matching and cumulative budgets | dispatch:capable | done | 8d3f8c44b |
| 2 | 2.3 | Add and implement ordered installed-version fallback with redacted traces | dispatch:capable | done | dc4cee802 |
| 3 | 3.1 | Add failure-first spec-first routing, emission, link, and budget tests | dispatch:standard | done | self:step-3.1 |
| 3 | 3.2 | Add the emitted spec-first instruction and planning-skill decision route | dispatch:standard | todo | — |
| 3 | 3.3 | Synchronize spec-first harness cases, validators, lanes, counts, and docs | dispatch:capable | todo | — |
| 4 | 4.1 | Add the inert reference module inventory, progressive map, shell, and preset guards | dispatch:capable | todo | — |
| 4 | 4.2 | Add scoped reference data, ACL, setup, migration, snapshot, DI, and CLI surfaces | dispatch:capable | todo | — |
| 4 | 4.3 | Add guarded CRUD, commands, links, locking, undo, events, search, and enrichers | dispatch:capable | todo | — |
| 4 | 4.4 | Add export/import, cache, queue/progress, notifications, and browser events | dispatch:capable | todo | — |
| 4 | 4.5 | Add customer-grade reference UI and optional UMES extension examples | dispatch:capable | todo | — |
| 4 | 4.6 | Add activated-fixture, API, runtime, UI, security, and preset certification tests | dispatch:capable | todo | — |
| 5 | 5.1 | Link standalone skills and instructions to the exact reference inventory | dispatch:standard | todo | — |
| 5 | 5.2 | Register reference example roots and synchronize harness assets and release lanes | dispatch:capable | todo | — |
| 6 | 6.1 | Run generated-app certification and reconcile deterministic derived outputs | inline | todo | — |
| 6 | 6.2 | Update the four specs and documentation with implementation-accurate rollout state | inline | todo | — |

## Goal

Implement all four specifications from merged design PR #4728 in one dependency-ordered PR: first establish generic harness governance, then safe example-read semantics, then spec-first routing, and finally the disabled-by-default canonical `reference_module` with its skill links, harness registration, and certification.

## Scope

- Extend the standalone harness schema, evaluator, controller, fixtures, owning skills, cases, validators, release matrix, counts, and documentation for machine-enforced knowledge-contract evolution and bounded example reads.
- Add deterministic emitted spec-first routing and certify each decision branch without changing existing small-fix behavior.
- Add the comprehensive inert template `reference_module`, preserve it in every built-in preset without registering it, and exercise its data/API/runtime/UI/UMES surfaces through activated fixtures.
- Keep authoritative sources and all emitted/generated copies synchronized through the existing create-app generation contracts.

## Non-goals

- Do not enable `reference_module` in any built-in preset or alter current generated runtime behavior by default.
- Do not remove, rename, or repurpose `ratelimit_probe`, the classic demo module, existing presets, or stable harness case IDs.
- Do not weaken tenant/organization scoping, secrets, writable-root, network, credential, optimistic-locking, or compatibility protections.
- Do not expand the broader multi-runner certification tracked by #4670 beyond the affected lanes.
- Do not invent a durable outbox; use the platform's current best-effort post-commit side-effect contract.

## Implementation Plan

### Phase 1 — Knowledge-governance foundation

#### Step 1.1 — Add failure-first knowledge-change manifest and classifier tests

- Add focused contract tests for machine-derived `knowledge-contract` versus `asset-sync` classification.
- Cover the schema fields, authored/controller-owned boundary, mandatory workflow checklist, and unknown-path fail-closed behavior.

#### Step 1.2 — Implement the knowledge-change schema and controller validator

- Add `knowledge-change.schema.json` and the `harness:validate-knowledge-change` command.
- Resolve and verify base/head SHAs, run focused tests in isolated worktrees, atomically emit sanitized evidence, and reject shell-interpolated or authored proof fields.

#### Step 1.3 — Strengthen both harness-evolution workflows with the shared governance contract

- Update repo-local `om-refresh-standalone-harness` and emitted `om-evolve-harness` through shared progressive-disclosure references.
- Require all seven governance steps without duplicating evaluator implementation prose.

#### Step 1.4 — Add synchronization fixtures and machine-enforced asset/count/hash checks

- Cover stale generated copies, hashes, counts, docs, cases/ranges/oracles, release lanes, and false classifications.
- Prove valid `asset-sync` and synthetic `knowledge-contract` manifests pass.

### Phase 2 — Capability-scoped example-read policy

#### Step 2.1 — Add failing example-root schema, path-security, and compatibility fixtures

- Cover root/entrypoint/capability validation, POSIX and Windows normalization, traversal, symlink, generated-cache, sensitive-path, and budget failures.
- Lock unchanged semantics for cases without `exampleRoots`.

#### Step 2.2 — Implement capability-scoped example-root matching and cumulative budgets

- Extend case schema and evaluator trace accounting with realpath-contained roots, progressive entrypoints, capability matching, file/byte budgets, and redacted results.
- Preserve existing context evaluator behavior when the new field is absent.

#### Step 2.3 — Add and implement ordered installed-version fallback with redacted traces

- Add negative and positive ordered fallback fixtures.
- Require local entrypoint inspection plus an allowed missing-contract reason before bounded installed-package reads.

### Phase 3 — Spec-first routing

#### Step 3.1 — Add failure-first spec-first routing, emission, link, and budget tests

- Cover new feature, bug fix, isolated refactor, existing spec, explicit current-turn bypass, urgency without bypass, and ambiguous classification.
- Assert emitted-path resolution, tier parity, and instruction budgets.

#### Step 3.2 — Add the emitted spec-first instruction and planning-skill decision route

- Add the concise rule to emitted `AGENTS.md` and the owning planning/scaffold routes.
- Preserve direct execution for small corrective work and duplicate-spec avoidance.

#### Step 3.3 — Synchronize spec-first harness cases, validators, lanes, counts, and docs

- Semantically deduplicate existing cases and add only missing decision rows.
- Update mode-specific validators/oracles, release lanes, generated copies, counts, and harness docs under the Phase 1 governance contract.

### Phase 4 — Canonical inert reference module

#### Step 4.1 — Add the inert reference module inventory, progressive map, shell, and preset guards

- Add the finite capability inventory, bounded README/surface map, metadata shell, and source/link/context budgets.
- Preserve the unregistered source in `empty`, `crm`, and `classic`; keep the classic demo and `ratelimit_probe` unchanged.

#### Step 4.2 — Add scoped reference data, ACL, setup, migration, snapshot, DI, and CLI surfaces

- Add task/link entities, validators, custom fields, encryption, stable entity-ID bridge, ACL/default grants, idempotent setup/seeds, migration/JSON snapshot, DI, and CLI metadata.
- Keep direct cross-module ORM relationships absent and all scope fail-closed.

#### Step 4.3 — Add guarded CRUD, commands, links, locking, undo, events, search, and enrichers

- Use CRUD factory, Data/Query Engine, commands, mutation guards, API/command interceptors, optimistic locking, scoped finite undo, safe link writes, typed events, search, OpenAPI, and batched optional enrichers.
- Preserve encryption and tenant/organization isolation across every read and write.

#### Step 4.4 — Add export/import, cache, queue/progress, notifications, and browser events

- Add bounded export, idempotent row-transaction import, tenant-tagged cache invalidation, queue worker/progress/cancellation, deduplicated notifications, and audience-scoped DOM-event refresh.
- Use the existing platform runtime contracts and best-effort post-commit side effects.

#### Step 4.5 — Add customer-grade reference UI and optional UMES extension examples

- Add DataTable perspectives, search/filter/sort/URL/export state, auto-discovered fields, shared create/edit CrudForm descriptors, loading/error/conflict/a11y/i18n states.
- Add local hosts plus optional customers/catalog/sales, headless injection, component wrapper, and typed activated-fixture override examples.

#### Step 4.6 — Add activated-fixture, API, runtime, UI, security, and preset certification tests

- Add focused activated-ID, migration, seeds, commands, API/security, async/runtime, optional-host matrix, UI/injection, and preset tests.
- Run generation and prove a clean second migration generation without applying migrations locally.

### Phase 5 — Reference knowledge and harness registration

#### Step 5.1 — Link standalone skills and instructions to the exact reference inventory

- Update module/data/UI/extension/eject-customize guidance with line-number-free authoritative links.
- Add ACL synchronization and migration/snapshot operational guidance while preserving tier emission and instruction budgets.

#### Step 5.2 — Register reference example roots and synchronize harness assets and release lanes

- Add failure-first source-selection, skill-parity, and reference-root cases using the generic Phase 2 policy.
- Synchronize cases, validators/oracles, matrix lanes, counts, docs, fixtures, and generated copies through the Phase 1 workflow.

### Phase 6 — Certification and implementation-accurate docs

#### Step 6.1 — Run generated-app certification and reconcile deterministic derived outputs

- Run the activated compile/runtime fixture, preset matrix, focused integration/UI suite, instruction/link budgets, generation, full configured validation gate, and affected certified harness lane.
- Reconcile only deterministic generated outputs and check the entire diff for placeholders, dead links, stale copies, or accidental activation.

#### Step 6.2 — Update the four specs and documentation with implementation-accurate rollout state

- Update changelogs, implementation notes, catalog counts, and exact validation evidence across all four source specs and owning docs.
- Keep rollout and backward-compatibility claims aligned with the implemented behavior.

## Risks

- The canonical module intentionally spans many stable extension surfaces; exact source links and focused activated-fixture tests reduce drift without altering those existing contracts.
- Broad generated-source synchronization can create accidental divergence; authoritative/generated hashes, generation parity tests, and the machine manifest make stale copies a hard failure.
- Read-policy relaxation could expose unrelated or sensitive content; capability IDs, dual budgets, realpath containment, sensitive-path denial, and redacted traces preserve the security boundary.
- The feature is large enough that environment or runner availability may block full harness certification; run artifacts remain resumable and record any unavailable lane as a blocker rather than a pass.
- The issue body requested split PRs, but the user explicitly superseded that packaging decision for this run; all four specs therefore land atomically in this one PR while retaining their one-way ownership boundaries.
