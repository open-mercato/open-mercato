# Privacy data-class contract

> **Tracker:** open-mercato/open-mercato#8593
> **Program:** [program](2026-11-15-gdpr-ready-deployments-program.md)
> **Edition:** OSS code, run by Enterprise: every core module ships its handler here; the Enterprise `privacy` module runs them ([DSR engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md)). Required for every Enterprise deployment, whichever core modules it enables.
> **GDPR basis:** Art. 15, 17, 20, 25(1), 30

## TLDR

- A module that stores personal data declares it in an auto-discovered `<module>/privacy.ts` and registers a handler that exports and erases one subject's data in that module's own tables.
- The types and zod schemas live in `packages/shared/src/modules/privacy.ts`. `yarn generate` adds each declaration to the module registry as `Module.privacy`.
- This spec ships the three root handlers: `auth:user`, `customers:person` and `customer_accounts:user`.
- `privacy.ts` is the personal-data registry. Each entity holding personal data is registered with a strategy (delete, anonymize, or legally retained), so one central erase call reaches it. This applies to platform modules and to modules an agent or developer adds in a standalone app.
- A coverage check fails when a table in any module snapshot is neither registered nor exempt with a reason. It runs in the monorepo and in every standalone app's `yarn test`. Today's platform gaps sit in a baseline that may only shrink. The standalone `AGENTS.md`, the module-scaffold skill and the template modules carry the rule.
- OSS ships no runner. No CLI, route or page calls a handler. Export and erasure runs belong to the Enterprise `privacy` module.

## Overview

The contract lets an operator answer "what do we hold about this person?" and "remove it" across modules without any module reading another module's tables. Each module stays the only code that touches its tables. The Enterprise orchestrator collects the declarations, calls the handlers and assembles the result. Module coverage beyond the three roots is in [privacy coverage](2026-11-16-privacy-coverage.md) (OSS) and [enterprise coverage](../enterprise/GDPR/2026-11-16-privacy-coverage-enterprise.md).

> **Market reference.** WordPress core registers per-plugin exporters and erasers through one filter, and each returns its items plus "items removed / items retained" messages. Adopted: per-module handlers, a retained-with-reason outcome, one export document per request. Rejected: email as the only identity, because CRM people are linked by id and found by phone too.

## Problem Statement

- No module can declare its personal data, and nothing exports or erases one person across modules. Only `forms` has a local export (`forms/services/export-service.ts`).
- The declarative precedent exists: `encryption.ts` is collected by the generator in the three registry emitters of `packages/cli/src/lib/generators/module-registry.ts` and surfaced as `Module.defaultEncryptionMaps` (`packages/shared/src/modules/registry.ts:288`, collector `getDefaultEncryptionMaps` at `:529`).
- Deleting a person is refused with 422 `PERSON_HAS_DEPENDENTS` when a deal links the person (`customers/commands/people.ts:1326-1329`). A person can therefore not be erased today if they ever had a deal.
- Deleting a person nulls `customer_entity_id` on orders and quotes (`sales/subscribers/reconcileOnCustomerDelete.ts`). A run that deletes the root first loses the link the sales handler needs.
- `customer_entities.primary_email` and `primary_phone` are encrypted without a lookup hash (`customers/encryption.ts`). A person can only be found by an address after decryption.
- Deleting a record soft-deletes its custom-field values (`packages/shared/src/lib/data/engine.ts:656-674`), so the values stay.
- `users.organization_id` is nullable: a staff user can belong to the whole tenant.

## Proposed Solution

1. **Declare.** A module adds `privacy.ts` with a default `PrivacyModuleDeclaration`: its data classes and the tables each class covers, plus exempt tables with a reason.
2. **Implement.** The module registers a `PrivacyHandler` under a DI key in its `di.ts`. The handler reads its own entities through the decryption helpers and writes through its own commands or services.
3. **Invoke.** The Enterprise `privacy` module calls the handlers of every enabled module, core, Enterprise, official or app alike. Handlers are unit- and integration-tested in their own module. In an OSS-only deployment nothing calls them.
4. **Guard.** A coverage unit test and a scaffold stub keep new tables from slipping through.

### Design decisions

