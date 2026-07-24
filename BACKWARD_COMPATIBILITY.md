# Backward Compatibility Contract

Open Mercato modules are developed by third-party developers who depend on stable platform APIs. Every surface listed below is a **public contract**. Changes to these surfaces MUST follow the deprecation protocol or they are **breaking changes** that block merge.

## Deprecation Protocol

1. **Never remove or rename** a public contract surface in a single release.
2. **Deprecate first**: add `@deprecated` JSDoc with migration guidance and the target removal version.
3. **Provide a bridge**: re-export the old name/path, accept the old signature, or keep the old behavior alongside the new one for at least one minor version.
4. **Document in UPGRADE_NOTES.md**: every deprecation and every removal must be listed with migration instructions.
5. **Spec requirement**: any PR that modifies a contract surface MUST reference a spec (in `.ai/specs/`) that includes a "Migration & Backward Compatibility" section.

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
| `translations.ts` | `translatableFields` | MUST NOT change record shape |
| `notifications.ts` | `notificationTypes: NotificationTypeDefinition[]` | MUST NOT change required fields; may add optional fields |
| `notifications.client.ts` | — | MUST NOT change renderer props contract |
| `ai-agents.ts` | `aiAgents: AiAgentDefinition[]` | MUST NOT change `AiAgentDefinition` required fields; optional sibling exports `aiAgentOverrides` and `aiAgentExtensions` are stable |
| `ai-tools.ts` | `aiTools: AiToolDefinition[]` | MUST NOT change `AiToolDefinition` / inherited `McpToolDefinition` required fields; optional sibling export `aiToolOverrides` is stable |
| `di.ts` | `register(container)` | MUST NOT change function signature |
| `cli.ts` | default export | MUST NOT change expected signature |
| `data/entities.ts` | Entity class exports | See Database Schema rules below |
| `data/validators.ts` | Zod schema exports | MUST NOT remove or narrow existing schemas |
| `data/extensions.ts` | `extensions: EntityExtension[]` | MUST NOT change `EntityExtension` shape |
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
- `AiAgentExtension`: `targetAgentId` — MUST NOT remove; patch fields (`replaceAllowedTools`, `deleteAllowedTools`, `appendAllowedTools`, `replaceSystemPrompt`, `appendSystemPrompt`, `replaceSuggestions`, `deleteSuggestions`, `appendSuggestions`) MUST keep their existing meaning; deprecated `suggestions` remains an append alias until removed through the deprecation protocol
- `AiAgentOverridesMap` / `AiToolOverridesMap`: `Record<string, AiAgentDefinition | null>` and `Record<string, AiToolDefinition | null>` semantics are STABLE; `null` means disable
- `ModuleOverrides`: `overrides.ai.agents`, `overrides.ai.tools`, and `overrides.ai.extensions` shapes are STABLE; other domain keys are reserved by the unified override contract and may be wired additively
- `WorkerMeta`: `queue` — MUST NOT remove
- `RefreshCredentialsInput` (communication_channels hub): `channelId`, `credentials`, `scope` — MUST NOT remove. `oauthClient?` was added 2026-05-27 as an additive optional field (see [Spec A](.ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md)). The legacy `credentials._client` read path in the Gmail adapter is **deprecated and slated for removal in the next minor release** — pass OAuth client config via `RefreshCredentialsInput.oauthClient` instead.
- `OAuthClientConfig` (communication_channels hub): added 2026-05-27 with `clientId` required; optional `clientSecret`, `tenantId`, `scopes`. New optional fields may be added; required `clientId` MUST NOT be removed.

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
