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
| `ce.ts` | `entities: CustomEntitySpec[]` | MUST NOT change `CustomEntitySpec` required fields; may add optional fields |
| `search.ts` | `searchConfig: SearchModuleConfig` | MUST NOT change `SearchEntityConfig` required fields; may add optional fields |
| `events.ts` | `eventsConfig` via `createModuleEvents()` | MUST NOT change `EventDefinition` required fields (`id`, `label`); may add optional fields |
| `extension-points.ts` | `extensionPoints: ModuleExtensionPoints` | New additive convention; declared exact/pattern host IDs, aliases, fallbacks, family/capability semantics, and bound call-site meaning MUST NOT change incompatibly |
| `translations.ts` | `translatableFields` | MUST NOT change record shape |
| `notifications.ts` | `notificationTypes: NotificationTypeDefinition[]` | MUST NOT change required fields; may add optional fields |
| `notifications.client.ts` | — | MUST NOT change renderer props contract |
| `ai-agents.ts` | `aiAgents: AiAgentDefinition[]` | MUST NOT change `AiAgentDefinition` required fields; optional sibling exports `aiAgentOverrides` and `aiAgentExtensions` are stable |
| `ai-tools.ts` | `aiTools: AiToolDefinition[]` | MUST NOT change `AiToolDefinition` / inherited `McpToolDefinition` required fields; optional sibling export `aiToolOverrides` is stable |
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
- `WorkerMeta`: `queue` — MUST NOT remove
- `RefreshCredentialsInput` (communication_channels hub): `channelId`, `credentials`, `scope` — MUST NOT remove. `oauthClient?` was added 2026-05-27 as an additive optional field (see [Spec A](.ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md)). The legacy `credentials._client` read path in the Gmail adapter is **deprecated and slated for removal in the next minor release** — pass OAuth client config via `RefreshCredentialsInput.oauthClient` instead.
- `OAuthClientConfig` (communication_channels hub): added 2026-05-27 with `clientId` required; optional `clientSecret`, `tenantId`, `scopes`. New optional fields may be added; required `clientId` MUST NOT be removed.
- `BackendChromePayload`: `groups`, `settingsSections`, `settingsPathPrefixes`, `profileSections`, `profilePathPrefixes`, `grantedFeatures`, `roles` — MUST NOT remove. `currentOrganization?` (`BackendChromeCurrentOrganization | null`) was added 2026-07-30 as an additive optional field (see [spec](.ai/specs/2026-07-30-backend-chrome-current-organization.md)); it is `null` under an all-organizations selection, when no organization is in scope, and when the lookup fails, so consumers MUST treat `null` as "unknown" rather than "no organization". `brand?` is **unchanged** and remains the branding channel — it populates only when the organization has a `logoUrl`, and `currentOrganization` does not supersede it.

**STABLE field shape, changed value semantics in 0.6.8:** each entry in `BackendChromePayload.settingsSections` keeps its `id`, `label`, `labelKey`, `order`, and `items` fields, but `id` is now the section's **untranslated group id** (the page's `pageGroupKey`, e.g. `settings.sections.moduleConfigs`) instead of a slug of the rendered group label. The old value was locale-dependent, so it could not be targeted reliably (see [#4843](https://github.com/open-mercato/open-mercato/issues/4843)). Consumers matching a settings section — notably injected `menuItems[].groupId` — MUST use the group id, which is the form the widget-injection documentation already prescribes. `buildSettingsSections`' `sectionOrder` parameter keeps a deprecated fallback lookup on the old label slug for at least one minor release.

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
| `apiCall` / `apiCallOrThrow` / `readApiResultOrThrow` | `@open-mercato/ui/backend/utils/apiCall` | MUST NOT change |
| `useT()` | `@open-mercato/shared/lib/i18n/context` | MUST NOT change return type |
| `resolveTranslations()` | `@open-mercato/shared/lib/i18n/server` | MUST NOT change |
| `createCrudOpenApiFactory(config)` | `@open-mercato/shared/lib/openapi/crud` | MUST NOT change |
| `collectCustomFieldValues()` | `@open-mercato/ui/backend/utils/customFieldValues` | MUST NOT change |
| `flash()` | `@open-mercato/ui` | MUST NOT change |
| `CrudForm` component props | `@open-mercato/ui/backend/crud` | MUST NOT remove existing props |
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
| HTTP response shapes (`makeCrudRoute` handlers, `POST /api/audit_logs/audit-logs/actions/undo`) | A rejection **that sets a status** answers with it; a rejection that sets none keeps the byte-identical generic `500` (CRUD) / `400 Undo failed` (undo) | ✓ Behaviour-preserving for existing interceptors (regression-tested in `crud-factory.test.ts` and `undo.route.test.ts`) |
| Database schema, event IDs, ACL features, DI names, CLI commands | No change | ✓ n/a |

**Migration path for existing modules**: no action required. The capability is opt-in per rejection — an interceptor that never sets `status` produces exactly the responses it produced before. Interceptors that want a deliberate status add `status` (and optionally `body`) to the `{ ok: false, message }` verdict they already return. Third-party transports that call `commandBus.execute` inside their own `try/catch` can honour the same contract in two lines via `getCommandInterceptorHttpRejection(err)`, which validates the status is an integer in 400-599 before returning it.

---

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
