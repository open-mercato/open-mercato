# Privacy table coverage

> **Program:** package C5 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). Split from the verification-suite spec after its review; the scan and the end-to-end tests are in [`2026-11-16-privacy-verification-suite.md`](2026-11-16-privacy-verification-suite.md).
> **Builds on:** [`2026-11-16-privacy-data-class-contract.md`](2026-11-16-privacy-data-class-contract.md), and ships with its first phase. **Shares one declaration with** [`2026-11-16-tenant-exit-export.md`](2026-11-16-tenant-exit-export.md).
> **Verified at** `main` @ `08dada9624` by reading code and counting migration snapshots; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md

## 📝 TLDR

The privacy contract lets a module say "this is personal data and here is how to export and erase it". Nothing notices a module that says nothing: 345 tables exist and three data classes are specified. **Proposed (future):** every table is put in one of three places — covered by a data class, declared with a reason for not being covered, or on a backlog file. A test in each package fails when a table is in none of them. The backlog starts with nearly everything and is emptied by the program's coverage specs.

**Not in this spec:** checking that an erasure really removed a person (the verification-suite spec); scaffolding and guides for new modules (package G7).

## 📝 Overview

> **Market reference.** Data-mapping tools such as Fides and BigID start from an inventory in which every table is classified or explicitly waived. Type checkers and linters adopt strictness on old codebases with a baseline file of known gaps that is worked down. Adopted: both. Rejected: inferring personal data from column names alone, which is used here only as a second net.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | How a class says which tables it covers | A new optional `tables` list on the data-class definition, required by the check | The contract's definition names subjects and actions, not tables. |
| 2 | Tables no class covers | A `tables` map beside `dataClasses` in the same default export, one entry per table, giving the reason | One place per table. The exit-export spec adds its own facet to the same entry instead of a second list. |
| 3 | The 340 or so tables nobody has classified | A baseline file per package, with no numeric cap | A cap is one shared number that every parallel coverage change would conflict on, and it does not stop someone raising it. The file's diff is what a reviewer sees. |
| 4 | Where the list of tables comes from | Each module's migration snapshot | Exact, JSON, no database, no loaded ORM. Every module that owns entities has one. |
| 5 | Where the check runs | One thin test in each package that has entities, calling a helper on a test-only subpath of the shared package | A test in core cannot import enterprise code; a helper gives third-party authors the same check. |
| 6 | Edition | OSS, with the contract | ⚠ NEEDS HUMAN CONFIRMATION. The program's fallback places this package in Enterprise if the contract's handlers stay there. The check is a test, not a feature; it would move with them. |

## 📝 Problem Statement

- **The contract cannot express coverage.** A definition has an id, a handler, subject kinds and actions, and no table list.
- **Scale.** 57 migration snapshots describe 345 tables across nine packages.
- **A class reaches some data through another module's service.** The CRM person class covers the person's custom-field values, attachments and audit history through seams, not through its own tables (contract spec, CRM person sections; erasure spec, attachments and history seams). A rule that a class may only cover its own module's tables would leave `custom_field_values`, `attachments` and `action_logs` unclassifiable.
- **The generated registry reads only the default export of `privacy.ts`**, so every declaration must be a member of it.
- **Existing guards work the same way**: they read source or snapshots, with a hand-kept list and a written rationale (`packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts`; `hot-path-indexes.test.ts`).

## 📝 Proposed Solution

### Declarations

A data-class definition gains `tables`: the tables of its own module that its handler exports and erases.

The default export of `privacy.ts` gains a `tables` map for the module's other tables. Each entry has a `personalData` value, one of:

| Value | Meaning |
|---|---|
| `none` | Nothing about a person |
| `reference_only` | Ids of users or people and nothing else about them |
| `tenant_configuration` | Settings, not records about people |
| `credential` | Authentication material; removed with its owner, never exported |
| `retention_bounded`, with the setting or retention set that bounds it | Rows are removed by age |
| `covered_by_class`, with a class id of the same module | Child rows handled through that class |
| `covered_via_seam`, with the seam's name | The table belongs to a module that serves other modules' classes: custom-field values, attachments, audit history |

### The rule

Every table in a module's snapshot is in exactly one place: a class's `tables`, the `tables` map, or the package's baseline file.

The helper fails when:

1. a table is in none of the three;
2. a table is on the baseline and also declared;
3. a declaration, or a baseline entry, names a table that is in no snapshot of that module or package;
4. a class lists a table of another module;
5. a table declared `none`, `reference_only` or `tenant_configuration` has a column whose name contains, as a whole word, `email`, `phone`, `first_name`, `last_name`, `full_name`, `display_name`, `address`, `ip`, `user_agent` or `birth` — unless the entry lists that column with a note;
6. a table declared `credential` is not excluded or redacted in the exit-export facet, once that facet exists.

### The baseline

One JSON file per package, generated once: every table minus those the first three classes cover and those the first reviewed pass declares. Each coverage spec in the program removes its tables in the same change. The program is complete for this package when every baseline is empty.

### Design decisions

| Decision | Rationale |
|---|---|
| Snapshots, not source scanning | They list tables and columns exactly. |
| One entry per table, shared with the exit export | Two lists about the same table drift. |
| A reason for seams | See the problem statement. |
| No cap | See assumption 3. |
| The column-name rule applies only to "nothing here" declarations | It is a check on a claim, not a classifier. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Require every table to be classified now | 340 decisions in one change. |
| Infer personal data from column names | Finds a few dozen tables and misses every note and payload. |
| A named export per declaration kind | The registry would not load it. |
| Run the check as a CI command against a live registry | A pipeline change, and third-party authors could not run it as a unit test. |

## 📝 Delta

### Capability: privacy-table-coverage

