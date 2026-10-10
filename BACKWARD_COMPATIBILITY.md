# Backward Compatibility Contract

Open Mercato modules are developed by third-party developers who depend on stable platform APIs. Every surface listed below is a **public contract**. Changes to these surfaces MUST follow the deprecation protocol or they are **breaking changes** that block merge.

## Deprecation Protocol

1. **Never remove or rename** a public contract surface in a single release.
2. **Deprecate first**: add `@deprecated` JSDoc with migration guidance and the target removal version.
3. **Provide a bridge**: re-export the old name/path, accept the old signature, or keep the old behavior alongside the new one for at least one minor version.
4. **Document in UPGRADE_NOTES.md**: every deprecation and every removal must be listed with migration instructions.
5. **Spec requirement**: any PR that modifies a contract surface MUST reference a spec (in `.ai/specs/`) that includes a "Migration & Backward Compatibility" section.

### Emergency Security Exception

Steps 1-3 — stage the removal, deprecate first, ship a bridge — are waived, and **only** those three, when the contract surface being removed *is itself* the vulnerability: keeping it alongside the replacement would leave the flaw exploitable for the whole deprecation window. A surface that merely makes an insecure usage possible does not qualify; the exception applies only where continued acceptance of the old shape **is** the exploit.

This is not author or reviewer discretion. Every one of the following MUST hold, and a change that cannot satisfy all of them follows the ordinary protocol instead:

1. **The qualifying condition is argued, not asserted.** The PR names the surface, the vulnerability, and why a bridge release would keep it reachable.
2. **The removal is the narrowest one that closes the hole.** No unrelated tightening rides along, and **no partial bridge retains the vulnerable branch** behind a flag, a config toggle, or an opt-in — a retained branch is the bridge the exception exists to refuse.
3. **Steps 4 and 5 still apply in full.** An `UPGRADE_NOTES.md` entry with both client *and* operator migration instructions, and a spec under `.ai/specs/` or `.ai/specs/enterprise/` with a "Migration & Backward Compatibility" section.
4. **A dated entry is added at the end of this document**, recording the surface, its classification, the qualifying argument, and the migration path.
5. **A maintainer signs off on the exception by name.** The PR carries the `security` label and a human maintainer approval that acknowledges the waiver; an automated review cannot clear it.

Downstream authors get no bridge in this case, so the compensating obligation is disclosure. The `UPGRADE_NOTES.md` entry MUST state plainly what stops working, for whom, and what to do about it — including any stored credential or data state that becomes unusable, or that becomes newly suspect, as a result.

---

## Contract Surface Categories

### 1. Auto-Discovery File Conventions (FROZEN)

The following file names, their expected export names, and their role in module auto-discovery MUST NOT change. New convention files may be added, but existing ones are immutable.

| Convention File | Required Export | Contract |
|-----------------|---------------|----------|
| `index.ts` | `metadata: ModuleInfo` | MUST NOT rename export or change `ModuleInfo` shape in a breaking way |
| `acl.ts` | `features: Array<{id,title,module}>` | MUST NOT change array item shape; may add optional fields |
| `setup.ts` | `setup: ModuleSetupConfig` | MUST NOT remove hooks (`onTenantCreated`, `seedDefaults`, `seedExamples`, `defaultRoleFeatures`); may add optional hooks |
| `runtime.ts` | `runtime: ModuleRuntime` (or default export) | MUST NOT change `ModuleRuntime` required members (`start`) or the `ModuleRuntimeContext` / `ModuleRuntimeHandle` shape; may add optional fields and additional `ModuleRuntimeRole` values |
| `ce.ts` | `entities: CustomEntitySpec[]` | MUST NOT change `CustomEntitySpec` required fields; may add optional fields |
| `search.ts` | `searchConfig: SearchModuleConfig` | MUST NOT change `SearchEntityConfig` required fields; may add optional fields |
| `events.ts` | `eventsConfig` via `createModuleEvents()` | MUST NOT change `EventDefinition` required fields (`id`, `label`); may add optional fields |
| `extension-points.ts` | `extensionPoints: ModuleExtensionPoints` | New additive convention; declared exact/pattern host IDs, aliases, fallbacks, family/capability semantics, and bound call-site meaning MUST NOT change incompatibly |
| `translations.ts` | `translatableFields` | MUST NOT change record shape |
| `notifications.ts` | `notificationTypes: NotificationTypeDefinition[]` | MUST NOT change required fields; may add optional fields |
| `notifications.client.ts` | — | MUST NOT change renderer props contract |
| `ai-agents.ts` | `aiAgents: AiAgentDefinition[]` | MUST NOT change `AiAgentDefinition` required fields; optional sibling exports `aiAgentOverrides` and `aiAgentExtensions` are stable |
| `ai-tools.ts` | `aiTools: AiToolDefinition[]` | MUST NOT change `AiToolDefinition` / inherited `McpToolDefinition` required fields; optional sibling export `aiToolOverrides` is stable |
| `insights.explain.ts` | `explainConfig: ExplainModuleConfig` (or default export) built with `defineExplainConfig({ version: 1, ... })` | MUST NOT change the `version: 1` shape or the required fields of `ExplainResourceDescriptor` / field / collection / resolver / provider descriptors; may add optional fields; incompatible shapes require a new `version` |
| `insights.process.ts` | `processConfig: ProcessModuleConfig` (or default export) built with `defineProcessConfig({ version: 1, ... })` | MUST NOT change the `version: 1` shape or the required fields of `ProcessDescriptor` / field / milestone / exit / end-state / actor-dimension descriptors; may add optional fields; incompatible shapes require a new `version`. Persisted activity keys (`created`, `deleted`, `<field>:<value>`, `<field>:changed`, `<milestone>.<…>`, exit keys) are derived from the declaration, so renaming a declared key is a breaking change for stored projections |
| `di.ts` | `register(container)` | MUST NOT change function signature |
| `cli.ts` | default export | MUST NOT change expected signature |
| `data/entities.ts` | Entity class exports | See Database Schema rules below |
| `data/validators.ts` | Zod schema exports | MUST NOT remove or narrow existing schemas |
| `data/extensions.ts` | `extensions: EntityExtension[]` | MUST NOT change required fields (`base`, `extension`, `join`); may add optional fields |
| `widgets/injection-table.ts` | `ModuleInjectionTable` | MUST NOT change table type or spot ID resolution |
| `widgets/injection/*/widget.ts` | `InjectionWidgetModule` | MUST NOT change module shape or component props |
| `widgets/dashboard/*/widget.ts` | `DashboardWidgetModule` | MUST NOT change module shape or component props |

**Auto-discovery directory conventions** (FROZEN):

| Directory Pattern | Route Mapping | Contract |
|-------------------|--------------|----------|
| `frontend/<path>.tsx` | `/<path>` | MUST NOT change routing algorithm |
| `backend/<path>.tsx` | `/backend/<path>` | MUST NOT change routing algorithm |
| `api/<method>/<path>.ts` | `/api/<path>` by HTTP method | MUST NOT change dispatch logic |
| `subscribers/*.ts` | Event handler auto-registered | MUST NOT change metadata shape `{event, persistent?, id?}` |
| `workers/*.ts` | Queue worker auto-registered | MUST NOT change metadata shape `{queue, id?, concurrency?}` |

### 2. Type Definitions & Interfaces (STABLE)

These exported types are consumed by module developers. Required fields MUST NOT be removed or have their types narrowed. Optional fields may be added freely.

**Immutable required fields** (removing or renaming any is a breaking change):

