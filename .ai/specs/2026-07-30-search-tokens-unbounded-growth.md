# Search token growth guardrails

- **Status:** Implemented (pending review)
- **Issue:** [#4681](https://github.com/open-mercato/open-mercato/issues/4681)
- **Supersedes:** [#4685](https://github.com/open-mercato/open-mercato/pull/4685)
- **Related:** [#4790](https://github.com/open-mercato/open-mercato/pull/4790)
- **Original implementation:** @rajanbor in #4685
- **Scope:** `packages/core/src/modules/query_index`, `packages/shared/src/lib/search`

## TLDR

Bound token generation and collapse repeated automatic reindex requests without
adding another database index. The reported runaway growth combined uncapped
prefix expansion with repeated reindex scheduling. These two guardrails break
that feedback loop while avoiding a wide unique index, an expensive production
deduplication migration, and extra work on every token insert.

## Overview

The token index is an intentionally high-cardinality PostgreSQL table. A
self-hosted instance reached 221 million rows for 2,205 message records after
coverage gaps repeatedly scheduled reindexes and long message bodies expanded
into tens of thousands of prefix tokens.

PR #4790 addresses a separate read-path problem: the cost of determining whether
a tenant scope has any tokens. It does not limit token production or auto-reindex
scheduling, so the protections in this spec remain complementary.

## Problem Statement

Two paths allowed a bounded dataset to produce unbounded work:

1. `scheduleAutoReindex` emitted a persistent reindex event on every query that
   observed a coverage gap. Request-scoped query engines did not share any
   cooldown state.
2. `tokenizeText` expanded every eligible token into every prefix and accepted
   arbitrarily large fields. Array-valued and multi-field records had no shared
   token-row budget.

Concurrent delete-then-insert token replacement can still create temporary
duplicates. Searches use existence semantics, and a later non-overlapping
replacement removes those duplicates. Preventing rare overlap with a wide
unique index would impose a permanent write and storage cost on every token and
would require risky cleanup on already-bloated installations. That index is
therefore intentionally out of scope.

## Proposed Solution

### Auto-reindex debounce

- Keep the last schedule timestamp in a process-global map keyed by entity type,
  tenant, and organization.
- Default the cooldown to 30 seconds and allow operators to tune or disable it
  with `OM_QUERY_INDEX_AUTO_REINDEX_DEBOUNCE_MS`.
- Bound the map to 10,000 scopes and prune expired entries before evicting the
  oldest entry.
- Retain the reindexer's existing active-job check as the database-visible
  protection across processes.

### Token limits

- Truncate field input before splitting or prefix expansion.
- Stop prefix expansion while collecting tokens instead of materializing all
  prefixes and slicing afterward.
- Share a per-field budget across all values of an array-valued field.
- Stop building rows when the record-wide budget is reached.
- Avoid tokenizing each value twice during field eligibility checks.

Defaults:

| Setting | Default | Meaning |
|---|---:|---|
| `OM_SEARCH_MAX_FIELD_CHARS` | 20,000 | Input characters considered per field value |
| `OM_SEARCH_MAX_TOKENS_PER_FIELD` | 5,000 | Distinct token rows across one field |
| `OM_SEARCH_MAX_TOKENS_PER_RECORD` | 20,000 | Token rows across one record |

Setting an individual limit to `0` disables that limit.

## Architecture

The shared tokenizer owns limits that must apply before prefix materialization.
The query-index row builder owns limits that span array entries and fields. The
hybrid query engine owns auto-reindex scheduling, with its timestamp map shared
by all engine instances in one process.

This preserves existing module boundaries and event contracts. It introduces no
queue, service, table, or index.

## Data Models

No database schema changes. In particular, this change does not add the
`search_tokens_unique_tuple_idx` proposed by #4685 and does not alter existing
`search_tokens` rows during deployment.

## API Contracts

No HTTP route, response, event, CLI, or DI contract changes. `SearchConfig` gains
three optional fields, so existing third-party configuration literals remain
source-compatible. Missing fields resolve to the safe defaults above.

## Test Coverage

- Shared tokenizer unit tests cover input truncation, bounded prefix collection,
  legacy configs without limit fields, and explicit limit disabling.
- Query-index unit tests cover record-wide limits, array-valued field limits,
  repeated leading tokens across array values, and ordinary documents below the
  limits.
- Auto-reindex unit tests cover repeated requests, independent engine instances,
  duplicated module instances, distinct scopes, and expiry of the debounce
  window.
- No API or UI path changes, so route-level integration and manual UI QA are not
  applicable. The affected behavior is isolated to pure token construction and
  event scheduling and is covered at unit level.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Search terms beyond a configured field or token limit are omitted | Medium | Conservative defaults and explicit tuning variables | Operators must raise a limit when deep-document recall is more important than bounded index size |
| Two application processes can schedule the same reindex | Low | The cooldown removes the per-request stampede in each process; the existing active-job guard prevents duplicate active work | A small number of redundant persistent events may still be queued during cross-process races |
| Concurrent token replacements can leave temporary duplicate rows | Low | Queries use existence semantics and the next non-overlapping replacement heals duplicates. Since #5402 the batch path skips records whose tokens are unchanged, so "the next replacement" no longer happens unconditionally — the skip compares token *multiplicities* rather than a set, and a stored row count above the built count forces a full rewrite of the scope bucket, so a duplicated record is still routed through the healing rewrite | Rare duplicates can consume space until the next replacement. A duplicated record now also costs its whole scope bucket a rewrite, because the bounded pre-read stops at the built row count rather than reading far enough to identify which record is duplicated |
| Debounce scope cache grows with tenant churn | Low | The map is capped at 10,000 entries and prunes expired keys | Eviction can allow one additional schedule under extreme scope churn |

## Migration & Backward Compatibility

- No database migration or index build.
- Existing environment variables and defaults are unchanged.
- New `SearchConfig` members are optional and additive.
- The three new token limits change behavior only for oversized/pathological
  records that exceed the documented guardrails.
- Operators recovering from an already-bloated table should continue using the
  issue's operational workaround: stop automatic reindexing, clean the table in
  a controlled maintenance window, then run one controlled reindex.

## Final Compliance Report

- Tenant and organization scope remain part of the debounce key and token rows.
- No encrypted document contents or raw tokens are added to logs.
- No database contract surface changes.
- No generated files or module discovery surfaces change.
- App and create-app environment templates remain in sync.

## Changelog

- 2026-08-20: Noted in the risk table how #5402 (skip rewriting unchanged search
  tokens) interacts with duplicate healing: the batch path no longer rewrites
  unconditionally, so healing now depends on the multiplicity comparison and on
  the bounded pre-read falling back to a full bucket rewrite. The pre-read is
  bounded by the built row count, which `OM_SEARCH_MAX_TOKENS_PER_RECORD` already
  caps, so it does not reintroduce an unbounded read of this table.
- 2026-08-02: Added regression coverage for distinct array-field token budgets
  and duplicated module instances, and completed the canonical environment
  setting references.
- 2026-08-01: Replaced #4685 with the index-free debounce and token-limit subset,
  retaining credit to @rajanbor and documenting #4790 as complementary read-path work.
