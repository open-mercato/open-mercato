# GDPR Data Erasure Orchestration (Enterprise)

> Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) on 2026-07-08. Companion spec: [`2026-07-08-automated-database-backups.md`](2026-07-08-automated-database-backups.md) — owns the erasure-manifest mechanism and the post-restore re-run diff this spec produces entries for, plus the bounded-retention guarantee this spec's GDPR framing relies on.

## TLDR
**Key Points:**
- Enterprise module `data_erasure`: tenant-scoped GDPR Art. 17 erasure **orchestration** — the hard-delete primitives already exist (`customers.people.delete`, `auth.users.delete` both hard-delete with cascades); what is missing and what this spec adds is the append-only ledger, undo-snapshot hygiene, cross-module propagation, search-index cleanup, and durability across backup restores. De facto implements upstream issue #117 ("unified, GDPR compliant data removal tool").
- Cross-module PII purge propagates via **generic OSS-level erasure events** (`privacy.subject.erased`/`privacy.subject.purged`, declared in core — shape and owning module settled at Phase 0 Gate B); OSS core never names an enterprise event id. Propagation is eventually consistent; the ledger records only the synchronous sweep's own actions.
- GDPR durability is **one guarantee, one control**: the unconditional guarantee is the companion spec's bounded backup retention (35 days); the guided post-restore re-run is an operator-dependent control.

**Scope:**
- Erasure command for subject kinds `customers:person` and `auth:user`, with an append-only, PII-free ledger (`erasure_request`).
- Generic OSS erasure events + purge subscribers in `audit_logs` (pre-existing PII undo snapshots) and `communication_channels` (connection rows + subject-authored messages and attachments).
- Manifest entries written to the companion spec's `erasureManifestService` (soft-optional) so erasures survive database restores.

**Out of scope (future work):**
- PII anonymization (as opposed to deletion) — tracked upstream as the open half of issue #208. Market-converged follow-up: leading CRM/ERP products anonymize in place when retention blocks deletion; the deals guard below points operators at this future path.
- Inbound-message matching in `communication_channels` (messages *from* the subject not linked by an author reference) — v1 purges subject-**authored** messages and attachments; matching by sender address is deferred (a gap even leading implementations share).
- Crypto-shredding (per-data-subject encryption keys) — noted as a hardening direction.

**Concerns:**
- The erasure command's `executed` status covers only the synchronous sweep; subscriber-side purge is eventually consistent with per-module `privacy.subject.purged` confirmations — the ledger never claims more than the sweep did.
- The generic OSS events' exact ids and owning core module are a maintainer decision (Phase 0 Gate B), with a documented fallback (subscribers inside `data_erasure`).

## Overview

No erasure orchestration exists in the platform today: customer deletion soft-deletes by default, PII lingers in `action_logs` undo snapshots and message history, and `communication_channels/subscribers/user-deleted-cascade.ts:26-29` explicitly defers hard-delete to "a future tenant-level GDPR sweep". Even a correctly executed erasure would be silently resurrected by restoring a database backup. Upstream tracks the unified-tool ask as issue #117 (the implementation PR should reference and close it); related: #208 (anonymization half open), #994 (key-material portability across environments, relevant to the restore runbook).

