# Privacy data-class contract

> **Program:** package C1 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). It also delivers the export half of package C6.
> **Reference only:** `packages/shared/src/lib/privacy/` and the module `privacy.ts` files on `upstream/feat/security-readiness` (PR #5557). Type and field names are kept where the designs agree.
> **Evidence for "today" statements:** [`analysis/2026-11-15-gdpr-readiness-audit-verification.md`](analysis/2026-11-15-gdpr-readiness-audit-verification.md), plus the code references inline. Verified at `main` @ `08dada9624`.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

A module that stores personal data has no way today to say so, and nothing can answer "what do we hold about this person?" across modules; the only subject export lives inside `forms`. **Proposed (future):** a small MIT contract through which each module declares its personal-data classes in a `privacy.ts` file and supplies its own read-only handler, a new `privacy` core module that fans a request out to those handlers, and three first handlers. The result an operator can use: `mercato privacy export` writes one JSON document with everything the `auth`, `customers` and `customer_accounts` modules hold about a person.

**Not in this spec:** erasure, anonymization, retention, events, any API route or UI, the enterprise engine, and data classes beyond the first three.

## 📝 Overview

The contract is the seam the rest of the GDPR program builds on. This spec ships the smallest version that is useful on its own: the read side (Art. 15 access, Art. 20 portability), with nothing destructive.

> **Market reference.** WordPress core registers per-plugin *exporters* through one filter and assembles a single export per request; Frappe lets each app declare its personal-data fields in a hook the framework reads. Adopted: per-module declaration, core-side fan-out, one document per request. Rejected: WordPress's email-only identity (CRM people are also found by phone) and Frappe's field-level declaration (it cannot express linked records or computed sections).

## 📝 Problem Statement

- **No cross-module privacy contract exists.** No data-class registry, subject interface or privacy module anywhere in `packages/*/src` or `apps/mercato/src`.
- **No subject export** for a staff user, CRM person or portal user. The list CSV export and the action-log CSV are not subject exports.
- **`forms` solved it locally.** It builds a versioned, machine-readable JSON document with files referenced by id (`packages/core/src/modules/forms/services/export-service.ts`). The pattern is reusable; the code reads only forms tables.
- **The declarative precedent exists.** `encryption.ts` is discovered by the generator and surfaced as `Module['defaultEncryptionMaps']` (`packages/shared/src/modules/registry.ts:287-288`, collector at `:529-554`). It lists columns, not subjects, so it cannot answer a subject request.
- **CRM people cannot be looked up exactly.** `customers` has no lookup-hash column; `primary_email` and `primary_phone` are encrypted. The token index is not a substitute: it matches "contains all tokens", drops fragments under three characters, loses the tokens of soft-deleted people, and phone numbers are stored as typed, so two spellings of one number share no token set (`packages/shared/src/lib/search/tokenize.ts:85-89`, `tokenLookup.ts:105-107`, `packages/core/src/modules/query_index/lib/indexer.ts:481-500`).
- **Staff users can be tenant-level.** `users.organization_id` is nullable (`packages/core/src/modules/auth/data/entities.ts:34-38`).
- **The CLI dispatcher echoes its arguments.** It prints `Running <module>:<command> <args>` and redacts only key and password flags (`packages/cli/src/mercato.ts:240-254, 2859-2860`), so an email passed as a flag lands in terminal scrollback and CI logs.

## 📝 Decisions

Answered by the issue assignee on 2026-11-16.

| # | Decision |
|---|---|
| Q1 | Read side only: resolve, discover, export. Mutations are added later as optional handler methods. |
| Q2 | The consumer is a CLI. No API route or UI in this spec. |
| Q3 | A new OSS core module `privacy` with no entities. |
| Q4 | Declarative discovery: `privacy.ts` surfaced by the generator, like `encryption.ts`. |
| Q5 | First classes: staff user, CRM person, portal user. |

## 📝 Proposed Solution

1. **Declare.** A module adds `privacy.ts` exporting an array of data-class definitions. The generator puts them on the module registry as `privacyDataClasses`.
2. **Implement.** The owning module registers a handler under a DI key. The handler reads that module's own entities through the existing decryption helpers, plus the record's custom-field values through the shared helper.
3. **Fan out.** The `privacy` module collects definitions from the registry, resolves each handler by its key and calls it. It imports no other module.
4. **Deliver.** A CLI resolves a person from an identifier, shows what is held, and writes the export to a file.

### Design decisions

| Decision | Rationale |
|---|---|
| The contract defines only the three read operations, all optional | Released types are a stable surface. Adding optional methods and optional input fields later is additive. |
| A resolved subject carries a match quality: `exact` or `candidate` | An email or phone match is an equality on the decrypted, normalized value. A name match is never more than a candidate, and the CLI will not export a candidate unless the operator names it. |
| CRM people are resolved by a decrypting scan, not the token index | The index gives false negatives (see Problem Statement), and a missed person is a compliance failure. The scan is slow on a large tenant and always right. A lookup hash replaces it later. |
| A class may declare more than one subject kind | This is how a link is followed from the other side: `customer_accounts` declares that it holds data about a CRM person, so exporting the person finds the portal account. |
| Related subjects are followed | A portal user's link to a CRM person is an exact foreign key. Leaving it unfollowed would omit CRM data from an export that claims to be complete. |
| Handlers include soft-deleted rows | A row that still holds personal data is still held. None of the three modules has a global soft-delete filter, so handlers simply add no `deletedAt` condition. |
| Scope is a tenant plus an optional organization | A data subject addresses the controller, which is the tenant. |
| A failed handler, a truncated section or an unwritten audit entry makes the export incomplete, visibly | An export that silently omits something is worse than no export. |
| Each export leaves durable audit entries with no personal data in clear | The access log is unsuitable: it rotates after 7 days for core resources and 8 hours otherwise, and encrypts its resource id (`accessLogService.ts:33-36`, `audit_logs/encryption.ts`). The action log is not pruned, keeps `resource_kind` and `resource_id` filterable, and has a system-actor convention. |
| No ACL features yet | Module CLI commands are not feature-gated by the dispatcher; features with nothing to guard would be dead declarations. The API spec that follows adds them. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Side-effect registration from `di.ts` (the #5557 branch) | Needs a global mutable store and a booted app before anything can read the list. |
| Derive classes from encryption maps | Maps name columns, not subjects, linked records or lookups. |
| One central export service that queries every module's tables | Breaks module isolation and has to be edited for every new module. |
| Token index with an equality post-check | The post-check removes false positives but cannot recover people the index never returned. |
| Add an email and phone lookup hash to `customers` now | A schema change and backfill. It is the right fast path and belongs to the encryption-coverage spec (program package B1). |
| Reuse the access log for the audit entry | Short retention; encrypted resource id. |

### Known limits of the first slice

Stated so an operator does not read more into an export than it holds. `mercato privacy classes` shows exactly what is covered.

- **Only three modules are covered.** Sales documents, messages, attachments, AI conversations and the rest arrive with the coverage spec (program package C4).
- **Company records are not subjects.** A sole trader stored as a `company` entity with the same email is not found.
- **Platform accounts with no tenant** (`users.tenant_id` null) are not reachable by a tenant-scoped request.
- **Free text is exported as stored.** Comment, activity and email bodies may mention other people; sections that carry free text are flagged for the operator to review before release.

## 📝 Delta

### Capability: privacy-subject-export

#### ADDED Requirement: Data-class declaration
The system SHALL let a module declare its personal-data classes in a `privacy.ts` file and SHALL reject a declaration whose id is duplicated or does not start with the declaring module's id.

##### Scenario: Duplicate class id
- WHEN two enabled modules declare a data class with the same id
- THEN collecting the data classes fails with an error naming both modules

#### ADDED Requirement: Subject resolution
The system SHALL resolve an identifier to subject references within one tenant only, and SHALL mark each reference as exact or candidate.

##### Scenario: Email resolves across modules
- WHEN an operator resolves an email that belongs to a staff user and a CRM person in tenant A, and to a different user in tenant B
- THEN the two tenant A subjects are returned as exact and the tenant B subject is not returned

##### Scenario: Phone formatting
- WHEN an operator resolves a phone number written with different spacing than the stored value
- THEN the CRM person is returned as exact, and a person whose number merely shares digits is not returned

##### Scenario: Name is never exact
- WHEN an operator resolves a name
- THEN every returned subject is marked candidate

#### ADDED Requirement: Subject export
The system SHALL write one JSON document containing a section for every registered data class that holds data about the requested subjects and the subjects linked to them, and SHALL never include credentials, tokens or lookup hashes.

##### Scenario: Complete export
- WHEN an operator exports by an email that resolves exactly
- THEN the file contains the decrypted records from every class holding those subjects, `complete` is true, and the command exits 0

##### Scenario: Linked subject with a different email
- WHEN a portal user is linked to a CRM person whose primary email differs, and the operator exports by the portal email
- THEN the document also contains the CRM person's records

##### Scenario: A handler fails
- WHEN one handler throws during an export
- THEN the file is still written with `complete` false and that class marked failed, and the command exits 2

##### Scenario: Candidate is not exported implicitly
- WHEN an operator runs an export by name
- THEN nothing is exported and the command lists the candidates with the `--subject` values to use

##### Scenario: Nothing found
- WHEN the identifier resolves to no subject
- THEN no file is written and the command exits 3

#### ADDED Requirement: Export audit
The system SHALL record each export, and each request that found nothing, in the audit log without storing the identifier or any exported value in clear.

##### Scenario: Audit entries
- WHEN an export of two subjects completes and the audit module is enabled
- THEN two entries exist, one per subject, attributed to a system actor and carrying the operator's reference

#### ADDED Requirement: Identifier confidentiality on the command line
The system SHALL NOT echo the identifier value in the dispatcher's command banner.

##### Scenario: Banner redaction
- WHEN an operator runs `export --email <value>`
- THEN the printed command line shows the flag with its value redacted

## 📝 Architecture

```mermaid
flowchart LR
  subgraph owners["Owning modules (existing)"]
    A["auth<br/>privacy.ts + handler"]
    C["customers<br/>privacy.ts + handler"]
    P["customer_accounts<br/>privacy.ts + handler"]
  end
  G["generator (existing)<br/>new: privacyDataClasses"] --> R["module registry (existing)"]
  A & C & P -. declared in privacy.ts .-> G
  subgraph privacy["privacy module (new)"]
    S["subject service"]
    CLI["cli.ts"]
  end
  R --> CLI --> S
  S -- "resolve handler by DI key" --> A & C & P
  S -. "soft-optional" .-> AL["audit_logs (existing)"]
  CLI --> F["export file"]
```

Takeaway: the `privacy` module knows definitions and DI keys only; every query stays inside the module that owns the table.

### Components

- **Types, schema and collector** — `packages/shared/src/modules/privacy.ts` holds the zod schema for a definition and the types inferred from it, plus the handler types. `getPrivacyDataClasses(modules)` in `packages/shared/src/modules/registry.ts` validates with that schema and returns the definitions stamped with their module id, mirroring `getDefaultEncryptionMaps`.
- **Generator** — `privacy.ts` becomes a convention file in the three registry emitters of `packages/cli/src/lib/generators/module-registry.ts`, which write five files: `modules.generated.ts` and `modules.runtime.generated.ts` (main), `modules.app.generated.ts` and `modules.bootstrap.generated.ts` (app), `modules.cli.generated.ts` (CLI). It is also added to `STRUCTURAL_CONVENTION_FILES` for the dev watcher. No module-fact kind or override domain is added; `runtime.ts` is the precedent for a convention without them.
- **Handlers** — one per class, in the owning module under `lib/privacy/`, registered in that module's `di.ts`. The container is CLASSIC mode, so a factory taking an object parameter ends in `.proxy()`.
- **Subject service** — `packages/core/src/modules/privacy/lib/subjectService.ts`, a factory taking the collected definitions and a resolver. It returns data and never prints.
- **CLI** — `packages/core/src/modules/privacy/cli.ts`. It reads the registry through `getCliModules()`, which may only be called from a file named `cli.ts`. Its arguments are validated by zod schemas in `privacy/data/validators.ts`.
- **Dispatcher** — `packages/cli/src/mercato.ts` gains `--email`, `--phone` and `--name` in `SENSITIVE_MODULE_CLI_OPTIONS_BY_COMMAND` for `privacy:resolve` and `privacy:export`.

### Coupling

| Touchpoint | Mechanism | Module absent |
|---|---|---|
| `privacy` → owning module's handler | DI key from the definition; `hasRegistration` check | A declared class with no registered handler is reported as failed |
| `privacy` → `audit_logs` | Soft-optional resolve of `actionLogService` in try/catch | Export proceeds; the CLI prints that no audit entry was written |
| Owning module → `privacy` | None. A module declares and registers; it never imports `privacy` | Definitions are inert when `privacy` is disabled |
| Handler → custom-field values | Shared helper `loadCustomFieldSnapshot` from `@open-mercato/shared/lib/commands/customFieldSnapshots` | — |

### Subject kinds and the subject set

| Class | Declares subject kinds | Why |
|---|---|---|
| `auth.users` | `auth:user` | — |
| `customers.people` | `customers:person` | — |
| `customer_accounts.users` | `customer_accounts:user`, `customer_accounts:invitation`, `customers:person` | An invitation holds an email and name for someone who may never have signed up. Declaring `customers:person` lets a person's export find the portal accounts linked to it |

The service builds the subject set in two steps. It first takes the resolved or named subjects. It then adds every subject a handler reports under `relatedSubjects`, to a depth of two, skipping any already seen. Each subject in the set is passed to every class that declares its kind.

**In-process callers.** The same operation is `privacySubjectService.exportSubjects`, registered under a DI key by the `privacy` module. It takes the scope, the subjects, `followRelated` (default true), an optional list of data-class ids that narrows the fan-out, an actor and a reference. The command is one caller and passes the defaults; a caller that must hand the result to the subject directly, such as the portal download in [`2026-11-16-portal-privacy-self-service.md`](2026-11-16-portal-privacy-self-service.md), turns following off and names its classes.

### Resolution rules

| Class | Identifier | Method | Match |
|---|---|---|---|
| `auth.users` | email | Lookup-hash candidates **or** plaintext email, the same predicate login uses (`authService.ts:30-57`) but without login's `deletedAt` filter | exact |
| `customer_accounts.users` | email | `email_hash` within the tenant, for users and for invitations | exact |
| `customers.people` | email | Scan; compare trimmed, lower-cased values | exact |
| `customers.people` | phone | Scan; compare digits only, as `api/people/check-phone/route.ts:26` normalizes | exact |
| `customers.people` | name | Scan; case-insensitive substring on the decrypted display name | candidate |

The scan reads `customer_entities` of kind `person` in the tenant in keyset batches of 500 by id, decrypting and comparing, and applies `--limit` after the comparison. The document records the method each class used.

## 📝 Data Models

No entity, table, column or migration is added. The data-model graph is skipped for that reason.

**What each first class exports.** Soft-deleted rows are included with their `deletedAt`.

| Class | Sections | Never exported |
|---|---|---|
| `auth.users` | user, roles, per-user ACL, consents, sessions (timestamps only), password resets (timestamps only), sidebar preferences, custom fields | `password_hash`, `email_hash`, session and reset tokens, `integrity_hash` |
| `customers.people` | person, profile, addresses, comments, activities, interactions, interaction mentions, tags, labels, deal links, company links and roles, entity roles, todo links, email-conversation shares, custom fields of the entity and of the profile | — (no credentials on these tables) |
| `customer_accounts.users` | user (including lockout state), sessions with IP and user agent, roles, per-user ACL, verifications and resets (timestamps only), invitations addressed to the subject's email (not those the subject sent, which carry another person's email and name) | `password_hash`, `email_hash`, `token_hash`, verification, reset and invitation tokens |

- **Linked records owned by another module** (a deal, a company, a role) appear as an id plus the link's own fields, never as the other record's content.
- **Interaction mentions** are interactions not owned by the person in which the person appears: `linked_entities` containing the person's id, or `participants` containing the person's primary email (`customers/data/entities.ts`, `participants` and `linked_entities` columns). They are matched by JSON containment within the tenant and exported as id, type, date and the matching entry only. The email comparison there is exact, so a differently cased address in a participant list is not matched.
- **Free-text sections** (comments, activities, interactions) are flagged `freeText`.
- **Custom fields** are loaded per record. A person has two sets: one keyed by the entity id and one by the profile id (`customers/lib/customFieldRouting.ts:4-5`).
- None of the encrypted columns in these three modules is a JSON column, so no decrypted-string parsing is needed here.

## 📝 API Contracts

### Types — `@open-mercato/shared/modules/privacy`

```ts
export const privacyDataClassDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/),   // '<moduleId>.<name>'
  title: z.string().min(1),
  description: z.string().optional(),
  handlerService: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/),     // DI key
  subjectKinds: z.array(z.string().regex(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/)).min(1),
  subjectIdentifierKinds: z.array(z.enum(['email', 'phone', 'name'])).optional(),
  subjectActions: z.array(z.enum(['discover', 'export'])).min(1),
})
export type PrivacyDataClassDefinition = z.infer<typeof privacyDataClassDefinitionSchema>

export type PrivacyScope = { tenantId: string; organizationId?: string }
export type PrivacySubjectReference = { kind: string; id: string }
export type PrivacySubjectIdentifier = { kind: 'email' | 'phone' | 'name'; value: string }

export type PrivacyResolvedSubject = PrivacySubjectReference & {
  match: 'exact' | 'candidate'
  label?: string
}

export type PrivacyExportSection = {
  key: string
  title: string
  freeText?: boolean
  truncated?: boolean
  records: Array<Record<string, unknown>>
}

export type PrivacyDataClassHandler = {
  resolveSubjects?: (input: {
    scope: PrivacyScope
    identifier: PrivacySubjectIdentifier
    limit: number
  }) => Promise<{ subjects: PrivacyResolvedSubject[]; truncated: boolean; method: 'hash' | 'scan' }>
  discoverSubject?: (input: { scope: PrivacyScope; subject: PrivacySubjectReference }) =>
    Promise<{ found: boolean; recordCount: number }>
  exportSubject?: (input: {
    scope: PrivacyScope
    subject: PrivacySubjectReference
    maxRecordsPerSection: number
  }) => Promise<{ recordCount: number; sections: PrivacyExportSection[]; relatedSubjects?: PrivacySubjectReference[] }>
}
```

- **Scope.** `organizationId` absent means every organization in the tenant. Present, it means that organization plus rows that have no organization. There is no `null`: elsewhere in the codebase a null organization means "global rows only", and the contract avoids that ambiguity.
- **Actions and methods.** A class is called for an action only if it lists the action and its handler has the method. A listed action with no method is reported as failed with `ACTION_NOT_IMPLEMENTED`.
- **Growth.** Later specs add optional methods (erase, anonymize, retention), new members to the `subjectActions` enum, and optional fields on the input objects (an actor, a dry-run flag). All are additive.
- **Export shape.** A module's `privacy.ts` has one default export, an object: `{ dataClasses: [...] }`. The generated runtime registry reads only `.default`, so anything the registry must see has to be a member of that object. Later specs add optional members beside `dataClasses` — retention sets, per-table declarations — without touching the generators again. The array is also exported by name as `privacyDataClasses` for tests.
- **Titles** and section titles are plain English, as all CLI output is; the later UI spec adds translation keys additively.

**Handler obligations**

- Keep `tenantId` in every `where`. A tenant mismatch returns ciphertext with only a warning (`packages/shared/src/lib/encryption/decryptScope.ts:45-49`).
- Read through `findWithDecryption` / `findOneWithDecryption`; add no `deletedAt` condition.
- Build each record field by field from an explicit list; never spread an entity.
- Return plain JSON values: dates as ISO strings, files by id.
- Stop a section at `maxRecordsPerSection` and set `truncated`.
- Return a label only for a subject inside the tenant.

### CLI — `mercato privacy <command>`

| Command | Flags | Output |
|---|---|---|
| `classes` | — | Registered classes: id, module, subject kinds, identifiers, actions. Reads no database |
| `resolve` | `--tenant` (required), `--org`, one of `--email` / `--phone` / `--name`, `--limit` (default 50) | Subject references with match quality and label |
| `discover` | `--tenant`, `--org`, `--subject <kind:id>` (repeatable) | Record count per class |
| `export` | `--tenant`, `--org`, one of `--email` / `--phone` / `--subject` (repeatable), `--out <file>` (required), `--reference <text>` (required), `--force`, `--max-records` (default 10000 per section) | Writes the document; prints a summary |

Flag aliases follow the house convention (`--tenantId`, `--organization`, `--output`). `--reference` is a ticket id or operator reference of at most 120 characters; it is the only human attribution the audit entry has. `--tenant` is checked for UUID format only; an unknown tenant simply resolves nothing.

| Exit code | Meaning |
|---|---|
| 0 | Done; for `export`, the document is complete and audited |
| 1 | Usage error, or the output file exists without `--force` |
| 2 | Needs attention: export written but incomplete, resolution truncated, only candidates found, or the audit entry could not be written |
| 3 | Nothing found |

**File handling.** The document is written to a temporary file in the target directory, created with mode `0600`, then renamed. Without `--force` the target is created exclusively, so an existing file is never replaced. The temporary file is removed on failure. The mode has no effect on Windows. The document is never printed to the terminal.

### Export document (version 1)

```json
{
  "documentVersion": "1",
  "generatedAt": "2026-11-16T10:00:00.000Z",
  "tenantId": "…",
  "organizationId": null,
  "reference": "DSR-142",
  "resolution": {
    "identifierKind": "email",
    "perClass": [{ "dataClassId": "customers.people", "method": "scan", "truncated": false }]
  },
  "coveredDataClasses": ["auth.users", "customer_accounts.users", "customers.people"],
  "complete": true,
  "subjects": [
    {
      "subject": { "kind": "auth:user", "id": "…" },
      "source": "resolved",
      "dataClasses": [
        { "id": "auth.users", "moduleId": "auth", "status": "ok", "recordCount": 7, "sections": [] }
      ]
    }
  ]
}
```

- `resolution` is null when subjects were named with `--subject`.
- `source` is `resolved`, `named` or `related`.
- `status` is `ok`, `empty` or `failed`; a failed class carries an `errorCode` and no message text.
- `complete` is true only when every class called for every subject in the set returned `ok` or `empty`, no section was truncated, and no resolution was truncated. It says nothing about modules that declare no data class; `coveredDataClasses` lists what was asked.

### Audit entries

Written through `actionLogService.log` when the audit module is enabled.

| Case | `resourceKind` | `resourceId` | Context |
|---|---|---|---|
| Per exported subject | `privacy.subject_export` | `<kind>:<id>` | class ids, record counts, completeness, reference |
| Nothing found | `privacy.subject_export` | `none` | identifier kind, the identifier's lookup hash, reference |

Both use `commandId` `privacy.subject.export`. The actor is `system:privacy-cli` for the command and the caller's own actor for an in-process call. The entry carries no undo token, so it never appears in undo history. `resource_kind` and `resource_id` are stored in clear and are filterable; the context is encrypted at rest by the audit module's own map. No identifier value, label or exported field is stored.

## 📝 Addendum: aliases and people known only by an address

Added on 2026-11-16, after the coverage specs' reviews. Both are additive to a contract that is not yet released, and both ship with the first coverage spec that needs them, not with Phase 1.

### Aliases

Some modules know a person by something other than the subject's id: an order names a contact by a profile id; a message names an outside party by an address. They must not read the owner's tables to translate.

- The class that owns a subject kind may implement `resolveAliases`. It returns named lists of strings for a subject.
- The run calls it once per subject, before any other class, and passes the result to every handler as `aliases` on its input.
- Names in use: `profile_ids`; `email_hashes`, every form `lookupHashCandidates` gives for each of the person's addresses, with no context string; `phone_hashes`, the same over a number reduced to its digits by a shared helper, which the modules that store numbers also use when they write their own hash.
- Aliases are computed from the owner's data at the time of the run. Once the owner has anonymized a person, there is nothing to compute them from: a class added in a later release cannot find address-keyed records of someone already anonymized. That limit is stated in each coverage spec.
- Two people who share an address share its hash. A class that finds records by an address alias reports, in the dry run, how many it found that way, so that an operator can see it before applying.

### A subject that is only an identifier

A payer through a pay link, a guest basket, a claimant by email, a correspondent: each is a person with no record of their own, known by an address or a number in several modules.

- Subject kind `privacy:identifier`, owned by the `privacy` module. It has no table.
- `resolve`, `export` and `erase` given `--email` or `--phone` always offer one such subject, beside whatever records match, as an exact match. Its id is generated for the run. Its aliases are the hashes of the identifier typed.
- A class declares `privacy:identifier` when it holds records it can find by those hashes alone. It is given the aliases, never the address.
- The audit entries and the completion event carry the generated id. The identifier's lookup hash goes in the entry's encrypted context, as the contract already does for an identifier that matched nothing. No hash appears in a subject id, an export document or an event.
- A CRM person or portal user reaches the same records through their own `email_hashes` alias, when a class also declares their kind.
- `--name` offers one too, carrying `name_hashes`. Names are not unique, so every match made through a name is a candidate and is never acted on without the operator naming it.

### What a module must do for a hash it relies on

The encrypt step writes a lookup hash only when it encrypts, and skips a value that is already ciphertext. A module that needs to find records by a hash therefore:

- writes the hash itself, in its own write path, whether or not encryption is on;
- ships a one-off command that decrypts existing rows and fills the hash;
- until that command has run for a tenant, falls back to a decrypting scan of the rows whose hash is empty, bounded as the contract's CRM scan is.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| Nothing resolves | Exit 3; no file; one "nothing found" audit entry |
| Only candidates resolve | Exit 2; candidates listed with the `--subject` value for each; no file |
| Resolution hits the limit | Exit 2 with a hint to raise `--limit`; no export |
| Handler throws | That class is `failed`; other classes still export; `complete` false; exit 2 |
| Class declared but handler not registered | Same, with `errorCode` `HANDLER_NOT_REGISTERED` |
| Section exceeds `--max-records` | Section `truncated`; `complete` false; exit 2 |
| Audit write fails | File is kept; summary says so; exit 2 |
| `audit_logs` disabled | Export completes with exit 0; summary states that no audit entry was written |
| Encryption disabled | Handlers work unchanged; the decryption helpers pass plaintext through |
| Tenant-level staff user | Matched whether or not `--org` is given |
| Same email on a staff user, a CRM person and a portal user | All three subjects are exported in one document |
| Portal user linked to a person with another email | The person is added as a related subject and exported |
| Invitation with no account | Resolved and exported as an invitation subject |
| Two people share one email | Both are exported; the operator verifies identity before release |
| Interrupted mid-write | No partial document appears at the target path |

## 📝 Migration & Backward Compatibility

All changes are additive. Classification from `BACKWARD_COMPATIBILITY.md`:

| Surface | Section | Rule |
|---|---|---|
| `privacy.ts` convention file | §1 | "New convention files may be added." Add a row to the table, as `extension-points.ts` has. Frozen once released |
| `Module.privacyDataClasses` | §2 | "Optional fields may be added freely" |
| `@open-mercato/shared/modules/privacy` | §4 | New path; stable once documented. `packages/shared` uses wildcard exports, so no `package.json` edit |
| DI keys `authUserPrivacyHandler`, `customerPeoplePrivacyHandler`, `customerAccountUserPrivacyHandler` | §9 | New keys; stable once released |
| `mercato privacy …` | §13 | New commands may be added |
| Generated registries | §14 | A new optional field; export names unchanged |
| Export document | — | Carries `documentVersion`; a breaking shape change increments it |

No database migration.

**`UPGRADE_NOTES.md`.** One operator note: an existing app gets the commands only after adding `privacy` to its `src/modules.ts` and running `yarn generate`. Nothing breaks if it does not.

**Convergence with PR #5557.** The branch exports the same type names from `@open-mercato/shared/lib/privacy` and registers by side effect. If it lands first, this spec is rebased: the declarative `privacy.ts` stays as the source and a thin adapter feeds the branch's registry, or the branch files are converted. That decision is taken then.

**Template and harness.** `apps/mercato/src/modules.ts` enables `privacy`; `scripts/template-sync.ts` derives the create-app template's module list from it. Because the template then ships the module, `packages/create-app/src/lib/module-facts-build.test.ts` needs a harness case or an entry in its exemption list, and the standalone harness is refreshed in the same change.

## 📋 Phasing

| Phase | Outcome | Shippable alone |
|---|---|---|
| 1 | Contract types, collector, generator support, docs | Yes — no behaviour change |
| 2 | `privacy` module with `classes` | Yes — lists nothing until a module declares |
| 3 | Three handlers | Yes — `classes` lists them |
| 4 | `resolve`, `discover`, `export`, audit entries | Yes — the feature |
| 5 | Documentation and harness | Yes |

## 📋 Implementation Plan

### Phase 1 — Contract and discovery
1. Add `packages/shared/src/modules/privacy.ts` with the schema and types. Add `privacyDataClasses?` to `Module` and `getPrivacyDataClasses(modules)` to `registry.ts`. Unit tests in `packages/shared/src/modules/__tests__/registry.test.ts`: valid, bad id, wrong module prefix, duplicate across modules.
2. Add the convention file to the three emitters and to `STRUCTURAL_CONVENTION_FILES`. Update `registry-variant-parity.test.ts` (shared-property list and fixture), `structural-contracts.test.ts` and `generate-watch-structure.test.ts`. Run `yarn generate` and confirm the five generated registries are otherwise unchanged.
3. Document the convention: `packages/cli/AGENTS.md`, `.ai/docs/module-development.md`, the `BACKWARD_COMPATIBILITY.md` §1 table, and the scaffold's `discovery-surface-catalog.md` with `agent-surface-coverage.test.ts`.

### Phase 2 — The `privacy` module
1. Create `packages/core/src/modules/privacy/` with `index.ts` (`license: 'MIT'`) and `cli.ts` implementing `classes`. Enable it in `apps/mercato/src/modules.ts`; run `yarn template:sync:fix` and `yarn generate`.
2. Unit test `classes` with a mocked registry. Add the harness case or exemption required by `module-facts-build.test.ts`. Add the `UPGRADE_NOTES.md` note.

### Phase 3 — Handlers
One step per module. Each adds `privacy.ts`, the handler under `lib/privacy/`, the `di.ts` registration, unit tests for the scope filter and the field lists, and an entry in `packages/core/src/__tests__/di-seams-classic-resolution.test.ts`.
1. `auth` — `auth.users`. The unit tests cover a tenant-level user, which cannot be created through the API (`auth/commands/users.ts` requires an organization).
2. `customer_accounts` — `customer_accounts.users`, including invitation subjects and lookup by linked person.
3. `customers` — `customers.people`, including the scan, both normalizations, and interaction mentions.

### Phase 4 — Subject service and commands
1. `subjectService.ts`: collect, resolve across classes, build the subject set with related subjects, discover, export, with per-class failure isolation. Unit tests with fake handlers: a throwing one, a missing registration, a listed action with no method, a related-subject cycle.
2. Dispatcher redaction for the three identifier flags, with a unit test on the echoed line.
3. `resolve` and `discover` commands with their zod argument schemas. Unit tests for parsing and exit codes.
4. `export` command: document assembly, exclusive and atomic write, `--force`, `--max-records`. Unit tests.
5. Audit entries through soft-optional `actionLogService`. Unit tests for present, absent and failing.
6. Integration tests (below).

### Phase 5 — Documentation and harness
1. Add `apps/docs/docs/framework/privacy/data-classes.mdx` (how a module declares a class and writes a handler) and an operator page for the commands, including the known limits.
2. Refresh the standalone harness per `.ai/skills/om-refresh-standalone-harness/SKILL.md`.
3. Update the program spec's changelog and package table.
4. Archive this Delta into `.ai/specs/capabilities/privacy-subject-export.md` if that directory has been adopted by then; it does not exist today and adding it is a taxonomy change.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Create |
| `packages/shared/src/modules/registry.ts` | Modify — field and collector |
| `packages/cli/src/lib/generators/module-registry.ts` | Modify — three emit sites |
| `packages/cli/src/lib/generate-watch-structure.ts` | Modify |
| `packages/cli/src/mercato.ts` | Modify — identifier-flag redaction |
| `packages/core/src/modules/privacy/{index.ts,cli.ts,data/validators.ts,lib/subjectService.ts,lib/exportDocument.ts}` | Create |
| `packages/core/src/modules/{auth,customers,customer_accounts}/privacy.ts` | Create |
| `packages/core/src/modules/{auth,customers,customer_accounts}/lib/privacy/*.ts` | Create |
| `packages/core/src/modules/{auth,customers,customer_accounts}/di.ts` | Modify |
| `apps/mercato/src/modules.ts`, template `modules.ts` (via sync) | Modify |
| `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, `packages/cli/AGENTS.md`, `.ai/docs/module-development.md`, `apps/docs/docs/framework/privacy/*` | Modify / create |

## 🧪 Integration Coverage

There is no API or UI path; the surface is the CLI. Specs live in `packages/core/src/modules/privacy/__integration__/` and run the built CLI against the ephemeral database, following `packages/core/src/modules/auth/__integration__/TC-AUTH-033.spec.ts` and `packages/core/src/modules/customers/__integration__/TC-CUSTOMERS-SEED-001.spec.ts`.

**Mechanics the tests must respect**

- The CLI process runs with the same tenant-encryption settings as the app under test. The precedent sets them on the CLI only, which would not prove decryption.
- Commands run through `spawnSync` so that non-zero exit codes are read, not thrown.
- Fixtures are created through the API and removed in teardown, as are written files. The second tenant in TC-PRIVACY-004 is created through the directory API as superadmin.

| Test | Covers |
|---|---|
| TC-PRIVACY-001 | `classes` lists the three classes with their modules |
| TC-PRIVACY-002 | `export --email` for an email shared by a staff user, a CRM person (with address, comment, activity and a custom field) and a portal user: one document, three subjects, decrypted values present, `complete` true, exit 0 |
| TC-PRIVACY-003 | The document contains no password hash, token, lookup hash or ciphertext marker |
| TC-PRIVACY-004 | Two real tenants each hold a user with the same email. Each tenant's export contains only that tenant's ids |
| TC-PRIVACY-005 | `resolve --name` returns candidates only; `export` by name is refused with exit 2; `export --subject` then succeeds |
| TC-PRIVACY-006 | `resolve --phone` matches a CRM person stored as `+48 600 100 200` when asked for `+48600100200`, and does not match a different number that shares a digit run |
| TC-PRIVACY-007 | A soft-deleted portal user and a soft-deleted CRM person are both still exported |
| TC-PRIVACY-008 | A portal user linked to a CRM person with a different primary email: exporting by the portal email includes the person; exporting `--subject customers:person:<id>` includes the portal account |
| TC-PRIVACY-009 | An invitation with no account resolves and is exported |
| TC-PRIVACY-010 | One audit entry per exported subject, carrying the reference and not the email; an unknown email exits 3 and leaves one "nothing found" entry |
| TC-PRIVACY-011 | Existing output file: exit 1 without `--force`; the written file has mode `0600` (skipped on Windows) |
| TC-PRIVACY-012 | The command banner printed by the dispatcher does not contain the email |

Unit-tested instead, because the real app cannot provoke them: handler failure isolation, a missing registration, a related-subject cycle, section truncation, an audit write failure, and the tenant-level staff user.

## 📝 Risks & Impact Review

#### The export contains the wrong person
- **Scenario**: A fuzzy match is treated as the subject and another person's data is handed to the requester.
- **Severity**: Critical
- **Affected area**: `customers.people` resolution
- **Mitigation**: Email and phone are equality checks on decrypted, normalized values. Name matches are candidates and are never exported without an explicit `--subject`.
- **Residual risk**: Two real people sharing one email are both exported. That is correct for the data held; the operator verifies identity before release.

#### An incomplete export is taken as complete
- **Scenario**: A handler fails, a section is truncated, or the operator assumes the three covered modules are everything.
- **Severity**: High
- **Affected area**: every export
- **Mitigation**: `complete`, per-class status, exit code 2, `coveredDataClasses`, the Known limits section in operator docs.
- **Residual risk**: Modules without a data class are not covered. The program's coverage test (package C5) closes that gap.

#### Cross-tenant leakage
- **Scenario**: A handler omits the tenant filter and returns another tenant's subject or label.
- **Severity**: Critical
- **Affected area**: every handler
- **Mitigation**: `tenantId` is a required scope field and a handler obligation; TC-PRIVACY-004 uses two real tenants.
- **Residual risk**: A future handler can still get it wrong; a two-tenant test per class is the control.

#### Ciphertext or secrets in the document
- **Scenario**: A scope mismatch returns ciphertext, or a handler includes `passwordHash`.
- **Severity**: High
- **Affected area**: export content
- **Mitigation**: Sections are built field by field from an explicit list; TC-PRIVACY-003 asserts absence.
- **Residual risk**: A column added later is not exported until someone lists it, which errs towards omission.

#### Third-party data in free text
- **Scenario**: A comment or email body about the subject also names someone else.
- **Severity**: Medium
- **Affected area**: comments, activities, interactions
- **Mitigation**: Those sections are flagged `freeText`; the operator page tells the operator to review them.
- **Residual risk**: No automatic redaction. Review is a controller duty.

#### The identifier or the export file leaks
- **Scenario**: The email appears in CI logs, or the file is left on a shared disk.
- **Severity**: Medium
- **Affected area**: operator workflow
- **Mitigation**: Dispatcher redaction; file mode `0600`; the document is never printed.
- **Residual risk**: Arguments remain visible to other local users through the process list while the command runs. Handling after export is outside the product.

#### The scan is slow on a large tenant
- **Scenario**: Resolving a CRM person decrypts every person row in the tenant.
- **Severity**: Medium
- **Affected area**: CLI runtime only; no request path
- **Mitigation**: Keyset batches of 500, read-only. `--subject` skips resolution entirely when the id is known.
- **Residual risk**: Minutes of runtime at millions of people until a lookup hash exists (program package B1).

#### The contract diverges from PR #5557
- **Scenario**: Both designs land.
- **Severity**: Medium
- **Affected area**: shared types, module `privacy.ts` files
- **Mitigation**: Same type and field names; the convergence path is stated under Migration.
- **Residual risk**: Conversion work for whichever lands second.

## Final Compliance Report — 2026-11-16

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `.ai/specs/AGENTS.md` — in full
- `BACKWARD_COMPATIBILITY.md` — protocol, §1, §2, §4, §9, §13, §14
- `packages/core/AGENTS.md` — Encryption section; module conventions via the mechanics research
- `packages/queue/AGENTS.md`, `packages/create-app/AGENTS.md` — MUST rules
- `.ai/qa/AGENTS.md` — test placement and self-contained fixtures
- Not reviewed: `packages/ui/AGENTS.md` (no UI), `packages/search/AGENTS.md` (the token index is no longer used)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Handlers query only their own module's entities; custom-field values come through the shared helper |
| root AGENTS.md | Never expose cross-tenant data | Compliant | Required tenant scope; two-tenant test |
| root AGENTS.md | Validate inputs with zod; derive types | Compliant | Definition schema and CLI argument schemas |
| root AGENTS.md | Use `findWithDecryption` | Compliant | Handler obligation |
| root AGENTS.md | Use DI; avoid `new` | Compliant | Handlers and audit service resolved by key |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | CLI output is plain English by repo convention; no UI strings added |
| root AGENTS.md | No code under `apps/mercato/src/` except registries | Compliant | Only `modules.ts` enablement |
| root AGENTS.md | Optimistic locking on new editable entities | N/A | No entity |
| packages/core/AGENTS.md → Encryption | Declare GDPR fields in encryption maps | N/A | No new column |
| packages/core/AGENTS.md | Cross-module coupling by sanctioned mechanisms | Compliant | DI key and soft-optional resolve; no hard `requires` |
| `BACKWARD_COMPATIBILITY.md` | Contract changes follow the protocol | Compliant | All additive; section present; one operator note |
| `.ai/qa/AGENTS.md` | Integration tests self-contained | Compliant | Fixtures created and removed per test |
| packages/create-app/AGENTS.md | Template sync | Compliant | Named in Phase 2 |
| root AGENTS.md | Module ids plural snake_case | Deviation, stated | `privacy` is a mass noun, like the existing exceptions `auth` and `example` |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No entities; export sections match handler types |
| API contracts match UI/UX section | N/A | No UI |
| Risks cover all write operations | Pass | The only writes are the export file and the audit entries |
| Commands defined for all mutations | N/A | No domain mutation |
| Delta scenarios map to tests | Pass | Each scenario has a TC or a named unit test |
| Every step is testable | Pass | Each step names its tests |

### Non-Compliant Items
None. One stated deviation: the module id `privacy`.

### Verdict
**Approved — ready for implementation**, under the program's unconfirmed edition assumption (DEC-2): this ships the contract and an export CLI in OSS.

## Changelog

### 2026-11-16
- Skeleton with open questions.
- Questions answered by the issue assignee; full specification written.
- Revised after independent review: CRM people resolved by scan instead of the token index; related subjects followed and classes allowed several subject kinds; invitation subjects added; scope semantics defined; handler methods made optional; resolution method recorded per class; section truncation, free-text flag and coverage list added; audit entries made per subject with a required reference and a "nothing found" entry; dispatcher redaction added; exit code 3; integration tests corrected; known limits stated.

### Review — 2026-11-16
- **Reviewer**: Agent (fresh context, spec path only), then author revision
- **Security**: Passed after revision — identifier echo, cross-tenant test and audit design corrected
- **Performance**: Scan cost accepted and stated; no request path affected
- **Cache**: N/A — no cached read
- **Commands**: N/A — no domain mutation
- **Risks**: Third-party free text and scan runtime added
- **Verdict**: Approved after revision

### 2026-11-16 — amendment
- Added the in-process entry point `exportSubjects` with `followRelated`, a data-class list, actor and reference, and limited the account class's invitations to those addressed to the subject. Both are needed by the portal self-service spec and were found by its review.
- Changed the default export of `privacy.ts` from the array of classes to an object with a `dataClasses` member. The generated registry reads only `.default`, and three later specs need to declare more than classes in the same file; a named export would never have been loaded.
- Added the addendum on aliases, on the `privacy:identifier` subject for people known only by an address or number, and on what a module must do for a hash it relies on. All three were found missing by the reviews of the commerce and communication coverage specs, which had each invented part of them.
