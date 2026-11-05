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

The command signature in the Cash & Bank Management spec (#6055) is still a **spec-level design, not an available runtime API** — that spec is unmerged and the command is not implemented — so it must not be treated as callable prior art. As confirmed in the #7443 review it is:

```
// SPEC-LEVEL (not implemented) — Cash & Bank Management #6055
createBankStatement({ bankAccountId, statementDate, openingBalance, closingBalance,
  lines: [{ lineDate, amount, description }] })
// requires feature: cash_bank_management.statements.manage
// rejects an unknown bankAccountId; stores lines unmatched
```

**Handoff model (consumer-owned, soft-optional).** Following the cross-module optional-integration convention, the *consumer* owns the glue: when Cash & Bank (or finance) ships, it subscribes to the Codabox `codabox.statement.ingested` event **and/or** reads the module's internal statement API, resolves the account, and calls its own `createBankStatement` under `cash_bank_management.statements.manage`. The Codabox module does **not** hard-require, import, or unconditionally resolve a downstream service. If no consumer is present, Codabox stores and exposes statements on its own rows and the event is simply unconsumed — nothing fails, nothing is lost. The mapping concerns (dedup, account→`bankAccountId`) sit at the consumer boundary; v1 owns dedup for its own store and publishes the identifiers the consumer needs to do its own dedup and account lookup. The exact event payload and read-API cursor contract — settled with the Cash & Bank reviewers — are defined in **Downstream Consumer Contract** below.

### Mapping CODA onto a future statement command

When a downstream consumer with a `createBankStatement`-style command exists, two seams (flagged in review) are settled at that boundary; the concrete payload/API shape is in **Downstream Consumer Contract** below.

- **Idempotency / duplicate-statement guard.** v1 enforces uniqueness in its own store on the **per-statement** identity (`statementId`, derived from `codaboxDocumentId` + statement sequence + account + currency; see Durable Ingestion and the payload below), so re-fetches are no-ops per statement regardless of any downstream consumer — including the multi-statement case where one file carries several statements. Cash & Bank plans to add an optional external id, unique per source and bank account, so a repeated `createBankStatement` is a no-op on their side too. v1 therefore **publishes a stable per-statement `statementId`** (the same identity it dedupes on) in both the event and the read API, so the consumer can key its own external id off it. This makes event-or-pull redelivery (point 2 below) safe: a repeated ingest is harmless end-to-end.
- **Account-number → `bankAccountId` mapping.** A CODA file identifies the account by its IBAN; a `createBankStatement`-style command needs an internal `bankAccountId`. This mapping belongs to the **consumer** (Cash & Bank / finance), which owns `BankAccount`. v1 does not resolve `bankAccountId` and does not need one. Two consumer-side details confirmed in review shape what v1 must publish: (a) one IBAN can back several bank accounts (e.g. one per currency), so the lookup needs **IBAN + statement currency**, not IBAN alone; (b) the consumer stores the account number encrypted and looks it up by a deterministic hash. v1 therefore emits the **normalised IBAN** and the **statement currency**; the consumer derives its own hash and resolves the account. On zero or multiple matches the consumer rejects and reports rather than guessing — v1 does not need to know the outcome.

### Downstream Consumer Contract (settled with Cash & Bank review)

This is the stable handoff surface a reconciliation consumer (Cash & Bank #6055, or the planned finance module) depends on. It is **additive** — Codabox owns and versions it; the consumer reads it. Codabox still works with no consumer present.

**Two delivery channels, both idempotent.** The consumer may use either or both; a repeated or lost delivery is harmless because every statement carries a stable id and the consumer dedupes on it.

1. **Event (trigger):** `codabox.statement.ingested`, emitted after the store commit (and after the feed-offset ack, so an event never references a statement that isn't durably stored). Events can be lost or redelivered; treat the event as a hint to pull, not the source of truth.
2. **Read API (source of truth):** list statements since an opaque cursor (`?since=<cursor>&limit=<n>`, `limit` ≤ 100), tenant-scoped and gated by `codabox.statements.view`. Returns statements in ingestion order with the same payload as the event plus the next cursor, so a consumer that missed events reconciles by replaying from its last cursor.

**Document-to-statements cardinality.** One CODA file (document) can contain **several statements**. The Codabox V2 CODA contract exposes `first_statement_number` through `last_statement_number` per file, and a single file commonly carries one statement per account/day, so `codaboxDocumentId` alone is **not** a statement identity — keying on it would make the second statement in a multi-statement file look like a replay of the first and be discarded. v1 therefore publishes a **document envelope with individually identified statements**, and both delivery channels and the local uniqueness constraint key on the **per-statement** id below, never on `codaboxDocumentId` alone.

**Per-statement stable identity.** Each statement carries a `statementId` that is stable across redownloads of the same file and unique within a document:

```
statementId = hash(codaboxDocumentId, statementSequence, accountIban, currency, subAccount?)
```

- `statementSequence` is the CODA statement number within the file (`first_statement_number..last_statement_number`), so two statements in one file get distinct ids.
- `accountIban` + `currency` (+ optional `subAccount`) scope the id so the same sequence for different accounts/currencies in a mixed file never collides.
- **Redownload equivalence:** a redownload of the same file through the bounded redownload feed re-derives the identical `statementId` for each statement (same inputs → same hash), so re-ingestion is a no-op per statement, not just per document. `codaboxDocumentId` remains on the envelope for provenance and as the consumer's grouping key, but is not the dedup key.

**Payload (document envelope; event and read API share one shape).** The event/read unit is one document carrying its statements; the consumer dedupes per `statementId`:

```
{
  codaboxDocumentId,          // stable CODA-document id (provenance / grouping); NOT the dedup key
  connectionId,               // owning Codabox connection (org-scoped)
  tenantId, organizationId,   // trusted binding scope (from the connection, never from the file)
  statements: [{
    statementId,              // stable per-statement id (above) — the dedup key for BOTH channels and local uniqueness
    statementSequence,        // CODA statement number within the file
    accountIban,              // normalised IBAN — consumer resolves bankAccountId from (accountIban, currency)
    currency,                 // statement currency — required for the IBAN→account lookup (one IBAN, many accounts)
    subAccount?,              // when the file distinguishes sub-accounts
    statementDate,
    openingBalance, closingBalance,
    lines: [{
      valueDate,              // bank value date
      bookingDate,            // = lineDate for createBankStatement
      amount,                 // signed
      description,
      counterpartyAccount?,   // counterparty IBAN/account, when present
      counterpartyName?,      // when present
      structuredCommunication? // structured/free communication, when present
    }]
  }]
}
```

**Multi-statement example.** A single file `codaboxDocumentId = "doc-A"` carrying two statements — sequence 1 for `BE68…` in EUR and sequence 2 for the same IBAN in USD — yields two envelope entries with distinct `statementId`s (`hash(doc-A,1,BE68…,EUR)` and `hash(doc-A,2,BE68…,USD)`); a redownload of `doc-A` re-emits the same two ids and the consumer discards both as replays while keeping each as a separate statement. The second statement is never collapsed into the first.

Rationale from review: Cash & Bank's line today is `{ lineDate, amount, description }`. The extra fields (`valueDate`, `counterpartyAccount`, `counterpartyName`, `structuredCommunication`) are forward-looking for automatic matching; until the consumer models them it folds them into `description`, so emitting them now costs nothing and avoids a later contract bump. `bookingDate` maps to the consumer's `lineDate`. The consumer keys its optional external id (unique per source + bank account) off `statementId`, which already encodes account + currency + sequence, so two statements for the same account in one file are two distinct external ids, not a collision. No statement content appears in cursors, run parameters, or logs (see Statement Payload Protection) — the cursor is the opaque `feed_offset` only; this contract is a read surface, not the cursor.

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
- **Credential storage + per-connection credential key.** The software-company key is stored tenant-wide; customer/fiduciary credentials are stored per connection via the shared `integrationCredentialsService`. The shared service keys a credential row on `(integrationId, organizationId, tenantId, userId?)` only — `IntegrationScope` has no company/connection dimension and `save` replaces the row matching that filter — so two Codabox connections in the same org on the same `codabox` integration would otherwise overwrite each other's secret, and `data_sync` would resolve the wrong secret by `run.integrationId`. v1 does **not** extend `IntegrationScope` and does **not** overload `userId` (which is reserved for genuine per-user credentials). Instead it introduces a **provider-owned credential namespace**: each connection maps to a distinct integration id `codabox:<connectionId>` used for credential reads/writes and for the connection's `data_sync` runs. Concretely:
  - The tenant-wide software-company key is stored once under the base `codabox` integration id (org/tenant scope, no connection suffix).
  - Each connection's customer/fiduciary credentials are stored under `codabox:<connectionId>` so every connection owns its own row; `buildCredentialsFilter` then yields a distinct row per connection and `save` never clobbers a sibling.
  - **Connect** writes to `codabox:<connectionId>`; **scheduled and manual sync** resolve by the same id (the `data_sync` run carries `integrationId = codabox:<connectionId>`, so `sync-engine`'s `run.integrationId` lookup lands on the right secret); **replace/reauth** overwrites only that connection's row; **delete** releases only `codabox:<connectionId>` (plus a bundle fallthrough to the base `codabox` software-company key for the tenant-wide part). The base software-company key is read via the existing bundle-credential fallthrough, so each connection resolves `connection creds → tenant-wide partner key` without a schema change.
  - This stays inside the existing credentials contract (a provider using a namespaced integration id is already how bundle children scope their rows); it adds no column to `IntegrationScope` or `integration_credentials`. If the registry requires each `codabox:<connectionId>` to be a discoverable integration, v1 instead registers `codabox` as a **bundle** and treats each connection as a bundle child id — the same keying, expressed through the sanctioned bundle mechanism. The exact choice (namespaced id vs. bundle-child id) is confirmed at implementation time against the registry's discoverability rules; both satisfy the one-row-per-connection requirement and neither touches the shared contract.
  Secret-bearing fields use `secret`/`oauth` types (never `text`/`url`) so they redact in logs. Storage mode follows the encryption rules in the Credentials section.
- **Token-exchange recovery.** The one-use exchange token is consumed immediately; if persisting the resulting credentials fails after the token is spent, the module marks the connection `needs_reauth` and surfaces a re-connect action rather than leaving a half-bound row. It never retries with a spent token.
- **Feature guards.** Distinct ACL features gate each capability: `codabox.connect` (establish/replace a binding), `codabox.sync.manage` (enable/disable or trigger the poller), `codabox.statements.view` (list ingested statements/status), `codabox.files.download` (download the raw CODA file). Fetching runs only for connections whose `consentStatus = Allowed` **and** which resolve to the acting organization.

### Durable Ingestion & Feed Acknowledgement

Codabox delivers documents on ordered per-feed queues: advancing `feed_offset` acknowledges entries and **permanently removes** the acknowledged one and everything before it, and the offset cannot move backward. So an offset must never advance past a document the module has not durably stored, or that statement is unrecoverable (except via the separate redownload feed, which is bounded). The commit order and dedup rule are therefore part of the contract, not an implementation detail.

- **Runner choice.** Use the existing `data_sync` adapter lifecycle (register a `DataSyncAdapter`) rather than a provider-owned runner. It already gives per-batch cursor persistence, resume-from-cursor, overlap detection (same integration+entityType+direction), and queue-based retry — exactly the durability primitives this needs. The Codabox specifics (feed paging, offset ack) live in the adapter's `streamImport`.
- **Commit-before-advance ordering (per document, in order).** For each feed entry: (1) persist the raw CODA file + its parsed metadata to the Codabox module's own store, committed; (2) only then acknowledge that entry by advancing `feed_offset`. (Any downstream consumer handoff happens after the store commit and is never a precondition for the ack — v1 has no consumer.) The adapter yields a batch boundary **after** storage commits and **before** the offset advances, so the engine's per-batch cursor persistence records the pre-advance position. The offset is never advanced for a document whose storage transaction has not committed.
- **Durable per-statement identity / uniqueness.** A document can hold multiple statements, so uniqueness is enforced at **statement** granularity, not document granularity. Each ingested statement is keyed by a durable natural key independent of feed position — `(connectionId, statementId)`, where `statementId = hash(codaboxDocumentId, statementSequence, accountIban, currency, subAccount?)` (the Downstream Consumer Contract payload defines this). The unique constraint is `(connectionId, statementId)`; `codaboxDocumentId` is retained for provenance/grouping but is **not** unique on its own. A unique constraint on the per-statement key makes re-ingestion a no-op for every statement in a redownloaded file. Dedup keys off this identity, **not** off `feed_offset`, because offsets are consumed on ack and cannot be replayed.
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

If a stronger coupling is ever desired (Codabox pushing directly into a statement store rather than the consumer pulling), that would make the consumer's implementation and its ingestion contract an **additional, explicit prerequisite** — call it out and align then. v1 deliberately avoids that by using the consumer-owned, soft-optional handoff (see Downstream Consumer Contract). The #7443 review settled the command signature (`createBankStatement({ bankAccountId, statementDate, openingBalance, closingBalance, lines })` under `cash_bank_management.statements.manage`, rejecting unknown `bankAccountId`, storing lines unmatched), the dedup approach (consumer adds an optional external id keyed off our stable per-statement `statementId`), the account mapping (consumer resolves `bankAccountId` from our `accountIban` + `currency`), and the phasing (CODA-via-Codabox becomes a named external source in Cash & Bank's Phase 2, which is today a one-line deferral in that spec's Out-of-scope section, not a scheduled feature; the spec is unmerged and no date is committed). Both specs are design-level until Cash & Bank is merged and the command implemented, so v1 still calls no runtime API — it only publishes the contract above. Parsing stays in the Codabox module, so Cash & Bank does not need a CODA parser before this lands.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| Partner onboarding not completed, so no credentials exist. | High (blocker) | Whole module | Treat as hard prerequisite; do not start implementation until credentials are obtained. | Timeline depends on Codabox helpdesk response. |
| Fetching for a company without current `Allowed` consent. | High | Compliance / data access | Consent gate in sync service; refresh status before each run; skip non-allowed companies. | Consent can change between poll cycles; mitigated by re-checking each run. |
| Importing another company's statements into the selected organization (a fiduciary covers many clients; `Allowed` alone is not ownership). | High | Cross-tenant / cross-org data isolation | Bind each remote company/feed to one trusted `(tenantId, organizationId)` via the connection entity; sync derives scope from that binding, not the file; reject files whose remote company has no active connection for the scope. | Depends on operators establishing bindings correctly; binding create/replace is `codabox.connect`-gated and audited. |
| Credentials lost after the one-use token is spent (persistence failure). | Medium | Connection integrity | Mark the connection `needs_reauth` and surface a re-connect action; never retry with a spent token. | Operator must re-run the token exchange to restore the connection. |
| Credential exposure at rest. | High | Credentials storage | Reuse the shared `integrationCredentialsService`: sealed with the tenant DEK when encryption is enabled, fail-closed when KMS/Vault is unavailable. No new storage path. | When the operator disables encryption, the shared service stores credentials in plaintext by design — the module honors that opt-out and warns on the connection screen rather than overriding the global contract. |
| Codabox API/rate-limit outages. | Medium | Sync job | Backoff + retry via queue; surface connection status in UI. | Delayed statement availability during outages. |
| Same statement ingested twice (re-fetch / retry). | Medium | Data integrity (statement store) | Dedup guard on the durable **per-statement** identity (`connectionId` + `statementId`, where `statementId = hash(codaboxDocumentId, statementSequence, accountIban, currency, subAccount?)`); re-ingestion is a no-op per statement, including every statement in a multi-statement file. | Depends on `statementSequence`/account/currency being stable across Codabox redeliveries; redownload re-derives the same hash. |
| Multi-statement file collapses to one statement (second statement discarded as a replay of the first). | High | Data loss (banking data) | Document envelope with a per-statement `statementId` encoding the CODA statement sequence + account + currency; uniqueness is per statement, not per `codaboxDocumentId`, so two statements in one file are two distinct rows. | Depends on correctly reading `first_statement_number..last_statement_number` from the CODA file. |
| Feed offset advanced past an unstored document → permanently skipped statement. | High | Data loss (irreversible) | Commit-before-advance: the Codabox store commit precedes the offset ack; never advance before store. Redownload feed is the only (bounded) recovery. | Residual only if Codabox prunes the redownload feed before an operator notices a store-side outage. |
| Concurrent polls on the same feed race the offset and skip entries. | Medium | Data loss | One in-flight run per connection+feed via `data_sync` overlap detection + per-connection lock; second trigger no-ops. | None if the lock holds across process restarts. |
| Mixed feed silently consumes non-CODA deliveries (SODA/CARO/e-invoices). | High | Data loss (other document types) | v1 stops the feed at the first non-CODA entry and raises an actionable error instead of acknowledging-and-skipping. | Feed stalls until a later increment ingests those types; acceptable vs. losing them. |
| Raw statement bytes exposed via a public/global file path. | High | Data exposure (banking data at rest) | Store raw CODA files through `attachmentService` on a private, fully-scoped partition (`assertAttachmentScopeInvariant`, never `is_public`/global); gate every read through `checkAttachmentAccess`; download route requires `codabox.files.download` + owning-connection scope. | Depends on never adding a read path that bypasses `checkAttachmentAccess`. |
| Sensitive statement metadata stored plaintext or leaked in diagnostics. | High | Data exposure | Encrypt sensitive metadata fields via `encryption.ts` maps + `findWithDecryption`; keep statement content out of cursors, run parameters, and logs (opaque identifiers only). | Inherits the shared tenant-encryption threat model; disabled-encryption mode stores plaintext (see Credentials). |
| Building v1 against a finance / Cash & Bank consumer that does not exist yet (SPEC-024 is planned; #6055 spec and `createBankStatement` absent at this head). | High | Architecture / scope | v1 is self-contained (own store + exposure) and treats reconciliation as a future optional consumer with a consumer-owned soft-optional handoff; no hard dependency, no call to an unavailable API. | If a consumer later wants push-style ingestion, its implementation + contract become an explicit prerequisite to align then. |
| Account number cannot be mapped to a `BankAccount` (consumer-side, future). | Medium | Reconciliation correctness (downstream) | Mapping is owned by the consumer when it ships; v1 publishes normalised `accountIban` + `currency` so the consumer can resolve the right account when one IBAN backs several accounts (per-currency), and derive its own deterministic hash for an encrypted lookup. On zero/multiple matches the consumer rejects and reports. | Deferred to the consumer; not a v1 concern. |
| Downstream event lost or redelivered (reconciliation misses or double-imports a statement). | Medium | Reconciliation correctness (downstream) | Dual channel: `codabox.statement.ingested` as a trigger plus a cursor-based read API as source of truth; every statement carries a stable `statementId` the consumer dedupes on, so a lost event is recovered by replaying from the cursor and a redelivery is a no-op. | Consumer must implement its own external-id dedup keyed off `statementId`. |

## Final Compliance Report

- New opt-in module package only; no changes to core required.
- No core API route, DB schema, or DI contract changes.
- v1 is self-contained: Codabox stores retrieved CODA files + parsed metadata on its own tenant-scoped rows and exposes them; no dependency on a finance or Cash & Bank module (neither exists at this head).
- Reconciliation is a future optional consumer via a consumer-owned soft-optional handoff; Codabox never hard-requires, imports, or unconditionally resolves a downstream service, and degrades to "store + expose only" when none is present. No direct cross-module ORM relationship.
- Downstream Consumer Contract settled with Cash & Bank review (#7443): dual idempotent channels (`codabox.statement.ingested` event as trigger + cursor-based read API gated by `codabox.statements.view` as source of truth); a document envelope carrying a stable per-statement `statementId` (= `hash(codaboxDocumentId, statementSequence, accountIban, currency, subAccount?)`) so multi-statement files, redelivery, and loss are all safe; normalised `accountIban` + `currency` so the consumer resolves `bankAccountId` (one IBAN may back several per-currency accounts) via its own encrypted/hashed lookup; line fields carry `valueDate`/`bookingDate`, counterparty account+name, and structured communication for later auto-matching. The contract is additive and Codabox-owned; v1 calls no consumer runtime API.
- Credentials reuse the shared `integrationCredentialsService` unchanged: encrypted when enabled, fail-closed when unavailable, plaintext when the operator has disabled encryption (opt-out honored, warned in the UI). No change to the global credentials contract for this provider.
- All entities and routes are tenant-scoped; no cross-tenant exposure; no direct cross-module ORM relationships.
- Each remote Codabox company/feed is bound to one trusted `(tenantId, organizationId)` via a module-owned connection entity; fetch scope derives from that binding, never from the CODA file or request input. Consent `Allowed` is necessary but not sufficient — the binding must also resolve to the acting organization.
- Two credential tiers modeled explicitly (software-company key tenant-wide; customer/fiduciary credentials per connection); secret fields use `secret`/`oauth` types.
- Capabilities gated by distinct features: `codabox.connect`, `codabox.sync.manage`, `codabox.statements.view`, `codabox.files.download`.
- Ingestion uses the `data_sync` adapter lifecycle with commit-before-advance: documents are stored durably before the irreversible feed-offset ack; dedup keys off a durable **per-statement** identity (`(connectionId, statementId)`), not the document id or the offset, so multi-statement files are preserved.
- No change to the shared `SyncCursor` contract in v1: per-connection+feed cursors are partitioned by encoding `connectionId` in `entityType`; the `cursor` holds the opaque `feed_offset` only. Adding a company column to `SyncCursor` is a deferred, Ask-First shared-contract change.
- Mixed-feed safety: v1 stops at the first non-CODA entry rather than acknowledging-and-skipping, so filtering to CODA never consumes unrelated deliveries.
- Statement payload (not just credentials) protected at rest: raw CODA files stored via `attachmentService` on a private, fully-scoped partition (`assertAttachmentScopeInvariant`, never `is_public`/global, read only through `checkAttachmentAccess`); sensitive metadata encrypted via `encryption.ts` maps + `findWithDecryption`; download gated by `codabox.files.download` + owning-connection scope; bounded retention with `releaseScoped()` deletion. No statement content in cursors, run parameters, or logs.
- v1 scope limited to CODA; SODA/CARO/e-invoices explicitly deferred.
- No external runtime dependency in v1. Cash & Bank's `createBankStatement` is spec-level (unmerged, not implemented) and is not called by v1 — v1 only publishes the Downstream Consumer Contract above. CODA-via-Codabox is slated to become a named external source in Cash & Bank's Phase 2, which today is a one-line deferral in that spec, not a scheduled feature; no date is committed on either side.
- To be finalized as code at implementation time (design settled here): final entity columns, validators, exact route paths, and ACL feature ids. The per-statement dedup identity (`statementId` derivation) and the read-API cursor/pagination shape are now specified above; the **Acceptance Criteria & Integration Coverage** section below defines the testable acceptance matrix and phasing those endpoints must satisfy.

## Acceptance Criteria & Integration Coverage

Root `AGENTS.md` and `.ai/qa/AGENTS.md` require a feature spec to list integration coverage for every affected API path and key UI path, and to ship those tests in the same change as the implementation. Partner onboarding is a business entry condition, so the executable tests land with the implementation PR, not with this design PR — but the acceptance matrix, fixtures strategy, and phasing are design decisions and are settled here.

### Test strategy

- **Deterministic provider fixtures.** All automated coverage runs against a recorded/faked Codabox Connect V2 surface (canned token-exchange responses, ordered-feed pages with offsets, sample single- and multi-statement CODA files, and a bounded redownload feed). No test calls the live partner API. Fixtures live under the module's `__integration__/fixtures/`.
- **Self-contained + cleanup.** Following `.ai/qa/AGENTS.md`: every test creates its prerequisites via API (connection, credentials, scheduled sync) in setup and removes created rows, attachments, cursors, and credential rows in `finally`. Tests must pass without seeded/demo data.
- **Separate partner-gated sandbox acceptance.** A thin, manually-run acceptance suite against the real Codabox sandbox (available only after onboarding) is tracked separately from CI; it is not a merge gate and is not part of the deterministic suite above. It exists to validate the recorded fixtures against the real contract once credentials exist.

### Acceptance matrix

| # | Area | Scenario | Expected outcome |
|---|------|----------|------------------|
| A1 | Connection / token exchange | Establish a connection via the one-use token exchange within the caller's tenant+org, `codabox.connect` granted | Connection row bound to `(tenantId, organizationId)`, `codaboxCompanyId` from the exchange (not request input); credentials persisted under `codabox:<connectionId>` |
| A2 | Credential encryption | Save credentials with encryption enabled / disabled / unavailable | Enabled → sealed with tenant DEK; disabled → plaintext with the UI "stored unencrypted" warning; unavailable (KMS/Vault down) → fail-closed, no save, surfaced error |
| A3 | Per-connection credential key | Two connections in the same org on `codabox` | Each resolves its own secret; saving the second never overwrites the first; each connection's sync resolves the right secret by its `codabox:<connectionId>` id |
| A4 | Token-exchange recovery | Credential persistence fails after the one-use token is spent | Connection marked `needs_reauth`, re-connect action surfaced, token never retried, no half-bound row |
| A5 | Authorization — consent | Connection with `consentStatus != Allowed` | Fetch is skipped; no statements ingested |
| A6 | Authorization — wrong org | A file whose remote company has no active connection for the resolving scope; a download/list request from another org | Rejected, not imported; download/list denied for non-owning org |
| A7 | Feature guards | Calls without `codabox.connect` / `codabox.sync.manage` / `codabox.statements.view` / `codabox.files.download` | Each denied with the corresponding feature gate |
| A8 | Scheduled sync | Scheduler triggers a run; ordered feed has new CODA entries | Each file stored (raw + parsed) and committed before the feed offset advances; cursor persisted at the pre-advance position |
| A9 | Manual sync | Operator triggers sync with `codabox.sync.manage` | Same ingestion + commit-before-advance guarantees as A8 |
| A10 | Replay / redownload dedup | Re-deliver / redownload an already-ingested file | Every statement re-derives the same `statementId`; re-ingestion is a per-statement no-op; no duplicate rows |
| A11 | Multi-statement dedup | A single file carrying ≥2 statements (distinct sequence/account/currency) | Each statement persisted as its own row with a distinct `statementId`; the second is never discarded as a replay of the first |
| A12 | Concurrency | Two sync runs triggered for the same connection+feed | Only one in-flight run (overlap detection + per-connection lock); the second no-ops; the offset is never double-advanced |
| A13 | Crash replay | Crash before ack (after store) and crash after ack (before next store) | Before-ack → re-delivered file is a no-op, re-acknowledged, no duplicate; after-ack → entry already stored, nothing lost, resumes at new offset |
| A14 | Mixed feed | First non-CODA entry (SODA/CARO/e-invoice) in the feed | Feed stops at that entry with an actionable connection error; the non-CODA delivery is **not** acknowledged/consumed |
| A15 | Statement storage privacy | Raw file + parsed metadata persisted | Raw file on a private, fully-scoped `attachmentService` partition (`assertAttachmentScopeInvariant`, never `is_public`/global); sensitive metadata encrypted via `encryption.ts` maps |
| A16 | Download authorization | Download a raw CODA file | Requires `codabox.files.download`, read passes through `checkAttachmentAccess`, resolves the owning connection's scope; cross-org download denied |
| A17 | List authorization + payload | List statements via the read API | Gated by `codabox.statements.view`, tenant-scoped, returns the document-envelope payload with per-statement `statementId`, `accountIban`, `currency` |
| A18 | Cursor / missed-event replay | Consumer lists since its last opaque cursor after missing events | Returns statements in ingestion order since the cursor with the next cursor; no statement content in the cursor (opaque `feed_offset` only); replay reconciles exactly once per `statementId` |
| A19 | Retention | Retention window expires; connection deleted | Expiry permanently deletes bytes via `attachmentService.releaseScoped()` (DB commit before provider cleanup); deleting a connection cascades to its files, metadata, cursor, and credential row |

### Phasing (testable, onboarding as entry condition)

1. **Phase 0 — onboarding (business entry condition).** Open Mercato approved as a Codabox Connect partner; software-company key issued. No code merges depend on this, but no live run is possible before it. The deterministic suite (fixtures) does not require it.
2. **Phase 1 — connection + credentials.** Connection entity, token exchange, per-connection credential key, encryption modes, feature guards. Gated by A1–A7.
3. **Phase 2 — durable ingestion.** `data_sync` adapter, commit-before-advance, per-statement dedup, concurrency, crash replay, mixed-feed stop. Gated by A8–A14.
4. **Phase 3 — storage, exposure, retention.** Private attachment storage, encrypted metadata, download + list authorization, cursor replay, retention/cascade. Gated by A15–A19.
5. **Phase 4 — sandbox acceptance (separate, non-CI).** Manual validation against the real Codabox sandbox once credentials exist; reconciles fixtures with the live contract.

Each phase's tests ship in the PR that implements that phase; a phase is not "done" until its gating scenarios pass in the deterministic suite.

## Coordination with a future reconciliation consumer

Codabox v1 is self-contained: it retrieves, stores, and exposes CODA statements on its own rows and does **not** depend on Cash & Bank. Reconciliation is a future optional consumer — when Cash & Bank ships, it subscribes to `codabox.statement.ingested` and/or reads our cursor-based statement API and calls its own `createBankStatement`. The consumer owns that glue, the account→`bankAccountId` mapping, and its own external-id dedup; we own dedup for our own store and publish the stable identifiers the consumer needs. The concrete payload and API shape is the **Downstream Consumer Contract** above.

Settled with the Cash & Bank reviewers (#7443 ↔ #6055), to be mirrored into the Cash & Bank spec's Phase 2 external-source section when that spec is updated:

1. **Signature.** `createBankStatement({ bankAccountId, statementDate, openingBalance, closingBalance, lines: { lineDate, amount, description }[] })`, requires `cash_bank_management.statements.manage`, rejects an unknown `bankAccountId`, stores lines unmatched. Spec-level, not implemented — v1 does not call it.
2. **Event or pull.** Both: `codabox.statement.ingested` as the trigger and our read API (list statements since a cursor) as the source of truth, which is safe because repeated ingest is harmless (stable per-statement `statementId` dedup).
3. **Dedup.** Cash & Bank adds an optional external id, unique per source + bank account; our event and API carry a stable per-statement `statementId` (encoding document + sequence + account + currency) to key it off, so multiple statements in one file never collide.
4. **Account mapping.** Consumer resolves `bankAccountId` from our normalised `accountIban` + `currency` (one IBAN can back several per-currency accounts) via a deterministic hash over its encrypted account number; zero/multiple matches → reject and report.
5. **Line fields.** Beyond `lineDate`/`amount`/`description`, we also emit counterparty account + name, structured communication, and value date; the consumer keeps them for later auto-matching and folds them into `description` until then.
6. **Phasing.** CODA-via-Codabox becomes a named external source in Cash & Bank's Phase 2 (today a single Out-of-scope line, no import contract, spec unmerged). No date or scope commitment before that spec is agreed. Parsing stays in the Codabox module, so Cash & Bank needs no CODA parser.

These update the three "to confirm" items the integration spec previously listed (signature, mapping, duplicates). The Cash & Bank spec is to be updated by its owners to add the Phase 2 external-source contract.

Separately, the hard blocker still stands: implementation can't start until Open Mercato is approved as a Codabox Connect partner and credentials are issued.

## References

- This integration spec PR: #7443 (carries the Downstream Consumer Contract; the previously-listed signature/mapping/duplicates "to confirm" items are settled here)
- Future optional consumer (spec-level, not implemented at this head) — Cash & Bank Management: issue/PR #6055 (bank reconciliation, FX, AR/AP settlement); `createBankStatement` is spec-level design, not an available API; CODA-via-Codabox to be added as a Phase 2 external source by its owners
- Future optional consumer (planned) — finance module: `.ai/specs/SPEC-024-2026-02-11-financial-module.md` (status: Specification)
- Prior art — encrypted credentials pattern: `.ai/specs/implemented/2026-05-29-integrations-credentials-encryption-fail-closed.md`
- Prior art — integration module layout: `packages/sync-akeneo/`
- Scheduler/queue packages: `packages/scheduler`, `packages/queue`
- Codabox developer docs (V2): https://doc.codabox.com/
- Codabox partner onboarding contact: `helpdesk@codabox.com` (Andy Cobbaut, Customer Support)

## Changelog

- 2026-11-05 — Addressed the three remaining design findings from the #7443 re-review (pullrequestreview-5780431460): (1) **Per-connection credential key** — defined a provider-owned credential namespace (`codabox:<connectionId>`, with tenant-wide software-company key via bundle fallthrough) so two connections in one org no longer overwrite each other's secret and `data_sync` resolves the right secret by run id, without extending `IntegrationScope` or overloading `userId`. (2) **Per-statement identity** — replaced the single-statement, `codaboxDocumentId`-keyed payload with a document envelope carrying a stable per-statement `statementId = hash(codaboxDocumentId, statementSequence, accountIban, currency, subAccount?)`, since a CODA file can hold multiple statements (`first_statement_number..last_statement_number`); uniqueness, both delivery channels, redownload equivalence, and a multi-statement example now key on `statementId`, and a new data-loss risk row covers the multi-statement collapse case. (3) **Acceptance criteria & integration coverage** — added an Acceptance Criteria & Integration Coverage section (A1–A19 matrix, deterministic fixtures + cleanup, separate partner-gated sandbox acceptance, and four testable phases with onboarding as the entry condition), replacing the blanket "deferred to implementation" note.
- 2026-10-18 — Revised per design review (unpublished draft): v1 is now self-contained raw-CODA retrieval/storage/exposure, with reconciliation (Cash & Bank #6055 / planned finance module) as a future optional, consumer-owned soft-optional handoff rather than a dependency. Added a V2 two-tier credential + connection model binding each remote company/feed to one trusted tenant+organization, corrected the credential-storage claim to the real enabled/disabled/unavailable behavior, specified durable ingestion against the ordered feed (commit-before-advance, durable document identity, crash replay, mixed-feed policy, `data_sync` lifecycle), and defined statement-payload protection at rest (private `attachmentService` partition, encrypted metadata, scoped download).
- 2026-10-15 — Initial draft spec for the opt-in Codabox CODA integration module (v1: CODA only).
- 2026-10-29 — Settled the downstream handoff with the Cash & Bank reviewers (#7443 ↔ #6055) and added a **Downstream Consumer Contract** section: dual idempotent channels (`codabox.statement.ingested` event + cursor-based read API gated by `codabox.statements.view`), a stable `codaboxDocumentId` on every statement for consumer-side external-id dedup, normalised `accountIban` + `currency` so the consumer resolves `bankAccountId` (one IBAN may back several per-currency accounts via a deterministic hash over its encrypted account number), and forward-looking line fields (value date, booking date, counterparty account + name, structured communication). Recorded Cash & Bank's spec-level `createBankStatement` signature and `cash_bank_management.statements.manage` gate, and the phasing (CODA becomes a Phase 2 external source in the unmerged Cash & Bank spec; no date committed; parsing stays in Codabox). Updated the Mapping, Downstream Consumer, risk, compliance, coordination, and references sections; the three previously-open "to confirm" items (signature, mapping, duplicates) are now settled.
