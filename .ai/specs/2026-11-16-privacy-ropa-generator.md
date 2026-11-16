# Register of processing: a generated draft

> **Program:** package G3 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593).
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md), [`2026-11-16-privacy-record-retention.md`](2026-11-16-privacy-record-retention.md) and [`2026-11-16-privacy-doctor-cli.md`](2026-11-16-privacy-doctor-cli.md).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

A controller must keep a register of its processing: what personal data, about whom, for what purpose, sent to whom, kept how long, protected how. A tenant running Open Mercato has to write that by reading the product from the outside. The product already knows part of it — which kinds of people each module holds data about, which outside services this installation is configured to call — and nobody can get it out. **Proposed (future):** one command prints a draft register for one organization. What the product can know is filled in from module declarations and configuration. What only the controller can know — who they are, their purposes, where each recipient processes — is left as a labelled blank. The output says "draft" throughout.

**Not in this spec:** a register the product stores, edits or signs off; the processor's own register for an operator hosting many tenants; a screen.

## 📝 Overview

> **Market reference.** Tools such as Fides and OneTrust generate a register from a data map and leave purpose and legal basis to be assigned by a person; Fides calls its output a "data map export" for that reason. GitLab publishes its sub-processor list from a maintained data file. Adopted: generate what is declared, mark what is not, never guess a legal basis. Rejected: asking each module to state a legal basis — the same module is used under consent by one tenant and under contract by another.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | What the product may assert | Categories of people and of data, what a module is for, which outside services are active for this organization | These are facts about code and configuration. |
| 2 | What it must not assert | The controller's identity and contacts, the purpose, whether a recipient is in a third country and under what safeguard, how long data should be kept | These are the controller's facts or decisions, or facts about a vendor the product cannot verify. All but the last are required by Art. 30(1) and are printed as blanks. |
| 3 | Legal basis | An optional blank | Art. 30(1) does not ask for it. Most controllers keep it beside the register, so the column is offered and marked optional. The program asked the contract to carry it; this spec declines, because the same module is used under consent by one tenant and under contract by another. |
| 4 | Where recipients come from | A `recipients` member that modules declare in `privacy.ts`, each with a way to say whether it is active | Four hand-picked providers would miss web-research adapters, the telemetry exporter, the external search host, an identity provider and backups. |
| 5 | Scope | One organization of a tenant per run | Integrations are enabled per organization, and organizations of one tenant may be separate legal entities. |
| 6 | Form | A command that writes Markdown or JSON to a file | A draft for a person to finish belongs in their document, not in the database. |
| 7 | Edition | OSS | ⚠ NEEDS HUMAN CONFIRMATION. The program's fallback places it in Enterprise. It reads only declarations, so it can live in either. |

## 📝 Problem Statement

- **What a module can be asked today.** Its info, features, custom entities, encryption maps and integrations are on the module registry (`packages/shared/src/modules/registry.ts:225-291`). Tables are not, and neither is the coverage backlog, which is a test-only file. The privacy contract adds data classes with subject kinds and actions. None of it says what a class is *for*, or what categories of data it holds in words a register uses.
- **What an integration declares.** An id, a title, a category, a hub, a provider key, a documentation address, its package, the vendor's name, its credentials and a health check (`packages/shared/src/modules/integrations/types.ts:179-201`). Not what data it receives.
- **Several recipients are not integrations at all.** The email provider is chosen by an environment variable or a tenant channel; the model provider by environment and tenant settings; embeddings by a stored setting; text extraction by a key's presence. None is on the module registry.
- **Retention has no stored value in OSS.** Retention sets take their window from whoever runs them; the pruners' and the access log's windows are environment variables of the server process, which a command run elsewhere may not share. Only the enterprise engine stores policies.
- **Integrations are scoped to an organization**, and a credential can also belong to one user (`packages/shared/src/modules/integrations/types.ts:1-3`; `integrations/lib/state-service.ts:33-45`).
- **Encryption maps are per-tenant rows** (`entities/data/entities.ts:276-288`); the doctor reads the environment only and builds no container.
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

The default export of `privacy.ts` gains an optional `recipients` list. Each entry has an id, a title, the vendor's name where there is one, the data categories it receives, and the DI key of a small function that says whether it is active for a given tenant and organization and, where known, which endpoint it calls. The owners declare them: the system email path, the assistant's model providers, embeddings, text extraction, web-research adapters, the telemetry exporter, the external search host, the identity provider, and each integration provider package.

