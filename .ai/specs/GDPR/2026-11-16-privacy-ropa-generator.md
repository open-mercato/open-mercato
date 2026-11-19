# Register of processing: a generated draft

> **Program:** package G3 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md), [`2026-11-16-privacy-record-retention.md`](2026-11-16-privacy-record-retention.md) and [`2026-11-16-privacy-doctor-cli.md`](2026-11-16-privacy-doctor-cli.md).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/GDPR/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

A controller must keep a register of its processing: what personal data, about whom, for what purpose, sent to whom, kept how long, protected how. A tenant running Open Mercato has to write that by reading the product from the outside. The product already knows part of it — which kinds of people each module holds data about, which outside services this installation is configured to call — and nobody can get it out. **Proposed (future):** one command prints a draft register for one organization. What the product can know is filled in from module declarations and configuration. What only the controller can know — who they are, their purposes, where each recipient processes — is left as a labelled blank. The output says "draft" throughout.

This is an Art. 30(1) controller draft only; it does not supply an Art. 30(2) processor record.

**Not in this spec:** a register the product stores, edits or signs off; the processor's own register for an operator hosting many tenants; a screen.

## 📝 Overview

> **Market reference.** Tools such as Fides and OneTrust generate a register from a data map and leave purpose and legal basis to be assigned by a person; Fides calls its output a "data map export" for that reason. GitLab publishes its sub-processor list from a maintained data file. Adopted: generate what is declared, mark what is not, never guess a legal basis. Rejected: asking each module to state a legal basis — the same module is used under consent by one tenant and under contract by another.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | What the product may assert | Categories of people and of data, what a module is for, which outside services are active for this organization | These are facts about code and configuration. |
| 2 | What it must not assert | The controller's identity and contacts, the purpose, whether a recipient is in a third country and under what safeguard, how long data should be kept | These are the controller's facts or decisions, or facts about a vendor the product cannot verify. Art. 30(1)(f) asks for envisaged time limits for erasure where possible; the controller-completion blank remains prominent alongside the other required particulars. |
| 3 | Legal basis | An optional blank | Art. 30(1) does not ask for it. Most controllers keep it beside the register, so the column is offered and marked optional. The program excludes legal basis from the contract, and this spec keeps that choice, because the same module is used under consent by one tenant and under contract by another. |
| 4 | Where recipients come from | A `recipients` member that modules declare in `privacy.ts`, each with a way to say whether it is active | Four hand-picked providers would miss web-research adapters, the telemetry exporter, the external search host, an identity provider and backups. |
| 5 | Scope | One organization of a tenant per run | Integrations are enabled per organization, and organizations of one tenant may be separate legal entities. |
| 6 | Form | A command that writes Markdown or JSON to a file | A draft for a person to finish belongs in their document, not in the database. |
| 7 | Edition | OSS: declarations and schemas in `shared`, the command and renderers in the OSS `privacy` module | Decided under the program's DEC-2. Every controller owes an Art. 30(1) register, and the command reads only OSS declarations and owner metadata services. Enterprise contributes the optional policy adapter and its own modules' recipient declarations (`agent_orchestrator`, `sso`), which the OSS collector reads through the same registry or soft-resolves; a verified never-installed or owner-proven empty Enterprise source is `not_applicable`; disabled/unknown historical storage remains a gap. |
| 8 | Exit status describes the generated draft | Exit 2 for declaration/collector gaps; controller-completion blanks are expected and separately counted | `--no-fail` changes only exit 2 to 0; gaps, draft labels and the summary remain. Scripts should inspect `gaps`, rather than treat exit 0 as a finished register. |

## 📝 Problem Statement

- **What a module can be asked today.** Its info, features, custom entities, encryption maps and integrations are on the module registry (`packages/shared/src/modules/registry.ts:225-291`). Tables are not, and neither is the coverage backlog, which is a test-only file. The privacy contract adds data classes with subject kinds and actions. None of it says what a class is *for*, or what categories of data it holds in words a register uses.
- **What an integration declares.** An id, a title, a category, a hub, a provider key, a documentation address, its package, the vendor's name, its credentials and a health check (`packages/shared/src/modules/integrations/types.ts:179-201`). Not what data it receives.
- **Several recipients are not integrations at all.** The email provider is chosen by an environment variable or a tenant channel; the model provider by environment and tenant settings; embeddings by a stored setting; text extraction by a key's presence. None is on the module registry.
- **Retention has no generic stored policy in today's OSS.** R3-3, “Tenant privacy settings live in `module_configs`”, in the contract spec supplies future class-specific settings through `privacySettingsService.get`; it does not turn a configured age into a scheduled policy. Retention sets take their window from whoever runs them; the pruners' and the access log's windows are environment variables of the server process, which a command run elsewhere may not share. Only the enterprise engine stores policies.
- **Integrations are scoped to an organization**, and a credential can also belong to one user (`packages/shared/src/modules/integrations/types.ts:1-3`; `integrations/lib/state-service.ts:33-45`).
- **Encryption maps carry tenant and nullable organization scope** (`entities/data/entities.ts`, `EncryptionMap`). Today the tenant encryption service has per-entity field lookup but no map enumeration. `entities` has no `di.ts`; the metadata service below is new work. The doctor's default tier reads configuration only; its opt-in database tier is owned by R3-4, “An opt-in database tier for the doctor”, in the doctor spec.
- **Tenants define their own fields and entities**, which can hold any personal data and which no module declares.
- **A command can read the registry** through `getCliModules()`, from a file named `cli.ts`, as the contract spec's own commands do.
- **Generated documents have precedents**: the OpenAPI document, the module-facts files, and generated Markdown for extension points (`packages/cli/src/lib/generators/`).

## 📝 Proposed Solution

### Declarations

A data-class definition gains an optional `register` block:

| Field | Meaning |
|---|---|
| `activity` | A locale key for one sentence: what the module does with this data, in product terms |
| `dataCategories` | From a fixed list: identification, contact, authentication, communication content, financial, employment, location, device and network, free text, files |
| `specialCategoriesPossible` | Whether free text or files may contain special-category data that the product cannot know about |

The default export of `privacy.ts` gains an optional `recipients` list. Each entry has an id, a title, the vendor's name where there is one, the data categories it receives, and the DI key of a small function that says whether it is active for a given tenant and organization and, where known, which endpoint it calls. The status input and result schemas below are shared, including host-only output and explicit unknown states. An entry may name `dataClassIds` to link recipients to activities; no link is guessed from overlapping categories. Duplicate ids are rejected across enabled modules and reported as gaps. The owners declare them: the webhooks module, the system email transport (`communication_channels`), the assistant's model providers, embeddings and the external search host (`search`), text extraction (`attachments`), the telemetry exporter, web-research adapters and the identity provider (Enterprise), and each integration provider package; Phase 2 step 2 names each owner's module and file.

