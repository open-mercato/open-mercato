# Customers UMES extension flow repair

## TLDR

Repair the existing CRM extension path from scoped response enrichment through form hydration, headless widget lifecycle callbacks, contributor-owned persistence, and detail presentation. Issue #6736 is a connected compatibility repair across the shared UI and customers hosts; it does not introduce another extension framework.

## Resolved assumptions (autonomous defaults)

1. Keep one repair spec because the five workstreams complete the same contributed-data round trip; deliver them as separately testable phases.
2. Preserve existing lifecycle save order, rendered-widget semantics, canonical/legacy spot IDs, database entity IDs, and optimistic-lock behavior. Add optional resource identity and new narrow hosts only.
3. Cache base CRM overviews and enrich per request after the cache read so permission changes and contributor writes cannot leave stale or overprivileged extension data.
4. Preserve underscore-prefixed contributor namespaces without forwarding them to native mutations. Edited flat dot-path keys take precedence over stale nested values.
5. Use a responsive sidebar and a persistent-header `header-actions` host; absent optional contributors occupy no layout space. Keep all existing header, status-badge, footer, and tab hosts in place.
6. Group injected tab contributors deterministically and retain all renderers; retain native tab IDs and labels, append colliding contributors after native content, and fall back to a valid native tab when a contribution disappears.
7. Verify advertised replacement support against current runtime before repairing it. DataTable already resolves its component override on the current baseline; CrudForm requires inspection and a compatible runtime host.

## Overview and problem statement

The audit baseline in #6736 reports disconnected headless callbacks, detail enrichment/hydration gaps, missing sidebar/action surfaces, lossy tab grouping, and ambiguous form resource identity. Confirm each on current `develop`, reuse existing module registries/enrichers/UI primitives, and coordinate the narrower open #5915/#5415 and test issue #6004.

## Proposed solution

Use the existing registries, response-enricher runner, lifecycle dispatcher, component override resolver, and form/section primitives. Repair participant selection rather than teaching rendered-widget discovery to accept headless widgets. Treat person/company/deal responses as existing envelopes with additive contributor namespaces.

## Architecture

- Add an event-participant shape independent of a React renderer. CrudForm merges rendered participants in their current order, appends authorized headless field participants in field-loader order, and deduplicates widget identity across root/fields/canonical/legacy. Exact/wildcard loader priority remains unchanged. Only CrudForm disables each root hook's automatic load callback, then dispatches one merged `onLoad(context)` after discovery; standalone InjectionSpot behavior and the deliberately dual-rendered legacy header bridge remain intact.
- Preserve validation, transformation, field-change, navigation, visibility, app-event, load, save, delete and error callbacks through the shared dispatcher. Native schema validation sees only native/custom fields. Contributor callbacks see visible contributed fields; namespace roots and flat dot-path contributor keys do not leak into native writes, including schema-less/passthrough forms.
- Add optional explicit `resourceKind`/`resourceId` and semantic `entityId` form props with legacy derivation as fallback. Custom-field `entityIds` retain their exact meaning/order, and history visibility stays independent. Current-record guard context, retry callbacks, parent optimistic-lock headers and independently versioned child headers retain their contracts.
- Add optional lifecycle context `setFormValue(id, value)` and translator `t`. The setter advances contributor-owned hydration/version baselines in both form state and its immediate values reference without replacing a user's edited flat field. Custom group renderers receive optional `injectedFields`, allowing bare groups to retain their native layout while rendering contributed controls.
- Add `CrudFormSubmitResult = { resourceId?: string }` to the existing optional submit return. Existing callbacks returning void remain valid. Create `onSave` still executes before the native API; only `onAfterSave` receives a successful result's new `recordId`/`resourceId`. Never replay `onSave`. Add an optional awaitable `onSubmitSuccess(values, result)` callback after all after-save dispatch settles, and move create navigation/close/parent-created callbacks there. Contributors that require a new ID persist on create in `onAfterSave`, and persist edits in `onSave`, preventing double writes.
- Use an additive pure namespace extractor in `shared/lib/crud/response-enricher-namespaces.ts`. Preserve existing single-underscore namespaces (including camelCase), exclude `_meta`, double-underscore/prototype/reserved roots and dot-path flat keys. A customers-local overview adapter deep-clones the base record, invokes `applyResponseEnricherToRecord` for `customers.person/company/deal`, and projects resulting namespaces onto the main record and envelope root without replacing native fields.
- Build context from the already authorized record's actual tenant/organization, authenticated subject, request EM/container, and trusted RBAC granted features. The existing runner enforces critical failure, feature wildcards, required modules and timeouts. Access denial happens before enrichment. Cold/hit responses both run enrichment after base cache read/write; never store caller-filtered contribution data in the parent's cache. Preserve critical errors outside cache-failure fallback catches.
- Form projections retain contributor namespaces, and untouched injected flat fields rehydrate from fresh nested data after reload. An edited flat key overrides the original nested key in Example priority. Example persistence uses its own API, captures the child row ID/version during hydration rather than fetching a newer overwrite baseline at save time. Successful contributor writes advance the local version baseline from their owning API response so a subsequent native-failure retry does not self-conflict; another actor’s stale-child update remains blocked. Existing priority responses gain additive updatedAt metadata, and the namespace gains optional priorityId/priorityUpdatedAt. Sequential retries reuse the existing contributor row.
- The Example priority field explicitly handles delete events without persistence, so the existing generic delete-to-save fallback cannot cause a priority write during native CRM deletion. Generic fallback behavior and existing delete context remain unchanged.
- Resolve CrudForm replacement using `useRegisteredComponent` outside a stable `CrudFormImpl` fallback, following current DataTable. Verify default/props/wrapper/replace for both, without reimplementing already-bound DataTable.