An integration that declares nothing is still listed when it is enabled — state on and credentials present — with its data marked "not declared".

### The command

`mercato privacy register --tenant <id> --organization <id> --out <file> [--format md|json] [--locale <code>] [--force] [--no-fail]`

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
| Time limits for erasure | An enterprise retention policy for the class, where the engine is present | "No stored retention rule — controller to complete" |

**Tenant-defined data.** The names of the organization's custom entities and custom fields, read through the `entities` module's service, each marked "defined by the tenant — controller to classify".

**Recipients.** Every declared recipient that reports itself active for this organization, with the data categories it declares. For each: a blank for the country of processing and the safeguard relied on. Two fixed entries follow: the party hosting this installation, and tenant-configured webhook endpoints, by host name.

**Security measures.** For the tenant: whether field encryption is on and how many entities have encrypted fields, from the encryption service. For the process that ran the command, labelled as such: the encryption key policy and the search-index setting.

**Retention configured on this installation.** The pruners' and the access log's windows as this process sees them, labelled as such.

**What this draft does not cover.** Enabled modules with no `privacy.ts`; classes with no `register` block; recipients that declare no data. The table backlog is not printed, because a command cannot read it; the docs say where it is.

### Design decisions

| Decision | Rationale |
|---|---|
| Blanks are printed, not omitted | A register with no purpose or no controller looks complete and is not. |
| Recipients are what is configured, not what could be | A register lists actual recipients. |
| The draft lists what it cannot cover | It must state its own gaps, as far as a command can know them. |
| A fixed list of data categories | Free text would make two modules' "contact data" incomparable. |
| Nothing is stored | See assumption 4. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| A legal basis per data class | See assumption 3. |
| Four hand-picked providers for recipients | See assumption 4. |
| One run per tenant | See assumption 5. |
| A "region" on each integration | The product cannot verify it, and a wrong one is worse than a blank. |
| Generating at build time into the docs | The answer depends on the tenant's enabled integrations and settings. |
| A screen with an editable register | A document-management feature of its own. |

## 📝 Delta

### Capability: privacy-register-draft

#### ADDED Requirement: Draft register
The system SHALL produce, for a tenant, a draft register of processing from module declarations and installation configuration, and SHALL mark as incomplete every entry it cannot know.

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
- THEN it is not listed

##### Scenario: Gaps
- WHEN an enabled module has no privacy declarations
- THEN the document names it as not covered

##### Scenario: Tenant-defined fields
- WHEN the organization has a custom field
- THEN it is listed for the controller to classify

##### Scenario: Another organization's integration
- WHEN an integration is enabled only for another organization of the tenant
- THEN it is not listed

## 📝 Architecture

- **`packages/shared/src/modules/privacy.ts`**: the `register` block, the category list, the `recipients` member.
- **`privacy` module**: `lib/register/` — the collector and the two renderers — and the command.
- **Each owner of an outbound path**: its `recipients` entries and the function behind each.
- **`entities`**: a service method that lists an organization's custom entities and fields by name.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Collector → data classes and recipients | The registry | A module with none is named under "not covered" |
| Collector → "is this recipient active" | The declared function, resolved softly | Listed as "state not reported" |
| Collector → enabled integrations | The integrations module's state and credentials services, for the organization | Module disabled: the section says integrations could not be read |
| Collector → custom fields | The `entities` service | Section omitted, and said to be |
| Collector → encryption facts | The tenant encryption service | "Not reported" |
| Collector → enterprise retention policies | The engine's service, resolved softly | "No stored retention rule" |

## 📝 Data Models

None.

## 📝 API Contracts

```ts
// added to PrivacyDataClassDefinition
register?: {
  activity: string                              // locale key
  dataCategories: PrivacyDataCategory[]
  specialCategoriesPossible?: boolean
}

// added to the default export of privacy.ts
recipients?: Array<{
  id: string
  title: string
  vendor?: string
  receives: PrivacyDataCategory[]
  statusService: string                         // DI key
}>
```

