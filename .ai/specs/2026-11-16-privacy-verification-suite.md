# Privacy verification suite

> **Program:** package G6 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593). The program's Integration Coverage table is this spec's acceptance list.
> **Builds on:** [`2026-11-16-privacy-subject-erasure.md`](2026-11-16-privacy-subject-erasure.md), [`2026-11-16-privacy-table-coverage.md`](2026-11-16-privacy-table-coverage.md) for the table declarations, and the table reader of [`2026-11-16-tenant-exit-export.md`](2026-11-16-tenant-exit-export.md).
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-11-16-privacy-subject-erasure.md

## 📝 TLDR

The program's central claim is that after an erasure the person is gone, apart from what the law says to keep. Today the only check of that claim would be each handler's own tests, which test what the handler's author thought of. A copy of a name in another module's table, in a search index or in a queue is outside any one handler's view. **Proposed (future):** an independent scan that reads every store it can reach for a tenant, decrypting as it goes, and reports where given values occur; and an end-to-end test that plants random markers on a person, erases the person, scans, and fails if a marker is found anywhere the data classes did not declare as retained.

**Not in this spec:** the coverage check for tables (its own spec); the handlers; an external audit (package G8).

## 📝 Overview

> **Market reference.** Privacy tooling such as Fides and BigID verifies an erasure by re-scanning after the request and confirming nothing matches. Security teams test secret handling the same way, with "canary" values that can only have come from the test. Adopted: a post-erasure scan for planted values. Rejected: asking the handlers again, which checks them against themselves.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | The scan as a command | In the `privacy` module, refusing in production unless a flag is passed, printing locations and never values | ⚠ NEEDS HUMAN CONFIRMATION. It is a tool that reads everything. Shell access already allows SQL and the export command; this lowers the effort. An operator may also want it to answer "is this address anywhere". |
| 2 | What counts as allowed to remain | Only what a data class declares as retained, by table and column | A list kept in the test would drift from the classes; the program says the test reads the set from the registry. |
| 3 | A store the scan cannot read | It is named in the output as not scanned, and the test fails unless the test itself waives that store with a reason | A scan that silently skips a store is the blind `LIKE` this spec exists to replace. |
| 4 | How it reads tables | Through the same reader the exit export uses | One implementation of "every row of a tenant, decrypted, including child tables and custom fields". |
| 5 | Edition | OSS, with the erase run | ⚠ NEEDS HUMAN CONFIRMATION. The program's fallback places this package in Enterprise. |

## 📝 Problem Statement

- **Handler tests cannot find what the handler forgot.**
- **Encrypted columns hide leftovers from SQL.** A `LIKE` over the database finds nothing in an encrypted column whether or not the value is there.
- **Some stores are not tables in any snapshot.** The vector index table is created at run time (`packages/search/src/vector/drivers/pgvector/index.ts:201`). Meilisearch is a separate service. The response cache is switched on in the integration environment. Queue jobs are in Redis or a file.
- **Encrypted custom-field values do not go through encryption maps**; they have their own flag and their own decrypt function (`packages/shared/src/lib/encryption/customFieldValues.ts:181-199`).
- **About twenty tables have no tenant column** and are reached only through a parent, which the exit-export spec makes each module declare.
- **The erase run reports "retained" per section**, and nothing yet maps a section to a table and column.
- **Integration tests can run commands and query the database**, and the test harness shares the application's database and encryption key (`packages/cli/src/lib/testing/integration.ts:2191, 2282`). A new tenant has no encryption-map rows until they are seeded.

## 📝 Proposed Solution

### 1. Retained declarations

A data-class definition gains `retained`: a list of table, columns and reason for everything its erase may leave behind — a fiscal document's number, an audit entry under its own retention, free text the class declared it keeps. A class that serves others through a seam declares what the seam leaves.

### 2. The scan

`mercato privacy scan-values --tenant <id> --value <text> [--value …] [--out <file>] [--allow-production]`

| Store | How | If it cannot |
|---|---|---|
| Tables with a tenant column, and child tables declared by their module | The exit export's reader: keyset batches, decrypted | — |
| Custom-field values and custom-entity records | Through the `entities` module's reader for them | — |
| Token index | The hash of each value's tokens, looked up for the tenant | Reported as not scanned when no key is configured in the scanning process |
| Vector index | A function the search package adds for this: display columns of the tenant's rows, decrypted | Not scanned when the driver is not pgvector |
| Fulltext index | A search for each value through the search service | Not scanned when no fulltext service is configured |
| Local queue files | Read when unsealed | Not scanned when sealed or when the strategy is Redis |
| Response cache, Redis | — | Always reported as not scanned |