Every enabled integration in scope with no recipient declaration is listed with `recipient_undeclared`, even when the database has no credential. It may authenticate through environment, shared configuration or without a stored credential. The integrations owner reports safe activation and credential-presence metadata; absent proof of active processing is `unknown`. Unavailable owner resolution yields a gap. No credentials, users, connection probe or network call enter the report.

Retention declarations do not create stored policies. The optional policy adapter retains the `data_class | retention_set` target-type union, but the current `data_erasure` storage is set-only: both record and subject policies yield `retention_set` rows. Never require or fabricate a stored class policy. Class-specific windows come from the separate **R3-3 — Tenant privacy settings live in `module_configs`** source, with their declared units and effective value metadata.

### The command

`mercato privacy register --tenant <id> --organization <id> --out <file> [--format md|json] [--locale <code>] [--force] [--no-fail]`

Before any collector runs, build a request container with `createRequestContainer()` from `@open-mercato/shared/lib/di/container`. Resolve the new directory-owned `directoryPrivacyService.resolveScope({ tenantId, organizationId })`, which returns tenant/organization ids and names only when the live organization belongs to that live tenant. A mismatch or missing scope exits 1, runs no collectors and writes no file. A container/key-guard or mandatory directory failure also exits 1 with a safe diagnostic and no file; do not bypass production key policy. Dispose the container in `finally`.

**Header — for the controller to complete.** Name and contact details of the controller, of any joint controller, of the representative and of the data protection officer. The product prints the tenant's and organization's names as a starting point and marks every line as to be confirmed.

**One section per data class** of the installation's enabled modules:

| Register column | Source | When the source is silent |
|---|---|---|
| Processing activity | `register.activity` | The class's title, marked "description not declared" |
| Categories of data subjects | The class's subject kinds, in words | — |
| Categories of personal data | `register.dataCategories` | "Not declared" |
| Special categories | `specialCategoriesPossible` | "Not declared" |
| Purpose | — | A blank for the controller, with the activity sentence as a prompt |
| Legal basis (optional) | — | A blank, marked as not required by Art. 30 |
| Time limits for erasure | A controller-completion blank; the installation retention section separately lists record and subject retention-set policies | "Controller to complete"; a set policy is not a policy for every class |
| Recipients for this activity | Active recipients whose `dataClassIds` includes this class | "Recipients — controller to complete"; global recipients remain listed |

**Tenant-defined data.** The names of the organization's custom entities and custom fields, read through the `entities` module's service, each marked "defined by the tenant — controller to classify".

**Recipients.** Every declared active recipient for this organization, with its declared data categories and activity ids. Render it globally and under linked activities; leave an activity-level blank when links are absent. Unknown, missing, invalid or throwing status services produce “state not reported” entries and gaps, never disappear as inactive. Each recipient shows its configuration scope (organization, tenant, installation or per user). Art. 30(1)(d) covers recipients data has been disclosed to, and a recipient switched off today may have received data earlier, so declared recipients whose status is inactive are rendered in a separate section, “Inactive declared recipients — may have received data”, each with a controller blank for whether and when data was disclosed; they are also recorded as checked sources. A fixed “Other former recipients — controller to complete” prompt follows, because a recipient whose declaration was removed, or an undeclared integration that was disabled, cannot be listed by the command. Webhooks are a declared recipient owner: its status service returns distinct configured active endpoint host names for this scope, never full URLs. One fixed blank identifies the party hosting this installation. Every listed recipient has a country-of-processing and safeguard blank.

**Security measures.** Report the encryption service's `isEnabled()` as operational availability in this process, alongside the configured encryption toggle; do not call a KMS outage “encryption switched off”. The entities owner counts distinct entities with effective encrypted fields from its map metadata, using the tenant and organization precedence of `getEncryptedFieldNames`. Never infer that every existing row was backfilled. Report key-policy findings through `inspectTenantEncryptionConfig(process.env)` from the [key-guard spec](2026-11-16-runtime-encryption-key-guard.md), API Contracts, preserving its `code`, `subject`, `envName` and `disposition`; no invented “managed” policy state. Read configured fulltext exclusion through the shared predicate delivered by doctor Phase 1, labelled “this process”, rather than claiming the index was rebuilt. Both renderers always include “Other technical and organisational measures — controller to complete”, with prompts for access control, backups and incident handling.

**Retention configured on this installation.** The pruner and access-log owners provide effective windows through shared accessors, labelled “this process”; the collector never copies their environment names, defaults or parsing. Under **DEC-H — The counting-period bridge**, an operational history window does not prove deletion is active: never infer that its counting period has completed or a worker runs. `enabled` is the effective age-rule flag; a zero value with `enabled: true` is immediate portal-session expiry, whereas zero with `enabled: false` means keep. List enterprise policies for both record and subject retention sets, with `targetType: 'retention_set'`, `targetId`, `targetMode`, window, unit, mode, active flag and source, following the DSR engine's set-only storage. The adapter's `data_class | retention_set` union is retained without inventing stored class policies or a policy-to-class link; leave each activity's erasure-time-limit blank. List R3-3 tenant privacy settings separately as configured limits, not proof a job runs. Missing policy/settings sources remain explicit gaps; a successful empty policy result means no stored policy, not a read failure. These two process accessors do not collect forms' per-form gates, legacy scoped integrations, B6 queue cleanup or enterprise-owned windows; expose uncollected areas as gaps instead of claiming whole-installation retention coverage.

**What this draft does not cover.** Every enabled module declaring no data class, including a `privacy.ts` carrying only `tables`, `tableExports`, `retentionSets`, `subjectRetentionSets`, `settings`, `recipients` or `doctorChecks` beside the required `dataClasses: []`; classes without `register`; recipients with undeclared data. DEC-G, “The tenant-export reader and its declarations”, keeps `tableExports` independent of coverage, and DEC-I, “The doctor's extension point”, supplies `doctorChecks`; neither member implies an activity. A module whose complete declared table map contains only `none` or `tenant_configuration` is still listed with that qualification; the draft does not infer personal-data coverage from export or table declarations. Each produces a machine-readable gap. Every absent, failed, unknown, invalid or omitted collector source also produces a gap with safe source id and no exception text, URL or credential. The table backlog is not printed, because a command cannot read it; the docs say where it is. Installed disabled or unavailable owners with retained or unverified data produce `source_omitted` coverage gaps. Use the installed owner/catalog metadata and optional owner-scoped counts as evidence; emit no unscoped queries or row contents. Only a verified in-scope empty result may omit that gap. Inactive or soft-deleted definitions with values retained or of unknown retention remain visible as historical metadata or an explicit gap.

### Design decisions

