# Execution plan — `search_text` aggregate honours `OM_SEARCH_FIELD_BLOCKLIST` (+ per-entity opt-out)

Issue: [#4624](https://github.com/open-mercato/open-mercato/issues/4624)
Engine: om-auto-create-pr (steps: 9, --loop: no)

## Goal

Make the aggregate search field `search_text` respect `OM_SEARCH_FIELD_BLOCKLIST`, and add an
entity-scoped opt-out so a deployment can keep large free-text columns (e-mail bodies, notes) out of
the token index for one entity type without losing them everywhere.

## Problem / root cause

`OM_SEARCH_FIELD_BLOCKLIST` is consulted in exactly one place — `shouldIndexField()` in
`packages/core/src/modules/query_index/lib/search-tokens.ts` — which gates **per-field** token rows.
The aggregate field is composed independently by `collectAggregateSearchValues()` in
`packages/core/src/modules/query_index/lib/document.ts`, which receives no `SearchConfig` at all and
filters only structural keys (`id`, `*_id`, `*_at`, `tenant_id`, `organization_id`).

Consequence: blocklisting `body` removes the `body` token rows, but the same text is concatenated into
`doc.search_text`, and `search_text` is itself tokenized — so the tokens come straight back under a
different field name. On the reporter's tenant `customer_interaction/search_text` alone held 9.27 M of
14.0 M rows. Blocklisting `search_text` is not an option: it is the field every entity's search
actually queries.

A second, quieter consequence: the built-in default blocklist (`password`, `token`, `secret`, `hash`)
was likewise bypassed by the aggregate, so secret-ish column values were being tokenized into
`search_text` despite the guard that exists to prevent exactly that.

## Scope

- `packages/shared/src/lib/search/config.ts` — parse entity-scoped blocklist entries; export a single
  shared matcher used by both the per-field and the aggregate path.
- `packages/core/src/modules/query_index/lib/document.ts` — thread `entityType` + `SearchConfig` into
  the aggregate composition and skip blocklisted fields.
- `packages/core/src/modules/query_index/lib/search-tokens.ts` — route the existing per-field check
  through the shared matcher so both paths cannot drift apart again.
- Call sites that build index documents: `query_index/lib/indexer.ts`, `query_index/lib/batch.ts`,
  `customers/cli.ts`.
- Env examples (`apps/mercato/.env.example` + the create-app template, per the template-sync rule) and
  the hybrid-search docs page.

## Non-goals

- No wildcard entity patterns (`customers:*@body`). Exact entity-type match only; a wildcard syntax can
  be added later additively if a real need appears.
- No change to the tokenizer, to `expandToken` prefix expansion, or to `minTokenLength` defaults —
  the 4.4× partial-token multiplier described in the issue is a separate tuning question.
- No data migration or automatic purge of already-indexed tokens. Existing rows keep the old
  `search_text` until the affected entities are reindexed; the PR documents this.
- No per-tenant (DB-backed) configuration surface — this stays an env-level deployment concern.

## Design

`OM_SEARCH_FIELD_BLOCKLIST` stays a comma-separated list; an entry may now carry an optional
entity-type prefix separated by `@`:

```
OM_SEARCH_FIELD_BLOCKLIST=body,customers:customer_interaction@notes
```

- `body` — global, matches any entity (unchanged semantics).
- `customers:customer_interaction@notes` — matches only that entity type.

Matching keeps today's substring semantics (`fieldName.toLowerCase().includes(pattern)`) so existing
configurations behave identically, and entity types are compared case-insensitively on an exact match.
Malformed entries (empty field part) are ignored rather than throwing, because this is env input read
during indexing.

`SearchConfig` gains `entityBlocklistedFields: Record<string, string[]>` alongside the existing
`blocklistedFields: string[]`, which keeps holding the global entries only — so the two existing
consumers of that field (debug logging in `packages/shared/src/lib/query/engine.ts` and
`query_index/lib/engine.ts`) are unaffected.

Public signatures stay backward compatible: `attachAggregateSearchField(doc)` and
`buildIndexDocument(row, cfs, scope)` keep working with an omitted trailing options argument, falling
back to `resolveSearchConfig()` and an unknown entity type (global entries still apply).

## Risks

- **Behavioural change on reindex.** After this lands, `search_text` no longer contains blocklisted
  field text — including the built-in `password`/`token`/`secret`/`hash` defaults. Any deployment that
  (unknowingly) relied on finding records through a blocklisted column via the aggregate will stop
  matching those terms. This is the intended fix, but it is user-visible and belongs in the PR body.
- **Stale index.** The change only takes effect for documents rebuilt after deploy; existing rows are
  untouched until reindex.
- **Per-record config resolution.** `resolveSearchConfig()` parses env on every call; the batch and CLI
  paths resolve it once outside their loops so the hot indexing path does not re-parse per record.

## Implementation Plan

### Phase 1: Entity-aware blocklist in the shared search config

1.1 Parse `entityType@field` entries in `resolveSearchConfig()` into `entityBlocklistedFields`, keeping
`blocklistedFields` as the global-only list.
1.2 Export `isSearchFieldBlocklisted(field, entityType, config)` as the single matcher for both paths.
1.3 Unit-test the parser and matcher (global entry, entity-scoped entry, non-matching entity, default
blocklist, malformed input, case-insensitivity).

### Phase 2: Honour the blocklist in the aggregate and unify the per-field path

2.1 Thread an optional `{ entityType, config }` options argument through
`attachAggregateSearchField()` / `buildIndexDocument()` and skip blocklisted fields when composing
`search_text`.
2.2 Route `shouldIndexField()` in `search-tokens.ts` through `isSearchFieldBlocklisted` so per-field
tokens honour entity-scoped entries too.
2.3 Pass `entityType` (and a once-resolved config where the call site loops) from `indexer.ts`,
`batch.ts`, and `customers/cli.ts`.
2.4 Unit-test the aggregate and token paths: blocklisted field excluded from `search_text`,
entity-scoped entry applies only to its own entity, defaults excluded, unrelated fields untouched.

### Phase 3: Documentation

3.1 Update `apps/mercato/.env.example` and `packages/create-app/template/.env.example` (template-sync
rule) with the entity-scoped syntax.
3.2 Document the variable and the reindex requirement in
`apps/docs/docs/framework/database/hybrid-search.mdx`.

## Progress

PR: #4630

### Review pass (om-auto-review-pr, self-authored → autofix eligible)

- [x] R.1 Guard the entity blocklist lookup against inherited `Object.prototype` keys — 213d8aad7

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Entity-aware blocklist in the shared search config

- [x] 1.1 Parse entity-scoped blocklist entries in resolveSearchConfig — 3822d340e
- [x] 1.2 Export the shared isSearchFieldBlocklisted matcher — 3822d340e
- [x] 1.3 Unit tests for the parser and matcher — 3822d340e

### Phase 2: Honour the blocklist in the aggregate and unify the per-field path

- [x] 2.1 Thread entityType and config into the aggregate composition — d038deab5
- [x] 2.2 Route shouldIndexField through the shared matcher — d038deab5
- [x] 2.3 Pass entityType from indexer, batch, and customers CLI call sites — d038deab5
- [x] 2.4 Unit tests for the aggregate and token paths — d038deab5

### Phase 3: Documentation

- [x] 3.1 Update both .env.example files with the entity-scoped syntax — 3383fdf1c
- [x] 3.2 Document the variable and reindex requirement in the hybrid-search docs — 3383fdf1c