- CLI `mercato privacy register`. It refuses to overwrite a file without `--force` and writes owner-only, as the contract's export does. Exit 0 when written; 2 when written with anything "not declared", unless `--no-fail` is given.
- JSON output, version 1: tenant, organization, generated-at, product version, controller blanks, activities, tenant-defined data, recipients, security, retention, not covered.
- All additive. The integration definition type is not changed.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A class of an enabled module that this organization has never used | Still listed: the register describes processing the organization can do, and the command does not count rows |
| A module disabled for the installation | Its classes and recipients are absent |
| A tenant override of the model provider | The tenant's provider is the active one |
| A provider configured by environment for every tenant | Listed for every organization, marked "installation-wide" |
| A credential that belongs to one user, such as a mailbox | The recipient is listed once, marked "per user" |
| The command run on a machine whose environment differs from the server's | Process-level facts are labelled "this process"; the docs say to run it where the server runs |
| Locale without translations | English |
| No class declares a `register` block yet | The document is mostly blanks, and exits 2 unless told not to |

## 📝 Migration & Backward Compatibility

Additive: one optional block on the data-class definition, one optional member of the convention file's default export, a service method on `entities`, a command, an output format. Nothing changes for an installation that never runs it.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | The command with the header, activities, tenant-defined data, security facts and the not-covered list; `register` blocks on the first three classes | Contract spec, Phase 1 |
| 2 | Recipients: the member, the owners' declarations, enabled integrations | — |

## 📋 Implementation Plan

### Phase 1
1. Add the `register` block and the category list; validate in the registry. Unit tests.
2. The collector for the header, activities, tenant-defined data, security facts and what is not covered. Unit tests with a fake registry.
3. The Markdown and JSON renderers, with the opening statement and the blanks. Snapshot tests.
4. The command, with `--force`, `--no-fail` and the file mode. Declare `register` on the three existing classes. Integration test TC-PRIVACY-REGISTER-001.

### Phase 2
1. Add `recipients` to the convention file and the registry. Unit tests.
2. Declarations and status functions, one PR per owner. Unit tests per owner: active, inactive, tenant override.
3. Enabled integrations for the organization, with and without a declaration. Unit tests.
4. Integration test TC-PRIVACY-REGISTER-002; docs: how to finish the draft; a note on the deployment docs page's third-party table that the same declarations can feed it.
5. Archive this Delta into `.ai/specs/capabilities/privacy-register-draft.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Modify |
| `packages/core/src/modules/privacy/{cli.ts,lib/register/*}` | Create / modify |
| `packages/core/src/modules/entities/lib/*` | Modify |
| `privacy.ts` and one small function in each owner of an outbound path | Create / modify |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-REGISTER-00{1,2}.spec.ts` | Create |

## 🧪 Integration Coverage

Both run the command for the test organization, as existing tests run commands, with JSON output, and remove the file.

| Test | Covers |
|---|---|
| TC-PRIVACY-REGISTER-001 | The document has the controller blanks; an activity for each registered class with its subject categories; purpose marked for the controller; a custom field created through the API for the test listed as tenant-defined; field encryption reported as it is for the test tenant |
| TC-PRIVACY-REGISTER-002 | An integration enabled through the API for the test organization appears among recipients; one that is installed and not enabled does not; the test disables what it enabled |

## 📝 Risks & Impact Review

#### The draft is filed as the register
- **Scenario**: A tenant submits the output unedited to an auditor.
- **Severity**: High
- **Affected area**: the tenant's accountability
- **Mitigation**: "Draft" in the title, the opening statement and every blank; a non-zero exit when anything is undeclared; the docs say what must be completed.
- **Residual risk**: A reader who ignores all of it.

#### A recipient is missing
- **Scenario**: Data leaves through a path that is neither an integration nor one of the four known providers.
- **Severity**: High
- **Affected area**: the recipients column
- **Mitigation**: Recipients are declared by their owners, not picked by this command. The deployment docs spec's check requires every workspace package to be either on the third-party table or declared as sending nothing out, and can be extended to require a `recipients` entry for each package on that table.
- **Residual risk**: Custom modules in an installation.

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
| Tenant scoping | Compliant | One tenant per run |
| Edition | Open | See assumption 5 |
| Integration coverage | Compliant | One test |

**Verdict:** approved as a design, subject to assumption 7.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions. Declines two things the program asked the contract to carry for this package — legal basis and processing location — because neither is a fact the product can know; the program is corrected with it.
- Revised after independent review. The run is per organization, because integrations are. Recipients come from declarations by their owners instead of four hand-picked providers. The retention and security columns no longer claim sources that do not exist: retention sets store no window, and process-level settings are labelled as such. The gaps list is reduced to what a command can know. Art. 30(1)'s actual contents are followed: the controller's identity and contacts and the third-country safeguards are added as blanks, and legal basis becomes an optional one. Tenant-defined custom fields and entities are listed. The command gains `--force` and `--no-fail`, and Phase 1 has an integration test.
