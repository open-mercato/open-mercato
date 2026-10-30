# Notify — 2026-10-29-agent-platform-wave-6

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-30T09:22:09Z — run started
- Brief: agent platform wave 6 — OTel P2 (content events, hand-encoded OTLP protobuf, per-tenant OTLP endpoints) and DocStructure P4 (per-section search behind `SearchEntityConfig.shouldIndex`), one PR, stacked on #8099.
- Plan drafted by a read-only planner on 2026-10-29 and approved with user decisions Q1 (hand-encode protobuf in AO), Q2 (include per-tenant endpoints), Q3 (shouldIndex hook), one PR.
- External skill URLs: none.

## 2026-10-30T10:40:53Z — checkpoint 1
- Steps 1.1–3.2 landed via executors (1.2, 1.3, 1.4, 2.1, 3.2 capable tier). Decisions worth review: the otelExport command now itself requires trace.view_content for content: full (incl. undo); tool args/results only export when a tool span carries gen_ai.tool.call.id, which native/OpenCode runs don't record yet; protobuf ints beyond signed 64-bit go as decimal strings; integration category 'other' with English labels.
- Checkpoint 1: static + unit + build:app pass; AO integration 95 passed / 13 skipped / 0 failed after 1.1-review-fix and the full documented OTel env.

## 2026-10-30T12:03:05Z — checkpoint 2
- Steps 3.3–4.6 landed via executors (3.3, 4.1, 4.2, 4.3, 4.5 capable tier; 3.6 cheap tier — landed as two commits). Fix: 3.4-review-fix (route-link + locale guards).
- Decisions worth review: per-tenant destination fails closed with five error codes (incl. deployment_unconfigured); `shouldIndex` also gates the query_index token writer; `releaseScoped(flush:false)` returns a search-only cleanup callback; tenant partitions fan out across all of the tenant's orgs.
- Checkpoint 2: static + unit + build:app pass after the fix; integration 150 passed / 15 skipped / 0 failed.

## 2026-10-30T12:46:01Z — blocker found and fixed
- Step 4.8's TC-ATT-STRUCT-006 found that Step 4.1 stopped the query_index token writer from writing tokens for `shouldIndex` entities while the SearchIndexer token path only runs from the fulltext/vector workers — so without Meilisearch and a vector provider, document sections were never token-indexed. Fixed in **4.1-review-fix** (79cbca600): query_index now evaluates `shouldIndex` per record (write on true, delete on false/throw). With it, TC-ATT-STRUCT-001..007 pass (7/7).
- The 4.8 executor's attempt to run against the local Meilisearch container was denied (it needed the container's master key); not retried.
