# Standalone Canonical Example Module

- **Status:** Draft
- **Date:** 2026-07-31
- **Scope:** OSS, standalone applications emitted by `create-mercato-app`
- **Related:** [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md), [Empty App Starter Presets](./2026-04-02-empty-app-starter-presets.md), merged PR [#4529](https://github.com/open-mercato/open-mercato/pull/4529), follow-up issue [#4670](https://github.com/open-mercato/open-mercato/issues/4670)

## TLDR

Fresh `empty` and `crm` standalone scaffolds delete the only comprehensive local `example` module but retain the narrow `ratelimit_probe` test fixture. Coding agents therefore mistake that probe for the app's reference implementation or spend context on installed framework source. Add one compact, compilable, disabled-by-default `reference_module` to every built-in scaffold as the local golden path for `om-module-scaffold`, then add and fully register a failure-first harness regression proving module-building agents select and reuse it without treating `ratelimit_probe` as an example.

The reference demonstrates one complete vertical slice—scoped entity, validation, migration snapshot, commands and undo, CRUD/OpenAPI, ACL/setup, DataTable, CrudForm, i18n, optimistic locking, events/search, a response enricher, and stable widget extension hosts—rather than copying every optional convention or retaining the existing 134-file, 1.3 MiB classic demo/QA module in lean presets.

## Overview

This specification adds a source-only teaching module to the standalone application template and a regression that proves coding agents use it. The change deliberately combines the reference and its harness coverage because the local example is only valuable if emitted agents can discover it reliably, and the regression has no independent product behavior.

The feature is OSS developer infrastructure. It changes generated source inventory but does not enable a module, alter application runtime behavior, or require a database rollout.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Rationale | Confirm? |
|---|---|---|---|---|
| Q1 | Reuse the existing classic `example` tree or add a separate reference? | Add compact `reference_module`; keep the classic demo/QA module unchanged and still removed from lean presets. | The generic name makes the source-only teaching role unmistakable, while the existing tree is 134 files, tightly coupled to demo modules, and optimized for platform QA rather than copying. | OK |
| Q2 | Should the reference run by default? | Ship its source in every built-in preset but omit it from `src/modules.ts`. | Agents can inspect/copy it while runtime, migrations, navigation, seeds, and routes remain unchanged. | OK |
| Q3 | Does “all module elements” mean every discovery surface? | Cover the complete CRUD/extension golden path named in the brief; explicitly defer unrelated AI, provider, workflow, queue, cache, portal, and CLI branches to their specialist skills. | `om-module-scaffold` forbids speculative placeholder surfaces, and an exhaustive kitchen sink would increase rather than save context. | OK |
| Q4 | Add a new harness case or expand an existing one? | Add a distinct post-#4529 regression after semantic deduplication against OMH-185. | OMH-185 validates complete generated code; this case validates local-reference selection and avoids the observed `ratelimit_probe` detour. | OK |

## Problem Statement

The starter preset resolver currently removes `src/modules/example` and `src/modules/example_customers_sync` from `empty` and `crm`, while the template's test-only `ratelimit_probe` directory remains. The attached agent trace shows the resulting behavior: the agent inspects `ratelimit_probe`, then falls back to installed package source for an example. This wastes context and exposes agents to a narrow fixture that was never designed as a reusable module blueprint.

## Proposed Solution

1. Add a compact `packages/create-app/template/src/modules/reference_module/` golden-path module built to the current standalone `om-module-scaffold` contract.
2. Keep it absent from every preset's `src/modules.ts`; preset application must preserve its source while continuing to remove the classic demo/QA modules from lean presets.
3. Give the module a small surface map and rename checklist so agents load only the files relevant to the requested capability.
4. Make the module-scaffold procedure the single knowledge owner that points agents to this local example and explicitly rejects `ratelimit_probe` as a blueprint.
5. Extend the merged standalone harness with a failure-first regression for the observed selection failure and validate it through the normal harness release gates.

## Scope Boundaries

### In scope

- A disabled, compilable, copy-and-rename reference module in all built-in standalone presets.
- One canonical CRUD/entity/UI slice plus the enricher and widget-host examples explicitly requested.
- Generator, preset, template, context-budget, and harness regression coverage.
- Evidence and hand-off tied to merged PR #4529 and the existing harness evolution workflow.

### Out of scope

- Enabling the reference module or applying its migration in generated apps.
- Replacing or redesigning the classic `example` and `example_customers_sync` QA/demo modules.
- Removing or renaming `ratelimit_probe` or its API route.
- Duplicating specialist AI, workflow, provider, queue, cache, portal, or CLI examples.
- Expanding issue #4670's multi-runner certification scope beyond the new affected-case lane.

## Research and Existing-System Findings

### Repository findings

- `packages/create-app/src/lib/starter-presets.ts` removes `src/modules/example` and `src/modules/example_customers_sync` from the `empty` preset; `crm` inherits that removal.
- `packages/create-app/template/src/modules/ratelimit_probe/api/ping/route.ts` describes itself as a test-only rate-limit probe, yet it is the most visible surviving local module in lean scaffolds.
- The classic `example` module currently spans 134 files and approximately 1.3 MiB. It includes demo data, QA pages, and optional cross-module integrations, so restoring it to lean presets would work against their purpose.
- The installed `om-module-scaffold` workflow already owns the current rules for module composition and warns against speculative discovery surfaces. The missing piece is a small local implementation that those rules can point to.
- The standalone harness merged in PR #4529 now gives this regression a stable place to live. OMH-185 checks whether an agent can build a complete module; it does not check which local source the agent chooses as its reference.
- No active OSS or enterprise spec, open issue, or open PR covers a compact disabled reference module. Historical issue #853 and superseded issue #1651 concern broader standalone agent guidance, while issue #4670 tracks runner breadth rather than this source-selection failure.

### External patterns

The proposed split follows two established developer-platform patterns:

- [Medusa modules](https://docs.medusajs.com/learn/fundamentals/modules) pair a constrained module structure with a small service and data-model boundary; its [directory guidance](https://docs.medusajs.com/learn/fundamentals/modules/modules-directory-structure) makes the expected local layout explicit.
- [Backstage Software Templates](https://backstage.io/docs/features/software-templates/) keep repeatable scaffolding knowledge in versioned templates, while its [template authoring guide](https://backstage.io/docs/features/software-templates/writing-templates/) separates reusable structure from application activation.

For Open Mercato, that means keeping authoritative rules in the scaffold skill, keeping one inspectable implementation in the emitted app, and making activation an explicit choice.

## Goals and Success Criteria

### Goals

1. Give coding agents in every built-in standalone preset an unmistakable, current local reference for ordinary module work.
2. Reduce repository exploration and prompt context without making generated applications heavier at runtime.
3. Demonstrate a coherent end-to-end CRUD and extension slice, including the requested enricher, widget hosts, and `CrudForm` usage.
4. Keep module guidance maintainable by assigning each rule one knowledge owner.
5. Prevent recurrence with a failure-first standalone harness case based on the observed trace.

### Measurable success criteria

- A generated `empty`, `crm`, or `classic` app contains `src/modules/reference_module/`, while no built-in preset registers `reference_module` in `src/modules.ts`.
- The reference tree is at most 40 source files and 256 KiB, its README is at most 4 KiB, and no individual client component exceeds 300 lines.
- The module compiles and passes its focused tests when copied into an isolated fixture and explicitly enabled.
- The reference contains no `any`, raw `fetch`, hard-coded user-facing copy, direct cross-module ORM relationship, or unscoped tenant query.
- A module-scaffold harness run selects `reference_module` before `ratelimit_probe` or installed package source and produces a passing module from the reference.
- Existing preset snapshots and the existing ratelimit-probe test contract remain green.

## Architecture

### Ownership and discovery

The authoritative guidance remains:

`packages/create-app/agentic/shared/ai/skills/om-module-scaffold/references/module-surfaces.md`

That reference will:

- identify `src/modules/reference_module/README.md` as the emitted-app implementation map;
- explicitly state that `ratelimit_probe` is a test fixture, not a module blueprint;
- tell agents to copy only the surfaces required by the requested feature;
- retain all architecture, naming, generation, and validation rules so the emitted README does not duplicate them.

The base agentic bundle must continue to emit `om-module-scaffold` into every built-in preset. Preset contract tests verify the skill and its `module-surfaces.md` reference beside the example. The module README remains useful if an app later removes its agentic bundle: it contains a bounded purpose statement, enable/copy procedure, file-to-capability table, rename checklist, and links back to the scaffold skill, but does not duplicate the architecture rules.

### Proposed module tree

```text
packages/create-app/template/src/modules/reference_module/
├── README.md
├── acl.ts
├── index.ts
├── setup.ts
├── commands.ts
├── events.ts
├── search.ts
├── api/
│   └── tasks/
│       ├── route.ts
│       └── [id]/route.ts
├── data/
│   ├── entities.ts
│   ├── validators.ts
│   ├── enrichers.ts
│   └── custom-fields.ts
├── migrations/
│   ├── Migration<timestamp>.ts
│   └── .snapshot-open-mercato.json
├── backend/
│   ├── tasks/page.tsx
│   ├── tasks/create/page.tsx
│   ├── tasks/[id]/page.tsx
│   └── components/
│       ├── ReferenceTasksTable.tsx
│       └── ReferenceTaskForm.tsx
├── widgets/
│   ├── injection.ts
│   └── components.tsx
├── i18n/
│   ├── en.json
│   ├── de.json
│   ├── es.json
│   └── pl.json
└── __tests__/
    ├── api.test.ts
    ├── commands.test.ts
    └── enrichers.test.ts
```

Exact discovery filenames must be reconciled with the generated app's installed package version during implementation. Generated registries are updated only through `yarn generate`; generated files are never edited by hand.

### Disabled-by-default boundary

The source directory is copied by the base template and preserved by all presets, but `reference_module` is absent from every generated `src/modules.ts`. Therefore it contributes no routes, navigation, entities, migrations, seeds, ACL grants, events, widgets, or search entries until a developer deliberately copies or registers it. TypeScript may still include the unregistered tree through generated-app globs, so every built-in preset must typecheck with the source present and all imports resolved; activation is not required for compilation.

Preset tests must assert both halves of this contract: source present, registration absent. The existing classic `example` behavior and `ratelimit_probe` behavior remain unchanged.

### Stable identifiers

The example uses stable, grep-friendly identifiers so agents can rename them mechanically:

| Surface | Identifier |
|---|---|
| Module | `reference_module` |
| Entity ID | `reference_module.task` |
| Table | `reference_module_tasks` |
| ACL features | `reference_module.view`, `reference_module.manage` |
| Events | `reference_module.task.created`, `.updated`, `.deleted`, `.restored` |
| Search entity | `reference_module.task` |
| Widget host | `reference_module.task.detail:summary` |
| CrudForm field host | `crud-form:reference_module.task:fields` |

`reference_module` is an intentional teaching-fixture exception to the normal plural module-ID convention, analogous to the existing `example` special case. It must not be cited as permission to use singular IDs for product modules. The implementation must verify the exact enricher and widget ID syntax against the installed contracts rather than introducing a new convention.

## Data Models and Security

### `ReferenceTask`

| Column | Type | Requirements |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Required scope |
| `organization_id` | UUID | Required scope |
| `title` | text | Required, explicitly non-sensitive and searchable |
| `description` | text, nullable | Optional, encrypted through module field metadata and excluded from search |
| `status` | enum/string | `todo`, `in_progress`, or `done` |
| `priority` | integer | Bounded example validation |
| `due_at` | timestamp, nullable | Used by the enricher |
| `is_active` | boolean | Defaults true |
| `created_at` | timestamp | Required |
| `updated_at` | timestamp | Required optimistic-lock version |
| `deleted_at` | timestamp, nullable | Soft deletion and undo support |

Indexes cover `(tenant_id, organization_id, deleted_at)`, `(tenant_id, organization_id, status)`, and due-date listing. Every query and mutation scopes by tenant and organization. Decryption uses `findWithDecryption` or `findOneWithDecryption` for `description`; decrypted text never enters events, logs, or search documents. The reference never introduces a direct ORM relationship to another module.

`data/custom-fields.ts` demonstrates one local custom field, `source`, without creating an optional-module dependency. Validators are Zod-first and exported TypeScript types use `z.infer`.

### Migration policy

The template includes the intended migration and current module snapshot so a copied-and-enabled module is internally consistent. Implementation uses `yarn db:generate`, reviews the SQL, discards unrelated generated output, and never runs `yarn db:migrate` as part of the change.

## Command and API Contracts

### Command boundary

Create, update, delete, and restore operations flow through registered commands. Command handlers use the framework CRUD write helper, apply tenant and organization scope, emit typed lifecycle events, and return undo metadata where applicable. Update, delete, and restore enforce the client-provided `updatedAt` version through the command optimistic-lock guard.

The UI never bypasses commands or mutation guards. Child-entity writes are not part of this example, avoiding misleading parent-version reuse.

### HTTP API

| Method | Path | Purpose | Guard |
|---|---|---|---|
| `GET` | `/api/reference_module/tasks` | Scoped list/query-engine example | `reference_module.view` |
| `POST` | `/api/reference_module/tasks` | Create through command | `reference_module.manage` |
| `GET` | `/api/reference_module/tasks/:id` | Scoped detail | `reference_module.view` |
| `PUT` | `/api/reference_module/tasks/:id` | Optimistically locked update | `reference_module.manage` |
| `DELETE` | `/api/reference_module/tasks/:id` | Optimistically locked soft delete | `reference_module.manage` |

Routes use `makeCrudRoute`, registered OpenAPI metadata, shared query-engine parsing, bounded page sizes, and the framework response/error shapes. List and detail responses return `updatedAt`. Invalid input returns the standard 400 contract, forbidden access returns 403, missing or cross-scope IDs return the same 404 shape, and stale mutations return the unified 409 optimistic-lock body.

This is additive template source, not a new enabled platform API. The route paths only exist after explicit module registration.

### Response enricher

The module self-enriches task list and detail responses under a namespaced `_reference_module` object:

```ts
{
  _reference_module: {
    isOverdue: boolean,
    dueBucket: 'none' | 'overdue' | 'today' | 'future'
  }
}
```

The enricher batches by task ID, maintains tenant and organization scope, does not mutate base fields, and opts out of list-cache reuse when time-sensitive results could become stale (`cacheableOnListHit: false`). Its registration is a concrete caller, not a placeholder.

## Events, Search, and Setup

- `events.ts` uses `createModuleEvents` for created, updated, deleted, and restored task events. Events contain IDs and safe snapshots only; encrypted values and credentials are excluded.
- `search.ts` registers `reference_module.task`, indexes only the explicitly non-sensitive title plus status through the supported search contract, and scopes every indexing and query operation. Encrypted description content is never indexed.
- `acl.ts` declares immutable view/manage features. `setup.ts` registers features and grants them to the appropriate default administrative role using the existing ACL sync helper.
- Tenant initialization does not seed demo rows. A reference that is disabled by default must remain side-effect free even after source generation.

## UI and Extension Contracts

### Pages and component boundaries

The list page renders the shared `DataTable` with server-backed filters, status/priority columns, pagination no larger than 100, stable row-action IDs, loading/error states, and translated empty copy. Create and edit pages use a shared `ReferenceTaskForm` built on `CrudForm`.

`initialValues.updatedAt` allows `CrudForm` to derive the optimistic-lock header for update and delete. Conflicts surface through the unified record-conflict banner. CRUD helpers (`createCrud`, `updateCrud`, and `deleteCrud`) handle mutations and standard error elevation.

The server/client split follows the frontend architecture contract:

| File/family | Boundary | Responsibility |
|---|---|---|
| route and page entrypoints | Server by default | Metadata, auth/features, initial data |
| `ReferenceTasksTable` | Client island | DataTable interaction, filters, row actions |
| `ReferenceTaskForm` | Client island | CrudForm state and guarded CRUD actions |
| widget renderers | Smallest viable client boundary | Injection context and interactive action only |

No server component imports client hooks. Props crossing the boundary are serializable IDs, strings, booleans, numbers, dates serialized as strings, and plain option arrays. The client ledger must remain within the 300-line per-file budget; no facade component may exist solely to hide a large client subtree.

The implementation records this explicit `"use client"` ledger:

| File/family | Browser-only reason | Imported by | Heavy dependencies | Cleanup/hydration risk | Server alternative rejected |
|---|---|---|---|---|---|
| `ReferenceTasksTable.tsx` | DataTable filter, selection, and row-action state | server list page | None beyond shared DataTable | Stable initial props and no mount-only data fetch | DataTable interaction requires client state. |
| `ReferenceTaskForm.tsx` | CrudForm field state, submission, delete, and conflict retry | server create/detail pages | None beyond shared CrudForm | Initial values are serialized; mutation handlers must not duplicate on hydration. | Editable form state and keyboard submission require a client island. |
| interactive widget renderer, only if retained | Injection-data callbacks for the concrete source field or due/status action | server detail/form host | None | Subscriptions and callbacks clean up on unmount. | Static renderers stay server-side; only the interactive leaf opts in. |

Frontend budgets are zero new page-root `"use client"` directives, zero client leaves over 300 lines, zero heavy browser libraries at a page/provider root, and zero global provider/bootstrap registrations. No provider or bootstrap registry changes are expected; widget discovery remains module-local. Implementation evidence must include `yarn check:client-boundaries`, hydration smoke tests for list/create/detail, DataTable and CrudForm interaction coverage, and one `yarn build:app` route/build signal showing no new heavy root dependency.

### Widget examples

The module demonstrates both sides of stable local extension contracts:

1. A detail summary host at `reference_module.task.detail:summary` with a real injected status/due summary widget.
2. A `crud-form:reference_module.task:fields` injection that contributes the concrete `source` custom field.

Both hosts have stable IDs, typed contexts, translated labels, deterministic order, and visible fallback behavior when no contribution is registered. The example must use the current `InjectionPosition` and injection-data APIs from the installed UI package.

### Accessibility and design system

- All controls have labels; validation and conflict states are announced through existing shared components.
- Dialog behavior, if any remains after implementation minimization, supports Cmd/Ctrl+Enter to submit and Escape to cancel.
- Classes use semantic design-system tokens only: no hard-coded status shades, arbitrary values, raw hex/rgb, or unnecessary `dark:` overrides.
- No new primitive is introduced. Reuse the existing DataTable, CrudForm, page scaffolding, loading/error, badge, and banner families.

## Internationalization

All user-facing strings live under `reference_module.*` locale keys. The template ships English, German, Spanish, and Polish values with matching key sets. Internal-only errors use the `[internal]` prefix; visible errors route through translations. Focused validation includes both hard-coded-string and locale-value checks.

## Harness Regression

Implementation first adds a failing semantic case to the canonical harness case registry, using the next free case ID (expected `OMH-193`; re-evaluate at implementation time). The case gives the agent a generated lean app and asks it to add a small task-adjacent module capability with the installed `om-module-scaffold` workflow.

Acceptance asserts that the run:

- inspects `src/modules/reference_module` before `ratelimit_probe` or installed framework source;
- identifies `ratelimit_probe` as a test fixture, not a model;
- reuses only relevant reference surfaces and renames all stable IDs;
- keeps tenant scoping, optimistic locking, i18n, and generated-registry discipline intact;
- passes the focused generated-app validation commands.

This case is semantically distinct from OMH-185: OMH-185 judges the completeness of a built module, while the new case captures source selection and context-efficient reuse. Its primary failure-first fixture is a lean `empty` app, matching the observed failure. Add a `classic` selection variant or equivalent prompt-level assertion proving the agent prefers `reference_module` over the retained demo/QA `example` tree for new module scaffolding. If another case has landed with the same semantics, extend that case instead of allocating a duplicate ID.

### Harness registration surfaces

The new or deduplicated case is not complete merely because it exists in `cases.json`. Implementation must list and synchronize it everywhere its mode, validator, and release lane require:

| Harness surface | Required update |
|---|---|
| `packages/create-app/agentic/shared/ai/harness/cases.json` | Add the schema-valid case, semantic required/forbidden context, related cases, budgets, risk, and tags. |
| `packages/create-app/agentic/shared/ai/harness/validators.json` | Register the trusted validator or validator group that proves reference selection and renamed output. |
| `packages/create-app/agentic/shared/ai/harness/writable-ast-oracles.mjs` | Add the fixed writable oracle when the case produces module code; assertions must reject copied `reference_module` identifiers and unscoped/unguarded output. |
| `packages/create-app/agentic/shared/ai/harness/release-matrix.json` | List the case in the correct writable/review lane so the primary runner, generated validation, and isolated code review are blocking. |
| `packages/create-app/src/lib/agent-surface-coverage.test.ts` and focused evaluator/oracle tests | Assert routing, context, timeout/validator registration, and semantic oracle behavior without whole-output goldens. |
| Harness catalog counts, `packages/create-app/README.md`, harness `RELEASE.md`, and the owning harness spec | Update counts and case/range documentation together when the new ID changes the catalog totals. |
| Emitted/copied harness assets | Refresh through `om-evolve-harness` and `om-refresh-standalone-harness`; do not hand-edit generated copies. |

Before assigning an ID or editing any of these surfaces, compare current `develop` semantically and follow the catalog's existing case shape. This is a writable implementation case, so its fixed AST oracle, generated-app validation, and isolated review lane are mandatory rather than optional.

Use `om-evolve-harness` to add and prove the failure-first case, then `om-refresh-standalone-harness` to refresh affected ranges and generated copies. Run the affected certified lane after PR #4529; link issue #4670 as the broader multi-runner follow-up without claiming that issue complete.

The user-provided trace is PR evidence only. Do not commit the raw screenshot or local absolute paths into the repository.

## Testing and Validation

### Focused automated coverage

1. Preset unit tests for `empty`, `crm`, and `classic`: source and `om-module-scaffold` guidance exist, registration is absent, and the complete emitted source typechecks with imports resolved.
2. Template contract test: `ratelimit_probe` is still present and unchanged.
3. Reference-module API integration tests: create, list/filter, detail, update, delete, 403, cross-scope 404, invalid 400, and stale 409.
4. Command tests: side effects, event payloads, optimistic lock, soft delete, and undo/restore.
5. Enricher tests: list/detail parity, batching, namespacing, due buckets, scoping, and cache policy.
6. UI integration coverage: list/filter, create, edit, delete, conflict recovery, widget rendering, injected field persistence, keyboard behavior, and translated empty/error states.
7. Search test: indexing and scoped discovery after mutation.
8. Compile fixture: copy the template, explicitly register the module, run generation, and typecheck/build without applying local migrations.
9. Context-budget assertions for file count, total bytes, README size, and client-component line count.
10. Failure-first harness case and affected range refresh described above.

Every integration test creates its own tenant-scoped fixtures and removes them in `finally`; none relies on seeded/demo data.

### Validation sequence

Choose Docker or local mode once according to `.ai/docs/agent-instructions.md`, record the runner, then run the smallest applicable sequence:

```bash
yarn generate
yarn workspace create-mercato-app test
yarn check:client-boundaries
yarn typecheck
yarn lint
yarn test
yarn build:app
yarn i18n:check-hardcoded
yarn i18n:check-values
```

Also execute the focused harness case/range through its documented runner and include its result in the implementation PR evidence.

## Backward Compatibility

- No frozen or stable contract is removed, renamed, or reinterpreted.
- `ratelimit_probe`, classic `example`, existing preset names, generated registries, public imports, and current module-scaffold commands remain intact.
- `reference_module` identifiers are new template-local examples. Because the module is not registered, generated application runtime behavior is unchanged.
- Adding source to scaffold output is additive but observable; preset snapshot and size tests document that output contract.
- A future removal or rename of the emitted example must follow `BACKWARD_COMPATIBILITY.md`, including a bridge/deprecation period if third-party tooling has begun relying on its path.

## Risks & Impact Review

| Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| The reference grows into another oversized demo | Medium | Scaffold size and agent context | Enforce file/byte/client-line budgets and the bounded README contract. | Low; later additions still require review discipline. |
| Example and skill drift apart or the emitted skill disappears | High | Generated agent correctness | Keep one knowledge owner in `module-surfaces.md`; assert the skill in every preset; keep the README operational as a fallback; validate both through the harness. | Medium; cross-version package changes can still need coordinated refreshes. |
| Disabled source is accidentally activated | High | Generated-app runtime and migrations | Assert absence from every preset registry and verify no runtime routes, migrations, or navigation. | Low after preset contract tests. |
| Agents copy identifiers without renaming | Medium | Consumer module collisions | Use grep-friendly stable IDs, an explicit rename checklist, and harness assertions for residue. | Low; manual users can still ignore guidance. |
| “All surfaces” encourages weak placeholders | Medium | Architecture quality | Limit the example to a complete real vertical slice and route specialist capabilities to specialist skills. | Low while scope budgets are enforced. |
| Time-based enricher results become stale | Medium | API correctness | Namespace output and disable list-cache reuse for the enricher. | Low; clock-boundary tests remain necessary. |
| Encrypted content leaks through search | High | Data confidentiality | Mark only title as non-sensitive/searchable; encrypt description and exclude it from search documents, events, and logs. | Low after search-document assertions. |
| Harness duplicates OMH-185 or a concurrent case | Low | Test maintenance | Compare semantics first and reuse/extend an equivalent case if one lands concurrently. | Low. |
| Template size grows unexpectedly | Medium | Package and generated-app footprint | Snapshot emitted file inventory and enforce the 256 KiB budget. | Low; dependency size is unaffected because the source is disabled. |

## Implementation Plan

### Phase 1 — Lock the regression and reference contract

1. Add the failure-first harness case with the observed source-selection failure.
2. Add preset and context-budget tests that initially fail because `reference_module` is absent.
3. Confirm the next case ID and semantic uniqueness against current `develop`.

Exit criterion: failures prove both the missing local reference and the agent-selection regression.

### Phase 2 — Build the compact vertical slice

1. Scaffold `reference_module` using the installed `om-module-scaffold` workflow.
2. Implement the scoped entity, migration/snapshot, validators, custom field, commands/undo, ACL/setup, events, search, CRUD/OpenAPI, and enricher.
3. Implement DataTable/CrudForm pages, stable injection hosts/contributions, and four-locale i18n.
4. Add focused unit and integration coverage, then run `yarn generate`.

Exit criterion: the copied-and-enabled fixture passes API, command, UI, search, security, optimistic-lock, and generation checks within the size budgets.

### Phase 3 — Preserve source while keeping runtime disabled

1. Update preset-copy rules and snapshots so every built-in preset retains the tree.
2. Assert that no built-in `src/modules.ts` registers it.
3. Verify classic example and ratelimit-probe behavior remains unchanged.

Exit criterion: emitted source is universally available and runtime behavior is identical until explicit activation.

### Phase 4 — Align agent guidance and certify the harness

1. Update the scaffold skill's module-surfaces reference and the emitted bounded README.
2. Run the failure-first case to green through `om-evolve-harness`.
3. Refresh affected standalone harness ranges through `om-refresh-standalone-harness` and execute the relevant post-#4529 runner lane.
4. Capture sanitized evidence and link the broader #4670 follow-up.

Exit criterion: the agent selects the local reference, the harness is green, and generated skill copies are synchronized.

## Documentation and Rollout

- Document enable/copy/rename steps only in the emitted module README; keep normative module rules in the scaffold skill.
- Update the harness case catalog and generated copies through their owning workflows.
- Add an `UPGRADE_NOTES.md` entry only if implementation reveals an observable scaffold-output migration that warrants consumer action; no deprecation entry is expected for this additive, disabled source.
- Release with ordinary create-app changes. No feature flag, database rollout, or provider preconfiguration is required.

## Final Compliance Report

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/create-app/template/AGENTS.md`
- `.ai/docs/module-development.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/skills/om-spec-writing/references/spec-checklist.md`
- `.ai/skills/om-spec-writing/references/frontend-architecture-contract.md`

### Compliance Matrix

| Area | Result |
|---|---|
| Scope cohesion | Fresh-context review confirmed one capability: a compact local module reference plus the regression that guarantees agents use it. |
| Naming | `reference_module` is a deliberate teaching-fixture exception, not a new naming precedent for product modules. |
| Duplicate review | No covering OSS/enterprise spec, issue, or PR found; related historical work is linked. |
| Architecture | Disabled source preserves runtime behavior; scaffold skill is the single rules owner. |
| Security and tenancy | Explicit tenant/organization scoping, guarded writes, decryption helpers, ACL, and cross-scope 404 coverage. |
| Optimistic locking | `updated_at`, `updatedAt`, command guard, CrudForm-derived headers, delete coverage, and 409 UI recovery specified. |
| API and compatibility | Additive routes exist only after activation; no current contract is removed or renamed. |
| UI architecture | Server-first pages, bounded client islands, serializable props, shared component families, DS tokens, accessibility, and i18n specified. |
| Events/search/enrichers/widgets | Concrete registrations with real callers, stable identifiers, scoped data, and focused tests. |
| Testing | API and key UI paths, fixture isolation, preset contracts, frontend/context budgets, generator validation, and failure-first harness coverage included. |
| Harness registration | The writable case is required in the catalog, validator map, fixed AST oracle, release matrix, focused tests, counts/docs, and emitted copies. |
| Operational impact | No default runtime, migration, seed, route, navigation, or provider effect. |
| Open questions | None. Q1–Q4 use documented autonomous defaults and are reversible during review. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Task fields, scoping, encryption, versions, and CRUD responses align. |
| API contracts match UI/UX | Pass | DataTable and CrudForm consume the specified list/detail/mutation contracts and unified 409 behavior. |
| Risks cover write operations | Pass | Transactions, optimistic locking, soft deletion, undo, and event/search leakage risks are addressed. |
| Commands cover mutations | Pass | Create, update, delete, and restore use command and mutation-guard boundaries. |
| Cache behavior matches reads | Pass | Time-sensitive enricher output opts out of list-cache reuse; no new cross-tenant cache is introduced. |
| Harness registration matches the case mode | Pass | The case is explicitly writable and requires oracle, generated validation, and isolated review lanes. |

### Non-Compliant Items

None. `reference_module` is an approved teaching-fixture naming exception scoped to this disabled example; product modules remain subject to the normal plural-ID rule.

### Verdict

**Fully compliant — approved and ready for implementation after this design PR merges.**

## Changelog

- 2026-07-31: Initial draft based on the observed `ratelimit_probe` selection trace, repository/spec/tracker duplicate research, and the standalone harness merged in PR #4529.
- 2026-07-31: Renamed the proposed module to `reference_module`, documented the naming exception, and enumerated the harness catalog, validator, oracle, matrix, test, count, and generated-copy registration surfaces required for complete coverage.

### Review — 2026-07-31

- **Reviewer:** Agent, with an independent fresh-context scope-cohesion pass.
- **Scope cohesion:** Passed; the reference implementation and harness regression jointly deliver and verify one local golden-path capability, so no split is warranted.
- **Security:** Passed; the rename changes only proposed additive identifiers and preserves tenant/organization scoping, encryption, ACL, and safe-event requirements.
- **Performance:** Passed; explicit client-boundary, 300-line, heavy-dependency, provider, hydration, and build-evidence budgets are recorded.
- **Cache:** Passed; the time-sensitive enricher remains non-cacheable on list hits and no new cache surface is introduced.
- **Commands:** Passed; all proposed mutations retain command, undo, mutation-guard, and optimistic-lock requirements.
- **Risks:** Passed; harness registration drift and accidental naming-precedent risks are now explicit and testable.
- **Verdict:** Approved.