| Decision | Rationale |
|---|---|
| Blanks are printed, not omitted | A register with no purpose or no controller looks complete and is not. |
| Recipients are what is configured, not what could be | A register lists actual recipients. |
| The draft lists what it cannot cover | It must state its own gaps, as far as a command can know them. |
| A fixed list of data categories | Free text would make two modules' "contact data" incomparable. |
| Nothing is stored | See assumption 6. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A legal basis per data class | See assumption 3. |
| Four hand-picked providers for recipients | See assumption 4. |
| One run per tenant | See assumption 5. |
| A "region" on each integration | The product cannot verify it, and a wrong one is worse than a blank. |
| Generating at build time into the docs | The answer depends on the tenant's enabled integrations and settings. |
| A screen with an editable register | A document-management feature of its own. |
| The command and renderers in Enterprise, declarations in `shared` | See assumption 7; the register is a duty of every controller, and the command reads only OSS sources. |

## 📝 Delta

### Capability: privacy-register-draft

#### ADDED Requirement: Draft register
The system SHALL produce, for one organization of a tenant, a draft register of processing from module declarations and installation configuration, and SHALL mark as incomplete every entry it cannot know.

##### Scenario: Declared class
- WHEN a data class declares its activity and data categories
- THEN its section shows them, and shows purpose and legal basis as blanks for the controller

##### Scenario: Configured recipient
- WHEN the tenant has an integration enabled that declares the data it receives
- THEN the recipient is listed with that data

##### Scenario: Recipient that declares nothing
- WHEN an enabled integration has no declaration
- THEN it is listed, with its data marked as not declared

##### Scenario: Not enabled
- WHEN an integration is installed but not enabled for the tenant
- THEN it is absent from the active recipient list; if its owner declares a recipient that reports `inactive`, it appears under inactive declared recipients with a controller blank for past disclosure

##### Scenario: Recipient disabled after use
- WHEN a declared recipient was active, received data and was then disabled
- THEN it remains visible under inactive declared recipients, and the former-recipients prompt is present

##### Scenario: Gaps
- WHEN an enabled module declares no data class, even if its `privacy.ts` has only table/export/check declarations
- THEN the document names it as not covered, qualifies an all-`none`/`tenant_configuration` table map, and records `no_data_classes`

##### Scenario: Tenant-defined fields
- WHEN the organization has a custom field
- THEN it is listed for the controller to classify

##### Scenario: Another organization's integration
- WHEN an integration is enabled only for another organization of the tenant
- THEN neither that integration nor its organization-only custom fields appear

##### Scenario: Organization belongs to another tenant
- WHEN the supplied organization does not belong to the supplied tenant
- THEN the command exits 1 before collecting or writing a document

##### Scenario: A source is unavailable
- WHEN any optional source is absent, throws, returns unknown or fails validation
- THEN the document retains a labelled gap, and exits 2 unless `--no-fail`; that flag never removes gaps

##### Scenario: Retention set policy
- WHEN the engine returns stored policies for record and subject retention sets
- THEN retention lists `targetType: 'retention_set'`, `targetId`, `targetMode`, source, window/unit, mode and active metadata for each policy, without requiring or inventing a stored class policy or filling an activity's controller-completion blank; class-specific R3-3 settings remain separate

##### Scenario: Effective window without deletion evidence
- WHEN the operational accessor reports an enabled history age while its owner is counting or in report mode
- THEN the draft lists that age rule without claiming deletion or worker health; it preserves zero/disabled keep and zero/enabled immediate portal-session expiry as different rules

##### Scenario: Retention area outside the accessors
- WHEN a retention area is outside the two shared process accessors and no separate source collects it
- THEN the draft records `source_omitted` for that area and does not present the process windows as whole-installation coverage

## 📝 Architecture

- **`packages/shared/src/modules/privacy.ts`**: the optional blocks, category enum and zod schemas; `registry.ts` adds `getPrivacyRecipients`. It reads `module.privacy` under R3-2, “The registry carries the whole `privacy.ts` default export”, in the contract spec's Export shape. No new generator change; preserve `privacyDataClasses` as that decision requires. Each optional member is validated independently so a bad recipient cannot hide valid classes.
- **`privacy` module**: `lib/register/` collector, renderers and command; no other module's ORM entities are imported.
- **Owner metadata services (new)**: directory resolves scope; entities lists custom metadata and counts effective map entities; integrations lists enabled recipients and shared/per-user credential presence. Each lives in its owner's `lib/` and `di.ts`, uses scoped decryption helpers, and returns metadata only.
- **Outbound-path owners**: declarations contain DI keys and locale keys only; status functions load only after scope validation, with no database or network calls at convention-file import time. They report configuration, never make live network health probes.

| Touchpoint | Mechanism | Absent or failure |
|---|---|---|
| Collector → scope names/membership | New `directoryPrivacyService.resolveScope(scope)` | Mandatory: exit 1, no collectors/file |
| Collector → data classes and recipients | Registry default object under R3-2; `getPrivacyDataClasses` and new `getPrivacyRecipients` | No classes: `no_data_classes`; invalid declaration: `declaration_invalid` |
| Collector → recipient status | Declared `statusService`, function `(scope) => Promise<PrivacyRecipientStatus>`, soft-resolved | `source_absent`, `source_failed`, `state_unknown` or `source_invalid`; labelled state not reported |
| Collector → integration presence | New `integrationPrivacyService.listRecipients(scope)` | `source_absent` or `source_failed`; never equate missing service to no integrations |
| Collector → custom fields/maps | New `entitiesPrivacyService.describeOrganization(scope)` | Missing module/service or thrown read is a gap for both custom metadata and encrypted counts; never silently omit |
| Collector → encryption availability | Existing `tenantEncryptionService.isEnabled()` and shared toggle/key/search predicates | Missing/failed facts are source gaps |
| Collector → webhook hosts | New webhooks-owned recipient status service `webhookPrivacyRecipientStatus` | Missing/throwing/invalid host is a gap; returns no URLs or secrets |
| Collector → operational/access-log windows | `getOperationalRetentionWindows()` from `@open-mercato/shared/lib/retention/windows` and `getAccessLogRetentionWindows()` from `@open-mercato/shared/lib/retention/accessLogWindows`, implemented and used by their owners | Missing/throwing accessor is a source gap; never copy defaults; uncollected retention areas remain gaps |
| Collector → enterprise record/subject-set policies | Optional `privacyRegisterPolicyService.list(scope)` adapter owned by `data_erasure`; current storage yields only `targetType: 'retention_set'` | `not_applicable`, with no gap, only for verified never-installed or owner-proven empty retired `data_erasure`; with the module enabled, a missing service is `source_absent` and a failure `source_failed`; successful empty array says no stored policies; never require a stored class policy |
| Collector → declared tenant retention limits | Contract `getPrivacySettings(modules)` enumerates declarations; R3-3 `privacySettingsService.get({ tenantId }, name)` supplies each value | Missing/failed source or required setting unset is a gap; never read `module_configs` here |

The directory metadata result is `{ tenant: { id, name }, organization: { id, name } } | null`, where null means no live membership match. Both ids are validated UUIDs. Only the directory owner reads its tenant/organization records.