> **Market Reference**: surveyed GDPR-erasure implementations across leading CRM/ERP products. Established patterns adopted here: blocking deletion of a contact referenced by business documents, with anonymize-or-reassign guidance when retention prevents deletion; erasure audit logs that store **masked** subject identifiers (`j*** d**`, `j***@e******.com`) — adopted for the ledger's display label; purging subject-authored message content and attachments; logging only actually-executed actions; and propagating cross-system purge asynchronously with documented windows. Auto-disassociating business records instead of blocking (one surveyed product's approach) was rejected as a silent mutation. No surveyed product implements any post-restore erasure re-application — the manifest + guided re-run is this design's own addition.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Erasure ledger + bounded retention + **guided re-run** on restore (not automated replay, not crypto-shredding) | Keeps archives immutable and the encryption layer untouched. Bounded retention alone matches EDPB-accepted practice; the guided re-run (companion spec's restore CLI diffs the manifest and lists what to re-execute) restores the erasure state with operator confirmation. Fully automated replay was descoped in an earlier revision: it pulled in HMAC verification, a blind index, a pepper precondition, and a cross-module replay service for marginal value. |
| Ledger in DB + plain erasure **manifest** in the backup bucket | A restore from a pre-erasure archive would otherwise erase the ledger itself, leaving nothing to diff against. Manifest mechanics (object-per-entry, no integrity machinery) are owned by the companion spec; this module writes entries on the pending→executed transition via the soft-optional `erasureManifestService`. |
| `data_erasure` is a separate module from `backups` | Erasure is a privacy capability independent of backups (it must run even if backups are disabled); each functions without the other. |
| Erasure is deliberately not undoable — and must not create PII while deleting it | GDPR requires irreversibility. The ledger is the audit record. Delegated deletes run with command-bus `metadata { skipLog: true }` so no fresh undo snapshot containing the subject's PII is written to `action_logs` (`command-bus.ts:511`); purging pre-existing snapshots belongs to the `audit_logs` subscriber. Explicit, justified exception to the undoability default. |
| Persons with linked deals: fail-with-guidance | `customers.people.delete` refuses to delete a person with linked deals (`people.ts:1232-1236`). The erasure command surfaces this as an actionable error listing the blocking deals — deals are business records with their own retention obligations, so the sweep must not silently unlink or mutate them. Blocking deletion of a contact referenced by business documents is the established market pattern; the converged handling for retained records is anonymize-in-place (#208-adjacent follow-up). Auto-disassociation rejected: silent mutation of business records. |
| Completion semantics: `executed` = synchronous sweep only; cross-module purge eventually consistent | Surveyed products log only executed actions and propagate cross-system purge asynchronously with documented windows. Synchronous cross-module purge would contradict the event-decoupled architecture; claiming completion the command cannot verify would overclaim. Subscribers confirm with `privacy.subject.purged`. |
| Propagation via generic OSS erasure events, never core-subscribing-to-enterprise | OSS core source must not name an enterprise-only event id — dead code in every OSS build, coupling OSS evolution to an enterprise contract. (The isomorphism rule is not the issue: a subscriber never imports, resolves, or hard-requires the emitter — the defect is packaging/layering.) `data_erasure` emits `privacy.subject.erased` (declared in core); future OSS anonymizers can emit the same event. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Rewriting archives on erasure | Breaks archive immutability and checksums; operationally fragile; no compliance benefit over retention + guided re-run. |
| Crypto-shredding (per-subject keys) | Requires reworking field encryption to key-per-subject; recorded as a future hardening phase. |
| Core modules subscribing to an enterprise event id | Layering violation (see Design Decisions); resolved via generic OSS events, fallback = subscribers inside `data_erasure`. |
| Single JSONL ledger file with ETag-guarded read-modify-write | Race window under concurrent erasures; unbounded file growth (companion spec's manifest decision). |

## User Stories

- A **tenant admin / DPO** wants **to execute an erasure request for a person or user** so that GDPR Art. 17 obligations are met with an auditable record.
- A **DPO** wants **erasure to survive a database restore** so that restoring last week's backup does not resurrect erased personal data.
- A **third-party module author** wants **a documented event contract** so their module can purge its own PII when a subject is erased.

## Architecture

```
                        ┌─────────────────────────────────────────────────┐
  admin POST ─────────▶ │ data_erasure module (enterprise)                │
                        │  entity: erasure_request (ledger, tenant-scoped)│
                        │  command: data_erasure.request.execute          │
                        │  sync sweep: customers/auth via command bus     │
                        │  manifest append via erasureManifestService     │
                        │  (soft-optional; see companion backups spec)    │
                        └───────────────┬─────────────────────────────────┘
                                        │ emits privacy.subject.erased
                                        │ (generic OSS event, declared in core)
                                        ▼
                        subscribers in audit_logs, communication_channels
                        (core-side, per Phase 0 Gate B), third-party modules —
                        each confirms with privacy.subject.purged
```

### Module boundaries and coupling

| Touchpoint | Mechanism | Glue owner | Absent-peer behavior |
|------------|-----------|------------|----------------------|
| data_erasure → backups (erasure manifest) | Soft-optional DI resolve of `erasureManifestService` in `try/catch` at execution time | `data_erasure` (optional consumer) | Erasure completes with a log line that the manifest was skipped (without `backups` there are no restores to guard) |
| data_erasure → customers (person hard-delete) | Command bus: existing `customers.people.delete` (already hard-delete with cascades), invoked with `metadata { skipLog: true }` | `data_erasure` | Erasure for `customers:person` fails with a clear error if customers is disabled |
| data_erasure → auth (user hard-delete) | Command bus: single `auth.users.delete` call with `metadata { skipLog: true }` — already hard-deletes the user row (`soft: false`) and cascades UserAcl/UserRole/Session/PasswordReset | `data_erasure` | Same pattern |
| data_erasure → other modules (module-owned PII purge) | Generic OSS event `privacy.subject.erased` (payload subjectKind/subjectId/tenantId/organizationId — no PII), declared in core, emitted by `data_erasure`; core modules subscribe and confirm via `privacy.subject.purged` | Each subscribing module | Modules without a subscriber keep their own data lifecycle; documented extension contract |
| data_erasure → query index (per-subject cleanup) | Per-id index **delete events** for each erased entity (pattern: `customers/commands/shared.ts:304`) — NOT `purgeIndexScope`, which clears a whole entity-type × tenant scope | `data_erasure` | N/A (query_index is core) |

**Completion semantics:** the command's `executed` status covers only the **synchronous sweep** (customers/auth deletes + per-id index delete events). Cross-module purge is **eventually consistent**: persistent subscribers are queue-retried, each emits `privacy.subject.purged` (module id + counts, no PII) on completion; the propagation window is bounded by the queue's retry semantics and documented. `data_erasure.request.executed` remains an enterprise-internal observability event; cross-module propagation never uses it.

### Commands & Events

- **Command**: `data_erasure.request.execute` — validates subject (existence + tenant/organization scope), writes the ledger entry (`pending`), runs the synchronous sweep, marks `executed`, appends the manifest entry (soft-optional), emits `privacy.subject.erased` + `data_erasure.request.executed`. **Not undoable — by design.** For `customers:person` with linked deals the command fails with guidance (blocking deal ids) without writing a ledger entry.
- **Events**: `privacy.subject.erased` / `privacy.subject.purged` (generic OSS events declared in core — proposed ids, settled at Phase 0 Gate B); `data_erasure.request.executed` (enterprise-internal; payload requestId, tenantId, organizationId, subjectKind, subjectId — no PII).

## Data Model

### erasure_request — the ledger

Tenant-scoped, append-only. Rows are never updated after reaching a terminal status and never deleted (no `deleted_at`). **The ledger stores no plaintext PII**: subjects are referenced by id and a masked display label only, so the ledger itself is not an erasure target and needs no encryption map (justified N/A).

- `id`: uuid PK
- `tenant_id`: uuid, `organization_id`: uuid
- `subject_kind`: enum `customers:person | auth:user` (extensible)
- `subject_id`: uuid
- `subject_label_masked`: text, nullable — display label masked **at creation** (established privacy-log masking pattern: name reduced to initials + asterisks, email masked like `j***@e******.com`)
- `status`: enum `pending | executed | failed` (only allowed transitions: pending→executed, pending→failed; a retry after `failed` inserts a **new** request row for the same subject — the idempotent sweep skips already-deleted rows — never flips a terminal row back to `pending`)
- `requested_by_user_id`: uuid
- `requested_at`, `executed_at`: timestamptz
- `scope_summary`: jsonb — the **synchronous sweep's own** action counts (e.g. `{ "customers": { "people": 1, "activities": 12 } }`); counts only, no PII; the log never claims more than was actually done. Subscriber-side purge is observable via `privacy.subject.purged`, not this column (persisting per-module receipts is an optional follow-up)
- `created_at`, `updated_at`

Indexes: `(tenant_id, organization_id, created_at)`; `(subject_kind, subject_id)`.

**Manifest entries** (written on pending→executed; mechanics owned by the companion spec): `{ requestId, subjectKind, subjectId, subjectLabelMasked, executedAt }`, one immutable object per entry under `data-erasure-manifest/tenant_<id>/`. Post-restore matching is by `subject_id` (UUIDs stable across a same-instance restore). A failed sweep leaves no manifest entry.

### Validation

All API inputs validated with zod in `data/validators.ts`; TS types via `z.infer`. Erasure execution re-verifies subject existence and tenant/organization scope inside the command (defense in depth against forged cross-tenant subject ids).

## API Contracts

- `GET /api/data_erasure/requests` — feature `data_erasure.view`. Tenant/organization-scoped list (every query filters by `organization_id`), keyset pagination, `pageSize ≤ 100`. Exports `metadata` + `openApi`.
- `POST /api/data_erasure/requests` — feature `data_erasure.manage`. Body: `{ subjectKind, subjectId, confirmation: string }` (zod-validated; `confirmation` must equal the literal subject id — server-side re-check of the typed confirmation). Executes `data_erasure.request.execute` via the command bus; returns the ledger entry, or a 422 with blocking-deals guidance. 404-equivalent minimal error when the subject does not exist in the caller's scope (no cross-tenant existence oracle). Runs `runMutationGuards()`.

## GDPR erasure durability: one guarantee, one control (normative)

The word **guarantee** attaches only to properties that hold unconditionally — a DPO may quote this section to a regulator. Operator-dependent procedures are **controls** with documented residual risk.

1. **Live erasure (synchronous scope)**: the command hard-deletes the subject in the sweep's own scope, writes the ledger entry, and appends the manifest entry. Cross-module purge propagates eventually via queue-retried subscribers confirming with `privacy.subject.purged`; the propagation window is documented.
2. **The guarantee — archive aging** (companion spec's mechanism): every archive containing pre-erasure data is deleted by the retention worker no later than `OM_BACKUP_RETENTION_DAYS` (default 35) after creation. Unconditional, mechanical, independent of operator behavior. This is the only property the DPO-facing statement promises.
3. **The control — guided re-application on restore** (companion spec's restore CLI + this spec's re-execution): any tooled restore ends with a manifest-vs-database diff across all tenant prefixes; the CLI lists the erasures executed after the archive was taken, and the runbook makes re-executing them mandatory before the instance returns to service. Re-execution is idempotent. Operator-dependent — a raw `pg_restore` bypasses it (documented residual risk).
4. **Documentation duty**: the docs pages state the retention window, the re-run procedure, and the market context (published backup-retention windows across surveyed products range from ~30 days to 12 months; none offers any post-restore re-application).

## Security Considerations

- Erasure POST requires feature grant + typed confirmation re-checked server-side.
- No PII resurrection: delegated deletes carry `skipLog: true`; pre-existing undo snapshots purged by the `audit_logs` subscriber; the E2E test asserts `action_logs` contains no fresh subject snapshot after erasure.
- Erasure minimality: the ledger stores ids and masked labels, never plaintext names/emails.
- Tenant isolation: all queries filter by `tenant_id` + `organization_id`; subject resolution refuses out-of-scope ids with a minimal error.
- Manifest entries only ever produce an operator-reviewed re-run list — a tampered entry cannot trigger automated deletion.

## Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| Erasure requested for a person with linked deals | Command fails with guidance (blocking deal ids); no ledger entry; operator resolves deals and retries |
| Erasure sweep fails mid-way | Ledger entry `pending`→`failed` with the sweep's progress in `scope_summary`; retry inserts a new request row; no manifest entry until `executed` |
| Purge subscriber fails after `executed` | Persistent subscriber retried by the queue; a missing `privacy.subject.purged` for a module is the operational signal; unresolved failures surface in queue ops within the documented window |
| Re-run list contains a subject whose module is disabled | Printed list marks the entry; operator resolves module activation and re-executes |
| Manifest service absent (backups module disabled) | Erasure completes; log line notes the manifest was skipped — without backups there are no restores to guard |

## Phasing & Implementation Plan

Each phase ends with a working application. Estimated ~12 atomic commits: ~9 enterprise + 3 core-side (generic event declaration ×1, purge subscribers ×2) — core commits per the Gate B decision.

### Phase 0 — Go/no-go gate
- **Gate B (decision-latency de-risk):** settle with maintainers the shape and owning core module of the generic OSS erasure events (`privacy.subject.erased`/`privacy.subject.purged`) — or fall back to subscribers inside `data_erasure`. The answer must be in hand before Phase 3, even though the code lands then. (Raised on PR #3742.)

### Phase 1 — Module & ledger
1. Scaffold `packages/enterprise/src/modules/data_erasure/` (index/acl/setup/di/events, i18n en+de+es+pl); register in both registration points behind `OM_ENABLE_ENTERPRISE_MODULES` (+ `_DATA_ERASURE`). → verify: module loads, features sync.
2. `erasure_request` entity + migration + snapshot; ledger service (DB write + soft-optional manifest append via `erasureManifestService`). → verify: unit tests incl. manifest-skipped path.

### Phase 2 — Erasure command
3. `data_erasure.request.execute`: person path (command bus → `customers.people.delete` with `skipLog: true`; deals guard → fail-with-guidance), user path (single `auth.users.delete` with `skipLog: true`), per-id search-index delete events, event emission. → verify: sweep integration test asserts zero subject rows in the sweep's scope AND no fresh PII snapshot in `action_logs`.

### Phase 3 — Generic OSS events & purge subscribers (per Gate B)
4. Declare `privacy.subject.erased`/`privacy.subject.purged` in the agreed core module; subscribers in `audit_logs` (purge pre-existing PII undo snapshots; module has no `subscribers/` dir today) and `communication_channels` — v1 scope: (a) disconnected channel-connection rows (resolves the deferred TODO at `user-deleted-cascade.ts:26-29`); (b) messages **authored by** the subject plus attachments (the market-anchored scope). Each subscriber emits `privacy.subject.purged`. Fallback if Gate B lands on it: both subscribers inside `data_erasure` via owning modules' own commands/APIs. Extension contract documented for third-party modules. → verify: subscriber unit tests incl. authored-message purge, snapshot purge, `purged` emission.

### Phase 4 — API & admin surface
5. API routes (openApi, `runMutationGuards()`, typed confirmation). → verify: 403/422 tests, cross-tenant refusal.
6. Settings page (ledger `<DataTable>`, create-request flow with typed confirmation via `useConfirmDialog`, `Cmd/Ctrl+Enter`/`Escape`; masked labels; i18n). → verify: DS-guardian pass.

### Phase 5 — Restore durability E2E & docs
7. End-to-end GDPR test (requires the companion spec's Phases 1-5): create subject → backup → erase → restore archive → CLI lists the erasure → re-execute → subject absent, no PII snapshots. Docs: user-guide erasure page + the guarantee/control statement. → verify: full suite + docs build.

### Integration test coverage
- API: `GET/POST /api/data_erasure/requests` (tenant scoping, typed-confirmation rejection, cross-tenant refusal, 422 deals guidance).
- UI: data_erasure settings page (ledger list, create flow with confirmation dialog).
- E2E: the erase→backup→restore→re-run flow above (the money test; depends on the companion spec's MinIO harness).
- All tests self-contained.

## Migration & Backward Compatibility

- New module + new generic OSS events (additive contract surface — event ids are ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md`); no behavior changes when disabled. `customers.people.delete`, `auth.users.delete`, and the query-index delete events are consumed as-is. Implementation PR references and closes upstream #117; references #208 and #994.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|------|----------|------------|----------|
| Erasure re-creates PII via undo snapshots | High | `skipLog: true` on all delegated deletes + subscriber purge of pre-existing snapshots + E2E assertion on `action_logs` | Third-party commands invoked in future extensions must follow the same rule (documented) |
| Erasure sweep misses a PII location (new module added later) | Medium | Subscriber extension contract + `privacy.subject.purged` visibility; spec for any new PII-bearing module must declare an erasure subscriber | Third-party modules that ignore the contract |
| Maintainer decision on the generic OSS events delays Phase 3 | Medium | Raised as Phase 0 Gate B; fallback documented | Slightly weaker module ownership on the fallback path |
| Purge subscriber failure leaves PII beyond the sweep after `executed` | Medium | Queue-retried subscribers; per-module `purged` confirmation; documented propagation window; ledger never claims more than the sweep did | Eventual consistency inherent to the event-decoupled design; accepted and documented |
| Operator skips the post-restore re-run step | Medium | Companion spec: distinct CLI exit code + mandatory runbook step | Human-process risk; the guarantee/control split keeps the DPO-facing promise honest |

## Final Compliance Report — 2026-07-08 (split)

Inherited from the combined spec's rev-5 report (all rows unchanged for the erasure scope): `erasure_request` fully tenant-scoped; encryption-map N/A justified (no plaintext PII); events via `createModuleEvents` with propagation through generic OSS events (never core-subscribing-to-enterprise); optimistic locking N/A (append-only ledger, no edit form); guards via `runMutationGuards()`; integration coverage listed. Verdict: **approved for pre-implementation analysis** after Phase 0 Gate B, with pre-implement confirming the `customers/commands/shared.ts:304` per-id index-delete pattern and upstream issue numbers.

## Changelog

- 2026-07-08: Split from `2026-07-02-automated-backups-and-gdpr-erasure-propagation.md` (rev 5) — this file carries the `data_erasure` module, the generic OSS erasure events, the core purge subscribers, and the GDPR guarantee/control framing; the backup pipeline, manifest mechanism, and restore-time diff live in [`2026-07-08-automated-database-backups.md`](2026-07-08-automated-database-backups.md).
- Inherited history (combined spec): 2026-07-02 initial + full spec (PR #3742); 2026-07-03 rev 2 (gap-analysis corrections: `skipLog` no-PII-resurrection rule, per-id index delete events instead of `purgeIndexScope`, fail-with-guidance for persons with deals) and rev 3 (market research settled the deals/ledger/message-purge decisions; masked display label adopted); 2026-07-04 rev 4 (automated replay descoped to guided re-run; HMAC/blind-index/pepper removed) and rev 5 (executor+advisor review: completion semantics resolved market-style — `executed` = sync sweep, eventual subscriber propagation with `purged` confirmations; core-subscribing-to-enterprise ruled out on layering grounds → generic OSS events with Gate B; "one guarantee, one control" framing); 2026-07-06 market references generalized to pattern descriptions.
