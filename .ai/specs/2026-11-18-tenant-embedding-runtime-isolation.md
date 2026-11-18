# Tenant embedding runtime isolation (#9135)

## TLDR / Overview

Correct the mutable embedding service lifetime to the existing request/job DI container. Drivers, queues and the vector index remain shared. No startup mechanism, schema migration, dependency or provider default changes.

## Problem Statement

A tenant settings save changed the process embedding singleton. Search routes loaded only instance configuration, so another tenant's query could reach the previous tenant's Ollama destination. Existing tenant storage isolation did not isolate the runtime service.

## Proposed Solution / Architecture

Register a fresh `vectorEmbeddingService` value for every existing request/job container, preserving its token and public methods. Keep driver, pool and queue globals. The two search routes, embeddings reindex endpoint and vector worker resolve `scope: { tenantId }` from authenticated context/job payload using existing scoped→instance fallback. With no saved config the existing EmbeddingService default remains unchanged. POST persists settings without mutating any embedding service. The legacy search CLI vector worker creates and disposes a container per job, matching the general worker runner and isolating overlapping jobs.

A supplied tenant Ollama URL must pass existing SSRF checks and either equal the normalized existing `OLLAMA_BASE_URL` (default localhost:11434) or match the existing `OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST` host/host:port rules. `OM_SEARCH_OLLAMA_ALLOW_PRIVATE` remains an SSRF policy setting and grants no tenant destination authorization by itself. Provider/model registries and custom Ollama model support are unchanged.

## Data Models / API Contracts

No schema or response shape changes. Existing API ACL metadata and tenant derivation remain intact. POST `/api/search/embeddings` returns the existing localized invalid-URL 400 with `reason: operator_not_allowed` for an unauthorized public destination, before the provider probe or persistence.

## Implementation / Coverage

1. Correct DI lifetime and scope config reads; remove POST runtime mutation.
2. Reuse existing operator URL/allowlist configuration for tenant destination authorization.
3. Route-to-DI-to-vector strategy integration regression tests in Jest exercise both GET search APIs, sequential and overlapping tenant A/B requests, tenant override, instance fallback and env/service default. Network SDK and infrastructure boundaries are faked; actual service and strategy are exercised. POST tests reject arbitrary public destinations before probing, accept operator and allowlisted URLs, retain metadata rejection and verify saves never mutate runtime state. Existing worker/reindex suites assert tenant scope. CLI boundary tests execute the real command and prove overlapping jobs use separate containers, including disposal on failure.

## Migration & Backward Compatibility

Protected surfaces: STABLE API accepted URL behavior narrows; DI token and methods remain unchanged, while unsafe shared mutable lifetime is corrected. Clients that submit arbitrary public Ollama URLs now receive 400 and must select an operator-approved destination. Operators already using custom hosts can retain them through existing `OLLAMA_BASE_URL` or `OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST`; no new configuration is introduced. Review existing tenant rows and remove unexpected endpoints; restart existing web/worker processes to clear the previously mutable singleton. No data/index rebuild or migration is required.

Keeping arbitrary tenant-controlled endpoints accepted preserves the reported query-disclosure route; no compatibility flag or partial bridge is provided. Emergency exception steps 1–3 require named human maintainer approval under BACKWARD_COMPATIBILITY.md before merge. Upgrade notes accompany the change. The dated compatibility-ledger entry records the pending human waiver; automation cannot approve it.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Cross-tenant mutable provider state | Critical | Container-local services; sequential/concurrent route regression | Custom DI overrides must preserve isolation |
| Shared driver/queue connection churn | Medium | Keep existing globals and singleton reuse tests | Per-container SDK clients carry no persistent DB pool |
| Existing arbitrary public tenant URL rejected | High | Existing operator configuration and migration notes | Human security waiver required |
| Worker/search config mismatch | High | Same tenant scope resolution and existing shared dimension guard | Operators still own shared vector dimensions |

## Final Compliance Report

Scope is search plus issue-specific documentation. No direct ORM relationships, schema changes, startup changes or new dependencies. Tenant scope derives from trusted existing contexts. Validation and contract review evidence will be recorded on the PR; incomplete gates block approval.

## Changelog

- 2026-11-18: Documented #9135 lifetime correction, tenant resolution, destination policy, regression coverage and security migration gate.