`entitiesPrivacyService.describeOrganization(scope)` returns `{ customEntities: Array<{ id, label }>, customFields: Array<{ entityId, key, label, state: 'active' | 'inactive' | 'deleted' }>, encryptedEntityCount: number | null, historicalDefinitionsComplete: boolean }`. It reads its own `CustomEntity`, `CustomFieldDef` and `EncryptionMap` metadata, includes tenant-wide definitions applicable to the selected organization, and excludes other organizations and tenants in both lanes. The active metadata lane includes only active, non-deleted definitions. An independent owner metadata query includes in-scope inactive and soft-deleted records and returns them explicitly as historical metadata or marks historical completeness false. For distinct candidate entity ids in those map rows it uses `tenantEncryptionService.getEncryptedFieldNames(entityId, tenantId, organizationId, { ignoreRuntimeHealth: true, em })` for effective configured field resolution, including inherited map precedence, then counts nonempty results. It returns names/keys only, no field values or config blobs; never provisions a key. The encrypted count is configured effective coverage, not a scan of ciphertext. An unavailable encryption resolver makes that fact unknown rather than zero. Open only definition metadata. Failure to find or safely attribute historical definitions cannot certify the absence of retained values. Mark historical attribution incomplete when it cannot be established safely. A report with no known definitions still carries `source_omitted` if that completeness is unknown.

`integrationPrivacyService.listRecipients(scope)` returns `Array<{ integrationId: string; title: string; enabled: boolean; sharedCredentialsPresent: boolean; perUserCredentialsPresent: boolean }>`. It uses the owner's state/default resolution and scans credential presence across shared and per-user scopes (including its existing bundle fallback rules); it does not call the existing shared-only `get` as if that proved no user credentials. No credential values, tokens or user ids leave the service. “Per user” appears once even if many users have credentials. Enabled integrations without a recipient declaration get `recipient_undeclared` regardless of credential presence. Owner tests include per-user-only credentials and the other organization. It returns all enabled integration ids even when both credential-presence bits are false. A scope where an integration is known to be off and has no exposure may omit it from the active list; inactive declared recipients retain their separate controller blank.

Shared retention accessors return `Array<{ id: string; value: number | null; unit: 'hours' | 'days'; enabled: boolean; source: 'this_process' }>` from the exact parser used by the deleting owner, including keep/disabled values; no copied parser in the collector. The [operational-pruner spec](2026-11-16-operational-retention-pruners.md), “Shared process-window accessor”, owns `getOperationalRetentionWindows()` and these stable table ids: `sessions`, `password_resets`, `message_access_tokens`, `customer_user_sessions`, `customer_user_email_verifications`, `customer_user_password_resets`, `customer_user_invitations`, `webhook_deliveries`, `webhook_ingestions`, `push_notification_deliveries`, `integration_logs`, `sync_runs`, `progress_jobs`, `indexer_error_logs`, `channel_ingest_dead_letters` and `ai_moderation_flags`. The [access-log spec](2026-11-16-access-log-retention.md), “Shared process-window accessor”, owns `getAccessLogRetentionWindows()` and group ids `audit_logs.core` / `audit_logs.non_core`, meaning the configured listed kinds and their complement. Preserve the owners' sorted ids, units, nulls and effective values, including fractional access-log ages and disabled/clamped windows.

`enabled` describes an effective age rule, not completed counting, deletion mode or scheduler health. Zero with `enabled: true` means immediate expiry for `customer_user_sessions`; zero with `enabled: false` means keep. A disabled core row with a nonzero value can instead mean an empty listed-kind group, not indefinite retention of any rows. The operational accessor covers core system ticks only. Forms' per-form gates, legacy scoped integrations calls, B6 failed-job/quarantine cleanup and enterprise-owned windows need separate owner sources; until collected, add `source_omitted` gaps for the uncollected areas, never copy their defaults or treat these two accessors as a complete installation inventory.

The optional policy adapter returns `Array<{ id: string; targetType: 'data_class' | 'retention_set'; targetId: string; targetMode: 'records' | 'subjects'; window: number; unit: 'days'; mode: 'preview' | 'apply'; active: boolean; source: 'enterprise_policy' }>`, tenant-filtered, without subject or hold details. This is the single contract the DSR engine registers. The [DSR engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md), “Tenant settings and policy readers”, owns this adapter and its DI registration. Its current set-only storage returns `targetType: 'retention_set'` and maps `set_id` to `targetId`, `target_mode` to `targetMode` (record or subject retention set), `retention_days` to `window`, and `mode` / `is_active` to accurate mode / active metadata for live record and subject policies, including inactive and preview rows. Preserve the union; never fabricate a `data_class` policy from a setting. Class-specific windows stay in the separate R3-3 source. Policies are tenant-wide; label them as such in an organization draft. Never infer a class from a set id's spelling.

The owner specs now specify these accessors and the policy adapter, including their call sites and tests; implementation remains a delivery prerequisite. Applicability uses both the enabled list and authoritative installation/retained-data evidence. A verified never-installed source, or an owner-attested empty retired source, is `not_applicable` without a gap; this permits an OSS installation that never had `data_erasure` to exit 0. An installed-but-disabled source, unknown history or unavailable emptiness evidence is `not_reported` with `source_omitted`, never inferred empty from module absence. `source_absent` is reserved for an enabled owner whose service is not registered or not yet delivered. Tests distinguish never-installed, disabled with historical rows, disabled and owner-proven empty, and unavailable history. Shared-code sources (the two retention accessors, key-guard and search predicates) are always applicable. The file manifest cites the owners' paths; it does not authorize a foreign-table read, another adapter contract or a copied parser.

## 📝 Data Models

None.

## 📝 API Contracts

The following schemas are new shared exports from `packages/shared/src/modules/privacy.ts`. Category identifiers use snake case; new categories may be added additively, never renamed or removed.

```ts
export const privacyDataCategorySchema = z.enum([
  'identification', 'contact', 'authentication', 'communication_content',
  'financial', 'employment', 'location', 'device_and_network', 'free_text', 'files',
])
export type PrivacyDataCategory = z.infer<typeof privacyDataCategorySchema>
export const privacyRecipientScopeSchema = z.object({
  tenantId: z.string().uuid(), organizationId: z.string().uuid(),
}).strict()
export const privacyRecipientStatusSchema = z.object({
  state: z.enum(['active', 'inactive', 'unknown']),
  host: privacyHostSchema.optional(),
  configurationScope: z.enum(['organization', 'tenant', 'installation', 'per_user']).optional(),
  hosts: z.array(privacyHostSchema).optional(),
}).strict().refine(value => !(value.host && value.hosts))
export type PrivacyRecipientStatus = z.infer<typeof privacyRecipientStatusSchema>
export type PrivacyRecipientStatusService = (
  scope: z.infer<typeof privacyRecipientScopeSchema>
) => Promise<PrivacyRecipientStatus>
```

