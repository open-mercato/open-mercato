# Codabox CODA Integration

## TLDR

Add an opt-in `packages/codabox` module that retrieves CODA files (coded daily bank statements) from Codabox via the Codabox Connect API (V2) and exposes them inside Open Mercato for bank reconciliation / financial import. Scope for v1 is **CODA only**. Credentials are stored through the existing encrypted integration-credentials mechanism (fail-closed). A scheduled/queued background job polls Codabox for new files and ingests them. **Hard business prerequisite:** implementation cannot start until the Open Mercato organisation is approved as a Codabox Connect partner (helpdesk onboarding), which is the only step the proposers cannot perform themselves.

## Problem Statement

Belgian customers receive their bank statements as CODA files collected by Codabox (Wolters Kluwer) from their banks under customer mandates, and today must import those files manually. There is no automated path to pull CODA statements into Open Mercato for reconciliation. We want an automated, consented, per-tenant retrieval of CODA files that fits the existing third-party integration conventions in this repo.

## Proposed Solution

Ship a separate, opt-in integration module package:

- **Package:** `packages/codabox`, module id `codabox` (snake_case module conventions). Install/enable only when a tenant needs it.
- **Credentials:** Codabox Connect partner/consumer credentials stored via the existing integration-credentials encryption mechanism (see prior art), inheriting its fail-closed behavior. No new credential storage path.
- **Connection + consent surface:** per-tenant / per-company connection and consent status in the UI, mirroring MyCodabox consent states (`Allowed` / `Denied` / `To be determined` / `Cancelled`).
- **Background sync:** a scheduled job (via `packages/scheduler` + `packages/queue`) polls Codabox Connect for new CODA files and ingests them, idempotently, with a per-company cursor.
- **Internal API/commands:** list and expose fetched CODA statements for downstream reconciliation; no changes to core API routes.

**Out of scope for v1 (later increments):** SODA, CARO, and purchase/sales e-invoices.

### Packaging options

The retrieval/consent/credentials machinery is the same regardless of where it lives; the open decision is where the module sits:

- **Standalone opt-in package (preferred):** `packages/codabox`, installed/enabled only when a tenant needs it. Keeps a Belgium-specific, partner-gated integration out of core.
- **Part of the finance module:** fold CODA retrieval into the existing financial module (`SPEC-024-2026-02-11-financial-module.md`) since CODA statements feed bank reconciliation directly. This co-locates ingestion with its primary consumer and may simplify the reconciliation data flow, but it bundles a region-specific, partner-gated dependency and its sync workers into a broader module that most tenants don't need.

Recommendation: ship as the standalone `packages/codabox` package and expose fetched statements to the finance module via FK-id reference + the module's internal API (no direct cross-module ORM relationship), preserving the opt-in boundary while still feeding reconciliation. Final call to be confirmed before implementation.

### Authorization layers

Two distinct, independent authorization layers apply and must both be satisfied before any statement is fetched:

1. **Partner/consumer approval** — Open Mercato must be authorised by Codabox. This is obtained by contacting `helpdesk@codabox.com` (Andy Cobbaut, Customer Support); there is no self-service signup. API credentials come from this step.
2. **Per-customer consent** — each end customer grants consent for their documents via MyCodabox (Administration → Codabox Connect). The module must honor the current consent status and never fetch for a company whose consent is not `Allowed`.

## Hard Prerequisite / Blocker

This is a **business blocker, not a technical one.** The Codabox Connect API is partner-gated. Implementation of this module cannot begin until the Open Mercato organisation completes Codabox partner onboarding and obtains API credentials via the helpdesk contact above. The proposers will implement the module following the spec-driven workflow and existing integration conventions; the partner onboarding is the single dependency they cannot complete themselves.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| Partner onboarding not completed, so no credentials exist. | High (blocker) | Whole module | Treat as hard prerequisite; do not start implementation until credentials are obtained. | Timeline depends on Codabox helpdesk response. |
| Fetching for a company without current `Allowed` consent. | High | Compliance / data access | Consent gate in sync service; refresh status before each run; skip non-allowed companies. | Consent can change between poll cycles; mitigated by re-checking each run. |
| Credential exposure at rest. | High | Credentials storage | Reuse existing encrypted integration-credentials mechanism (fail-closed); no new storage path. | Inherits the shared encryption threat model. |
| Codabox API/rate-limit outages. | Medium | Sync job | Backoff + retry via queue; surface connection status in UI. | Delayed statement availability during outages. |

## Final Compliance Report

- New opt-in module package only; no changes to core required.
- No core API route, DB schema, or DI contract changes.
- Credentials reuse the existing encrypted, fail-closed integration-credentials mechanism.
- All entities and routes are tenant-scoped; no cross-tenant exposure; no direct cross-module ORM relationships.
- v1 scope limited to CODA; SODA/CARO/e-invoices explicitly deferred.
- To be completed at implementation time: final entity columns, validators, exact route paths, ACL feature ids, and integration coverage for all affected API/UI paths.

## References

- Prior art — encrypted credentials pattern: `.ai/specs/implemented/2026-05-29-integrations-credentials-encryption-fail-closed.md`
- Prior art — integration module layout: `packages/sync-akeneo/`
- Scheduler/queue packages: `packages/scheduler`, `packages/queue`
- Codabox developer docs (V2): https://doc.codabox.com/
- Codabox partner onboarding contact: `helpdesk@codabox.com` (Andy Cobbaut, Customer Support)

## Changelog

- 2026-10-15 — Initial draft spec for the opt-in Codabox CODA integration module (v1: CODA only).
