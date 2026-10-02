# Encrypted list-search guidance and diagnostics

## TLDR

Repair issue #6729 by documenting the existing QueryEngine/token-index contract and making its fallback warning visible in development list responses. Query behavior and production payloads remain compatible.

## Resolved assumptions

Use existing query-result metadata rather than a new HTTP header: both query engines already return metadata and `makeCrudRoute` forwards it. Keep the existing log suppression but collect a diagnostic on each development query. Keep P5's agent-generated DB oracle after #6727; a direct framework integration test does not constitute that harness capability. No optional static AST detector is included.

## Problem Statement

The API scaffold reference forbids encrypted `$ilike`, while Example uses it through QueryEngine. The missing distinction is direct ORM versus QueryEngine, and the latter requires a populated scoped token index. Missing tokens can produce an empty HTTP 200 with only one server log per process/entity/tenant/field.

## Proposed Solution and Architecture

The installed shared package guide owns the filtering contract. The standalone sensitive-data reference names it, links the engine implementation, teaches the query-index population invariant and a real create/index/search verification, and other entrypoints refer to this guidance. Example retains its existing API behavior.

`warnOnCiphertextLikeFallback` receives an optional diagnostic callback without changing its return type. Outside production it reports safe metadata independently of warn-once logging. BasicQueryEngine and HybridQueryEngine collect request-local diagnostics and append `meta.ciphertextSearchWarnings` after the extension pipeline. No process-global response collector or additional detection algorithm is introduced.

## Data Model

No database, migration, encryption format, token format, or index policy changes.

## API Contracts

Development/test QueryEngine results may add `meta.ciphertextSearchWarnings: Array<{ entity: string, field: string, reason: 'no-indexable-tokens' | 'no-search-tokens' | 'search-disabled' | 'raw-orm-filter', hint: string }>` when fallback targets an encrypted field. `makeCrudRoute` forwards this existing metadata envelope. No search term, field value, tenant/organization ID, hash, key or credential is included. Production does not collect this field. Detection failures keep existing debug logging and query behavior.

## Migration & Backward Compatibility

The callback parameter and metadata field are optional additive STABLE type/API extensions. Existing Promise<void> callers, route URLs, request schemas, rows, filtering behavior and logs remain compatible. No migration or adoption action is required. Direct ORM consumers still need explicit token lookup and scoped decrypted reads; neither helper nor diagnostics enables a new fallback.

## Risks & Impact Review

- Repeated development map reads add diagnostic overhead. Production retains warn-once lookup behavior; only explicit development collectors bypass suppression.
- Diagnostics must not expose values or cross-request state. Tests assert exact safe shape, production omission, repeated reporting, and separate request scopes.
- A cached diagnostic may be stale after index repair. It describes the query that produced that cached response; normal cache invalidation remains authoritative.
- No tokens in the probe is not proof of an indexing error for an empty entity. The warning reports the fallback condition, not a claim that records exist.

## Implementation Plan

1. Add failing diagnostic and knowledge-routing regressions, then reconcile the canonical guide and entrypoints.
2. Add safe development metadata to both engines while preserving logging and production behavior.
3. Synchronize template/source-link assets and run focused plus repository validation. Add a real framework encrypted create/index/search integration case if the available runner supports it.
4. Keep the generated-module DB-aware harness pairing pending #6727 and report actual certification status; do not turn a source check or mocked database into runtime evidence.

## Testing Strategy

Warning unit tests cover repeated diagnostics, log suppression, redaction and production omission. Both engine suites exercise the real query entrypoint with token availability absent/present. Knowledge regression tests verify canonical routing and populated-index guidance. Existing Example encryption integration fixtures are the starting point for live encrypted create/index/search and scope isolation coverage.

## Final Compliance Report

Additive public metadata only; no new dependency, cross-module ORM access, schema change or production diagnostic payload. Full harness certification and the P5 DB-aware generated-module oracle remain unclaimed until their own evidence exists.

## Changelog

- 2026-10-01: Document #6729 correction, additive development diagnostics, and explicit dependency-bound harness scope.