`privacyHostSchema` accepts a lower-case DNS hostname (or IP literal), without scheme, userinfo, port, path, query, fragment or control characters. Owners parse configured URLs with the platform URL parser and return only hostname; invalid configuration yields unknown without echoing the input. `host` is the single-endpoint form; `hosts` is a distinct sorted list for multi-endpoint owners such as webhooks. Neither field is a full URL. `configurationScope` defaults to `organization`; the owner returns `tenant` for tenant-wide configuration, `installation` for environment-wide configuration or `per_user` for a per-user outbound path, without user ids. The document carries the resolved `configurationScope` on every recipient and both renderers show it. Integrations' presence metadata also sets the normalized `perUser` marker when per-user credentials exist beside shared ones. Status schemas validate at collection time; unknown or malformed status adds a gap. Active without a configured endpoint is allowed and leaves an endpoint blank for the controller. Never log the raw invalid result.

```ts
register?: {
  activity: string
  dataCategories: PrivacyDataCategory[]
  specialCategoriesPossible?: boolean
}
recipients?: Array<{
  id: string
  title: string
  vendor?: string
  integrationId?: string
  receives: PrivacyDataCategory[]
  dataClassIds?: string[]
  statusService: string
}>
```

**Integration correlation.** `integrationId` is the integration owner’s stable declared id, validated against its registry; never correlate by title, vendor, host or credential presence. One integration may declare several outbound paths with distinct module-prefixed recipient ids, all explicitly carrying that integrationId. Presence rows attach shared/per-user activation evidence to each mapped path without creating duplicate recipient rows. An enabled integration with no matching declaration yields exactly one `recipient_undeclared` gap for its integration id. Duplicate recipient ids or a nonexistent integration reference are `declaration_invalid`. Environment-only recipients omit integrationId and resolve only their statusService. Tests cover one/multiple declared paths, undeclared enabled integration, per-user-only credentials, disabled historical presence and environment-only recipient; names matching by coincidence never merge.

`activity` and `title` are locale keys. The blocks have exported zod schemas validating nonempty ids/keys, category arrays and the optional class-id references. Recipient ids are module-prefixed and unique across enabled modules. A duplicate is rejected and reported as `declaration_invalid`; never overwrite a previous entry. Known class ids link to activities; unknown links add `declaration_invalid` rather than silently dropping the activity association.

- CLI refuses overwrite without `--force`, reuses the contract spec's CLI “File handling” rule (no-replace hard-link publication without force; same-filesystem atomic replacement with force), writes with owner-only permissions, and never prints credentials or custom-field values. Exit 1: usage, mandatory scope/container/key-guard or file-write failure, no partial file. Exit 2: file written with any gap, unless `--no-fail` changes it to 0. Exit 0 means a draft was written with complete machine sources, or `--no-fail` was requested; it never means controller review is complete. Print gap counts by code and a separate count of controller-completion blanks on every run. Do not recommend `--no-fail` to hide incomplete declarations; it is for workflows that deliberately consume partial drafts and inspect `gaps`.
- JSON is validated by the exported `privacyRegisterDocumentV1Schema`. `documentVersion` is literal `1`, `draft` literal `true`, tenant and organization ids are UUIDs (declaration/source ids are nonempty strings), `generatedAt` is ISO time, strings use the selected locale, counts are nonnegative integers, absent facts are null and collections remain arrays. Gap codes form the closed enum below; new codes are additive. Each `status` is `reported | not_reported | not_applicable`; `not_applicable` requires verified never-installed or owner-attested empty retired storage and is never a gap; disabled or unknown historical storage instead produces `source_omitted`. Recipient state additionally has `active | inactive | unknown`; `configurationScope` is `organization | tenant | installation | per_user`. Owner-local outputs are normalized to this shape before rendering. Both renderers show the same sources, gaps and controller blanks.

```json
{
  "documentVersion": 1,
  "draft": true,
  "tenant": { "id": "11111111-1111-4111-8111-111111111111", "name": "Example" },
  "organization": { "id": "22222222-2222-4222-8222-222222222222", "name": "Example organization" },
  "generatedAt": "2026-11-16T12:00:00Z",
  "productVersion": "example-build",
  "controller": { "identity": null, "contacts": null, "jointController": null, "representative": null, "dpo": null },
  "activities": [{ "id": "customers.people", "moduleId": "customers", "title": "People", "activity": "Manage contacts", "subjectKinds": ["customers:person"], "dataCategories": ["identification", "contact"], "specialCategoriesPossible": false, "purpose": null, "legalBasisOptional": null, "erasureTimeLimit": null, "recipientIds": [], "recipientsToComplete": true }],
  "tenantDefinedData": { "status": "reported", "customEntities": [], "customFields": [{ "entityId": "customers:person", "key": "example", "label": "Example", "state": "active", "classification": null }] },
  "recipients": [{ "id": "webhooks.outbound", "title": "Configured webhooks", "vendor": null, "state": "active", "hosts": ["receiver.example"], "receives": ["contact"], "dataClassIds": [], "configurationScope": "organization", "perUser": false, "country": null, "safeguard": null }],
  "inactiveRecipients": [{ "id": "communication_channels.system_email", "title": "System email", "vendor": null, "state": "inactive", "receives": ["contact", "communication_content"], "dataClassIds": [], "configurationScope": "installation", "perUser": false, "disclosedBefore": null }],
  "formerRecipientsToComplete": null,
  "hostingParty": null,
  "security": { "status": "reported", "encryptionConfigured": true, "encryptionAvailableThisProcess": true, "encryptedEntityCount": 3, "keyPolicyThisProcess": [], "searchSettingThisProcess": true, "otherTechnicalAndOrganisationalMeasures": null },
  "retention": { "status": "reported", "processWindows": [{ "id": "audit_logs.non_core", "value": 8, "unit": "hours", "enabled": true, "source": "this_process" }], "policies": [], "tenantSettings": [], "controllerTimeLimits": null },
  "notCovered": [{ "moduleId": "example", "classId": null, "reason": "no_data_classes", "allTablesNonPersonal": false }],
  "sources": [{ "id": "webhooks.outbound", "status": "reported", "state": "active" }, { "id": "data_erasure.register_policies", "status": "not_applicable", "state": null }],
  "gaps": [{ "code": "no_data_classes", "sourceId": "example", "activityId": null }],
  "completionRequired": true
}
```

`security.keyPolicyThisProcess` is the key guard's safe finding array or null when unavailable, not an encryption-backend name; an empty array means no findings. `security.searchSettingThisProcess` is the shared configured fulltext-exclusion boolean or null, never proof of existing index contents.

