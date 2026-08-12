# Lessons

This catalog indexes 124 focused lessons without loading their full text. Route the task first, then read only records whose **modules**, standalone-harness **areas**, or **topics** match the work.

## How to use this catalog

1. Start with the exact module ID when one is named by the task.
2. Add every matching area from the standalone harness router: `architecture`, `module-data`, `umes`, `backend-ui`, `integration`, `ai-workflow`, `debugging`, `testing`, `framework-context`, or `spec-pr`.
3. Use topics to narrow cross-cutting concerns such as `data-scoping`, `optimistic-locking`, `query-index`, or `generated-files`.
4. Open only the linked lesson records that match; do not bulk-read `.ai/lessons/`.

Useful searches:

```bash
rg -n '\b<module-or-topic>\b' .ai/lessons.md
rg -l '"<area>"|"<module>"|"<topic>"' .ai/lessons/*.md
```

## Adding or updating a lesson

- Keep one reusable lesson per `.ai/lessons/<kebab-case-slug>.md`; update an existing record instead of duplicating it.
- Preserve the front matter keys `title`, `modules`, `areas`, and `topics`. Use `platform` only when no module or package owns the lesson, and put the primary area first.
- Add or update exactly one catalog row below. Keep the title stable when existing code/specs cite it.
- Put hard boundaries in the closest `AGENTS.md`; lessons explain recurring evidence and the durable rule.
- Run `yarn lessons:check` before committing.

## Catalog

### architecture

- [Durable quota reservations need fenced leases, conditional creates, and bounded sizes](lessons/durable-quota-reservations-need-fenced-leases.md) — area:architecture,module-data; module:attachments,storage_s3; topic:data-scoping,command-pattern,database-migrations

- [Feature-gated runtime helpers must use wildcard-aware permission matching](lessons/feature-gated-runtime-helpers-must-use-wildcard-aware.md) — area:architecture,backend-ui,module-data; module:customer_accounts,customers,events; topic:access-control,command-pattern,events
- [Fixing the writer of a bad persisted value needs a remediation branch for values already stored](lessons/fixing-the-writer-of-a-bad-persisted-value-needs-a.md) — area:backend-ui,architecture,testing; module:notifications,directory,auth; topic:data-scoping,template-sync
- [Fresh standalone Yarn scaffolds must ship a runnable root workspace lockfile entry](lessons/fresh-standalone-yarn-scaffolds-must-ship-a-runnable.md) — area:architecture,testing,module-data; module:create_app; topic:command-pattern,package-runtime,template-sync
- [Generated standalone app installs in CI must opt out of immutable lockfiles](lessons/generated-standalone-app-installs-in-ci-must-opt-out-of.md) — area:architecture,integration,testing; module:create_app; topic:generated-files,database-migrations,package-runtime
- [Generator manifests must fall back to source parsing when runtime-importing TS modules is fragile](lessons/generator-manifests-must-fall-back-to-source-parsing.md) — area:architecture,integration,module-data; module:cli,query_index,queue; topic:events,generated-files,query-index
- [Global registries in publishable packages must use `globalThis`, not module-local state](lessons/global-registries-in-publishable-packages-must-use.md) — area:architecture,module-data; module:shared,create_app; topic:events,module-boundaries,package-runtime
- [Hand-written custom routes resolve org scope via `resolveOrganizationScopeForRequest`, not `auth.orgId`](lessons/custom-routes-resolve-org-scope-via-the-directory-helper.md) — area:architecture,module-data; module:eudr,directory,customers; topic:data-scoping,access-control
- [Keep create-app template files in lockstep with app shell/layout changes](lessons/keep-create-app-template-files-in-lockstep-with-app.md) — area:architecture,backend-ui; module:create_app,ui; topic:template-sync,ui-components
- [Keep mirrored dev runtimes aligned with their process registry type](lessons/keep-mirrored-dev-runtimes-aligned-with-their-process.md) — area:architecture,debugging; module:events,create_app; topic:events,dev-runtime,filters
- [Keep standalone agentic content in sync with module conventions](lessons/keep-standalone-agentic-content-in-sync-with-module.md) — area:architecture,framework-context; module:create_app,events,cli; topic:events,generated-files,package-runtime,session-export
- [Keep standalone template module lists aligned with template package dependencies](lessons/keep-standalone-template-module-lists-aligned-with.md) — area:architecture; module:create_app,cli; topic:generated-files,package-runtime,template-sync
- [Never guard sensitive routes with `requireRoles` on mutable role names](lessons/never-guard-sensitive-routes-with-requireroles-on.md) — area:architecture; module:auth; topic:access-control,data-scoping
- [Package build scripts must rewrite side-effect ESM imports and declared watch entrypoints must exist](lessons/package-build-scripts-must-rewrite-side-effect-esm.md) — area:architecture,integration; module:checkout; topic:build-output,module-boundaries,package-runtime
- [Prefer relative intra-package imports inside package CLI/runtime entrypoints](lessons/prefer-relative-intra-package-imports-inside-package.md) — area:architecture; module:cli; topic:package-runtime,runtime-startup,testing
- [Standalone module discovery must treat published `src/modules` as canonical over `dist/modules`](lessons/standalone-module-discovery-must-treat-published-src.md) — area:architecture,framework-context,umes; module:create_app,events,cli; topic:build-output,events,generated-files
- [Standalone scaffolding and generators must not assume monorepo-only paths](lessons/standalone-scaffolding-and-generators-must-not-assume.md) — area:architecture; module:cli,create_app; topic:generated-files,package-runtime,testing
- [Standalone scaffolds must pin the same Yarn version as the monorepo](lessons/standalone-scaffolds-must-pin-the-same-yarn-version-as.md) — area:architecture; module:create_app; topic:package-runtime,template-sync,testing
- [Standalone template env examples must mirror security-sensitive app env keys](lessons/standalone-template-env-examples-must-mirror-security.md) — area:architecture,integration,testing; module:create_app,catalog,webhooks; topic:generated-files,package-runtime,template-sync
- [Standalone template must include all generated bootstrap registries](lessons/standalone-template-must-include-all-generated.md) — area:architecture,integration; module:create_app,events; topic:auto-discovery,events,generated-files
- [Startup splash must distinguish blocking bootstrap failures from non-blocking runtime warnings](lessons/startup-splash-must-distinguish-blocking-bootstrap.md) — area:architecture,debugging,module-data; module:customers,search,create_app; topic:error-states,dev-runtime,package-runtime
- [Use `safeExtend()` when composing refined Zod object schemas](lessons/use-safeextend-when-composing-refined-zod-object-schemas.md) — area:architecture; module:shared,checkout; topic:generated-files,schema-composition

