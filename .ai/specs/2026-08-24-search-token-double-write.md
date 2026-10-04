# Search tokens: one field-name convention, one writer's worth of writes

- **Status:** Implemented (pending review)
- **Related:** [#5402](https://github.com/open-mercato/open-mercato/pull/5402) (batch-path unchanged skip), [#4681](https://github.com/open-mercato/open-mercato/issues/4681) (runaway `search_tokens` growth)
- **Scope:** `packages/search/src/strategies`, `packages/core/src/modules/query_index/lib`

## TLDR

Two writers index the same record into `search_tokens`, and until now they disagreed about what a
custom field is called. `@open-mercato/core` writes `cf:<key>`; `@open-mercato/search` re-read the
record through the query engine and wrote whatever the engine's column aliaser produced, which is
`cf_<key>`. Each writer replaces tokens by deleting only the `(entity_id, field)` pairs its own
document carries, so neither ever deleted the other's custom-field rows: every custom field was
tokenized twice, and the base-field rows both writers do share were alternately deleted and
re-inserted on every write.

This change makes the search module write the `cf:` spelling, and extends #5402's
"skip a record whose tokens have not changed" comparison from the batch path to the per-record
path that event-driven indexing actually uses. Together they take an unchanged record from a full
token rewrite on every write to no writes at all.

## Problem Statement

### The two spellings

After any record write, `query_index` emits `search.index_record`
(`subscribers/upsert_one.ts`). `@open-mercato/search` handles it by re-reading the record through
the query engine (`indexer/search-indexer.ts`, `indexRecordById`) rather than using the index
document core just built and stored.

The query engine cannot return `cf:<key>` as a column label — `:` is not a valid SQL identifier —
so it aliases custom-field columns through `sanitize(s) = s.replace(/[^a-zA-Z0-9_]/g, '_')`
(`packages/shared/src/lib/query/engine.ts`). `cf:customer_name` comes back as `cf_customer_name`.
That row is passed verbatim as the document to index, and on to core's token writer, which
tokenizes every document key.

The divergence was already known and worked around downstream rather than fixed:
`packages/shared/src/lib/encryption/indexDoc.ts` documents it in a comment, and the search indexer
accepts both spellings in two places when extracting custom fields.

### Why it is not merely duplicate rows

`replaceSearchTokensForRecord` deletes only the `(entity_id, field)` pairs present in its own
document. So core deletes base fields + `cf:` and leaves `cf_` untouched; the search module deletes
base fields + `cf_` and leaves `cf:` untouched. On every record write both rebuild the full token
set, and they alternately delete and re-insert the base-field rows they share.

The duplicate set carries no information of its own. The token hash is computed over the token text
alone (`packages/shared/src/lib/search/tokenize.ts`, `hashToken`), so the field name never enters
it, and the `cf_` side contributes no hash not already present under `cf:`.

Nothing reads it either. The query engine's search predicate asks for the `cf:` spelling;
`TokenSearchStrategy.search()` matches on `token_hash` with no field predicate at all; and every
caller of `findEntityIdsBySearchTokens` passes base column names or `cf:`-prefixed keys
(`customers/api/utils.ts` builds them as `cf:${key}`).

The cost is structural rather than incidental: every custom field of every record is stored twice,
and every record write issues a delete and an insert for the base-field rows both writers claim. On
an entity with many custom fields the duplicate side can approach the size of the real one.

### The skip that only covered one path

#5402 added a tally comparison to `replaceSearchTokensForBatch`: a record whose stored tokens
already match the freshly built ones is skipped rather than rewritten.
`replaceSearchTokensForRecord` had no such comparison and rewrote unconditionally. Since the
per-record path is what event-driven indexing uses, a bulk import rewrote every record's tokens in
full even when nothing about the record had changed, on every import.

## Proposed Solution

### Converge on `cf:` in the token strategy

`TokenSearchStrategy.index()` and `.bulkIndex()` rewrite `cf_<key>` document keys to `cf:<key>`
before handing the document to core's token writer. A document carrying both spellings of one field
keeps the explicit `cf:` value.

The normalization is deliberately scoped to the rows this strategy writes rather than applied to
`IndexableRecord.fields` upstream in `SearchIndexer`: the same object is handed to the fulltext
driver, and Meilisearch rejects an attribute name containing `:`. Reading `entity_indexes.doc`
instead of re-querying — the other candidate fix — has the same problem plus a larger blast radius,
since the document's shape would also become what `buildSource`, `formatResult` and `resolveUrl`
see for every strategy.

### Extend the unchanged-record skip to the per-record path

`replaceSearchTokensForRecord` gains the comparison #5402 gave the batch path, over the scope this
path actually writes. The per-record delete is narrowed to the document's own `(entity_id, field)`
pairs, so the comparison is narrowed the same way — a wider read would let a token row under a
field the document does not carry (the orphaned `cf_` twin, for instance) read as a difference
forever and defeat the skip on every write.

Shape, matching the batch path:

1. A `count(*)` probe over the write's scope. Its result is one row whatever the table holds, so a
   record whose stored rows have run away (#4681) is settled without materializing them.
2. Only when the counts match, a content read bounded by the built row count, compared by token
   *multiplicity* (`tokenSignature` / `tallyEquals`, reused rather than re-derived).

The read runs through the caller's transaction when one is supplied. A separate connection cannot
see that transaction's own uncommitted writes, so it could report rows a pending delete has already
removed and talk the call out of re-inserting them.

## Architecture

No new module, service, table, index, or DI registration. The change is confined to one strategy
method pair in `packages/search` and one exported function in `packages/core`. Module boundaries are
unchanged: the search module still reaches `search_tokens` only through the query-index writer it
already imported.

## Data Models

No schema change and no migration.

Existing `cf_`-spelled rows are orphaned by this change: neither writer will delete them afterwards,
because the per-record delete only touches pairs present in its own document. They are purged by any
full batch reindex, which deletes by `entity_id`. Whether to run one is each deployment's call, so
this change ships no cleanup migration. Until then those rows cost storage and nothing else — no
reader consults the field name, and the hashes they carry are already present under `cf:`.

## API Contracts

No HTTP route, response, event, CLI, or DI contract changes. `replaceSearchTokensForRecord` keeps
its signature and its observable outcome (the stored token set for the document's fields); only the
writes it issues to reach that outcome change.

## Test Coverage

- `packages/search/src/__tests__/token-strategy-custom-field-keys.test.ts` drives the real core
  writer and the strategy against one in-memory `search_tokens`, which is the only place the
  divergence is observable. Covers: the aliased key stored as `cf:<key>` on both the single and
  batch paths, base columns left alone, a document carrying both spellings, and — with both writers
  alternating over one record — a table that holds one row per field and stops changing after the
  first write.
- `packages/core/src/modules/query_index/__tests__/search-tokens-record-unchanged-skip.test.ts`
  covers the per-record skip: unchanged record left untouched, changed record still rewritten and
  searchable, a stored row under a field outside the document not defeating the skip, stale and
  duplicated stored rows still collapsed, a runaway stored set settled on the count probe alone,
  raw-token storage, a record that stops producing tokens, and the read routed through a
  caller-supplied transaction.
- No API or UI path changes, so route-level integration and manual UI QA are not applicable. The
  affected behavior is token construction and the writes issued to persist it, covered at unit
  level.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| A base column genuinely named `cf_*` is rewritten to `cf:*` | Low | The prefix is already treated as a custom-field marker by the search indexer's own extraction in two places, so the heuristic is the module's existing one, not a new one | A record with such a column would have its tokens filed under a `cf:`-prefixed field name. No reader consults the field name for token search, so search results are unaffected |
| A custom-field key carrying a non-word character does not round-trip | Low | Every key the sanitizer leaves untouched — `[a-zA-Z0-9_]+`, which is every key in practice — reverses exactly. The rewrite is skipped when the document already carries the explicit `cf:` spelling | `order-ref` is aliased to `cf_order_ref` and rewritten to `cf:order_ref`, a name no reader asks for, so that one field keeps the double-write this fixes for the rest. Where such a key and its underscore twin both exist, they already collide on one column alias inside the engine's `SELECT`, before the record reaches the strategy — not a collision this rewrite introduces or can repair |
| The skip stops healing rows a concurrent writer left behind | Low | The comparison counts multiplicities, so duplicates force a rewrite; a stored count above the built count settles on the probe | Same residual as #5402: a rewrite that used to happen by accident no longer does, so stale rows survive until the record's next real change |
| Orphaned `cf_` rows persist after deploy | Low | A full batch reindex deletes by `entity_id` and purges them | Storage only, until a deployment chooses to reindex |
| Two writers whose documents carry different field sets | Low | Each writer's comparison and delete are scoped to its own document's fields, so each is independently idempotent | Fields only one writer knows about are neither compared nor deleted by the other, which is what keeps both stable |

## Migration & Backward Compatibility

- No database migration, index build, or environment variable change.
- No contract surface from `BACKWARD_COMPATIBILITY.md` is touched.
- No reindex is required for correctness: the `cf:` rows the fix converges on are the rows readers
  already ask for, and core has been writing them all along.

## Final Compliance Report

- Tenant and organization scope remain part of every token row, every comparison predicate, and
  every delete.
- No encrypted document contents or raw tokens are added to logs; the new `record.skip` debug event
  carries only entity type, record id, and a count, matching the existing `batch.skip`.
- No database contract surface changes.
- No generated files or module discovery surfaces change.

## Changelog

- 2026-08-24: Initial implementation — `cf:` normalization in `TokenSearchStrategy`, unchanged-record
  skip extended to `replaceSearchTokensForRecord`.