## Data Models

No entities, database columns, migrations, production dependencies, or direct cross-module ORM relationships are added. Contributor data remains in its existing owning module. Existing namespace values continue through the runner's encrypted/scoped data access; no new PII field or encryption mechanism is introduced.

## API Contracts

Existing detail URLs and native envelope fields remain intact: `GET /api/customers/people/:id` returns `{ person, ... }`, company returns `{ company, ... }`, and deal returns its existing `{ deal, ... }`. Single-underscore contributor namespaces are additive on each main record and mirrored onto the envelope root so a detail host can consume `data._integrations` and the form can hydrate `record._example.priority`. The core write APIs never receive those namespaces. Native response/enricher metadata remains owned by the existing endpoint/runner.

## UI/UX and Host Contracts

- Declare `detail:customers.{person,company,deal}:sidebar` and `:header-actions` in `customers/extension-points.ts`, and declare the existing `:tabs` hosts. All support rendered widgets; tab hosts support tab/group placement through the existing placement contract. New action hosts support inline stack placement inside the persistent native action row before native actions.
- Hosts pass current scoped resource identity, full overview data, existing retry callback and optional saving/dirty state. Sidebar only reserves a desktop column after permitted widgets resolve; on small screens it stacks below the main content. No widgets means no empty column. Person desktop/mobile mounts exactly one form.
- The owning integrations External IDs widget must wrap long unbroken IDs within the narrow sidebar while retaining status/link/copy actions. Live browser observation identified overflow with a 200-character ID; use shrinkable semantic layout utilities in that widget and cover it with the real sidebar regression.
- Keep header/status/footer hosts in their existing locations. Add optional action-node props to current persistent header components; save/loading disables actions consistently without relocating badges or avatars.
- A customers-local adapter groups tabs by `groupId ?? widgetId`, preserves deterministic order, translates labels, and renders all widgets through InjectionSpot overrides. Native collisions preserve one native navigation ID/label and append extension content after native content. Unknown/disappearing selections fall back after registry/permission discovery settles; preserve late-bootstrap deep links and unrelated query parameters.
- Publish current native group IDs. Add optional `injectionGroupAliases` to bridge person v2 `details -> personalData`, company v2 `details -> identity` and `profile -> businessProfile`, and quick deal `details -> basic`, without renaming groups or preferences. Full deal create retains its layout through an embedded CrudForm with existing custom group renderers and `details/associations/custom` groups. Replace the outer form with a container, target the embedded stable formId from header buttons, make CrudForm values authoritative, and keep exactly one global guard around the native create. No dummy renderer or custom lifecycle/persistence dispatcher.
- Bind selected create surfaces to canonical form identities with no initial record ID. Person/company legacy form IDs remain dual-published via `legacyInjectionSpotId`. Coordinate #5915's narrower rendered-host work and extend #6004's intended test case rather than shipping a second suite for the same host coverage. #5415's unmerged request payload transport is outside this repair.
- All added user-facing labels use existing translations or synchronized locale keys; existing dialogs retain Cmd/Ctrl+Enter and Escape behavior.