### module-data

- [`dbMigrate` must not write migration snapshots during initialize flows](lessons/dbmigrate-must-not-write-migration-snapshots-during.md) — area:module-data,architecture; module:cli; topic:generated-files,database-migrations,runtime-startup
- [A self-request needs data committed outside the caller's transaction](lessons/a-self-request-needs-data-committed-outside-the-callers.md) — area:module-data; module:auth,checkout,query_index; topic:data-integrity,query-index,workers
- [Avoid identity-map stale snapshots in command logs](lessons/avoid-identity-map-stale-snapshots-in-command-logs.md) — area:module-data,debugging; module:audit_logs,cache; topic:command-pattern,data-integrity,generated-files
- [Classify entity metadata by ORM ownership before custom declarations](lessons/classify-entity-metadata-by-orm-ownership-before-custom.md) — area:module-data; module:entities; topic:access-control,filters
- [Concurrent index migrations must recover from invalid build stubs](lessons/concurrent-index-migrations-must-recover-from-invalid-build-stubs.md) — area:module-data,debugging,testing; module:query_index; topic:concurrency,database-migrations,data-integrity
- [Cross-module query precedent is not permission to copy storage coupling](lessons/cross-module-query-precedent-is-not-permission-to-copy.md) — area:module-data,debugging; module:customers; topic:access-control,module-boundaries,testing
- [CRUD-owned custom-field writes should not emit a second entity event](lessons/crud-owned-custom-field-writes-should-not-emit-a-second.md) — area:module-data,umes; module:entities,query_index,cli; topic:command-pattern,custom-fields,data-integrity
- [Data-sync run detail should subscribe to its progress job, not just poll it](lessons/data-sync-run-detail-should-subscribe-to-its-progress.md) — area:module-data,integration,debugging; module:data_sync,progress,events; topic:events,realtime,testing
- [Do not diagnose unknown-total progress as broken SSE](lessons/do-not-diagnose-unknown-total-progress-as-broken-sse.md) — area:module-data,integration,backend-ui; module:events,progress,catalog; topic:data-import,events,provider-lifecycle
- [Docker initialization should treat the existing-users CLI abort as already initialized](lessons/docker-initialization-should-treat-the-existing-users.md) — area:module-data,architecture,debugging; module:cli,create_app; topic:package-runtime,runtime-startup,template-sync
- [Duplicate migration creation causes initialize failures in fresh databases](lessons/duplicate-migration-creation-causes-initialize-failures.md) — area:module-data,testing,architecture; module:customers; topic:database-migrations,runtime-startup,testing
- [Flush entity updates before running relation syncs that query](lessons/flush-entity-updates-before-running-relation-syncs-that.md) — area:module-data; module:catalog; topic:command-pattern,data-integrity
- [JSON column defaults, twice-parsed command inputs, and scale-padded numerics](lessons/orm-json-defaults-double-parsed-inputs-and-numeric-padding.md) — area:module-data,debugging; module:eudr; topic:database-migrations,command-pattern,generated-files
- [Keep fallible document preparation outside encryption guards](lessons/keep-fallible-document-preparation-outside-encryption.md) — area:module-data,debugging; module:query_index,search; topic:data-integrity,encryption,query-index
- [Keep raw SQL out of API route handlers](lessons/keep-raw-sql-out-of-api-route-handlers.md) — area:module-data,integration,testing; module:customer_accounts,customers; topic:data-scoping,filters,testing
- [makeCrudRoute `sortField` must be `z.string()` + `sortFieldMap`, not a strict enum](lessons/makecrudroute-sortfield-is-a-string-with-a-sortfieldmap.md) — area:module-data,backend-ui; module:eudr,customers; topic:crud-factory,query-index
- [MikroORM 6 does NOT generate UUIDs client-side — assign PKs before referencing](lessons/mikroorm-6-does-not-generate-uuids-client-side-assign.md) — area:module-data; module:cli,shared; topic:data-integrity,testing,validation-errors
- [MikroORM string defaults must be plain values, not pre-quoted SQL fragments](lessons/mikroorm-string-defaults-must-be-plain-values-not-pre.md) — area:module-data; module:entities; topic:generated-files,database-migrations,runtime-startup
- [Normalize raw SQL result types before JSON responses](lessons/normalize-raw-sql-result-types-before-json-responses.md) — area:module-data; module:platform; topic:testing,type-normalization
- [PostgreSQL partial unique indexes are not constraints](lessons/postgresql-partial-unique-indexes-are-not-constraints.md) — area:module-data,debugging; module:platform; topic:data-integrity,data-scoping,testing
- [Preserve Turbopack compiler cache during greenfield dev warmup](lessons/preserve-turbopack-compiler-cache-during-greenfield-dev.md) — area:module-data,architecture,debugging; module:cache,auth,create_app; topic:dev-runtime,runtime-startup,template-sync
- [Projection updates that change indexed parent fields must emit query-index upserts](lessons/projection-updates-that-change-indexed-parent-fields.md) — area:module-data,debugging; module:query_index,customers,events; topic:command-pattern,events,filters
- [Query-index custom-field cardinality comes from definitions, not row count](lessons/query-index-custom-field-cardinality-comes-from.md) — area:module-data,umes,backend-ui; module:entities,query_index,search; topic:custom-fields,data-scoping,query-index
- [Standalone generators must reuse package-generated entity metadata instead of parsing compiled `dist` files](lessons/standalone-generators-must-reuse-package-generated.md) — area:module-data,architecture,framework-context; module:entities,cli,create_app; topic:auto-discovery,build-output,data-scoping
- [Store global event bus in `globalThis` to survive module duplication in dev](lessons/store-global-event-bus-in-globalthis-to-survive-module.md) — area:module-data,architecture,debugging; module:events,shared; topic:events,module-boundaries,package-runtime
- [System encryption map discovery must fail closed](lessons/system-encryption-map-discovery-must-fail-closed.md) — area:module-data,architecture; module:onboarding,shared; topic:data-integrity,encryption,runtime-startup
- [Sync progress must count source records, not emitted side-effect items](lessons/sync-progress-must-count-source-records-not-emitted.md) — area:module-data,integration; module:data_sync,progress,catalog; topic:data-import,events,testing
- [Tool-scoped regeneration commands must not be blocked by unrelated existing files](lessons/tool-scoped-regeneration-commands-must-not-be-blocked.md) — area:module-data,architecture; module:cli; topic:command-pattern,data-scoping,regeneration
- [Use canonical generated entity ids, not shortened ad-hoc aliases](lessons/use-canonical-generated-entity-ids-not-shortened-ad-hoc.md) — area:module-data,umes,architecture; module:checkout,entities,query_index; topic:auto-discovery,custom-fields,data-integrity
- [We've got centralized helpers for extracting `UndoPayload`](lessons/weve-got-centralized-helpers-for-extracting-undopayload.md) — area:module-data; module:shared; topic:command-pattern,weve,centralized
- [WeakSet-based circular reference detection drops shared (non-circular) object references](lessons/weakset-based-circular-reference-detection-drops-shared.md) — area:module-data,architecture; module:cache,events,shared; topic:events,generated-files,testing
- [Windows `.cmd` wrappers must not be spawned directly in Node dev scripts](lessons/windows-cmd-wrappers-must-not-be-spawned-directly-in.md) — area:module-data,architecture,debugging; module:create_app; topic:command-pattern,dev-runtime,package-runtime
- [Worker-emitted progress needs polling fallback even when SSE exists](lessons/worker-emitted-progress-needs-polling-fallback-even.md) — area:module-data,backend-ui,debugging; module:events,progress,queue; topic:events,realtime,testing

### umes

- [Client injection hooks must tolerate late registry registration](lessons/client-injection-hooks-must-tolerate-late-registry.md) — area:umes,architecture,integration; module:cli,cache,ui; topic:generated-files,database-migrations,provider-lifecycle
- [Custom-field detail UIs must accept canonical bare keys](lessons/custom-field-detail-uis-must-accept-canonical-bare-keys.md) — area:umes,backend-ui,debugging; module:entities,ui,customers; topic:custom-fields,generated-files,ui-components
- [Prefer canonical route paths over alias lists for custom APIs](lessons/prefer-canonical-route-paths-over-alias-lists-for.md) — area:umes,architecture; module:cli,create_app; topic:generated-files,package-runtime,testing
- [Sanitize generated component override entries before runtime use](lessons/sanitize-generated-component-override-entries-before.md) — area:umes,architecture; module:shared,cli; topic:component-overrides,generated-files,filters

### backend-ui

- [Always propagate structured conflict payload from `onBeforeSave` blockers](lessons/always-propagate-structured-conflict-payload-from.md) — area:backend-ui,umes,debugging; module:ui; topic:concurrency,optimistic-locking,ui-components
- [Async edit selects must be hydrated as value-plus-options](lessons/async-edit-selects-must-be-hydrated-as-value-plus.md) — area:backend-ui,integration,testing; module:checkout,entities,ui; topic:custom-fields,filters,testing
- [Async select controls must not treat synthetic empty changes as user clears](lessons/async-select-controls-must-not-treat-synthetic-empty.md) — area:backend-ui,testing,module-data; module:ui,catalog,events; topic:command-pattern,events,testing
- [Auto-discovered DataTable fields must only advertise controls the table can actually honor](lessons/auto-discovered-datatable-fields-must-only-advertise.md) — area:backend-ui,umes,module-data; module:ui,customers,entities; topic:custom-fields,filters,ui-components
- [Backend `[id]` pages read the route param from the `params` prop, never `useParams()`](lessons/backend-dynamic-pages-read-the-route-param-from-props.md) — area:backend-ui,umes; module:eudr,customers; topic:routing,generated-files
- [Blur suppression must guard the whole validation pipeline](lessons/blur-suppression-must-guard-the-whole-validation-pipeline.md) — area:backend-ui,testing; module:ui; topic:schema-composition,testing,validation-errors
- [Browser SSE bridges must work across worker and web processes](lessons/browser-sse-bridges-must-work-across-worker-and-web.md) — area:backend-ui,module-data,integration; module:events,queue,catalog; topic:data-import,events,realtime
- [Component-scoped notification effects must not depend on header chrome](lessons/component-scoped-notification-effects-must-not-depend.md) — area:backend-ui,integration,testing; module:notifications,events,ui; topic:access-control,data-scoping,events
- [Detail sections must route writes through page-level guarded mutations](lessons/detail-sections-must-route-writes-through-page-level.md) — area:backend-ui,umes,module-data; module:customers,events,ui; topic:events,network-security,testing
- [dnd-kit contexts rendered in SSR need stable ids](lessons/dnd-kit-contexts-rendered-in-ssr-need-stable-ids.md) — area:backend-ui; module:customers,ui,cli; topic:generated-files,ui-components
- [Header-gated module features need setup grants](lessons/header-gated-module-features-need-setup-grants.md) — area:backend-ui,module-data,architecture; module:notifications,search,ui; topic:access-control,data-scoping,testing
- [Hydrated backend chrome payloads must receive the original request for scope-aware RBAC](lessons/hydrated-backend-chrome-payloads-must-receive-the.md) — area:backend-ui; module:ui,auth,events; topic:access-control,data-scoping,events
- [Keep injected namespaces DataTable-owned, not page-owned](lessons/keep-injected-namespaces-datatable-owned-not-page-owned.md) — area:backend-ui,umes,debugging; module:ui; topic:filters,testing,ui-components
- [Mixed advanced filters need per-row join state, not one shared logic flag](lessons/mixed-advanced-filters-need-per-row-join-state-not-one.md) — area:backend-ui,debugging; module:ui; topic:filters,mixed,advanced
- [MUST use Button and IconButton primitives — never raw `<button>` elements](lessons/must-use-button-and-iconbutton-primitives-never-raw.md) — area:backend-ui,umes; module:ui,catalog; topic:design-system,testing,ui-components
- [New progress UI must use SSE, not fresh polling loops](lessons/new-progress-ui-must-use-sse-not-fresh-polling-loops.md) — area:backend-ui,module-data,integration; module:events,progress,ui; topic:data-import,events,realtime
- [Optional chrome fetches must suppress auth redirects](lessons/optional-chrome-fetches-must-suppress-auth-redirects.md) — area:backend-ui,umes; module:auth,notifications,ui; topic:access-control,testing,ui-components
- [Out-of-band bumps in browser optimistic-lock tests must not change the row's visible name](lessons/out-of-band-bumps-in-browser-optimistic-lock-tests-must.md) — area:backend-ui,integration,testing; module:ui,webhooks,cli; topic:concurrency,data-scoping,optimistic-locking
- [Portaled confirmations must stay inside their parent dialog's React tree](lessons/portaled-confirmations-must-stay-inside-their-parent.md) — area:backend-ui,module-data; module:ui; topic:events,ui-components
- [Route-aware backend chrome should use route manifests, not the full module registry](lessons/route-aware-backend-chrome-should-use-route-manifests.md) — area:backend-ui,architecture; module:ui,events; topic:events,generated-files,regeneration
- [Sidebar hydration must preserve the exact RBAC inclusion semantics of the server layout](lessons/sidebar-hydration-must-preserve-the-exact-rbac.md) — area:backend-ui,debugging; module:ui; topic:access-control,data-scoping,generated-files
- [Standardize record-not-found as a dedicated page state in backend UI](lessons/standardize-record-not-found-as-a-dedicated-page-state.md) — area:backend-ui,debugging; module:ui,auth,customers; topic:error-states,ui-components

### integration

- [Akeneo base-field imports must not fall back across locales or channels](lessons/akeneo-base-field-imports-must-not-fall-back-across.md) — area:integration,debugging; module:data_sync,catalog; topic:data-import,data-scoping,testing
- [Akeneo media identifiers can be slash-delimited path params](lessons/akeneo-media-identifiers-can-be-slash-delimited-path.md) — area:integration; module:data_sync,cli; topic:data-import,media
- [Akeneo variant reuse must be scoped to the current product, not global SKU matches](lessons/akeneo-variant-reuse-must-be-scoped-to-the-current.md) — area:integration,debugging; module:catalog,data_sync; topic:data-import,data-scoping
- [DNS pinning must keep fetch and dispatcher implementations compatible](lessons/dns-pinning-must-keep-fetch-and-dispatcher.md) — area:integration,testing,debugging; module:events; topic:events,network-security,package-runtime
- [Env-backed integration presets belong in the provider module, not core](lessons/env-backed-integration-presets-belong-in-the-provider.md) — area:integration,architecture; module:integrations,data_sync,cli; topic:data-import,data-scoping,module-boundaries
- [Force-delete import tools must include orphaned imported rows, not only mapped rows](lessons/force-delete-import-tools-must-include-orphaned.md) — area:integration; module:catalog,data_sync; topic:data-import,force,delete
- [Integration packages must use decryption-aware find helpers for all entity reads](lessons/integration-packages-must-use-decryption-aware-find.md) — area:integration,module-data; module:data_sync,integrations; topic:data-import,data-scoping,package-runtime
- [Integration tests: avoid `networkidle` on pages with SSE/background streams](lessons/integration-tests-avoid-networkidle-on-pages-with-sse.md) — area:integration,backend-ui,testing; module:events,catalog,customers; topic:events,filters,package-runtime
- [Keep external integrations as dedicated npm workspace packages](lessons/keep-external-integrations-as-dedicated-npm-workspace.md) — area:integration,umes; module:data_sync,integrations; topic:module-boundaries,package-runtime,provider-lifecycle
- [Lazy provider wrappers must not render provider-dependent children before the provider loads](lessons/lazy-provider-wrappers-must-not-render-provider.md) — area:integration,backend-ui,architecture; module:ai_assistant,ui,cli; topic:provider-lifecycle,ui-components
- [New shared deep import paths should get explicit export-map entries](lessons/new-shared-deep-import-paths-should-get-explicit-export.md) — area:integration,testing,debugging; module:shared; topic:events,package-runtime,testing
- [Optional native dependencies must report load failures accurately](lessons/optional-native-dependencies-must-report-load-failures.md) — area:integration,module-data,debugging; module:cache; topic:error-states,package-runtime,testing
- [Provider credentials must never control authenticated cross-origin requests](lessons/provider-credentials-must-never-control-authenticated.md) — area:integration; module:auth,integrations,data_sync; topic:data-import,data-scoping,media
- [Security caches must outlive request-scoped providers and cover reserved IPv6 space](lessons/security-caches-must-outlive-request-scoped-providers.md) — area:integration,umes; module:cache,auth,cli; topic:data-scoping,network-security,provider-lifecycle
- [Shared security-default changes require a complete consumer audit](lessons/shared-security-default-changes-require-a-complete.md) — area:integration,testing,module-data; module:shared,auth,cache; topic:access-control,data-scoping,events
- [Stabilize flaky integration tests by finding the hang, not by raising the timeout](lessons/stabilize-flaky-integration-tests-by-finding-the-hang.md) — area:integration,testing,backend-ui; module:events,queue,ui; topic:events,testing,workers
- [Standalone CI runners must mirror webhook-security env from parity scripts](lessons/standalone-ci-runners-must-mirror-webhook-security-env.md) — area:integration,architecture,testing; module:webhooks,create_app,checkout; topic:events,generated-files,database-migrations
- [Store integration registry state in `globalThis` for standalone workers](lessons/store-integration-registry-state-in-globalthis-for.md) — area:integration,architecture,testing; module:integrations,shared,create_app; topic:generated-files,module-boundaries,database-migrations
- [Validate persisted-definition consumers before retiring legacy workflow rows](lessons/validate-persisted-definition-consumers-before-retiring.md) — area:integration,architecture,debugging; module:checkout,webhooks; topic:generated-files,database-migrations,webhooks
- [Variant hero media should be written after importer flush-heavy work](lessons/variant-hero-media-should-be-written-after-importer.md) — area:integration,module-data; module:catalog,data_sync; topic:data-integrity,data-import,generated-files
- [Webhook body-limit sweeps must include source-specific receivers](lessons/webhook-body-limit-sweeps-must-include-source-specific-receivers.md) — area:integration,testing,architecture; module:webhooks,payment_gateways,shipping_carriers,communication_channels,inbox_ops; topic:webhooks,network-security,testing
- [Workspace packages with backend pages must build and export deep TSX entrypoints](lessons/workspace-packages-with-backend-pages-must-build-and.md) — area:integration,architecture; module:platform; topic:build-output,generated-files,module-boundaries

### ai-workflow

- [Do not rasterize untrusted uploads through sunsetted external converters](lessons/do-not-rasterize-untrusted-uploads-through-sunsetted.md) — area:ai-workflow,testing,module-data; module:ai_assistant,data_sync,queue; topic:media,testing,workers
- [Format Zod validation errors for LLM consumption](lessons/format-zod-validation-errors-for-llm-consumption.md) — area:ai-workflow,debugging; module:ai_assistant,shared; topic:testing,validation-errors
- [Inject TypeScript types into LLM tool descriptions for correct API payloads](lessons/inject-typescript-types-into-llm-tool-descriptions-for.md) — area:ai-workflow,backend-ui,module-data; module:ai_assistant,events,search; topic:events,runtime-startup,testing

### debugging

- [Anchor repeated route-handler edits to unique context](lessons/anchor-repeated-route-handler-edits-to-unique-context.md) — area:debugging,testing; module:messages; topic:route-coverage,testing
- [Compose startup commands must not hard-depend on newly added image scripts](lessons/compose-startup-commands-must-not-hard-depend-on-newly.md) — area:debugging,module-data,architecture; module:create_app; topic:command-pattern,runtime-startup,template-sync
- [Embedded CLI output must inherit its caller's presentation margin](lessons/embedded-cli-output-must-inherit-its-callers-presentation.md) — area:debugging; module:create_app,cli; topic:runtime-startup,testing
- [Package builds that publish `dist/` must clear stale artifacts first](lessons/package-builds-that-publish-dist-must-clear-stale.md) — area:debugging,module-data,architecture; module:create_app; topic:build-output,generated-files,database-migrations
- [Stale package dist and cached RBAC make a correct fix look broken in dev](lessons/stale-dist-and-cached-rbac-hide-code-changes-in-dev.md) — area:debugging,ai-workflow; module:eudr,auth; topic:build-output,access-control,spec-pr
- [`/_global-error` prerender failures are Next version issues, not app code](lessons/global-error-prerender-failures-are-next-version-issues.md) — area:debugging,testing,architecture; module:create_app,ui; topic:package-runtime,generated-files,template-sync

### testing

- [Determine super-admin via the immutable `isSuperAdmin` flag, never by role name](lessons/determine-super-admin-via-the-immutable-issuperadmin.md) — area:testing,module-data,debugging; module:auth,events; topic:access-control,command-pattern,data-scoping
- [Integration routing tests must establish the route they claim to cover](lessons/integration-routing-tests-must-establish-the-route-they-claim-to-cover.md) — area:testing,integration,debugging; module:search,query_index; topic:async-indexing,query-index,route-coverage
- [Keep executable integration tests module-local](lessons/keep-executable-integration-tests-module-local.md) — area:testing,module-data; module:platform; topic:module-boundaries,package-runtime,testing
- [Meilisearch container healthchecks must probe IPv4 explicitly](lessons/meilisearch-container-healthchecks-must-probe-ipv4.md) — area:testing,architecture; module:search,create_app; topic:network-security,package-runtime,runtime-startup
- [Restart stale UI previews after package edits](lessons/restart-stale-ui-previews-after-package-edits.md) — area:testing,debugging; module:create_app,ui; topic:package-runtime,testing
- [Scope Playwright `testIgnore` entries to project root absolute paths](lessons/scope-playwright-testignore-entries-to-project-root.md) — area:testing,integration; module:platform; topic:data-scoping,testing,type-normalization
- [Use cryptographic randomness in auth-adjacent test helpers](lessons/use-cryptographic-randomness-in-auth-adjacent-test.md) — area:testing,integration,module-data; module:auth,cache,communication_channels; topic:data-scoping,generated-files,filters
- [Use the bundled Node runtime for sandboxed macOS verification](lessons/use-the-bundled-node-runtime-for-sandboxed-macos.md) — area:testing,debugging; module:platform,create_app; topic:testing,node-runtime
- [When a task brief requires Playwright coverage, unit tests are not a substitute](lessons/when-a-task-brief-requires-playwright-coverage-unit.md) — area:testing; module:events,search; topic:events,module-boundaries,testing

### framework-context

- [Docker entrypoints must verify required binaries, not just non-empty node_modules](lessons/docker-entrypoints-must-verify-required-binaries-not.md) — area:framework-context,module-data,architecture; module:cli,create_app; topic:build-output,command-pattern,package-runtime
- [Standalone agent context must follow the installed package, not the checkout layout](lessons/standalone-agent-context-must-follow-the-installed.md) — area:framework-context,architecture; module:checkout,create_app; topic:generated-files,database-migrations,package-runtime
- [Standalone source-mirror discovery must remap source extensions to runtime files](lessons/standalone-source-mirror-discovery-must-remap-source.md) — area:framework-context,architecture,umes; module:create_app,cli; topic:access-control,build-output,generated-files
