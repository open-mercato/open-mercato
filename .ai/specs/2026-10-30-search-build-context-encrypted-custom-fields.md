# Search build contexts omit encrypted custom fields

- **Status:** Implemented (pending review)
- **Related:** [#7872](https://github.com/open-mercato/open-mercato/issues/7872) (the leak), [#7894](https://github.com/open-mercato/open-mercato/issues/7894) (encrypted custom fields in `IndexableRecord.fields`)
- **Scope:** `packages/search/src/indexer`, `packages/search/src/lib`, `packages/search/src/di.ts`

## TLDR

`SearchIndexer` handed search sources (`buildSource`, `formatResult`, `resolveUrl`, `resolveLinks`) every custom field decrypted, including those whose definition is `encrypted`. Sources that format custom fields into text, such as the customers Company and Person sources, sent that plaintext to the embedding provider and stored it in the vector and fulltext indexes. The indexer now removes encrypted custom fields from every build context, and removes every custom field when it cannot tell which ones are encrypted.

## Overview

A search source is a module's `search.ts` entity config. The indexer builds a `SearchBuildContext` per record and calls the source's callbacks; their output (text, presenter, URL, links) is what strategies store or embed. The build context carries no container, so a source cannot look up custom-field definitions itself; the exclusion has to happen in the indexer.

## Problem Statement

- `ctx.customFields` and the record's `cf:` / `cf_` keys carry decrypted values of encrypted custom fields.
- Records a source loads through `ctx.queryEngine` carry them too, including custom fields joined from another entity through `customFieldSources` (customers loads `customer_entity` with the profile's custom fields that way).
- The customers sources append every custom field to the text the vector strategy embeds, so the external embedding provider receives the plaintext, and the vector document stores it.
- Any callback can copy a value into a presenter or link, which the fulltext and vector indexes store.

## Proposed Solution

1. **Resolver.** `createEncryptedCustomFieldKeysResolver(db)` reads `custom_field_defs` for an entity and returns the normalized keys whose `config_json.encrypted` is true, plus the query engine's sanitized `cf_` alias of each key. It reads the record's tenant and global definitions (`tenant_id = :tenant OR tenant_id IS NULL`, as the query engine joins definitions), unions every organization of that tenant and ignores `is_active`, because a build context has no organization; over-excluding a field is preferable to publishing it. A query without a tenant reads every tenant's definitions. A `config_json::text LIKE '%encrypted%'` predicate keeps the rows read to candidate definitions; the flag itself is checked after parsing.
2. **Exclusion in every build path.** `indexRecord`, `indexRecordsById`, the reindex paths and `bulkIndexRecords` remove excluded keys from `ctx.customFields` and from the record's `cf:` / `cf_` keys. The query engine handed to sources removes them from every loaded record, merging the exclusions of the queried entity and each `customFieldSources` entity. Exclusions are memoized per entity and tenant for one indexing call.
3. **Fail closed.** When the resolver throws, every custom field of that entity is excluded and the failure is reported as `search.encrypted_custom_fields_unresolved`. When the indexer is constructed without a resolver, every custom field is excluded and `search.encrypted_custom_fields_resolver_missing` is reported once per indexer. When DI cannot obtain the entity manager, it reports `search.custom_field_definitions_unavailable` and installs a resolver that always throws.
4. **Token fields untouched.** `IndexableRecord.fields` keeps the original values so the hashed `search_tokens` index still covers encrypted custom fields. Changes a source makes to its build record (as customers does with `entity_id`), including deleted keys, are copied back so they still reach the indexed fields.
5. **Reporting.** `reportSearchError` sends caught failures to `getTelemetryRuntime()?.reportError` with a stable `search.<reason>` code; a telemetry fault degrades to a warning and never changes the indexing outcome.

## Architecture

- `lib/encrypted-custom-field-resolver.ts`: the resolver, typed with the narrow `custom_field_defs` table shape it reads.
- `indexer/search-indexer.ts`: `SearchIndexerOptions.encryptedCustomFieldKeysResolver`, the per-call exclusion lookup, the filtering helpers and the filtering query-engine wrapper.
- `di.ts`: builds the resolver from the request's Kysely instance and passes it to the registered `searchIndexer`.
- `lib/debug.ts`: `reportSearchError`.

No cross-module ORM relations are added; the resolver reads the `custom_field_defs` table through Kysely, as `createEncryptionMapResolver` reads its table.

## Data Models

No change. The resolver reads `custom_field_defs (entity_id, key, config_json, deleted_at)`.

## API Contracts

No route changes. Public TypeScript surface:

- `SearchIndexerOptions.encryptedCustomFieldKeysResolver?: EncryptedCustomFieldKeysResolver` (additive).
- `@open-mercato/search/di` exports `createEncryptedCustomFieldKeysResolver` and `EncryptedCustomFieldKeysResolver` (additive).
- `SearchBuildContext` keeps its shape; the values it carries change as described above.

## Test Coverage

- `search-indexer-encrypted-custom-fields.test.ts`: exclusion from the context and text in `indexRecord` and the batch path, from records loaded through `ctx.queryEngine` (also via `customFieldSources`); token fields keep the value; source changes to the record reach the indexed fields; a failing resolver and a missing resolver exclude every custom field, the latter reporting `search.encrypted_custom_fields_resolver_missing`.
- `search-indexer-encrypted-custom-fields.boundary.test.ts`: through a real `SearchService` with `FullTextSearchStrategy` and `VectorSearchStrategy` over capturing drivers, including `bulkIndexRecords` callback output, a failing resolver, a missing resolver and a throwing telemetry runtime.
- `search-indexer-encrypted-custom-fields.customers.test.ts`: the real customers Company source through the indexer and the vector strategy.
- `di-encrypted-custom-fields.test.ts`: `registerSearchModule` wires the resolver; a container without an entity manager reports and excludes every custom field.
- `encrypted-custom-field-resolver.test.ts`: key normalization, `config_json` forms and the query.
- Integration (Playwright) coverage is not added: the change has no route or UI, and the unit tests drive the indexer end to end through the real strategies.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| A source relied on an encrypted custom field for matching or display | Medium | Module search sources | The value is the leak being closed; documented in `UPGRADE_NOTES.md` | Results stop matching on that value through fulltext and vector; the token strategy still matches it by hash |
| Code constructs `SearchIndexer` without the resolver | Medium | Direct `SearchIndexer` consumers | The indexer excludes every custom field and reports `search.encrypted_custom_fields_resolver_missing`; docs and upgrade notes show how to pass the resolver | Non-encrypted custom fields disappear from that indexer's sources until it is wired |
| The definitions table is unreachable during indexing | Low | Indexing workers | Every custom field of the entity is excluded and the failure is reported | Search text lacks custom fields for that run; a later reindex restores them |
| A key encrypted in one organization is plain in another of the same tenant | Low | Search indexing per tenant | Union across the tenant's organizations, by design | That key is excluded for every organization of the tenant |
| Values indexed before the upgrade | High | Fulltext and vector indexes, embedding provider | Operators reindex affected entities (`UPGRADE_NOTES.md`) | Values already sent to the embedding provider cannot be recalled by the platform |
| `VectorIndexService` (exported from `@open-mercato/search/vector`) calls `buildSource`, `formatResult` and `resolveLinks` with decrypted custom fields | Medium | Apps that register it as `vectorIndexService` | Nothing in the repository registers it; `query_index` only uses it when present. Documented in `packages/search/AGENTS.md`; applying the same exclusion there is a follow-up | An app that registers it still embeds encrypted custom fields |
| `IndexableRecord.fields` still carries encrypted custom fields to the fulltext driver for entities without a `fieldPolicy.searchable` list and to the vector fallback text | Medium | Fulltext driver, vector fallback text | Out of scope; tracked in #7894 | Unchanged until #7894 lands |

## Migration & Backward Compatibility

This narrows the documented behaviour of `SearchBuildContext`, a public contract, under the Emergency Security Exception of `BACKWARD_COMPATIBILITY.md`; the dated entry "Search Build Contexts Omit Encrypted Custom Fields (2026-10-30)" records it.

- **Qualifying condition.** The surface is the decrypted value of an encrypted custom field in a build context. Callback output is stored in the fulltext and vector indexes or sent to the embedding provider, so keeping the old context for any window, behind a flag, or for indexers built without the resolver would keep the plaintext reaching those stores, for the first-party customers sources as well as third-party ones.
- **Narrowest removal.** Only custom fields declared `encrypted` are removed when the definitions are known; everything else in the context is unchanged, and `IndexableRecord.fields` is untouched. Removing every custom field is limited to the cases where the indexer cannot tell which are encrypted (no resolver, or the lookup fails).
- **No bridge.** There is no opt-out. `SearchIndexerOptions.encryptedCustomFieldKeysResolver` stays optional so existing constructor calls still compile; leaving it out excludes every custom field instead of restoring the old behaviour.
- **Module authors.** Resolve `searchIndexer` from DI, or pass `createEncryptedCustomFieldKeysResolver(em.getKysely())` when constructing it. Sources that formatted encrypted custom fields lose that text.
- **Operators.** Reindex entities that carry encrypted custom fields to drop values indexed before the upgrade, and treat values already sent to the embedding provider as disclosed to it.
- No database migration, environment variable, event, route, DI name, ACL feature or CLI change.
- The exception requires a named human-maintainer approval acknowledging the waiver on the PR, alongside the `security` label.

## Final Compliance Report

- Tenant scoping: the resolver reads only the record's tenant and global definitions, and unions that tenant's organizations to over-exclude; it returns only key names, never values.
- No encrypted values are logged; warnings and telemetry carry the entity id and the error message only.
- No new `any`; the resolver and DI use narrow Kysely types.
- Caught failures are reported through the telemetry runtime with stable codes.
- No generated files, module discovery surfaces or database schema change.

## Changelog

- 2026-10-30: Exclusion of encrypted custom fields from search build contexts, scoped to the record's tenant, fail-closed for a failing or missing resolver.
