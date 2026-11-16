# Fulltext index: keep encrypted fields out

> **Program:** package B4 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), split from [`2026-11-16-search-index-pii-protection.md`](2026-11-16-search-index-pii-protection.md). Related: #8134, #7872, #8135.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. Meilisearch was not started.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md
Extends: .ai/specs/2026-07-24-search-architecture-clarification-and-evolution.md

## 📝 TLDR

When Meilisearch is configured, fields that are encrypted in the database are sent to it as plaintext. A setting that keeps them out exists, is off by default, and misses some of them: a company's name and description still go in. **Proposed (future):** the setting is made correct and tested now. One minor later it becomes the default, at which point fulltext search stops matching on encrypted fields altogether and people are found through the token index instead.

**Not in this spec:** the token and vector indexes (the sibling spec); securing Meilisearch itself, where one API key covers every tenant's index.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Default | Fix and test now; flip one minor later, with an explicit `false` still honoured | ⚠ NEEDS HUMAN CONFIRMATION. The architecture spec already calls plaintext personal data in Meilisearch a regression, which argues for flipping at once. Flipping removes fulltext matching on names, so it gets a release of notice. |
| 2 | How a document names the other entities whose encrypted fields it carries | A new optional field in the entity's search configuration | A company document is built from two tables. Guessing from field names would be wrong in both directions. |
| 3 | Installations without Meilisearch | Nothing changes | The setting has no effect there. |

## 📝 Problem Statement

- **The default sends plaintext.** `SEARCH_EXCLUDE_ENCRYPTED_FIELDS` defaults to off (`packages/search/src/di.ts:50-57`). There is one index per tenant, one API key for all of them, and every attribute is searchable, including the result title.
- **The setting has a gap** (read from code, not run). The resolver looks up encrypted fields by the document's own entity id (`packages/search/src/lib/encryption-map-resolver.ts:89-103`). A company's `display_name` and `description` are encrypted under the `customer_entity` map, and the company whitelist includes both (`packages/core/src/modules/customers/search.ts:825-834`; `customers/encryption.ts:19-28`), so they still go in.
- **It ignores maps declared in code.** The tenant encryption service merges a module's declared default map into what the tenant has stored; the fulltext resolver reads only the stored rows.
- **With the setting on, the driver is rebuilt on every request** (`packages/search/src/di.ts:160-176`), because the resolver holds a request-scoped database handle.
- **No test exercises document preparation with the setting on.**
- **What the flip costs.** Titles are blanked at index time and filled in again at read time (`fulltext/drivers/meilisearch/index.ts:157-170`; `presenter-enricher.ts:399-400`), so results still show names. What is lost is every fulltext match on an encrypted field: typo tolerance, word-order tolerance and ranking for people and companies by name.

## 📝 Proposed Solution

1. The resolver unions the declared default map with the stored one.
2. An entity's search configuration may list other entity ids whose maps also apply to its document. `customers` declares it for the company and person documents.
3. The driver is built once per process. The resolver takes a database handle per call and caches the resolved field set per tenant and entity for a short time.
4. A unit test covers document preparation with the setting on, the company case included.
5. One minor later the default becomes on. Installations that had it off must reindex fulltext for the change to take effect on existing documents.

| Alternative | Why rejected |
|---|---|
| Flip the default now | See assumption 1. |
| Encrypt before sending | Meilisearch cannot search ciphertext; the result is the same as exclusion with more moving parts. |
| Infer related maps from field names | A `display_name` on one entity is not the `display_name` on another. |

## 📝 Delta

### Capability: search-index-protection

#### MODIFIED Requirement: Fulltext exclusion of encrypted fields
The system SHALL, when the exclusion setting is on, keep out of the fulltext index every field encrypted under the document's own map, a declared default map, or the map of an entity its search configuration names.

##### Scenario: Company document
- WHEN the setting is on and a company is indexed
- THEN its display name and description are not in the fulltext document

##### Scenario: Declared default with no stored row
- WHEN a tenant has no stored map for an entity whose module declares one
- THEN the declared fields are excluded

##### Scenario: Result display
- WHEN a person is found through another strategy with the setting on
- THEN the result still shows their name

Frozen by: `packages/search/src/__tests__/meilisearch-prepare-document.characterization.test.ts` (to be added; no test covers this path today)

## 📝 Architecture