It searches each string and JSON value for each given text, case-insensitively. It prints, per match, the store, the table or index, the column and the row id — never the value or its surroundings — and then the list of stores scanned and not scanned. It refuses in production without the flag and writes an audit entry when it runs there.

### 3. The end-to-end tests

One suite in the `privacy` module.

**Erase everywhere.**

1. Seed encryption maps for a fresh tenant, so that stored values are really encrypted.
2. Create a person whose name, email, phone and a note each carry a random single-token marker, with a record in every module that has a data class for the person's kind.
3. Scan. Every table listed in those classes' `tables` must show at least one marker; a table that does not is a fixture gap, and the test fails naming it. A class may mark a table as holding no searchable text.
4. Export; every class has a non-empty section.
5. Erase.
6. Scan again. Every location must be in the classes' `retained` declarations. Every store reported as not scanned must be on the test's short list of waived stores.
7. Read the person's former records through the API, to cover the response cache the scan cannot read: nothing returns a marker outside the retained set.

**Cross-tenant.** The same markers planted in a second tenant are all still found there afterwards, and resolving the first tenant's identifier never returns the second's subject.

**Optional modules absent.** A unit-level run of the erase with the scheduler, the search module and the enterprise guard unregistered completes.

### Design decisions

| Decision | Rationale |
|---|---|
| The scan decrypts | Otherwise it would pass on exactly the data that matters. |
| Locations only | Its output must be safe to paste into a ticket. |
| Random single-token markers | A match can only come from the fixture, and a token cannot be split by a tokenizer. |
| A scan before erasing | Without it the test passes for every table the fixture never wrote to. |
| Retained locations come from the classes | See assumption 2. |
| "Not scanned" is a result | See assumption 3. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Verify by calling `discover` afterwards | It asks the handlers that did the erasing. |
| A SQL `LIKE` across the database | Blind to encrypted columns. |
| A second table reader for the scan | Two implementations of the same hard thing. |
| Keep the retained list in the test | See assumption 2. |

### Known limits

- A value split across two columns, compressed, or stored as a hash other than a search token is not found.
- Redis and the response cache are not scanned. The test covers the cache indirectly, through the API, and names Redis as waived.
- The suite's runtime grows with every class.

## 📝 Delta

### Capability: privacy-verification

#### ADDED Requirement: Independent scan
The system SHALL provide a command that reports every reachable location in which a given value occurs for a tenant, reading encrypted data in clear, without printing the value, and SHALL list the stores it could not read.

##### Scenario: Encrypted column
- WHEN the value is in an encrypted column
- THEN the location is reported

##### Scenario: Encrypted custom field
- WHEN the value is in an encrypted custom-field value
- THEN the location is reported

##### Scenario: A store it cannot read
- WHEN no fulltext service is configured
- THEN the output names the fulltext index as not scanned

##### Scenario: Production
- WHEN the command runs in production without the flag
- THEN it refuses

#### ADDED Requirement: Erasure verification
The system's integration suite SHALL verify that after an erasure the subject's planted values occur only in locations a data class declared as retained.

##### Scenario: A forgotten copy
- WHEN a module keeps a copy of the subject's email that no class erases or declares retained
- THEN the test fails and names the table and column

##### Scenario: A fixture gap
- WHEN a class lists a table the fixture never wrote a marker to
- THEN the test fails before erasing and names the table

##### Scenario: A store nobody looked at
- WHEN the scan reports a store as not scanned and the test has not waived it
- THEN the test fails

## 📝 Architecture

- **`packages/shared/src/modules/privacy.ts`**: `retained` on the definition.
- **`privacy` module**: `lib/valueScan.ts`, the command, the end-to-end tests. It uses `lib/tenantExport`'s reader.
- **`entities`**: the reader for custom-field values and custom-entity records, as the exit-export spec requires of it.
- **`packages/search`**: one function that returns a tenant's vector display fields, decrypted; one that checks token hashes.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Scan → tables | The exit export's reader | That spec's second phase not landed: the scan cannot be built |
| Scan → search stores | The search package's functions, resolved softly | Reported as not scanned |
| Test → retained set | The data-class registry | A class with no declaration: anything it leaves fails the test |

## 📝 Data Models

None.

## 📝 API Contracts

```ts
// added to PrivacyDataClassDefinition
retained?: Array<{ table: string; columns: string[]; reason: string }>
noSearchableText?: string[]        // tables the fixture need not hit
```