#### ADDED Requirement: Table coverage
The system's test suite SHALL fail when a table is neither covered by a data class, nor declared with a reason, nor on the package's baseline.

##### Scenario: A new table
- WHEN a module adds a table and declares nothing
- THEN the package's coverage test fails and names the table

##### Scenario: A lazy declaration
- WHEN a table with an `email` column is declared as holding nothing about a person without acknowledging the column
- THEN the test fails

##### Scenario: Declared and still on the baseline
- WHEN a table is declared and its baseline entry is left behind
- THEN the test fails

##### Scenario: A shared store
- WHEN the attachments module declares its table as covered through its seam
- THEN the test passes for that table

## 📝 Architecture

- **`packages/shared/src/modules/privacy.ts`**: `tables` on the definition; the `tables` map and its entry type; registry validation.
- **`packages/shared/src/lib/privacy/testing/coverage.ts`**, on a test-only export subpath: reads the snapshots under a package's modules directory, loads each module's `privacy.ts`, applies the rule. It also exports the snapshot reader that the exit-export guards use.
- **Each package with entities** — `core`, `enterprise`, `ai-assistant`, `checkout`, `documents`, `onboarding`, `scheduler`, `webhooks`, and the app's own modules: one test file and one baseline file.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Helper → a module's declarations | Requires its `privacy.ts` under the test runner | No file: every table must be on the baseline |
| Exit-export guards → snapshots | The same reader | — |

## 📝 Data Models

None. Baseline files are JSON arrays of table names.

## 📝 API Contracts

```ts
// added to PrivacyDataClassDefinition
tables?: string[]

// added to the default export of privacy.ts
tables?: Record<string, {
  personalData:
    | { kind: 'none' | 'reference_only' | 'tenant_configuration' | 'credential'
        note?: string; columns?: string[] }
    | { kind: 'retention_bounded'; boundedBy: string }
    | { kind: 'covered_by_class'; classId: string }
    | { kind: 'covered_via_seam'; seam: string }
  // the exit-export spec adds an `export` member to the same entry
}>
```

- `@open-mercato/shared/lib/privacy/testing` — `assertPrivacyTableCoverage({ modulesRoot, baselinePath })` and `readModuleSnapshots(modulesRoot)`.
- Additive to a convention that is not yet released.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A module with a snapshot and no `privacy.ts` | All its tables must be on the baseline |
| A table renamed | The old name fails rule 3 wherever it is |
| A table created at run time and absent from every snapshot, such as the vector index table | Outside this check. The verification suite names such stores explicitly |
| A package whose tests cannot load a module's `privacy.ts` because of an import with side effects | `privacy.ts` must import types and constants only; the helper reports the failing file |
| A third-party module | Its author calls the helper with an empty baseline |

## 📝 Migration & Backward Compatibility

Additive: one optional field, one optional member, a test helper, tests, baseline files. The first three classes gain their `tables` in the contract spec's implementation.

## 📋 Implementation Plan

1. Add `tables` to the definition and the `tables` map to the default export; validate both in the registry. Unit tests.
2. The helper and the snapshot reader, with unit tests for each of the six failures.
3. One test and one generated baseline per package. Record each starting count here.
4. A first reviewed pass: declare tables that hold only ids, timestamps and flags, proposed by a script and read by a person; declare the three shared stores as seams. Shrink the baselines.
5. Document the declaration in `.ai/docs/module-development.md` and the module scaffold.
6. Archive this Delta into `.ai/specs/capabilities/privacy-table-coverage.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts`, `packages/shared/src/lib/privacy/testing/*`, `packages/shared/package.json` (export subpath) | Modify / create |
| `packages/*/src/__tests__/privacy-table-coverage.test.ts`, `packages/*/privacy-coverage-baseline.json` | Create |
| `privacy.ts` in modules declared in the first pass | Create / modify |
| `.ai/docs/module-development.md` | Modify |

## 🧪 Integration Coverage

None: this is a set of unit tests with no API or UI path.

## 📝 Risks & Impact Review

#### The baseline becomes permanent
- **Scenario**: Nobody owns the remaining tables.
- **Severity**: High
- **Affected area**: the program's claim of coverage
- **Mitigation**: The program closes only when baselines are empty; each coverage spec removes its tables in the same change.
- **Residual risk**: A long tail of tables in packages no coverage spec names.

#### A declaration is wrong
- **Scenario**: A table is declared as holding nothing about a person and holds a free-text note about one.
- **Severity**: High
- **Affected area**: export and erasure completeness
- **Mitigation**: The column-name rule catches named columns; the verification suite's scan catches a copy of a fixture's values wherever a fixture reaches.
- **Residual risk**: Free text in a table no fixture writes to.

#### Tables are added to the baseline to get a change merged
- **Scenario**: A new table is put on the backlog instead of being declared.
- **Severity**: Medium
- **Affected area**: new modules
- **Mitigation**: The baseline's diff is in the pull request; the review checklist gains a rule that it may only shrink.
- **Residual risk**: A reviewer who does not look.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for the convention file.

| Rule | Status | Notes |
|---|---|---|
| Additive contract change | Compliant | An optional field and an optional member |
| No pipeline change | Compliant | Runs in the existing unit suites |
| Module isolation | Compliant | A class lists only its own module's tables; shared stores declare themselves |
| Edition | Open | See assumption 6 |

**Verdict:** approved to ship with the contract's first phase, subject to assumption 6.

## Changelog

### 2026-11-16
- Split from the verification-suite spec after its independent review, with that review's corrections: a reason for tables reached through another module's seam, without which the shared stores could never leave the baseline; one per-table entry shared with the exit export instead of two lists; no numeric cap; declarations as members of the default export, which is all the registry loads; the helper on a test-only subpath; corrected counts.