- `Module`: `id`, `info`, `backendRoutes`, `frontendRoutes`, `apis`, `subscribers`, `workers`, `setup`
- `ModuleInfo`: `name` (all fields are optional today — keep them optional)
- `PageMetadata`: all fields remain optional; MUST NOT remove any existing field
- `ModuleSetupConfig`: `onTenantCreated`, `seedDefaults`, `seedExamples`, `defaultRoleFeatures` — MUST NOT remove
- `EventDefinition`: `id`, `label` — MUST NOT remove; `category`, `module`, `entity`, `description` — MUST NOT remove
- `EventPayload`: `id`, `tenantId`, `organizationId` — MUST NOT remove
- `EntityExtension`: `base`, `extension`, `join` — MUST NOT remove
- `ModuleExtensionPoints`: `moduleId`, `hosts` — MUST NOT remove; host declaration discriminants and exact/pattern address semantics are STABLE, and new optional metadata/capabilities may be added
- `ModuleExtensionSurfaceFacts`: `hosts`, `contributions`, `unresolved` — MUST NOT remove; host IDs/patterns, contribution identities/targets, resolution classes, activation/phases/operations, scope contracts, round-trip IDs, override identities, and sanitized unresolved provenance MUST retain their meaning
- `CustomFieldDefinition`: `key`, `kind` — MUST NOT remove; all other fields remain optional
- `CustomEntitySpec`: `id` — MUST NOT remove
- `InjectionWidgetMetadata`: `id`, `title` — MUST NOT remove
- `InjectionWidgetComponentProps`: `context`, `data`, `onDataChange`, `disabled` — MUST NOT remove
- `WidgetInjectionEventHandlers`: all existing handler names (`onLoad`, `onBeforeSave`, `onSave`, `onAfterSave`, `onBeforeDelete`, `onDelete`, `onAfterDelete`, `onDeleteError`) — MUST NOT remove or change signatures
- `SearchModuleConfig`: `entities` — MUST NOT remove; `SearchEntityConfig.entityId` — MUST NOT remove
- `NotificationTypeDefinition`: `type`, `module`, `titleKey`, `icon`, `severity`, `actions` — MUST NOT remove
- `DashboardWidgetMetadata`: `id`, `title` — MUST NOT remove
- `DashboardWidgetComponentProps`: `mode`, `layout`, `settings`, `context`, `onSettingsChange`, `refreshToken` — MUST NOT remove
- `OpenApiRouteDoc`: `methods` — MUST NOT remove
- `McpToolDefinition`: `name`, `description`, `inputSchema`, `handler` — MUST NOT remove
- `AiToolDefinition`: inherited `McpToolDefinition` fields (`name`, `description`, `inputSchema`, `handler`) — MUST NOT remove; `requiredFeatures` remains optional for legacy/plain-object compatibility; `isMutation`, `isBulk`, `isDestructive`, `loadBeforeRecord`, `loadBeforeRecords`, `maxCallsPerTurn`, and `supportsAttachments` remain optional
- `AiAgentDefinition`: `id`, `moduleId`, `label`, `description`, `systemPrompt`, `allowedTools` — MUST NOT remove; optional fields (`suggestions`, `executionMode`, `defaultModel`, `acceptedMediaTypes`, `requiredFeatures`, `uiParts`, `readOnly`, `mutationPolicy`, `maxSteps`, `output`, `resolvePageContext`, `keywords`, `domain`, `dataCapabilities`) MAY be extended but MUST NOT be narrowed
- `AiAgentPageContextInput` (the `resolvePageContext` argument): `entityType`, `recordId`, `container`, `tenantId`, `organizationId` — MUST NOT remove. `userId?` was added 2026-08-06 as an additive optional field carrying the authenticated caller (see [issue #5049](https://github.com/open-mercato/open-mercato/issues/5049)); it MUST stay optional so existing resolvers and construction sites keep compiling, and it MUST be sourced from the server-side auth context, never from the browser-supplied page context. `composeSystemPrompt`'s `userId` parameter is likewise trailing and optional — existing five-argument callers keep working and receive `userId: null`.
- `AiAgentExtension`: `targetAgentId` — MUST NOT remove; patch fields (`replaceAllowedTools`, `deleteAllowedTools`, `appendAllowedTools`, `replaceSystemPrompt`, `appendSystemPrompt`, `replaceSuggestions`, `deleteSuggestions`, `appendSuggestions`) MUST keep their existing meaning; deprecated `suggestions` remains an append alias until removed through the deprecation protocol
- `AiAgentOverridesMap` / `AiToolOverridesMap`: `Record<string, AiAgentDefinition | null>` and `Record<string, AiToolDefinition | null>` semantics are STABLE; `null` means disable
- `ModuleOverrides`: `overrides.ai.agents`, `overrides.ai.tools`, and `overrides.ai.extensions` shapes are STABLE; other domain keys are reserved by the unified override contract and may be wired additively. `nav` was wired 2026-07-30 under that clause (see [spec](.ai/specs/2026-07-30-nav-group-order-override-domain.md)): `overrides.nav.groupOrder` **prepends** sidebar nav group ids ahead of the built-in `defaultGroupOrder`, and ids it does not name keep their existing position. It is a default applied *beneath* role and per-user sidebar preferences, so an operator's own arrangement still wins. With no override configured, group ordering is byte-identical to before — that guarantee MUST hold for any future change to this domain.
- `ModulesRegisteredListener` (`@open-mercato/shared/lib/modules/registry`): added 2026-08-12 as `(modules: Module[]) => void | PromiseLike<void>` (see [spec](.ai/specs/2026-08-12-module-registry-registration-listeners.md)). The listener MUST keep receiving the reconciled module list, and the return type MUST NOT be narrowed back to `void` — a subscriber returning a promise is supported and its rejection is observed and logged rather than escaping into bootstrap.
- `WorkerMeta`: `queue` — MUST NOT remove
- `TelemetryProvider` (`@open-mercato/telemetry`): `name`, `supports`, `start`, `shutdown`, `runInSpan`, `activeSpan`, `activeTraceContext`, `inject`, `runInRemoteSpan`, `emitLog`, `recordMetric` — MUST NOT remove. `reportError?()` was added 2026-09-08 as an additive OPTIONAL method (see [spec](.ai/specs/2026-09-08-error-reporting-policy.md)); it **MUST stay optional** — third parties implement this interface and a required method would break every existing provider. The facade calls it as `provider.reportError?.(…)` *in addition to* the span/log/metric path, so a provider that omits it loses nothing.
- `ReportErrorContext` (`@open-mercato/telemetry`) and the `reportError` context of `TelemetryRuntime` (`@open-mercato/shared/lib/telemetry/runtime`): `module?` and `attributes?` — MUST NOT remove. `code?: string` was added 2026-09-08 as an additive optional field carrying the enumerated `module.reason` fingerprint the backend groups on; it MUST stay optional so existing callers (the API dispatcher, the CRUD factory) keep compiling and keep emitting exactly what they emit today. `om.errors` gains an `error.code` label only when a caller supplies one — the same attribute name the span and the log record use, so one query works against all three.
- `RefreshCredentialsInput` (communication_channels hub): `channelId`, `credentials`, `scope` — MUST NOT remove. `oauthClient?` was added 2026-05-27 as an additive optional field (see [Spec A](.ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md)). The legacy `credentials._client` read path in the Gmail adapter was **removed** (see #3828 / UPGRADE_NOTES) — OAuth client config MUST be passed via `RefreshCredentialsInput.oauthClient`.
- `OAuthClientConfig` (communication_channels hub): added 2026-05-27 with `clientId` required; optional `clientSecret`, `tenantId`, `scopes`. New optional fields may be added; required `clientId` MUST NOT be removed.
- `BackendChromePayload`: `groups`, `settingsSections`, `settingsPathPrefixes`, `profileSections`, `profilePathPrefixes`, `grantedFeatures`, `roles` — MUST NOT remove. `currentOrganization?` (`BackendChromeCurrentOrganization | null`) was added 2026-07-30 as an additive optional field (see [spec](.ai/specs/2026-07-30-backend-chrome-current-organization.md)); it is `null` under an all-organizations selection, when no organization is in scope, and when the lookup fails, so consumers MUST treat `null` as "unknown" rather than "no organization". `brand?` is **unchanged** and remains the branding channel — it populates only when the organization has a `logoUrl`, and `currentOrganization` does not supersede it.

**STABLE field shape, changed value semantics in 0.6.8:** each entry in `BackendChromePayload.settingsSections` keeps its `id`, `label`, `labelKey`, `order`, and `items` fields, but `id` is now the section's **untranslated group id** (the page's `pageGroupKey`, e.g. `settings.sections.moduleConfigs`) instead of a slug of the rendered group label. The old value was locale-dependent, so it could not be targeted reliably (see [#4843](https://github.com/open-mercato/open-mercato/issues/4843)). Consumers matching a settings section — notably injected `menuItems[].groupId` — MUST use the group id, which is the form the widget-injection documentation already prescribes. `buildSettingsSections`' `sectionOrder` parameter keeps a deprecated fallback lookup on the old label slug for at least one minor release.

**STABLE field shape, changed value semantics:** `BackendChromePayload.profileSections` keeps the same entry shape but is no longer the hard-coded single-entry list. It is now the static baseline (the `navHidden` pages route discovery cannot see, currently `/backend/profile/change-password`) merged with every page declaring `pageContext: 'profile'`, so a module contributing a per-user page reaches the profile sidebar the same way it already reaches the profile dropdown (see [#5594](https://github.com/open-mercato/open-mercato/issues/5594)). Two consequences for consumers: the built-in account section `id` changed from the label slug `account` to the untranslated group id `profile.sections.account`, matching the settings convention above — an injected `menuItems[].groupId` targeting `account` MUST be updated, and the one in-repo consumer (`security.injection.profile-sidebar-security-item` in `@open-mercato/enterprise`) was updated in the same change; and `profilePathPrefixes` now also carries each resolved section item's own `href`, which is additive and stays a prefix list. The `profileSections` constant exported from `@open-mercato/core/modules/auth/lib/profile-sections` keeps its import path, its export name and its runtime value, but its declared type narrows from `SectionNavGroup[]` to `SettingsSection[]` (`order` required rather than optional). Reading it — including assigning it to a `SectionNavGroup[]` — is unaffected; only code that pushes an order-less section onto the exported array would need to add `order`.

### 3. Function Signatures (STABLE)

These functions are called directly by module code. Their signatures MUST NOT change in a breaking way. New optional parameters may be added.

| Function | Package | Contract |
|----------|---------|----------|
| `createModuleEvents(options)` | `@open-mercato/shared/modules/events` | MUST NOT change `options` required shape or return type |
| `makeCrudRoute(opts)` | `@open-mercato/shared/lib/crud/factory` | MUST NOT remove existing `opts` fields; MUST NOT change return shape |
| `findWithDecryption(em, entityName, where, options?, scope?)` | `@open-mercato/shared/lib/encryption/find` | MUST NOT change parameter order or required params |
| `findOneWithDecryption(...)` | `@open-mercato/shared/lib/encryption/find` | Same as above |
| `findAndCountWithDecryption(...)` | `@open-mercato/shared/lib/encryption/find` | Same as above |
| `entityId(moduleId, entity)` | `@open-mercato/shared/modules/dsl` | MUST NOT change |
| `defineLink(base, extension, opts)` | `@open-mercato/shared/modules/dsl` | MUST NOT change |
| `defineModuleExtensionPoints(declaration)` | `@open-mercato/shared/modules/widgets/extension-points` | MUST preserve immutable data-only declaration semantics and exact module/host values |
| `injectionExtensionHost`, `dataTableExtensionHost`, `crudFormExtensionHost`, `componentExtensionHost` | `@open-mercato/shared/modules/widgets/extension-points` | MUST preserve family discrimination, exact/pattern validation, and returned IDs |
| `defineFields(entity, fields, source?)` | `@open-mercato/shared/modules/dsl` | MUST NOT change |
| `cf.text`, `cf.multiline`, `cf.integer`, `cf.float`, `cf.boolean`, `cf.select`, `cf.currency`, `cf.dictionary` | `@open-mercato/shared/modules/dsl` | MUST NOT remove any helper or change required params |
| `lazyDashboardWidget(loader)` | `@open-mercato/shared/modules/dashboard/widgets` | MUST NOT change |
| `registerMcpTool(tool, options?)` | `@open-mercato/ai-assistant` | MUST NOT change |
| `defineAiAgent(definition)` | `@open-mercato/ai-assistant` | MUST NOT change parameter or return shape |
| `defineAiAgentExtension(extension)` | `@open-mercato/ai-assistant` | MUST NOT change parameter or return shape |
| `defineAiTool(definition)` | `@open-mercato/ai-assistant` | MUST NOT change parameter or return shape |
| `applyAiAgentOverrides(overrides)` | `@open-mercato/ai-assistant` | MUST preserve map semantics and precedence |
| `applyAiToolOverrides(overrides)` | `@open-mercato/ai-assistant` | MUST preserve map semantics and precedence |
| `applyAiAgentExtensions(extensions)` | `@open-mercato/ai-assistant` | MUST preserve append/patch semantics |
| `applyAiOverridesFromEnabledModules(modules)` | `@open-mercato/ai-assistant` | MUST keep accepting the `overrides.ai` module-entry shape |
| `prepareMutation(input, context)` | `@open-mercato/ai-assistant` | MUST NOT bypass pending-action approval semantics or change required params |
| `runAiAgentText(input)` / `runAiAgentObject(input)` | `@open-mercato/ai-assistant` | MUST NOT remove existing input fields or narrow output shape |
| `applyModuleOverridesFromEnabledModules(modules)` | `@open-mercato/shared/modules/overrides` | MUST keep dispatching `entry.overrides.<domain>` by module-load order |
| `registerModuleOverrideApplier(domain, applier)` | `@open-mercato/shared/modules/overrides` | MUST NOT change registration semantics |
| `onModulesRegistered(listener)` | `@open-mercato/shared/lib/modules/registry` | MUST keep accepting a single listener and returning an unsubscribe function; MUST keep notifying synchronously after `setGlobalModules()`; MUST stay fail-soft for a listener that throws or rejects. Full contract: [spec](.ai/specs/2026-08-12-module-registry-registration-listeners.md) |
| `apiCall` / `apiCallOrThrow` / `readApiResultOrThrow` | `@open-mercato/ui/backend/utils/apiCall` | MUST NOT change |
| `useT()` | `@open-mercato/shared/lib/i18n/context` | MUST NOT change return type |
| `resolveTranslations()` | `@open-mercato/shared/lib/i18n/server` | MUST NOT change |
| `createCrudOpenApiFactory(config)` | `@open-mercato/shared/lib/openapi/crud` | MUST NOT change |
| `collectCustomFieldValues()` | `@open-mercato/ui/backend/utils/customFieldValues` | MUST NOT change |
| `flash()` | `@open-mercato/ui` | MUST NOT change |
| `CrudForm` component props | `@open-mercato/ui/backend/crud` | MUST NOT remove existing props |
| Built-in `CrudFormGroup.id` values | any module's form-group builder (e.g. `createCompanyFormGroups`) | MUST NOT rename or remove an id a shipped form declares — `CrudForm`'s `hiddenGroupIds` addresses groups by id, and an unmatched id is ignored, so a rename makes a card the host hid silently reappear in production. Renames follow the deprecation protocol; pin a builder's ids with a guard test (pattern: `packages/core/src/modules/customers/components/__tests__/companyFormHiddenGroups.test.tsx`). MAY add new groups freely |
| `DataTable` component props | `@open-mercato/ui/backend` | MUST NOT remove existing props |
| `parseBooleanToken` / `parseBooleanWithDefault` | `@open-mercato/shared/lib/boolean` | MUST NOT change |

### 4. Import Paths (STABLE)

All documented import paths in the "When You Need an Import" table and in package AGENTS.md files are public API. If a module is moved internally, the old import path MUST be re-exported for backward compatibility with a `@deprecated` annotation.

### 5. Event IDs (FROZEN)

Published event IDs (declared in any module's `events.ts`) are consumed by subscribers in other modules and by workflow triggers. Changing an event ID is a **breaking change**.

- MUST NOT rename an existing event ID
- MUST NOT remove an existing event ID
- MUST NOT change an event's payload shape in a way that removes existing fields
- MAY add new optional fields to event payloads
- MAY add new event IDs freely
- To retire an event: deprecate it, emit both old and new IDs during the bridge period, then remove after one minor version

### 6. Widget Injection Spot IDs (FROZEN)

Spot IDs are the addresses where external modules inject UI. Renaming or removing a spot ID silently breaks all modules targeting it.

- MUST NOT rename an existing spot ID (e.g., `crud-form:catalog.product`, `sales.document.detail.order:tabs`, `backend:record:current`)
- MUST NOT remove an existing spot ID from a page
- MUST NOT change the context/data type passed to widgets at existing spots
- MAY add new spot IDs to new or existing pages
- MAY add new optional context fields to existing spots
- Wildcard spots (`crud-form:*`, `data-table:*`) MUST continue to match as documented
- Field-level spots (`crud-form:<entityId>:field:<fieldId>:after`) are reached only by exact keys or by wildcard patterns that name the `:field:` segment (e.g. `crud-form:customers.deal:field:*:after`); a broad wildcard such as `crud-form:*` keeps matching every form-level spot but never resolves into a field-level spot

### 7. API Route URLs (STABLE)

External tools, frontends, and integrations depend on API URL patterns.

- MUST NOT rename or remove an existing API route URL
- MUST NOT change the HTTP method for an existing operation
- MUST NOT remove fields from existing response schemas
- MAY add new optional fields to request/response schemas
- MAY add new API routes freely
- To retire a route: deprecate with `deprecated: true` in `openApi`, keep it functional for at least one minor version, then remove

### 8. Database Schema (ADDITIVE-ONLY)

Module developers create entities and run migrations. Core schema changes can break their data.

- MUST NOT rename existing tables or columns
- MUST NOT remove existing columns (use soft-deprecation: stop writing, keep column)
- MUST NOT change column types in a narrowing way (e.g., `text` → `varchar(50)`)
- MUST NOT remove or rename indexes that modules may depend on
- MUST NOT change the standard column contract (`id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`, `tenant_id`)
- MAY add new columns with defaults (non-breaking)
- MAY add new tables freely
- MAY add new indexes freely
- MAY widen column types (e.g., `varchar(100)` → `text`)
- Foreign key column names on core entities (e.g., `organization_id`, `tenant_id`) are frozen

### 9. DI Service Names (STABLE)

Module code resolves services by name from the Awilix container. Renaming a DI registration breaks all resolvers.

- MUST NOT rename existing DI service registration keys
- MUST NOT change the interface of a resolved service in a breaking way
- MAY add new DI registrations freely
- MAY add optional methods to existing service interfaces
- `calendarEventTypeRegistry` (Customers): the registration key and the `upsert`, `replace`, `patch`, `remove`, `removeSource`, and `snapshot` operations are STABLE additive contracts. Contributor modules may resolve it softly when Customers is optional.

### 10. ACL Feature IDs (FROZEN)

Feature IDs are stored in database role configurations. Renaming a feature ID orphans existing role assignments.

- MUST NOT rename an existing feature ID
- MUST NOT remove an existing feature ID without a data migration that updates all stored role configs
- MAY add new feature IDs freely
- App-level `entry.overrides.acl.features[id] = null` is the supported reversible exception: stored grants are preserved but runtime-inert while the override is effective.

**STABLE capability-field shape, changed value semantics in 0.6.6:** `BackendChromePayload.grantedFeatures` and customer portal `resolvedFeatures` remain `string[]`, but now contain concrete effective feature IDs. They no longer expose `*` or namespace wildcard strings. Consumers MUST check concrete IDs and MUST NOT infer staff/portal admin status from a wildcard; use the explicit admin boolean where exposed.

### 11. Notification Type IDs (FROZEN)

Notification types are referenced by subscribers, stored in database records, and rendered by client-side renderers.

- MUST NOT rename a `type` string on `NotificationTypeDefinition`
- MUST NOT remove an existing notification type
- MAY add new notification types freely

### 12. AI Agent, Tool, UI Part, and Override IDs (FROZEN / STABLE)

AI framework registries are public extension points. Published IDs are referenced by module code, generated registries, app-level overrides, tenant prompt/policy overrides, launcher UI, and `allowedTools` arrays.

**FROZEN IDs:**

- MUST NOT rename an existing `AiAgentDefinition.id`
- MUST NOT rename an existing `AiToolDefinition.name`
- MUST NOT rename an existing AI UI part `componentId`
- MUST NOT rename reserved AI UI part IDs (`mutation-preview-card`, `field-diff-card`, `confirmation-card`, `mutation-result-card`)
- MUST NOT change the meaning of `null` in `AiAgentOverridesMap` / `AiToolOverridesMap`; it always means "disable this agent/tool"
- MUST NOT change the meaning of `AiAgentDefinition.allowedTools`; entries are tool names and missing/disabled tools are omitted by the runtime with a warning

**STABLE override surfaces:**

- Per-module override exports MUST remain co-located in module-root `ai-agents.ts` / `ai-tools.ts`: `aiAgentOverrides`, `aiAgentExtensions`, `aiToolOverrides`
- App-level overrides MUST remain under `ModuleEntry.overrides.ai.agents`, `ModuleEntry.overrides.ai.tools`, and `ModuleEntry.overrides.ai.extensions`
- Programmatic overrides MUST keep highest precedence: `applyAiAgentOverrides`, `applyAiToolOverrides`, and `applyAiAgentExtensions`
- Resolution order MUST remain: programmatic → `modules.ts` inline → file-based override exports → base registrations
- `AiAgentExtension` patch order MUST remain: `replace*` first, `delete*` second, `append*` last
- Override value validation MUST keep key/value matching semantics: a non-null agent override's `id` must equal the map key; a non-null tool override's `name` must equal the map key

**Mutation approval contract:**

- AI write tools MUST keep using `isMutation: true` and the `prepareMutation(...)` pending-action flow
- `AiAgentMutationPolicy` values (`read-only`, `confirm-required`, `destructive-confirm-required`) MUST NOT be renamed or repurposed
- Tenant prompt and mutation-policy override tables/API contracts are STABLE; fields may be added, but existing policy values and agent IDs must continue to resolve

To retire an AI agent or tool: deprecate it, keep the old ID available or bridged for at least one minor version, update any shipped `allowedTools` references, and document migration instructions in the referenced spec and release notes.

### 13. CLI Commands (STABLE)

- MUST NOT rename or remove existing CLI commands or their required flags
- MAY add new commands or optional flags freely

### 14. Generated File Contracts (STABLE)

Files in `apps/mercato/.mercato/generated/` are produced by the CLI generators. The generator output shape MUST remain compatible with the bootstrap consumer.

- MUST NOT change the export names of generated files
- MUST NOT change the `BootstrapData` type's required fields
- MUST NOT remove AI generated registry exports: `aiAgentConfigEntries`, `allAiAgents`, `aiAgentOverrideEntries`, `aiAgentExtensionEntries`, `allAiAgentExtensions`, `aiToolConfigEntries`, `allAiTools`, `aiToolOverrideEntries`
- MUST NOT change generated AI entry shapes: agent entries keep `{ moduleId, agents, overrides, extensions }`; tool entries keep `{ moduleId, tools, overrides }`
- MAY add new generated files and new optional fields to `BootstrapData`
- MUST NOT rename `insights-explain.generated.ts` or its `explainConfigEntries` export (`{ moduleId, config }` entries registered at bootstrap through `registerExplainConfigEntries`)
- MUST NOT rename `insights-process.generated.ts` or its `processConfigEntries` export (`{ moduleId, config }` entries registered through `registerProcessConfigEntries`)
- MUST NOT rename `bootstrap-registrations.cli.generated.ts` or its `runCliBootstrapRegistrations` export: CLI and worker processes (`bootstrapFromAppRoot`) run the generator-plugin registrations that opt in with `bootstrapRegistration.cli: true`; the file is always written
- MAY add new generated AI registry exports additively
- Generated `.ai/guides/module-facts.json` is the v1 compatibility projection. It keeps its existing top-level module record and legacy sections; optional per-module `extensionSurfaces` is ADDITIVE. Its `hosts`, `contributions`, and `unresolved` arrays, correlation-resolution values, exact public IDs, and published classification modes are STABLE.
- Generated `.ai/guides/module-facts.v2.json` is the additive corrected projection and keeps the same `Record<moduleId, ModuleFactsJsonEntry>` top-level shape. New harness consumers prefer v2 and fall back to v1. Once published, v2 values follow the same generated-facts stability rules; future incompatible corrections require another explicit version boundary.
- Generated `.ai/guides/framework-extension-points.md` is a sibling framework-owned catalog, not a synthetic module-facts key. Existing module Markdown headings, including `Host extension points`, MUST remain available; additive `UMES hosts`/`UMES contributions` sections may not redefine existing IDs.

---

## Allowed vs Breaking Changes — Quick Reference

| Surface | Add new | Add optional field | Remove field | Rename | Change type |
|---------|---------|-------------------|-------------|--------|-------------|
| Convention files | OK | OK | BREAKING | BREAKING | BREAKING |
| Type interfaces | OK | OK | BREAKING | BREAKING | BREAKING (narrowing) |
| Function params | OK (optional) | OK | BREAKING | BREAKING | BREAKING |
| Event IDs | OK | OK (payload) | BREAKING | BREAKING | n/a |
| Spot IDs | OK | OK (context) | BREAKING | BREAKING | BREAKING (context) |
| API routes | OK | OK (req/res fields) | BREAKING (res fields) | BREAKING | BREAKING |
| DB columns | OK (with default) | n/a | BREAKING | BREAKING | BREAKING (narrowing) |
| DI names | OK | OK | BREAKING | BREAKING | BREAKING |
| Feature IDs | OK | n/a | BREAKING* | BREAKING | n/a |
| AI agent/tool IDs | OK | OK | BREAKING | BREAKING | BREAKING |
| AI override surfaces | OK | OK | BREAKING | BREAKING | BREAKING |
| Import paths | OK | n/a | BREAKING | BREAKING | n/a |
| Generated registry exports | OK | OK | BREAKING | BREAKING | BREAKING |

\* Feature ID removal requires a data migration.

---

## Per-User Integration Credentials (2026-05-26)

`.ai/specs/2026-05-21-email-integration-foundation.md` adds optional per-user scoping to integration credentials so two users on the same tenant can connect their own mailbox (Gmail / IMAP) without sharing one row. **All changes are additive** and pass the contract-surface checks above:

| Surface | Change | Classification |
|---------|--------|----------------|
| Type interface (`IntegrationScope`) | New **optional** field `userId?: string \| null` | ✓ ADDITIVE (Type interface, optional field) |
| Database schema | New nullable column `integration_credentials.user_id uuid` via additive migration `Migration20260526154136`, plus partial unique index `integration_credentials_user_lookup_idx` on `(integration_id, organization_id, tenant_id, user_id)` `WHERE user_id IS NOT NULL AND deleted_at IS NULL` | ✓ ADDITIVE (NULL default; the partial index leaves existing tenant-wide rows untouched) |
| `createCredentialsService` API | `getRaw` / `resolve` / `save` / `saveField` signatures unchanged; when `scope.userId` is falsy the lookup filter pins `user_id = NULL`, reproducing the prior tenant-wide behaviour exactly | ✓ Behaviour-preserving for existing callers |

**Migration path for existing tenants**: no action required. Existing integrations keep their single `user_id IS NULL` row and resolve exactly as before; only callers that pass `scope.userId` (the new per-user channels) read or write user-scoped rows.

---

## Spec C — Provider Push Delivery (2026-05-27)

`.ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md` extends the communication-channels module with provider push delivery. **All changes are additive** and pass the contract-surface checks above:

> **Update (2026-06-02):** the Microsoft Graph push surfaces (the two `/webhooks/microsoft/*` routes, the `…-microsoft-delta-sync` / `…-microsoft-renew-subscriptions` queues, and `OM_MICROSOFT_WEBHOOK_BASE_URL` / `OM_PUSH_RENEWAL_MICROSOFT_LEAD_HOURS`) were removed together with the `@open-mercato/channel-microsoft` provider — they never shipped in a release, so the removal is not a breaking change. The rows below reflect the Gmail-only surfaces that remain. The `client_state_encrypted` column — proposed solely for Microsoft Graph's anti-tampering nonce — was dropped from scope together with the provider before this branch's migrations were finalized; it appears in no committed migration or snapshot, so there is no schema change to reconcile.

| Surface | Change | Classification |
|---------|--------|----------------|
| Adapter type interface (`ChannelAdapter`) | Three new **optional** methods: `registerPush?`, `unregisterPush?`, `applyPushNotification?` | ✓ ADDITIVE (Type interface, optional fields) |
| Adapter input/output types | New exported types: `PushRegistration`, `RegisterPushInput`, `UnregisterPushInput`, `ApplyPushNotificationInput` | ✓ ADDITIVE (new types, no rename) |
| Event IDs | Four new events: `communication_channels.push.{registered,failed,renewed,deactivated}` | ✓ ADDITIVE (new event IDs) |
| ACL feature IDs | One new feature: `communication_channels.channel.push.manage` | ✓ ADDITIVE (new feature ID) |
| API routes | Two new routes: `/webhooks/gmail`, `/channels/[id]/push/register` | ✓ ADDITIVE (new routes) |
| Database schema | No change. The `client_state_encrypted` column proposed for Microsoft Graph was removed from scope before the migrations were finalized — it is absent from every committed migration and the snapshot. | ✓ No net schema change |
| Queue names | Two new queues: `…-gmail-history-sync`, `…-gmail-renew-watch` | ✓ ADDITIVE |
| Env vars | New optional: `OM_GMAIL_PUBSUB_TOPIC`, `OM_GMAIL_PUBSUB_AUDIENCE`, `OM_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL`, `OM_PUSH_RENEWAL_GMAIL_LEAD_HOURS` | ✓ ADDITIVE |
| Polling cadence | `pollIntervalSeconds` flips 60 → 1800 only when `pushStatus='active'` is persisted. Non-push channels unchanged. | ✓ Behavior-preserving for existing channels |

**Migration path for existing tenants**: no action required. Push is opt-in per channel — until an operator explicitly registers (via connect flow or `POST /push/register`), Gmail channels keep polling on the Spec B baseline. The new ACL feature `communication_channels.channel.push.manage` must be granted via `yarn mercato auth sync-role-acls` post-deploy for the "Re-register push" button to appear.

---

## Command Interceptor HTTP Status (2026-08-06)

`.ai/specs/2026-08-06-command-interceptor-http-status.md` lets a command interceptor's deliberate rejection carry an HTTP status and body, so a business block surfaces as (for example) `422` instead of a generic `500`. **All changes are additive** and pass the contract-surface checks above:

| Surface | Change | Classification |
|---------|--------|----------------|
| Type interface (`CommandInterceptorBeforeResult`) | Two new **optional** fields: `status?: number`, `body?: Record<string, unknown>` | ✓ ADDITIVE (Type interface, optional fields) |
| Function signature (`CommandInterceptorError` constructor) | New **optional** second parameter `options?: { status?, body?, cause? }` | ✓ ADDITIVE (optional parameter appended; every `new CommandInterceptorError(message)` call site compiles and behaves identically) |
| Function return types (`runCommandInterceptorsBefore`, `runCommandInterceptorsBeforeUndo`) | Returned `error` widens from `{ message: string }` to `{ message: string; status?: number; body?: Record<string, unknown> }` | ✓ ADDITIVE (a widened return type is safe for readers; callers reading `.message` are unaffected) |
| Import path / exports (`@open-mercato/shared/lib/commands`) | New exports: `isCommandInterceptorError`, `getCommandInterceptorHttpRejection`, `CommandInterceptorErrorOptions`, `CommandInterceptorHttpRejection`. `CommandInterceptorError` keeps its existing export | ✓ ADDITIVE (new exports, nothing removed or renamed) |
| HTTP response shapes (`makeCrudRoute` handlers, `POST /api/audit_logs/audit-logs/actions/undo`) — the two transports that shipped with the original spec | A rejection **that sets a status** answers with it; a rejection that sets none keeps the byte-identical generic `500` (CRUD) / `400 Undo failed` (undo) | ✓ Behaviour-preserving for existing interceptors (regression-tested in `crud-factory.test.ts` and `undo.route.test.ts`) |
| HTTP response shapes (direct `commandBus.execute` routes) — the transport rollout in [#5181](https://github.com/open-mercato/open-mercato/pull/5181) (issue [#5097](https://github.com/open-mercato/open-mercato/issues/5097)) | The same mapping now reaches every first-party transport that owns its `try/catch`: 80 branches across 67 `packages/core` route files, one inline branch in `packages/enterprise/.../security/api/profile/password`, one inline branch in `packages/channel-discord/.../api/channels/[id]/ai-auto-reply`, and six module-level error mappers (`handleCheckoutRouteError`, `handleDocumentsRouteError`, `mapSudoError`, `mapMfaError`, `mapEnforcementError`, `mapSecurityUsersError`) covering 14 further bus-calling routes in `checkout`, `enterprise`-security and `documents`. A rejection that sets **no** status keeps each route's byte-identical historical answer, as do `CrudHttpError`, `ZodError` and optimistic-lock conflicts | ✓ Behaviour-preserving for existing interceptors (pinned per response shape by behavioural tests in each affected package, and held against regression by the static guard `packages/core/src/__tests__/command-interceptor-http-coverage.test.ts`) |
| HTTP response shapes — deliberately **not** covered | 17 routes call the bus where no `catch` can receive the rejection (tracked in [#5435](https://github.com/open-mercato/open-mercato/issues/5435)), and the two `eudr` batch routes (`plots/import`, `product-mappings/suggestions/apply`) keep their published `HTTP 200` + `failed[]` contract because every bus call there sits behind a per-item `catch` | ✓ No change (both exemption lists are asserted in both directions by the static guard, so neither can rot silently) |
| Database schema, event IDs, ACL features, DI names, CLI commands | No change | ✓ n/a |

**Migration path for existing modules**: no action required. The capability is opt-in per rejection — an interceptor that never sets `status` produces exactly the responses it produced before. Interceptors that want a deliberate status add `status` (and optionally `body`) to the `{ ok: false, message }` verdict they already return. First-party transports that call `commandBus.execute` inside their own `try/catch` **now do** honour the contract as of [#5181](https://github.com/open-mercato/open-mercato/pull/5181): every such route consults `getCommandInterceptorHttpRejection(err)` — directly, or through the module-level error mapper it already delegates to — immediately after its `isCrudHttpError` branch, or first in the `catch` where there is none, and the static coverage guard fails when a new bus-calling route ships without it. Third-party transports honour the same contract in the same two lines via `getCommandInterceptorHttpRejection(err)`, which validates the status is an integer in 400-599 before returning it.

---

## Canonical API Interceptor Route Identity (2026-10-04)

API dispatch and API-interceptor selection now share the same matched-route identity.
This closes a policy bypass where a mixed-case or percent-encoded spelling dispatched
to a handler but did not select its exact `before` interceptor.

| Surface | Change | Classification |
|---------|--------|----------------|
| Function signature (`findApiRouteManifestMatch`) | New optional fourth parameter `request?: Request`; existing three-argument callers keep the same return value and matching behavior | ✓ ADDITIVE (optional parameter appended) |
| API route URLs and handler context | No route is added, removed, or renamed; handler `params` and request query semantics are unchanged | ✓ No contract change |
| Interceptor selection | Static segments use the matched manifest spelling, while matched dynamic/catch-all values stay concrete. Alternate spellings that already reached a route now run the same exact/prefix interceptors as its normal spelling; malformed percent encoding reaches no handler | ⚠️ Intentional security narrowing only (previous policy-bypass requests are denied or intercepted) |
| Request cloning/reconstruction | Dispatcher identity survives `Request.clone()` and `new Request(request.url, request)`. Unknown, forged, or evicted internal continuity metadata fails closed; unbound direct handlers retain legacy URL-derived matching | ✓ Behavior-preserving for valid dispatches; intentional security narrowing for forged metadata |
| Handler ordering | Authorization and interceptor `before`/`after` positions are unchanged | ✓ Behavior-preserving for normally spelled requests |

**Migration path for existing modules**: none. Keep authored `targetRoute` values.
Callers that dispatch through the framework catch-all receive canonical binding
automatically; direct three-argument matcher consumers continue to work unchanged.
Synthetic dispatchers should pass the exact request they invoke as argument four.
Request wrappers should retain headers when reconstructing the request, or pass an
authored route constant directly to the interceptor runner.

---

## CRUD Foreign-Key Violations Answer 409 (2026-09-07)

Deleting a user who had customised their sidebar failed on the `user_sidebar_preferences` / `sidebar_variants` foreign keys and surfaced as a generic `500`. The fix clears those rows in `auth.users.delete`, gives both FKs `ON DELETE CASCADE`, and teaches `makeCrudRoute` to recognise a Postgres foreign-key violation (SQLSTATE 23503). **All changes are additive** and pass the contract-surface checks above:

| Surface | Change | Classification |
|---------|--------|----------------|
| Import path / exports (`@open-mercato/shared/lib/db/pg-errors`) | New exports `isForeignKeyViolation(err)` and `getForeignKeyViolationConstraint(err)` | ✓ ADDITIVE (new exports, nothing removed or renamed) |
| HTTP response shapes (`makeCrudRoute` handlers) | A handler that throws a Postgres foreign-key violation now answers `409 { error, code: 'FOREIGN_KEY_VIOLATION', requestId }` with an `x-request-id` header, where it previously answered the generic `500 { error, message, requestId }`. The constraint name is logged and reported to telemetry but never returned to the client. Every other error class keeps its byte-identical historical answer | ⚠️ Behaviour change for one error class only. No retained response loses a field, but a client that treated the old `500` as retryable now receives a non-retryable `409`. Regression-tested in `crud-factory.test.ts` |
| Database schema (`user_sidebar_preferences_user_id_foreign`, `sidebar_variants_user_id_foreign`) | Both constraints are dropped and recreated with `on update cascade on delete cascade` (`Migration20260907120000_auth`). No table or column is added, renamed, removed or retyped, and `down()` restores each constraint to its original definition | ✓ ADDITIVE-ONLY compatible (delete behaviour widened, nothing narrowed) |
| Command behaviour (`auth.users.delete`, `auth.users.create` undo) | The dependent-row cascade also clears `user_sidebar_preferences` and `sidebar_variants`. Those rows are not captured by `UserUndoSnapshot`, so undoing a user delete restores the user, roles, ACLs and custom fields but not the sidebar customisation. `user_consents` is deliberately left untouched | ✓ Behaviour-preserving for every delete that succeeded before; deletes that previously failed with `500` now succeed |
| Event IDs, ACL features, DI names, CLI commands | No change | ✓ n/a |

**Migration path for existing modules**: no action required. A client that branched on `5xx` for foreign-key failures should treat `409` with `code: 'FOREIGN_KEY_VIOLATION'` as the same condition; it was never retryable.

---

## Encrypt Path Rejects Wrong-Key Ciphertext (2026-09-11)

`TenantDataEncryptionService.encryptFields` treats "already encrypted" as "decrypts under the current DEK" — a deliberate anti-forgery choice ([#2720](https://github.com/open-mercato/open-mercato/issues/2720)). Real ciphertext sealed under a *different* key failed that check too and was encrypted a second time, producing a nested envelope that no read path can undo, plus a lookup hash computed over ciphertext ([#5951](https://github.com/open-mercato/open-mercato/issues/5951)). That write is now rejected:

| Surface | Change | Classification |
|---------|--------|----------------|
| Import path / exports (`@open-mercato/shared/lib/encryption/aes`) | New export `isEncryptedPayloadShape(value)` — a key-free structural check (`<iv>:<ct>:<tag>:v1` with a 12-byte IV, 16-byte tag and non-empty ciphertext). Explicitly NOT an "is this encrypted" oracle; the shape is forgeable | ✓ ADDITIVE (new export, nothing removed or renamed) |
| Function behaviour (`encryptEntityPayload` / `encryptFields`) | A field holding a structurally well-formed envelope that does not decrypt under the current DEK now raises `TenantDataEncryptionError` with code `WRONG_KEY`, where it previously returned a payload containing a nested envelope. Signature, return type and every other input keep their byte-identical historical behaviour | ⚠️ Behaviour change on one previously-corrupting path. `WRONG_KEY` was already declared in `TenantDataEncryptionErrorCode` and emitted nowhere, so no existing handler changes meaning. Regression-tested in `tenantDataEncryptionService.test.ts` |
| Encryption-at-rest guarantee (#2720) | Unchanged. Nothing is ever stored verbatim: a forgery whose shape is not length-valid (the check is length-based, not content-based) still fails the structural check and is encrypted as ordinary plaintext, and a length-valid one is rejected rather than persisted | ✓ Preserved (pinned by the retained `#2720` test cases) |
| CLI behaviour (`mercato entities rotate-encryption-key`, `… backfill-system-encryption`) | A row whose ciphertext opens under neither `--old-key` nor the current tenant key is reported and skipped instead of rewritten; the backfill no longer passes already-encrypted columns to the encrypt path. Rows that rotated or backfilled successfully before are unaffected | ✓ Behaviour-preserving for every row that succeeded before; a row that was previously corrupted is now skipped instead — `rotate-encryption-key --old-key` reports it in the run summary, while `backfill-system-encryption` and `rotate-encryption-key` without `--old-key` skip it silently (see UPGRADE_NOTES.md) |
| DB schema, API routes, event IDs, ACL features, DI names | No change | ✓ n/a |

**Migration path for existing modules**: no action required. Operationally, a write touching a record whose encrypted field is sealed under a stale key now fails loudly until the rotation is finished (`mercato entities rotate-encryption-key --old-key …`) or the sealing DEK is restored — a deliberate trade of availability for integrity, since the previous outcome was silent, undetectable corruption. This change does not repair envelopes that were already nested before the upgrade.

---

## Module Registry Registration Listeners (2026-08-12)

[`.ai/specs/2026-08-12-module-registry-registration-listeners.md`](.ai/specs/2026-08-12-module-registry-registration-listeners.md) adds a public subscription to the module registry so a cache derived from the module list can drop what it built from an incomplete one ([#5103](https://github.com/open-mercato/open-mercato/issues/5103)). **All changes are additive** and pass the contract-surface checks above:

| Surface | Change | Classification |
|---------|--------|----------------|
| Function signatures | New export `onModulesRegistered(listener)` on `@open-mercato/shared/lib/modules/registry` | ✓ ADDITIVE (new function) |
| Type definitions | New export `ModulesRegisteredListener = (modules: Module[]) => void \| PromiseLike<void>` | ✓ ADDITIVE (new type, no rename) |
| `registerModules(modules)` | Signature, return type, and synchronous behavior unchanged; it now also notifies listeners after the reconciliation it already performed | ✓ Behaviour-preserving for existing callers |
| Import paths | None — both exports ship from the existing registry path | ✓ No change |
| Event IDs, API routes, DB schema, DI names, ACL features, notification IDs, CLI commands, generated files | No change | ✓ n/a |

**Contract commitments**: listeners are notified synchronously after `setGlobalModules()` (so `getModules()` is readable inside a listener) and only when the registered set actually changed, as decided by an immutable per-registration snapshot of module ids, top-level contract keys and array-valued contract elements. Accessor-declared contracts are never invoked by that snapshot and always count as changed. The contract is fail-soft on both paths: a synchronous throw and an asynchronous rejection are each observed and logged, and neither can fail `registerModules()`. Change detection MAY become more sensitive without a deprecation cycle (over-invalidation only drops a warm cache); it MUST NOT become less sensitive, since that direction serves a stale registry.

**Migration path for existing modules**: no action required. Nothing subscribes unless a module opts in, and with no subscribers the notification iterates an empty set. Test suites that call `registerModules()` MUST clear `__openMercatoModulesRegistrySnapshot__` alongside the two pre-existing registry globals, because all three survive `jest.resetModules()`.

## Passkey MFA Verification Payload (2026-08-14)

Issue #3852 removed the non-cryptographic passkey verification shape from `PasskeyProvider` in the enterprise `security` module. This is a **deliberate breaking change to a STABLE contract surface (category 7, API request shapes)** that ships under the [Emergency Security Exception](#emergency-security-exception) rather than the ordinary deprecation protocol.

**Classification.** The removed shape was a *publicly supported* surface, not an undocumented accident: it was part of the exported `MfaProviderInterface.verifySchema` union that a third-party client could validate against, and the enterprise test suite pinned it in a case named *"supports legacy verification payload for backward compatibility"*. It is therefore a genuine STABLE-surface break, and the exception — not a claim that no contract existed — is what authorizes it.

**Exception requirements, as met by this change:**

| Requirement | How it is satisfied |
|-------------|--------------------|
| 1. Qualifying condition argued | See *Why the deprecation protocol does not apply* below — both values the removed shape compared are disclosed by the server, so accepting it *is* the bypass |
| 2. Narrowest removal, no retained vulnerable branch | Only `verifyPayloadSchema` and the two non-cryptographic acceptance paths are deleted. The `{ response }` path, the challenge TTL check and the signature-counter update are untouched, and **no flag, config toggle or opt-in keeps the old shape reachable** |
| 3. Steps 4 and 5 | [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md) `0.6.7 → 0.7.0` (client *and* operator actions); spec [`.ai/specs/enterprise/2026-08-14-passkey-mfa-require-webauthn-assertion.md`](.ai/specs/enterprise/2026-08-14-passkey-mfa-require-webauthn-assertion.md) § Migration & Backward Compatibility |
| 4. Dated entry | This section |
| 5. Maintainer sign-off | PR carries the `security` label; the waiver is called out in the PR body for explicit human approval |

| Surface | Change | Classification |
|---------|--------|----------------|
| API request shape (`POST /api/security/mfa/verify`, `POST /api/security/sudo/verify`, `methodType: 'passkey'`) | `payload` must be `{ response }` carrying a WebAuthn assertion. The `{ credentialId, challenge }` alternative is removed and now answers `401` | ✗ BREAKING (deliberate — see rationale) |
| Provider contract (`MfaProviderInterface.verifySchema` for `passkey`) | `verifyPayloadSchema` narrows from a union to a single object requiring `response` | ✗ BREAKING for a caller that validated against the exported schema |
| Verification behavior | A verified `verifyAuthenticationResponse` is the only route to a positive verdict; an absent verify context is a rejection rather than a `credentialId` comparison | ✗ BREAKING for a client that skipped `/api/security/mfa/prepare` |
| Failure mode | A payload that fails the schema, and an assertion the verifier throws on, return `false` instead of throwing — so they answer the documented `401` and count toward the challenge attempt limit instead of logging a `500` that skipped lockout | ✓ Strictly safer (no verdict flips from negative to positive) |
| API route URLs, HTTP methods, response schemas, database schema, event IDs, ACL features, DI names, CLI commands | No change | ✓ n/a |

**Why the deprecation protocol does not apply.** The protocol exists to give downstream authors a bridge release. Here the request shape being removed *is* the vulnerability: both values it compared are disclosed by the server, so a bridge would keep the passkey second factor bypassable for a minor version in both login MFA and sudo step-up. A security fix that leaves the hole open is not a fix.

**Migration path.** Send `startAuthentication()` output as `payload.response`. The first-party `PasskeyChallengeVerify` component already does, so shipped UIs are unaffected. Credentials enrolled through the setup path's client-supplied `publicKey` shortcut are **not** reliably rendered unusable by this change — depending on what the client supplied, such a row holds either a key nobody can sign with or a keypair the enroller controls, and the second kind produces assertions this change accepts. That shortcut is a separate open surface (#5296); operator-facing remediation is in [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md).

## Data Sync Start Control Applicability (2026-09-02)

[`.ai/specs/2026-09-02-data-sync-adapter-start-controls.md`](.ai/specs/2026-09-02-data-sync-adapter-start-controls.md) lets a `DataSyncAdapter` declare, per entity type, which of the Data Sync dashboard's manual-start controls apply, so the dashboard stops offering controls that cannot mean anything for the selected entity type. **All changes are additive** and pass the contract-surface checks above:

| Surface | Change | Classification |
|---------|--------|----------------|
| Type definitions (§2) | New optional method `DataSyncAdapter.supportsStartControl?(control, entityType)`; new exported type `DataSyncStartControl = 'fullSync' \| 'batchSize'` | ✓ ADDITIVE (optional member, new type — same shape as the `persistsSharedCursor` and `runParameters` additions before it) |
| Import paths (§4) | New module `data_sync/lib/start-controls.ts` exporting `resolveStartControlMap`, `applicableStartControls`, `StartControlMap`, `StartControlApplicability`, `DATA_SYNC_START_CONTROLS` | ✓ ADDITIVE (new path; nothing moved or re-exported) |
| API route URLs (§7) | `GET /api/data_sync/options` items gain a `startControls` object; `POST /api/data_sync/run` is unchanged and keeps honouring `fullSync` and `batchSize` whatever an adapter declares | ✓ ADDITIVE (new optional response field, no request-shape change) |
| Auto-discovery, function signatures, event IDs, widget spot IDs, DB schema, DI names, ACL features, notification IDs, CLI commands, generated files | No change | ✓ n/a |

**Contract commitments**: only an explicit `false` removes a control, so an adapter that declares nothing — or whose predicate returns anything else — renders the same form and sends the same request body as before. A predicate that throws is treated as *applies*, because `api/options.ts` resolves every registered adapter in one response and one broken predicate must not take the dashboard down for the rest. The `startControls` map is sparse and keyed only by the adapter's own `supportedEntities`; a missing entry means every control applies, so a client that ignores the field behaves exactly as today. The declaration governs what the dashboard **offers**, never what the run API **accepts** — that separation MUST hold for any future change here, or an API client posting `fullSync: true` would silently stop getting a full run.

**Migration path for existing adapters**: none. The method is optional and defaults to prior behaviour.

## Error Reporting Policy (2026-09-08)

Spec: [`.ai/specs/2026-09-08-error-reporting-policy.md`](.ai/specs/2026-09-08-error-reporting-policy.md). Every change is additive; no existing path emits less than it did before.

| Surface | Change | Classification |
|---------|--------|----------------|
| `TelemetryProvider` | Optional `reportError?()` added, called in addition to the span/log/metric path. MUST stay optional — third parties implement this interface | ✓ ADDITIVE |
| `ReportErrorContext` / `TelemetryRuntime['reportError']` context | Optional `code?: string` fingerprint added | ✓ ADDITIVE |
| `data_sync.run.completed` payload | Optional `createdCount`, `updatedCount`, `skippedCount`, `failedCount` added; no existing field changed (§5 permits additive payload fields) | ✓ ADDITIVE |
| `integration_logs` rows at `level: 'error'` | Also reported to the active telemetry backend (message, `code`, ids — never `payload`). With telemetry off, one global lookup and no behaviour change | ✓ ADDITIVE |
| `queue` failure paths, `data_sync` engine | Existing `logger.error` lines keep their text and gain a `reportError` call with a `code` | ✓ ADDITIVE |
| `reportError`'s `code` | A value that is not shaped `module.reason` is dropped rather than published, so it cannot become an unbounded, unredacted metric label. No in-repo caller passes one; a caller that did reported exactly as one passing no `code`, which is the pre-PR behaviour | ✓ ADDITIVE |
| `integration_logs` message text for the payment status poller and the Stripe webhook processor | The failure cause moves from `payload` **into** the message (`Payment status polling failed: {cause}`), because the payload is deliberately never reported. `payload` keeps the same fields | ✓ ADDITIVE (row content, no schema or field change) |
| `integration_logs.code` for the payment status poller | Previously `null`, now `payment_gateways.status_poll_failed`, so it groups apart from the `integrations.log_error` catch-all. The column and its API field already existed | ✓ ADDITIVE (a value where there was none) |
| `IntegrationLogError` (`core:integrations`), `SyncRunPartialFailureError` (`core:data_sync`) | New exported error classes | ✓ ADDITIVE |
| API route URLs, response schemas, database schema, event IDs, ACL features, DI names, CLI commands, env vars | No change — the policy adds no configuration | ✓ n/a |

**Operator note — terminal queue failures.** Not a contract break, but visible in an alert rule: on the **local** strategy a job's final attempt previously emitted both `queue.job_failed` and `queue.job_exhausted`; it now emits only `queue.job_exhausted`, matching the `async` strategy. An alert thresholding on `queue.job_failed` alone stops seeing terminal failures — page on `queue.job_exhausted`.

**Volume note for operators.** Reported error *volume* rises where errors were previously only recorded: an integration that writes 115 error rows now also reports 115 errors, grouped by `error.code` at the backend. This is deliberate — see the spec's §S3 — and the controls are the collector's filtering/sampling and the backend's own quotas, not a framework switch.

## Data Sync Retry, Resume and Run Again (2026-09-16)

[`.ai/specs/2026-09-16-data-sync-retry-resume-actions.md`](.ai/specs/2026-09-16-data-sync-retry-resume-actions.md) splits the Data Sync dashboard's single overloaded "Retry" button into three named operator actions — **Retry** (labelled **Resume** on a cancelled run), **Retry from the beginning**, and **Run again** — and states, on the run detail page, where a retry would resume. **All changes are additive** and pass the contract-surface checks above:

| Surface | Change | Classification |
|---------|--------|----------------|
| Type definitions (§2) | New exported types `ResumePoint` (a discriminated union of `none` / `noCommittedBatch` / `resumes`) and `ResumePointRun` | ✓ ADDITIVE (new types, nothing renamed — same shape as the `StartControlMap` addition before it) |
| Import paths (§4) | New module `data_sync/lib/resume-point.ts` exporting `resolveResumePoint`, `isRetryableRunStatus`, `ResumePoint`, `ResumePointRun` | ✓ ADDITIVE (new path; nothing moved or re-exported) |
| API route URLs (§7) | **No change.** `POST /api/data_sync/runs/[id]/retry` and `POST /api/data_sync/run` are untouched — no new request field, no new response field, no new status code and no new error code. The UI starts sending the already-accepted `fromBeginning: true` for the first time, and reads `cursor` / `initialCursor` / `batchesCompleted`, all of which `GET /api/data_sync/runs` and `GET /api/data_sync/runs/[id]` have returned since 2026-08-12 | ✓ n/a |
| Database schema (§8) | No change. No entity, column, migration or `.snapshot-open-mercato.json` update; no new run status — the vestigial `paused` status is left exactly as it was | ✓ n/a |
| Auto-discovery, function signatures, event IDs, widget spot IDs, DI names, ACL features, notification IDs, CLI commands, generated files | No change | ✓ n/a |

**Contract commitments**: the retry endpoint deliberately does **not** enforce `supportsStartControl('fullSync', entityType)` before honouring `fromBeginning: true`. [§ Data Sync Start Control Applicability (2026-09-02)](#data-sync-start-control-applicability-2026-09-02) already commits that the declaration "governs what the dashboard **offers**, never what the run API **accepts**", and `fromBeginning: true` on `retry` requests the identical thing as `fullSync: true` on `run` — a `null` start cursor — so the two siblings MUST answer identically. An adapter-declared restriction hides the from-the-beginning action in the UI and nothing more; a scripted or API client keeps the documented escape hatch. Making either endpoint strict is a breaking change under §7 and needs the deprecation protocol, not a UI spec.

`ResumePoint` also has **no `fromBeginning` variant, by design**. `api/runs/[id]/retry.ts` resolves a resumable retry as `previous.cursor ?? resolveStartCursor(...)`, and `resolveStartCursor` reads the shared `sync_cursors` row — state the run row does not carry — so a run that committed no batch of its own may still resume at a cursor an earlier run wrote. `noCommittedBatch` therefore means only "this run committed nothing" and MUST NOT be widened by a caller into a positional claim about where a retry starts. A future additive `retryStartCursor` response field is the only way to close that gap; it is out of scope here.

**Migration path for existing adapters and clients**: none. The module is new, every endpoint is unchanged, and an adapter or API client that ignores all of this behaves exactly as before.

## Customers Quick-Create Injection Spot Bridge (2026-09-16)

[`.ai/specs/2026-09-16-customers-quick-create-injection-spot-bridge.md`](.ai/specs/2026-09-16-customers-quick-create-injection-spot-bridge.md) binds the sales document form's Person/Company quick-create dialogs to the customers module's declared `crud-form:customers.person` / `…company` hosts. The dialogs previously had no `injectionSpotId`, so `CrudForm` auto-derived `crud-form:customers.customer_entity` (§6, FROZEN) there instead.

| Surface | Change | Classification |
|---------|--------|----------------|
| Widget Injection Spot IDs (§6) | `CrudForm` gains an additive `legacyInjectionSpotId?: string` prop. When set, its header/body/field widgets are dual-published alongside the primary `injectionSpotId`'s — `crud-form:customers.customer_entity` stays live on these two dialogs via the bridge, so nothing that already targets it stops rendering | ✓ ADDITIVE (bridge, not a removal — see Deprecation Protocol steps 1–3) |
| Widget Injection Spot IDs (§6) | The two dialogs now also publish `crud-form:customers.person` / `…company` (previously published only by the person/company detail pages) | ✓ ADDITIVE ("MAY add new spot IDs to new or existing pages") |
| Context passed to widgets at `crud-form:customers.person` / `…company` | These hosts' widgets now also mount with `operation: 'create'` and no `recordId` on the two quick-create dialogs, for the first time — previously always `operation: 'update'` with a concrete `recordId` | Disclosed in [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md) "Action for module authors"; not itself a contract surface change (§6 permits "new optional context fields", and `operation`/`recordId` were always part of the injection context shape) |
| Type definitions (§2) | New optional `CrudForm` prop `legacyInjectionSpotId?: string` | ✓ ADDITIVE |

**Deprecation window.** `legacyInjectionSpotId` is scoped to these two call sites and intended for removal after at least one minor version (Deprecation Protocol step 1), tracked in the spec's Changelog and in `UPGRADE_NOTES.md`. No maintainer waiver was needed — nothing is removed by this change.

## Atomic Auth Command Replay (2026-10-04)

[`.ai/specs/2026-07-28-protected-roles-and-audit-seam.md`](.ai/specs/2026-07-28-protected-roles-and-audit-seam.md) closes the auth undo/redo transaction, authorization, and membership-phantom gaps without changing existing command handlers by default.

| Surface | Change | Classification |
|---------|--------|----------------|
| Type definitions (`CommandHandler`, `CommandRuntimeContext`, `CommandExecuteResult`) | New optional `atomicReplay?: boolean` and `stabilizeReplay(...)` handler capabilities, optional `replayTransactionGuard` request guard, optional caller-owned `transactionLifetime`, and optional `replaySourceFinalized?: boolean` result signal. `TransactionLifetime` plus its observation/completion-registration helpers are new exports; lifetime creation/completion remains owned by `withAtomicFlush` | ✓ ADDITIVE (optional fields and exports; omitted handlers and contexts keep the prior flow) |
| `ActionLogService` method signatures | `log`, `claimForUndo`, `releaseUndoClaim`, and `markUndone` accept an optional trailing transactional `EntityManager`; new `claimForRedo` method | ✓ ADDITIVE (optional parameters appended and a new method; existing calls retain behavior) |
| `RbacService` | New `loadAclWithEntityManager`, `userHasAllFeaturesWithEntityManager`, and `getGrantedFeaturesWithEntityManager` methods bypass caches and bind every query to the supplied transaction | ✓ ADDITIVE (new methods; existing cache-backed methods are unchanged) |
| Auth command replay behavior | Auth user/role handlers opt in so source-log state, domain changes, undo trace or new redo log, and redo source finalization commit or roll back together. Before the request guard or feature interceptors run, `stabilizeReplay` discovers and seals one actor/target/destination footprint and locks API keys, users, roles, tenant/organization hierarchy, and authorization children in a total order using the same transaction | ⚠️ Intentional security hardening. A race that previously could deadlock or replay with stale authority is rejected with the existing domain `409`; successful, authorized replay keeps the same response shape |
| Action-log actor persistence and self replay | `actor_user_id` remains a UUID; new entries also store the canonical user or `api_key:<uuid>` subject in `context.actorSubject`. API-key list ownership, undo/redo ownership, exact-EM RBAC, locks, and latest replay queries use the canonical subject. Canonical history is selected before the legacy bare-UUID fallback, which additionally requires a coherent live `isApiKey`/`keyId`/`sub` tuple | ✓ Database-compatible additive context metadata; same-UUID user, malformed, or ambiguous ownership cannot shadow canonical key history and fails closed |
| Auth authorization-state writers | First-party `UserRole`, `UserAcl`, and `RoleAcl` writers in commands, setup, CLI, execution principals, SSO, and agent orchestration now share the canonical parent-lock protocol; SSO membership and grant rows commit together | ⚠️ Intentional concurrency hardening; no request, response, schema, import-path, event, feature, or CLI contract changes |
| Non-auth command replay | Handlers that omit `atomicReplay` retain the existing undo claim/release compensation and route-level redo finalization | ✓ Behavior-preserving |
| API routes, response schemas, database schema, event IDs, ACL feature IDs, DI names, CLI commands, generated files | No shape or identifier change | ✓ n/a |

**Migration path for existing modules**: none. Third-party commands remain on the established replay lifecycle unless they explicitly set `atomicReplay: true`. An opting-in handler must perform all replay database work through `ctx.transactionalEm`; when authorization depends on mutable domain rows it may add `stabilizeReplay` to acquire its complete footprint before guards and interceptors. The command bus supplies and owns the transaction by default. A caller deliberately composing replay inside an already-active `ctx.transactionalEm` must open that outer transaction with `withAtomicFlush(..., { transaction: true })`, obtain its exact `TransactionLifetime` inside the phase, and pass it as `ctx.transactionLifetime`; otherwise replay fails before mutation. Commit-only hooks and redo-finalization reporting follow the true outer completion. The capability does not claim that legacy non-opted-in action-log and domain writes are transactionally atomic.

---

## Organization Update Preserves Omitted Hierarchy Fields (2026-10-01)

`directory.organizations.update` treated an omitted `parentId` as `null` and an omitted `childIds` as `[]`, so a partial update — notably `PUT /api/directory/organization-branding`, which sends only logo fields — detached the organization from its parent and orphaned its children. Omitted hierarchy fields are now preserved:

| Surface | Change | Classification |
|---------|--------|----------------|
| Command behaviour (`directory.organizations.update`) | `parentId` is written and validated only when present in the input; children are reconciled only when `childIds` is present. Explicit `parentId: null` and `childIds: []` still clear. With `childIds` present and `parentId` omitted, listing the current parent answers `400 Child cannot equal parent` (it answered `400 Cannot assign ancestor as child`) | ⚠️ Behaviour change on a previously-corrupting path. A caller that omitted the fields to clear the hierarchy must send the explicit values. Regression-tested in `updateOrganization.partial-hierarchy.test.ts` and `TC-DIR-018` |
| API routes (`PUT /api/directory/organizations`, `PUT /api/directory/organization-branding`) | Same URLs, request schema (`organizationUpdateSchema` already declares both fields optional) and response shapes | ✓ No shape change |
| Database schema, event IDs, ACL features, DI names, CLI commands | No change | ✓ n/a |

**Migration path for existing modules**: send `parentId: null` / `childIds: []` where clearing is intended. Trees flattened before the upgrade are not repaired (see UPGRADE_NOTES.md).

---

## Staff Logout Runs Without A Valid Access Token (2026-10-13)

`POST /api/auth/logout` answered `401` before its handler ran once the access token expired, so the remember-me session was never revoked ([#7225](https://github.com/open-mercato/open-mercato/issues/7225)). It now declares `requireAuth: false`, like the portal logout:

| Surface | Change | Classification |
|---------|--------|----------------|
| API route gating | `requireAuth` `true` → `false`; the handler revokes only the sessions its own cookies identify | ⚠️ Narrow relaxation: missing/unverifiable token or no cookie got `401`, now `307` (UPGRADE_NOTES.md) |
| URL, method, response shape | Unchanged | ✓ n/a |
| `auth.logout` event | Emitted only for a verified staff `auth_token` (now incl. MFA-pending); `session_token`-only revocation emits none | ✓ No ID or payload change |
| Database schema, ACL features, DI names, CLI commands | No change | ✓ n/a |

**Migration path for existing modules**: none. A client that read a logout `401` as "already signed out" gets the redirect instead.

## Discord AI Proposals (2026-10-13)

[Waiver](UPGRADE_NOTES.md#discord-proposals)

## Causation Foundation (2026-10-08)

[`.ai/specs/2026-10-08-insights-causation-and-explain.md`](.ai/specs/2026-10-08-insights-causation-and-explain.md) records why each audited write happened. Its one new persisted value set is `CAUSE_KINDS` (`@open-mercato/shared/lib/causation/types`), whose values are written to `action_logs.cause_kind` and into stored causation envelopes.

| Surface | Change | Classification |
|---------|--------|----------------|
| Persisted value set (`CAUSE_KINDS`) | Values are persisted and accepted by the audit `causeKind` filter, so they are frozen once shipped. New kinds MAY be appended; existing kinds MUST NOT be renamed or removed. A reader MUST reject an envelope whose innermost kind it does not know rather than promote an outer frame | ✓ ADDITIVE-ONLY (treat like §5/§10 IDs) |
| Database schema | New nullable columns on `action_logs`, `rule_execution_logs` and `api_keys`, plus concurrently built indexes; nothing renamed, retyped or removed | ✓ ADDITIVE-ONLY |
| `ActionLogService` method signatures | `log` and `markUndone` accept an optional trailing `causation` argument | ✓ ADDITIVE (optional parameter appended) |
| API routes (`GET /api/audit_logs/audit-logs/actions`, `.../actions/export`) | New optional `causeKind`/`causeId`/`correlationId` filters on both; the list response gains `causeKind`/`causeId`/`correlationId`/`causedByLogId` | ✓ ADDITIVE |
| Event IDs, ACL features, DI names, CLI commands, generated files | No change | ✓ n/a |

**Migration path for existing modules**: none. DI overrides and test doubles of `actionLogService` must accept the optional extra argument (see UPGRADE_NOTES.md).

---

## Insights "Why?" Explain Core (2026-10-08)

Phase 2 of [`.ai/specs/2026-10-08-insights-causation-and-explain.md`](.ai/specs/2026-10-08-insights-causation-and-explain.md) adds the `insights` module, which explains why a record value is what it is from audit history and the recorded causation. Every surface below is new; once shipped it follows the classification shown.

| Surface | Change | Classification |
|---------|--------|----------------|
| §1 Auto-discovery convention `insights.explain.ts` | New convention file (row added to the §1 table). Registration validates declarations: a resource, cause resolver or reference resolver without a non-empty `requiredFeatures` list is skipped with a warning (fail closed), and a duplicate `resourceKind` / resolver kind / provider id keeps the first registration. `ExplainCollectionDescriptor.itemResourceKinds` (optional) opts a collection into reading its child rows (`parent_resource_kind` = the resource) | ✓ ADDITIVE; FROZEN once shipped (`version` gates future shapes) |
| §2 Types (`@open-mercato/shared/modules/insights/explain`) | `ExplainModuleConfig`, `ExplainResourceDescriptor`, `ExplainFieldDescriptor`, `ExplainCollectionDescriptor`, `ExplainCustomFieldsDescriptor`, cause/reference resolver and provider types, `ExplainLoadContext`, `ExplainHistoryEntry`; persisted/response value sets `EXPLAIN_VERDICTS`, `EXPLAIN_CONFIDENCES`, `EXPLAIN_GAP_REASONS`, `EXPLAIN_VALUE_KINDS` | ✓ ADDITIVE; STABLE (optional fields only; value sets additive-only) |
| §3 Function signatures (`ActionLogService`) | New methods `findFieldHistory`, `findHistoryEntryById`, `findLogScopes`, `countHistoryByCause`, `findResourceIdsWithHistory` — tenant and organization scoped, decrypted where payloads are read, run under a 5 s statement timeout | ✓ ADDITIVE (existing methods unchanged) |
| §4 Import paths | `@open-mercato/shared/modules/insights/explain` (contract types, `defineExplainConfig`), `@open-mercato/shared/modules/insights/helpers` (scope, id, custom-field and resolver helpers for declarations) | ✓ ADDITIVE; STABLE |
| §7 API routes | `GET /api/insights/explain`, `GET /api/insights/explain/descriptors`, `GET /api/insights/explain/log` (all `requireFeatures: ['insights.explain.view']`, identical `404 { "error": "not_found" }` for unknown, invisible and out-of-scope records) | ✓ ADDITIVE; STABLE |
| §9 DI service names | `explainService` (request-scoped) | ✓ ADDITIVE; STABLE |
| §10 ACL feature IDs | `insights.explain.view`, `insights.explain.access_detail` (depends on `insights.explain.view`) | ✓ ADDITIVE; FROZEN |
| §13 CLI commands | `mercato insights explain:coverage [--tenant <id>] [--org <id>] [--since <iso>] [--limit N]` (read-only) | ✓ ADDITIVE; STABLE |
| §14 Generated files | `insights-explain.generated.ts` exporting `explainConfigEntries`, registered at bootstrap | ✓ ADDITIVE; STABLE |
| Database schema, event IDs, widget spot IDs, notification IDs, AI tool IDs | No change | ✓ n/a |

**Migration path for existing modules**: none. A module opts in by adding `insights.explain.ts` and running `yarn generate`. Operators run `yarn generate` and `yarn mercato auth sync-role-acls` so existing roles receive the new features (see UPGRADE_NOTES.md).

### Insights "Why?" price and access (Phase 3, 2026-10-08)

Phase 3 of the same spec explains sales line prices and access decisions. Every surface below is new and additive.

| Surface | Change | Classification |
|---------|--------|----------------|
| §1 Auto-discovery (`insights.explain.ts`) | `catalog` declares the `catalog.price` reference resolver (`requiredFeatures: ['catalog.products.view']`); `sales` registers the `sales.line_price` field provider. The sales line items exposed to explain declarations gain `priceId` and `priceMode` (read from line `metadata`) | ✓ ADDITIVE |
| §3 Function signatures (`RbacService`) | New `explainAccess(userId, features, { tenantId, organizationId }, { detail? })` → `{ decision, required, reasons, confidence, consistentWithFreshRead, detail }` (decision always equals `userHasAllFeatures` on the same cache-backed ACL; a cache-bypassing re-check lowers `confidence` to `inferred` on disagreement) and `findRolesGrantingFeatures(tenantId, features, { organizationId? })`; new exported types `AccessExplanation*`, `AccessRoleGrant`, `AccessUserAclGrant` and the value set `ACCESS_EXPLANATION_REASONS` (`missing_feature`, `organization_out_of_scope`, `user_acl_override`, `module_disabled`, `feature_removed`). `loadAcl` and every existing method are unchanged | ✓ ADDITIVE; reason values ADDITIVE-ONLY |
| §7 API routes | `GET /api/insights/explain/access?features=&path=&userId=` (`requireAuth`; resolved tenant required; unknown feature ids → 400 `unknown_feature`; another user requires `insights.explain.access_detail` + `auth.users.list` → 403 `forbidden`; a user outside the caller's tenant/organization scope → 404 `not_found`). Response `{ decision, required, reasons, summary, detail, confidence }`; `detail` only with `insights.explain.access_detail`. Explain field hints gain `sales.insights.linePrice.*` facts with `params.outcome` (`matched_price_row`, `differs`, `no_catalog_link`, `unverifiable`) | ✓ ADDITIVE; STABLE |
| §9 DI service names | `accessExplainService` (request-scoped) | ✓ ADDITIVE; STABLE |
| Database schema, event IDs, widget spot IDs, ACL feature IDs, notification IDs, CLI commands | No change | ✓ n/a |

### Insights "Why?" UI and AI (Phase 4a, 2026-10-08)

| Surface | Change | Classification |
|---|---|---|
| §3 Component props / types | `AccessDeniedMessage` optional `path` and `requiredFeatures` props; exported `AccessDeniedInjectionContext` and the version-history entry spot context type | ✓ ADDITIVE; STABLE |
| §6 Widget spot IDs | `version-history:entry:after` (context `{ logId, resourceKind, resourceId }`) and `backend:access-denied:after` (context `{ path, requiredFeatures }`); constants `VERSION_HISTORY_ENTRY_AFTER_INJECTION_SPOT_ID`, `BACKEND_ACCESS_DENIED_AFTER_INJECTION_SPOT_ID` | ✓ ADDITIVE; FROZEN once shipped |
| §6 Widget IDs | `insights.injection.record-why`, `insights.injection.deal-status-why`, `insights.injection.log-cause`, `insights.injection.access-why` | ✓ ADDITIVE; STABLE |
| §7 Backend pages | `/backend/insights/why` (requires `insights.explain.view`) | ✓ ADDITIVE; STABLE |
| §12 AI tool IDs | `insights.explain_record` (read-only, not allowlisted by default) | ✓ ADDITIVE; FROZEN once shipped |

### Insights "Why?" CrudForm field spots (Phase 4b, 2026-10-08)

Phase 4b of the same spec binds the CrudForm field spot family and adds the per-field "Why?" button behind an explain mode. Every surface below is new or additive.

| Surface | Change | Classification |
|---------|--------|----------------|
| §6 Widget spot IDs | `crud-form:<entityId>:field:<fieldId>:after` (declared as `CRUD_FORM_EXTENSION_SURFACES.fieldAfter`, previously `bound: false`) is now bound: `CrudForm` renders it at the end of each field of an edit form (record id from `values.id` or `versionHistory.resourceId`) whose resolved spot id starts with `crud-form:`, and only when `hasInjectionWidgetsForSpotPrefix('crud-form:<entityId>:field:')` finds a registration (exact key or explicit pattern containing `:field:`). Context `{ entityId, recordId, fieldId, resourceKind? }` (`CrudFormFieldInjectionContext`; `entityId` is the entity segment of the form's spot id). A wildcard without `:field:` (e.g. `record_locks.injection.crud-form-locking` on `crud-form:*`) never enables or resolves into field spots. Forms without field registrations render unchanged DOM. `fieldBefore` stays unbound | ✓ ADDITIVE; FROZEN once shipped |
| §6 Widget context | The context `CrudForm` passes to its form-level spots (base, `:header`, `:fields` handlers) gains `injectionSpotId` (resolved base spot id, or `null`) | ✓ ADDITIVE (optional context field) |
| §3 Function signatures | `hasInjectionWidgetsForSpotPrefix(prefix): boolean` and `INJECTION_FIELD_SPOT_SEGMENT` (`':field:'`) in `@open-mercato/shared/modules/widgets/injection-loader` (`prefix` is a field prefix ending with `:field:`, any other prefix answers `false`; a key counts when its part up to its first `:field:` equals or wildcard-matches the prefix; computed from the registered tables, `false` before registration, recomputed on every registration); `useHasInjectionWidgetsForSpotPrefix(prefix)` (reactive, `false` during SSR/hydration); type `CrudFormFieldInjectionContext` from `@open-mercato/ui/backend/CrudForm`. `loadInjectionWidgetsForSpot` / `loadInjectionDataWidgetsForSpot` skip wildcard keys without `:field:` for a spot id containing `:field:` (no spot rendered before this change contains it) | ✓ ADDITIVE; STABLE |
| §4 Import paths | `@open-mercato/ui/backend/injection/useHasInjectionWidgetsForSpotPrefix` | ✓ ADDITIVE; STABLE |
| §7 API routes | `GET /api/insights/explain/descriptors`: each field descriptor gains `currentPath` (`string \| null`, the record property the field is read from) | ✓ ADDITIVE |
| Widget IDs | `insights.injection.field-why` (on `crud-form:<formEntityId>:field:*:after`) and `insights.injection.field-explain-toggle` (on `crud-form:<formEntityId>:header`) for the form entity ids `customers.deal`, `customers.customer_deal`, `customers.person`, `customers.company` (no global wildcard) | ✓ ADDITIVE; STABLE (override targets) |
| Feature toggle | `insights_field_explain` (boolean, default `true`, category `insights`), created by `insights` `seedDefaults` only when the `feature_toggles` module is registered; the UI reads it fail-open (missing toggle or disabled module = enabled) | ✓ ADDITIVE; identifier FROZEN once shipped |
| §14 Generated files | Module facts mark every CrudForm host's `fieldAfter` surface `bound: true`; the `factCoverage` row `CrudFormExtensionSurface.fieldAfter` becomes `emitted-example` (mirrored in both example `surface-inventory.json` files) | ✓ ADDITIVE |
| Database schema, event IDs, ACL feature IDs, notification IDs, CLI commands | No change | ✓ n/a |
---

## Insights Process X-Ray Data Layer (Phase 5, 2026-10-08)

Phase 5 of [`.ai/specs/2026-10-08-insights-process-xray.md`](.ai/specs/2026-10-08-insights-process-xray.md) projects audited changes into a process-event store. Every surface below is new; once shipped it follows the classification shown.

| Surface | Change | Classification |
|---------|--------|----------------|
| §1 Auto-discovery convention `insights.process.ts` | New convention file (row added to the §1 table) discovered by the second insights generator plugin `insights.process`. Declarations are validated once the module registry is bootstrapped; a declaration with a field whose key or any snapshot-path / change-key segment names a column in the declared entity's map, the declaring module's `encryption.ts` maps or (for a milestone) the milestone entity's module maps is rejected as a whole and logged | ✓ ADDITIVE; FROZEN once shipped (`version` gates future shapes) |
| §2 Types (`@open-mercato/shared/modules/insights/process`) | `ProcessModuleConfig`, `ProcessDescriptor`, `ProcessFieldDescriptor` (value kinds `enum`, `dictionary`, `uuid`, `user` — the last stored as a pseudonym, follow-up fields only), `ProcessMilestoneDescriptor` (`entityId` required, `<module>:<entity>`), `ProcessExitDescriptor`, `ProcessEndStateDescriptor`, `ProcessActorDimensionProvider`; `PROCESS_ENTITY_ID_PATTERN`; persisted value sets `PROCESS_ACTIVITY_KINDS`, `PROCESS_CASE_STATUSES`, `PROCESS_RESERVED_VALUES` (`other`, `none`), `PROCESS_LEGACY_CAUSE_KIND` (`legacy`) | ✓ ADDITIVE; STABLE (optional fields only; value sets additive-only) |
| §2 Types (`@open-mercato/shared/modules/generators`, `@open-mercato/shared/lib/bootstrap`) | Optional `GeneratorPluginBootstrapRegistration.cli`; optional `BootstrapData.cliBootstrapRegistrations` (run by `createBootstrap` step 6h) | ✓ ADDITIVE (optional fields) |
| §3 Function signatures (`ActionLogService`) | New `scanDecrypted({ tenantId, organizationId, after, until, limit, maxBytes?, resourceKinds? })` (ascending `(created_at, id)` keyset, probe-then-load byte budget, decrypted strictly: throws `ActionLogDecryptionUnavailableError` when tenant data encryption is on without a usable encryption service, leaves rows whose encrypted columns stay sealed out of `entries` and counts them in `undecryptable`) and `scanStateChanges({ tenantId, organizationId, after, until, limit, resourceKinds? })` (undone/redone rows by `(updated_at, id)`, plaintext only); both tenant + organization scoped under the 5 s statement timeout | ✓ ADDITIVE (existing methods unchanged) |
| §4 Import paths | `@open-mercato/shared/modules/insights/process` | ✓ ADDITIVE; STABLE |
| §5 Event subscriptions | `insights:xray-user-deleted` subscribes to `auth.user.deleted` (persistent; records the erasure ledger, fails for a retry while the pseudonym key is unavailable); `insights:xray-organization-created` subscribes to `directory.organization.created` (persistent; registers the organization's ingest schedule) | ✓ ADDITIVE |
| §7 API routes | `GET /api/insights/xray/status`, `GET`/`PUT /api/insights/xray/settings` (optimistic lock, 409 `optimistic_lock_conflict`), `POST /api/insights/xray/backfill` (202 `{ progressJobId, scanId, scheduleRegistered }`, 409 with `code` `no_processes` / `disabled` / `rebuild_required` / `lease_busy`) — all `requireFeatures: ['insights.xray.manage']`, single resolved organization | ✓ ADDITIVE; STABLE |
| §8 Database schema | New tables `insights_process_cursors`, `insights_process_events`, `insights_process_cases`, `insights_process_rollups`, `insights_process_settings`, `insights_automation_suggestions` (all `tenant_id`/`organization_id` NOT NULL) and the tenant-scoped erasure ledger `insights_process_erasures` (`tenant_id`, `user_id`, `replacement`; unique per tenant and user); new partial index `action_logs_state_change_idx` (built concurrently). The projection holds no encrypted audit column (no `command_id`, no snapshot values beyond declared identifiers) | ✓ ADDITIVE |
| Commands | `insights.xray.settings.save` (audited, not undoable) | ✓ ADDITIVE |
| §10 ACL feature IDs | `insights.xray.view`, `insights.xray.manage` and `insights.xray.view_individuals` (both depend on `insights.xray.view`) | ✓ ADDITIVE; FROZEN |
| §13 CLI commands | `mercato insights xray:status`, `xray:backfill [--inline]`, `xray:rebuild [--inline]`, `xray:prune` (all `[--tenant <id>] [--org <id>]`) | ✓ ADDITIVE; STABLE |
| §14 Generated files | `insights-process.generated.ts` (`processConfigEntries`), `bootstrap-registrations.cli.generated.ts` (`runCliBootstrapRegistrations`) | ✓ ADDITIVE; STABLE |
| Queues / feature toggles | Queues `insights-xray-ingest` (concurrency 2) and `insights-xray-backfill` (concurrency 1); progress job type `insights.xray.backfill`; feature toggle `insights_xray_ingest` (kill switch, default on, fail-open) | ✓ ADDITIVE |
| Event IDs, widget spot IDs, notification IDs, AI tool IDs | No change | ✓ n/a |

**Migration path for existing modules**: none. A module opts in by adding `insights.process.ts` and running `yarn generate`. Operators run the migrations, `yarn mercato auth sync-role-acls`, and optionally `yarn mercato insights xray:backfill` (see UPGRADE_NOTES.md).

### Insights Process X-Ray analytics API (Phase 6B-1, 2026-10-10)

Phase 6B-1 of [`.ai/specs/2026-10-08-insights-process-xray.md`](.ai/specs/2026-10-08-insights-process-xray.md) exposes the X-Ray analytics. Every surface below is new or additive.

| Surface | Change | Classification |
|---------|--------|----------------|
| §7 API routes | `GET /api/insights/xray/processes`; `GET /api/insights/xray/{processKey}/map`, `/variants`, `/bottlenecks`, `/rework`, `/conformance`, `/breakdown?groupBy=org\|role\|team\|user`, `/cases` (all `requireFeatures: ['insights.xray.view']` plus the process's `requiredFeatures`; unknown and invisible processes answer the same 404 `process_not_found`; errors `{ error, code, hint }`); `POST /api/insights/xray/{processKey}/variants/{hash}/workflow-draft` (validated disabled draft, persists nothing). `PUT /api/insights/xray/settings` accepts `timeZone` and may answer 422 `conformance_workflow_not_found` / `workflows_unavailable`; settings and status responses gain `timeZone` | ✓ ADDITIVE; STABLE |
| §8 Database schema | `insights_process_settings.time_zone` (`text not null default 'UTC'`), added to the unreleased `Migration20261008180752_insights`; rollup marker rows `window_key = '__rollup_pass__'` in `insights_process_rollups` | ✓ ADDITIVE |
| §9 DI service names | `workflowDraftService` (workflows module, request-scoped): `validateDraftDefinition(payload, { tenantId, organizationId })` (persists nothing; schema + draft policy: `enabled: false`, `lifecycle: 'draft'`, no execution grant, no credential-bearing activity, only catalogued workflow-safe UPDATE_ENTITY commands) and `getDefinitionForScope(id, { tenantId, organizationId })` (structure only) | ✓ ADDITIVE; STABLE |
| §12 AI tool IDs | `insights.xray_summary`, `insights.xray_variants` (read-only, `requiredFeatures: ['insights.xray.view']`, not allowlisted for any agent) | ✓ ADDITIVE; FROZEN once shipped |
| Queues | `insights-xray-rollup` (concurrency 1), fed by the existing system ingest tick | ✓ ADDITIVE |
| Event IDs, widget spot IDs, ACL feature IDs, notification IDs, CLI commands, generated files | No change | ✓ n/a |

**Migration path**: none for modules. Operators run the rollup worker queue (see UPGRADE_NOTES.md).

### Insights Process X-Ray automation suggestions (Phase 6B-2, 2026-10-10)

Phase 6B-2 of [`.ai/specs/2026-10-08-insights-process-xray.md`](.ai/specs/2026-10-08-insights-process-xray.md) mines automation suggestions. Every surface below is new or additive.

| Surface | Change | Classification |
|---------|--------|----------------|
| §1 Auto-discovery (`insights.process.ts`) / §2 Types | Optional `ProcessDescriptor.automation` (`ProcessAutomationDescriptor`: `updateCommandId`, optional `recordIdInputKey`, optional `fieldInputKeys`); invalid hints reject the declaration like any invalid field; not part of the contract hash | ✓ ADDITIVE (optional field) |
| §7 API routes | `GET /api/insights/xray/suggestions` and `GET …/suggestions/{id}/draft` (`insights.xray.view` + the process's features), `PATCH …/suggestions/{id}` (`insights.xray.manage`, optimistic lock, mutation guards `insights.xray_suggestion`), `POST …/suggestions/mine` (`insights.xray.manage`, mutation guards `insights.xray_suggestion_mining`); unknown and invisible suggestions answer the same 404 `suggestion_not_found`. `PUT /api/insights/xray/settings` accepts `suggestionMinSupport`; settings and status responses gain it. Every X-Ray route's 500 body becomes `{ error, code: 'internal_error', hint: null }` (was `{ error: 'internal_error' }`) | ✓ ADDITIVE; STABLE |
| §8 Database schema | `insights_automation_suggestions` (created empty in Phase 5, never written before) gains `trigger_activity_key`, `window_seconds`, `trigger_count`, NOT NULL `updated_at`, status index over `(tenant_id, organization_id, process_key, status)`; `insights_process_settings.suggestion_min_support` (nullable); all in the unreleased `Migration20261008180752_insights`. Pass marker rows `window_key = '__suggestion_pass__'` in `insights_process_rollups` | ✓ ADDITIVE |
| §9 DI service names | `workflowDraftService.listAutomatedUpdates({ tenantId, organizationId })` (additive method; insights treats it as optional). `validateDraftDefinition` now allows only `UPDATE_ENTITY`, `WAIT`, `SET_VARIABLE` (new issue code `activity_not_allowed`) and its `commands` gain `enabled` (tenant enablement, tier 2); it was introduced unreleased in Phase 6B-1, so no shipped caller relied on the denylist | ✓ ADDITIVE; STABLE |
| Commands | `insights.xray.suggestion.update` (audited, not undoable) | ✓ ADDITIVE |
| Queues | `insights-xray-suggestions` (concurrency 1), fed by the existing system ingest tick | ✓ ADDITIVE |
| Event IDs, widget spot IDs, ACL feature IDs, notification IDs, AI tool IDs, CLI commands, generated files | No change | ✓ n/a |

**Migration path**: none for modules (the `automation` hint is opt-in). Operators run the suggestions worker queue (see UPGRADE_NOTES.md).

### Retained access-log resource kinds (Process X-Ray analytics, 2026-10-10)

| Surface | Change | Classification |
|---------|--------|----------------|
| §3 Function signatures / §4 import paths (`@open-mercato/core/modules/audit_logs/services/accessLogService`) | New exports `registerRetainedAccessLogResourceKinds(kinds: readonly string[]): void` (globalThis-backed, additive, idempotent; blank values ignored) and `listRetainedAccessLogResourceKinds(): string[]` (core kinds `auth.user`, `auth.role` plus every registered kind). `AccessLogService` rotation keeps the listed kinds under `AUDIT_LOGS_CORE_RETENTION_DAYS` and deletes every other kind after `AUDIT_LOGS_NON_CORE_RETENTION_HOURS`, as before; existing methods and env variables unchanged | ✓ ADDITIVE; STABLE |
| Retention behavior | The `insights` module registers `insights.xray.individuals` from its DI `register`, so per-person X-Ray access rows follow the core retention (default 7 days) instead of 8 hours | ✓ ADDITIVE (rows kept longer, never shorter) |

The `audit_logs` module does not import or know the registering modules (the dependency points from `insights` to `audit_logs`, which it already `requires`).
