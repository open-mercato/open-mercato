# Codabox CODA Integration

## TLDR

Add an opt-in `packages/codabox` module that retrieves CODA files (coded daily bank statements) from Codabox via the Codabox Connect API (V2), parses them, and stores/exposes them inside Open Mercato. Scope for v1 is **CODA only**, and v1 is **self-contained**: it retrieves, stores, and exposes CODA statements on its own tenant-scoped rows with no dependency on a finance or Cash & Bank module. Feeding a downstream bank-statement store (Cash & Bank Management's planned `createBankStatement`, or the planned finance module's reconciliation) is a **future optional consumer**, soft-optional and degrading gracefully when absent. Credentials are stored through the shared integration-credentials service: encrypted when tenant data encryption is enabled, fail-closed on a KMS/Vault outage, and — matching the operator opt-out documented in the referenced encryption spec — stored in plaintext when encryption is disabled, with the connection UI warning the operator in that case. A scheduled/queued background job polls Codabox for new files and ingests them idempotently. **Hard business prerequisite:** implementation cannot start until the Open Mercato organisation is approved as a Codabox Connect partner (helpdesk onboarding), which is the only step the proposers cannot perform themselves.

## Problem Statement

Belgian customers receive their bank statements as CODA files collected by Codabox (Wolters Kluwer) from their banks under customer mandates, and today must import those files manually. There is no automated path to pull CODA statements into Open Mercato for reconciliation. We want an automated, consented, per-tenant retrieval of CODA files that fits the existing third-party integration conventions in this repo.

## Proposed Solution

Ship a separate, opt-in integration module package:

