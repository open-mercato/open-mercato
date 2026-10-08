# Insights: Process X-Ray

| Field | Value |
|---|---|
| Status | Draft |
| Owner | insights |
| Depends on | `2026-10-08-insights-causation-and-explain.md` (causation columns, `insights` module, explain registry) |
| Related | `2026-05-13-operation-progress-framework.md`, workflow definition metric rollups (`workflows/lib/metrics/rollup-service.ts`), enterprise `2026-07-08-gdpr-data-erasure.md` |

## TLDR

Process mining built into the platform. A worker incrementally projects `action_logs` into a non-sensitive process-event table, and analytics compute directly-follows graphs, variants, durations, bottlenecks, rework and conformance against workflow definitions. Automation suggestions turn repeated manual follow-ups into **disabled** draft workflows the user reviews. Privacy by default: no per-person analytics unless explicitly enabled per tenant, k-anonymity, pseudonymised actors.

## Overview

- **Value**: managers see how work actually flows and where it stalls; process owners see deviations from designed workflows; repetitive manual work becomes reviewable automation drafts.
- **Scope**: projection, analytics, pages, dashboard widget, suggestions, read-only AI tools.
- **Out of scope**: predictive analytics, Kaplan–Meier survival curves (follow-up), workflow pre-transition guard replay.

## Problem Statement

Open Mercato records every audited mutation, but nobody can see how work actually flows: which paths deals take, where orders wait, what is reworked, how far reality deviates from the designed workflow, or which manual steps are repeated often enough to automate. External process-mining tools need ETL and cannot see causation (human vs automation).

## Proposed Solution

### Design decisions

| # | Decision | Rejected |
|---|---|---|
| X1 | New convention file `insights.process.ts` (types `packages/shared/src/modules/insights/process.ts`, `defineProcessConfig`, `version: 1`), discovered by a second plugin in `insights/generators.ts`. Declares case roots (resource kind), stage fields (enum/dictionary/uuid values only), child milestones via an explicit parent resource kind, and actor dimension providers. | Sections inside `insights.explain.ts` (would freeze the X-Ray contract together with "Why?"). |
| X2 | Projection stores only declared, non-sensitive activity labels: values must match `^[a-z0-9_.:-]{1,64}$` or be UUIDs, else `other`; at most 200 distinct values per field per organization; declarations pointing at fields in the module's encryption map are rejected at boot. | Copying `changes_json` fragments (PII leak into plaintext). |
| X3 | One durable cursor per organization on `(created_at, id)` with a CAS lease carrying a fencing token, settle lag 60 s, 15-minute overlap re-scan, nightly 48 h reconciliation and weekly full reconciliation; idempotent `ON CONFLICT DO NOTHING` on `(source_log_id, process_key, seq)`. Undo/redo state changes are read via `action_logs.updated_at`. | Event subscribers (events are not persisted); a `created_at`-only cursor (misses late-committed logs). |
| X4 | Raw ingest; debounce and correction collapse at query time. | Merging at ingest (breaks idempotency). |
| X5 | Undo voids its source event; redo emits a new event. | Trusting `execution_state` only. |
| X6 | Causation is a first-class dimension: automated steps stay in the graph tagged by `cause_kind`; `cause_kind IS NULL` rows (pre-foundation) are bucketed `legacy` and never counted as human; `sync_run` steps are excluded from duration statistics by default. | Dropping system rows (scheduler steps are part of processes). |
| X7 | Precomputed rollups (7/30/90 days, tenant timezone boundaries, every 15 minutes, pattern of workflow metric rollups) + live queries for custom filters with `SET LOCAL statement_timeout = '5s'`, window ≤ 180 days; larger → 422 with a hint to run a background analysis job. | Incremental counters (cannot be invalidated by undo/rebuild). |
| X8 | Privacy: aggregates by role/team/organization by default. Per-person breakdown requires `insights.xray.view_individuals` **and** the tenant setting `individualsEnabled` (default false) **and** k-anonymity; every per-person read writes an `access_logs` row first and fails closed if that write fails. Actors in the projection are HMAC pseudonyms (per-tenant key from `TenantDataEncryptionService`). | RBAC-only gating (works-council / GDPR risk). |
| X9 | Suggestions produce **disabled draft workflow definitions** (`UPDATE_ENTITY` steps, `enabled: false`, `lifecycle: 'draft'`) created by the browser through `POST /api/workflows/definitions` as the user (guards, audit, optimistic lock). Business rules are not used because `SET_FIELD` does not persist and CRUD rule payloads carry ids only. Credential-bearing activities (`CALL_API`, `CALL_OPEN_MERCATO`, webhooks) are never generated. | Server-side creation by insights (cross-module writes, privilege issues). |
| X10 | Cross-module reads go through soft-optional DI services owned by the source module (resolved with `tryResolve`); insights never imports workflow internals. | Direct imports. |

