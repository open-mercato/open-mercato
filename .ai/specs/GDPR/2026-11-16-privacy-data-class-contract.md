# Privacy data-class contract

> **Program:** package C1 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). C1 delivers the export CLI; C6 is the erase command delivered by C4.
> **Reference only:** `packages/shared/src/lib/privacy/` and the module `privacy.ts` files on `upstream/feat/security-readiness` (PR #5557). Type and field names are kept where the designs agree.
> **Evidence for "today" statements:** [program problem statement](2026-11-15-gdpr-ready-deployments-program.md#-problem-statement), plus the code references inline. Verified at `main` @ `08dada9624`.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

A module that stores personal data has no way today to say so, and nothing can answer "what do we hold about this person?" across modules; the only subject export lives inside `forms`. **Proposed (future):** a small MIT contract through which each module declares its personal-data classes in a `privacy.ts` file and supplies its own read-only handler, the G4-created `privacy` core module extended to fan a request out to those handlers, and three first handlers. The result an operator can use: `mercato privacy export` writes one JSON document with everything the `auth`, `customers` and `customer_accounts` modules hold about a person.

**Not in this spec:** subject erasure, anonymization, general retention orchestration, events, any API route or UI, the enterprise engine, and classes beyond the first three. The tenant-settings seam and export/settings evidence expiry below close this contract's configuration and accountability gaps. C4 owns `privacy.subject.erased` (R3-14); C1 adds no event.

## 📝 Overview

The contract is the seam the rest of the GDPR program builds on. The subject capability is read-only: resolve, discover and export. R3-3 deliberately places the shared tenant-settings contract here for all retention consumers. The narrow export/settings evidence expiry deletes only these capabilities' accountability records after their finite age; it does not erase a subject. These additions are separate phases with explicit dependencies.

> **Market reference.** WordPress core registers per-plugin *exporters* through one filter and assembles a single export per request; Frappe lets each app declare its personal-data fields in a hook the framework reads. Adopted: per-module declaration, core-side fan-out, one document per request. Rejected: WordPress's email-only identity (CRM people are also found by phone) and Frappe's field-level declaration (it cannot express linked records or computed sections).

## 📝 Problem Statement

- **No cross-module privacy contract exists.** No data-class registry, subject interface or privacy module anywhere in `packages/*/src` or `apps/mercato/src`.
- **No subject export** for a staff user, CRM person or portal user. The list CSV export and the action-log CSV are not subject exports.
- **`forms` solved it locally.** It builds a versioned, machine-readable JSON document with files referenced by id (`packages/core/src/modules/forms/services/export-service.ts`). The pattern is reusable; the code reads only forms tables.
- **The declarative precedent exists.** `encryption.ts` is discovered by the generator and surfaced as `Module['defaultEncryptionMaps']` (`packages/shared/src/modules/registry.ts:287-288`, collector at `:529-554`). It lists columns, not subjects, so it cannot answer a subject request.
- **CRM people cannot be looked up exactly.** `customers` has no lookup-hash column; `primary_email` and `primary_phone` are encrypted. The token index is not a substitute: it matches "contains all tokens", drops fragments under three characters, loses the tokens of soft-deleted people, and phone numbers are stored as typed, so two spellings of one number share no token set (`packages/shared/src/lib/search/tokenize.ts:85-89`, `tokenLookup.ts:105-107`, `packages/core/src/modules/query_index/lib/indexer.ts:481-500`).
- **Staff users can be tenant-level.** `users.organization_id` is nullable (`packages/core/src/modules/auth/data/entities.ts:34-38`).
- **The CLI dispatcher echoes its arguments.** It prints `Running <module>:<command> <args>` and redacts only key and password flags (`packages/cli/src/mercato.ts:238-254, 2873`), so an email passed as a flag lands in terminal scrollback and CI logs.

## 📝 Decisions

Answered by the issue assignee on 2026-11-16.

| # | Decision |
|---|---|
| Q1 | Read side only: resolve, discover, export. Mutations are added later as optional handler methods. |
| Q2 | The consumer is a CLI. No API route or UI in this spec. |
| Q3 | Extend G4's OSS `privacy` module (DEC-10); C1 adds no second shell and no entities. |
| Q4 | Declarative discovery: `privacy.ts` surfaced by the generator, like `encryption.ts`. |
| Q5 | First classes: staff user, CRM person, portal user. |

## 📝 Proposed Solution

1. **Declare.** A module adds `privacy.ts` with a default object `{ dataClasses: [...] }`. The generator carries the whole object as `Module.privacy`; `Module.privacyDataClasses` remains derived from `privacy.dataClasses` (R3-2, Export shape).
2. **Implement.** The owning module registers a handler under a DI key. The handler reads that module's own entities through the existing decryption helpers, plus the record's custom-field values through the shared helper.
3. **Fan out.** The `privacy` module collects definitions from the registry, resolves each handler by its key and calls it. It imports no other module.
4. **Deliver.** A CLI resolves a person from an identifier, shows what is held, and writes the export to a file.

### Design decisions

| Decision | Rationale |
|---|---|
| The contract defines only the three read operations, all optional | Released types are a stable surface. Adding optional methods and optional input fields later is additive. |
| A resolved subject carries a match quality: `exact` or `candidate` | An email or phone match is an equality on the decrypted, normalized value. A name match is never more than a candidate, and the CLI will not export a candidate unless the operator names it. |
| CRM people are resolved by a decrypting scan, not the token index | The index gives false negatives (see Problem Statement), and a missed person is a compliance failure. The scan is slow on a large tenant and always right. The lookup hashes `customer_entities.primary_email_hash` and `primary_phone_hash` from B1 Phase D (encryption-map spec) replace it once they are filled. |
| A class may declare more than one subject kind | This is how a link is followed from the other side: `customer_accounts` declares that it holds data about a CRM person, so exporting the person finds the portal account. |
| Related subjects are followed | A portal user's link to a CRM person is an exact foreign key. Leaving it unfollowed would omit CRM data from an export that claims to be complete. |
| Handlers include soft-deleted rows | A row that still holds personal data is still held. None of the three modules has a global soft-delete filter, so handlers simply add no `deletedAt` condition. |
| Scope is a tenant plus an optional organization | A data subject addresses the controller, which is the tenant. |
| Data completeness and audit completion are explicit | Failed or truncated reads make `complete` false; `auditStatus` is separate. Exit 0 guarantees both complete data and completed audit evidence. Missing audit refuses before resolution. |
| Each export leaves bounded audit evidence | Action logs keep resource kind and id filterable and support a system actor (`audit_logs/data/entities.ts`, `services/actionLogService.ts`). These ids are personal data; the dedicated export-evidence expiry below bounds them. |
| Export CLI and settings authorization | Export remains an operator CLI. Phase 7 adds `privacy.settings.view` and `privacy.settings.manage` for authenticated settings commands; shell settings calls use the registered system actor and an explicit tenant. The dispatcher is not an authorization guard. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Side-effect registration from `di.ts` (the #5557 branch) | Needs a global mutable store and a booted app before anything can read the list. |
| Derive classes from encryption maps | Maps name columns, not subjects, linked records or lookups. |
| One central export service that queries every module's tables | Breaks module isolation and has to be edited for every new module. |
| Token index with an equality post-check | The post-check removes false positives but cannot recover people the index never returned. |
| Add an email and phone lookup hash to `customers` now | A schema change and backfill. It is the right fast path and belongs to the encryption-coverage spec, B1 Phase D (`customer_entities.primary_email_hash`, `primary_phone_hash`, `mercato customers fill-lookup-hashes`). |
| Reuse the access log for the audit entry | Short retention; encrypted resource id. |
| Require a controller-chosen export or settings evidence age before those features run | Blocks access requests and settings edits on a configuration step. The 365-day default is already finite, and the controller can shorten it to the 30-day floor. |

### Known limits of the first slice

Stated so an operator does not read more into an export than it holds. `mercato privacy classes` shows exactly what is covered.

- **Only three modules are covered.** Sales documents, messages, attachments, AI conversations and the rest arrive with the five domain coverage specs; C4 owns the shared erasure operation and seams, not all domain handlers.
- **Company records are not subjects.** A sole trader stored as a `company` entity with the same email is not found.
- **Platform accounts with no tenant** (`users.tenant_id` null) are not reachable by a tenant-scoped request.
- **Free text is exported as stored.** Comments, activities, deal descriptions and emails may mention others; their sections are flagged for operator review.
- **Before Phase 6, person invitations use `person_entity_id` only.** `--subject` and `--phone` miss invitations with the same email and no person link. The section reports `truncated: true`, `ALIASES_NOT_AVAILABLE`, so completeness is false. Export by email resolves the invitation directly. Phase 6 closes the gap using `email_hashes`; operator docs state it.
- **Before C4 Phase 2, custom fields cannot be complete.** The interim `loadCustomFieldSnapshot` path reads through `loadCustomFieldValues`, which drops soft-deleted values (`packages/shared/src/lib/crud/custom-fields.ts`, `deletedAt: null`). Until `entitiesPrivacyService.listCustomValuesForPrivacy` is registered, every custom-field section reports `truncated: true` with `CUSTOM_FIELDS_SEAM_UNAVAILABLE`, so completeness is false and export exits 2.
- **Only current identifiers are followed.** Aliases are computed from a subject's current email addresses and phone numbers. Records filed under a former address or number, for example before an email change, are outside the run. Whenever aliases are used, the document and summary carry the notice `FORMER_IDENTIFIERS_NOT_COVERED`; operators run an identifier export (`--email`/`--phone`) for each known former value.
- **Phone matching is format-sensitive.** Numbers compare as their ASCII digits, so `+48 600 100 200` and `600 100 200` are different identifiers. Every phone resolution carries the notice `PHONE_FORMAT_SENSITIVE`; operators repeat the request with each written form they know (international and national).

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

##### Scenario: National and international forms
- WHEN the stored number is `+48 600 100 200` and the operator resolves `600 100 200`
- THEN the person is not matched and the result carries `PHONE_FORMAT_SENSITIVE`

##### Scenario: Name is never exact
- WHEN an operator resolves a name
- THEN every returned subject is marked candidate

#### ADDED Requirement: Subject export
The system SHALL write one JSON document containing a section for every registered data class that holds data about the requested subjects and the subjects linked to them, and SHALL never include credentials, tokens or lookup hashes.

##### Scenario: Complete export
- WHEN an operator exports by an email that resolves exactly, all required aliases are available and the audit completes
- THEN the file contains the decrypted records from every class holding those subjects, `complete` is true, and the command exits 0

##### Scenario: Linked subject with a different email
- WHEN a portal user is linked to a CRM person whose primary email differs, and the operator exports by the portal email
- THEN the document also contains the CRM person's records

##### Scenario: Custom fields before the seam
- WHEN `entitiesPrivacyService.listCustomValuesForPrivacy` is not registered and the subject has a custom-field value
- THEN the custom-field section is `truncated` with `CUSTOM_FIELDS_SEAM_UNAVAILABLE`, `complete` is false and the command exits 2

##### Scenario: Export bounds
- WHEN `--max-records` is 0, negative, fractional or above 50000, or more than 100 `--subject` values are given
- THEN the command exits 1 before any audit entry or handler call

##### Scenario: A handler fails
- WHEN one handler throws during an export
- THEN the file is still written with `complete` false and that class marked failed, and the command exits 2

##### Scenario: Candidate is not exported implicitly
- WHEN an operator runs an export by name
- THEN nothing is exported and the command lists the candidates with the `--subject` values to use

##### Scenario: Nothing found
- WHEN no record subject resolves and every applicable identifier class answers empty, with no failed, truncated or unavailable lookup
- THEN no file is written and exit is 3; the synthetic identifier alone does not prove data is held

#### ADDED Requirement: Export audit
The system SHALL record each export, and each request that found nothing, in the audit log without storing the identifier or any exported value in clear.

##### Scenario: Audit entries
- WHEN an export of two subjects completes
- THEN a started request entry preceded resolution, two per-subject entries and a terminal request entry exist, correlated by request id, without identifier values or hashes

##### Scenario: Audit unavailable
- WHEN the audit service is absent or cannot write the started entry
- THEN no handler runs, no file is written and exit is 2

##### Scenario: Related chain
- WHEN related subjects form a three-hop chain
- THEN it is followed to a fixed point; reaching the safety cap instead makes completeness false and exit 2

##### Scenario: Organization scope
- WHEN two organizations in one tenant share an email and export uses `--org A`
- THEN only A and null-organization rows appear, including tenant-level staff users, and the document has `scopeNarrowed: true`

##### Scenario: Tenant setting
- WHEN an operator sets a declared privacy setting for A
- THEN validation and the versioned configs service write affect only A

##### Scenario: Evidence expiry
- WHEN export evidence passes its configured finite age without a hold
- THEN the dedicated expiry set deletes its subject-bearing entries; only counts and dates may survive in its run summary

##### Scenario: Evidence expiry waits for replay or a lock
- WHEN a live replay or unresolved lock makes the audit routine skip an export-evidence entry
- THEN the adapter returns `incompleteReason: 'history_replay_pending'`, preserves committed counts and a retry position before the skipped page, and retries on the next run

#### ADDED Requirement: Identifier confidentiality on the command line
The system SHALL NOT echo the identifier value in the dispatcher's command banner.

##### Scenario: Banner redaction
- WHEN an operator runs `export --email <value> --reference <text>`
- THEN the printed command line shows both flags with their values redacted

##### Scenario: Banner redaction on erase
- WHEN an operator runs the erasure spec's `erase --email <value>` or `erase --phone <value>`
- THEN the printed command line shows the flag with its value redacted

#### ADDED Requirement: Identifier subject id
The system SHALL give a subject known only by an email address or phone number the same id in every process and every run for the same tenant and normalized identifier, and SHALL NOT let that id equal a stored lookup hash.

##### Scenario: Same id across runs
- WHEN an operator resolves the same email twice, in two processes, the second time in upper case with spaces around it
- THEN both offer the same `privacy:identifier` id, starting `idv1_`

##### Scenario: Another tenant
- WHEN the same email is resolved in two tenants
- THEN the two ids differ

##### Scenario: No lookup secret
- WHEN no lookup secret is configured
- THEN no identifier subject is offered and the command says why

## 📝 Architecture

```mermaid
flowchart LR
  subgraph owners["Owning modules (existing)"]
    A["auth<br/>privacy.ts + handler"]
    C["customers<br/>privacy.ts + handler"]
    P["customer_accounts<br/>privacy.ts + handler"]
  end
  G["generator (existing)<br/>new: privacy + derived privacyDataClasses"] --> R["module registry (existing)"]
  A & C & P -. declared in privacy.ts .-> G
  subgraph privacy["privacy module (new)"]
    S["subject service"]
    CLI["cli.ts"]
  end
  R --> CLI --> S
  R --> DI["privacy/di.ts (new)"] --> S
  S -- "resolve handler by DI key" --> A & C & P
  S -. "soft-optional" .-> AL["audit_logs (existing)"]
  CLI --> F["export file"]
```

Takeaway: the `privacy` module knows definitions and DI keys only; every query stays inside the module that owns the table.

### Components

- **Types, schema and collector** — `packages/shared/src/modules/privacy.ts` holds the zod schema for a definition and the types inferred from it, plus the handler types. `getPrivacyDataClasses(modules)` in `packages/shared/src/modules/registry.ts` reads `module.privacy.dataClasses` and returns validated definitions stamped with module id. R3-2 below defines the whole-object transport and member validation.
- **Generator** — `privacy.ts` becomes a convention file in the three registry emitters of `packages/cli/src/lib/generators/module-registry.ts`, which write five files: `modules.generated.ts` and `modules.runtime.generated.ts` (main), `modules.app.generated.ts` and `modules.bootstrap.generated.ts` (app), `modules.cli.generated.ts` (CLI). It is also added to `STRUCTURAL_CONVENTION_FILES` for the dev watcher. No module-fact kind or override domain is added; `runtime.ts` is the precedent for a convention without them.
- **Handlers** — one per class, in the owning module under `lib/privacy/`, registered in that module's `di.ts`. The container is CLASSIC mode, so a factory taking an object parameter ends in `.proxy()`.
- **Subject service** — `privacy/lib/subjectService.ts` is a factory taking definitions and a resolver. `privacy/di.ts` registers `privacySubjectService`, collecting at operation time from runtime `getModules()` (`@open-mercato/shared/lib/modules/registry`) after bootstrap. It never uses the CLI registry or caches an early empty list. No applicable definitions refuses with `NO_DATA_CLASSES`, never a vacuously complete result. The CLI passes definitions from `getCliModules()` at its boundary to the same factory. The portal reuses this registration. C4 extends this same service with `eraseSubjects` under R3-14 — The `eraseSubjects` entry point; it never registers a second service. C4's “Origin-preserving portal recovery” separately owns `resumeErasureRun({ scope, runId, actor, mode }): Promise<PrivacyErasureRunResult>` and `recordFailedHandoff({ scope, subject, actor })` on this same key. The factory also returns C4's CLI-only internal `runErasure(input, { identifier?, absentRoot? })`, which is not registered on the DI key. Before DSR Phase 1 enables, C1 Phases 4 and 6 and C4’s required operation/seams must have delivered `exportSubjects`, `eraseSubjects`, `resolveAliases` and `deriveIdentifierSubjectId` on this key. This prerequisite has no dependency on portal Phase 2. It returns data and never prints.
- **Portal-link resolver** — `customers/di.ts` registers `customerPortalLinkResolver`, the customers-owned read seam described below. Both account auto-link subscribers resolve it softly; account occupancy checks and writes remain account-owned.
- **Settings service** — `privacy/di.ts` registers the configs-backed `privacySettingsService` (R3-3). No privacy code reads `module_configs` directly.
- **Evidence expiry** — `privacy/lib/exportEvidenceRetention.ts` calls C4's audit routine (DEC-B) through DI and the record-retention runner (DEC-C). Enterprise owns scheduling and holds.
- **CLI** — `packages/core/src/modules/privacy/cli.ts`. It reads the registry through `getCliModules()`, which may only be called from a file named `cli.ts`. Its arguments are validated by zod schemas in `privacy/data/validators.ts`.
- **Dispatcher** — `packages/cli/src/mercato.ts` gains `--email`, `--phone` and `--name` in `SENSITIVE_MODULE_CLI_OPTIONS_BY_COMMAND` for `privacy:resolve`, the same three plus `--reference` for `privacy:export`, and `--email` and `--phone` for `privacy:erase`, the erasure spec's command, whose entry C4 extends with `--reference` (`mercato.ts:249-253`).

### Coupling

| Touchpoint | Mechanism | Module absent |
|---|---|---|
| `privacy` → owning module's handler | DI key from the definition; `hasRegistration` check | A declared class with no registered handler is reported as failed |
| `privacy` → `audit_logs` | Soft-optional DI resolve of `actionLogService` | Export refuses before resolution, exit 2; `classes` and standalone `resolve` remain available |
| `privacy` → configs | Soft-optional DI resolve of `moduleConfigService` | Settings refuse with `SETTINGS_UNAVAILABLE`; no substitute store |
| Evidence expiry → retention | `privacyRetentionService` and optional `privacyRetentionGuard`, DEC-C | Missing runner means expiry is unavailable and the bound is not enforced; without Enterprise only explicit exclusions apply |
| `customer_accounts` → customers linking | Soft DI `customerPortalLinkResolver`; only scoped link ids returned | Leave unlinked, notify staff for manual review; no CRM-table fallback |
| Owning module → `privacy` | None. A module declares and registers; it never imports `privacy` | Definitions are inert when `privacy` is disabled |
| Handler → custom-field values | C4's entities-owned `entitiesPrivacyService.listCustomValuesForPrivacy`, described below | Required missing/failed seam makes the section incomplete; no shared-table fallback |
| Privacy activity filter → linked portal accounts | Account-owned `customerAccountUserPrivacyHandler.resolveLinkedPortalSubjects`, described below | Missing, failed or incomplete linkage is unknown activity, never an empty match |

### Subject kinds and the subject set

| Class | Declares subject kinds | Why |
|---|---|---|
| `auth.users` | `auth:user` | — |
| `customers.people` | `customers:person` | — |
| `customer_accounts.users` | `customer_accounts:user`, `customer_accounts:invitation`, `customers:person` | An invitation holds an email and name for someone who may never have signed up. Declaring `customers:person` lets a person's export find the portal accounts linked to it |

The service follows `relatedSubjects` to a fixed point with a visited set keyed by kind and id, without a depth limit. A safety cap of 1000 distinct subjects stops further traversal, records `resolution.relatedTruncated: true`, makes `complete` false and exits 2. Every visited subject reaches every applicable class declaring its kind. Before fan-out, the owner checks each named record subject in scope: a missing or foreign id is `not_found`, has no label and invokes no dependants. An unknown kind is a usage error. Empty class lists and failed owner checks cannot produce a complete export.

**In-process callers.** This service owns registration; the portal spec consumes it without registering another copy. The same operation is `privacySubjectService.exportSubjects`, registered under a DI key by the `privacy` module. It takes the scope, the subjects, `followRelated` (default true), an optional list of data-class ids that narrows the fan-out, an actor, a reference and an optional `publish(document)` callback. The CLI supplies atomic file publication as that callback; an in-process call without it hands the assembled document back after audit completion. Publication failure is audited as failed and never exits 0. For a synchronous in-process caller only, `exportSubjects(input, { budget }?)` accepts an internal optional `budget: { maxRecordsPerSection: number; maxUtf8Bytes: number; deadlineMs: number }`; none of these fields is read from an HTTP request. Validate positive finite integer caps and convert the remaining `deadlineMs` on entry to a monotonic deadline. Under C7 the cap is 100 records per section and 1,048,576 bytes of exact UTF-8 attachment JSON, within the remainder of its absolute 15-second route budget. Reserve the last two seconds of that deadline for terminal audit; if they are all that remains, start no data reads. Propagate record limits, deadline and cancellation through owner handlers, using a bounded extra row to detect truncation and a transaction-local statement timeout on owner queries. An unsupported owner budget refuses instead of running an unbounded read. Serialize the exact document incrementally under the byte cap, including metadata, escaping, punctuation and any trailing newline, stopping before allocating an oversized output. A successful budgeted in-process result returns the bounded exact encoding for response publication only after terminal audit completion. Never retry a failed or over-budget operation unbounded. On limit or cancellation return incomplete with a closed reason (`export_record_limit`, `export_byte_limit`, `export_deadline` or `export_budget_unavailable`), and append incomplete terminal evidence if time and audit availability permit. Missing/failed/timed-out audit cannot produce an attachment. Emit counts and bounded reasons only. Tests exercise multibyte and escaped data at/over the byte cap, section overflow, monotonic cancellation, owner refusal, terminal audit reserve and no partial response after any failure. Unbudgeted CLI and existing in-process behavior keep their defaults. The command is one caller and passes the defaults; a caller that must hand the result to the subject directly, such as the portal download in [`2026-11-16-portal-privacy-self-service.md`](2026-11-16-portal-privacy-self-service.md), turns following off and names its classes. With `followRelated: false` and the list restricted to `customer_accounts.users`, portal publication applies the account-only allowlist: omit `personEntityId`, `customerEntityId`, their database-name variants, company metadata, invitations sent to other people and all related-subject ids, labels, metadata and CRM content. Do not merely stop traversal while serializing the handler’s links. Full staff/CLI exports retain their reviewed link sections. Unit and portal integration fixtures include a linked CRM person/company with different emails and sent/addressed invitations; assert that neither CRM ids/content nor another recipient's invitation appears anywhere in the portal document.

### Customers-owned portal-link resolver

The email-change spec’s “CRM linking” boundary consumes `customerPortalLinkResolver`; C1 delivers it with Phase 3’s customers handler, before that dependent email-change phase. It moves the existing CRM resolution reads out of `customer_accounts/subscribers/autoLinkCrm.ts` and `autoLinkCrmReverse.ts`; it does not change ordinary linking policy.

The resolver exposes one `resolveLinks` method with these validated forward/reverse input alternatives and a common result:

```ts
type CustomerPortalLinkInput =
  | { scope: { tenantId: string; organizationId: string }; email: string
      personEntityId: string | null; customerEntityId: string | null
      createdPersonOrProfileId?: never }
  | { scope: PrivacyScope; createdPersonOrProfileId: string; email?: string
      personEntityId?: never; customerEntityId?: never }
type CustomerPortalLinkResult = {
  organizationId: string
  personEntityId: string | null
  customerEntityId: string | null
}
resolveLinks(input: CustomerPortalLinkInput): Promise<CustomerPortalLinkResult | null>
```

Use strict zod union schemas: UUID scope/link/event ids, a valid normalized email when supplied, no mixed alternatives or extra keys. Forward inputs come from the loaded account; reverse inputs from the trusted created-person event. Email is a private in-memory input, never a result or log field. A reverse call without email resolves the event's owning link ids; with email it additionally verifies that account candidate's normalized address against the resolved person's address. Read only customers entities through decryption helpers. Preserve trimmed/lower-case email comparison, person-entity or profile-id event resolution, company-kind validation, valid existing company links, and company recovery from the person’s own profile. Every candidate and recovered company must belong to the exact owning organization and tenant and be undeleted. Linking uses that existing exact-organization rule, not privacy export’s organization-plus-null rule. A reverse event without an organization may first resolve its scoped person/profile id to the owning organization; no account link crosses it. Null means no eligible match; invalid input or unavailable reads throw and cannot be treated as a match.

The forward subscriber reads its own account and asks for links. The reverse subscriber resolves the event’s link ids, then examines its own unlinked account candidates in bounded keyset batches, supplying each candidate’s email and the event id back to the resolver to verify the match; no CRM address is returned. Preserve the existing first eligible account behavior. Both subscribers use the email-change spec’s account-owned advisory lock and occupancy recheck before attaching; no subscriber queries CRM tables or calls the old cross-module ownership reader. Missing resolver leaves the account unlinked and reports the staff follow-up without an email in diagnostics. The email-change spec owns the concurrency rule, not this read seam.

`customers/lib/__tests__/portalLinkResolver.test.ts` covers entity/profile event ids, email normalization, existing valid company, person-as-company repair, person-profile company recovery, foreign/deleted/wrong-kind candidates and exact organization isolation. Add its CLASSIC DI case. `TC-CUSTOMER-PORTAL-LINK-001` creates its own two-tenant/two-organization people, companies and accounts; exercise both real subscribers, invitation-prelinked person recovery, absent seam and occupied-person refusal. Clean every fixture and event/job in `finally`; no seeded data. Account-owned subscriber tests assert no direct customers-entity import or query.

### Account-owned portal links for activity

The [inactive-subject spec](2026-11-16-inactive-subject-retention.md), “Required sources”, needs direct portal submission attribution when the linked account has a different address. C1 Phase 6 adds this read-only member to the existing account-owned `customerAccountUserPrivacyHandler`; it is not a second subject service or a foreign-kind alias declaration:

```ts
export type PrivacyLinkedSubject = {
  subject: PrivacySubjectReference
  aliases: PrivacySubjectAliases
}
resolveLinkedPortalSubjects(input: {
  scope: PrivacyScope
  subject: PrivacySubjectReference
  after?: string
  limit: number
}): Promise<
  | { status: 'known'; links: PrivacyLinkedSubject[]; next?: string; done: boolean }
  | { status: 'unknown'; links: []; done: false; reason: string }
>
```

Zod restricts the input kind to `customers:person`, output kinds to `customer_accounts:user`, UUID ids, page size 1–100 and a scoped opaque cursor. Privacy first verifies the CRM person through its owner. The account method then queries only its own accounts by `personEntityId` plus tenant and organization-plus-null scope, including soft-deleted accounts; it returns account references and their current owner-resolved aliases, never addresses, names or CRM/company data. Exhaust immutable-id keyset pages before asserting completeness; `done: false` requires a progressing `next`. Only a fully exhausted known result with no links means no linked portal account. Missing service/method, an exception, malformed/foreign page or alias failure becomes unknown, never no activity.

The privacy activity filter obtains this mapping once per CRM person and passes each source input an additive `linkedSubjects?: readonly PrivacyLinkedSubject[]` alongside that person's own `subject`/`aliases`. The inactive-subject owner adds that field to its per-subject `activity` input. Forms uses the supplied account references for direct `subject_type: 'customer'` attribution and those accounts' aliases for its existing invitation match; it reads forms tables only. The root's aliases stay owned by `customers`; account aliases stay inside their linked-subject envelope. No `portal_user_ids` or other foreign `providedAliases` key is introduced. Complete attribution is a prerequisite of the inactive-subject Phase 2/3 path; an absent/failed linkage returns `status: 'unknown'` for the person and refuses candidate publication/apply.

Owner unit/DI and `TC-PRIVACY-017` integration tests cover a differently addressed linked account with a recent direct submission, empty links, soft-deleted links, multiple pages, current account aliases, tenant/organization negatives and every unknown path. No extra related subject is added to an erasure target or a portal export by this activity-only seam.

### Resolution rules

| Class | Identifier | Method | Match |
|---|---|---|---|
| `auth.users` | email | Lookup-hash candidates **or** plaintext email, the same predicate login uses (`authService.ts:30-57`) but without login's `deletedAt` filter | exact |
| `customer_accounts.users` | email | `email_hash IN lookupHashCandidates(email)` in scope, for accounts and invitations, including legacy-digest and soft-deleted rows | exact |
| `customers.people` | email | Scan; compare trimmed, lower-cased values | exact |
| `customers.people` | phone | Scan; compare digits only, using Phase 1's `normalizePhoneDigits`, matching `customers/api/people/check-phone/route.ts:24-26` | exact |
| `customers.people` | name | Scan; case-insensitive substring on the decrypted display name | candidate |

The scan reads `customer_entities` of kind `person` in the tenant in keyset batches of 500 by id, decrypting and comparing, and applies `--limit` after the comparison. The document records the method each class used.

## 📝 Data Models

No entity, table, column or migration is added. Settings reuse tenant-scoped `module_configs`, its `updated_at` and its module/name/tenant unique index (`configs/data/entities.ts`). Evidence expiry calls the owning audit service. The data-model graph is skipped.

**What each first class exports.** Soft-deleted rows are included with their `deletedAt`.

| Class | Sections | Never exported |
|---|---|---|
| `auth.users` | user, roles, per-user ACL, consents, sessions (timestamps only), password resets (timestamps only), sidebar preferences, sidebar variants (`name`, `locale`, `settings_json`, `is_active`, timestamps), custom fields | `password_hash`, `email_hash`, session and reset tokens, `integrity_hash` |
| `customers.people` | person (including `lastActivityAt` when the inactive-subject spec’s Phase 1 field is present), profile, addresses, comments, activities, interactions, interaction mentions, tags, labels, linked deals (title, description, stage, status, value and currency), company display names and the person's company links and roles, entity roles, todo links, email-conversation shares, custom fields of the entity and of the profile | — (no credentials on these tables) |
| `customer_accounts.users` | user including lockout and the six deletion/re-authentication fields allowlisted below; sessions with IP and user agent; roles; per-user ACL; verifications and resets (timestamps only); addressed invitations; email-change rows (metadata only) | `password_hash`, `email_hash`, `token_hash`, `cancel_token_hash`, `approval_token_hash`, verification/reset/invitation capabilities, email-change `new_email` and internal deletion fencing/retry/exclusion metadata; portal publication also omits CRM links, company metadata, sent invitations and related-subject metadata |

- **Account additions.** Follow self-service Data Models, “Account class field lists”: allow `deletionRequestedAt`, `deletionEffectiveAt`, `deletionFailedAt`, `deletionAttempts`, `reauthFailedAttempts` and `reauthLockedUntil` when those columns ship. Omit `deletionClaimedAt`, `deletionLastAttemptAt` and `deletionExcludedRelated`, including their database-name variants. For `customer_user_email_changes`, allow only `id`, `mode`, `requestedBy`, `createdAt`, `updatedAt`, `expiresAt`, `usedAt` and `cancelledAt`; omit `requestedByUserId`, `approvedAt`, `cancelledVia`, the target address and every capability digest (`token_hash`, `cancel_token_hash`, `approval_token_hash`). C4 deletes every account-owned email-change row and reports each in `historyRecords` under R3-1 — The audit-history rule for every erasure; export metadata alone never covers that table. The account owner clears re-authentication state, while portal request fencing and retry metadata remain until the complete-result finalizer specified by self-service. These dependent-schema additions ship with their owning portal phases, not by querying absent columns. `portalPrivacyFields.test.ts` and the portal's TC-PORTAL-PRIVACY-002 assert the positive allowlist and absence of worker fields, target addresses, capabilities, CRM metadata and sent invitations.
- **Activity field.** The inactive-subject spec owns `last_activity_at` and its API projection. C1 explicitly maps it to `lastActivityAt` in the person export when the field and Phases 3–4 handler coexist. Ship the export assertion in `TC-CUSTOMERS-LAST-ACTIVITY-001` with that field; activity-only delivery does not wait for C1.
- **Same-module linked content.** Deals, deal-person links, companies and person-company roles belong to `customers` (`data/entities.ts`: `customer_deals`, `customer_deal_people`, `customer_companies`, `customer_person_company_roles`). Export linked deals by `id`, decrypted `title`, `description`, `pipelineStage`, `status`, `valueAmount`, `valueCurrency`; descriptions are `freeText`. Export linked companies' `customer_entities.display_name` and the subject's link fields, not their other contacts or billing data. Account roles belong to their account module and include display names. Records actually owned by another module contribute only links unless that owner supplies a handler section.
- **Interaction mentions** are interactions not owned by the person in which the person appears: `linked_entities` containing the person's id, or `participants` containing the person's primary email (`customers/data/entities.ts`, `participants` and `linked_entities` columns). Match linked ids and use a parameterized `EXISTS` over `jsonb_array_elements(participants)` for email, comparing `lower(trim(participant.email))` to the normalized email, inside the tenant and organization predicate. Null or non-array JSON becomes an empty array. Export id, type, date and matching entries only. Mixed-case and padded header addresses match. C4 reuses the predicate to find candidates, but removes by email only a participant entry without `userId`; an entry with a `userId` is that user's participation and stays (C4, The three roots, `customers.people`).
- **Free-text sections** (comments, activities, interactions) are flagged `freeText`.
- **Custom fields** use C4's “Custom values — `entitiesPrivacyService`” listing seam when C4 Phase 2 delivers it: `listCustomValuesForPrivacy({ scope, entityId, recordIds, after?, limit }, { em? })` returns `{ records: Array<{ recordId: string; organizationId: string | null; values: Record<string, unknown>; recordIdentities: Array<{ table: 'custom_field_values'; rowId: string; columns: string[] }> }>, next?: string, done: boolean }`. The root proves record ownership first; each request names one exact entity id and at most 100 owned record ids, with page size 1–100. Exhaust every record/organization keyset page, including soft-deleted values and removed definitions, and preserve tenant plus optional organization-plus-null scope. With `em`, use the caller's current transaction as C4 specifies. Preserve the seam's complete row identities for independent fixture proof; they contain no value snapshot and grant no retention permission. Customers makes separate calls for `customers:customer_entity`/entity ids and `customers:customer_person_profile`/profile ids, as `customers/lib/customFieldRouting.ts:4-5` requires. Auth and other roots use their own actual custom-field entity keys. Missing/malformed pages, ambiguous legacy tenant ownership or failed decryption make the section incomplete, never an empty success. Before this seam lands, `loadCustomFieldSnapshot` is only the existing initial helper; it drops soft-deleted values, so a section built from it is always `truncated: true` with `CUSTOM_FIELDS_SEAM_UNAVAILABLE` and the export cannot be complete. C4 owns `clearCustomValuesForPrivacy` and its history records; no root queries foreign custom-value tables.
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
  providedAliases: z.record(z.string(), z.array(z.string())).optional(),
  subjectActions: z.array(z.enum(['discover', 'export'])).min(1),
})
export type PrivacyDataClassDefinition = z.infer<typeof privacyDataClassDefinitionSchema>


export const privacySettingDefinitionSchema = z.object({
  name: z.string().regex(/^retention\.[a-z][a-z0-9_]*\.[A-Za-z][A-Za-z0-9]*$/),
  type: z.enum(['integer', 'number']),
  unit: z.enum(['days', 'years']),
  minimum: z.number().nonnegative(),
  default: z.number().optional(),
}).superRefine(validatePrivacySettingBounds)
export type PrivacySettingDefinition = z.infer<typeof privacySettingDefinitionSchema>

export const privacyModuleDeclarationSchema = z.object({
  dataClasses: z.array(privacyDataClassDefinitionSchema),
  settings: z.array(privacySettingDefinitionSchema).optional(),
}).passthrough()
export type PrivacyModuleDeclaration = z.infer<typeof privacyModuleDeclarationSchema>

export type PrivacyScope = { tenantId: string; organizationId?: string }
export type PrivacySubjectReference = { kind: string; id: string }
export type PrivacySubjectIdentifier = { kind: 'email' | 'phone' | 'name'; value: string }
export type PrivacySettingResult = {
  name: string
  value: number | null
  source: 'tenant' | 'default' | 'unset'
  updatedAt: string | null
}
export type PrivacySettingsService = {
  get: (scope: PrivacyScope, name: string) => Promise<PrivacySettingResult>
  set: (scope: PrivacyScope, name: string, value: number,
    options: { expectedUpdatedAt: string | null }) => Promise<PrivacySettingResult>
}

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

export type PrivacySubjectAliases = Readonly<Record<string, readonly string[]>>

export type PrivacyDataClassHandler = {
  resolveSubjects?: (input: {
    scope: PrivacyScope
    identifier: PrivacySubjectIdentifier
    limit: number
  }) => Promise<{ subjects: PrivacyResolvedSubject[]; truncated: boolean; method: 'hash' | 'scan' }>
  resolveAliases?: (input: { scope: PrivacyScope; subject: PrivacySubjectReference }) =>
    Promise<PrivacySubjectAliases>
  discoverSubject?: (input: {
    scope: PrivacyScope
    subject: PrivacySubjectReference
    aliases?: PrivacySubjectAliases
  }) => Promise<{ found: boolean; recordCount: number }>
  exportSubject?: (input: {
    scope: PrivacyScope
    subject: PrivacySubjectReference
    aliases?: PrivacySubjectAliases
    maxRecordsPerSection: number
  }) => Promise<{ recordCount: number; sections: PrivacyExportSection[]; relatedSubjects?: PrivacySubjectReference[] }>
}
```

`validatePrivacySettingBounds` rejects a default below `minimum` and fractional minimums/defaults for integer settings. A missing default means unset, not zero. This validator is added in Phase 7. The envelope is extended with each later optional member schema; validated results are reused by collectors, not reparsed. Before Phase 7, the envelope carries unknown optional members intact.

- **Aliases.** `resolveAliases` and `aliases` are specified under "Aliases" below and ship in Phase 6. Until then the service passes no `aliases`.
- **Downstream cleanup.** The R3-2 registry carries the optional `downstreamCleanup` member unchanged until C4 adds its member validator. The [C4 API contract](2026-11-16-privacy-subject-erasure.md#-api-contracts) is the sole definition of `PrivacyDownstreamCleanup`, its shared types and guarded call shape. Only C4 defines and validates the member. Its first consumer, `form_to_deals.deal_projections`, declares `sourceEntity: 'forms:form_submission'` and requires C4’s guarded contract before registration. An installation without a copier has no downstream cleanup to run.

- **Scope.** `organizationId` absent means every organization in the tenant. Present, it means that organization plus rows that have no organization. There is no `null`: elsewhere in the codebase a null organization means "global rows only", and the contract avoids that ambiguity.
- **Actions and methods.** A class is called for an action only if it lists the action and its handler has the method. A listed action with no method is reported as failed with `ACTION_NOT_IMPLEMENTED`.
- **Growth.** Later specs add optional methods (erase, anonymize, retention), new members to the `subjectActions` enum, and optional fields on the input objects (an actor, a dry-run flag). All are additive.
- **Export shape — R3-2: The registry carries the whole `privacy.ts` default export.** `PrivacyModuleDeclaration` requires `dataClasses` (use `[]` for checks-only modules). All five generated registries expose its whole validated default object as optional `Module.privacy`. Keep optional `Module.privacyDataClasses`, derived from `privacy.dataClasses`. Today the generator imports namespaces and supports fallback members for other conventions (`module-registry.ts:2818-2823, 4098-4106, 4720-4728`); default-only is this new convention's deliberate rule, not a generator limitation. Named exports are not read; a named class array may remain for tests.
- **Collectors — R3-2.** `getPrivacyDataClasses`, `getPrivacyDoctorChecks`, `getTableExports`, `getRetentionSets` and `getPrivacyTables` read the corresponding members from `module.privacy`. Shared validation runs once per member per declaration and collectors reuse its result. Invalid data is never silently empty; each collector keeps its domain error contract, including the doctor's rejected-check list (DEC-I — The doctor's extension point). The envelope preserves optional members instead of stripping unknown keys. Later specs add member types and schemas without changing generators; this includes `recipients` for the register spec and `downstreamCleanup` for C4’s erasure run. Inactive-subject retention owns the strict schemas and shared `getSubjectRetentionSets` and `getPrivacyActivitySources` collectors, including validation of ownership, uniqueness and runtime registration. The generic envelope requires no generator change.
- **Alias declarations.** Optional `providedAliases` maps owned subject kinds to the alias names this class supplies. Reject keys owned by another module. `customers.people` declares `customers:person` with `profile_ids`, `email_hashes`, `phone_hashes`, `identifier_subject_ids`; `customer_accounts.users` declares `customer_accounts:user` with `email_hashes`, `identifier_subject_ids`. Compare handler output to these declarations in owner tests; discovery is data-only and never instantiates handlers.
- **Identifier coverage guard.** A class declaring `privacy:identifier` must also declare every record kind whose owner supplies its `email_hashes` or `phone_hashes`: currently `customers:person` and `customer_accounts:user`. Validate against the collected `providedAliases` declarations and reject missing kinds before export, so naming a record cannot silently skip address-keyed data.
- **Titles** and section titles are locale keys, resolved at the command boundary with `resolveTranslations`; new human-facing messages also use privacy locale files. Machine error codes remain stable. Future UIs reuse these keys.

**Handler obligations**

- Keep `tenantId` in every predicate. With `organizationId`, add `(organization_id = :organizationId OR organization_id IS NULL)` on every scoped table, including resolution, aliases, linked records and mention lookups. Children lacking scope columns must be reached through an already checked parent. Decryption deliberately ignores organization (`decryptScope.ts:21-23`); it is not authorization, and a tenant mismatch leaves ciphertext untouched. Unit-test tenant, organization and null-organization branches for every handler query.
- Read through `findWithDecryption` / `findOneWithDecryption`; add no `deletedAt` condition.
- Build each record field by field from an explicit list; never spread an entity.
- Return plain JSON values: dates as ISO strings, files by id.
- Stop a section at `maxRecordsPerSection` and set `truncated`.
- Return a label only for a subject inside the tenant.

### CLI — `mercato privacy <command>`

| Command | Flags | Output |
|---|---|---|
| `classes` | — | Registered classes: id, module, subject kinds, identifiers, actions. Reads no database |
| `settings list` | `--tenant` required | Declared retention settings, effective value/source/unit/version, tenant-only; pages at most 100 |
| `settings set` | `--tenant` required, `<name> <value>` | Validated versioned write through configs; returns value and `updatedAt` |
| `resolve` | `--tenant` (required), `--org`, one of `--email` / `--phone` / `--name`, `--limit` (default 50) | Subject references with match quality and label |
| `discover` | `--tenant`, `--org`, `--subject <kind:id>` (repeatable) | Record count per class |
| `export` | `--tenant`, `--org`, one of `--email` / `--phone` / `--name` / `--subject` (only `--subject` repeatable, at most 100), `--out <file>` (required), `--reference <text>` (required), `--force`, `--max-records` (integer 1–50000, default 10000 per section) | Writes the document; prints a summary |

`export --name` resolves candidates, lists their `--subject` values and exits 2 with no file. `--email -`, `--phone -` and `--name -` read a single value from stdin without echo; this is the documented path. Inline flags remain supported. C4's erase command must consume the same stdin convention. Empty, multiple-value or conflicting inputs fail before handlers run. `--limit` is an integer from 1 to 100. `--max-records` is a zod integer from 1 to 50000; zero, negative, fractional and non-numeric values are usage errors (exit 1). More than 100 `--subject` values, or a repeated one, is a usage error. A section stopped at `--max-records` is `truncated`, so the export is incomplete and exits 2.

Flag aliases follow the house convention (`--tenantId`, `--organization`, `--output`). `--reference` is a non-personal case or ticket id of at most 120 characters, never a name or address; it is the only human attribution the audit entry has. The reference is otherwise kept only in encrypted audit context, so the dispatcher redacts it in its banner. `--tenant` is checked for UUID format only; an unknown tenant simply resolves nothing. With `--org`, the document's `scopeNarrowed` is true and the summary states that the export is limited to that organization plus rows with no organization.

The following exits apply to `resolve`, `discover` and `export`: `resolve` candidates and truncated discovery use 2; verified empty resolution/discovery uses 3; successful non-empty results use 0. `classes` uses 0 for a valid registry (including an empty list), 1 for usage and 2 for a declaration/collector failure. Settings list/set use 0 on success, including declared unset values on list, 1 on invalid input or denied authorization, and 2 on an unavailable service/audit, invalid stored value or version conflict; they never use 3. The export table below is not a dispatcher-wide exit contract: the doctor, register and scan specs use 2 for their findings/incomplete reports and never inherit export's empty-result 3; record retention retains its own refusal/incomplete exits. Set `process.exitCode` for 2/3 so the dispatcher does not collapse them to 1.

| Exit code | Meaning |
|---|---|
| 0 | Done; for `export`, the document is complete and audited |
| 1 | Usage error, or the output file exists without `--force` |
| 2 | Incomplete data, unavailable identifier coverage, truncated resolution or traversal, candidates only, or missing/failed audit; summary states file presence and `auditStatus` |
| 3 | No record subject and all applicable identifier classes empty, with no uncertainty; no file; started and terminal nothing-found evidence written. For a phone identifier the summary still prints `PHONE_FORMAT_SENSITIVE`: absence covers that written form only |

**File handling.** Write and fsync the complete document to a mode-`0600` temp file in the target directory. Without `--force`, publish with `link(temp, target)`, which atomically fails if the target exists; then unlink the temp and fsync the directory where supported. Never check-then-rename or reserve an empty target. With `--force`, atomically replace by same-filesystem `rename`. On Windows use the same no-replace hard link; an unsupported filesystem refuses instead of copying non-atomically. POSIX mode bits do not secure Windows files; use a private directory with suitable ACLs. Ordinary failures clean up temp files; a crash may leave a temp for operator cleanup, never a partial document at the target. No document is printed. The verification suite must reuse this publication rule.

### Export document (version 1)

```json
{
  "documentVersion": "1",
  "generatedAt": "2026-11-16T10:00:00.000Z",
  "tenantId": "…",
  "organizationId": null,
  "scopeNarrowed": false,
  "reference": "DSR-142",
  "resolution": {
    "identifierKind": "email",
    "perClass": [{ "dataClassId": "customers.people", "method": "scan", "truncated": false }]
  },
  "coveredDataClasses": ["auth.users", "customer_accounts.users", "customers.people"],
  "notices": [],
  "complete": true,
  "auditStatus": "started",
  "requestId": "<random UUID>",
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
- `scopeNarrowed` is true exactly when `--org` (or an in-process `organizationId`) narrowed the scope; `complete` then describes that narrowed scope only.
- `notices` lists stable codes for disclosed limits, never values: `FORMER_IDENTIFIERS_NOT_COVERED` whenever any alias was used, `PHONE_FORMAT_SENSITIVE` whenever a phone identifier was resolved. Notices do not change `complete`; the CLI summary prints them translated.
- `source` is `resolved`, `named` or `related`.
- Class `status` is `ok`, `empty` or `failed`; failures carry an `errorCode`, not message text. A named record subject missing in scope has subject `status: not_found`, no label and no dependant calls. All verified missing gives exit 3 with no file; mixed found/missing gives an incomplete document.
- `complete` describes data only: a non-empty applicable class list, every named subject verified, classes `ok` or `empty`, and no section, initial resolution or related traversal truncated. Missing aliases needed by an enabled class make it false. Undeclared modules remain outside `coveredDataClasses`.
- The published file says `auditStatus: started` because terminal evidence follows publication. `requestId` links it to that evidence. The result and CLI summary carry `auditStatus: complete`, `failed` or `unavailable`; exit 0 requires complete data and completed audit. In-process callers use the same started lifecycle; without `publish`, terminal evidence is written before returning the assembled document. With a CLI publisher, it follows file publication. Callers must inspect the returned audit status.
- With a secret, email/phone resolution offers a synthetic identifier beside record subjects. Export asks all applicable identifier classes before deciding absence. No record subjects and all such classes empty means no file and exit 3; failure or truncation means exit 2. Without a secret, declared identifier coverage is unavailable: no records means exit 2 and no file; records produce an incomplete document. With no such class, verified absence still gives exit 3.

### Audit entries

Written through `actionLogService.log`. Before export resolution, owner checks or data reads, write a started entry with a random `requestId`. An absent service or failed start refuses with exit 2 in every mode; no handler runs and no file is written. Standalone `resolve` remains read-only. After publication (or assembly for a caller with no publisher), append per-subject entries and a terminal request outcome. Final audit failure keeps the file, reports `auditStatus: failed` and exits 2; the durable started entry exposes the unfinished operation. Audit entries are append-only.

| Case | `resourceKind` | `resourceId` | Context |
|---|---|---|---|
| Started request | `privacy.subject_export_request` | random request UUID | status `started`, identifier kind, reference; no input value or digest |
| Per exported subject | `privacy.subject_export` | `<kind>:<id>` | request id, class ids, counts, data completeness, reference |
| Nothing found | `privacy.subject_export` | `privacy:identifier:<id>` with a secret; random request UUID without one | status `nothing_found`, identifier kind, request id, reference; no hash |
| Terminal request | `privacy.subject_export_request` | same request UUID | status `complete`, `nothing_found` or `failed`, counts, reference; no subject list |

Per-subject evidence and a nothing-found outcome with a derived id set the subject's root parent pair as specified below; a random-id outcome has no parent. All use `commandId: privacy.subject.export`. The command actor is `system:privacy-cli`; in-process callers supply their actor. No undo token is written. Resource ids are clear and filterable: record ids and keyed identifier ids are personal data. Context uses the audit encryption map. No identifier value, label, lookup digest or exported field is stored, even without encryption. An empty request writes one nothing-found outcome plus its request lifecycle entries.

### Export-evidence expiry

This contract owns expiry of `privacy.subject_export` and `privacy.subject_export_request`. General history retention still excludes `privacy.`; that is not an exemption from this dedicated expiry. Erasure ledgers, replay manifests and other privacy evidence remain with their owning specs, which must state their own bounds.

Declare `retention.privacy.exportEvidenceAgeDays`: integer, days, minimum 30, default 365 (R3-3). This is the program's privacy-evidence default, not a statutory period. Declare `privacy.export_evidence` with `targets: ['records']`, `minimumDays: 30`, `unmatchedHoldsOptOut: 'forbidden'`, locale-key `title`/`ageBasis`, `handlerService: 'privacyExportEvidenceRetentionHandler'` and `runEvidence: 'aggregate'`, using `PrivacyRetentionSetDefinition` from record retention (DEC-C — Retention sets and holds). The DSR engine's policy validation refuses `allowUnmatchedHolds` for this set; an opt-out that still reaches the handler skips the set with `hold_not_honourable`, because request lifecycle rows cannot honour one. Run it through `privacyRetentionService.run` with DEC-C's preview/apply, batching and hold guard. Consume record retention's “Aggregate evidence for expiry runs” and exact `PrivacyRetentionAggregateSummary`; the shared driver owns logging. Use the tenant setting as the effective age and refuse shorter caller windows. OSS operators must schedule the command by that deadline. Enterprise's privacy page supplies the same daily default policy. Until a runner is configured the bound is not enforced; the export summary and deployment docs say so.

The handler calls C4's `actionLogService.applyRetention` (DEC-B — The audit-history strip routine, erasure spec, API Contracts), with `tenantId: scope.tenantId`, optional `organizationId`, `olderThan: new Date(cutoff)`, `after`, `limit`, `excludeSubjects`, `mode: 'delete'`, these two exact `includeResourceKinds` and `dryRun`. Use the retention runner’s fixed `cutoff`, never subtract the age twice. Map `changed` to handler `deleted`, preserve `matched` and return `filesPending: 0`. Forward `next`/`done` only when `skipped` is zero. Under R4-6 — Incomplete export-evidence expiry, add `history_replay_pending` to the contract's `incompleteReason` enum: entries skipped because a replay is live or a lock is unresolved return `incompleteReason: 'history_replay_pending'` and `done: false`, even if the selected page was exhausted. Keep the retry position before that page rather than forwarding a cursor past skipped entries, preserve committed counts and retry on the next run. The record-retention runner preserves that value as its result `reason`, with `status: 'incomplete'` and `complete: false`. It never queries audit tables. Its `excludableSubjectKinds` lists the root kinds from enabled classes plus `privacy:identifier`. Per-subject and derived-id nothing-found evidence also sets `parentResourceKind` to the subject kind with its colon replaced by a dot and `parentResourceId` to its id. DEC-B's existing three-pair rule therefore matches it without a new audit-side mapping. Request lifecycle rows have no subject id: any active subject hold makes the set skip with `hold_not_honourable` instead of guessing which request to delete. A failing registered guard refuses. Under R3-5 — Holds, honestly, holds exist only with Enterprise; OSS explicit subject exclusions cause the same conservative skip. Held evidence expires on the first pass after release without resetting its age. Hold freshness cites R3-10 — One definition of a stale hold in the DSR spec.

Evidence keeps its tenant id when the tenant is later soft-deleted (tenant deletion is a soft delete), so the same tenant-scoped run, naming that tenant id, expires it. Expiry deletes each entry whole, including subject id, actor, reference and context. Only counts, run dates and set id may survive in this set's retention-run summary; no subject ids, request ids or free-text reference are copied there. The aggregate driver requires the audit logger before pruning, writes no preview summary and records zero-change, skipped and incomplete apply outcomes. Missing logging capability refuses before pruning; a later summary-write failure reports `complete: false`, `status: 'incomplete'`, `reason: 'evidence_write_failed'` with committed counts and retry position preserved, exactly as record retention specifies. No command or engine wrapper adds a second identifying run entry. Delivery waits for that shared path and its identifier-free summary tests. Export evidence is not replay evidence. A started request left by a publication crash expires at the same age.

## 📝 Resolved assumptions (autonomous defaults)

| Id | Question | Decision |
|---|---|---|
| EVIDENCE-AGE | Lifetime of export evidence | Default 365 days, floor 30, with no unlimited value. Enterprise holds, OSS explicit exclusions and unresolved work (a live replay or an unresolved lock, `history_replay_pending`) extend it. One year covers a late reply, a follow-up complaint or an audit of the request, and it is the program's single privacy-evidence age. Other evidence owners choose their bounds. |
| SETTINGS-EVIDENCE-AGE | Lifetime of settings command evidence | Default 365 days after successful terminal completion, floor 30, the program's single privacy-evidence age. Holds, errors and unresolved operations are preserved until reconciliation, so recovery evidence is never silently deleted. |

### Tenant privacy settings — R3-3: Tenant privacy settings live in `module_configs`

Use existing tenant-scoped `module_configs` rows with `module_id = 'privacy'`, `tenant_id = scope.tenantId`, `organization_id = NULL`, and names under `retention.<area>.<setting>`. The existing unique key is module/name/tenant (`configs/data/entities.ts`). These settings are tenant-wide: `--org` is a usage error. No privacy ORM entity or new table is added.

Each coverage spec declares its setting’s name, type, unit, minimum and default in optional `privacy.ts.settings`; C1 owns the collector/service/CLI, not duplicate sales, checkout or staff routes. The current consumer declarations are:

| Name | Type | Unit | Minimum | Default |
|---|---|---|---|---|
| `retention.sales.orderAgeYears` | integer | years (calendar) | 1 | None; unset refuses the legal-retention set |
| `retention.checkout.paymentAgeYears` | integer | years (calendar) | 1 | None; unset refuses the legal-retention set |
| `retention.staff.employmentRecordAgeYears` | integer | years (calendar) | 1 | None; unset refuses the legal-retention set |
| `retention.eudr.recordAgeYears` | integer | years (calendar) | 5 | 5, as declared by content-ai coverage |
| `retention.privacy.exportEvidenceAgeDays` | integer | days | 30 | 365, owned here (EVIDENCE-AGE) |
| `retention.privacy.erasureEvidenceAgeDays` | integer | days | 30 | 365, owned by C4 “Erasure-evidence expiry”, assumption 20 |
| `retention.privacy.retentionEvidenceAgeDays` | integer | days | 30 | 365, owned by record retention “Retention-run evidence” |
| `retention.privacy.settingsEvidenceAgeDays` | integer | days | 30 | 365, owned here (SETTINGS-EVIDENCE-AGE) |
| `retention.privacy.tenantExportEvidenceAgeDays` | integer | days | 30 | 365, owned by tenant exit, assumption 11 |

Consumers own their minimums and defaults; usually default is absent and unset refuses the set. C1 chooses only its export/settings evidence defaults; EUDR, erasure, retention-run and tenant-export defaults above are reproduced from their owners, not declared a second time or substituted for `exportEvidenceAgeDays`. Each owner extends the one privacy declaration where appropriate; duplicate setting names still fail. `getPrivacySettings(modules)` validates names, duplicates, numeric types, units, minimums and defaults; the service validates stored and incoming values with the declared zod schema. Years-to-days conversion follows the consuming spec's rule, never a hidden service conversion.

`privacySettingsService.get(scope, name)` returns `{ name, value, source: tenant | default | unset, updatedAt: string | null }`. It calls `moduleConfigService.getRecord('privacy', name, { tenantId })`, accepting only a matching tenant record with `source: tenant` and null organization. Today's configs service falls back to instance records (`configs/lib/module-config-service.ts`), so the adapter discards those: an instance value cannot make an unset tenant legal age appear configured. An organization-bearing tenant override or invalid stored value refuses with `SETTING_INVALID`; missing configs service refuses with `SETTINGS_UNAVAILABLE`.

`mercato privacy settings list --tenant <id>` lists declarations, effective values, units, source and `updatedAt`. `mercato privacy settings set --tenant <id> <name> <value>` parses the JSON scalar with zod, writes through configs and prints value/version. Unknown names, invalid values or tenant-less writes are usage errors. No list page exceeds 100. In-process `set(scope, name, value, { expectedUpdatedAt })` requires the version for update and null for create; CLI reads the current tenant version and supplies it. Enterprise's privacy page uses the same service.

Add optional trailing `{ expectedUpdatedAt?: string | null }` to `moduleConfigService.setValue`; existing calls remain unchanged. The configs-owned implementation checks `updated_at` under a transaction row lock, handles concurrent insert through the existing unique key, returns the shared optimistic-lock conflict and updates its scoped cache only after commit. Privacy callers always supply the option. Privacy code imports no configs entity. Settings edits use `privacy.settings.set` without a personal-data undo/redo snapshot. C1 adds `privacy.settings.view` and `privacy.settings.manage` in `privacy/acl.ts`, translated labels and `setup.ts.defaultRoleFeatures` for administrators, with the existing additive ACL-sync migration path. Authenticated command/API list and set boundaries check the respective feature through wildcard-aware RBAC and require trusted tenant-wide organization authority; an organization-restricted actor cannot change a tenant-wide age. Consumers reading an age during retention call the service with their already authorized operation scope, not a UI feature check. The shell CLI explicitly attributes `system:privacy-cli` and its required tenant; the dispatcher supplies neither a feature grant nor an authenticated user. It never accepts a caller-supplied actor flag. Enterprise routes/page consume these features, server mutation guards and shared version/conflict helpers in addition to their engine authorization and R3-9 — Organization-scope guard on every DSR route; this spec adds no API or UI.

Before a settings mutation, require a writable audit service and a durable config-history entry (`resourceKind: configs.module_config`, `commandId: privacy.settings.set`) in the tenant with a random operation UUID as `resourceId`, trusted actor, setting name, unit and `started` status. Every started and terminal entry of the operation also carries the constant clear-text related pair `relatedResourceKind: 'privacy.settings_command'`, `relatedResourceId: 'privacy.settings.set'`, which `actionLogService.log` already accepts (`audit_logs/data/validators.ts:30-31`). Record `completed`, `conflict` or `failed` after the configs result using that same resource kind/id and related pair; omit stored/input values, credentials, free-text reference and undo snapshots. A failed start changes nothing. If final audit fails after commit, report exit 2 and the committed version, never claim rollback or unaudited success. No subject identifier or exported value enters it. This evidence has its own expiry below; neither a `privacy.*` exclusion nor generic history stripping supplies its whole-entry bound. Unit tests exercise direct unauthorized command dispatch, wildcard grants, organization restriction, unavailable/start/terminal audit, safe contexts and the related pair on every started and terminal entry.

### Settings-command evidence expiry

Declare C1's `retention.privacy.settingsEvidenceAgeDays` (integer days, minimum 30, default 365) and `privacy.settings_evidence` (`targets: ['records']`, `minimumDays: 30`, `excludableSubjectKinds: []`, `unmatchedHoldsOptOut: 'forbidden'`, `handlerService: 'privacySettingsEvidenceRetentionHandler'`, `runEvidence: 'aggregate'`). The DSR engine's policy validation refuses `allowUnmatchedHolds` for this set; the handler keeps refusing an opt-out that reaches it. Use the sole record-retention runner and its fixed cutoff under DEC-C — Retention sets and holds, selecting its existing “Aggregate evidence for expiry runs” path for the counts-only summary below. Resolve the effective age through `privacySettingsService.get(scope, name)` and refuse a caller window shorter than that age; invalid/unavailable settings refuse. The bound starts at the successful terminal `completed` timestamp, not the request's start. Preserve failed/conflicting operations, groups without valid terminal completion and unresolved audit/config outcomes until explicitly reconciled; malformed or unavailable completion evidence refuses deletion. Any explicit subject exclusion or Enterprise hold skips the whole set with `hold_not_honourable`; a failed registered guard refuses. The handler itself refuses non-empty `excludeSubjects`, so an engine unmatched-hold opt-out cannot discard evidence. Hold release does not restart its age. OSS operators schedule the command; until configured or while unresolved, the finite target is reported as unenforced.

The audit owner adds `actionLogService.expirePrivacySettingsEvidence({ scope, olderThan, limit, after?, dryRun })`, returning `{ matched, changed, skipped, next?, done }`. It uses bounded keyset pages of at most 100 operation groups and atomically rechecks each group under its own audit transaction before deleting it whole. Here `matched`, `changed` and `skipped` count operation groups, the logical retention records; examine at most `limit` and never split a group between commits. Match only tenant-scoped `resource_kind = 'configs.module_config' AND related_resource_kind = 'privacy.settings_command' AND related_resource_id = 'privacy.settings.set'`, grouped by the operation UUID; `command_id` is encrypted (`audit_logs/encryption.ts:7`) and cannot be selected in SQL, while the clear-text pair is served by the existing `action_logs_related_resource_idx`. Never delete other configuration commands or infer settings evidence from a `privacy.` prefix. A scope with `organizationId` refuses. The method never returns context, setting values, actors or row ids. Privacy calls it through DI, maps `changed` to `deleted` and reports zero pending files; it never queries audit tables or extends DEC-B's selector signature. General age-based history stripping/deletion must leave these exact groups, identified by the same related pair, to this expiry so it cannot destroy their completion/recovery evidence early; this is not an exemption for unrelated config history or explicit subject-history stripping. Delete actor, reference, context and every started/terminal entry of the eligible group together. Retention summaries contain only dates, set id and counts. The audit-owned method and generic-age safeguard must land with this Phase 7 set; absence cannot be treated as successful expiry.

### Bootstrap-free settings reads — R3-3

`createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })` returns only `Pick<PrivacySettingsService, 'get'>` for transaction-bound settings reads. It preserves `get(scope, name)` and the normal `{ name, value, source, updatedAt }` result internally. Reject null/unknown tenants, names outside the validated definitions and organization scope; `tenantIds` is the supplied allowed tenant list. Construct lazily using the supplied read-only transaction-bound manager. No application bootstrap, general `di.ts`, cache or connection/fork/transaction of its own is allowed. Under R4-7, database-tier doctor checks, including `privacy.retention_settings_unset`, may construct this get-only service from their supplied `em` and `tenantIds`; values and versions stay internal and findings contain counts only.

The configs owner supplies `createModuleConfigPrivacyReader({ em })`, a get-only `getRecord(moduleId, name, { tenantId })` adapter over its own table on that same manager. It returns only exact tenant rows, never instance fallback, writes, defaults or cache results; an organization-bearing override is invalid rather than a tenant-wide setting. Privacy applies its existing declared default/unset handling; an invalid stored tenant override throws `SETTING_INVALID` even if a default exists, and unavailable owner reads throw `SETTINGS_UNAVAILABLE`. No read failure becomes unset or zero. Database-tier checks construct the settings service through this owner boundary using their existing context; no new doctor context member or general service resolver is added. Configuration-only runs import/instantiate neither reader. Add default/unset/invalid/instance-fallback, tenant-list rejection, scope and read-only tests in Phase 7.

### Bootstrap-free settings counts — R3-3 / R3-4

C1 owns the privacy database check `privacy.retention_settings_unset` and its `countServices['privacy.retention_settings']` factory. It is `needs: 'database'` under R3-4 — An opt-in database tier for the doctor. `createPrivacyRetentionSettingsCounter({ em, definitions })` returns exactly `PrivacyDoctorCountingService`: `count(input: { tenantId: string | null; counter: string }): Promise<number>`; the supported counter is `required_unset`, and null tenants or unknown counters refuse before querying. The doctor resolver rejects any tenant outside its supplied list. Under R4-7, the bound check iterates the supplied `tenantIds`, reads required settings through `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })`, and returns an aggregate finding only, never tenant ids. The named counting adapter retains its counts-only contract; it does not replace those settings reads. It counts collected declarations with no valid effective value, including invalid stored overrides; definitions with no default require a tenant value. Valid declaration defaults satisfy the count; instance values never do. It exposes no setting value, version, row or identifier. Commerce and people-ops supply their setting declarations to this aggregate. The doctor's `sales.retention_age_unset`, `checkout.retention_age_unset` and `staff.retention_age_unset` checks independently use the same get-only boundary under R4-7; each remains available through isolated `--only` selection.

The configs owner adds the side-effect-free sanctioned factory `createModuleConfigSettingsCounter({ em })` in `configs/lib/module-config-service.ts`. Its `countRequiredUnset({ tenantId, moduleId, definitions })` performs tenant-scoped aggregate counting with the declared numeric type/minimum/default predicates over its own table. It takes C1’s validated definitions, returns only a number, and uses the supplied read-only transaction manager without cache, fallback, general DI or application bootstrap. Privacy’s adapter delegates to that factory, importing/resolving it lazily inside the database counter rather than at declaration load; privacy never queries configs tables. A configuration-only run must not load configs ORM entities. Missing/throwing services refuse the check rather than returning zero.

The doctor CLI already owns the module snapshot. In `privacy/cli.ts`, collect `getPrivacySettings(modules)` from that snapshot and call `bindPrivacySettingsDoctorCheck(check, definitions)` before handing the selected privacy check to the runner. The binding preserves its own count factory as `({ em }) => createPrivacyRetentionSettingsCounter({ em, definitions })`, retaining the doctor's `{ em }` factory signature and id-prefix rules. It also binds the check's database `run` to construct `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })` from the existing read-only context and validated definitions under R4-7. That run tallies required settings whose source is `unset` or whose read reports `SETTING_INVALID`, accepts valid declared defaults, ignores instance fallback and returns counts only; unavailable reads propagate as `doctor.check_failed`, never zero or unset. The selected declaration in `privacy/privacy.ts` refuses if unbound; no global mutable registry, CLI-registry access outside `cli.ts`, ORM import at declaration load or runtime bootstrap is needed. Bind before `--only` execution, so selecting just `privacy.retention_settings_unset` works without another check. A default configuration-only doctor run constructs no counter and opens no database. Unit/CLI integration tests cover isolation, defaults, ignored instance fallback, invalid stored values, selected-check binding, read-only enforcement and identifier/value-free output.

## 📝 Addendum: aliases and people known only by an address

Added on 2026-11-16, after the coverage specs' reviews. Both are additive to this unreleased contract and ship in Phase 6 with the first coverage spec needing them. The independent phone normalization helper ships in Phase 1, before B1 Phase D (DEC-F — The B1 hand-offs); whichever lands first adds the identical helper. The types are in the handler type block above; this section is their normative statement.

### Aliases

Some modules know a person by something other than the subject's id: an order names a contact by a profile id; a message names an outside party by an address. They must not read the owner's tables to translate.

- The class that owns a subject kind may implement `resolveAliases`. It returns named lists of strings for a subject (`PrivacySubjectAliases`).
- The run calls it once per subject, before any other class, and passes the result to every handler as `aliases` on its input: `discoverSubject`, `exportSubject`, and the erasure spec's `checkErasable` and `eraseSubject`. It is `{}` when the owner does not implement it.
- In process, `privacySubjectService.resolveAliases({ scope, subject })` returns the same result, for callers outside a run such as the enterprise DSR engine.
- Names in use: `profile_ids`; `email_hashes`, every form `lookupHashCandidates` gives for each of the person's addresses, with no context string; `phone_hashes`, the same over a number reduced to its digits by `normalizePhoneDigits` from `@open-mercato/shared/lib/privacy/identifier`, which the modules that store numbers also use when they write their own hash; `identifier_subject_ids`, the `privacy:identifier` id (see below) of each of the subject's current email addresses and phone numbers.
- `identifier_subject_ids` is filled by the owner classes of `customers:person` (`customers.people`) and `customer_accounts:user` (`customer_accounts.users`). They compute it with the shared derivation in `@open-mercato/shared/lib/privacy/identifier`, so neither imports the `privacy` module. The enterprise DSR engine stores these ids with a hold on such a subject, and its guard compares them.
- Aliases are computed from the owner's data at the time of the run. Once the owner has anonymized a person, there is nothing to compute them from: a class added in a later release cannot find address-keyed records of someone already anonymized. That limit is stated in each coverage spec.
- Aliases cover current addresses and numbers only. A former address, for example the old address an email change replaced, is not an alias, so address-keyed records filed under it stay outside the run. Every run that used aliases carries `FORMER_IDENTIFIERS_NOT_COVERED` in its document, summary and C4's erase report; operators run an identifier subject (`--email`/`--phone`) for each known former value.
- Two people who share an address share its hash. A class that finds records by an address alias reports, in the dry run, how many it found that way, so that an operator can see it before applying.

### A subject that is only an identifier

DEC-A — Subjects known only by an identifier (`privacy:identifier`) binds this derivation and its consumers. A payer through a pay link, a guest basket, a claimant by email, a correspondent: each is a person with no record of their own, known by an address or a number in several modules.

- **The kind.** `privacy:identifier`, owned by the `privacy` module. It has no table and no class of its own.
- **When it is offered.** `resolve`, `export` and `erase` given `--email` or `--phone` always offer one such subject, beside whatever records match, as an exact match. Its aliases are the hashes of the identifier typed, computed in memory by the `privacy` module.
- **Who reads it.** A class declares `privacy:identifier` when it holds records it can find by those hashes alone. It is given the aliases, never the address.
- **Normalization.** An email is trimmed and lower-cased, as lookup hashes normalize it (`packages/shared/src/lib/encryption/aes.ts:162-164`). A phone number is reduced to ASCII digits by `normalizePhoneDigits(value: string): string` from `@open-mercato/shared/lib/privacy/identifier`, as `customers/api/people/check-phone/route.ts:24-26` does today. An identifier that is empty after normalization, or an email without `@`, is a usage error.
- **Phone canonical form, decided before release.** Digits only, with no country inference. E.164 would need a tenant default region and a phone-parsing production dependency; neither exists today, and adding the dependency is an Ask First change. Because the `idv1_` derivation freezes on release, digits-only is the canonical form of `idv1_`; a later E.164 form would be a new prefix with its own migration. The consequence is stated, not hidden: one number written in international and national form gives two identifiers, two ids and two hash sets. Resolution and aliases do not guess variants; every phone result carries `PHONE_FORMAT_SENSITIVE`, and operators repeat the request with each written form they know.
- **The id.** `idv1_` followed by the lower-case RFC 4648 base32 encoding, without padding, of an HMAC-SHA-256 over `<tenant id>\n<type>\n<normalized identifier>`. The type is `email` or `phone`. The key is derived from the installation's lookup secret for the purpose `privacy-subject-id`.
- **In process.** `privacySubjectService.deriveIdentifierSubjectId({ tenantId, type, value })`, with `type` `email` or `phone`, normalizes the value and returns this id, or nothing when no lookup secret is configured. It wraps the shared derivation in `@open-mercato/shared/lib/privacy/identifier`.
- **Its properties.** The same tenant and identifier give the same id in every process and every run while the lookup secret is unchanged. The key serves no other purpose, and the prefix differs from both stored hash forms (`v2:` and bare hex), so the id equals no lookup hash and matches no column.
- **The key derivation (new).** `aes.ts` gains `deriveLookupPurposeKey(purpose: string): Buffer | null`, deriving a purpose-bound key from its private lookup secret and returning null without one. The construction is fixed: `HMAC-SHA-256(key = resolved lookup secret bytes, message = UTF-8 "om:lookup-purpose:v1" ‖ 0x00 ‖ UTF-8 purpose)`, full 32-byte output. The secret bytes are the UTF-8 bytes of the value `resolveLookupPepper` returns, as `hashForLookup` keys its HMAC today; without a secret the result is null. Known-answer vectors in the `aes.ts` tests pin it, and the search-index spec's keyed-token construction table uses the same definition. No such export exists today. C1 owns it; a search-index or C4 implementation landing first adds this same export for C1 to reuse. Identifier ids use `privacy-subject-id`; other consumers own their purpose labels. The secret stays private.
- **No lookup secret.** There is then no key. The identifier subject is not offered: `resolve` and `export` say why, and an export is not `complete` when a registered class declares `privacy:identifier`. `erase` refuses an identifier.
- **The secret changes.** The same identifier then derives another id. Entries, events and holds written before keep the old one; a consumer that compares ids recomputes them.
- **Where the id appears.** The audit entries (`resourceId` `privacy:identifier:<id>`) and the completion event carry the derived id. No hash appears in a subject id, an audit entry about a subject, an export document or an event.
- **Erasure.** `erase` accepts `--email` and `--phone`. Its dry run reports the derived id. `--apply --confirm <token>` must be given the same flag again; the run recomputes the id and the aliases, and refuses on any mismatch. The erasure spec specifies the command. A `privacy:identifier` subject cannot be named with `--subject`, since without the typed value there are no aliases.
- **Redaction.** The dispatcher redacts `--email` and `--phone` for `privacy:erase` as for `resolve` and `export`, and `--reference` for `export` as C4 does for `erase`; no command logs these values.
- **Record subjects.** A CRM person or portal user reaches the same records through their own `email_hashes` alias, when a class also declares their kind.
- **Names.** `--name` offers no identifier subject, and it has no derived id: `erase` accepts no `--name`. A class whose records name a person only by a name returns each matching record as a candidate subject of its own kind, never acted on until the operator names it with `--subject`, as `eudr` does (content-ai coverage spec). An export never includes a candidate.

### What a module must do for a hash it relies on

The encrypt step writes a lookup hash only when it encrypts, and skips a value that is already ciphertext. A module that needs to find records by a hash therefore:

- writes the hash itself, in its own write path, whether or not encryption is on;
- ships a one-off command that decrypts existing rows and fills the hash; for initial domain coverage fills, require `--tenant <id>`, preview by default, `--apply`, optional `--after <cursor>` and `--batch-size <1..100>`, immutable keyset ordering, bounded per-batch transactions and locked empty-only writes. Return a resumable cursor and per-tenant counts, never identifiers or values; a fresh run catches earlier-key inserts. Coordinated secret-change refreshes follow B1's “Coverage-owned hash refreshes” and “Maintenance write safety”, as below;
- until that command has run for a tenant, falls back to a decrypting scan of the rows whose hash is empty, bounded as the contract's CRM scan is.

B1 Phase D owns `mercato customers fill-lookup-hashes` and the new `customer_entities.primary_email_hash` / `primary_phone_hash` columns; none exists in today’s code. R3-12 — Fill commands for module-written hashes also names `mercato sso fill-lookup-hashes` and `mercato communication_channels fill-lookup-hashes`. Their Phase D rotation/repair semantics remain B1-owned. B1's “Coverage-owned hash refreshes” additionally names `mercato forms fill-privacy-hashes`, `mercato inbox_ops fill-privacy-lookups`, `mercato messages fill-privacy-hashes` and `mercato phone_calls fill-privacy-hashes`. During coordinated B1 maintenance, those owning fills compare current, old, legacy and stale non-null hashes with verified decrypted source and repair them under the current secret. They use B1's source-and-target compare-and-set, exact tenant/organization predicates and per-row savepoints, preserve `updated_at`, and never hash unreadable ciphertext as plaintext. Populated stale hashes go through that conditional maintenance path. The initial empty-only writer has no generic overwrite authority; it neither replaces `rehash-lookups` nor forbids the owner-defined refresh. No additional CLI flag is introduced.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| No record subject and all identifier classes empty | Exit 3; no file; one hash-free nothing-found outcome plus started and terminal request entries |
| No secret and identifier coverage unavailable | With no record subjects, exit 2 and no file; never report verified absence |
| Named record missing or foreign | `not_found`, no label or dependants; all missing exits 3, mixed request incomplete |
| Only candidates resolve | Exit 2; candidates listed with the `--subject` value for each; no file |
| Resolution hits the limit | Exit 2 with a hint to raise `--limit`; no export |
| Handler throws | That class is `failed`; other classes still export; `complete` false; exit 2 |
| Class declared but handler not registered | Same, with `errorCode` `HANDLER_NOT_REGISTERED` |
| Section exceeds `--max-records` | Section `truncated`; `complete` false; exit 2 |
| `--max-records` 0, negative, fractional or above 50000; more than 100 or repeated `--subject` values | Usage error before any audit or handler; exit 1 |
| Custom-field seam not yet registered | Custom-field sections `truncated` with `CUSTOM_FIELDS_SEAM_UNAVAILABLE`; `complete` false; exit 2 |
| Export narrowed with `--org` | `scopeNarrowed: true`; summary names the organization limit |
| Records filed under a former email or phone | Outside the run; `FORMER_IDENTIFIERS_NOT_COVERED`; operator runs an identifier export per known former value |
| One phone number written in national and international form | Two identifiers; `PHONE_FORMAT_SENSITIVE` on every phone result, including exit 3 |
| Started audit fails or module absent | Refuse before resolution; no file; audit status failed/unavailable, exit 2 |
| Final audit write fails | File kept; started evidence remains; audit status failed, exit 2 |
| Related traversal cap reached | `relatedTruncated: true`, incomplete, exit 2 |
| Evidence past its age | Dedicated expiry deletes whole entries unless held; no subject id in its run summary |
| Export evidence has a live replay or unresolved lock | `history_replay_pending`, incomplete with committed counts preserved; retry the skipped page on the next run |
| Only an instance setting exists | Ignore it; declared default or unset; required unset age refuses |
| Settings edit races | Optimistic-lock conflict; no overwrite |
| Settings operation lacks successful terminal evidence | Preserve the operation group; report unresolved/error state, never expire by request start |
| Portal activity linkage is missing, failed or incompletely paged | Unknown activity; no inactivity candidate publication/apply |
| Encryption disabled | Handlers work unchanged; the decryption helpers pass plaintext through |
| Tenant-level staff user | Matched whether or not `--org` is given |
| Same email on staff, CRM and portal records | Three record subjects plus the Phase 6 identifier probe; the probe does not prove held data |
| Portal user linked to a person with another email | The person is added as a related subject and exported |
| Invitation with no account | Resolved and exported as an invitation subject |
| Two people share one email | Both are exported; the operator verifies identity before release |
| Interrupted mid-write | No partial document appears at the target path |
| An email typed with other case or surrounding spaces | The same identifier subject id |
| `--email` or `--phone` with no lookup secret configured | No identifier subject; the summary says why; an export is not `complete` when a class declares `privacy:identifier` |
| The lookup secret changes | The same identifier derives another id; entries and events written before keep the old one |

## 📝 Migration & Backward Compatibility

All changes are additive. Classification from `BACKWARD_COMPATIBILITY.md`:

| Surface | Section | Rule |
|---|---|---|
| `privacy.ts` convention file | §1 | "New convention files may be added." Add a row to the table, as `extension-points.ts` has. Frozen once released |
| `Module.privacy`, `PrivacyModuleDeclaration`, derived `Module.privacyDataClasses`; optional `downstreamCleanup` and `PrivacyDownstreamCleanup` | §2 | New optional fields; preserve the legacy alias derived from the same object; C4 alone defines and validates downstream cleanup. C1's registry carries the optional member |
| `@open-mercato/shared/modules/privacy` | §4 | New path; stable once documented. `packages/shared` uses wildcard exports, so no `package.json` edit |
| DI keys `authUserPrivacyHandler`, `customerPeoplePrivacyHandler`, `customerAccountUserPrivacyHandler` | §9 | New keys; stable once released. C4 adds `lockSubject`/`eraseSubject` to the handlers and `verifyPortalErasureRequest` to the account-owned `customerAccountUserPrivacyHandler` |
| `mercato privacy …` | §13 | New commands may be added |
| Generated registries | §14 | A new optional field; export names unchanged |
| Export document | — | Carries `documentVersion`; a breaking shape change increments it. `scopeNarrowed` and `notices` are part of unreleased version 1 |
| `resolveAliases`, `aliases`, `PrivacySubjectAliases`, `providedAliases`, the alias names; `PrivacyLinkedSubject` and account `resolveLinkedPortalSubjects` | §2, §3, §9 | Additive owner methods and common linked-subject envelope; no foreign-kind alias declaration; names stable once released |
| `privacySubjectService` including C1 `exportSubjects`, `resolveAliases`, `deriveIdentifierSubjectId` and C4 `eraseSubjects`/`resumeErasureRun`/`recordFailedHandoff` (the factory's CLI confirmation methods `runErasure` and `resumeErasureRunWithConfirmation` stay private); `privacySettingsService`; `privacyExportEvidenceRetentionHandler`; `customerPortalLinkResolver` | §9 | New keys/members, stable once released; one subject-service registration, C4 owns separate portal recovery and retention child recovery; optional internal export budgets leave CLI defaults intact and impose no portal bootstrap dependency |
| `@open-mercato/shared/lib/privacy/identifier`, `normalizePhoneDigits` | §4 | New file subpath through existing wildcard exports; stable once released; normalization precedes B1 Phase D |
| `moduleConfigService.setValue` expected-version option; `createModuleConfigSettingsCounter`; `createPrivacyRetentionSettingsCounter`; `createModuleConfigPrivacyReader`; `createReadOnlyPrivacySettingsService` | §3, §4, §9 | Optional trailing argument preserves existing callers; aggregate/get-only factories use the caller’s read-only manager and tenant scope |
| `privacy.settings.view`, `privacy.settings.manage`, `privacy.settings.set` | §10, §3 | Additive feature ids and settings command; wildcard-aware checks and safe audit; existing export CLI unaffected |
| `settings`, `PrivacySettingsService`, `PrivacySettingResult`, `retention.*` names, `privacy.export_evidence`, `privacy.settings_evidence` | §1, §2, §13 | Additive declarations and settings commands; C4 and record retention own their separate evidence settings/sets; C1 evidence defaults are 365 days, floor 30; no new table |
| Export-evidence `incompleteReason: 'history_replay_pending'` | §2 | Additive reason value for live replay and unresolved lock skips; shared retention results preserve it as `reason` |
| `privacySettingsEvidenceRetentionHandler`, `actionLogService.expirePrivacySettingsEvidence`, the settings-evidence related pair `privacy.settings_command` / `privacy.settings.set`; `CustomerPortalLinkInput`/`CustomerPortalLinkResult` and resolver `resolveLinks` | §2, §3, §9 | New scoped owner methods/keys, stable once released; whole settings-operation expiry never changes DEC-B's selector |
| `privacy:identifier` ids (`idv1_…`), their normalization and derivation | — | Frozen once released: entries, events and holds store the id. A change needs a new prefix |
| `deriveLookupPurposeKey` exported by `aes.ts` | §4 | New export; the secret stays private. Its construction is frozen once released, because identifier ids and keyed search tokens derive from it |
| Dispatcher redaction for `privacy:resolve`, `privacy:export` (identifier flags and `--reference`) and `privacy:erase` | §13 | Additive |

No database migration.

**`UPGRADE_NOTES.md`.** Extend the doctor's one operator note: an existing app gets the commands only after adding `privacy` to its `src/modules.ts` and running `yarn generate`. Nothing breaks if it does not.

**Convergence with PR #5557.** The branch exports the same type names from `@open-mercato/shared/lib/privacy` and registers by side effect. If it lands first, this spec is rebased onto it. The declarative `privacy.ts` stays the single source, and the branch's side-effect registrations are converted into `privacy.ts` declarations. A registry API the branch has already released stays as a deprecated bridge fed from `Module.privacy` for at least one minor, under the deprecation protocol.

**Template and harness.** The doctor spec enables `privacy` in `apps/mercato/src/modules.ts`; C1 depends on G4 Phase 2’s module creation/enablement and reuses it; `scripts/template-sync.ts` derives the create-app template's module list from it. Reuse the doctor's one harness case or exemption in `packages/create-app/src/lib/module-facts-build.test.ts`, extending it for C1 and refreshing the standalone harness in the same change.

## 📋 Phasing

| Phase | Outcome | Shippable alone |
|---|---|---|
| 1 | Contract types, collector, generator support, docs and C5’s static coverage gate | Yes — no runtime behaviour change |
| 2 | Doctor-created `privacy` module extended with `classes` | Yes — lists nothing until a module declares |
| 3 | Three handlers | Yes — `classes` lists them |
| 4 | Runtime DI subject service, commands and mandatory started audit | Yes — the feature |
| 5 | Documentation and harness | Yes |
| 6 | Aliases and identifier subjects | Yes — ships with the first coverage spec that needs them |
| 7 | Tenant settings, bootstrap-free reads/counts and export/settings evidence expiry | Yes — expiry needs the audit owner and retention runner; consumer ages cannot precede settings |

## 📋 Implementation Plan

### Phase 1 — Contract and discovery
Ship privacy-table-coverage/C5 Phase 1's canonical `migrations/.snapshot-open-mercato.json` reader, shared testing helper, declaration metadata and package/app gate tests with their reviewed initial baselines and pinned ceilings in this same phase, before C8. Include app/template mirrors and their explicit standalone opt-in boundary; scan/E2E stay with verification.
1. Add the Phase 1 `PrivacyModuleDeclaration` envelope with required `dataClasses` and passthrough optional members (the settings validator arrives in Phase 7), optional `Module.privacy` and derived `privacyDataClasses`. `getPrivacyDataClasses` reads the member with one validation per member (R3-2). Unit tests in `shared/src/modules/__tests__/registry.test.ts`: valid, bad id/prefix, duplicates, preserved optional member and alias identity. Add `normalizePhoneDigits` in `shared/src/lib/privacy/identifier.ts` now, or reuse B1's identical addition if first. Unit-test spacing, punctuation, empty input and B1 hash parity.
2. Add the convention file to the three emitters and to `STRUCTURAL_CONVENTION_FILES`. Update `registry-variant-parity.test.ts` (shared-property list; a fixture default object with `dataClasses` and extra `tables` member must reach all five registries intact, with the derived alias), `structural-contracts.test.ts` and `generate-watch-structure.test.ts`. Run `yarn generate` and confirm the five generated registries are otherwise unchanged.
3. Add privacy locale entries and command-boundary translation tests; document the convention: `packages/cli/AGENTS.md`, `.ai/docs/module-development.md`, the `BACKWARD_COMPATIBILITY.md` §1 table, and the scaffold's `discovery-surface-catalog.md` with `agent-surface-coverage.test.ts`.

### Phase 2 — The `privacy` module
1. Depend explicitly on G4 Phase 2 — Command, step 1, which creates and enables the shell after its Phase 1 predicates. Extend that existing `privacy/{index.ts,cli.ts}`, retaining MIT metadata and `doctor`, and reuse its registration/template wiring and dispatcher. G4 owns the sole `modules.ts` enablement, template sync and generation for that enablement.
2. Unit-test `classes` with a mock registry. Reuse the doctor's one module-facts harness case/exemption and extend its one upgrade note, not a second registration.

### Phase 3 — Handlers
One step per module. Each adds `privacy.ts`, the handler under `lib/privacy/`, the `di.ts` registration, unit tests for each query's tenant and organization-plus-null scope and the field lists, and an entry in `packages/core/src/__tests__/di-seams-classic-resolution.test.ts`.
1. `auth` — `auth.users`. The unit tests cover a tenant-level user, which cannot be created through the API (`auth/commands/users.ts` requires an organization), and the sidebar-variants section's field list and scope.
2. `customer_accounts` — `customer_accounts.users`, including invitations, legacy-hash accounts and invitations, linked-person lookup and the pre-alias incomplete section. Carry the portal deletion/re-authentication positive and negative field lists, account-only projection and metadata-only email-change section when those schemas ship; pair the latter with C4 erasure and C5 table coverage, never export-only closure. Add `portalPrivacyFields.test.ts` and the portal's TC-PORTAL-PRIVACY-002 negative-output/field assertions.
3. `customers` — `customers.people`, including the scan, normalization, mixed-case mentions, decrypted linked deal fields and company display name. Ship `lastActivityAt` and its export assertion when the inactive-subject field exists. Add `customerPortalLinkResolver`, migrate both account subscribers to its soft DI seam and ship the named unit/DI/integration coverage above; the email-change dependent phase waits for it.

### Phase 4 — Subject service and commands
1. `subjectService.ts`: collect, resolve across classes, build the subject set with related subjects, discover, export, with per-class failure isolation. Unit tests with fake handlers: a throwing one, a missing registration, a listed action with no method, a cycle, three-hop chain, safety cap, missing/foreign named subject and empty definitions. Register `privacySubjectService` in `privacy/di.ts` from operation-time runtime `getModules()`; test registry refresh and add its CLASSIC DI-seam case. Portal reuses it. Extend the CLASSIC test with the C4 extension and all four methods before enabling DSR Phase 1, with no portal module present; the real integration composition verifies method wiring after C1 Phase 6/C4 prerequisites.
2. Dispatcher redaction for the three identifier flags and the export `--reference`. Extend the existing redaction unit test in `packages/cli/src/__tests__/mercato.test.ts` to assert that each value, including `--reference`, is masked in the echoed line.
3. `resolve` and `discover` commands with their zod argument schemas. Unit tests for parsing and exit codes.
4. `export` command: document assembly, no-replace hard-link publication, fsync, `--force`, `--max-records`, name candidates and stdin. Unit tests cover a concurrent existing target, crash before publication, unsupported hard links, temp cleanup and Windows behavior; `--max-records` boundaries 1 and 50000 accepted and 0, -1, 1.5, 50001 and non-numeric refused with exit 1; 100 subjects accepted and 101 or a repeated subject refused; truncation at the bound making `complete` false; `scopeNarrowed` on the `--org` path; `notices` for alias use and phone identifiers; and the seam-absent custom-field section reporting `CUSTOM_FIELDS_SEAM_UNAVAILABLE` with exit 2.
5. Started/terminal request entries and per-subject evidence. Unit tests: no read before start, absent service, failed start, final failure after publication, request correlation and hash-free empty outcome. Missing audit never exits 0.
6. Integration tests (below).

### Phase 5 — Documentation and harness
1. Add `apps/docs/docs/framework/privacy/data-classes.mdx` (how a module declares a class and writes a handler) and an operator page for the commands, including the known limits.
2. Refresh the standalone harness per `.ai/skills/om-refresh-standalone-harness/SKILL.md`.
3. Update the program spec's changelog and package table.
4. Archive this Delta into `.ai/specs/capabilities/privacy-subject-export.md` only if that directory has been adopted by then. It does not exist today; adding it is a spec-taxonomy change that `.ai/specs/AGENTS.md` lists under Ask First, so this step never creates it.

### Phase 6 — Aliases and identifier subjects
Ships with the first coverage spec that needs them.
1. `resolveAliases` and `aliases`: the service calls the owner once per subject and passes the result to every handler; `privacySubjectService.resolveAliases` exposes the same in process. Unit tests: called once and before any other class; `{}` when the owner has none.
2. Add or reuse `deriveLookupPurposeKey` in `aes.ts`; extend the Phase 1 `privacy/identifier.ts` with identifier derivation; `privacySubjectService.deriveIdentifierSubjectId` wraps it. Unit tests:
   - known-answer vectors for `deriveLookupPurposeKey` over a fixed secret and the purposes `privacy-subject-id` and `search-token-v1`, matching the fixed construction byte for byte, and null with no secret;
   - the same id from two module instances with the same environment;
   - an email in another case or with spaces, a phone number with other spacing and punctuation;
   - another tenant gives another id; an email and a phone of the same string differ;
   - the id never equals `hashForLookup` or `legacyHashForLookup` of the same value, with or without a context;
   - no secret gives no id.
3. Add their `providedAliases` metadata and implement `resolveAliases` on `customers.people` and `customer_accounts.users`, filling `identifier_subject_ids` from the subject's current addresses and numbers. Add the account-owned `resolveLinkedPortalSubjects` member, shared `PrivacyLinkedSubject` envelope and real DI case, plus the privacy activity-filter handoff described above; inactive-subject/forms phases consume this without foreign-kind aliases. Unit tests: a person with two addresses and a number gives three ids equal to `deriveIdentifierSubjectId` of each; no secret gives an empty list. `portalSubjectLinks.test.ts` covers complete scoped paging and unknown paths.
4. Offer identifier subjects and consult their classes before deciding absence. Unit-test unknown email with/without a secret, empty/failed/unavailable classes, collector rejection for missing alias-bearing kinds, foreign `providedAliases` keys and owner-output parity. Match unlinked invitations through `email_hashes` on named/phone-resolved people. The dispatcher map gains `privacy:erase` with `--email` and `--phone`. Unit tests on the echoed line for each command.
5. Integration tests TC-PRIVACY-013 and TC-PRIVACY-017. When C4 Phase 2 lands, migrate root custom-value export to its exact `entitiesPrivacyService` listing member with entity/profile paging, soft-deleted values and missing/decryption tests; only then can custom-field sections be complete. C4 retains clearing ownership.

### Phase 7 — Settings and bounded export/settings evidence
1. Declare `settings`, `getPrivacySettings`, configs-backed `privacySettingsService`, the configs-owned optional versioned write, get-only `createModuleConfigPrivacyReader`/`createReadOnlyPrivacySettingsService` and aggregate `createModuleConfigSettingsCounter`/`createPrivacyRetentionSettingsCounter` factories/binding. Under R4-7, `privacy.retention_settings_unset` reads through `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })` on the doctor's supplied read-only manager and allowed tenant list, and emits counts only, without general bootstrap or foreign-table reads. The named aggregate factories retain their counting-only contract. Unit tests in `privacy/lib/__tests__/settingsService.test.ts` and `configs/lib/__tests__/module-config-service.test.ts`: isolation, ignored instance fallback, unset/default, invalid override, unavailable service, tenant-list/scope rejection, no writes/cache/forks, stale update, concurrent insert, cache invalidation and unchanged legacy calls.
2. Add `privacy/{acl.ts,setup.ts,commands/settings.ts}` and zod schemas for CLI list/set, explicit feature authorization, safe started/terminal audit and shared optimistic-lock conflicts. Unit tests in `privacy/__tests__/settings-cli.test.ts` and `settings-command.test.ts` cover those boundaries and per-command exits. Add `settingsDoctor.test.ts` for default no-bootstrap and isolated `--only privacy.retention_settings_unset --database` counts under R4-7. Assert that `bindPrivacySettingsDoctorCheck(check, definitions)` gives the selected check a `run` that reads through `createReadOnlyPrivacySettingsService({ em, definitions, tenantIds })`, keeps values/versions internal and returns counts only; the named aggregate adapter cannot substitute for those reads. Test the existing aggregate factory contract and parity with the get-based check, required-unset and invalid/default/instance handling across supplied tenants, null/foreign-tenant rejection, read-only enforcement, unavailable reads as `doctor.check_failed` and value/version/id-free findings. Preserve independent isolated sales/checkout/staff checks through the same get-only boundary. Consumer declarations ship with their handlers; do not invent their defaults.
3. After C4's `applyRetention` and the record-retention runner's “Aggregate evidence for expiry runs”, add `privacy.export_evidence` with `runEvidence: 'aggregate'`. Unit tests in `privacy/lib/__tests__/exportEvidenceRetention.test.ts`: the declaration including `unmatchedHoldsOptOut: 'forbidden'`, age, scope, dry run, unrelated kinds, whole-entry deletion, missing routine, exclusions, holds, an unmatched-hold opt-out reaching the handler skipping with `hold_not_honourable`, and guard failure. Assert that the `incompleteReason` enum accepts `history_replay_pending`; both a live replay and an unresolved lock map to it, preserve committed counts, return `done: false` on an exhausted page and keep a retry position before the skipped page. Release the replay/lock and prove the next run deletes the deferred entries without skipping them. Consume the runner's `retentionEvidenceSummary.test.ts` assertions for strict `PrivacyRetentionAggregateSummary`, CLI/engine parity, preserved incomplete `reason`, identifier-free persisted evidence, preview/zero-change/incomplete outcomes and unavailable/failing logger with committed counts preserved. Use the parent resource pair so C4's existing subject matching applies; never read its tables.
4. Deliver the audit-owned `expirePrivacySettingsEvidence` and C1 `privacy.settings_evidence` handler together, selecting the same shared `runEvidence: 'aggregate'` path. `settingsEvidenceRetention.test.ts` covers successful terminal age versus request age, exact resource-kind and related-pair matching, a case with tenant encryption enabled proving the selector finds and expires a due group and leaves unrelated `configs.module_config` history alone, complete group deletion, error/unresolved/malformed preservation, dry run, tenant isolation, scope rejection, missing service, holds/guard failures and counts-only summaries. Do not substitute generic privacy-prefix exclusion or DEC-B stripping for expiry.
5. TC-PRIVACY-014 to 018 below and operator docs for finite ages and OSS scheduling. DSR owns its daily export-evidence policy, settings API/UI, feature ACL and integration coverage; the newly declared settings-evidence set uses an explicitly configured records policy/OSS schedule, without inventing another engine default.

### File manifest

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Create |
| `packages/shared/src/modules/registry.ts` | Modify — field and collector |
| `packages/shared/src/lib/encryption/aes.ts`, `packages/shared/src/lib/privacy/identifier.ts` | Modify / create — normalization in Phase 1; purpose key and identifier id in Phase 6, reused if landed first |
| `packages/cli/src/lib/generators/module-registry.ts` | Modify — three emit sites |
| `packages/cli/src/lib/generate-watch-structure.ts` | Modify |
| `packages/cli/src/mercato.ts`, `packages/cli/src/__tests__/mercato.test.ts` | Modify — identifier-flag and `--reference` redaction and its echoed-line test |
| `packages/core/src/modules/privacy/{index.ts,cli.ts}` | Modify only — extend G4 Phase 2's shell/dispatcher; reuse its registration/template wiring and harness case |
| `packages/core/src/modules/privacy/{di.ts,data/validators.ts,lib/subjectService.ts,lib/exportDocument.ts,lib/settingsService.ts,lib/doctor/retentionSettings.ts,commands/settings.ts,acl.ts,setup.ts,lib/exportEvidenceRetention.ts,lib/settingsEvidenceRetention.ts,privacy.ts,i18n/*.json}` | Create / modify — runtime DI, get-only/count settings adapters and finite expiry |
| `packages/core/src/modules/configs/lib/{module-config-service.ts,__tests__/module-config-service.test.ts}` | Modify — optional version check inside owning service |
| `packages/core/src/__tests__/di-seams-classic-resolution.test.ts`; `packages/core/src/modules/privacy/{__tests__,lib/__tests__,__integration__}/*` | Modify / create — service registration and named tests |
| `packages/core/src/modules/{auth,customers,customer_accounts}/privacy.ts` | Create |
| `packages/core/src/modules/{auth,customers,customer_accounts}/lib/privacy/*.ts` | Create |
| `packages/core/src/modules/{auth,customers,customer_accounts}/di.ts` | Modify — handlers and customers-owned portal-link resolver |
| `packages/core/src/modules/customer_accounts/lib/privacy/{portalSubjectLinks.ts,__tests__/portalSubjectLinks.test.ts,__tests__/portalPrivacyFields.test.ts}` | Create / modify — account-owned activity linkage and export allowlists |
| `packages/core/src/modules/audit_logs/services/{actionLogService.ts,__tests__/settingsEvidenceRetention.test.ts}` | Modify / create — owner-only terminal settings-operation expiry |
| `packages/core/src/modules/customers/lib/{portalLinkResolver.ts,__tests__/portalLinkResolver.test.ts}`; `packages/core/src/modules/customer_accounts/subscribers/{autoLinkCrm.ts,autoLinkCrmReverse.ts}` | Create / modify — read seam and both soft consumers, no CRM queries in subscribers |
| `packages/core/src/modules/customer_accounts/__integration__/TC-CUSTOMER-PORTAL-LINK-001.spec.ts`; `packages/core/src/modules/customers/__integration__/TC-CUSTOMERS-LAST-ACTIVITY-001.spec.ts` | Create / extend — scoped linking and explicit activity export assertion |
| `apps/mercato/src/modules.ts`, template `modules.ts` (via sync) | Reuse unchanged — G4 Phase 2 owns sole enablement and template sync |
| `UPGRADE_NOTES.md`, `BACKWARD_COMPATIBILITY.md`, `packages/cli/AGENTS.md`, `.ai/docs/module-development.md`, `apps/docs/docs/framework/privacy/*` | Modify / create |

## 🧪 Integration Coverage

There is no new API or UI path; the surface is the CLI plus the two existing account auto-link subscribers. The subscriber integration case is `TC-CUSTOMER-PORTAL-LINK-001` above; the inactive-subject export assertion extends its owner’s `TC-CUSTOMERS-LAST-ACTIVITY-001`. Specs live in `packages/core/src/modules/privacy/__integration__/` and run the built CLI against the ephemeral database, following `packages/core/src/modules/auth/__integration__/TC-AUTH-033.spec.ts` and `packages/core/src/modules/customers/__integration__/TC-CUSTOMERS-SEED-001.spec.ts`.

**Mechanics the tests must respect**

- The CLI process runs with the same tenant-encryption settings as the app under test. The precedent sets them on the CLI only, which would not prove decryption.
- Commands run through `spawnSync` so that non-zero exit codes are read, not thrown.
- Every test creates its own API fixtures and removes records, evidence, settings and files in `finally`. Scoped test-database setup may create legacy hashes, tenant-level staff and backdated evidence where APIs cannot, with the same cleanup. The second tenant in TC-PRIVACY-004 is created through the directory API as superadmin.

| Test | Covers |
|---|---|
| TC-PRIVACY-001 | `classes` lists the three classes with their modules |
| TC-PRIVACY-002 | `export --email` for an email shared by a staff user, a CRM person (with address, comment, activity and a custom field) and a portal user: one document, three record subjects plus the Phase 6 identifier probe, linked deal with decrypted title/description/stage/status/value and linked company display name; after Phase 6 and C4 Phase 2's custom-value seam, `complete` true and exit 0 with audit completed and `FORMER_IDENTIFIERS_NOT_COVERED` in `notices`; before then the person-invitation alias limit or `CUSTOM_FIELDS_SEAM_UNAVAILABLE` makes it incomplete and exit 2 |
| TC-PRIVACY-003 | The document contains no password hash, token, lookup hash or ciphertext marker |
| TC-PRIVACY-004 | Two fresh tenants each hold staff, CRM (same email and same phone with other spacing), portal account and invitation. A's email/phone resolve and export return none of B's ids. Naming each B id under A gives `not_found`, no label/dependants and no complete file. Repeat with two organizations in A using `--org`: only selected plus null-organization rows in resolution, aliases, links and export, with `scopeNarrowed: true` in the document and the organization limit in the summary; scoped setup adds a tenant-level staff user |
| TC-PRIVACY-005 | `resolve --name` returns candidates only; `export` by name is refused with exit 2; `export --subject` then succeeds |
| TC-PRIVACY-006 | `resolve --phone` matches a CRM person stored as `+48 600 100 200` when asked for `+48600100200`, and does not match a different number that shares a digit run; asked for `600 100 200` it does not match, and every phone result prints `PHONE_FORMAT_SENSITIVE` |
| TC-PRIVACY-007 | A soft-deleted portal user and a soft-deleted CRM person are both still exported |
| TC-PRIVACY-008 | A portal user linked to a CRM person with a different primary email: exporting by the portal email includes the person; exporting `--subject customers:person:<id>` includes the portal account |
| TC-PRIVACY-009 | Own invitation without an account resolves by email. Phase 6 also exports an unlinked invitation to a person's email by `--subject` and `--phone`; before then section is explicitly incomplete. Include legacy-digest account and invitation fixtures |
| TC-PRIVACY-010 | Started evidence precedes reads; per-subject and terminal entries correlate by request id. Unknown email with a secret and empty identifier classes exits 3, no file, one nothing-found outcome with derived id. Without secret/no applicable identifier class, random id and exit 3; unavailable identifier coverage gives exit 2. No email, phone or lookup digest in any audit id/context |
| TC-PRIVACY-011 | Existing output file: exit 1 without `--force`; the written file has mode `0600` (skipped on Windows) |
| TC-PRIVACY-012 | The command banner printed by the dispatcher contains neither the email nor the `--reference` value |
| TC-PRIVACY-013 | Phase 6. `resolve --email` runs twice as separate processes, the second time with the address in upper case and padded with spaces. Both offer the same `privacy:identifier` id, starting `idv1_`, and no output line contains the address. The id differs from the one a second tenant, created through the directory API as in TC-PRIVACY-004 and removed in teardown, gives for the same address |
| TC-PRIVACY-014 | Own tenants A/B and declared setting: list unset/default, set/read A, B unchanged, instance fallback ignored, bad name/value refused, stale update conflicts; direct unauthorized command and organization-restricted actor denied, wildcard grants accepted, safe audit lifecycle and per-command exits; `doctor --database --only privacy.retention_settings_unset` reads through `createReadOnlyPrivacySettingsService` under R4-7 and counts only missing/invalid required settings without values or versions; remove all setting/audit fixtures through owner services |
| TC-PRIVACY-015 | Own young/expired export request and subject evidence plus unrelated rows in two tenants: preview changes nothing and writes no summary; expiry deletes only expired A evidence whole through the aggregate driver. Summary has only set id/counts/dates, with distinct actor/reference/export/request/subject/run markers absent from every persisted field; logger unavailable refuses before deletion and a post-commit write failure preserves counts/incomplete status. Live replay and unresolved lock skips each return `history_replay_pending` with incomplete status, committed counts and no cursor past the skipped page; after release, the next run deletes those entries. When Enterprise enabled, own hold skips until release; otherwise assert no-guard limitation. Remove remaining rows |
| TC-PRIVACY-016 | Own person: `export --email -` receives unique address via stdin, absent from argv/banner/logs/summary; `--name -` lists candidates, exits 2 without file; malformed input refused. Remove person, evidence and files |
| TC-PRIVACY-017 | Own scoped CRM person linked to a differently addressed portal account with a recent direct forms submission: owner-resolved linked subjects keep the person out of inactivity candidates. Cover two tenants/organizations, soft-deleted/multipage links, known-empty versus unknown linkage, foreign/malformed cursor and absent/failed seam. No portal-table read from forms or foreign providedAliases declaration; clean all fixtures |
| TC-PRIVACY-018 | Own successful, failed and unresolved settings-operation evidence in two tenants, plus another config command: preview changes nothing; apply removes only whole expired successful groups by terminal age, preserving failed/unresolved/young/foreign/other-command rows and holds/exclusions. Audit-unavailable/completion errors refuse; summaries contain no actor/reference/context/operation ids. Clean all settings/evidence/policy fixtures |

Unit-tested instead, because the real app cannot provoke them: handler failure isolation, a missing registration, cycle/three-hop chain, traversal and section truncation, missing audit/failed write, registry refresh, mixed-case mentions and unsupported publication. Tenant-level staff now has a scoped integration fixture too.

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
- **Mitigation**: `complete`, per-class status, exit code 2, `coveredDataClasses`, `scopeNarrowed`, `notices` for former identifiers and phone format, custom-field sections incomplete until C4's seam, and the Known limits section in operator docs.
- **Residual risk**: Modules without a data class are not covered. The program's coverage test (package C5) closes that gap.

#### Cross-tenant leakage
- **Scenario**: A handler omits the tenant filter and returns another tenant's subject or label.
- **Severity**: Critical
- **Affected area**: every handler
- **Mitigation**: Tenant and organization-plus-null predicates are handler obligations with per-query unit tests; TC-PRIVACY-004 covers all first handlers across tenants and organizations.
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
- **Residual risk**: Inline flags expose values through process arguments and may persist in shell history; stdin is the documented path avoiding both. Windows requires directory ACLs. Handling after export is outside the product.

#### An identifier subject id is used to test addresses
- **Scenario**: Someone who sees events or audit entries computes the id for guessed addresses.
- **Severity**: Medium
- **Affected area**: events, audit entries, holds
- **Mitigation**: The id is an HMAC under a key derived for this purpose from the lookup secret, so it cannot be computed without the secret; it is not offered when none is configured; no hash travels with it.
- **Residual risk**: Anyone holding the lookup secret can test an address, as they already can against the lookup hashes.

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

#### Export evidence remains forever
- **Scenario**: General history retention exempts privacy evidence, or expiry advances past replay/lock skips and leaves subject ids indefinitely.
- **Severity**: Medium
- **Affected area**: export accountability
- **Mitigation**: Dedicated finite-age deletion, counts-only summaries, `history_replay_pending` with a retry position before the skipped page, and guarded Enterprise policy or OSS scheduler duty.
- **Residual risk**: Missed OSS runs, live replays and unresolved locks delay deletion; holds extend it. A controller needing another age sets it, down to the 30-day floor; other evidence kinds require their owners' bounds.

#### A wrong retention setting deletes required data
- **Scenario**: An instance value or another tenant's age is mistaken for the controller's decision.
- **Severity**: High
- **Affected area**: retention consumers
- **Mitigation**: Tenant-only adapter, declared validation, unset refusal, versioned configs writes and isolation tests.
- **Residual risk**: A valid but inappropriate age remains the controller's decision.

## Final Compliance Report — 2026-11-16

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `.ai/specs/AGENTS.md` — in full
- `BACKWARD_COMPATIBILITY.md` — protocol, §1, §2, §4, §9, §13, §14
- `packages/core/AGENTS.md` — Encryption section; module conventions via the mechanics research
- Shared, CLI, create-app, auth, customers and customer_accounts guides — applicable DI, scoping, discovery, hash and template rules checked for this revision
- `.ai/qa/AGENTS.md` — test placement and self-contained fixtures
- Not reviewed: `packages/ui/AGENTS.md` (no UI), `packages/search/AGENTS.md` (the token index is no longer used)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Handlers query only their own module's entities; custom-field values come through the shared helper |
| root AGENTS.md | Never expose cross-tenant data | Compliant | Required tenant/organization scope; per-handler cross-tenant and organization test |
| root AGENTS.md | Validate inputs with zod; derive types | Compliant | Definition schema and CLI argument schemas |
| root AGENTS.md | Use `findWithDecryption` | Compliant | Handler obligation |
| root AGENTS.md | Use DI; avoid `new` | Compliant | Handlers and audit service resolved by key |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | Human-facing titles and messages use locale keys; stable error/status codes are not translated; no UI added |
| root AGENTS.md | No code under `apps/mercato/src/` except registries | Compliant | C1 reuses G4's enabled module; G4 Phase 2 owns the `modules.ts` change |
| root AGENTS.md | Optimistic locking on new editable entities | Compliant | Existing settings use `updatedAt` and versioned configs-service writes |
| packages/core/AGENTS.md → Encryption | Declare GDPR fields in encryption maps | N/A | No new column |
| packages/core/AGENTS.md → Encryption | Use the shared encryption helpers | Compliant | The identifier id's key comes from the context-bound derivation in `aes.ts`; the lookup secret stays private |
| packages/core/AGENTS.md | Cross-module coupling by sanctioned mechanisms | Compliant | DI key and soft-optional resolve; no hard `requires` |
| `BACKWARD_COMPATIBILITY.md` | Contract changes follow the protocol | Compliant | All additive; section present; one operator note |
| `.ai/qa/AGENTS.md` | Integration tests self-contained | Compliant | Fixtures created and removed per test |
| R4-6 — Incomplete export-evidence expiry | Replay/lock skips remain retryable | Compliant by design | `history_replay_pending`, incomplete status, committed counts and retry before skipped page; unit and TC-PRIVACY-015 coverage |
| R4-7 | Database doctor settings reads with counts-only findings | Compliant by design | Bound `privacy.retention_settings_unset` uses `createReadOnlyPrivacySettingsService` on the supplied manager/list; values stay internal, domain checks remain independent and unavailable reads fail |
| packages/create-app/AGENTS.md | Template sync | Compliant | Reuse G4 Phase 2's module enablement/template sync; extend its harness case in Phases 2/5 |
| root AGENTS.md | Module ids plural snake_case | Deviation, stated | `privacy` is a mass noun, like the existing exceptions `auth` and `example` |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No entities; export sections match handler types |
| API contracts match UI/UX section | N/A | No UI |
| Risks cover all write operations | Pass | File publication, audit lifecycle, settings and evidence expiry have concurrency and failure coverage |
| Commands defined for all mutations | Pass | Versioned settings command; dedicated evidence set through the retention runner |
| Delta scenarios map to tests | Pass | Each scenario has a TC or a named unit test |
| Every step is testable | Pass | Each step names its tests |

### Non-Compliant Items
One stated naming deviation: module id `privacy`, decided by DEC-10. The proposed owner-local contracts are OSS under DEC-2; the subject-export invoker requires recorded upstream carrier approval under DEC-2b, and EVIDENCE-AGE and SETTINGS-EVIDENCE-AGE are decided at 365 days, floor 30. Dependencies on other evidence owners remain explicit, so this is not a completed program claim.

### Verdict
**Ready for dependency and edition disposition.** EVIDENCE-AGE and SETTINGS-EVIDENCE-AGE are decided. The proposed OSS subject-export invoker requires the explicit upstream maintainer disposition in program DEC-2/DEC-2b before implementation or submission. R4-6 closes the export-evidence skipped-replay/lock mapping; handler delivery still requires C4's audit routine and the shared retention runner. Settings API/UI remain DSR-owned; consumer handoffs remain explicit. This reviews a design, not executed feature validation.

## Changelog

### 2026-11-18

- Linked baseline evidence to the program and added the inactive-subject registry collectors to R3-2.

- Recorded the program’s per-carrier upstream approval gate for the proposed OSS subject-export invoker.

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
- Changed the default export of `privacy.ts` from the array of classes to an object with a `dataClasses` member. This convention deliberately loads the default object and ignores named privacy exports; existing generators support named fallbacks for other conventions. R3-2 now carries the whole object.
- Added the addendum on aliases, on the `privacy:identifier` subject for people known only by an address or number, and on what a module must do for a hash it relies on. All three were found missing by the reviews of the commerce and communication coverage specs, which had each invented part of them.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes:
  - **g2-03** — the `privacy:identifier` id is derived, `idv1_` plus a base32 HMAC of tenant, type and normalized identifier under a `privacy-subject-id` key from the lookup secret, instead of generated per run; erase takes `--email`/`--phone`, redacted for `privacy:erase`; `deriveIdentifierSubjectId`, `resolveAliases` in process and the `identifier_subject_ids` alias serve the DSR engine's holds.
  - **g2-05** — `resolveAliases`, `aliases` and `PrivacySubjectAliases` are in the handler type block, and the addendum's phase is Phase 6 with its own plan and TC-PRIVACY-013.

- Council round two fixes (GPT-6.1 Sol workers): r4-02 whole-object registry; r4-03 CRM linked content; r4-04 empty identifier probes; r4-06 audit status; r4-12 hash-free evidence; r4-13 organization scope; r4-14 finite export-evidence default; r4-15 fixed-point traversal; r4-16 legacy hashes; r4-17 normalized mentions; r4-18 tenant tests; r4-19 runtime DI; r4-20 name flag; r4-21 early phone helper; r4-22 doctor bootstrap; r4-39 stdin; r4-40 import paths; r4-43 C4 event ownership handoff; r4-44 invitation limit; r4-45 collector guard; r4-50 default-object wording; r4-51 atomic publication; r4-52 started audit; g2-26 generator rationale. R3-2 and R3-3 are normative; C6 and key-derivation nits corrected.
- Council round two fixes, pass two (GPT-6.1 Sol workers): reconciled the G4 Phase 2 shell prerequisite and C5 Phase 1 delivery; settings ACL/audit/aggregate count factories; bounded coverage fills and corrected R3-12 premise; complete pre-DSR DI seam; portal account fields, metadata-only email changes and CRM-free publication; customers-owned link resolver; activity export assertion; exact retention declaration/cutoff mapping and command exits. Cross-owner corrections were carried out in the owning specs.
- Council round two fixes, pass three (GPT-6.1 Sol workers): pinned C5 helper/package/app baselines and ceilings before C8; corrected portal account allowlists and projection; cited C4's complete custom-value listing and separate erasure/retention evidence settings. Completed typed forward/reverse customer linking and account-owned portal activity linkage without foreign aliases. Added transaction-bound get-only settings construction beside the aggregate doctor adapter, corrected its nullable-tenant counting contract, and bounded the actual configs.module_config/privacy.settings.set evidence through dedicated terminal expiry with preservation/tests. Kept the sole G4 bootstrap, exact shared-decision names and command-specific exits; remaining owner handoffs were applied in the owning specs.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): copied C4's full custom-value listing identities and separate recovery member; aligned settings checks to the doctor's current aggregate-only contract, hash refreshes to B1's conditional maintenance and export expiry to the shared aggregate evidence path. Existing portal field/link contracts were verified; the the replay retry/reason mapping is settled by R4-6.
- Council round two fixes, pass five gap closing (GPT-6.1 Sol workers): R4-6 adds `history_replay_pending` to export-evidence incomplete reasons for live replay and unresolved lock skips, preserves counts and the skipped-page retry position, and closes the stale design blocker with matching scenarios, tests, risks and compliance coverage.
- Council round two fixes, pass six final fixes (GPT-6.1 Sol workers): r8-08/r4-22 leave sole module enablement and template sync with G4 in the plan, manifest and compliance rows; R4-7 binds the shared settings check to the read-only settings service with counts-only findings, independent domain checks and matching unit/integration coverage.

### 2026-11-17
- Export honesty: custom-field sections stay incomplete (`CUSTOM_FIELDS_SEAM_UNAVAILABLE`) until C4's listing seam replaces the helper that drops soft-deleted values; the document gains `scopeNarrowed` for `--org` and `notices` for the former-identifier and phone-format limits, both also stated under Known limits.
- Decided digits-only as the frozen phone canonical form for `idv1_`, with format sensitivity disclosed on every phone result; `--max-records` is bounded 1–50000 and `--subject` to 100 values.
- Added sidebar variants to the `auth.users` export, tenant exit's `retention.privacy.tenantExportEvidenceAgeDays` to the settings inventory, and the soft-deleted-tenant expiry path; Q3 now reads as an extension of G4's module.
- Pinned the byte construction of `deriveLookupPurposeKey`, shared with the search-index keyed tokens; the dispatcher also redacts the non-personal `--reference` for `export`.
- Settings evidence carries the clear-text related pair `privacy.settings_command` / `privacy.settings.set`, which its expiry selects because `command_id` is encrypted; both evidence sets declare `unmatchedHoldsOptOut: 'forbidden'`.
- Added the optional `downstreamCleanup` member for C4's erasure run (with `plan`/`run` declared in C4's method syntax, so both specs state one type), C4's `recordFailedHandoff`, CLI-only `runErasure` and `verifyPortalErasureRequest`, the email-change approval digest and fields to the account omit list, and C4's narrowed participant removal.

- 2026-11-19 — Cite the C4-owned guarded downstream-cleanup contract as the single definition used by the registry and its consumers.