Nested optional information is explicit null: missing categories or special-category declarations are null rather than empty/false assertions. `erasureTimeLimit` is controller text or null; set policies stay in `retention.policies`, whose `targetType` / `targetId` union and row shape are specified in Architecture. Current engine rows always have `targetType: 'retention_set'`; retain source, window/unit, mode and active metadata. `tenantSettings` rows are `{ name: string, value: number | null, unit: 'days' | 'years', valueSource: 'tenant' | 'default' | 'unset', updatedAt: string | null, source: 'tenant_privacy_setting' }`. Units come from `getPrivacySettings(modules)`; value, source and version come from the R3-3 `get` result. Do not coerce invalid stored values into null: C1's `SETTING_INVALID` maps to gap code `source_invalid` and `SETTINGS_UNAVAILABLE` to `source_failed`, each with the setting name as safe source id. An unset value is null and adds `setting_unset`. `sources` records every attempted source, including inactive recipients and `not_applicable` sources; on a failed source its `state` is `unknown`. `inactiveRecipients` rows and `formerRecipientsToComplete` are controller blanks: `disclosedBefore` is controller text or null. `completionRequired` remains true while any controller blank remains. All arrays sort by stable id (custom fields by entity id then key; gaps by code/source/activity); policy and process windows retain their ids and units. In process windows, `enabled` describes the effective age rule, never scheduler health, deletion mode or completion of DEC-H's per-installation counting period; preserve the zero/enabled immediate-expiry exception and the empty core-group distinction. Markdown follows that same order.

Gap codes: `no_data_classes`, `register_undeclared`, `recipient_undeclared`, `declaration_invalid`, `source_absent`, `source_failed`, `source_invalid`, `state_unknown`, `source_omitted`, `setting_unset`. Every missing register/data category, omitted section or unreadable owner is represented, not just the literal words “not declared”. A successful empty optional source has no read-error gap. Declaration gaps are a normal early result and remain visible in machine output and the summary. Controller-completion blanks are listed separately and do not themselves force exit 2.

All changes are additive. The integration definition type is unchanged; the document schema and categories are frozen by the compatibility protocol once released.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A class of an enabled module that this organization has never used | Still listed: the register describes processing the organization can do, and the command does not count rows |
| A module disabled for the installation | Name its retained-data or unknown-coverage gap unless an owner-scoped source positively proves no data for the requested scope |
| A tenant override of the model provider | The tenant's provider is the active one |
| A provider configured by environment for every tenant | Listed for every organization with `configurationScope: 'installation'` |
| A provider configured once for the whole tenant | Listed with `configurationScope: 'tenant'`, distinct from an organization's own configuration |
| A declared recipient switched off after use | Listed under inactive declared recipients with a past-disclosure blank |
| OSS installation verified never to have installed `data_erasure` | Policy source `not_applicable`; no gap from it; disabled historical or unknown storage instead reports `source_omitted` |
| A credential that belongs to one user, such as a mailbox | The recipient is listed once, marked "per user" |
| The command run on a machine whose environment differs from the server's | Process-level facts are labelled "this process"; the docs say to run it where the server runs |
| Locale without translations | English |
| No class declares a `register` block yet | Mostly blanks plus `register_undeclared` gaps; exit 2 unless `--no-fail`; still prints gaps and completion summary |
| Recipient source throws or is unknown | Label state not reported; source gap; exit 2 unless `--no-fail` |
| Foreign tenant organization or mandatory container failure | Exit 1, no collectors and no output file, even with `--no-fail` |
| Optional source is absent or a section is omitted | Typed source gap, no silent success |
| Only per-user credentials exist | List the enabled recipient once as per user, exposing neither user nor credentials |
| Enabled undeclared integration with no stored credential | List it with `recipient_undeclared`, unknown activity if unavailable, and incomplete exit 2 |
| Inactive or soft-deleted scoped custom definition | List historical definition metadata or an explicit completeness gap; never read values |
| Module has only table/export declarations | List no data classes, with non-personal-table qualification when applicable |

## 📝 Migration & Backward Compatibility

Additive: optional data-class/default-export members read under R3-2, new owner metadata methods and shared retention accessors, a command and a versioned output schema. Existing credential getters and integration types keep their behavior; the new presence method covers per-user credentials separately. No new table or network probe. The shared accessors become the owners' source of truth without changing their deletion defaults. JSON v1 field names are stable, new category/gap identifiers additive. Nothing changes for an installation that never runs it.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | Command, header, activities, metadata/security/retention facts, gaps and not-covered list; register blocks on the first three classes | Doctor Phase 2 creates the module; contract Phase 3 supplies handlers and Phase 7 step 1 supplies R3-3 settings; doctor Phase 1 shared search predicates and the key-guard inspector before reporting their facts; operational/access-log shared accessors and the DSR-owned policy adapter before claiming their respective facts |
| 2 | Recipients: the member, the owners' declarations listed in Phase 2 step 2, enabled integrations, and recipient parity with G5's sub-processor table | Phase 1; G5 Stage 1's sub-processor table and package-coverage test |

## 📋 Implementation Plan

### Phase 1
1. Add optional blocks, category enum and zod schemas; collect from R3-2's complete default export without changing generators. `register-declarations.test.ts`: every category, invalid category, duplicate recipient ids, malformed member isolated from valid classes, export/table-only module gap.
2. Add directory membership, entities metadata/count and integration presence services in their owners with scoped helper reads; consume the owner-specified effective retention accessors and optional enterprise policy adapter. `register-owner-metadata.test.ts`: foreign tenant organization, tenant-wide versus other-organization custom fields/maps, per-user-only credentials, no secrets, effective map count and inherited settings. Collector unit tests with a fake registry: absent and throwing directory are fatal; an OSS registry with verified never-installed `data_erasure` and every applicable source complete exits 0 with the policy source `not_applicable`, while an enabled `data_erasure` with no registered adapter yields `source_absent`; `SETTING_INVALID` and `SETTINGS_UNAVAILABLE` map to `source_invalid` and `source_failed`; one missing/throwing/unknown/invalid-source case per optional touchpoint; each source gap yields exit 2 while `--no-fail` retains gaps. Include empty successful policy result and current record/subject policies as `retention_set` with exact `targetId`, source, window/unit, mode and active metadata; preserve the union without requiring/fabricating a stored class policy, and reject direct-class creation at the DSR boundary. Test no-class modules with only exports/tables and R3-3 declaration units, tenant/default/unset source, numeric values and unavailable/invalid settings. `register-retention-windows.test.ts` pins all sixteen operational table ids and `audit_logs.core` / `audit_logs.non_core`, exact accessor import paths/result parity, fractional and clamped values, zero/disabled keep, zero/enabled portal expiry, null/disabled moderation and empty listed-kind groups. Test report/counting history without a deletion/worker claim and `source_omitted` for every uncollected forms/scoped-integration/B6/enterprise area; no copied defaults. Include a disabled owner with retained or unknown data, a positively verified empty disabled source, and scoped inactive/deleted definitions. Assert exit 2 whenever owner coverage is unknown and verify no unscoped read. Exercise a soft-deleted in-scope definition while historical values remain and an out-of-scope inactive definition. Report the first as historical or incomplete and omit the second. No value payload is read.
3. Markdown/JSON renderers and document v1 zod schema. `register-renderers.test.ts`: matching gaps/blanks, activity recipient links and missing links, each of the four `configurationScope` values, inactive declared recipients with their past-disclosure blank and the former-recipients prompt, other-measures blank in both, stable ordering, record/subject-set windows, unknown facts as null, malformed document rejected. Snapshot tests.
4. Command using `createRequestContainer`, mandatory scope validation, safe key-guard/container refusal, atomic file write, `--force`, `--no-fail` and file mode. `register-cli.test.ts`: failure before file creation, disposal, non-overwrite, source exit status and summary. Declare register on the contract Phase 3 classes. Integration test TC-PRIVACY-REGISTER-001; run `yarn generate` for new owner `di.ts` files.