### Statistical guards

`n` is always returned; medians require n ≥ 5 and p90 n ≥ 20; n < 30 is flagged low-confidence; cycle times use completed cases only, open cases are reported separately as right-censored with an age histogram; default breakdown is per organization (Simpson's paradox); period comparisons use equal-length windows; cells with fewer than k cases (default 10, minimum 5) or fewer than 3 distinct actors are suppressed; results carry `computedThrough`. Edges whose transition is not observable because intermediate commands write no log are drawn as "unobserved" (coverage from the explain coverage CLI); resource kinds below the coverage threshold are hidden.

### Automation suggestion mining

For trigger activity A and an optional low-cardinality dimension condition, collect follow-up field changes B on the same case within W ∈ {10 min, 1 h, 24 h}; only `cause_kind = 'user'` post-foundation rows; exclude undone rows and corrections (A→B→A by the same actor inside the debounce window). Thresholds: support ≥ 20 in 30 days, Wilson lower bound of confidence ≥ 0.6, lift ≥ 2, ≥ 2 distinct actors. "Already automated" when an enabled workflow trigger on the same event already performs an `UPDATE_ENTITY` with the same command and field. A suggestion is `draftable: false` (with reason) when the condition is not expressible over the event payload, the command is not workflow-safe, or the user lacks the command's features.

## Architecture

- `insights/lib/process/*` (registry with encryption guard, pure activity derivation, case summary), `insights/lib/projection/*` (ingest, cursor with fenced lease, retention), `insights/lib/analytics/*` (Kysely SQL: dfg, variants, durations, rework, bottlenecks, conformance, breakdown, privacy, stats), `insights/lib/suggestions/*`.
- Workers: `xray-ingest` (concurrency 2), `xray-backfill` (1), `xray-rollup` (1, every 15 min, also prunes), `suggestion-mining` (1, daily). Byte budgets per batch, per-tenant budgets, ProgressJob for backfill with abandoned-job recovery.
- Kill switch: feature toggle `insights_xray_ingest` (default on, fail-open when feature_toggles is disabled).
- CLI: `mercato insights xray:backfill|status|rebuild|prune`.
- Subscribers: user deletion/anonymisation → delete or re-pseudonymise projection rows.
- `ActionLogService.scanDecrypted({ tenantId, organizationId, after, until, limit })` (additive) for the worker.

## Data Models

All tables carry `tenant_id`, `organization_id` NOT NULL; indexes are created concurrently in non-transactional migrations.

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `insights_process_cursors` | per-org ingest cursor | `last_created_at`, `last_log_id`, `lease_owner`, `lease_token`, `lease_until`, `contract_hashes` (process key → contract hash; null until adopted), `pending_rebuild_keys`, `scan_process_keys`, `contract_changed_at` / `contract_change`, `coverage_from`, `history_scanned_at`, `undecryptable_rows`, `overlap_timeouts`, `status` (`idle`, `backfilling`); unique `(tenant_id, organization_id)` |
| `insights_process_events` | projected activities | `process_key`, `case_kind`, `case_id`, `activity_key`, `activity_kind`, `occurred_at`, `source_log_id`, `seq`, `actor_pseudonym`, `actor_role_ids`, `actor_team_id`, `cause_kind`, `cause_id`, `followup_field`, `followup_value`, `voided`, `voided_by_log_id`, `created_at`; unique `(source_log_id, process_key, seq)` |
| `insights_process_cases` | per-case summary | `case_id`, `started_at`, `last_activity_at`, `ended_at`, `status`, `event_count`, `rework_count`, `distinct_actor_count`, `automated_share`, `variant_hash`, `variant_keys`, `dimensions`, `recomputed_at`; unique `(tenant_id, organization_id, process_key, case_id)` |
| `insights_process_rollups` | precomputed windows | `process_key`, `window_key`, `window_start`, `window_end`, `computed_at`, `metrics`; unique `(tenant_id, organization_id, process_key, window_key, window_start)` |
| `insights_process_settings` | user-editable settings | `enabled`, `retention_days` (365), `k_anonymity` (10, min 5), `debounce_seconds` (120), `individuals_enabled` (false), `conformance_workflow_id`, `activity_step_map`, `updated_at` (optimistic lock), `deleted_at` |
| `insights_automation_suggestions` | mined suggestions | `signature_hash` (unique per org), trigger/condition/follow-ups, support/confidence/lift, `status` (`open`, `dismissed`, `drafted`, `superseded`), `draftable`, `not_draftable_reason`, `drafted_artifact_id`, `updated_at` |

## API Contracts

All routes: zod in `data/validators.ts`, `openApi`, per-method `metadata`, tenant-scoped, pageSize ≤ 100, responses include `n` and `computedThrough`.

| Route | Feature |
|---|---|
| `GET /api/insights/xray/processes` | `insights.xray.view` (+ the process root's view feature) |
| `GET /api/insights/xray/{processKey}/map` | `insights.xray.view` |
| `GET /api/insights/xray/{processKey}/variants` | `insights.xray.view` |
| `GET /api/insights/xray/{processKey}/bottlenecks` | `insights.xray.view` |
| `GET /api/insights/xray/{processKey}/rework` | `insights.xray.view` |
| `GET /api/insights/xray/{processKey}/conformance` | `insights.xray.view` |
| `GET /api/insights/xray/{processKey}/breakdown?groupBy=role,team,org,user` | `user` additionally requires `insights.xray.view_individuals` + tenant setting |
| `GET /api/insights/xray/{processKey}/cases` | `insights.xray.view` (ids only) |
| `POST /api/insights/xray/{processKey}/variants/{hash}/workflow-draft` | `insights.xray.view` — returns a validated payload, persists nothing |
| `GET` / `PUT /api/insights/xray/settings` | `insights.xray.manage` (optimistic lock) |
| `POST /api/insights/xray/backfill` | `insights.xray.manage` → 202 `{ progressJobId }` |
| `GET /api/insights/xray/suggestions`, `GET …/suggestions/{id}/draft`, `PATCH …/suggestions/{id}` | `insights.xray.view` / `insights.xray.manage` (lock) |

## UI

Backend pages `backend/insights/process-xray` (list), `[processKey]` (map on `@xyflow/react` + `@dagrejs/dagre`, variants, bottlenecks, rework, conformance, breakdown) and `[processKey]/cases`; dashboard widget "Process health"; suggestion cards with a review dialog that creates the draft through `useGuardedMutation` (+ `retryLastMutation`, `useConfirmDialog`, `surfaceRecordConflict`), Cmd/Ctrl+Enter and Escape. Charts from the backend chart family with DS tokens. Read-only AI tools `insights.xray_summary` and `insights.xray_variants`.

## Access Control

| Feature | Default roles |
|---|---|
| `insights.xray.view` | admin |
| `insights.xray.manage` | admin |
| `insights.xray.view_individuals` | none (superadmin only) |

## Integration Coverage

| Path | Test |
|---|---|
| Deal stage changes projected; undo voids | TC-INS-X01, TC-INS-X02 |
| RBAC, individuals gate, k-anonymity, access log | TC-INS-X03 |
| Suggestion → disabled workflow draft | TC-INS-X04 |
| Variant → workflow draft payload | TC-INS-X05 |
| Settings optimistic lock 409 | TC-INS-X06 |
| Live query timeout → 422 | TC-INS-X07 |
| Tenant/org isolation; cache isolation between users | TC-INS-X08, TC-INS-X09 |
| Pages and dashboard widget smoke | TC-INS-X10 |

## Migration & Backward Compatibility

Additive only: new tables, new convention file `insights.process.ts` (frozen once shipped), new ACL features, new API routes, new AI tool ids, new generated file `insights-process.generated.ts`, additive `ActionLogService.scanDecrypted`, additive soft-optional workflows DI service. Operator steps: migrations, `yarn mercato auth sync-role-acls`, optional `mercato insights xray:backfill`.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Ingest load on large `action_logs` (decryption) | High | Batches with byte budgets, concurrency ≤ 2, settle lag, rollups, kill switch | Backfill duration on very large tenants |
| Misleading statistics | High | Guards above, `n` always shown, censoring, coverage gating | Seasonality interpretation remains the user's |
| Employee monitoring / GDPR | High | Default off, k-anonymity, pseudonyms, fail-closed access log, erasure subscribers | Tenant opt-in responsibility |
| Plaintext leakage of sensitive values | High | Value pattern + encryption-map guard + cardinality cap | — |
| Wrong suggestions (automating automation) | Medium | Only post-foundation `user` rows; already-automated detection; drafts disabled | — |

## Final Compliance Report

FK ids only; tenant + org scoping; zod + `openApi` + `metadata`; decryption only in the worker via `ActionLogService`; optimistic locking on settings and suggestions; DS tokens and shared UI primitives; i18n in 5 locales; pageSize ≤ 100; additive BC.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 5 — Data layer | Done | 2026-10-08 | Hardened after review (see changelog): per-process self-healing contracts, strict scan decryption, batched erasure, bounded status counts. Contract + `insights.process` plugin (boot-time encryption-map guard over every path segment, value pattern, 200-value cap), customers/sales/staff/auth declarations, seven tables (incl. erasure ledger) + concurrent `action_logs_state_change_idx`, strict `ActionLogService.scanDecrypted`/`scanStateChanges`, fenced-lease ingest (windowed reads, separate overlap budget, settle lag, state pass, nightly/weekly reconciliation scans with single job chains, pruning, exact truncated cases), pinned pseudonym key, backfill with ProgressJob, settings route/command (optimistic lock), status route, CLI, GDPR ledger subscriber, organization-created schedule subscriber, ACL; CLI/worker plugin registrations (`bootstrap-registrations.cli.generated.ts`) |
| 6 — Analytics, UI, suggestions | Not Started | — | — |

## Changelog

- 2026-10-08: Phase 5 review hardening. Decisions and deviations:
  - **Per-process contracts (replaces the global `contract_hash` / `rebuild_required`)**: the cursor stores `contract_hashes` (process key → hash of the derivation version, the process declaration and the fields of that process the tenant encrypts through its own encryption maps). Each ingest or scan slice compares them under the lease: a new cursor (or one reset by `xray:rebuild`) adopts the current hashes; a **changed or added** process is queued in `pending_rebuild_keys` (first, so the status shows it), its events, cases and rollups of the organization are deleted in fenced, budgeted batches (resumed by the next slice) and only then is its new hash recorded; the next slice with no running scan starts a `full_reconcile` limited to the queued processes from the later of the retention start and `coverage_from` (`scan_process_keys`: reads only their resource kinds, records no organization-wide reconciliation timestamps; an abandoned or replaced rebuild scan re-queues its processes; a scan of every process never consumes the queue). Rows of the last 15 minutes come back at once through the overlap re-read. A **removed** process (owner module disabled, declaration rejected) is dropped from the map without a rebuild: its rows stay, reads (status) filter to registered processes, retention prunes them; re-adding it rebuilds it. Unchanged processes keep ingesting throughout. Every transition is logged (warn, with process keys) and shown in the status (`contractChange`, `rebuildingProcessKeys`). Adding a tenant encryption-map entry for a declared field therefore re-projects that process automatically (values become `other`). Ordering and hashing use code-unit comparison, never locale collation.
  - **Rolling deploys**: workers of the old and new release compute different hashes for a changed process, so during the deploy window they may clear and re-queue it alternately (each transition deletes only that process's rows and queues one scan; rows are always written under the hash stored at write time, because every transition and write happens under the organization's lease). A process the new release removes looks "added" to an old worker, which may clear it once more (its rows are no longer shown anyway). This is bounded by the deploy window and self-healing: the first slice after the deploy settles on the new hashes and one rebuild scan follows. `PROCESS_DERIVATION_VERSION` is 2 (non-person cause ids are now sanitized), so existing development projections rebuild themselves.
  - `xray:rebuild` stays the operator tool (full re-projection, e.g. after a permanent pseudonym key change). It empties the contract map before clearing (a clearing that fails midway leaves every process to be cleared and rebuilt by the next slice) and its reset clears `last_full_reconciled_at`, so a backfill that fails to start leaves a full reconciliation due on the next caught-up tick. Backfill no longer refuses outdated contracts (the scan reconciles them first). The tenant redaction set is resolved fail-closed: without the tenant encryption service the slice fails instead of projecting unredacted values or flipping every contract.
  - **Strict scan decryption**: `scanDecrypted` throws `ActionLogDecryptionUnavailableError` (the slice retries, the cursor never moves past the row) whenever tenant data encryption is on but the service is unavailable (checked per row, also mid-page) and whenever a row still carries a sealed column while no data key was obtained (transient KMS/Vault failure, encryption toggled off). A sealed whole column the obtained key opens (e.g. one the tenant's map no longer lists) is opened. Only rows sealed under another key (key obtained, envelope will not open) are skipped: the main pass counts them in `undecryptable_rows` (each row once) and a backfill reports the ones it meets in the history; both report `insights.xray_undecryptable_rows` (counts only) and store an `[internal]` `last_error`; re-reads (overlap, reconciliations, rebuild scans) are not reported again. The lenient decryption of every other audit read is unchanged. A permanent cause (encryption switched off with sealed rows left, a lost tenant key) stops the organization's ingest with that error in the status; the operator restores the key / setting or disables X-Ray for the organization (settings or the `insights_xray_ingest` toggle).
  - **Indexes**: `action_logs_scan_idx` (`tenant_id, organization_id, created_at, id`, partial `deleted_at is null`, built concurrently in its own non-transactional migration) serves the scan probe; it costs one more index entry per audited command (write amplification on the busiest table) in exchange for scans that no longer walk other organizations' rows. The unreleased insights migration gained `insights_process_events_occurred_idx` and `insights_process_cases_retention_idx` (retention pruning across processes); value cardinality checks use point lookups and a bounded loose index scan on the existing value index instead of `select distinct … limit 201` per field and slice.
  - **Erasure**: per organization, in bounded batches (5 000 rows), each in its own transaction holding only that organization's cursor lock; value fields are discovered under the first batch's lock, so fields of processes no longer registered are erased too. The ledger is committed first and every fenced commit applies it after locking the cursor, so no concurrent ingest can re-introduce the old pseudonym. Lease attempts give up after a 5 s `lock_timeout` (counted as busy).
  - Actor dimension provider failures fail the slice (retried) instead of writing events without dimensions (events are insert-once). Non-person cause ids are stored only when they are identifiers or UUIDs. The boot-time encryption guard also checks the modules of the declared resource kinds and logged resource kinds, and rejects a declaration whose entity belongs to another module than its resource kind.
  - Status: counts run under a 3 s statement timeout and degrade to null with `countsTimedOut`; `coverageFrom` / `historyScanned` tell from when the projection is complete (an organization without backfill is covered only from its cursor's creation, so `computedThrough` alone is not "full history"); overlap re-reads that hit their statement timeout are logged and counted (`overlapTimeouts`). `listCursors` requires a tenant unless `{ allTenants: true }` is passed explicitly (paged, for system fan-outs).
  - **Budgets**: the "per-tenant byte budget" of the architecture section is implemented as global ingest queue concurrency ≤ 2 plus per-slice page/byte/time budgets (main pass, overlap pass, contract clearing); no per-tenant byte accounting exists.
  - **Anonymisation**: no user-anonymisation event exists in the platform today; only `auth.user.deleted` feeds the erasure ledger.
- 2026-10-08: Phase 5 implemented. Decisions taken during implementation:
  - Contract additions: field value kind `user` (follow-up fields only; stored as the actor pseudonym), `exits` (an audit row of another resource's command ends the case, e.g. `sales.quotes.convert_to_order` ends the quote case with `converted`), a row whose "before" holds none of the process's stage paths while its "after" does is projected as a create (orders materialized from quotes). Person cause ids (`user`, `agent`) are never copied; `via_sync_run` tags any envelope with a `sync_run` frame. `command_id` is not stored: the audit module encrypts it, and Phase 6 mining works on activity keys. Milestones must declare their `entityId`.
  - The encryption guard runs at boot (module-registry listener) against the owning module's, the declared entity's and (milestones) the entity module's encryption maps, over the key and every snapshot-path / change-key segment, and fails closed until the module registry is ready; tenant-level encryption maps are applied at ingest (matching values are stored as `other`).
  - Decryption is strict: with tenant data encryption on and no usable encryption service the scan throws (the slice retries); a row whose encrypted columns stay sealed under the key in use is skipped and counted, never projected as ciphertext.
  - Pseudonyms: tenant data encryption on → HMAC under an HKDF key from the tenant DEK (missing DEK provisioned, unhealthy KMS fails the slice); off → the keyed platform lookup hash (`LOOKUP_HASH_PEPPER`); off without a pepper → no actor recorded and `user` values stored as `other` (never an unkeyed digest). Each cursor pins the key fingerprint it wrote under; an organization written under another key pauses (`key_mismatch`) until the key is back or a rebuild re-projects it.
  - GDPR: `auth.user.deleted` records the user in `insights_process_erasures` (one random `erased:<uuid>` per tenant and user) before rewriting existing rows under the row locks of all the tenant's cursors (waits for in-flight commits); every fenced commit applies the ledger, so backfills, reconciliations, rebuilds and late commits never restore the pseudonym. The subscriber fails for a retry while the key is unavailable or an organization was written under another key.
  - Reads are windowed (start 1 h, doubled after a fast exhausted read up to 7 days, halved on a statement timeout down to 1 s), so a sparse range never times out forever; the 15-minute overlap re-read runs newest minutes first under its own budget.
  - Scans have one live job chain (`scan_chain_id`): a stalled scan (no heartbeat for 10 minutes) is handed to a new chain by compare-and-set, jobs of an old chain stop; scheduled reconciliations start only when no scan runs (under the lease); an abandoned scheduled reconciliation counts as attempted (retried at its next due time).
  - Cases with more than 500 events keep exact counts, last activity, actors, cause kinds, current stages, status and end time (SQL aggregates); only the variant and rework count cover the first 500 events.
  - Rebuild is refused while ingest is disabled; `last_error` stores only `[internal]` messages or error name + SQLSTATE; `directory.organization.created` registers the new organization's ingest schedule.
  - Ingest: per-organization cursor created at `now - 60 s` (history via backfill or the weekly full reconciliation, both bounded by `retention_days`); every write is a transaction that locks the cursor row and checks owner + fencing token, and positions are re-read once the lease is held; a row found undone/redone also voids earlier events of that row; reconciliation scans reuse the backfill machinery (one resumable scan per organization, superseded scans stop, abandoned jobs clear the scan and fail the progress job).
  - Backfill reads up to the request time (no settle lag); late commits are caught by the incremental overlap.
  - New tables keep inline transactional indexes (created empty in the same migration); only the `action_logs` index is concurrent.
  - Generator plugins can opt into CLI/worker registration (`bootstrapRegistration.cli`), so `mercato` CLI commands and queue workers see the X-Ray and "Why?" registries.
  - Settings writes go through the `insights.xray.settings.save` command (audited, compare-and-set on `updated_at`).
  - The `admin` role default lists the insights features explicitly instead of `insights.*`, so `insights.xray.view_individuals` stays super-admin only.
  - Not observed (no audit row of the document): order status side effects of payment/shipment commands, quote status changes by `sales.quotes.send` / `sales.quotes.accept`.
- 2026-10-08: Spec created from the approved plan (design + red-team review).