Current native form groups remain stable:

| Host | Native group IDs |
| --- | --- |
| Person create | `details`, `addresses`, `notes`, `customFields` |
| Person v2 detail | `personalDataDisplay`, `personalData`, `companyRole`, `customFields`, `roles` |
| Company create | `details`, `profile`, `addresses`, `notes`, `customFields` |
| Company v2 detail | `identity`, `contact`, `classification`, `businessProfile`, `notes`, `customFields` |
| Deal edit | `details`, optional `associations`, `custom` |
| Full deal create | `details`, `associations`, `custom` |
| Quick deal create | `basic`, `more` |

## Edge Cases & Failure Scenarios

Validation blocks native and contributor save; callback exceptions follow existing error behavior. Create contributor failures must display a translated module-owned message and recover by editing the already-created record, never replaying native creation. Native success feedback precedes contributor after-save feedback, while navigation/close only happens after it settles. For ordinary edit failures, the owning widget keeps pending feedback keyed by the submitted data object and restores it after native success; successful retry clears it and another form cannot consume it. onAfterSave remains non-blocking as before. A contributor save can precede a failed native optimistic write, as today, so retries remain sequentially idempotent. This repair does not claim distributed atomicity or add a uniqueness migration. No permission/disabled optional module means neither rendering nor callback execution. Enrichment always runs with trusted scope even on cache hits; cached base objects cannot be mutated. Module/permission changes invalidate tab selection once discovery is ready. Replacement wrappers cannot recursively select the public host as their fallback.

## Risks & Impact Review

| Risk | Severity | Mitigation and residual risk |
| --- | --- | --- |
| Missing/double callbacks in shared forms | High | Real-registry tests pin exact counts, mixed/headless/canonical/legacy ordering, wildcard grants, disabled modules and late bootstrap. Existing contributor-before-native order remains non-atomic. |
| Cache leaks or stale contributor namespaces | High | Authorize first, clone cached base envelopes, scope RBAC and enrich every request; cold/hit and changed permission/child-data regressions. |
| False optimistic-lock conflicts or weak guards | High | Explicit semantic identity is optional; preserve parent/child version headers and retry behavior with regression coverage. |
| Native tab loss or bad deep links | Medium | Append colliding groups after native content; normalize unavailable selections after discovery readiness. |
| New layout hurts mobile/absent modules | Medium | Sidebar conditional on permitted widgets; narrow viewport and one-form checks. |
| Narrower open PR overlap | Medium | Preserve spot bridges and avoid unmerged payload transport; document shared files and final behavior in the PR. |

## Integration Test Coverage

Real enabled extensions on person/company/deal v2 detail must load an existing contribution, edit it beside a native field, save through owning APIs, reload both values and assert contributor keys are absent from native writes. Use self-contained API fixtures and cleanup; never mock injection away or silently skip the required flow. Cover External IDs in sidebar on cold/hit responses and changed contributor data, tenant/org denial, headless validation/exact callback counts, group collisions/disappearing selection, default/wrapper/props/replacement modes, stale update/delete/retry and child headers. Extend canonical/legacy create host tests, including full and quick deal creation. Run the committed browser runner against an isolated ephemeral environment when available and disclose concrete environment blockers otherwise.