- **Package:** `packages/codabox`, module id `codabox` (snake_case module conventions). Install/enable only when a tenant needs it.
- **Credentials:** Codabox Connect partner/consumer credentials stored via the shared `integrationCredentialsService` (see prior art). No new credential storage path, and no change to the global credentials contract for this provider. Its behavior follows the mode the operator selected:
  - **Encryption enabled** — credentials are sealed with the tenant DEK before storage.
  - **Encryption disabled** (`TENANT_DATA_ENCRYPTION=no`) — the shared service stores credentials in plaintext by design (operator opt-out, per the referenced encryption spec's September amendment). Codabox follows this opt-out rather than forcing encryption, but surfaces a clear "credentials stored unencrypted" warning on the connection screen so the operator accepts the tradeoff knowingly. Secret-bearing fields still use `secret`/`oauth` types so logs redact them regardless of mode.
  - **Encryption unavailable** (KMS/Vault down, or a blob sealed before encryption was switched off) — the service throws; the module treats this as fail-closed and does not save/read credentials until it recovers.
- **Connection + consent surface:** per-tenant / per-company connection and consent status in the UI, mirroring MyCodabox consent states (`Allowed` / `Denied` / `To be determined` / `Cancelled`).
- **Background sync:** a `data_sync` adapter, scheduled via `packages/scheduler` + `packages/queue`, polls Codabox Connect's ordered feed, parses each CODA file, and stores it durably **before** advancing the feed offset (commit-before-advance), idempotent on a durable document identity, with one cursor per connection+feed. See Durable Ingestion & Feed Acknowledgement.
- **Statement storage (v1 = self-contained).** v1 stores the retrieved CODA files and parsed metadata in the Codabox module's own tenant-scoped rows and exposes them through its own read/download surface. v1 is independently useful as raw-CODA retrieval/storage/exposure and does **not** require any finance or Cash & Bank module to exist.
- **Downstream reconciliation (future, optional).** Feeding a statement store (Cash & Bank Management's `createBankStatement`, or the finance module's reconciliation) is a future optional consumer, not a v1 dependency — see Downstream Consumer below.
- **Internal API/commands:** expose per-file ingestion status/audit and the stored statements for operability and downstream consumption. No changes to core API routes.

**Out of scope for v1 (later increments):** SODA, CARO, and purchase/sales e-invoices.

### Packaging options

The retrieval/consent/credentials machinery is the same regardless of where it lives; the open decision is where the module sits:

- **Standalone opt-in package (preferred):** `packages/codabox`, installed/enabled only when a tenant needs it. Keeps a Belgium-specific, partner-gated integration out of core.
- **Folded into another module:** fold CODA retrieval into a broader module such as the **planned** finance module (`SPEC-024-2026-02-11-financial-module.md`, status: Specification). This option is not currently actionable — that module is planned, not implemented (no `modules/financial` exists at this head) — and it would bundle a region-specific, partner-gated dependency into a broad module most tenants don't need. Recorded for completeness only.

Recommendation: ship as the standalone `packages/codabox` package, self-contained in v1.

### Downstream Consumer (future, optional)

Bank-statement reconciliation is a **future optional consumer** of Codabox output, not a v1 dependency. Two planned owners have been proposed and neither exists at this reviewed head:

- **Cash & Bank Management** (issue #6055; @mikoajp's comment on #7256 names it as the intended statement owner) — proposed `createBankStatement` command. Its referenced spec file and an implemented consumer are **not present** at this head.
- **Finance module** (`SPEC-024`, status: Specification) — planned reconciliation, not implemented.

The command signature suggested in the #7256 discussion is a **design proposal, not an available runtime API**, and must not be treated as callable prior art:

```
// PROPOSED (not implemented) — Cash & Bank Management #6055
createBankStatement({ bankAccountId, statementDate, openingBalance, closingBalance,
  lines: [{ lineDate, amount, description }] })
```

**Handoff model (consumer-owned, soft-optional).** Following the cross-module optional-integration convention, the *consumer* owns the glue: when Cash & Bank (or finance) ships, it subscribes to the Codabox `codabox.statement.ingested` event (or reads the module's internal statement API) and calls its own `createBankStatement`. The Codabox module does **not** hard-require, import, or unconditionally resolve a downstream service. If no consumer is present, Codabox stores and exposes statements on its own rows and the event is simply unconsumed — nothing fails, nothing is lost. The mapping concerns below (dedup, account→`bankAccountId`) therefore sit at the consumer boundary; v1 owns dedup for its own store, and account mapping becomes relevant only when a consumer that needs `bankAccountId` exists.

### Mapping CODA onto a future statement command

When a downstream consumer with a `createBankStatement`-style command exists, two seams (both flagged in review, both open) must be settled at that boundary:

- **Idempotency / duplicate-statement guard.** v1 already enforces uniqueness in its own store on the durable document identity (see Durable Ingestion), so re-fetches are no-ops regardless of any downstream consumer. If a future `createBankStatement` has no dedup of its own, the consumer-side handoff keys off the same identity so it cannot double-import.
- **Account-number → `bankAccountId` mapping.** A CODA file identifies the account by its bank account number (IBAN); a `createBankStatement`-style command needs an internal `bankAccountId`. This mapping belongs to the **consumer** (Cash & Bank / finance), which owns `BankAccount`. v1 does not resolve `bankAccountId` and does not need one — it stores the raw account number as delivered. When a consumer ships, it resolves the number to its own `BankAccount` via an explicit, tenant-scoped mapping and surfaces an actionable error on an unresolved account rather than silently dropping.

### Authorization layers

Codabox Connect V2 separates two credential tiers, and both are distinct from a consent label:

1. **Software-company key** — the partner key identifying Open Mercato as the integrator. Obtained via helpdesk onboarding (`helpdesk@codabox.com`, Andy Cobbaut); there is no self-service signup. Tenant-wide for the installation.
2. **Customer/fiduciary credentials** — per end-customer (or per-fiduciary) credentials obtained through a one-use token exchange. A permitted fiduciary identity can cover multiple client companies, so these credentials are **not** 1:1 with an Open Mercato organization.
3. **Per-customer consent** — the MyCodabox consent status (`Allowed` / `Denied` / `To be determined` / `Cancelled`). An `Allowed` label alone is **not** authorization to import: it only means the customer permits document retrieval, not that a given remote company/feed belongs to the Open Mercato organization doing the import.

Because of tier 2, authorization is not "partner approval + Allowed." The module must bind each remote Codabox company/feed to a trusted Open Mercato tenant+organization and gate fetching on that binding — see the Connection Model.

### Connection Model

`IntegrationScope` carries `{ organizationId, tenantId, userId? }` only — there is no company/fiduciary dimension, so the remote Codabox identity cannot ride on the scope automatically. The Codabox module owns an explicit connection entity that supplies it.

- **Connection entity (module-owned, tenant-scoped).** One row per bound remote company/feed: `{ id, tenantId, organizationId, codaboxCompanyId, fiduciaryId?, consentStatus, connectedByUserId, connectedAt, status }`. It maps a remote Codabox company/feed to exactly one trusted `(tenantId, organizationId)`. The sync service derives the trusted scope from this row — never from the CODA file or an arbitrary request input. A file whose remote company has no active connection for the resolving scope is rejected, not imported.
- **Establishing/replacing a binding.** Creating or re-pointing a connection requires `codabox.connect` and is only allowed within the caller's authenticated tenant+organization; the remote company is confirmed through the token exchange, not typed in. Replacing an existing binding is an explicit, audited action (records `connectedByUserId` + timestamp) so a fiduciary covering multiple clients cannot silently redirect another organization's feed.
- **Credential storage.** The software-company key is stored tenant-wide; customer/fiduciary credentials are stored per connection via the shared `integrationCredentialsService`. Secret-bearing fields use `secret`/`oauth` types (never `text`/`url`) so they redact in logs. Storage mode follows the encryption rules in the Credentials section.
- **Token-exchange recovery.** The one-use exchange token is consumed immediately; if persisting the resulting credentials fails after the token is spent, the module marks the connection `needs_reauth` and surfaces a re-connect action rather than leaving a half-bound row. It never retries with a spent token.
- **Feature guards.** Distinct ACL features gate each capability: `codabox.connect` (establish/replace a binding), `codabox.sync.manage` (enable/disable or trigger the poller), `codabox.statements.view` (list ingested statements/status), `codabox.files.download` (download the raw CODA file). Fetching runs only for connections whose `consentStatus = Allowed` **and** which resolve to the acting organization.

### Durable Ingestion & Feed Acknowledgement

Codabox delivers documents on ordered per-feed queues: advancing `feed_offset` acknowledges entries and **permanently removes** the acknowledged one and everything before it, and the offset cannot move backward. So an offset must never advance past a document the module has not durably stored, or that statement is unrecoverable (except via the separate redownload feed, which is bounded). The commit order and dedup rule are therefore part of the contract, not an implementation detail.

- **Runner choice.** Use the existing `data_sync` adapter lifecycle (register a `DataSyncAdapter`) rather than a provider-owned runner. It already gives per-batch cursor persistence, resume-from-cursor, overlap detection (same integration+entityType+direction), and queue-based retry — exactly the durability primitives this needs. The Codabox specifics (feed paging, offset ack) live in the adapter's `streamImport`.
- **Commit-before-advance ordering (per document, in order).** For each feed entry: (1) persist the raw CODA file + its parsed metadata to the Codabox module's own store, committed; (2) only then acknowledge that entry by advancing `feed_offset`. (Any downstream consumer handoff happens after the store commit and is never a precondition for the ack — v1 has no consumer.) The adapter yields a batch boundary **after** storage commits and **before** the offset advances, so the engine's per-batch cursor persistence records the pre-advance position. The offset is never advanced for a document whose storage transaction has not committed.
- **Durable document identity / uniqueness.** Each ingested document is keyed by a durable natural key independent of feed position — `(connectionId, codaboxDocumentId)` plus the CODA statement natural key (account + statement date + sequence). A unique constraint makes re-ingestion a no-op. Dedup keys off this identity, **not** off `feed_offset`, because offsets are consumed on ack and cannot be replayed.
- **Crash replay.**
  - *Crash before ack (after store):* the document is already stored; on restart the feed re-delivers it (offset didn't advance). The uniqueness rule turns the re-store into a no-op and the module re-acknowledges — no duplicate local import.
  - *Crash after ack (before next store):* the acknowledged entry is gone from the feed, but it was stored before the ack by rule (1), so nothing is lost. The next poll resumes at the new offset.
  - *Never:* advance the offset, then store. That order is the one unrecoverable-skip path and is explicitly disallowed.
- **Concurrent polls.** Only one in-flight run per connection+feed is allowed — enforced by `data_sync` overlap detection plus a per-connection lock — so two pollers can't both read-and-advance the same feed and skip entries. A second trigger no-ops while one is running.
- **Feed offset partitioning (the `SyncCursor` gap).** The shared `SyncCursor` unique key is `(integrationId, entityType, direction, organizationId, tenantId)` — it has **no company field**, so one Codabox integration serving multiple remote companies in one org would otherwise collide on a single cursor row. v1 avoids schema change to the shared contract by partitioning within the keyed columns: encode the remote company/feed in `entityType` as `codabox.coda:<connectionId>` (connectionId is stable and already org-scoped), keeping one `SyncCursor` row per connection+feed while the `cursor` value holds the opaque Codabox `feed_offset`. The cursor is operator-visible, so it carries only the offset token — no credentials or personal data. *(Alternative if we'd rather not overload `entityType`: ask the `data_sync` owners to add an optional company/partition column to `SyncCursor` — a shared-contract change, so it's Ask-First and out of v1 scope.)*
- **Mixed-feed / non-CODA policy.** A feed may carry non-CODA deliveries (SODA, CARO, e-invoices), which v1 does not handle. The adapter classifies each entry by document type: **CODA → ingest**; **non-CODA → acknowledge-and-skip is NOT allowed in v1** because advancing past an unstored SODA/CARO entry would permanently consume a delivery the customer expects later. Instead v1 **stops the feed at the first non-CODA entry** and surfaces it as an actionable connection error, rather than silently consuming unrelated documents. (When SODA/CARO land in a later increment they become ingestible types and the feed advances normally.) This keeps "filter to CODA" from meaning "discard everything else."

### Statement Payload Protection

CODA files and the movements extracted from them are sensitive banking data, so the payload — not just the API credentials — needs an explicit at-rest and access model. Credential encryption does not protect these bytes.

- **What v1 stores.** Both: (1) the **raw CODA file** (needed for audit, re-parse, and the `codabox.files.download` path) and (2) **parsed statement data + metadata** on the Codabox module's own rows (durable document identity, statement date, account reference, opening/closing balances, movement lines, dedup/ack bookkeeping). In v1 the Codabox store is the authoritative home for the parsed statement; a future reconciliation consumer, when present, copies from it rather than replacing it.
- **Owner & storage.** The Codabox module owns these rows. Raw files are stored through the public `attachmentService` DI contract (imported from `@open-mercato/core/modules/attachments`) on a **private, non-public partition** — never a `is_public` partition and never a global (both-null) attachment. Every attachment row is **fully scoped**: `assertAttachmentScopeInvariant({ tenantId, organizationId })` is called before persisting, so no partial-null or global row is created. Uploads from the worker go through `attachmentService.readUploadForm()` where a request stream is involved.
- **Read boundary.** Every read of a raw file goes through `checkAttachmentAccess` — no code path (worker, download route, diagnostics) reads attachment bytes directly. The download route additionally requires `codabox.files.download` and resolves the owning connection's `(tenantId, organizationId)`, so a caller can only download files for their own organization's bound connections.
- **Sensitive-metadata encryption.** The Codabox metadata rows declare an `encryption.ts` `defaultEncryptionMaps` entry for the sensitive fields (account reference, counterparty/communication text, amount/balance details) and are read via `findWithDecryption`/`findOneWithDecryption`. A deployed module ships a `buildEncryptionMapBackfillSql` migration so existing tenants are covered. Diagnostics, logs, and operator-visible fields (run cursor, sync-run parameters) carry **no** statement content — only opaque identifiers — so nothing leaks through a plaintext diagnostic payload.
- **Retention.** Raw files and metadata are retained per a tenant-configurable retention window (default bounded, not indefinite); expiry permanently deletes the bytes via `attachmentService.releaseScoped()` with the exact owner/assignment/partition/scope (DB removal committed before provider cleanup). Deleting a connection cascades to its stored files and metadata under the same path.

## Hard Prerequisite / Blocker

This is a **business blocker, not a technical one.** The Codabox Connect API is partner-gated. Implementation of this module cannot begin until the Open Mercato organisation completes Codabox partner onboarding and obtains API credentials via the helpdesk contact above. The proposers will implement the module following the spec-driven workflow and existing integration conventions; the partner onboarding is the single dependency they cannot complete themselves.

### Not a prerequisite: downstream reconciliation consumer

v1 does **not** depend on any finance or Cash & Bank module. The only hard prerequisite is Codabox partner onboarding (above); v1 ships as self-contained raw-CODA retrieval/storage/exposure. Neither the Cash & Bank Management spec (#6055) nor an implemented `createBankStatement` consumer exists at this head, and the finance module (`SPEC-024`) is planned, not implemented — so neither is available prior art to depend on.

If a stronger coupling is ever desired (Codabox pushing directly into a statement store rather than the consumer pulling), that would make the consumer's implementation and its ingestion contract an **additional, explicit prerequisite** — call it out and align then. v1 deliberately avoids that by using the consumer-owned, soft-optional handoff (see Downstream Consumer). When Cash & Bank or finance ships, confirm with its owners: the real command signature, whether CODA is a supported source (its roadmap lists Phase 1 manual / Phase 2 MT940·CAMT·BAI2 with CODA not yet listed), and consumer-side ownership of account→`bankAccountId` mapping.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| Partner onboarding not completed, so no credentials exist. | High (blocker) | Whole module | Treat as hard prerequisite; do not start implementation until credentials are obtained. | Timeline depends on Codabox helpdesk response. |
| Fetching for a company without current `Allowed` consent. | High | Compliance / data access | Consent gate in sync service; refresh status before each run; skip non-allowed companies. | Consent can change between poll cycles; mitigated by re-checking each run. |
| Importing another company's statements into the selected organization (a fiduciary covers many clients; `Allowed` alone is not ownership). | High | Cross-tenant / cross-org data isolation | Bind each remote company/feed to one trusted `(tenantId, organizationId)` via the connection entity; sync derives scope from that binding, not the file; reject files whose remote company has no active connection for the scope. | Depends on operators establishing bindings correctly; binding create/replace is `codabox.connect`-gated and audited. |
| Credentials lost after the one-use token is spent (persistence failure). | Medium | Connection integrity | Mark the connection `needs_reauth` and surface a re-connect action; never retry with a spent token. | Operator must re-run the token exchange to restore the connection. |
| Credential exposure at rest. | High | Credentials storage | Reuse the shared `integrationCredentialsService`: sealed with the tenant DEK when encryption is enabled, fail-closed when KMS/Vault is unavailable. No new storage path. | When the operator disables encryption, the shared service stores credentials in plaintext by design — the module honors that opt-out and warns on the connection screen rather than overriding the global contract. |
| Codabox API/rate-limit outages. | Medium | Sync job | Backoff + retry via queue; surface connection status in UI. | Delayed statement availability during outages. |
| Same statement ingested twice (re-fetch / retry). | Medium | Data integrity (statement store) | Dedup guard on the durable document identity (`connectionId` + Codabox document id + CODA natural key); re-ingestion is a no-op. | Depends on the natural key being stable across Codabox deliveries. |
| Feed offset advanced past an unstored document → permanently skipped statement. | High | Data loss (irreversible) | Commit-before-advance: the Codabox store commit precedes the offset ack; never advance before store. Redownload feed is the only (bounded) recovery. | Residual only if Codabox prunes the redownload feed before an operator notices a store-side outage. |
| Concurrent polls on the same feed race the offset and skip entries. | Medium | Data loss | One in-flight run per connection+feed via `data_sync` overlap detection + per-connection lock; second trigger no-ops. | None if the lock holds across process restarts. |
| Mixed feed silently consumes non-CODA deliveries (SODA/CARO/e-invoices). | High | Data loss (other document types) | v1 stops the feed at the first non-CODA entry and raises an actionable error instead of acknowledging-and-skipping. | Feed stalls until a later increment ingests those types; acceptable vs. losing them. |
| Raw statement bytes exposed via a public/global file path. | High | Data exposure (banking data at rest) | Store raw CODA files through `attachmentService` on a private, fully-scoped partition (`assertAttachmentScopeInvariant`, never `is_public`/global); gate every read through `checkAttachmentAccess`; download route requires `codabox.files.download` + owning-connection scope. | Depends on never adding a read path that bypasses `checkAttachmentAccess`. |
| Sensitive statement metadata stored plaintext or leaked in diagnostics. | High | Data exposure | Encrypt sensitive metadata fields via `encryption.ts` maps + `findWithDecryption`; keep statement content out of cursors, run parameters, and logs (opaque identifiers only). | Inherits the shared tenant-encryption threat model; disabled-encryption mode stores plaintext (see Credentials). |
| Building v1 against a finance / Cash & Bank consumer that does not exist yet (SPEC-024 is planned; #6055 spec and `createBankStatement` absent at this head). | High | Architecture / scope | v1 is self-contained (own store + exposure) and treats reconciliation as a future optional consumer with a consumer-owned soft-optional handoff; no hard dependency, no call to an unavailable API. | If a consumer later wants push-style ingestion, its implementation + contract become an explicit prerequisite to align then. |
| Account number cannot be mapped to a `BankAccount` (consumer-side, future). | Medium | Reconciliation correctness (downstream) | Mapping is owned by the consumer when it ships; v1 stores the raw account number and does not need `bankAccountId`. | Deferred to the consumer; not a v1 concern. |

## Final Compliance Report

- New opt-in module package only; no changes to core required.
- No core API route, DB schema, or DI contract changes.
- v1 is self-contained: Codabox stores retrieved CODA files + parsed metadata on its own tenant-scoped rows and exposes them; no dependency on a finance or Cash & Bank module (neither exists at this head).
- Reconciliation is a future optional consumer via a consumer-owned soft-optional handoff (event / internal API); Codabox never hard-requires, imports, or unconditionally resolves a downstream service, and degrades to "store + expose only" when none is present. No direct cross-module ORM relationship.
- Credentials reuse the shared `integrationCredentialsService` unchanged: encrypted when enabled, fail-closed when unavailable, plaintext when the operator has disabled encryption (opt-out honored, warned in the UI). No change to the global credentials contract for this provider.
- All entities and routes are tenant-scoped; no cross-tenant exposure; no direct cross-module ORM relationships.
- Each remote Codabox company/feed is bound to one trusted `(tenantId, organizationId)` via a module-owned connection entity; fetch scope derives from that binding, never from the CODA file or request input. Consent `Allowed` is necessary but not sufficient — the binding must also resolve to the acting organization.
- Two credential tiers modeled explicitly (software-company key tenant-wide; customer/fiduciary credentials per connection); secret fields use `secret`/`oauth` types.
- Capabilities gated by distinct features: `codabox.connect`, `codabox.sync.manage`, `codabox.statements.view`, `codabox.files.download`.
- Ingestion uses the `data_sync` adapter lifecycle with commit-before-advance: documents are stored durably before the irreversible feed-offset ack; dedup keys off a durable document identity, not the offset.
- No change to the shared `SyncCursor` contract in v1: per-connection+feed cursors are partitioned by encoding `connectionId` in `entityType`; the `cursor` holds the opaque `feed_offset` only. Adding a company column to `SyncCursor` is a deferred, Ask-First shared-contract change.
- Mixed-feed safety: v1 stops at the first non-CODA entry rather than acknowledging-and-skipping, so filtering to CODA never consumes unrelated deliveries.
- Statement payload (not just credentials) protected at rest: raw CODA files stored via `attachmentService` on a private, fully-scoped partition (`assertAttachmentScopeInvariant`, never `is_public`/global, read only through `checkAttachmentAccess`); sensitive metadata encrypted via `encryption.ts` maps + `findWithDecryption`; download gated by `codabox.files.download` + owning-connection scope; bounded retention with `releaseScoped()` deletion. No statement content in cursors, run parameters, or logs.
- v1 scope limited to CODA; SODA/CARO/e-invoices explicitly deferred.
- No external runtime dependency in v1. The `createBankStatement` command named in the #7256 discussion is a design proposal, not an available API, and is not called by v1. Any future consumer coupling confirms the real signature and CODA support with that module's owners at that time.
- To be completed at implementation time: final entity columns, validators, exact route paths, ACL feature ids, the CODA durable-identity dedup definition, the module's own statement read/download surface, and integration coverage for all affected API/UI paths.

## Coordination with a future reconciliation consumer

Codabox v1 is self-contained: it retrieves, stores, and exposes CODA statements on its own rows and does **not** depend on Cash & Bank. Reconciliation is a future optional consumer — when Cash & Bank ships, it would subscribe to `codabox.statement.ingested` (or read our internal statement API) and call its own `createBankStatement`. The consumer owns that glue and the account→`bankAccountId` mapping; we own dedup for our own store.

To confirm when that module lands (not a v1 blocker):

1. The real `createBankStatement` signature (the `{ bankAccountId, statementDate, openingBalance, closingBalance, lines }` shape from the #7256 thread is a proposal, not something we call yet).
2. Whether CODA is a supported source — the roadmap lists Phase 1 manual / Phase 2 MT940·CAMT·BAI2 with CODA not yet listed.
3. That the consumer owns account→`bankAccountId` mapping and its own duplicate rejection.

Separately, the hard blocker still stands: implementation can't start until Open Mercato is approved as a Codabox Connect partner and credentials are issued.

## References

- Future optional consumer (planned, not implemented at this head) — Cash & Bank Management: issue #6055 / @mikoajp's comment on #7256; proposed `createBankStatement` command (design proposal, not an available API)
- Future optional consumer (planned) — finance module: `.ai/specs/SPEC-024-2026-02-11-financial-module.md` (status: Specification)
- Prior art — encrypted credentials pattern: `.ai/specs/implemented/2026-05-29-integrations-credentials-encryption-fail-closed.md`
- Prior art — integration module layout: `packages/sync-akeneo/`
- Scheduler/queue packages: `packages/scheduler`, `packages/queue`
- Codabox developer docs (V2): https://doc.codabox.com/
- Codabox partner onboarding contact: `helpdesk@codabox.com` (Andy Cobbaut, Customer Support)

## Changelog

- 2026-10-18 — Revised per design review (unpublished draft): v1 is now self-contained raw-CODA retrieval/storage/exposure, with reconciliation (Cash & Bank #6055 / planned finance module) as a future optional, consumer-owned soft-optional handoff rather than a dependency. Added a V2 two-tier credential + connection model binding each remote company/feed to one trusted tenant+organization, corrected the credential-storage claim to the real enabled/disabled/unavailable behavior, specified durable ingestion against the ordered feed (commit-before-advance, durable document identity, crash replay, mixed-feed policy, `data_sync` lifecycle), and defined statement-payload protection at rest (private `attachmentService` partition, encrypted metadata, scoped download).
- 2026-10-15 — Initial draft spec for the opt-in Codabox CODA integration module (v1: CODA only).