### Phase 2
1. Activate the recipients collector from Phase 1's shared schemas; validate input and result. `recipient-status.test.ts`: active/inactive/unknown, absent and throwing service, invalid/credential-bearing URL rejected, multi-host webhooks, duplicate ids, unknown activity reference; validate parity from R3-2 generated CLI module entry. Include an undeclared environment-only integration and an enabled one with no activation evidence or stored credential. Both are visible with a declaration gap; the latter is unknown.
2. Declarations and status functions, one PR per outbound owner. Each owner adds a `recipients` entry to its module's `privacy.ts` and its status function in the file named here:

   | Outbound path | Owner module | Status function |
   |---|---|---|
   | Outbound webhooks | `webhooks` | `packages/webhooks/src/modules/webhooks/lib/privacy-recipient-status.ts` |
   | System email (the transport registered through `registerEmailTransport` in `communication_channels/di.ts`; `packages/shared/src/lib/email/send.ts` is library code with no `privacy.ts`) | `communication_channels` | `packages/core/src/modules/communication_channels/lib/privacy-recipient-status.ts` |
   | Model providers, through the assistant's model factory, including inbox and warranty callers | `ai_assistant` | `packages/ai-assistant/src/modules/ai_assistant/lib/privacy-recipient-status.ts` |
   | Embeddings and the external fulltext host | `search` | `packages/search/src/modules/search/lib/privacy-recipient-status.ts` |
   | Attachment text extraction | `attachments` | `packages/core/src/modules/attachments/lib/privacy-recipient-status.ts` |
   | Telemetry exporter | `telemetry` | `packages/telemetry/src/modules/telemetry/lib/privacy-recipient-status.ts` |
   | Web-research adapters (Enterprise; their only consumer is agent orchestration) | `agent_orchestrator` | `packages/enterprise/src/modules/agent_orchestrator/lib/webSearch/privacy-recipient-status.ts` |
   | Identity provider (Enterprise) | `sso` | `packages/enterprise/src/modules/sso/lib/privacy-recipient-status.ts` |
   | Integration provider packages (`channel-*`, `gateway-*`, `carrier-inpost`, `tillio`, `storage-s3`, `sync-akeneo`) | Each package's own module | That module's `lib/privacy-recipient-status.ts`; an undeclared enabled one still appears through step 3 |

   Unit tests per owner: active, inactive, unknown, tenant override, organization filter, each `configurationScope` it can return and host-only output. Never enumerate another owner's tables.
