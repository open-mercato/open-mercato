# Blocklisted fields in the stored index document

## TL;DR

`isSearchFieldBlocklisted()` governs what is **tokenised** — the per-field token
path and the `search_text` aggregate (#4624). Neither of the two functions that
build an index document consults it, so a blocklisted column is copied into
`entity_indexes.doc` verbatim and stored there in full. With the default
blocklist that means `doc->>'password_hash'` is the bcrypt verifier and
`doc->>'token'` is the session token's HMAC digest (tokens are hashed at rest since
#1465), for every entity type that stays indexed.
`stripBlocklistedDocFields()` removes them at both builders, before encryption
runs.

## Overview

- **Changed**: `packages/shared/src/lib/search/config.ts` — new
  `stripBlocklistedDocFields()`, built on the existing
  `isSearchFieldBlocklisted()`
- **Changed**: `packages/core/src/modules/query_index/lib/document.ts` —
  `buildIndexDocument()` strips the base row; the search config is now resolved
  once per call instead of once per call *and* once inside
  `attachAggregateSearchField()`
- **Changed**: `packages/core/src/modules/query_index/lib/indexer.ts` —
  `buildIndexDoc()` strips the merged base sources
- **Not touched**: `isSearchFieldBlocklisted()` itself, the `search_text`
  aggregate, `buildSearchTokenRows()`, the `entity_indexes` schema, every
  read path. No migration.

## Problem statement

**The blocklist stops at the tokens.** `buildIndexDocument()` opens by copying
the base row:

```ts
const doc: Record<string, unknown> = {}
for (const [key, value] of Object.entries(baseRow)) {
  doc[key] = value
}
```

and `buildIndexDoc()` — the event path taken by every ordinary write — does the
same over its merged sources. `attachAggregateSearchField()` then filters what
reaches `search_text`, and `buildSearchTokenRows()` filters what reaches
`search_tokens`. Nothing filters `doc`. The value is stored.

This is a **general** gap, and it is not the same defect as #5728: it applies to
every entity type that is legitimately indexed. `api_keys:api_key.key_hash`,
`auth:user.password_hash` and `messages:message.external_email_hash` all sit in
`entity_indexes.doc` on a current `develop`, unless the entity happens to
declare payload encryption.

The framework's own configs show the intent being missed. `checkout` declares
`excluded: ['passwordHash', …]` on both its search entities and
`customer_accounts` declares `excluded: ['password_hash', 'email_hash']` — the
authors said plainly that these must not be indexed, and they are stored anyway.

**Severity is moderate, and stated precisely: this is defence in depth, not a
live read.** The query engine does not serve a base column out of `doc`
(below). The reason to fix it is that a credential column is projected into a
second table whose access controls are not the ones the source table was given,
and no future reader of `entity_indexes` can be relied on to keep refusing it.

One read path already does not refuse it. `packages/search`'s
`extractFallbackPresenter()` is used for any entity with no `search.ts` config;
its `findAnyStringValue()` walks the document and returns the first string under
200 characters that is not an id or a timestamp. For an entity whose columns are
a credential and some ids, that is the credential — rendered as the title of a
global-search result.

## Solution

`stripBlocklistedDocFields(doc, config)` in
`packages/shared/src/lib/search/config.ts`, beside the matcher it calls. It is
applied at both builders, on the base row, before custom fields and translations
are merged in and before `encryptIndexDocForStorage()` runs.

**Both builders, because only one of them goes through `buildIndexDocument()`.**
`upsertIndexBatch()` (batch and reindex) does; `buildIndexDoc()` builds its own
document and only borrows `attachAggregateSearchField()`. Stripping the batch
path alone would give a reindex that removes the column and an ordinary write
that puts it straight back.

**Before encryption, deliberately** — so encryption sees exactly the document
that gets stored. Stripping afterwards would seal a credential and then delete
the sealed copy, making the ordering silently dependent on which step ran last.

An earlier draft justified the ordering differently, claiming that
`encryptIndexDocForStorage()` re-injects each encryption rule's `hashField`
(`auth:user.email_hash`, `messages:message.external_email_hash`) so a ruled
lookup hash survives the strip. **That is not what happens.** `encryptFields()`
skips a value that already decrypts under the current DEK, and that `continue`
sits before the `hashField` block:

```ts
// packages/shared/src/lib/encryption/tenantDataEncryptionService.ts:413
if (isEncryptedWithDek(value, dek)) continue
…
if (rule.hashField) { … }   // never reached on the skip
```

In steady state the base column IS already ciphertext — the encryption
subscriber encrypts on flush and `buildIndexDoc()` reads the base row raw — so
the skip is the normal path, and a blocklisted `*_hash` is absent from the
document for good. That outcome is harmless, which is why it is recorded rather
than fixed: strict equality on an encrypted field is documented to go through
the base table's deterministic `*_hash` column
(`packages/shared/src/lib/query/engine.ts`), not through `entity_indexes.doc`,
and that column is untouched. `search-index-doc-blocklist` coverage pins the
real outcome so the two cannot drift apart again.

### Two exemptions

**`cf:` and `l10n:` keys are kept.** A base column is re-read from the base
table on every query, so dropping it from the document costs nothing. Custom
fields and translations are the opposite: the document is their only store, and
the engine reads them straight back out of it via
`coalesce(doc -> 'cf:<key>', doc -> '<key>')`. Stripping `cf:password_hint`
would blank that column in every list view configured to show it. They are
excluded from `search_text` and from `search_tokens` either way, which is the
exposure that matters. Both call sites strip before merging those keys in, so
the guard makes that ordering explicit rather than load-bearing.

**Only the global blocklist applies — the entity-scoped entries do not strip.**
This is the one deliberate narrowing, and it is not an oversight in the "one
matcher" rule: the strip calls `isSearchFieldBlocklisted(key, null, config)`, so
there is no second list and no second `includes()` test, only an explicit
decision about scope.

The two halves of the config mean different things.
`DEFAULT_BLOCKLIST = ['password', 'token', 'secret', 'hash']` is a secrecy list.
The per-entity entries were added for **volume**: `parseFieldBlocklist`'s own
docblock gives `customers:customer_interaction@body` as the motivating recipe —
keep a large free-text column out of the token index while the same-named column
stays indexed elsewhere.

That column is read back out of `doc`. `packages/core/src/modules/customers/search.ts`
builds an interaction's search subtitle from `snippet(ctx.record.body)`, and
`packages/search`'s presenter enricher calls `formatResult` with `record` set to
the stored document. Honouring the scoped entry in the strip would blank the
subtitle of every customer-interaction result in global search — for the exact
configuration this repository documents as the intended use.

An operator who wants a scoped entry to strip as well can add the field to the
global list; the reverse — recovering a presenter field the strip removed — needs
a reindex.

## Read paths: why nothing goes blank

Verified against `develop`, not assumed:

- **Selection never reads a base column from `doc`.** In `HybridQueryEngine`,
  `applySelection` selects `cf:` keys from the document and otherwise emits
  `qualify(fieldName)` — the base table — guarded by `columns.has(fieldName)`.
  A field that is neither is not selected at all.
- **Filtering reaches `doc ->> field` only when `resolveBaseColumn()` returns
  null**, and `resolveBaseColumn` returns the field itself whenever
  `columns.has(field)`. Every stripped key is a base column by construction.
- **The other `applySelection`, which does read arbitrary fields out of a
  document, reads a different table.** It serves
  `custom_entities_storage` — custom entity records, written by
  `DataEngine.createCustomEntityRecord()`, never by either builder touched here.
- **`checksumSource` is unaffected.** `SearchIndexer.indexRecord()` receives its
  record from `queryEngine.query()`, i.e. from base columns, so vector
  re-embedding is not triggered by this change. The presenter enricher does call
  `buildSource` with the stored document, but discards everything except
  `presenter` and `links`.
- **`fieldPolicy.hashOnly` is unaffected.** It governs the `packages/search`
  strategies over query-engine records; it does not read `entity_indexes.doc`.

The one presenter that names a blocklisted field is
`messages:message`, which puts `external_email_hash` into `checksumSource` only
— never into a title or subtitle. `checksumSource` is built over query-engine
records, not over the stored document, so it keeps reading the base table's own
column; and the presenter enricher discards everything `buildSource` returns
except `presenter` and `links`, so the stored copy was never what fed it. (An
earlier draft said encryption re-injects that key into the document; see
*Before encryption, deliberately* above for why it does not, and why that is
harmless.)

## Migration & Backward Compatibility

No API changes; `stripBlocklistedDocFields` is a new export. The dated entry in
[`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md) points here.

| Surface | Change | Classification |
|---------|--------|----------------|
| Function signatures | New export `stripBlocklistedDocFields` from `@open-mercato/shared/lib/search/config` | ✓ ADDITIVE (new function in an existing module) |
| Function signatures | `buildIndexDocument`, `buildIndexDoc`, `attachAggregateSearchField`, `isSearchFieldBlocklisted` — signatures and return types unchanged | ✓ No change |
| `buildIndexDocument` / `buildIndexDoc` behaviour | A key matching the **global** blocklist is absent from the returned document | ⚠ Deliberate behaviour narrowing |
| `buildIndexDocument` internals | The search config is resolved once per call instead of once per call and again inside `attachAggregateSearchField` | ✓ No observable change |
| `search_text` and `search_tokens` | No change — those paths already excluded these fields (#4624) | ✓ No change |
| Entity-scoped blocklist entries (`<entityType>@<field>`) | No change — still un-tokenise, still stored | ✓ No change |
| `cf:` and `l10n:` document keys | No change — exempt from the strip | ✓ No change |
| Encryption rule `hashField` values | A `*_hash` column matching the global blocklist is stripped like any other and is **not** re-injected: `encryptFields()` skips a value that already decrypts under the current DEK, and that `continue` precedes the `hashField` block, so in steady state - where the base column is already ciphertext - the hash is never written back | ⚠ Deliberate behaviour narrowing. Nothing reads a `*_hash` out of the document: strict equality on an encrypted field goes through the base table's deterministic column (`packages/shared/src/lib/query/engine.ts`), which is untouched |
| Import paths, type definitions, event IDs, API routes, DB schema, DI names, ACL features, CLI commands, generated files | No change | ✓ n/a |

**The Emergency Security Exception is not invoked, and does not need to be.** Nothing is
removed or renamed and every caller compiles unchanged. What narrows is the content of a
document the query engine does not read base columns from; the deprecation protocol's
bridge would be "keep storing the credential", which is the condition being removed.

**Contract commitments**: the strip MUST keep using `isSearchFieldBlocklisted()` rather
than a private list — agreement between the aggregate, the token path and the document is
the invariant, and a fourth list is how the aggregate drifted in the first place (#4624).
The `cf:`/`l10n:` exemption MUST hold: the document is those keys' only store, so
stripping them is data loss rather than the removal of a duplicate. The strip MUST run
before `encryptIndexDocForStorage()`, so encryption sees exactly the document that gets
stored - stripping afterwards would seal a credential and then delete the sealed copy,
leaving the ordering silently dependent on which ran last. Scope MAY widen to entity-scoped
entries only alongside a way for a presenter to keep reading a scoped field out of the
document.

**Existing rows are not cleaned by this change.** It changes what is written; a
row already in `entity_indexes` keeps its `password_hash` until that record is
next indexed. Operators who want the stored copies gone now should run
`mercato query_index rebuild-all` (or `rebuild --entity <type>`) after
upgrading. A bare `UPDATE entity_indexes SET doc = doc - 'password_hash'` is not
durable on its own without this change in place, since the next write of that
record restores the key.

## Testing

- `packages/core/src/modules/query_index/__tests__/index-document-blocklist.test.ts`
  — 15 cases over the batch builder: each blocklist pattern removed, the display
  field kept beside it, an untouched ordinary document, the aggregate unchanged,
  an env-added global entry, the entity-scoped narrowing, `credential` still not
  blocklisted, the `cf:`/`l10n:` exemption, and a `hashField` column stripped like
  any other match.
- `packages/core/src/modules/query_index/__tests__/indexer.test.ts` — two cases
  on the event path, in the existing fake-kysely harness.
- `packages/core/src/modules/query_index/__integration__/TC-QIDX-9182-blocklisted-doc-fields.spec.ts`
  — the lifecycle on `auth:user` against a real database, with tenant data
  encryption on: a create (event path), a reindex over a row that still holds a
  `password_hash` copy from before the fix (batch path), and the next ordinary
  write (event path again). After each step `password_hash` and `email_hash` are
  absent from the stored document, and `email` and `name` are present.
- **Not vacuous, measured rather than asserted** (re-measured on `main`, 2026-11-10).
  With the `buildIndexDocument` call reverted, 8 tests fail and every negative
  control passes; with the `buildIndexDoc` call reverted, exactly 1 fails — the
  event-path case. Each chokepoint has its own failing test and neither covers for
  the other. In the ephemeral integration run, reverting the `buildIndexDoc` call
  fails TC-QIDX-9182 after the create, and reverting the `buildIndexDocument` call fails
  it after the reindex.

Suite totals, against a pristine baseline in a separate worktree:

| suite | pristine `develop` | with the fix | delta |
|---|---|---|---|
| `packages/core` | 1451 passed / 1467 of 1468 suites, 11809 passed / 11813 tests | 1452 passed / 1468 of 1469 suites, 11824 passed / 11828 tests | +1 suite, +15 tests |
| `packages/shared` | unchanged | 174 passed / 185 of 186 suites, 2024 passed / 2031 tests | 0 |
| `packages/search` | unchanged | 341 passed / 341 tests | 0 |

The failing suites and tests are identical in name and count between the two
`packages/core` runs: the `catalog` enricher-config pair, and suites that cannot
resolve `@open-mercato/events/bus` or `#generated/entity-fields-registry` in a
clone that has never been built.

## Changelog

- **2026-08-28** — Specification and implementation (#5759).
- **2026-09-10** — Corrected the `hashField` claim after review: a blocklisted `*_hash`
  column is stripped and not re-injected (see the contract table).
- **2026-11-10** — Brought onto `main`. The contract table moved here from
  `BACKWARD_COMPATIBILITY.md`, which keeps a short dated entry pointing at it, and the
  upgrade note moved from the released `0.7.0 → 0.8.0` section to the unreleased notes.
  The suite totals under Testing are the 2026-08-28 measurements against `develop`.
- **2026-11-10** — Added TC-QIDX-9182, an end-to-end test of the storage lifecycle,
  after the QA run asked for integration coverage.