- CLI `mercato privacy scan-values`. Exit 0 with no match, 3 with matches, 1 on refusal. The output file is JSON: matches, stores scanned, stores not scanned.
- Additive to a contract that is not yet released.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| The scanning process has a different lookup secret from the app | Token hashes would not match; the scan reports the token index as not scanned when it cannot verify a known token |
| A very large tenant | Slow by design |
| A marker in a column of a table with no tenant and no declared parent | The reader refuses to start, as the exit export does |
| Asynchronous cleanup — search index, attachments — not finished when the scan runs | The test drains the queues through the integration queue helper before scanning |
| A class added later | The fixture must gain a record for it, or step 3 fails |
| The value is shorter than the token minimum | The token index check is skipped for it and says so |

## 📝 Migration & Backward Compatibility

Additive: two optional fields, a command, two small functions in the search package, tests.

## 📋 Phasing

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | The scan command | Exit-export spec, Phase 2 |
| 2 | The end-to-end tests | Erasure spec, Phase 3 |

## 📋 Implementation Plan

### Phase 1
1. The scan over the reader: matching, locations only, the scanned and not-scanned lists. Unit tests with an encrypted column, an encrypted custom field, a JSON column, a child table.
2. The search package's two functions; token, vector and fulltext checks. Unit tests, including each "not scanned" case.
3. Queue files; the command, the production gate, the audit entry.

### Phase 2
1. Add `retained` and `noSearchableText`; declare them for the classes that exist.
2. The erase-everywhere test, in the order above.
3. The cross-tenant and optional-modules cases.
4. State the program's closing rule in the program spec: baselines empty, suite green.
5. Archive this Delta into `.ai/specs/capabilities/privacy-verification.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/modules/privacy.ts` | Modify |
| `packages/core/src/modules/privacy/{cli.ts,lib/valueScan.ts}` | Create / modify |
| `packages/search/src/…` (two functions) | Create |
| `packages/core/src/modules/privacy/__integration__/TC-PRIVACY-VERIFY-00{1,2}.spec.ts` | Create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-PRIVACY-VERIFY-001 | Erase everywhere, as described. Fixtures through the API; encryption maps seeded for the tenant first; the scan and the erase run as commands against the shared database and key; queues drained before each scan; survivors removed in teardown |
| TC-PRIVACY-VERIFY-002 | Cross-tenant |

The scan's rules are unit tests.

## 📝 Risks & Impact Review

#### The scan is misused
- **Scenario**: Someone with shell access uses it to look for a person.
- **Severity**: Medium
- **Affected area**: any tenant
- **Mitigation**: The production gate and the audit entry make this use visible; output is locations only.
- **Residual risk**: It lowers the effort of a search an operator could already do.

#### The test passes while data remains
- **Scenario**: A copy sits in a store the scan cannot read, or in a form it cannot match.
- **Severity**: High
- **Affected area**: the program's central claim
- **Mitigation**: Every store is reported as scanned or not; unwaived gaps fail; the cache is covered through the API; the limits are written down.
- **Residual risk**: Redis, and hashed or transformed copies.

#### The suite is slow or fragile
- **Scenario**: A fixture in every module and two full scans take minutes and fail on an unrelated module's change.
- **Severity**: Medium
- **Affected area**: the integration suite
- **Mitigation**: A dedicated tenant; markers that cannot collide; a failure names the table and column.
- **Residual risk**: Runtime grows with every class added.

#### "Retained" becomes a dumping ground
- **Scenario**: A failing location is declared retained to make the test pass.
- **Severity**: Medium
- **Affected area**: erasure completeness
- **Mitigation**: Each declaration needs a reason and is in the class's own file, where its owner reviews it.
- **Residual risk**: A weak reason accepted in review.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`.

| Rule | Status | Notes |
|---|---|---|
| Additive contract change | Compliant | Optional fields |
| Modules do not read each other's tables | Depends | On the ruling the exit-export spec asks for; the scan uses that spec's reader and nothing else |
| Integration tests self-contained | Compliant | Own tenant, own fixtures, teardown |
| Never expose cross-tenant data | Compliant | One tenant per scan; a test checks the boundary |
| Edition | Open | See assumption 5 |

**Verdict:** approved as a design. Phase 1 waits for the exit-export spec's reader and its ruling, and for assumption 1; Phase 2 follows the erasure spec.

## Changelog

### 2026-11-16
- Written autonomously with resolved assumptions, together with the coverage check.
- Revised after independent review, and the coverage check moved to its own spec. Retained locations are now declared by the data classes instead of listed in the test. The scan names every store as scanned or not scanned, and an unwaived gap fails the test: the first draft was blind to encrypted custom fields, the run-time vector table, the fulltext service, the cache and sealed or remote queues. The test scans before erasing as well as after, so that a table the fixture never wrote to cannot pass. The scan reuses the exit export's reader. Encryption maps are seeded for the test tenant so that "encrypted" is true.