| Decision | Rationale |
|---|---|
| One file per module, discovered like `encryption.ts` | No global mutable store; the declaration is readable without booting the app |
| Tables named per class, not columns | The coverage test can check every table; column detail lives in the handler |
| Handlers own all writes | Module isolation; owner commands keep CRUD events, index and cache side effects |
| History, search, CRUD cache and files handled once by the orchestrator from `touched` | Each handler would otherwise repeat four cross-module calls |
| Roots run last | Deleting a person nulls the order link that the sales handler needs |
| Person lookup decrypts | No hash column exists; a decrypting scan is slow on large tenants but never misses a person |

## Architecture

### Declaration and discovery

- `privacy.ts` default-exports a `PrivacyModuleDeclaration`. Named exports are not read.
- The generator gains the file in the three emitters of `module-registry.ts` (`generateModuleRegistryFromDiscovery`, `generateModuleRegistryAppFromDiscovery`, `generateModuleRegistryCliFromDiscovery`), next to the `encryption.ts` step, and emits it as the `privacy` member of each module. `privacy.ts` is added to `STRUCTURAL_CONVENTION_FILES` in `packages/cli/src/lib/generate-watch-structure.ts`. No module-fact kind is added; `runtime.ts` is the precedent for a convention without one.
- `Module` in `packages/shared/src/modules/registry.ts` gains `privacy?: PrivacyModuleDeclaration`. A collector `getPrivacyDeclarations(modules)` validates each declaration with the zod schema, stamps the module id, and throws on a duplicate class id or a table claimed by two classes.

### Handler rules

- Owner-only: a handler reads and writes only its module's tables. Another module's data is reached through that module's handler or a DI service it owns.
- Reads use `findWithDecryption` / `findOneWithDecryption`. Soft-deleted rows are included: a row that still holds personal data is still held.
- Every query carries `tenant_id`. When `scope.organizationId` is set, add `organization_id = :org OR organization_id IS NULL`. Children without scope columns are reached through a checked parent.
- Export builds each record field by field from an explicit list. Password hashes, lookup hashes, tokens, secrets and integrity hashes are never exported. Dates are ISO strings.
- Erasure writes through the owner's commands or services, with `skipLog` where a new audit snapshot would store the erased values again.
- Erasure is idempotent: a second run changes nothing and reports the same `retained` entries.
- `dryRun: true` writes nothing and returns the counts and `touched` refs a real run would produce.
- An `open_case` record (pending payment, open claim, locked cart, running workflow) is reported with `retainedUntil: null` and left unchanged; the operator retries later.
- `pruneExpired` has no central pass: it writes through the owner's commands (so search and cache follow), and deletes the files of the records it deletes or anonymizes itself, through `attachmentService.deleteByIds`.
- `touched` lists every record the handler changed or deleted, as `{ entityType, recordId, organizationId }` with the entity id used by the module's events and index (for example `customers:customer_entity`) and the record's organization (null for tenant-wide rows). The orchestrator uses it once for the history strip (`actionLogService.stripForResources`, [audit-snapshot redaction](2026-11-16-audit-snapshot-redaction.md)), search-index removal and CRUD-cache invalidation. A dry run returns the refs a real run would touch.
- `filesToDelete` lists the attachment ids the handler wants removed; the orchestrator deletes them centrally through the attachments service. The handler decides: files of a record kept under `legal_retention` (an invoice PDF on a retained order) are not listed, files of deleted or anonymized records are. Files are never deleted merely because their record appears in `touched`.

### Subjects and lookup

- Subject kinds: `auth:user`, `customers:person`, `customer_accounts:user`, `staff:team_member`. Only the owning module resolves its kind.
- `PrivacyLookup` carries the subject's known addresses: those the operator supplies plus those the roots hold for the subject. It may be the only key, for a guest payer, a form invitee or an email correspondent who has no record.
- `findSubjects` (roots only) maps addresses to record subjects. It returns candidates; the orchestrator never acts on one the operator has not confirmed.
- A non-root handler matches identifier-only records against `lookup` only when the record has no linked subject id. Where the column's encryption map declares a `hashField`, match `hash IN lookupHashCandidates(value)` (`@open-mercato/shared/lib/encryption/aes`) or the normalized plaintext for rows written with encryption off, as login does (`auth/commands/users.ts:332`). Today that covers `users`, `customer_users`, `customer_user_invitations`, `messages.external_email` and `onboarding_requests`.
- Without a hash, the handler decrypts its own tenant rows in keyset batches of 500 and compares normalized values (emails trimmed and lower-cased; phones as digits, `normalizePhoneDigits` in `customers/api/people/check-phone/route.ts:24-26`). This is allowed for the person root and for the low-volume stores named in the coverage spec. A high-volume table without a hash is reached through linked ids only, and the gap is stated there.