Validate the mirrored template in a standalone app through the repository's native Verdaccio scaffold/integration scripts. Use an owned registry project and distinct loopback port so publication and cleanup cannot affect another worktree's registry. Run the affected CRM browser specs against the installed package build and preserve the monorepo evidence before the shared runner writes its report.

The External IDs fixture must resolve its compiled entity without evaluating it at module collection time, then lazily import the decorated class as native ESM after database/tenant/organization guards. A collection-time CommonJS load can contaminate Playwright's filename-only transform cache and break later in-process worker bootstrap across otherwise unrelated specs. Validate the same-worker interoperability with existing queue/bootstrap consumers. Quick-create fixture readiness targets the native toolbar action and the owned pipeline/stage rather than an ambiguous page-wide New stage button.

The initial eight-command configured gate and native scaffold smoke passed. Fresh native standalone integration passed all twelve affected CRM cases with no skips or retries, covering detail round trips, four canonical create hosts, owning-module failure feedback and responsive External IDs. The sidebar regression waits for native layout hydration and expands its collapsed form panel before asserting exactly one form. Cache-enabled browser reads verify independent contributor freshness; route-level regressions provide exact cold-read/cache-hit isolation. Published native UI evidence covers all 26 checkpoints, including loading, denied permission and the create-person dialog fifth host. The two test-fixture corrections receive fresh validation and CI reporting on the PR; formal independent review and human QA remain required.

## Final Compliance Report

All fourteen protected surfaces audited: discovery files, public types, signatures, import paths, event IDs, spot IDs, API URLs, database schema, DI tokens, ACL IDs, notification IDs, AI agent/tool/UI-part/override IDs, CLI commands and generated exports remain compatible. Optional types/props/results, helpers, namespace projections and new hosts are additive. Existing IDs/imports/envelope fields are preserved, and no framework, schema or dependency is introduced. Native groups remain stable with explicit aliases; no deprecation/removal is required. Applicable validation uses the local runner selected after no running compose app was found; generation outputs must be generated, not hand-edited. Independent spec and code review evidence is recorded in the tracking plan.

## Migration & Backward Compatibility

All additions must preserve the fourteen protected categories in `BACKWARD_COMPATIBILITY.md`. No schema, dependency, route, event, ACL feature, generated export, or existing host removal is planned. Canonical create spots must retain the legacy bridge. Explicit form resource identity must not reorder custom-field `entityIds` or couple version-history display to mutation identity.

## Phasing

1. Shared lifecycle participation and compatible form identity/replacement.
2. Scoped detail enrichment, cache handling, and form hydration.
3. Detail sidebars, header actions, grouped tabs, and create host coverage.
4. Real extension regression coverage, generation, full validation, independent review, and PR evidence.

## Implementation Plan

1. Add/render-independent participants and merged CrudForm lifecycle dispatch; test validation/load/save/delete/transform counts, feature/module filtering and late registration.
2. Add optional semantic resource identity, group aliases, create submit result and actual CrudForm override runtime; test backwards fallback, create after-save IDs, delayed-write/navigation order, stale child rejection and contributor-success/native-failure retry baselines.
3. Add scoped cloned overview enrichment after cold/cache-hit base reads; test native-envelope preservation, scope, permission changes and child-data freshness.
4. Retain namespaces in CRM forms and fix Example flat-key precedence/own API versioning; test pristine reload and native/contributor write separation.
5. Declare/bind sidebars/actions/tabs, adapt grouped renderers and unavailable selection; test absent widgets, collisions, labels, readiness and mobile one-form behavior.
6. Bind create surfaces using canonical/legacy shared hosts and create result IDs; exercise real extensions without adopting #5415 transport.
7. Add genuine browser round trips with self-contained fixture cleanup and extend declared create host coverage. Generate registries/catalog, run ordered configured validation, fix independent review findings, open one PR, attach evidence and release the chain lock.

## Changelog

- 2026-10-05: Initialized the compatibility repair skeleton under `om-auto-fix-issue`; root-cause analysis completed. Independent GPT-6.1 Sol review confirmed cohesion/compatibility; resolved create navigation timing, child-version retry baselines and embedded deal-create lifecycle before production edits.