3. Cover enabled integrations for the organization with and without a declaration, including environment-only and credential-free configurations. Emit `recipient_undeclared` for every enabled undeclared integration and use the known state or `unknown`. Unit tests.
4. Recipient parity: extend G5's `scripts/__tests__/gdpr-subprocessor-coverage.test.mjs` so every declared recipient id is named in the `Recipient ids` column of exactly one sub-processors row of its package or application/template owner, and every named id is declared there (G5, **The check — Recipient parity**). Cases: declared id with no row, row naming an undeclared id, id declared under a different package or application owner, non-literal id.
5. Integration test TC-PRIVACY-REGISTER-002; docs: how to finish the draft, including inactive declared recipients and the former-recipients prompt.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Modify |
| `packages/core/src/modules/privacy/{cli.ts,lib/register/*}` | Create / modify |
| `packages/core/src/modules/{entities,directory,integrations}/{di.ts,lib/privacy-register.ts}` and owner unit tests | Create / modify — metadata services, not assumed existing; the directory file also exports the doctor's `createDirectoryPrivacyTenantReader` |
| `packages/shared/src/lib/retention/{windows.ts,accessLogWindows.ts}`, operational pruner owners and `audit_logs/services/accessLogService.ts` | Owner delivery prerequisites — consume the shared effective windows; no second parser |
| `packages/enterprise/src/modules/data_erasure/{di.ts,services/registerPolicyService.ts}` | DSR-owned delivery prerequisite — optional policy adapter; OSS collector soft-resolves it |
| `packages/webhooks/src/modules/webhooks/{privacy.ts,di.ts,lib/privacy-recipient-status.ts}` | Create / modify — scoped host-only status |
| `privacy.ts` and `lib/privacy-recipient-status.ts` in each owner listed in Phase 2 step 2 | Create / modify |
| `scripts/__tests__/gdpr-subprocessor-coverage.test.mjs` | Modify — Phase 2 recipient-parity cases (G5-owned test) |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-REGISTER-00{1,2}.spec.ts` | Create |

## 🧪 Integration Coverage

Both run the command with JSON output in an isolated test environment. Each owns its tenants, organizations, users, fields, integrations, credentials and output files; create through owner APIs and remove or restore every fixture in `finally`. No demo data is required. Use fake provider configuration and no live vendor call; do not use a real credential.

| Test | Covers |
|---|---|
| TC-PRIVACY-REGISTER-001 | Controller and other-security-measures blanks, versioned schema, each declared activity and subject categories, encryption configured/available facts and map count; create a custom field through its API and assert it appears, then delete it in teardown. A foreign tenant's organization exits 1 and creates no output. A partial draft exits 2; `--no-fail` keeps identical gaps. In the verified never-installed OSS profile the policy source is `not_applicable` and produces no `source_absent` gap. Remove fields, custom entities/maps and disposable organizations plus both output files |
| TC-PRIVACY-REGISTER-002 | Two owned organizations: enable a uniquely named integration and create an organization-only custom field in the second; neither appears when running for the first. In the first, an enabled declared integration with only a per-user credential appears once as per user; an installed disabled integration does not. Create two webhook endpoints with credential-bearing URLs in the test fixture and assert only sanitized hosts appear; no userinfo, query or path survives. Deliver one event to a fixture receiver, then disable every endpoint and run again: `webhooks.outbound` moves to inactive declared recipients with a null past-disclosure blank, and the former-recipients prompt is present. Assert each recipient's `configurationScope`, including an installation-wide one. Activity-linked recipients render under their activity; absent links leave a blank. Enterprise profile adds record and subject retention-set policies and checks each yields `targetType: 'retention_set'`, its set id as `targetId`, `targetMode` `records` or `subjects`, source, window/unit, mode and active state, while every activity's erasure-time-limit blank remains and class-specific settings appear only in `tenantSettings`. It does not require or fabricate a direct class policy; the DSR API rejects one. Remove test policies, webhooks, delivery records, fake credentials, integrations, fields, users, both organizations and all files in `finally`, restoring prior integration state |

## 📝 Risks & Impact Review

#### The draft is filed as the register
- **Scenario**: A tenant submits the output unedited to an auditor.
- **Severity**: High
- **Affected area**: the tenant's accountability
- **Mitigation**: "Draft" in the title, the opening statement and every blank; a typed gap list and summary, exit 2 for machine-source gaps; the docs say what must be completed.
- **Residual risk**: A reader who ignores all of it.

#### A recipient is missing
- **Scenario**: Data leaves through a path whose owner declares no `recipients` entry.
- **Severity**: High
- **Affected area**: the recipients column
- **Mitigation**: Recipients are declared by their owners, listed by module and file in Phase 2, not picked by this command. The deployment docs spec's check requires every workspace package to be either on the third-party table or declared as sending nothing out, and Phase 2's recipient-parity case requires every declared recipient to have a table row and every row's recipient ids to be declared. Declared recipients that are now inactive stay visible as possible former recipients.
- **Residual risk**: Custom modules in an installation; a flow inside a listed package with no declaration, which only review catches; former recipients whose declaration was removed, left to the controller prompt.

#### A failed collector looks complete
- **Scenario**: A source is absent, throws or returns unknown, or the tenant and organization do not match.
- **Severity**: High
- **Affected area**: organization attribution, recipients, custom data, encryption and retention facts
- **Mitigation**: Mandatory scoped directory resolution before collection; typed per-source gaps and exit 2; unknown is never inactive or zero; no file after fatal setup failure; both tests own multiple scopes.
- **Residual risk**: An owner can return incorrect metadata with a valid shape. Process facts still describe only the command's environment, not another server process.

#### A declaration is wrong
- **Scenario**: A class declares fewer data categories than it holds.
- **Severity**: Medium
- **Affected area**: that activity's row
- **Mitigation**: The declaration sits beside the class's sections and handler, reviewed by its owner.
- **Residual risk**: Declarations age when fields are added.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for the integration definition type.

| Rule | Status | Notes |
|---|---|---|
| Additive contract change | Compliant | Optional members on two types |
| No cross-module table access | Compliant | Declarations and owners' functions only |
| No hard-coded strings | Compliant | Activities and labels are locale keys |
| Tenant scoping | Required by design | Resolve organization within tenant first; owner-scoped metadata; two-organization/foreign-tenant tests |
| Edition | Compliant | OSS under DEC-2 (assumption 7); the enterprise policy adapter and recipient declarations are soft-resolved; `not_applicable` requires verified never-installed or owner-proven empty retired scope. Disabled, unknown or historically populated unavailable sources remain `source_omitted` |
| Integration coverage | Required by design | Two self-contained command suites cover owner API fixtures, cleanup, foreign tenant and second organization; enterprise profile covers record/subject-set policies |

**Verdict:** Design ready. Written upstream approval must name this proposed OSS carrier under [DEC-2](2026-11-15-gdpr-ready-deployments-program.md#decisions) before implementation or OSS submission. Delivery then follows the listed owner-service and accessor dependencies.

## Changelog


### 2026-11-19 — Confirmed specification review corrections

- Distinguish disabled historical sources from verified absence and correlate recipient declarations using stable integration ids.
- Specification-only revision; implementation and planned acceptance tests remain future work.
### 2026-11-18 — Review remediation

- Separate live and historical custom-definition metadata reads and test attribution and completeness within the selected organization.

### 2026-11-18

- Kept undeclared environment integrations and retained or unverified disabled-owner/custom-definition coverage visible as register gaps.

### 2026-11-16
- Written autonomously with resolved assumptions. Declines two things the program asked the contract to carry for this package — legal basis and processing location — because neither is a fact the product can know; the program is corrected with it.
- Revised after independent review. The run is per organization, because integrations are. Recipients come from declarations by their owners instead of four hand-picked providers. The retention and security columns no longer claim sources that do not exist: retention sets store no window, and process-level settings are labelled as such. The gaps list is reduced to what a command can know. Art. 30(1)'s actual contents are followed: the controller's identity and contacts and the third-country safeguards are added as blanks, and legal basis becomes an optional one. Tenant-defined custom fields and entities are listed. The command gains `--force` and `--no-fail`, and Phase 1 has an integration test.

- Council round two fixes (GPT-6.1 Sol workers): r4-07 — typed recipient status and safe hosts; r4-08 — mandatory tenant/organization membership; r4-26 — new owner metadata/presence services; r4-27 — typed source gaps and honest exits; r4-35 — webhook status and effective-window accessors; r4-36 — table/export-only modules named; r4-41 — retention-set policies; r4-42 — stale wording and references; r4-46 — controller-only limit retained, program correction needed elsewhere; r4-47 — activity recipient links; r4-48 — other-measures blank; r4-49 — JSON v1 document/schema; r4-53 — time-limit rationale; r4-54 — category enum/schema; g7-21 — dependency and container lifecycle; g7-25 — second-organization fixtures; g7-37 — aligned legal-basis assumption; g7-38 — field cleanup; F-73/F-74/F-75 — draft exit summary and stale references.

- Council round two fixes, pass two (GPT-6.1 Sol workers): align set-only policy metadata and controller blanks with the DSR engine; enumerate typed tenant settings from contract Phase 7; fix the doctor scaffold dependency, canonical key/search facts and nullable encryption-count metadata; cite DEC-G, DEC-H and DEC-I; make outstanding owner accessor/adapter handoffs explicit.
- Council round two fixes, pass three (GPT-6.1 Sol workers): restore the DSR adapter's exact `targetType` / `targetId` union while keeping current storage set-only and R3-3 settings separate; consume the owners' canonical accessor and adapter paths, pin stable window ids and zero/enabled semantics, and expose uncollected retention areas without implying deletion, worker health or whole-installation coverage.

### 2026-11-17
- Declared inactive recipients are rendered as possible former recipients with a past-disclosure blank, plus a former-recipients prompt, because Art. 30(1)(d) covers past disclosures. Document v1 carries `configurationScope` on every recipient instead of the installation-wide flag.
- Sources whose owning module is not enabled are `not_applicable` with no gap, so an OSS run can exit 0; `source_absent` is kept for enabled owners. C1 settings errors map to `source_invalid` and `source_failed`.
- The policy adapter contract adds `targetMode` (record or subject set) and is the single shape the DSR engine registers.
- Phase 2 names every outbound owner with its module and status-function file and adds a recipient-parity check against G5's sub-processor table. The capability-archive step is removed.
