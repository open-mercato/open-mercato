# Standalone Canonical Example Module

- **Status:** Draft
- **Date:** 2026-08-01
- **Scope:** OSS, standalone applications emitted by `create-mercato-app`
- **Related:** [Standalone AI Development Harness](./2026-07-24-standalone-ai-development-harness.md), [Standalone Agent Spec-First Routing](./2026-08-01-standalone-agent-spec-first-routing.md), [Standalone Harness Example-Read Policy](./2026-08-01-standalone-harness-example-read-policy.md), [Standalone Harness Knowledge Governance](./2026-08-01-standalone-harness-knowledge-governance.md), [Empty App Starter Presets](./2026-04-02-empty-app-starter-presets.md), merged PR [#4529](https://github.com/open-mercato/open-mercato/pull/4529), follow-up issue [#4670](https://github.com/open-mercato/open-mercato/issues/4670)

## TLDR

Fresh `empty` and `crm` standalone scaffolds delete the only comprehensive local `example` module but retain the narrow `ratelimit_probe` test fixture. Coding agents therefore mistake that probe for the app's reference implementation or spend context on installed framework source. Add one layered, compilable, disabled-by-default `reference_module` to every built-in scaffold as the comprehensive local golden path for standalone module skills, then add and fully register focused harness regressions proving agents select and reuse it without treating `ratelimit_probe` as an example.

The reference demonstrates a production-shaped vertical slice and a navigable source map for the complete standalone module surface: scoped data, custom fields and cross-module links, migrations and snapshots, defaults/example seeding, encryption, Data/Query Engine access, CRUD factory routes, commands, mutation guards and optimistic locking, events, search, response enrichers, imports/exports, cache, queues/workers/progress, notifications, DOM-event refresh, perspectives/filters, shared create/edit form definitions, and concrete injections into customers, catalog, and sales. It remains smaller and more intentional than the existing 134-file, 1.3 MiB classic demo/QA module, but no supported module layer may disappear from standalone agent guidance merely because its executable example is optional.

## Overview

This specification adds a source-only teaching module to the standalone application template and a regression that proves coding agents use it. The change deliberately combines the reference and its harness coverage because the local example is only valuable if emitted agents can discover it reliably, and the regression has no independent product behavior.

The feature is OSS developer infrastructure. It changes generated source inventory but does not enable a module, alter application runtime behavior, or require a database rollout.

## Resolved decisions

| # | Question | Decision | Rationale | Basis |
|---|---|---|---|---|
| Q1 | Reuse the existing classic `example` tree or add a separate reference? | Add a layered `reference_module`; keep the classic demo/QA module unchanged and still removed from lean presets. | The generic name makes the source-only teaching role unmistakable, while the existing tree is 134 files, tightly coupled to demo modules, and optimized for QA rather than systematic copying. | Existing PR decision retained |
| Q2 | Should the reference run by default? | Ship its source in every built-in preset but omit it from `src/modules.ts`. | Agents can inspect/copy it while runtime, migrations, navigation, seeds, and routes remain unchanged. | Existing PR decision retained |
| Q3 | Does “all module elements” mean every discovery surface? | Present every supported module/discovery surface in a versioned inventory. Implement the ordinary module, UI, UMES, security, data, async, and integration surfaces requested here as real, tested examples; route highly specialized AI/provider/workflow/portal branches to exact installed source and their specialist skills. | Empty placeholder files teach incorrect discovery behavior. A layered map plus executable golden paths gives agents complete coverage without copying the classic QA module. | Explicit user brief, 2026-08-01 |
| Q4 | Add a new harness case or expand an existing one? | Semantically deduplicate against all current cases first, especially OMH-185 and the existing module/UMES audits; extend them where possible and allocate the next free ID only for a genuinely new behavior. | The current catalog ends at OMH-192 and already includes broad discovery/UMES audits. Coverage quality matters more than reserving OMH-193. | Existing PR decision refined from current catalog evidence |

## Problem Statement

The starter preset resolver currently removes `src/modules/example` and `src/modules/example_customers_sync` from `empty` and `crm`, while the template's test-only `ratelimit_probe` directory remains. The attached agent trace shows the resulting behavior: the agent inspects `ratelimit_probe`, then falls back to installed package source for an example. This wastes context and exposes agents to a narrow fixture that was never designed as a reusable module blueprint.

## Proposed Solution

1. Add a comprehensive, layered `packages/create-app/template/src/modules/reference_module/` golden-path module built to the current standalone module, data, UI, and UMES contracts.
2. Keep it absent from every preset's `src/modules.ts`; preset application must preserve its source while continuing to remove the classic demo/QA modules from lean presets.
3. Give the module a progressive-disclosure README and exhaustive source map whose links use repository-relative file paths without line numbers, so links survive ordinary edits and agents load only the relevant files.
4. Make the standalone skills share that example: each skill owns its rules and links to the exact reference implementation rather than duplicating long snippets. Preserve or exceed the code-example coverage shipped on `main`.
5. Extend the standalone harness with failure-first regressions for source selection, skill/source-link coverage, and bounded example reads, then validate them through the normal harness release gates.
6. Deliver the user-requested global spec-first policy, generic example-read semantics, and harness/meta-skill governance through the three linked companion specs so each independently deployable capability has its own acceptance and rollout boundary.

## Scope Boundaries

### In scope

- A disabled, compilable, copy-and-rename reference module in all built-in standalone presets.
- One canonical CRUD/entity/UI slice plus real examples of custom fields, entity extensions, cross-module links, encryption, default/example seeding, migrations/snapshot sync, Data/Query Engine usage, imports/exports, cache, workers/queues/progress, notifications, DOM-event refresh, and the full UMES read/write extension path.
- Concrete widget/data contributions to customers, catalog, and sales, each degrading safely when its host module is absent.
- Standalone `om-module-scaffold`, `om-system-extension`, `om-backend-ui-design`, `om-data-model-design`, `om-eject-and-customize`, and harness-evolution guidance linked to exact example source files without line numbers.
- Emitted `AGENTS.md` ACL/migration operational notes. Spec-first routing is owned by the linked companion spec.
- Generator, preset, template, context-budget, skill-parity, and harness evaluator/regression coverage.
- Evidence and hand-off tied to merged PR #4529 and the existing harness evolution workflow.

### Out of scope

- Enabling the reference module or applying its migration in generated apps.
- Replacing or redesigning the classic `example` and `example_customers_sync` QA/demo modules.
- Removing or renaming `ratelimit_probe` or its API route.
- Implementing provider-specific integrations, full workflow engines, AI agents/tool packs, or portal authentication inside the reference module. These remain specialist branches but must appear in the source map with exact installed-source and skill links.
- Expanding issue #4670's multi-runner certification scope beyond the new affected-case lane.

### Harness-axis coverage boundary

This reference strengthens the `module-data`, `backend-ui`, `umes`, and cross-cutting runtime axes with a local, copyable vertical slice. The source map is exhaustive, while executable depth is intentionally tiered: ordinary module and requested cross-cutting surfaces are implemented locally; provider, AI/workflow, and portal-specialist surfaces link to exact installed sources and their specialist skills. Harness reports must distinguish “implemented in `reference_module`” from “routed to an authoritative installed example” and must never report either category as silently uncovered.

## Research and Existing-System Findings

### Repository findings

- `packages/create-app/src/lib/starter-presets.ts` removes `src/modules/example` and `src/modules/example_customers_sync` from the `empty` preset; `crm` inherits that removal.
- `packages/create-app/template/src/modules/ratelimit_probe/api/ping/route.ts` describes itself as a test-only rate-limit probe, yet it is the most visible surviving local module in lean scaffolds.
- The classic `example` module currently spans 134 files and approximately 1.3 MiB. It includes demo data, QA pages, and optional cross-module integrations, so restoring it to lean presets would work against their purpose.
- The installed `om-module-scaffold` workflow already owns the current rules for module composition and warns against speculative discovery surfaces. The missing piece is a small local implementation that those rules can point to.
- The standalone harness merged in PR #4529 now gives this regression a stable place to live. OMH-185 checks whether an agent can build a complete module; it does not check which local source the agent chooses as its reference.
- The current harness catalog contains 192 cases through OMH-192, including broad module-discovery and UMES audits. New work must extend those cases when semantics overlap instead of assuming OMH-193 is available or desirable.
- The standalone skills on `main` contain substantially more inline code examples than the compact layered skills on this branch. The new reference module can become their shared executable example, but only if a parity matrix proves that each former topic now has an exact, durable source link and a retained rule owner.
- `om-eject-and-customize` already belongs to the emitted core skill tier. It needs contract coverage and reference links, not a second implementation or a pasted copy of its legacy examples.
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
3. Demonstrate a coherent end-to-end CRUD, data, runtime, UI, and extension slice, including all requested cross-cutting mechanisms and integrations.
4. Keep module guidance maintainable by assigning each rule one knowledge owner.
5. Prevent recurrence with failure-first standalone harness coverage for source selection, reference-root registration, and skill/example parity.

### Measurable success criteria

- A generated `empty`, `crm`, or `classic` app contains `src/modules/reference_module/`, while no built-in preset registers `reference_module` in `src/modules.ts`.
- The reference tree is at most 80 source files and 512 KiB, its progressive-disclosure README is at most 12 KiB, its detailed surface map is at most 24 KiB, and no individual client component exceeds 300 lines.
- The module compiles and passes its focused tests when copied into an isolated fixture and explicitly enabled.
- The reference contains no `any`, raw `fetch`, hard-coded user-facing copy, direct cross-module ORM relationship, or unscoped tenant query.
- A module-scaffold harness run selects `reference_module` before `ratelimit_probe` or installed package source and produces a passing module from the reference.
- Existing preset snapshots and the existing ratelimit-probe test contract remain green.
- Every `capabilityId` in `surface-inventory.json` is represented in the source map by an exact repository-relative file link without a line anchor, an owning skill/guide, and one of `reference`, `authoritative-source`, or `specialist-route`; parity tests reject missing IDs, duplicate owners, dead links, and unreviewed removals.
- Relevant harness cases may read `src/modules/reference_module/**` through an explicit bounded policy; unrelated cases remain unable to traverse arbitrary application or framework source.

## Architecture

### Ownership and discovery

Normative rules remain in the relevant standalone skill references. The executable implementation and cross-skill index live in:

- `packages/create-app/template/src/modules/reference_module/README.md`
- `packages/create-app/template/src/modules/reference_module/references/surface-map.md`

`om-module-scaffold/references/module-surfaces.md` remains the entry owner and will:

- identify `src/modules/reference_module/README.md` as the emitted-app implementation map;
- explicitly state that `ratelimit_probe` is a test fixture, not a module blueprint;
- tell agents to copy only the surfaces required by the requested feature;
- route data design, backend UI, UMES, ejection/customization, cache/queue, and specialist branches to their owning skill;
- retain architecture, naming, generation, and validation rules so the emitted README and source map do not duplicate normative prose.

The base agentic bundle must continue to emit every named skill into its configured tier, including `om-eject-and-customize`. Preset contract tests verify the tier manifest, installed files, source links, and generated copies. The README remains useful without the agentic bundle: it contains purpose, enable/copy procedure, a short capability router, rename checklist, and activation commands. The larger surface map records the complete coverage matrix and links; neither file duplicates the rules from skills or package guides.

### Proposed module tree

```text
packages/create-app/template/src/modules/reference_module/
├── README.md
├── references/surface-map.md
├── references/surface-inventory.json
├── acl.ts
├── ce.ts
├── cli.ts
├── di.ts
├── encryption.ts
├── index.ts
├── notifications.ts
├── notifications.client.ts
├── notifications.handlers.ts
├── setup.ts
├── translations.ts
├── commands/
│   ├── tasks.ts
│   ├── interceptors.ts
│   └── __tests__/
│       └── tasks.test.ts
├── events.ts
├── search.ts
├── api/
│   ├── interceptors.ts
│   ├── imports/route.ts
│   └── tasks/
│       ├── route.ts
│       ├── [id]/route.ts
│       ├── [id]/restore/route.ts
│       └── [id]/links/
│           ├── route.ts
│           └── [linkId]/route.ts
├── data/
│   ├── entities.ts
│   ├── entity-id.ts
│   ├── validators.ts
│   ├── enrichers.ts
│   ├── extensions.ts
│   └── guards.ts
├── lib/
│   ├── task-cache.ts
│   └── task-import.ts
├── workers/
│   └── reference-task-import.ts
├── subscribers/
│   ├── reference-task-notifications.ts
│   └── reference-task-cache.ts
├── migrations/
│   ├── Migration<timestamp>.ts
│   └── .snapshot-open-mercato.json
├── backend/
│   ├── tasks/page.meta.ts
│   ├── tasks/page.tsx
│   ├── tasks/create/page.meta.ts
│   ├── tasks/create/page.tsx
│   ├── tasks/[id]/page.meta.ts
│   ├── tasks/[id]/page.tsx
│   └── components/
│       ├── ReferenceTasksTable.tsx
│       ├── ReferenceTaskForm.tsx
│       └── taskFormConfig.tsx
├── widgets/
│   ├── injection-table.ts
│   ├── components.ts
│   ├── notification-renderers.tsx
│   └── injection/
│       ├── customers-task-summary/
│       ├── catalog-task-health/
│       └── sales-task-actions/
├── i18n/
│   ├── en.json
│   ├── de.json
│   ├── es.json
│   └── pl.json
└── __tests__/
    ├── api.test.ts
    ├── async-runtime.test.ts
    ├── enrichers.test.ts
    └── extensions.test.ts
```

The tree is a contract inventory, not permission to create empty discovery files. Every listed file must have a real registration and caller. During implementation, compatible concerns may share a file when that is clearer and the surface-map/test contract is updated; discovery filenames required by the framework may not be renamed for tidiness.

### Canonical source-link inventory

Implementation begins with a parity inventory, not fresh invention. `references/surface-inventory.json` is the versioned finite oracle: each entry has a stable `capabilityId`, owner skill/guide, coverage kind (`reference`, `authoritative-source`, or `specialist-route`), and one or more exact paths. The complete implementation inventory is frozen to the IDs below. If the Phase 1 parity audit finds a genuinely missing discovery contract, implementation stops and amends this design spec before adding an ID; code review rejects implementation-time additions, removals, or collapsed IDs. `references/surface-map.md` renders that inventory for humans, links to completed `reference_module` files, and retains the following current repository examples where they show a deeper variant. Links are repository-relative and must not contain `#L...` line anchors.

The initial ID set is explicit and additive:

```text
module.metadata, module.registration, module.di, module.cli,
data.entity.task, data.entity.link, data.entity.undo-snapshot,
data.validators, data.custom-fields,
data.extension-links, data.encryption, data.migration, data.snapshot,
setup.acl, setup.role-sync, setup.defaults, setup.examples,
api.crud-factory, api.openapi, api.query-engine, api.import, api.export,
api.interceptors, commands.write, commands.undo, commands.interceptors,
commands.optimistic-lock, guards.mutation, enrichers.response,
query.enrichment, events.typed, events.subscriber, events.dom-bridge, search.index,
cache.read, cache.invalidation, queue.worker, progress.job,
notifications.type, notifications.renderer, notifications.handler,
ui.page-metadata, ui.list, ui.perspectives, ui.filters, ui.search,
ui.export, ui.form-shared, ui.conflicts,
widgets.hosts, widgets.headless-field, widgets.headless-column,
widgets.headless-filter, widgets.headless-row-action,
widgets.headless-bulk-action, widgets.headless-tab, widgets.headless-menu,
widgets.customers, widgets.catalog, widgets.sales,
widgets.component-replacement, overrides.unified,
overrides.ai-agents, overrides.ai-tools, overrides.ai-extensions,
overrides.routes-api, overrides.routes-pages, overrides.event-subscribers,
overrides.workers, overrides.widgets-injection, overrides.widgets-components,
overrides.widgets-dashboard, overrides.notification-types,
overrides.notification-handlers, overrides.api-interceptors,
overrides.command-interceptors, overrides.enrichers, overrides.guards,
overrides.cli, overrides.setup, overrides.acl-features, overrides.di,
overrides.encryption-maps,
i18n.locales, i18n.translatable-fields,
tests.unit, tests.integration,
frontend.page, portal.page, guards.page-middleware, widgets.dashboard,
search.vector, analytics.contribution, messages.contribution,
inbox.contribution, security.contribution, security.mfa-provider,
security.sudo-target, integrations.metadata,
integrations.domain-registry, integrations.ui-registry,
generators.extension-plugin,
specialist.ai, specialist.provider, specialist.workflow
```

IDs from `module.*` through `tests.*` in the list above require compiling executable reference code and a focused caller/test. The following `frontend.page` through `generators.extension-plugin` IDs use `authoritative-source`, and every `specialist.*` ID uses `specialist-route`; both require an installed owner plus an exact source file and may not claim local implementation. Additions use new IDs, while removals require an explicit compatibility review and spec amendment.

| Capability | Current authoritative examples to study | Result required in the reference |
|---|---|---|
| CRUD factory, Query Engine, commands | [`customers/api/people/route.ts`](../../packages/core/src/modules/customers/api/people/route.ts), [`customers/commands/people.ts`](../../packages/core/src/modules/customers/commands/people.ts), [`sales/commands/payments.ts`](../../packages/core/src/modules/sales/commands/payments.ts) | `makeCrudRoute`/CRUD factory reads, Data/Query Engine writes and reads, commands, guards, locking, undo, and safe side effects. |
| Perspectives, search, filters, export | [`customers/backend/customers/people/page.tsx`](../../packages/core/src/modules/customers/backend/customers/people/page.tsx), [`customers/components/formConfig.tsx`](../../packages/core/src/modules/customers/components/formConfig.tsx) | Customer-style controlled list view and shared create/edit form schema/field/group definitions. |
| Custom fields, links, enrichers, guards | [`customers/ce.ts`](../../packages/core/src/modules/customers/ce.ts), [`customers/data/extensions.ts`](../../packages/core/src/modules/customers/data/extensions.ts), [`customers/data/enrichers.ts`](../../packages/core/src/modules/customers/data/enrichers.ts), [`customers/data/guards.ts`](../../packages/core/src/modules/customers/data/guards.ts) | A persisted custom field, one ID-based cross-module extension/link, batched enrichers, and guarded writes with no cross-module ORM relation. |
| Encryption | [`customers/encryption.ts`](../../packages/core/src/modules/customers/encryption.ts) | Module encryption map, decrypting reads, and explicit exclusion from search/events/logs. |
| Setup, ACL sync, CLI, migration | [`customers/setup.ts`](../../packages/core/src/modules/customers/setup.ts), [`customers/cli.ts`](../../packages/core/src/modules/customers/cli.ts), [`customers migration`](../../packages/core/src/modules/customers/migrations/Migration20260602202147_customers.ts), [`customers snapshot`](../../packages/core/src/modules/customers/migrations/.snapshot-open-mercato.json) | Defaults/examples, feature grants and existing-role sync instruction, CLI registration, intended migration, JSON snapshot, and clean regeneration. |
| Import and export | [`sync_excel import route`](../../packages/core/src/modules/sync_excel/api/import/route.ts), [`example TodosTable`](../../packages/create-app/template/src/modules/example/components/TodosTable.tsx) | Bounded queued CSV import through commands/progress and filter-matched DataTable CSV export. |
| Cache, queue, worker, progress | [`catalog/lib/bulkDelete.ts`](../../packages/core/src/modules/catalog/lib/bulkDelete.ts), [`catalog/workers/catalog-product-bulk-delete.ts`](../../packages/core/src/modules/catalog/workers/catalog-product-bulk-delete.ts) | Tenant-tagged DI cache plus idempotent queued import with progress and post-commit invalidation. |
| Notifications and DOM-event bridge | [`sales/notifications.ts`](../../packages/core/src/modules/sales/notifications.ts), [`catalog/events.ts`](../../packages/core/src/modules/catalog/events.ts), [`catalog/components/products/ProductsDataTable.tsx`](../../packages/core/src/modules/catalog/components/products/ProductsDataTable.tsx) | Persistent notification/renderer/reactive handler and an audience-scoped `clientBroadcast` event consumed by `useAppEvent`. |
| Full UMES branches | [`example/api/interceptors.ts`](../../packages/create-app/template/src/modules/example/api/interceptors.ts), [`example/commands/interceptors.ts`](../../packages/create-app/template/src/modules/example/commands/interceptors.ts), [`example/data/guards.ts`](../../packages/create-app/template/src/modules/example/data/guards.ts), [`example/data/enrichers.ts`](../../packages/create-app/template/src/modules/example/data/enrichers.ts), [`example/widgets/components.ts`](../../packages/create-app/template/src/modules/example/widgets/components.ts) | API and command interceptors, mutation guards, enrichers, widget/data injections, and component replacement, all with concrete callers. |
| Unified overrides | [`template/src/modules.ts`](../../packages/create-app/template/src/modules.ts), [`unified-overrides.md`](../../packages/create-app/agentic/shared/ai/skills/om-system-extension/references/unified-overrides.md), [`TC-UMES-022`](../../packages/create-app/template/src/modules/example/__integration__/TC-UMES-022-overrides.spec.ts) | Typed activated-fixture override plus one inventory ID for every supported override domain/key family. |
| Cross-module widget injection | [`customer priority field`](../../packages/create-app/template/src/modules/example/widgets/injection/customer-priority-field/widget.ts), [`catalog SEO report`](../../packages/create-app/template/src/modules/example/widgets/injection/catalog-seo-report/widget.ts), [`sales todos`](../../packages/create-app/template/src/modules/example/widgets/injection/sales-todos/widget.ts), [`injection-table.ts`](../../packages/create-app/template/src/modules/example/widgets/injection-table.ts) | Three small, useful contributions targeting customers, catalog, and sales, plus absent-host behavior and stable IDs. |
| Notification/reactive examples | [`example/notifications.ts`](../../packages/create-app/template/src/modules/example/notifications.ts), [`example/notifications.handlers.ts`](../../packages/create-app/template/src/modules/example/notifications.handlers.ts) | Registered notification type, renderer, subscriber, and reactive client handler. |
| Frontend, portal, middleware, dashboard | [`example frontend page`](../../packages/create-app/template/src/modules/example/frontend/blog/[id]/page.tsx), [`portal page`](../../packages/core/src/modules/portal/frontend/[orgSlug]/portal/page.tsx), [`page-middleware generator`](../../packages/cli/src/lib/generators/extensions/page-middleware.ts), [`dashboard widget`](../../packages/create-app/template/src/modules/example/widgets/dashboard/todos/widget.ts) | Authoritative-source routes for public/portal pages, page middleware, portal guards/event bridge, and dashboard widgets; the backend reference does not claim to implement them. |
| Vector, analytics, messages, inbox | [`vector strategy`](../../packages/search/src/strategies/vector.strategy.ts), [`analytics generator`](../../packages/cli/src/lib/generators/extensions/analytics.ts), [`messages generator`](../../packages/cli/src/lib/generators/extensions/messages.ts), [`inbox-actions generator`](../../packages/cli/src/lib/generators/extensions/inbox-actions.ts) | Exact specialist/authoritative examples and owners for vector search, analytics, message renderers, and inbox actions. |
| Subscribers, query enrichment, translatable fields | [`events generator`](../../packages/cli/src/lib/generators/extensions/events.ts), [`enricher generator`](../../packages/cli/src/lib/generators/extensions/enrichers.ts), [`translatable-fields generator`](../../packages/cli/src/lib/generators/extensions/translatable-fields.ts) | Distinct inventory entries for subscribers, query/response enrichment, and translatable-field discovery. |
| Security, integration metadata/registries, generator plugins | [`auth ACL`](../../packages/core/src/modules/auth/acl.ts), [`generator plugin types`](../../packages/shared/src/modules/generators/types.ts), [`security generator fixture`](../../packages/cli/src/lib/generators/__tests__/module-subset.test.ts), [`integrations metadata`](../../packages/core/src/modules/integrations/index.ts), [`integration domain registry`](../../packages/core/src/modules/integrations/lib/registry-service.ts), [`integration UI registry`](../../packages/core/src/modules/integrations/backend/integrations/detail-page-widgets.ts), [`extension generator`](../../packages/cli/src/lib/generators/extension.ts) | Separate security ACL/MFA/sudo, integration metadata/domain/UI registry, and generator-extension/plugin routes. |

The final parity matrix also enumerates every topic formerly demonstrated by the `main` versions of `om-module-scaffold`, `om-system-extension`, `om-backend-ui-design`, `om-data-model-design`, and `om-eject-and-customize`. Each row maps to a `capabilityId`, names its rule owner, and has at least one working source link. “Equal or better” is deterministic: a `develop` row passes only when it preserves the `main` topic's decision rule and links to compiling/tested source for the same mechanism, or explicitly routes a specialist mechanism to its installed skill plus exact source. A topic cannot be deleted, generalized into “see the framework,” or linked only to a directory.

Exact discovery filenames must be reconciled with the generated app's installed package version during implementation. Generated registries are updated only through `yarn generate`; generated files are never edited by hand.

### Disabled-by-default boundary

The source directory is copied by the base template and preserved by all presets, but `reference_module` is absent from every generated `src/modules.ts`. Therefore it contributes no routes, navigation, entities, migrations, seeds, ACL grants, events, widgets, or search entries until a developer deliberately copies or registers it. TypeScript may still include the unregistered tree through generated-app globs, so every built-in preset must typecheck with the source present and all imports resolved; activation is not required for compilation.

Preset tests must assert both halves of this contract: source present, registration absent. The existing classic `example` behavior and `ratelimit_probe` behavior remain unchanged.

### Stable identifiers

The example uses stable, grep-friendly identifiers so agents can rename them mechanically:

| Surface | Identifier |
|---|---|
| Module | `reference_module` |
| ORM entity class | `ReferenceTask` |
| Generated/query/search entity ID | `reference_module:reference_task`; after activation, the generated accessor is `E.reference_module.reference_task` |
| Response-enricher `targetEntity` | `reference_module.reference_task` |
| Table | `reference_module_tasks` |
| ACL features | `reference_module.view`, `reference_module.manage`, `reference_module.import` |
| Events | `reference_module.reference_task.created`, `.updated`, `.deleted`, `.restored`; `reference_module.import.completed` |
| Widget host | `reference_module.reference_task.detail:summary` |
| CrudForm field host | `crud-form:reference_module.reference_task:fields` |

`reference_module` is an intentional teaching-fixture exception to the normal plural module-ID convention, analogous to the existing `example` special case. It must not be cited as permission to use singular IDs for product modules. The implementation must verify the exact enricher and widget ID syntax against the installed contracts rather than introducing a new convention.

The colon and dot forms are not interchangeable. `ReferenceTask` deterministically generates the registry entry `reference_module:reference_task`; once the module is registered and generation runs, its canonical accessor is `E.reference_module.reference_task` from `@/.mercato/generated/entities.ids.generated`. Only the response enricher's `targetEntity` uses the dot-form `reference_module.reference_task` as an entity identity; event and widget strings belong to their own explicitly named namespaces.

The disabled source tree has one necessary bootstrap exception. The entity-ID generator intentionally omits unregistered modules, and the existing #601 regression forbids disabled app modules from accessing their absent `E.<module>.*` members. Therefore `data/entity-id.ts` defines one source-only `REFERENCE_TASK_ENTITY_ID` with `entityId('reference_module', 'reference_task')` from `@open-mercato/shared/modules/dsl`; every CRUD/query/indexer, search, custom-field, DataTable, and CrudForm call site imports that constant rather than repeating a literal. The emitted README tells agents that an enabled copied module should run `yarn generate` and use its generated app-alias `E` accessor for new code. The activated fixture must assert `REFERENCE_TASK_ENTITY_ID === E.reference_module.reference_task`, prove the generated key exists, and exercise the list route, because generation, typecheck, and lint alone do not detect a semantically wrong but well-typed ID.

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

`ce.ts` demonstrates one local custom field, `source`, without creating an optional-module dependency. Validators are Zod-first and exported TypeScript types use `z.infer`.

`ce.ts` owns the custom-entity/custom-field declarations. `data/extensions.ts` demonstrates an additive cross-module link by storing the target module's UUID and a safe display snapshot, then declaring the supported link metadata. It never imports another module's ORM entity. The example shows how a customer, catalog item, or sales document may be associated by ID while retaining tenant/organization scope and safe behavior when the optional host module is not installed.

### `ReferenceTaskLink`

One module-owned polymorphic link entity supports the three optional host examples without three schemas or cross-module ORM relations:

| Column | Type | Requirements |
|---|---|---|
| `id` | UUID | Primary key |
| `tenant_id`, `organization_id` | UUID | Required scope copied from the task and verified on every write/read |
| `task_id` | UUID | Intra-module relation to `ReferenceTask`; cascade behavior is explicit in the migration |
| `target_kind` | enum/string | `customer`, `catalog_product`, or `sales_document` |
| `target_id` | UUID | Opaque foreign record ID; no cross-module ORM relation |
| `target_label_snapshot` | encrypted text, nullable | Server-derived display fallback; never accepted from the client and never emitted to events/logs/cache |
| `created_at`, `updated_at`, `deleted_at` | timestamps | Audit, locking, and soft-deletion fields |

The unique active-link key is `(tenant_id, organization_id, task_id, target_kind, target_id)`. A task has zero-to-many links. Host-specific widgets query by `target_kind + target_id`; they never infer target type from an ID or load another tenant's record. Creation validates host existence through a soft optional service/endpoint when that host is installed and derives the display snapshot server-side; when the host is absent it stores no snapshot. `defaultEncryptionMaps` encrypts the snapshot because customer/product/document labels may contain PII or business-sensitive text. The migration/snapshot and import format include this entity explicitly, while imports accept target IDs/kinds only and resolve snapshots server-side.

### `ReferenceTaskUndoSnapshot`

Undo metadata never places decrypted descriptions or link labels in the action log. A module-owned snapshot entity stores `id`, tenant/organization/task IDs, command ID/type, encrypted JSON `payload`, expected post-command version, `created_at`, `expires_at`, and `consumed_at`. The action log contains only the snapshot ID and non-sensitive entity/version metadata. Snapshot creation occurs inside the same transaction as the command write; undo loads it with tenant/organization scope through decryption helpers, checks expiry/consumption and the expected current version, applies the inverse command, and marks it consumed atomically. Snapshots expire after 30 days and are pruned by an idempotent worker. Tests prove ciphertext at rest, one-time use, scope/version/expiry rejection, log redaction, and no plaintext in errors or events.

`encryption.ts` exports `defaultEncryptionMaps` entries for task `description`, link `target_label_snapshot`, and the encrypted undo-snapshot payload described below. Direct ORM reads use `findWithDecryption`/`findOneWithDecryption`; equality lookup, if shown, uses a supported hash sibling rather than plaintext scanning. Tests prove ciphertext at rest and prove that events, notifications, cache entries, search documents, import errors, and logs never expose plaintext.

### Migration policy

The template includes the intended JSON-structured migration and current `.snapshot-open-mercato.json` so a copied-and-enabled module is internally consistent. Implementation updates the entity first, runs `yarn db:generate`, reviews the SQL/JSON structure diff, discards unrelated generated output, and verifies a second generation is clean. It never runs `yarn db:migrate` as part of the change without explicit approval.

`setup.ts` contains both idempotent hooks: `seedDefaults` creates only required configuration, while `seedExamples` creates clearly marked example tasks only when example seeding is requested. Neither hook performs work while the module is disabled. Default role grants are declared through the supported setup contract; the emitted README, template `AGENTS.md`, and `om-module-scaffold` all tell agents that after adding ACL features or grants to an existing app they must run `yarn mercato auth sync-role-acls`. The reference must not imply that modifying `acl.ts` alone updates existing roles.

## Command and API Contracts

### Command boundary

Create, update, delete, restore, link, and queued import writes flow through registered commands. Command handlers use `runCrudCommandWrite`/the Data Engine and shared CRUD primitives rather than raw ORM persistence, apply tenant and organization scope, enforce custom-field persistence, emit typed lifecycle events after commit, and return undo metadata. Update, delete, restore, and link changes enforce the client-provided record version through `enforceCommandOptimisticLock` or its DI-overridable guard service.

Undo is finite and version-aware: create undo soft-deletes the just-created task; update undo applies the encrypted pre-change snapshot; delete undo restores; restore undo re-deletes; link create/delete undo reverses only that link. Every undo resolves the scoped one-time `ReferenceTaskUndoSnapshot` pointer, checks the version produced by the original command, runs through the same guards, emits the corresponding lifecycle event, and invalidates after commit. Batch import has no global rollback: each successful row records its own encrypted snapshot pointer, while failure or cancellation leaves committed rows intact and reports them in the job summary.

Each interactive command uses the sanctioned `runCrudCommandWrite`/command transaction boundary with one transactional entity manager for the task/link mutation, custom-field rows, optimistic version, and undo-snapshot row. A rollback test proves none of those four persistence families commits independently. An import job uses one such transaction per row, never one unbounded transaction for the file.

After commit, the reference uses the command bus's existing best-effort side-effect flush for event publication, search indexing, cache invalidation, notification creation, and progress increments. It does not claim a durable outbox or exactly-once delivery that the current infrastructure does not provide. Handlers are idempotent by command/event key; cache entries have bounded TTL plus explicit invalidation, search remains recoverable through reindex, notifications deduplicate, and the progress job records/retries worker failures. Tests prove no side effect runs before a successful commit and duplicate delivery is harmless, while documentation states that process loss between commit and flush can require reconciliation.

`data/guards.ts` supplies a real mutation guard, `commands/interceptors.ts` supplies a real command interceptor, and `api/interceptors.ts` supplies a narrowly scoped before/after API interceptor. Their tests prove ordering, ACL wildcard handling, tenant isolation, rewritten input validation, response namespacing, and denial behavior. The UI never bypasses commands or guards. If an action mutates a linked target, it uses that target's own version header instead of reusing the parent task's version.

### HTTP API

| Method | Path | Purpose | Guard |
|---|---|---|---|
| `GET` | `/api/reference_module/tasks` | Scoped CRUD factory/Query Engine list, perspectives, filter tree, sort, search, and export | `reference_module.view` |
| `POST` | `/api/reference_module/tasks` | Create through command | `reference_module.manage` |
| `GET` | `/api/reference_module/tasks/:id` | Scoped detail | `reference_module.view` |
| `PUT` | `/api/reference_module/tasks/:id` | Optimistically locked update | `reference_module.manage` |
| `DELETE` | `/api/reference_module/tasks/:id` | Optimistically locked soft delete | `reference_module.manage` |
| `POST` | `/api/reference_module/tasks/:id/restore` | Optimistically locked restore through command | `reference_module.manage` |
| `GET` | `/api/reference_module/tasks/:id/links` | Scoped links for one task | `reference_module.view` |
| `POST` | `/api/reference_module/tasks/:id/links` | Add a validated optional-host link using the task version | `reference_module.manage` |
| `DELETE` | `/api/reference_module/tasks/:id/links/:linkId` | Remove a link using that link's own version | `reference_module.manage` |
| `POST` | `/api/reference_module/imports` | Validated CSV import request queued as a progress job | `reference_module.import` |

Routes use `makeCrudRoute`/the current CRUD factory, registered OpenAPI metadata, `parseQueryEngineFilters` or the current shared Query Engine parser, bounded page sizes, custom-field hydration, DataTable export, and the framework response/error shapes. List and detail responses return `updatedAt`. Invalid input returns the standard 400 contract, forbidden access returns 403, missing or cross-scope IDs return the same 404 shape, and stale mutations return the unified 409 optimistic-lock body. API handlers use shared request-scoping and response helpers; UI callers use `apiCall`/CRUD helpers, never raw `fetch`.

The import endpoint validates file metadata and enqueues an idempotent job; it does not parse an unbounded upload in the request. The worker validates every row with the same Zod schema, invokes commands for writes, reports progress and row-level failures, and supports safe retry through an idempotency key. The list view demonstrates the supported DataTable export URL builder. Import/export examples remain format-focused and do not preconfigure a provider.

The import request uses `multipart/form-data` with one UTF-8 CSV file (maximum 2 MiB and 5,000 data rows) plus an `Idempotency-Key` header. Required headers are `title`; optional headers are `description`, `status`, `priority`, `dueAt`, `isActive`, `source`, `targetKind`, and `targetId`; unknown headers or invalid encoding fail before enqueue. A 202 response returns `{ jobId, status: 'pending', totalCount }`; duplicate keys return the original response, 400 covers schema/row-count errors, and 413 covers byte limits. Job detail and cancellation reuse the platform progress APIs (`GET` and `DELETE /api/progress/jobs/:id`) and their `progress.view`/`progress.cancel` permissions rather than inventing module-local status routes. Cancellation stops before the next row, preserves already committed command writes, and returns `{ totalCount, processedCount, succeededCount, failedCount, skippedCount, status }` through the progress job; retry skips rows already committed under the same import/row idempotency key.

List responses use `{ items, total, page, pageSize }`; each item includes `id`, editable fields, link summaries, custom fields, enrichment, and `updatedAt`. Export streams at most 10,000 rows as `text/csv; charset=utf-8` with `Content-Disposition`, uses the same scoped filters/sort/safe-column allowlist, returns 413 when the selected result exceeds the cap, and always excludes encrypted description/link labels. Create/update accepts `title` (1–200 characters), optional `description` (at most 10,000), status enum, integer priority 0–5, nullable ISO `dueAt`, `isActive`, and custom fields through the shared Zod schema. Update/delete/restore require the standard optimistic-lock header. Restore returns the current task representation with a new `updatedAt`.

Link creation accepts only `{ targetKind, targetId }` and requires the task's version in the standard optimistic-lock header; the server resolves/encrypts any display snapshot. Its 201 response returns the link plus its own `updatedAt` and the task's new version, exposing a decrypted label only to authorized scoped readers. Link deletion uses the link's `updatedAt` in that header and returns the task's refreshed link summary/version. Host widgets query a small scoped `GET /api/reference_module/tasks?linkTargetKind=...&linkTargetId=...` projection through the same Query Engine/interceptor path rather than adding an unguarded cross-module lookup route.

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

## Runtime Services, Events, and Setup

- `events.ts` uses `createModuleEvents` for created, updated, deleted, restored, and import completion. Events contain IDs and safe snapshots only; encrypted values and credentials are excluded. The module event `reference_module.import.completed` carries `{ jobId, status, totalCount, processedCount, succeededCount, failedCount, skippedCount }`, with status limited to `completed`, `partial`, `cancelled`, or `failed`; row values and error text are excluded. Per-row progress uses the platform progress event contract rather than a second module event. The safe task-change event sets `clientBroadcast: true` with an explicit tenant/organization/user audience and is consumed by `useAppEvent` to refresh the affected view without a polling loop.
- `search.ts` registers the shared `REFERENCE_TASK_ENTITY_ID`; the activated fixture proves it equals `E.reference_module.reference_task` from the standalone app alias. Search indexes only explicitly non-sensitive title/status data through the supported search contract and scopes indexing and query operations. Encrypted descriptions are never indexed.
- `acl.ts` declares immutable view/manage/import features. Runtime permission checks, notifications, guards, interceptors, menus, and widgets use wildcard-aware feature matching. Tests cover exact grants, wildcard grants, denials, and optional-host absence.
- `setup.ts` registers features/default grants and the idempotent default/example seeds described above. A reference disabled by default stays side-effect free after generation.
- `di.ts` registers cache and task-domain helpers behind stable module-local keys. Consumers resolve abstractions; they do not construct Redis, SQLite, queue, or event implementations directly.

### Cache and background work

Task list/detail reads demonstrate the configured cache abstraction with keys and invalidation tags that include tenant and organization. No decrypted description is stored in a shared cache entry. Successful create/update/delete/restore/import commands invalidate tags after commit; undo and subresource writes invalidate the same families. Cache tests prove tenant isolation, hit/miss behavior, invalidation, and safe degradation when the configured strategy is memory, SQLite, or Redis.

The import worker uses the module queue contract, bounded I/O concurrency, idempotent jobs, progress reporting, retry-safe command writes, and cancellation/error summaries. It must not create a custom queue or perform CPU-heavy work in the request process. `useOperationProgress` may render durable progress in the top bar while the DOM bridge refreshes the task table on safe completion events.

### Notifications

A subscriber turns a meaningful task transition (entering `in_progress`, reaching `done`, or import completion) into an in-app notification through the registered notification type. The module includes a renderer, a reactive `notifications.handlers.ts` handler, and `useNotificationEffect` usage for the appropriate client refresh/action. Deduplication keys, audience, ACL checks, translated copy, links, and encrypted-field exclusion are explicit. Tests cover creation, deduplication, renderer payload, wildcard permission, reactive cleanup, and absent optional targets.

## UI and Extension Contracts

### Pages and component boundaries

The list page follows the customers people/deals view structure rather than a simplified table. It renders the shared `DataTable` with controlled server-backed search, sort, pagination no larger than 100, URL-persisted state, `useAutoDiscoveredFields`, custom-field columns, an advanced filter tree, and a stable `perspective.tableId`. It exposes the supported export action, stable row/bulk-action IDs, loading/error states, translated empty copy, and injected columns/filters/actions. Search is debounced and represented in the URL; perspective changes rehydrate compatible columns, filters, and sort without losing tenant scope.

Create and edit pages use a shared `ReferenceTaskForm` built on `CrudForm`. `taskFormConfig.tsx` is the single owner of the Zod schema, field descriptors, groups, custom-field host, and normalization shared by create/edit and any quick-create dialog. Page-specific code supplies only initial values, mode, ACL, and mutation callbacks. Duplicate create/edit form definitions fail the focused architecture test.

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

### Widget and UMES examples

The module demonstrates both sides of stable local contracts and contributions into other modules:

1. Local hosts at `reference_module.reference_task.detail:summary` and `crud-form:reference_module.reference_task:fields`, with a real due/status summary and persisted `source` custom field.
2. A customers contribution that injects a task summary or action into the customer catalog/detail surface and reads linked tasks through a scoped endpoint/enricher.
3. A catalog contribution that injects task health into a product surface without importing the catalog ORM entity.
4. A sales contribution that injects task actions into a document/deal surface and uses the target record's own lock/version when it triggers a target mutation.
5. Headless DataTable column, filter, row-action, bulk-action, field, tab/detail, and menu contributions using current `InjectionPosition`/injection-data APIs.
6. One concrete component replacement/wrapper through `widgets/components.ts`, narrow enough to demonstrate replace/wrapper/props semantics without replacing global application chrome.
7. One typed `entry.overrides` example in the activated fixture's `src/modules.ts` that disables the reference API interceptor by stable ID and proves the base route remains active. The surface map links every other unified override domain to `om-system-extension/references/unified-overrides.md`; a module-local file does not pretend to own app registration.

Every contribution has a stable ID, typed context, translated label, deterministic order, feature guard, and a documented host source link. Optional hosts are resolved softly and never make `reference_module` depend on customers, catalog, or sales at startup. Integration tests enable each host independently, verify the contribution, and verify the reference still boots when all three are absent.

The UMES surface map explicitly covers widget injection, component replacement, API interceptors, command interceptors, mutation guards, response enrichers, entity extensions/cross-module links, unified module overrides, and generated/discovered registration. It labels read-only versus write-capable branches and points to the guard/command/locking path for every write-capable example.

### Accessibility and design system

- All controls have labels; validation and conflict states are announced through existing shared components.
- Dialog behavior, if any remains after implementation minimization, supports Cmd/Ctrl+Enter to submit and Escape to cancel.
- Classes use semantic design-system tokens only: no hard-coded status shades, arbitrary values, raw hex/rgb, or unnecessary `dark:` overrides.
- No new primitive is introduced. Reuse the existing DataTable, CrudForm, page scaffolding, loading/error, badge, and banner families.

## Internationalization

All user-facing strings live under `reference_module.*` locale keys. The template ships English, German, Spanish, and Polish values with matching key sets. Internal-only errors use the `[internal]` prefix; visible errors route through translations. Focused validation includes both hard-coded-string and locale-value checks.

## Standalone Skill-to-Example Contract

The implementation compares the installed `develop` skills with the richer code-example topics present on `origin/main`. It records a checked parity table in the reference surface map and focused tests. At minimum:

| Skill | Rules it continues to own | Exact example families it must link |
|---|---|---|
| `om-module-scaffold` | Planning, naming, discovery, registration, generation, ACL sync, migration workflow, validation | Module metadata/index/DI, entity/validators, setup/seeds, ACL, events/search/CLI/translations, migration/snapshot, CRUD/OpenAPI, commands, cache/queue. |
| `om-data-model-design` | Schema choices, tenant integrity, relationships, encryption, migration safety | `entities.ts`, `ce.ts`, `encryption.ts`, `data/extensions.ts`, validators, migration and snapshot, especially ID-based cross-module linking. |
| `om-backend-ui-design` | Page/component boundaries, DataTable/CrudForm usage, accessibility, DS/i18n, mutation safety | Customer-style list/perspective/filter/search/export view, shared form config, create/edit pages, conflicts, injections, loading/error/notification UI. |
| `om-system-extension` | Mechanism selection, read/write round trip, guards, ordering, optional hosts, unified overrides | API/command interceptors, guards, enrichers, entity links, widget/headless injections, component wrapper/replacement, customers/catalog/sales examples. |
| `om-eject-and-customize` | Extend-vs-eject decision, preflight, copied-file boundaries, customization log, upgrade responsibilities | Links to the extension examples first, then exact safe-ejection/customization files; it must remain emitted in the core tier and be contract-tested. |
| `om-evolve-harness` and repo-local `om-refresh-standalone-harness` | Case ownership, generation, certification, synchronization | Reference case/root registration, output oracles, release matrix, generated copies, counts, and docs; generic read semantics remain in their companion spec. |

Skills link to files, not line numbers and not only directories. Short snippets may remain when they define syntax or a decision rule, but large copied implementations move to `reference_module`. Tests parse every Markdown link, resolve it in both template-source and emitted-app layouts where applicable, and reject dead paths. The parity gate fails if a topic available on `main` has neither a retained rule nor an equal-or-better executable/authoritative example on `develop`.

`om-eject-and-customize` must lead with extension-first guidance: use UMES, overrides, widgets, guards, enrichers, or app-owned modules while the contract suffices; eject only when the package implementation itself must change. Its decision table, preflight, customization log, safe/danger zones, upgrade procedure, and concrete scenarios remain discoverable after the rewrite.

## Harness Regression

Implementation first audits and extends the canonical harness registry, currently 192 cases through OMH-192. It does not reserve OMH-193. It updates an existing case when the intent already belongs to the module-discovery or UMES audit and allocates the next free ID only for an independently runnable behavior.

The source-selection behavior gives the agent a generated lean app and asks it to add a small task-adjacent module capability with the installed workflow. Acceptance asserts that the run:

- inspects `src/modules/reference_module` before `ratelimit_probe` or installed framework source;
- identifies `ratelimit_probe` as a test fixture, not a model;
- reuses only relevant reference surfaces and renames all stable IDs;
- keeps tenant scoping, optimistic locking, i18n, and generated-registry discipline intact;
- passes the focused generated-app validation commands.

“Inspects before” is evaluated from the runner's ordered file-read/tool trace: for a module-scaffold prompt, the first module-source read must be `src/modules/reference_module/README.md`; any read under `ratelimit_probe` fails; installed package source is allowed only after the trace records a specific missing-version gap not covered by the inventory. The output oracle separately rejects copied `reference_module` identifiers and requires the expected renamed files/contracts, so mentioning the README without using it does not pass.

Additional failure-first coverage proves:

- every named standalone skill reaches all parity-matrix topics and exact example files without stale links or copied line anchors;
- data design finds encryption, custom fields, migration/snapshot, example/default seeds, and cross-module ID/link examples;
- backend UI finds the customer-style perspective/filter/search/export view and shared create/edit form configuration;
- system extension finds every UMES scope and the customers/catalog/sales injection examples;
- module scaffold finds ACL sync, JSON migration/snapshot sync, cache, worker/queue/progress, notifications, DOM bridge, import/export, Data/Query Engine, CRUD factory, commands, guards, and locking;
- eject/customize is emitted, selects extensions before ejection, and retains its customization/upgrade procedure.

The source-selection behavior is distinct from OMH-185's generated-module completeness assertion, but may belong in an existing discovery audit. Its primary fixture is a lean `empty` app. A `classic` variant or equivalent assertion proves preference for `reference_module` over the retained demo/QA tree. Semantic deduplication is mandatory before adding any case.

### Bounded example-read policy

The linked [Standalone Harness Example-Read Policy](./2026-08-01-standalone-harness-example-read-policy.md) exclusively owns generic schema, evaluator, path-safety, budget, and fallback semantics. This spec consumes that policy by registering `src/modules/reference_module` for relevant `module-data`, `backend-ui`, `umes`, and architecture/ejection cases, with README/surface-map entrypoints and the exact `capabilityId` subset needed by each prompt. Reading those examples is expected, not a context violation; unrelated capabilities and cases remain denied.

Case registration, fixed output oracles, and focused reference-selection tests must agree on this progressive route. Generic multi-file, unrelated-case, traversal, and fallback fixtures remain in the owning companion; this spec tests only that each reference case declares the right root/entrypoints/capability IDs/budgets and uses them in the ordered trace.

### Harness registration surfaces

The new or deduplicated case is not complete merely because it exists in `cases.json`. Implementation must list and synchronize it everywhere its mode, validator, and release lane require:

| Harness surface | Required update |
|---|---|
| `packages/create-app/agentic/shared/ai/harness/cases.json` | Add the schema-valid case, semantic required/forbidden context, related cases, budgets, risk, and tags. |
| `packages/create-app/agentic/shared/ai/harness/validators.json` | Register the trusted validator or validator group that proves reference selection and renamed output. |
| `packages/create-app/agentic/shared/ai/harness/writable-ast-oracles.mjs` | Add the fixed writable oracle when the case produces module code; assertions must reject copied `reference_module` identifiers and unscoped/unguarded output. |
| `packages/create-app/agentic/shared/ai/harness/release-matrix.json` | List the case in the correct writable/review lane so the primary runner, generated validation, and isolated code review are blocking. |
| Reference case `exampleRoots`, `packages/create-app/src/lib/agent-surface-coverage.test.ts`, and focused output/trace tests | Assert exact entrypoints/capability IDs/budgets, skill links, validator registration, and reference use without redefining generic read semantics. |
| Harness catalog counts, `packages/create-app/README.md`, harness `RELEASE.md`, and the owning harness spec | Update counts and case/range documentation together when the new ID changes the catalog totals. |
| Emitted/copied harness assets | Refresh through `om-evolve-harness` and `om-refresh-standalone-harness`; do not hand-edit generated copies. |

Before assigning an ID or editing any of these surfaces, compare current `develop` semantically and follow the catalog's existing case shape. This is a writable implementation case, so its fixed AST oracle, generated-app validation, and isolated review lane are mandatory rather than optional.

Use the current owning harness workflows to make this reference-specific change; do not hand-edit derived copies. The generic requirement that future harness-knowledge changes always update evaluator/read-policy coverage belongs to the linked [Standalone Harness Knowledge Governance](./2026-08-01-standalone-harness-knowledge-governance.md) companion and is not a completion dependency for building the reference itself.

The user-provided trace is PR evidence only. Do not commit the raw screenshot or local absolute paths into the repository.

## Testing and Validation

### Focused automated coverage

1. Preset unit tests for `empty`, `crm`, and `classic`: source and `om-module-scaffold` guidance exist, registration is absent, and the complete emitted source typechecks with imports resolved.
2. Template contract test: `ratelimit_probe` is still present and unchanged.
3. Reference-module API integration tests: create, list/filter/search/perspective/sort/export, detail, update, delete, import enqueue, 403, wildcard ACL, cross-scope 404, invalid 400, and stale 409.
4. Command/UMES tests: Data Engine writes, custom fields, API/command interceptors, mutation guards, event ordering/payloads, optimistic lock, soft delete, undo/restore, and target-specific child lock headers.
5. Enricher/extension tests: list/detail parity, batching, namespacing, due buckets, tenant scope, ID-based cross-module links, absent optional modules, and cache behavior.
6. UI integration coverage: customer-style URL search/filter/perspective/export state, auto-discovered fields, create/edit shared form descriptors, delete/conflict recovery, injected field persistence, DataTable headless contributions, local and customers/catalog/sales widgets, component wrapper, keyboard behavior, and translated empty/error states.
7. Search/encryption tests: scoped indexing after mutation, ciphertext at rest, decrypting reads, and no plaintext in search/events/notifications/cache/logs.
8. Runtime tests: tenant-tagged cache hit/invalidation, idempotent queue retry, progress/cancellation/error summary, command-mediated import rows, notification dedupe/render/effect cleanup, and audience-scoped DOM-event refresh.
9. Setup/migration tests: idempotent defaults, opt-in example seeds, new-tenant grants, existing-role ACL sync documentation, intended SQL/JSON snapshot, and clean second generation.
10. Compile fixture: copy the template, explicitly register the module, run generation, and typecheck/build without applying local migrations.
11. Generated-ID runtime contract: keep the disabled tree free of absent `E.reference_module.*` access, assert its single `REFERENCE_TASK_ENTITY_ID` equals `E.reference_module.reference_task === 'reference_module:reference_task'` after activation, use the `@/.mercato/generated/entities.ids.generated` alias rather than package-internal `#generated` imports in that activated proof, reserve `reference_module.reference_task` as an entity identity for the enricher, and load the list endpoint without an entity-resolution 500.
12. Skill/source-link parity tests: every former `main` topic has an owner and exact live example, all links are line-number-free and resolve in source/emitted layouts, all tiered skills including eject/customize are emitted, and `AGENTS.md` stays within budget.
13. Context-budget assertions for file count, total bytes, README/surface-map size, and client-component line count.
14. Failure-first source-selection, skill-coverage, and reference-root registration tests described above, including fail-before evidence and affected range refresh.

Every integration test creates its own tenant-scoped fixtures and removes them in `finally`; none relies on seeded/demo data.

### Validation sequence

Choose Docker or local mode once according to `.ai/docs/agent-instructions.md`, record the runner, then run the smallest applicable sequence:

```bash
yarn generate
yarn workspace create-mercato-app test
yarn agents:check-budget
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
| Example and skill drift apart or an emitted skill disappears | High | Generated agent correctness | Keep one rule owner per domain, one executable/link index in the surface map, assert tiers and exact links in every preset, and validate the routes through the harness. | Medium; cross-version package changes can still need coordinated refreshes. |
| Disabled source is accidentally activated | High | Generated-app runtime and migrations | Assert absence from every preset registry and verify no runtime routes, migrations, or navigation. | Low after preset contract tests. |
| Agents copy identifiers without renaming | Medium | Consumer module collisions | Use grep-friendly stable IDs, an explicit rename checklist, and harness assertions for residue. | Low; manual users can still ignore guidance. |
| Colon/dot identifiers or the class-derived entity key drift | High | CRUD list/search resolution and enricher matching | Centralize the disabled-source ID through `entityId('reference_module', 'reference_task')`, prove equality with `E.reference_module.reference_task` after activation, reserve the dot form for `targetEntity`, and exercise the activated list route at runtime. | Low; future generator changes still require the focused contract test to fail visibly. |
| “All surfaces” encourages weak placeholders | High | Architecture quality | Require a real registration/caller for local files and an exact authoritative link plus owner for routed specialist surfaces; reject placeholders in tests. | Low while parity and focused runtime tests are enforced. |
| Time-based enricher results become stale | Medium | API correctness | Namespace output and disable list-cache reuse for the enricher. | Low; clock-boundary tests remain necessary. |
| Cache or queued work crosses tenant boundaries or repeats side effects | High | Data confidentiality and integrity | Tenant/org keys and tags, post-commit invalidation, idempotency keys, command-mediated writes, retry and isolation tests. | Low after multi-tenant runtime coverage. |
| DOM events or notifications expose sensitive data/audiences | High | Confidentiality | Safe payload schemas, explicit audiences, ACL checks, encrypted-field exclusion, renderer/effect tests. | Low after audience and leakage assertions. |
| Skills link to stale or shallow examples | High | Generated-agent correctness | Resolve every exact link in source and emitted layouts and maintain a `main` parity matrix. | Low; new surfaces still require harness refresh discipline. |
| Spec-first routing blocks bounded maintenance or is bypassed implicitly | Medium | Developer velocity and architecture | Test new-feature, maintenance, explicit-override, and ambiguous-intent branches independently. | Low. |
| Encrypted content leaks through search | High | Data confidentiality | Mark only title as non-sensitive/searchable; encrypt description and exclude it from search documents, events, and logs. | Low after search-document assertions. |
| Harness duplicates OMH-185 or a concurrent case | Low | Test maintenance | Compare semantics first and reuse/extend an equivalent case if one lands concurrently. | Low. |
| Template size grows unexpectedly | Medium | Package and generated-app footprint | Snapshot emitted file inventory and enforce the 512 KiB budget. | Low; dependency size is unaffected because the source is disabled. |

## Implementation Plan

### Phase 1 — Establish the inert template and finite inventory

1. Build the current `main`-to-`develop` topic inventory, add `surface-inventory.json`, the bounded README/map, and the minimal compilable unregistered module metadata/index shell.
2. Add preset, registration-absence, tier-presence, exact-link, and context-budget tests; capture each failure before adding the matching source/preset change, then make the focused test green in the same step.
3. Preserve the source in `empty`, `crm`, and `classic`, while proving classic example and ratelimit probe behavior unchanged.

Exit criterion: all preset/link/budget tests are green, every emitted app contains a compilable inert reference shell, and no preset activates it.

### Phase 2 — Land the scoped CRUD golden path

1. Add task/link entities, validators, custom fields, encryption map, migration/JSON snapshot, defaults/example seeds, ACL/DI, entity-ID bridge, and CLI metadata.
2. Implement CRUD factory/Query Engine routes, Data Engine commands, link writes, guards/interceptors, optimistic locking, finite undo, enrichers, events/search, and OpenAPI contracts.
3. Add and pass focused API/security/command/migration/seed/activated-ID tests, run generation, and prove a clean second migration generation.

Exit criterion: the enabled fixture passes the complete scoped CRUD/domain contract and the disabled preset remains inert.

### Phase 3 — Land async runtime examples

1. Add export, bounded/idempotent import, cache/invalidation, queue worker/progress integration, notifications, and audience-scoped DOM events.
2. Add failure/cancellation/partial-success, retry, leakage, tenant-isolation, notification, and event-refresh tests as each mechanism lands.
3. Keep every step green by using the existing platform progress API and command boundary rather than adding temporary module-local contracts.

Exit criterion: focused async/runtime tests and the Phase 2 suite are green, including retry and cancellation behavior.

### Phase 4 — Land customer-grade UI and UMES extensions

1. Implement the customers-style DataTable view with perspectives, advanced filters, search, URL state, auto-discovered fields, export, and shared create/edit CrudForm configuration.
2. Add local hosts, headless injections, component wrapping, and the typed activated-fixture override example.
3. Add and pass integration coverage for customers, catalog, and sales contributions independently, all hosts absent, locking/conflicts, progress/notification refresh, accessibility, and i18n.

Exit criterion: API and key UI paths are green in every optional-host matrix and all earlier phase suites remain green.

### Phase 5 — Synchronize skill links and reference-specific harness coverage

1. Update module, data, UI, extension, and eject/customize skills with exact line-number-free inventory links; add ACL/migration operational guidance to emitted `AGENTS.md` and verify instruction budgets/generated tiers.
2. After the example-read-policy companion lands, semantically deduplicate the 192-case catalog, then pair each failing source-selection/skill-coverage/reference-root registration assertion with its implementation and make it green before the next step.
3. Synchronize affected case `exampleRoots`, catalog, validator/oracle, release matrix, counts/docs, and generated copies through the owning workflows.

Exit criterion: every inventory capability has one owner and a working link; the agent selects and uses the reference; every affected case registers the exact root/entrypoints/capability IDs/budgets; all reference-specific tests are green. Generic read semantics and harness-workflow policy changes proceed independently under their companion specs.

### Phase 6 — Certify the emitted app

1. Run the activated compile/runtime fixture, preset matrix, focused integration/UI suite, instruction/link budgets, and the full configured validation gate.
2. Run the affected certified harness lane through the owning skills and capture sanitized evidence.
3. Re-read the complete diff for placeholders, scope drift, dead links, stale generated copies, and accidental activation.

Exit criterion: all configured gates and affected harness lanes are green, with no default runtime change and no unsupported surface omitted.

## Documentation and Rollout

- Document enable/copy/rename steps and the short capability router in the emitted README; keep normative rules in their owning skills and exhaustive ownership/source links in the surface map.
- Update the harness case catalog and generated copies through their owning workflows.
- Update emitted `AGENTS.md` with ACL sync and migration/snapshot routing while staying inside its instruction budget; the companion spec owns spec-first policy.
- Add an `UPGRADE_NOTES.md` entry only if implementation reveals an observable scaffold-output migration that warrants consumer action; no deprecation entry is expected for this additive, disabled source.
- Release with ordinary create-app changes. No feature flag, database rollout, or provider preconfiguration is required.

## Final Compliance Report

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/create-app/template/AGENTS.md`
- `.ai/docs/module-development.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/search/AGENTS.md`
- `packages/cli/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/skills/om-spec-writing/references/spec-checklist.md`
- `.ai/skills/om-spec-writing/references/frontend-architecture-contract.md`

### Compliance Matrix

| Area | Result |
|---|---|
| Scope cohesion | Independent review confirmed the comprehensive inert reference, direct skill links/preset boundary, and focused harness proof form one developer-infrastructure capability. Spec-first, generic example-read semantics, and generic harness governance are split into one-way companion specs. |
| Naming | `reference_module` is a deliberate teaching-fixture exception, not a new naming precedent for product modules. |
| Duplicate review | No covering OSS/enterprise spec, issue, or PR found; related historical work is linked. |
| Architecture | Disabled source preserves runtime behavior; each domain has one skill/guide rule owner, while the shared reference owns executable examples and links. |
| Security and tenancy | Explicit tenant/organization scoping, guarded writes, decryption helpers, ACL, and cross-scope 404 coverage. |
| Optimistic locking | `updated_at`, `updatedAt`, command guard, CrudForm-derived headers, delete coverage, and 409 UI recovery specified. |
| API and compatibility | Additive routes exist only after activation; no current contract is removed or renamed. |
| UI architecture | Server-first pages, bounded client islands, serializable props, shared component families, DS tokens, accessibility, and i18n specified. |
| Events/search/enrichers/widgets | Concrete registrations with real callers, stable identifiers, scoped data, customers/catalog/sales integrations, and focused tests. |
| Data/runtime breadth | Custom fields, ID-based links, encryption, JSON migration/snapshot, default/example seeding, Data/Query Engine, import/export, cache, queue/worker/progress, notifications, and DOM bridge are all executable and tested. |
| UMES breadth | API/command interceptors, guards, enrichers, entity extensions, headless/widget injections, component replacement, optional hosts, and unified overrides are indexed and exercised. |
| Skill parity | Each richer `main` topic must retain a rule owner and exact line-number-free implementation link; eject/customize remains emitted and extension-first. |
| Entity identity | `ReferenceTask` maps to `E.reference_module.reference_task` / `reference_module:reference_task`; only enricher `targetEntity` uses `reference_module.reference_task` as an entity identity. The disabled tree uses one `entityId()` bridge because #601 forbids absent generated members, and the activated proof imports `E` through the app alias. |
| Testing | API/key UI paths, async/security behavior, fixture isolation, preset and source-link contracts, frontend/context budgets, generation, and failure-first evaluator coverage included. |
| Harness registration | Cases are semantically deduplicated; reference-root entries, validators, fixed output/trace oracles, release matrix, focused tests, counts/docs, and emitted copies move together while generic read semantics stay with their companion. |
| Operational impact | No default runtime, migration, seed, route, navigation, or provider effect. |
| Open questions | None. Q1–Q4 are documented decisions; the exhaustive-surface decision is explicitly user-directed. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Task fields, scoping, encryption, versions, and CRUD responses align. |
| API contracts match UI/UX | Pass | DataTable and CrudForm consume the specified list/detail/mutation contracts and unified 409 behavior. |
| Risks cover write operations | Pass | Transactions, optimistic locking, soft deletion, undo, and event/search leakage risks are addressed. |
| Commands cover mutations | Pass | Create, update, delete, and restore use command and mutation-guard boundaries. |
| Cache behavior matches reads | Pass | Tenant/org-tagged cache entries exclude encrypted data; all writes, undo, and imports invalidate after commit; time-sensitive enrichment opts out where needed. |
| Async behavior matches commands | Pass | Import workers are idempotent, progress-aware, and command-mediated; notifications and DOM events use safe scoped payloads. |
| Skill examples match supported surfaces | Pass | A parity gate requires exact, live, line-number-free links and rejects topic loss or placeholder discovery files. |
| Harness registration matches each case mode | Pass | Writable behaviors require fixed oracles, generated validation, and isolated review lanes; read-only routing audits use focused evaluator assertions. |

### Non-Compliant Items

None. `reference_module` is an approved teaching-fixture naming exception scoped to this disabled example; product modules remain subject to the normal plural-ID rule.

### Verdict

**Fully compliant — approved and ready for implementation after this design PR merges.**

## Changelog

- 2026-07-31: Initial draft based on the observed `ratelimit_probe` selection trace, repository/spec/tracker duplicate research, and the standalone harness merged in PR #4529.
- 2026-07-31: Renamed the proposed module to `reference_module`, documented the naming exception, and enumerated the harness catalog, validator, oracle, matrix, test, count, and generated-copy registration surfaces required for complete coverage.
- 2026-07-31: Corrected class-derived colon-form entity IDs versus dot-form enricher targets, added a #601-safe disabled-source ID bridge plus activated generated-entity/runtime proof, aligned command files with `commands/**`, and made the intentionally uncovered `integration`/`ai-workflow` harness axes explicit.
- 2026-08-01: Expanded the canonical reference from a narrow CRUD slice to a production-shaped module/runtime/UI/UMES example with custom fields, links, encryption, seeds, JSON migration/snapshot, Data/Query Engine, import/export, cache, queue/workers/progress, notifications, DOM bridge, and concrete customers/catalog/sales injections.
- 2026-08-01: Added customer-grade perspectives/filter/search/export and shared create/edit form contracts, ACL sync guidance, exact line-number-free skill/example parity, emitted eject/customize coverage, bounded harness example reads, and evaluator tests; split global spec-first, generic example-read semantics, and harness-governance into companion specs.
- 2026-08-01: Froze a one-to-one discovery/override inventory, encrypted server-derived link and undo snapshots, bounded import/export and best-effort side-effect contracts, and machine-verifiable harness evidence; final independent review approved all four specs with no blockers.

### Review — 2026-08-01

- **Reviewer:** Agent, with an independent fresh-context scope-cohesion pass.
- **Scope cohesion:** Passed after splitting three independently deployable policies into linked one-way companions. This spec owns only the comprehensive inert reference, its direct skill links/preset boundary, and the focused proof that agents discover and use it.
- **Security:** Passed at design level; all added data/runtime/extension paths preserve tenant/organization scope, encryption, ACL, guarded writes, safe audiences, and leakage tests.
- **Performance:** Passed; explicit client-boundary, 300-line, heavy-dependency, provider, hydration, and build-evidence budgets are recorded.
- **Cache:** Passed at design level; cache is now a concrete tenant-scoped example with safe payload and post-commit invalidation requirements.
- **Commands:** Passed; all proposed mutations retain command, undo, mutation-guard, and optimistic-lock requirements.
- **Risks:** Passed; harness registration drift and accidental naming-precedent risks are now explicit and testable.
- **Identifier review:** Passed; the disabled tree centralizes the colon form through the canonical `entityId()` helper, activation proves equality with `E.reference_module.reference_task`, the enricher uses the distinct dot form, and runtime coverage catches silent entity-resolution mistakes.
- **Verdict:** Approved. The final independent review closed all scope, inventory, persistence, evaluator, and governance blockers.