### Export

The orchestrator writes one JSON document per subject: the subject reference, scope, generation time, and for each data class its id and `sections`. `related` subjects are exported in their own documents. Every file listed in `files` (an `attachments` record id and file name) is copied next to the document, so the subject receives copies of their files as Art. 15(3) requires. A handler lists files of its own records through the attachments module's read service.

### Erasure and ordering

- The orchestrator runs every non-root class first and each root last.
- It passes `prefer: 'anonymize'` to a root when any class reported `retained` rows for that subject, so the retained records keep a valid link to an anonymized record.
- A root may anonymize on its own evidence (a linked deal) even without `prefer`.

### The three roots

| Class (DI key) | Tables | Exempt | Erase mode |
|---|---|---|---|
| `auth.users` (`authPrivacyHandler`) | `users`, `user_acls`, `user_roles`, `sessions`, `password_resets`, `user_sidebar_preferences`, `sidebar_variants`, `user_consents` | `roles`, `role_acls`, `role_sidebar_preferences` (role configuration) | `delete` |
| `customers.people` (`customersPrivacyHandler`) | `customer_entities`, `customer_people`, `customer_addresses`, `customer_comments`, `customer_activities`, `customer_interactions`, `customer_tag_assignments`, `customer_label_assignments`, `customer_person_company_links`, `customer_person_company_roles`, `customer_entity_roles`, `customer_todo_links`, `customer_email_conversation_shares`, `customer_deal_people`, `customer_deals` | Company records (`customer_companies`, `customer_company_billing`, `customer_deal_companies`), deal history without person data (`customer_deal_stage_transitions`), configuration (`customer_pipelines`, `customer_pipeline_stages`, `customer_dictionary_entries`, `customer_dictionary_kind_settings`, `customer_settings`, `customer_tags`, `customer_labels`) | `delete` |
| `customer_accounts.users` (`customerAccountsPrivacyHandler`) | `customer_users`, `customer_user_sessions`, `customer_user_email_verifications`, `customer_user_password_resets`, `customer_user_invitations`, `customer_user_roles`, `customer_user_acls` | `customer_roles`, `customer_role_acls`, `domain_mappings` (configuration) | `anonymize` |

#### `auth:user`