- `packages/search/src/lib/encryption-map-resolver.ts`: default maps, related entities, per-call handle, short cache.
- `packages/search/src/di.ts`: one driver per process.
- The search configuration type in `packages/shared`: one optional field.
- `packages/core/src/modules/customers/search.ts`: declares the related entity.

## 📝 Data Models

None.

## 📝 API Contracts

- **Search configuration** gains an optional list of related entity ids. Additive.
- **`SEARCH_EXCLUDE_ENCRYPTED_FIELDS`** is unchanged now. Its default changes one minor later; `false` keeps today's behaviour.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| A map changes while the field set is cached | The old set applies until the cache entry expires; new documents written in that window may include a newly mapped field. A fulltext reindex of the entity corrects them, and the map-change note says so |
| A related entity's module is disabled | Its map is absent; the document's own map still applies |
| The setting is turned on for an existing index | Existing documents keep their plaintext until a fulltext reindex |
| Typo in a person's name after the flip | Not found through fulltext; found by exact word or prefix through tokens |

## 📝 Migration & Backward Compatibility

| Change | Route |
|---|---|
| Exclusion covers default and related maps | Defect fix under an opt-in setting |
| Driver built once | Internal |
| Exclusion on by default | Ordinary protocol: announced now, flipped one minor later, explicit `false` honoured |

`UPGRADE_NOTES.md` now: what the setting does, that turning it on needs a fulltext reindex, and the coming default. At the flip: the reindex step and what search loses.

## 📋 Implementation Plan

1. **Characterize** document preparation with the setting on, including a company whose name stays in the document today. Commit alone.
2. Union declared default maps in the resolver. Unit test.
3. Add the related-entities field and declare it in `customers`. Update the characterization test: the company's name and description are gone.
4. Build the driver once; per-call handle; cache. Unit test that two requests share one driver and that a second tenant gets its own field set.
5. `UPGRADE_NOTES.md`, the search docs page, a doctor check that reports the setting off while Meilisearch is configured, and the tracking issue for the default.
6. Archive this Delta if the capabilities directory has been adopted by then.

| File | Action |
|---|---|
| `packages/search/src/lib/encryption-map-resolver.ts`, `packages/search/src/di.ts`, `packages/search/src/fulltext/drivers/meilisearch/index.ts` | Modify |
| The search configuration type in `packages/shared`; `packages/core/src/modules/customers/search.ts` | Modify |
| `packages/search/src/__tests__/meilisearch-prepare-document.characterization.test.ts` | Create |
| `UPGRADE_NOTES.md`, search docs | Modify |

## 🧪 Integration Coverage

None: the integration environment has no Meilisearch instance. The behaviour is covered by unit tests on document preparation, and the existing search integration tests must pass unchanged.

## 📝 Risks & Impact Review

#### Fulltext matching on names is lost
- **Scenario**: After the default flips, a misspelled or reordered name finds nobody.
- **Severity**: Medium
- **Affected area**: global search for people and companies
- **Mitigation**: One minor of notice; exact and prefix search stay through tokens; the setting can be turned off explicitly.
- **Residual risk**: A real loss of function for installations that keep the new default.

#### A document still carries an encrypted field
- **Scenario**: An entity's document is built from another entity's fields and nobody declared it.
- **Severity**: Medium
- **Affected area**: the fulltext index
- **Mitigation**: The step lists every first-party search configuration whose document reads another entity, and declares each.
- **Residual risk**: Third-party modules.

#### Old plaintext stays in the index
- **Scenario**: The setting is turned on and no reindex follows.
- **Severity**: Medium
- **Affected area**: installations that enable it late
- **Mitigation**: The upgrade note and the doctor check.
- **Residual risk**: An operator who reads neither.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`. Not reviewed in full: `packages/search/AGENTS.md`.

| Rule | Status | Notes |
|---|---|---|
| Behaviour-changing default follows the protocol | Compliant | Flip deferred one minor |
| Additive contract change | Compliant | One optional field |
| Integration coverage | N/A | No Meilisearch in the test environment |

**Verdict:** approved for the fix. The default flip waits on assumption 1.

## Changelog

### 2026-11-16
- Split from the search-index protection spec on its reviewer's advice: it shares no reindex with the token and vector work. Carries that review's corrections: declared default maps, the related-entities field stated as a contract addition, a mechanism for building the driver once, and the loss on flip described as all fulltext matching on encrypted fields.