- **Find:** `$or: [{ email }, { emailHash: { $in: lookupHashCandidates(email) } }]` in the tenant. Users with a null tenant are not reachable by a tenant request.
- **Export:** user (email, name, organization, confirmed flag, last login, timestamps), role names, per-user ACL features, consents (type, granted, granted/withdrawn dates, source, IP), sessions and password resets as timestamps only, sidebar preferences and variants, custom-field values.
- **Erase:** run the existing `auth.users.delete` command with `skipLog`. It keeps the last-admin floor (`enforceProtectedRoleFloor`); a refusal is reported as `open_case` on `users` and nothing changes. The delete removes ACLs, roles, sessions, resets and sidebar rows and emits `auth.user.deleted`, which the per-user stores react to ([coverage Phase 1](2026-11-16-privacy-coverage.md#phase-1--user-delete-cascade-fix)).
- **Consents:** rows keep `consent_type`, `is_granted`, `granted_at`, `withdrawn_at` and `user_id` as proof of consent (Art. 7(1)). `ip_address` and `source` are cleared and `integrity_hash` is recomputed with `computeConsentIntegrityHash` (`auth/lib/consentIntegrity.ts`). Reported as `legal_retention`, `retainedUntil: null`.

#### `customers:person`

- **Find:** decrypting scan of `customer_entities` of kind `person` in scope: email against trimmed, lower-cased `primary_email`; phone against the digits of `primary_phone`.
- **Export:** person and profile fields, addresses, comments, activities, interactions, tags and labels, company links and roles (company display name only), entity roles, todo links, email-conversation shares, and linked deals (title, description, stage, status, value, currency, loss notes). Custom values of `customers:customer_entity` and `customers:customer_person_profile`. `related`: none.
- **Delete** (no deal link, no `prefer: 'anonymize'`): run the existing `customers.people.delete` command with `skipLog`. It removes addresses, comments, activities, interactions, todo links, tags, company links, deal links, conversation shares and the person's and profile's custom values (`customers/commands/people.ts:1335-1349`). Before it, the handler deletes `customer_person_company_roles` and `customer_entity_roles` rows of the person, and the custom values of the person's activities and interactions through `entitiesPrivacyService`. The command deletes neither, and the roles foreign key has no `ON DELETE` (`customers/migrations/Migration20260411130944.ts:17`), so without this step the delete fails. The role-row part is also an ordinary-delete bug, fixed in [coverage Phase 1](2026-11-16-privacy-coverage.md#phase-1--user-delete-cascade-fix). Field-by-field detail: [CRM and Sales in detail](2026-11-16-privacy-coverage.md#crm-and-sales-in-detail).
- **Anonymize in place** (a deal links the person, or `prefer: 'anonymize'`): keep the `customer_entities` row and its id; clear `display_name` to a fixed placeholder, `primary_email`, `primary_phone`, `description`, `next_interaction_name` and the profile's name and contact fields; delete the child rows listed above except deal links; delete the person's custom values; set new `customer_entities.anonymized_at`.
- **Deals:** a deal linked only to this person keeps amounts, currency, stage, status and dates; its `title` becomes a placeholder, `description` and `loss_notes` are cleared, and its custom values are deleted. Its files are listed in `filesToDelete`. A deal also linked to another person or a company is unchanged and reported as `other_party`.

#### `customer_accounts:user`

- **Find:** `email_hash IN lookupHashCandidates(email)` on `customer_users` and `customer_user_invitations` in the tenant, soft-deleted rows included.
- **Export:** account (email, display name, verification, last login, lock state, active flag, timestamps), sessions with IP and user agent, roles, ACL, verifications and resets as timestamps, invitations addressed to the subject. `related`: `customers:person` from `person_entity_id`.
- **Erase (anonymize):** `customerUserService.anonymize(userId, scope)` sets `email` to `erased+<id>@erased.invalid` and `email_hash` to its hash (the column is not nullable and the tenant/hash unique index covers live rows), nulls `password_hash` and `person_entity_id`, sets `display_name` to a fixed placeholder, `is_active = false`, `deleted_at` when empty, `sessions_revoked_at`, and new `anonymized_at`; resets lockout counters; deletes sessions, verifications, resets, role and ACL rows, and invitations addressed to the subject. `customer_entity_id` (the company account link) stays. The row stays so orders, carts, claims and tickets that reference the id still resolve. The routine ships with the portal-user delete fix in [coverage Phase 1](2026-11-16-privacy-coverage.md#phase-1--user-delete-cascade-fix).

### Custom-field values

The `entities` module registers `entitiesPrivacyService` in its `di.ts` with `exportValues(scope, refs)` and `deleteValues(scope, refs)`, where `refs` are `PrivacyRecordRef[]` the caller owns. Both include soft-deleted values; delete is a hard delete. Handlers call it for their own records. The `entities` tables are exempt in its `privacy.ts` with that reason. Tenant-defined custom entities (`custom_entities_storage`) have no owning module and are a stated limit.

### Coverage test

The check is one shared function, `checkPrivacyCoverage({ moduleRoots, baselinePath, maxBaseline })`, exported from `@open-mercato/shared/modules/privacy-coverage` (Node-only, test use). It reads every `migrations/.snapshot-open-mercato.json` under the given module roots and imports each module's `privacy.ts` when present. Two tests call it:

- the monorepo test `packages/core/src/__tests__/privacy-table-coverage.test.ts`, over `packages/*/src/modules/*` and `packages/create-app/template/src/modules/*`;
- the standalone-app test `packages/create-app/template/src/__tests__/privacy-coverage.test.ts`, over the app's own `src/modules/*`. Installed package modules are checked upstream, not in the app. The template ships an empty baseline, so `yarn test` in a new app fails as soon as an app module adds a table that is neither registered nor exempt.

It fails when:

- a snapshot table is not claimed by exactly one class `tables` entry, not in `exemptTables`, and not in `packages/core/src/__tests__/privacy-coverage-baseline.json`;
- a declaration fails the zod schema, claims a table absent from its own snapshot, or both claims and exempts a table;
- the baseline lists a table that is now claimed, exempt or gone;
- the baseline holds more entries than the `MAX_BASELINE_TABLES` constant in the test. Each coverage phase lowers the constant; raising it fails review.

Tables created outside module snapshots (the pgvector store, the Meilisearch index) are derived copies removed per `touched` record and are not seen by this test.

### Personal-data registry for new modules (platform and standalone apps)

`privacy.ts` is the personal-data registry. Every module that stores personal data, in the platform or in a standalone app, registers its entities there: which subjects they hold data about, which tables, which handler, and which strategy. The central erase call then reaches the new module without any change elsewhere. In Enterprise that call is one CLI command, one `POST /api/privacy/erase` and one admin action ([DSR engine](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md)). A table that is not registered or exempt fails the coverage test, so an agent or developer cannot add personal data silently.

**Strategy rule.** For each entity, pick the first that fits:

| Strategy | When | What the handler does |
|---|---|---|
| `delete` | The record exists only because of this person: their booking request, preferences, saved filters | Deletes the row and its children through the owner's command |
| `anonymize` | The record must survive for someone else or for totals: an order line in a report, a booking another guest shares, a deal with a company | Keeps the row and its non-personal facts (dates, amounts, status, ids); clears or replaces every personal field; sets `anonymized_at` when a later write must be refused |
| `retained` with `legal_retention` | Law requires the personal data itself: an invoice under tax law | Keeps only a fixed field allowlist; reports `retainedUntil`; `pruneExpired` anonymizes it when the tenant's `retentionSetting` period ends |
| exempt | The table holds no personal data: configuration, catalog, resources | Listed in `exemptTables` with a one-line reason |

`eraseMode` on the class is its default (`delete` or `anonymize`). A handler may still report rows as `retained` or `open_case` per request.

**Example: a standalone app adds a `bookings` module.** Its `bookings` table holds `customer_entity_id`, `guest_name`, `guest_email` and `notes`; its `resources` table holds rooms. A paid booking appears on an invoice.

```ts
// src/modules/bookings/privacy.ts
import type { PrivacyModuleDeclaration } from '@open-mercato/shared/modules/privacy'

const privacy: PrivacyModuleDeclaration = {
  dataClasses: [
    {
      id: 'bookings.bookings',
      subjectKinds: ['customers:person'],   // found by customer_entity_id, or by lookup email for guests
      tables: ['bookings'],
      handler: 'bookingsPrivacyHandler',     // registered in src/modules/bookings/di.ts
      eraseMode: 'anonymize',                // bookings feed invoices and occupancy reports
    },
  ],
  exemptTables: { resources: { reason: 'Rooms and equipment; no person data' } },
}

export default privacy
```

The handler exports the person's bookings and on erasure clears `guest_name`, `guest_email` and `notes` while keeping dates, room and price. `guest_email` gets a `hashField` in `encryption.ts` so guests without a CRM record are found by `lookup`.

**Guardrails.**
- **Standalone `AGENTS.md`** (`packages/create-app/template/AGENTS.md`, *Always*): "An entity that stores personal data is registered in its module's `privacy.ts` (class, tables, handler, strategy: delete, anonymize or legally retained); tables without personal data are exempt with a reason. `yarn test` runs the privacy coverage check." Editing the template follows the create-app template-sync checklist and the `om-refresh-standalone-harness` skill.
- **Scaffold skill** (`packages/create-app/agentic/shared/ai/skills/om-module-scaffold/`): `references/data-and-migrations.md` step 4 adds "register personal-data entities in `privacy.ts` with a strategy and handler"; `references/discovery-surface-catalog.md` gains a `privacy.ts` row.
- **Data-model skill** (`packages/create-app/agentic/shared/ai/skills/om-data-model-design/references/sensitive-data.md`): step 1's "retention/deletion" item points to the strategy rule above, with the booking example.
- **Template modules:** `example` and `example_customers_sync` ship a `privacy.ts`, so a scaffolded module starts with the file.
- **`yarn generate`** prints one warning line per app module whose snapshot has tables but no `privacy.ts`. It is non-fatal, so it shows up in the agent's own output before tests run.
- **Official modules:** `external/official-modules` follows the same contract and runs `checkPrivacyCoverage` over its own modules in its own CI. That is a follow-up PR in that repository; until it lands, the Enterprise run reports those modules under `notCovered`.
- **Monorepo:** `.ai/docs/module-development.md` and the Encryption section of `packages/core/AGENTS.md` gain the same one-line rule; `.ai/review-checklist.md` gains "a new table is registered in `privacy.ts` or exempt with a reason, and the coverage baseline did not grow".

## Data Models

- `customer_entities.anonymized_at` (timestamptz, nullable): set when a person is anonymized in place.
- `customer_users.anonymized_at` (timestamptz, nullable): set by `customerUserService.anonymize`.
- No other table. Retention periods live in `module_configs` under the class's `retentionSetting` key.

## API Contracts

### Types — `@open-mercato/shared/modules/privacy`

```ts
export type PrivacyScope = { tenantId: string; organizationId?: string }
export type PrivacySubject = { kind: string; id: string }            // 'auth:user' | 'customers:person' | 'customer_accounts:user' | 'staff:team_member'
export type PrivacyLookup = { emails?: string[]; phones?: string[] } // known addresses of the subject; may be the only key (guest payer, form invitee, email correspondent)
export type PrivacyRequest = { scope: PrivacyScope; subject?: PrivacySubject; lookup: PrivacyLookup } // subject or non-empty lookup required
export type PrivacyRecordRef = { entityType: string; recordId: string; organizationId?: string | null }
export type PrivacyRetainReason = 'legal_retention' | 'open_case' | 'other_party'
export type PrivacyExportResult = { sections: Array<{ key: string; records: Array<Record<string, unknown>> }>; files?: Array<{ attachmentId: string; fileName: string }>; related?: PrivacySubject[] }
export type PrivacyEraseResult = {
  deleted: number; anonymized: number
  retained: Array<{ table: string; count: number; reason: PrivacyRetainReason; retainedUntil: string | null }>
  touched: PrivacyRecordRef[]   // records changed or deleted; orchestrator uses this once, centrally, for history strip, search-index removal and CRUD-cache invalidation
  filesToDelete: string[]       // attachment ids the orchestrator deletes centrally; never files of legally retained records
}
export type PrivacyHandler = {
  findSubjects?(scope: PrivacyScope, lookup: PrivacyLookup): Promise<PrivacySubject[]>
  exportSubject(request: PrivacyRequest): Promise<PrivacyExportResult>
  eraseSubject(request: PrivacyRequest, opts: { dryRun: boolean; prefer?: 'delete' | 'anonymize' }): Promise<PrivacyEraseResult>
  pruneExpired?(scope: PrivacyScope, olderThan: Date, opts: { dryRun: boolean; limit: number }): Promise<{ deleted: number; anonymized: number; done: boolean }>
}
export type PrivacyDataClass = {
  id: string                    // '<module>.<name>'
  subjectKinds: string[]
  tables: string[]              // own tables this class covers (coverage test)
  handler: string               // DI key of a PrivacyHandler registered in the module's di.ts
  eraseMode: 'delete' | 'anonymize'
  retentionSetting?: string     // module-config key holding a tenant-chosen retention (days); unset = keep; used by pruneExpired
}
export type PrivacyModuleDeclaration = { dataClasses: PrivacyDataClass[]; exemptTables?: Record<string, { reason: string }> }
```

The same file exports zod schemas for `PrivacyModuleDeclaration` and `PrivacyRequest`: class id `<moduleId>.<name>` in snake case and prefixed by the declaring module; subject kinds `<module>:<name>`; at least one table per class; non-empty exempt reasons; a request needs `subject` or a non-empty `lookup`. Types are derived from the schemas where they describe data. `retentionSetting` is read through the configs module's `moduleConfigService`; an unset value means keep, so `pruneExpired` is not called and `retainedUntil` is null.

### Example declaration

```ts
import type { PrivacyModuleDeclaration } from '@open-mercato/shared/modules/privacy'

const privacy: PrivacyModuleDeclaration = {
  dataClasses: [
    {
      id: 'customer_accounts.users',
      subjectKinds: ['customer_accounts:user'],
      tables: ['customer_users', 'customer_user_sessions', 'customer_user_email_verifications', 'customer_user_password_resets', 'customer_user_invitations', 'customer_user_roles', 'customer_user_acls'],
      handler: 'customerAccountsPrivacyHandler',
      eraseMode: 'anonymize',
    },
  ],
  exemptTables: {
    customer_roles: { reason: 'Role configuration; no person data' },
    customer_role_acls: { reason: 'Role configuration; no person data' },
    domain_mappings: { reason: 'Portal domain configuration; no person data' },
  },
}

export default privacy
```

### DI and services

| Key | Module | Purpose |
|---|---|---|
| `authPrivacyHandler`, `customersPrivacyHandler`, `customerAccountsPrivacyHandler` | owning module | `PrivacyHandler` for the roots |
| `entitiesPrivacyService` | `entities` | `exportValues(scope, refs)`, `deleteValues(scope, refs)` |
| `customerUserService.anonymize(userId, scope)` | `customer_accounts` | Additive method used by the root and by portal-user delete |
| `customerPersonLookupService.getProfileId(scope, personEntityId)` | `customers` | Returns the person's `customer_people.id` (or `null`). Orders and quotes store it as `customer_contact_id`, so the sales handler needs it without reading `customers` tables |

No API route, CLI command, event or ACL feature is added.

## Migration & Compatibility

- `privacy.ts` is a new, optional auto-discovery file and `Module.privacy` a new optional member: additive. Modules without the file keep working; their tables sit in the baseline.
- Two nullable columns are added by ordinary module migrations; no backfill.
- No existing type, route, event payload or command id changes.

## Risks & Impact Review

#### A record of the wrong person is erased
- **Scenario**: Two people share a mailbox; a guest order matched only by address belongs to the other one.
- **Severity**: High
- **Affected area**: identifier-only matches in every non-root class
- **Mitigation**: `findSubjects` returns candidates the operator confirms; address matching applies only to records with no linked subject id; dry run lists every match before apply.
- **Residual risk**: The operator confirms identity (Art. 12(6)); the procedure is in the deployment docs.

#### Cross-tenant read or write
- **Scenario**: A handler query omits `tenant_id`.
- **Severity**: Critical
- **Affected area**: every handler
- **Mitigation**: tenant predicate on every query; each handler's unit tests cover tenant, organization and null-organization branches; integration tests seed two tenants.
- **Residual risk**: Low; reviewed per handler.

#### Root deleted before dependants
- **Scenario**: The person is deleted first; `sales:reconcile-on-person-delete` nulls the order link and the sales handler finds nothing.
- **Severity**: High
- **Affected area**: customers, sales
- **Mitigation**: roots run last; `prefer: 'anonymize'` keeps the person row when any record is retained.
- **Residual risk**: None when the orchestrator follows the order.

#### Person lookup is slow
- **Scenario**: A tenant with hundreds of thousands of people; the decrypting scan takes minutes.
- **Severity**: Medium
- **Affected area**: `customers.people.findSubjects`
- **Mitigation**: keyset batches of 500, one batch in memory; it runs once per request.
- **Residual risk**: Accepted; a lookup hash on the person is security-backlog work.

#### A new module stores personal data without a declaration
- **Scenario**: A table ships with no class and no exemption.
- **Severity**: Medium
- **Affected area**: export completeness
- **Mitigation**: coverage test, capped baseline, scaffold stub, review-checklist line.
- **Residual risk**: Free text in a claimed table can still mention other people; stated limit.

## Implementation Plan

### Phase 1 — Types, discovery, collector
1. Add `packages/shared/src/modules/privacy.ts` with the types and zod schemas.
2. Add `privacy?` to `Module` and `getPrivacyDeclarations(modules)` to `registry.ts`.
3. Add `privacy.ts` to the three registry emitters and to `STRUCTURAL_CONVENTION_FILES`; run `yarn generate`.
4. Tests: schema unit tests (bad id prefix, empty tables, empty reason, request without subject or lookup); generator test that a fixture module's default export reaches `Module.privacy` in all five generated files; collector tests for duplicate class id and double-claimed table.

### Phase 2 — Coverage check and personal-data registry guardrails
1. Add `checkPrivacyCoverage` to `@open-mercato/shared/modules/privacy-coverage`, the monorepo test, and the baseline JSON listing every current table; set `MAX_BASELINE_TABLES` to its size.
2. Add the standalone-app test `src/__tests__/privacy-coverage.test.ts` with an empty baseline to the create-app template; run `yarn template:sync:fix`.
3. Add the `yarn generate` warning for app modules with tables and no `privacy.ts`.
4. Add the template `privacy.ts` stubs, the standalone `AGENTS.md` rule, the scaffold and data-model skill lines, the monorepo module-guide lines and the review-checklist line. Run `yarn agents:check-budget` for the `AGENTS.md` change.
5. Tests: unit tests of `checkPrivacyCoverage` with fixture modules (unclaimed table, stale claim, stale baseline entry, table both claimed and exempt); the generator warning; a `packages/create-app` unit test that runs `checkPrivacyCoverage` over the template's `src/modules` (passes) and over the template plus a fixture module with an unregistered table (fails). `packages/create-app/src/lib/agent-instruction-budget.test.ts` must keep passing after the `AGENTS.md` line.

### Phase 3 — Custom values and `auth:user`
1. `entitiesPrivacyService` with unit tests (soft-deleted values, scope, hard delete).
2. `auth/privacy.ts`, `auth/lib/privacy.ts`, DI registration; consent scrub with recomputed hash.
3. Remove the auth and entities tables from the baseline.
4. Tests: unit tests per query branch; `TC-PRIVACY-AUTH-001`.

### Phase 4 — `customers:person`
1. Migration for `customer_entities.anonymized_at`; handler with delete and anonymize paths and the deal rule.
2. Remove the customers tables from the baseline.
3. Tests: unit tests for both paths and the deal rule; `TC-PRIVACY-CUSTOMERS-001`.

### Phase 5 — `customer_accounts:user`
1. Handler using `customerUserService.anonymize` (the method and its `anonymized_at` column ship in coverage Phase 1).
2. Remove the customer_accounts tables from the baseline.
3. Tests: unit tests; `TC-PRIVACY-CACC-001`.

## Integration Coverage

Handler integration tests are PostgreSQL-backed jest tests (`*.integration.test.ts`, run by `yarn test:pg-integration`), since OSS has no route or command that invokes a handler. Each creates its own two tenants and fixtures and removes them in `finally`.

| Test | Asserts |
|---|---|
| `TC-PRIVACY-AUTH-001` | `findSubjects` finds a user by mixed-case email in tenant A only; export has no password or lookup hash; erase deletes the user, keeps consent grant and dates with IP and source cleared and a valid integrity hash; a last admin is reported `open_case` and unchanged; dry run writes nothing; a second run reports no new changes |
| `TC-PRIVACY-CUSTOMERS-001` | Phone and email lookup over encrypted rows; a person without deals is deleted with custom values; a person with a sole-person deal is anonymized in place, the deal keeps its amount and loses title text; a deal shared with another person is unchanged and reported `other_party`; tenant B untouched |
| `TC-PRIVACY-CACC-001` | Lookup by email hash including a soft-deleted account; export lists the linked person in `related`; erase leaves a placeholder email, null password hash and name, no sessions, and a live account in tenant B with the same email untouched |
| `privacy-table-coverage.test.ts` (unit) | Every snapshot table claimed, exempt or baselined; baseline only shrinks |

## Final Compliance Report — 2026-11-20

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Handlers touch own tables; cross-module work via owner services |
| root AGENTS.md | Filter by tenant and organization | Compliant | Mandatory predicate, tested per branch |
| root AGENTS.md | `findWithDecryption` for reads | Compliant | All handler reads |
| root AGENTS.md | Run `yarn generate` after auto-discovery changes | Compliant | Phase 1 |
| BACKWARD_COMPATIBILITY.md | Auto-discovery and types additive | Compliant | New optional file and member |
| packages/core/AGENTS.md | Commands own mutations | Compliant | Erase runs owner commands with `skipLog` |

Verdict: ready for implementation.

## Changelog

### 2026-11-20
- Rewritten to minimal GDPR scope.
