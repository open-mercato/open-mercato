# Insights: Change Simulator

| Field | Value |
|---|---|
| Status | Approved for implementation (after design review) |
| Owner | insights |
| Depends on | `2026-10-08-insights-causation-and-explain.md` (causation columns, explain registry, `RbacService.explainAccess`), `2026-10-08-insights-process-xray.md` (stacked delivery, `ActionLogService.scanDecrypted`, soft-optional DI precedent `workflowDraftService`) |
| Related | `2026-06-18-call-openmercato-business-rule-action.md`, `2026-05-13-operation-progress-framework.md`, `implemented/2026-05-25-oss-optimistic-locking.md` |

## TLDR

Before a user changes a business rule, a workflow trigger, a role's permissions or a catalog price row, the simulator shows the first-order impact on recorded history. It **evaluates, never executes**: owning modules contribute pure simulators through a new convention file `insights.simulate.ts`; `insights` orchestrates private, budgeted, cancellable runs and stores ids + aggregates only. Results are three-valued (`fires` / `does_not_fire` / `cannot_tell`) where `cannot_tell` is reserved for inputs the simulator genuinely cannot reconstruct. "Apply" stays in the owning module's API, executed by the browser as the user with the optimistic lock; the server afterwards verifies whether what was applied matches what was simulated (detective control).

## Overview

- **Value**: configuration changes stop being leaps in the dark; a change proposed by a person or an AI agent can be checked against history before a human applies it.
- **MVP scope**: rule backtest (7a), workflow trigger backtest (7b), role ACL change preview (7c), price-row amount backtest (7d); private runs with progress, cancellation, budgets and TTL; decision records (`applied`, `discarded`) verified by the server.
- **Out of scope (follow-ups)**: bulk-edit fan-out preview (CRUD payloads carry ids only, so a patch never reaches rules or triggers — needs declared bulk-event payloads first), scheduling changes, second-order chains (rules triggering rules, workflow steps emitting events), new price rows and repricing logic, demand elasticity, widget / AI-tool / webhook counts in the permission preview, AI-started runs.

## Problem Statement

Rules, triggers, permissions and prices are edited without knowing their effect. A rule whose conditions can never match a CRUD payload (CRUD events carry `{ id, organizationId, tenantId }` only) is not silent — it runs its **failure actions on every event**; a rule with a null event type never fires on CRUD events at all; more than 100 matching rules stop all rule execution for the event. A role ACL change can silently remove access from users and API keys. Nothing in the platform estimates this before the change is saved.

## Proposed Solution

### Design decisions

| # | Decision | Rejected |
|---|---|---|
| S1 | **Evaluate, never execute.** Simulators call only pure evaluators (`evaluateExpressionTri`, `evaluateFilterConditions`-equivalent, RBAC preview). They never call `executeRules`, the action executor, commands or event emitters; a zero-side-effect test per contribution enforces it. | Execute-then-rollback dry runs (handlers own their transactions; side effects are not deferred). |
| S2 | New convention file `insights.simulate.ts`, types in `packages/shared/src/modules/insights/simulate.ts`, `defineSimulateConfig({ version: 1, kinds, eventAdapters })`, discovered by a third plugin in `insights/generators.ts` (`cli: true`) into `insights-simulate.generated.ts`. Each kind declares `kind`, `artifactKind`, `requiredFeatures` (non-empty, covering every source it reads; a kind without them is skipped at registration — fail closed), `inputSchema` (zod, validated against the owning module's own schema), `readArtifactVersion(scope, artifactId)` (scoped, returns `{ updatedAt, fingerprint }`), and `run(input, ctx)`. Registry on `globalThis`; duplicates first-wins with a warning. | `insights` importing other modules' internals. |
| S3 | **Rule backtest inputs** come from two tiers. `observed`: post-foundation `rule_execution_logs` rows (`run_id IS NOT NULL`) written by the `business_rules:crud-rule-trigger` subscriber (innermost causation frame), deduplicated by `(entity_type, event_type, entity_id, correlation_id, caused_by_log_id, sha256(data))`; rows from the manual execute API, workflow guards or warranty adjudication are excluded and counted in coverage. `reconstructed`: audit history read through `ActionLogService.scanDecrypted` and turned into event payloads by **event adapters** declared by the emitting module (`{ eventId, logResourceKinds, actionTypes, payloadFrom(entry) → { payload, unknownPaths } }`); a generic CRUD adapter is derived for events using the generated CRUD payload schema. Patterns without an adapter go into coverage; 422 `unsupported_event_payload` only when nothing matched has an adapter. | Evaluating against full entity snapshots (would claim firings that never happen in production). |
| S4 | **Three-valued evaluation, production-faithful.** `business_rules` owns `evaluateExpressionTri(expr, data, ctx, { unknownPaths })` mirroring the existing operators, with a parity test against `evaluateExpression` on fully known inputs. A field absent from the payload evaluates exactly as in production (absent is a known outcome); `cannot_tell` only for adapter-declared unknown paths, the redaction sentinels `[REDACTED]` / `[Max depth exceeded]` on the path or any ancestor, a regex rejected by the RE2 guard, an evaluation error, or `evaluationCompleted: false`. | Treating every missing value as unknown (contradicts production). |
| S5 | **Rule discovery semantics are reproduced**: event type matched by equality (null never matches CRUD events), effective windows, enabled flag, the 100-matching-rules limit (`rule_limit_exceeded` flag when the proposal crosses it), failure actions counted as "runs failure actions". The proposed rule is evaluated inside the whole discovered set; other rules keep their current definitions (first-order caveat). | Using `filterRulesByContext` (different null semantics). |
| S6 | **Historical clock.** An additive `evaluatedAt?: Date` on the rule evaluation context and a trailing optional `at?: Date` on rule discovery (`isRuleEffective`, `findApplicableRules`); when absent behaviour is unchanged (test). `{{now}}` / `{{today}}` default from it only when not set. Observed tier uses `executed_at`, reconstructed uses `action_logs.created_at` (caveat: production uses queue processing time). | Reusing `context.now` for effective windows (would change production behaviour for callers that set it). |
| S7 | **Trigger backtest** (7b): only triggers embedded in the highest enabled published version of the proposed definition; `evaluateFilterConditions` with an own-property path accessor; mirror the excluded event prefixes (exported by workflows); debounce simulated leading-edge per `(trigger, payload.id)`; a configured `maxConcurrentInstances` yields `cannot_tell` for the affected events; code-registry definitions require `customize` first (422 `not_customized`). | Replaying instance starts. |
| S8 | **Role ACL preview** (7c): `RbacService.previewRoleAclChange(tenantId, roleId, proposed)` built from the existing ACL loading helpers (parity test: unchanged proposal ⇒ identical effective features); principals are users holding the role without a `UserAcl` and API keys holding the role, per applicable organization (`organizationsJson`), global super-admins and hidden super-admins excluded from lists and counts; diff via `resolveEffectiveFeatures`; counts of gated pages, API routes and menu items from the app registries. Runs inline in the API route (app process), requires `auth.acl.manage` (+ `auth.users.list`), writes a fail-closed access-log row first (`insights.simulation.permission_preview`, retained kind), proposed features validated against the ACL catalog, mandatory self-lockout warning. Stores counts only; the affected-user list is resolved live on read under the viewer's `auth.users.list`. | Reimplementing ACL precedence in insights. |
| S9 | **Price backtest** (7d): only amount changes of an existing price row (`unitPriceNet` / `unitPriceGross`); lines found through `metadata->>'priceId'` in the window, order lines and quote lines reported separately (never summed — conversion would double count); classification without per-document history: build the row's amount timeline from its own audit history (≤ 200 entries, else `truncated`) and compare at the line's `created_at` — match ⇒ priced-from-row, difference while the row was constant ⇒ manual override (excluded), within 5 ms of a row change ⇒ unverifiable; deltas per currency (no FX), quantities constant. Reuses the "Why?" price helpers (`priceAmounts`, `resolvePriceBasis`, `readPriceAmountAsOf`). Caveat: `priceId` is written only by the browser line dialog, so API/AI/converted lines without it are invisible (reported as coverage). | Repricing all lines through catalog resolution (sales never resolves catalog prices at line creation). |
| S10 | **Runs are private to the requester.** Exactly one verified organization per run (`organization_id NOT NULL`; unresolved ⇒ 400 `organization_scope_required`). `GET`, list, cancel and decision answer an identical 404 for foreign, other-organization, expired or non-owned runs; `insights.simulator.view` means "my runs". Artifact and source features are re-checked on every read. | Shared runs (would hand one user's results to another). |
| S11 | **Dedupe** after every authorization check: `inputs_hash = sha256(kind, proposal, artifact version, absolute window rounded to the UTC hour, engine_version, contribution version, requester user id, organization id)`; partial unique index `(tenant_id, organization_id, kind, inputs_hash) WHERE status IN ('queued','running','completed')`. Failed / cancelled runs never block a retry. No `force` flag. | Global dedupe across users. |
| S12 | **Jobs and fairness**: queue `insights-simulation` (concurrency 2); payload `{ runId, tenantId, organizationId }` only; the worker re-verifies the tenant/organization pair and re-checks the requester's features (`rbacService.userHasAllFeatures`) at start — a deleted or demoted requester ⇒ `cancelled` with `error_code = forbidden`; one slice per job with continuations (X-Ray pattern), a tenant with a running slice is requeued with a delay; deadline enforced inside the record loop plus `statement_timeout` per batch; read-only transactions. Limits: ≤ 2 active runs per user and ≤ 5 per tenant (checked under a tenant advisory lock, else 429 `simulation_busy`), 20 submissions per user per hour (shared rate-limit helper), `input_json` ≤ 64 KB, condition depth ≤ 64, budgets 50 000 records / 120 s / 365-day window / byte budget per batch, `truncated` + coverage when hit. | Foreground execution; unbounded shared queue. |
| S13 | **ProgressJob is not a side channel**: generic i18n name without artifact names, `meta = { runId }`, no `resultSummary`, percent-only progress (no `totalCount`); the worker treats the ProgressJob's cancellation as authoritative and reconciles the run to `cancelled`; `POST …/cancel` is allowed for the requester only (or `progress.manage`). | Rich progress metadata. |
| S14 | **Result privacy**: ids + aggregates only, no record values, no per-actor breakdowns; any count cell below k (the organization's X-Ray `k_anonymity`, default 10, floor 5) is reported as "fewer than k" with no sample ids; sample ids are persisted only after the owning module's scoped `loadCurrent` (explain contract) confirms them in scope and are resolved live on read under the viewer's permissions. `error_code` is an enum; caveats are i18n keys; never exception text. | Storing payload values. |
| S15 | **Apply is the owning module's API, verification is server-side (detective).** The server captures the artifact version and the proposal fingerprint (rules: `computeRuleDefinitionHash`) at request time; the client never supplies them. `POST …/decision` (`applied` / `discarded`) re-reads the live artifact through `readArtifactVersion` and sets `verified = live.updatedAt > run version AND live fingerprint == proposed fingerprint`; the UI shows "applied — differs from the simulation" when unverified. Where the artifact has no `updatedAt` (some `RoleAcl` rows), the browser re-reads and compares the contributed fingerprint before writing. Optimistic locking may be disabled by `OM_OPTIMISTIC_LOCK=off`; the decision check still detects drift. Kinds whose owning update path has no lock and no fingerprint get no "Apply" action. | Server-side apply proxy; trusting client-declared outcomes. |
| S16 | **Decisions** are append-only (`insights_simulation_decisions`): no update/delete path, no `updated_at`, unique `(run_id, decision)`, tenant/organization copied from the run, only for `completed` unexpired runs the caller can see, written through a command so `action_logs` also records them; no FK cascade, so decisions outlive the run purge (retained 13 months). | Mutable decision rows. |
| S17 | **Storage hygiene**: `input_json` and `result_json` encrypted via a new `insights/encryption.ts` (defense in depth — they hold ids and aggregates only); TTL per kind (permission preview 24 h, backtests 30 d) enforced at read (`expires_at > now`) and purged in bounded batches by a new daily insights tick. | Plaintext inputs; read-time-only expiry. |
| S18 | **GDPR**: `auth.user.deleted` deletes the user's runs and rewrites `decided_by_user_id` to a random per-tenant `erased:<uuid>` token (never restored); organization / tenant deletion purges runs; results contain no user ids. | Keeping requester identities. |
| S19 | **AI** stays read-only: tool `insights.simulation_result` returns the caller's own runs (ids + aggregates, labels JSON-encoded as data); no AI-started runs in the MVP. | AI-triggered simulations. |

## Architecture

- `packages/shared/src/modules/insights/simulate.ts` — contract types, `defineSimulateConfig`, generic CRUD event adapter helper.
- `insights/generators.ts` — third plugin → `insights-simulate.generated.ts` (`simulateConfigEntries`, `cli: true`).
- `insights/lib/simulation/*` — registry, inputs hash, budgets, limits, run lifecycle, k-suppression, result shaping, decision verification.
- Contributions (each module's `insights.simulate.ts`):
  - `business_rules` — kind `business_rules.rule_backtest`; owns `lib/simulation/tri-state-evaluator.ts`, the `evaluatedAt` / `at` options, observed-tier reader; concurrent index `(tenant_id, organization_id, entity_type, executed_at)` on `rule_execution_logs`.
  - `customers`, `sales` — event adapters for their CRUD and lifecycle events.
  - `workflows` — kind `workflows.trigger_backtest`; exports the excluded-prefix list and an own-property path accessor.
  - `auth` — kind `auth.role_acl_preview` (inline); `RbacService.previewRoleAclChange`.
  - `catalog` + `sales` — kind `catalog.price_backtest`; price row version/timeline (catalog), line scan + classification (sales, reusing exported "Why?" helpers).
- Worker `workers/simulation.worker.ts` (queue `insights-simulation`, concurrency 2); daily tick (purge, decision retention) registered as a system schedule next to the X-Ray tick.
- Subscribers: `auth.user.deleted` (S18), organization/tenant deletion purge.
- Commands: `insights.simulation.request`, `insights.simulation.cancel`, `insights.simulation.decision.record`; custom write routes run mutation guards.

## Data Models

| Table | Columns | Notes |
|---|---|---|
| `insights_simulation_runs` | `id`, `tenant_id`, `organization_id` (NOT NULL), `kind`, `status` (`queued`, `running`, `completed`, `failed`, `cancelled`), `progress_job_id`, `requested_by_user_id`, `input_json` (encrypted), `inputs_hash`, `artifact_kind`, `artifact_id` (nullable for unsaved rules — apply = create), `artifact_version_json` (`{ updatedAt, fingerprint }`, server-captured), `proposal_fingerprint`, `window_from`, `window_to`, `budgets_json`, `fidelity`, `coverage_json`, `result_json` (encrypted; aggregates + sample ids), `caveats` (i18n keys), `engine_version`, `contribution_version`, `error_code` (enum), `created_at`, `started_at`, `completed_at`, `expires_at`, `updated_at` | Immutable once terminal (`updated_at` only moves while queued/running); partial unique index (S11); indexes `(tenant_id, organization_id, requested_by_user_id, created_at desc)`, `(expires_at)` |
| `insights_simulation_decisions` | `id`, `tenant_id`, `organization_id`, `run_id` (no FK), `decision` (`applied`, `discarded`), `decided_by_user_id`, `artifact_kind`, `artifact_id`, `artifact_updated_at_after`, `verified`, `created_at` | Append-only; unique `(run_id, decision)`; server-set `artifact_updated_at_after` / `verified` |

Index migrations follow the concurrent-index pattern (`isTransactional(): false`, drop-if-exists then create concurrently) for `rule_execution_logs`; new insights tables get inline indexes in their own transactional migration.

## API Contracts

| Route | Feature | Notes |
|---|---|---|
| `GET /api/insights/simulations/capabilities` | `insights.simulator.view` | Kinds the caller may run (each kind's `requiredFeatures`, wildcard-aware) |
| `POST /api/insights/simulations` | `insights.simulator.run` + the kind's `requiredFeatures` | 202 `{ runId, progressJobId }`, 200 existing run (own dedupe), 200 inline result for `auth.role_acl_preview`, 400 `organization_scope_required`, 403, 422 `unsupported_*` / `invalid_proposal` / `not_customized`, 429 `simulation_busy` / rate limit; mutation guards |
| `GET /api/insights/simulations` | `insights.simulator.view` | Own runs only, pageSize ≤ 100 |
| `GET /api/insights/simulations/{id}` | `insights.simulator.view` + kind features re-checked | Identical 404 otherwise |
| `POST /api/insights/simulations/{id}/cancel` | `insights.simulator.run` | Requester only (or `progress.manage`); mutation guards |
| `POST /api/insights/simulations/{id}/decision` | `insights.simulator.run` | Body `{ decision }` only; server verification (S15); mutation guards |

All routes: zod in `data/validators.ts`, `openApi`, per-method `metadata`, translated errors `{ error, code }`.

## UI / UX

- `backend/insights/simulations` (my runs), `backend/insights/simulations/[id]` (result: headline counts, three-valued breakdown, coverage, caveats, "fewer than k" cells, sample ids resolved live through owning APIs, decision actions).
- "Simulate impact" entry points injected through widget spots: rule detail/edit (7a), workflow definition editor (7b), role ACL page (7c), price row edit (7d). Each opens a dialog that submits the current, unsaved proposal (Cmd/Ctrl+Enter, Escape), shows progress, and links to the result.
- Apply happens in the owning page: the result links back with the run id; the owning page's save uses its normal optimistic-lock header; after save the page records the decision (`useGuardedMutation`, `surfaceRecordConflict` on 409 → "re-simulate").
- DS primitives and tokens only; i18n in en/pl/de/es/ko; confidence/cannot-tell conveyed by text + icon, not color alone.

## Frontend Architecture Contract

Server page roots with client islands (`*.client.tsx`); all data through `apiCall` / `readJsonSafe`; writes through `useGuardedMutation` with `retryLastMutation` in the injection context; no raw `fetch`; injected widgets declared in `widgets/injection-table.ts` against existing spot ids (no new spot ids unless a host lacks one — then an additive spot with a BC entry).

## Commands & Events

Commands `insights.simulation.request`, `insights.simulation.cancel`, `insights.simulation.decision.record` (audited). No new domain events; no notifications in the MVP.

## Cache

None: runs are private and stored; results are read from the run row. Capabilities are computed per request (cheap).

## Indexes & Query Cardinality

- Observed tier: `rule_execution_logs (tenant_id, organization_id, entity_type, executed_at)` concurrent partial index (`run_id is not null`); keyset paging by `(executed_at, id)`.
- Reconstructed tier: `action_logs_scan_idx` (X-Ray) via `scanDecrypted`.
- Price lines: `metadata->>'priceId'` has no index; the scan is bounded by window + organization on existing `(tenant_id, organization_id, created_at)` line indexes and by the record budget; an expression index is a follow-up if measurements require it.

## Access Control

| Feature | Default roles | Notes |
|---|---|---|
| `insights.simulator.view` | admin | Own runs |
| `insights.simulator.run` | admin | `dependsOn: insights.simulator.view` |

Listed explicitly in `setup.ts` (nested wildcards such as `insights.simulator.*` are not honoured). Kind features: rule backtest `business_rules.view` + `business_rules.view_logs` (+ the entity's view feature from the adapter); reconstructed tier past values additionally require `audit_logs.view_tenant`, otherwise affected paths become `cannot_tell`; trigger backtest `workflows.definitions.view`; ACL preview `auth.acl.manage` + `auth.users.list`; price backtest `catalog.pricing.manage` + `sales.orders.view` / `sales.quotes.view` per document family (a family is omitted without its feature).

## Phasing

| Phase | Content | Cross-module changes |
|---|---|---|
| 7a | Foundation (contract, plugin, tables, encryption, ACL, worker, routes, commands, limits, TTL tick, GDPR subscriber, UI list/result, AI tool) + rule backtest (observed + reconstructed) | `business_rules`: `evaluatedAt` / `at`, `tri-state-evaluator.ts`, `insights.simulate.ts`, index migration; `customers`, `sales`: event adapters |
| 7b | Trigger backtest | `workflows`: `insights.simulate.ts`, exported prefixes + accessor, `readArtifactVersion` |
| 7c | Role ACL preview (inline) | `auth`: `RbacService.previewRoleAclChange` + parity test, `insights.simulate.ts`, injection on the role ACL page |
| 7d | Price-row backtest | `catalog` + `sales`: `insights.simulate.ts`, exported price helpers |

## Integration Coverage

| Path | Test |
|---|---|
| Rule backtest 202 → completed (observed + reconstructed), k-suppressed cells, apply with stale `updatedAt` → 409, decision verified/unverified | TC-INS-S01 |
| Unsupported pattern → 422; invalid proposal → 422; missing kind features → 403 | TC-INS-S04 |
| Runs private: another user (same org, same features) gets 404 for GET/cancel/decision and does not receive the dedupe hit; other organization isolation | TC-INS-S05 |
| Cancellation (requester; ProgressJob cancel reconciles) and ProgressJob carries no artifact data | TC-INS-S03 |
| Trigger backtest incl. debounce and `maxConcurrentInstances` → cannot_tell | TC-INS-S06 |
| ACL preview: without `auth.acl.manage` → 403; hidden super-admins absent from counts; access-log row written | TC-INS-S07 |
| Price backtest: override exclusion, per-currency totals, orders vs quotes separated | TC-INS-S02 |
| Busy limits → 429 | TC-INS-S08 |

## Migration & Backward Compatibility

Additive only (documented in `BACKWARD_COMPATIBILITY.md` → "Change simulator"):
- §1 convention file `insights.simulate.ts` (`defineSimulateConfig`, `version: 1`) — FROZEN once shipped; types in `@open-mercato/shared/modules/insights/simulate`.
- §2 optional parameters: `evaluatedAt` on the rule evaluation context, trailing `at` on rule discovery; new export `evaluateExpressionTri`; new `RbacService.previewRoleAclChange`; workflows exports.
- §7 routes `/api/insights/simulations*`, pages `/backend/insights/simulations*`.
- §8 two new tables; one concurrent index on `rule_execution_logs`.
- §9 DI keys: none new (contributions are discovered through the generated registry).
- §10 ACL features `insights.simulator.view`, `insights.simulator.run` — FROZEN.
- §11 events/notifications: none.
- §12 AI tool `insights.simulation_result` (read-only).
- §14 generated file `insights-simulate.generated.ts` (`simulateConfigEntries`).
- Queue `insights-simulation`, ProgressJob type `insights.simulation`, access-log kind `insights.simulation.permission_preview` (retained).

Operator steps (`UPGRADE_NOTES.md`): migrations, `yarn generate`, `yarn mercato auth sync-role-acls`, encryption-map seeding for existing tenants, a worker for the new queue.

## Risks & Impact Review

| Risk | Severity | Affected area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|
| Simulation differs from production | High | Rule/trigger backtests | A proposal reports 0 firings, production fires on events whose payload the adapter rebuilt differently | Observed tier first; adapters owned by emitting modules; parity tests; discovery semantics mirrored; coverage + caveats; first-order label | Second-order chains, queue-time clock |
| Boolean oracle over unreadable data | High | Rule backtest | A user crafts `data.email STARTS_WITH 'a'` to learn values | Source features (`view_logs` + entity view) required at request and re-checked in the worker; k-suppression; no values stored | Users who may read the logs anyway |
| Cross-user leakage | High | Runs, dedupe, ProgressJob | User B receives A's result via dedupe or reads A's job metadata | Private runs, requester in hash, identical 404, minimal ProgressJob metadata | — |
| Permission preview leaks ACLs | High | ACL preview | A role manager learns hidden super-admins or other orgs' members | `auth.acl.manage`, org scope, hidden super-admins excluded, counts only, access log first | — |
| Simulated ≠ applied | Medium | Apply | User simulates X, saves Y | Server-captured fingerprint + server-side verification; UI badge | Detective, not preventive |
| Shared-queue starvation | Medium | Worker | One tenant floods `insights-simulation` | Per-user/tenant active limits, rate limit, slices with per-tenant requeue, budgets | Bounded wait under load |
| Production behaviour change from clock option | Medium | business_rules | Callers setting `context.now` get different effective windows | Separate `evaluatedAt`; default unchanged; test | — |
| Price coverage gaps | Medium | Price backtest | Lines created via API lack `priceId` and are invisible | Reported as coverage; caveat | Data quality of `priceId` |

## Final Compliance Report

| Rule | Status |
|---|---|
| No direct ORM relations / no cross-module internals imports | Contributions via convention file; RBAC/workflows logic stays in owners |
| Tenant + organization scoping | One verified organization per run; worker re-verification |
| RBAC wildcard-aware, declarative guards | `requireFeatures` metadata + `rbacService.userHasAllFeatures` for kind features |
| zod + `openApi` + `metadata`, pageSize ≤ 100 | All routes |
| Encryption via `findWithDecryption` | `input_json`, `result_json` |
| Commands + mutation guards for writes | request / cancel / decision |
| Optimistic locking | Apply in owning modules; decision verification |
| i18n, DS tokens, no hardcoded strings | 5 locales |
| Integration tests for all API/UI paths | TC-INS-S01…S08 |
| BC additive, documented | `BACKWARD_COMPATIBILITY.md`, `UPGRADE_NOTES.md` |

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 7a — Foundation + rule backtest | Done | 2026-10-10 | Contract `@open-mercato/shared/modules/insights/simulate` + third generator plugin; tables, encryption map + backfill, ACL, worker + daily tick, commands, routes, GDPR/scope subscribers, UI (my runs, result, rule editor dialog + apply), AI tool `insights.simulation_result`; business_rules tri-state evaluator, clock options, observed reader + index, rule backtest kind; customers/sales event adapters. TC-INS-S01/S03/S04/S05/S08. |
| 7b — Trigger backtest | Not Started | — | — |
| 7c — Role ACL preview | Not Started | — | — |
| 7d — Price-row backtest | Not Started | — | — |

## Changelog

- 2026-10-10: Phase 7a implemented. Decisions taken while building it:
  - **k-suppression (S14)**: a non-zero cell below k is "fewer than k" (`below_k`); when some cells are suppressed and their union is still below k, the smallest visible non-zero cells are hidden too (`complementary`), so the shown total never reveals a small cell; a group with fewer than k records is suppressed as a whole (no total, no counts, no count-derived warnings). A zero cell describes no record and stays visible (otherwise "would never fire as configured" — the point of the backtest — could never be shown).
  - **Kind features (S2/Access Control)**: kinds may declare `inputFeatures(input)`; event adapters declare non-empty `requiredFeatures` (the record type's view feature) and the rule backtest requires those of the targeted entity type's adapters. Kind + input features are checked at request, before every slice and on every read (identical 404).
  - **Run storage**: `result_json` (encrypted) holds the continuation state while queued/running and the k-suppressed result once completed (no extra column); `artifact_id` and `decided_by_user_id` are `text` (generic artifact ids, `erased:<uuid>` tokens); `verified` is null for `discarded`. Extra partial index `insights_simulation_runs_active_idx` serves the limit checks.
  - **Liveness**: a queued/running run whose version has not moved for 30 minutes is failed as `abandoned` (at request time under the tenant lock, by the daily tick, and by the worker's abandoned-job hook), so a lost job never blocks its requester's limit for long.
  - **Slices (S12)**: each slice runs in a READ ONLY transaction holding the tenant's `pg_try_advisory_xact_lock` (busy tenant → requeued after 3 s) with `statement_timeout` 5 s; writes are compare-and-set on the run version, so a cancellation or a duplicate delivery wins cleanly; at most 200 slices per run.
  - **Rule backtest tiers (S3)**: observed rows are deduplicated with a sliding 10-minute key window (a row repeating the key of a row executed at most 10 minutes earlier is a duplicate delivery; a repeat after a longer gap counts again, as production re-ran it; rows arrive ordered by `executed_at`, so counts never depend on page or budget boundaries); a reconstructed event is skipped when an observed CRUD-trigger row of the same event type and record shares its correlation id or caused-by log id within the window. Sample ids prefer the payload `entityId` (customers person/company payloads carry the profile id in `id`).
  - **Tri-state evaluator (S4)**: tracks the possible outcomes of unknown branches, so an error reachable only through an unknown branch is `cannot_tell` (errors production certainly throws are still thrown → `cannot_tell` via `evaluationCompleted: false`); operators whose result cannot depend on the unknown side stay known.
  - **Adapters**: `createCrudEventAdapters` skips undo traces and failed entries (what an undo emits is module-specific) and treats `syncOrigin` as unknown for any cause a sync bridge may run under. Sales adapts only `sales.order.created` / `sales.quote.created`: the update/delete commands emit no CRUD event, and `sales.order.confirmed` / `.cancelled` are emitted without tenant scope in the emit options, so the rule trigger never evaluates them (reported upstream, not changed here).
  - **UI**: the rule create/edit forms publish `crud-form:business_rules.rule` (additive spot); the header widget runs the dialog, the main-spot widget records `applied` after the form's own optimistic-lock save (`onAfterSave`) and loads a linked run's proposal. The dialog stays mounted while closed, so a closed dialog keeps following its run. The `applied` write runs in the non-React `onAfterSave` handler (the form may navigate away right after it), so it is not a `useGuardedMutation` call (the form save is); `decision_exists` is silent and any other failure is flashed with a pointer to the result page, where the decision can be recorded.
  - **ProgressJob cancellation (S13)**: the run's ProgressJob is created non-cancellable. The progress bar lets any `progress.cancel` holder cancel any job of the organization, which would bypass "requester only (or `progress.manage`)"; runs are cancelled through `POST …/cancel`, which marks the job cancelled. The worker still treats a ProgressJob cancelled by any other path as authoritative and reconciles the run to `cancelled`.
  - **Coverage and suppression (S14)**: coverage counts sum the group totals, so when a group is suppressed below k a completed run keeps no coverage counts and carries the `insights.simulation.caveats.coverageHidden` caveat instead. Between slices the encrypted continuation state holds up to 10 unconfirmed candidate sample ids per cell; they are never served and are dropped when the run completes (only ids confirmed through the owning module's `loadCurrent` are kept) or ends otherwise.
  - **Failures are not denials**: a failing RBAC service is reported and rethrown (500 on routes, queue retry in the worker), never treated as a missing feature that would cancel a run as `forbidden`.
  - **Artifact identity**: the run stores the artifact id the kind resolved (`readArtifactVersion`), so a differently spelled id dedupes, hashes and excludes the edited rule exactly like the canonical one.
  - **Clock (S5)**: `evaluatedAt` only replaces the wall clock of `{{today}}` / `{{now}}` and effective windows; `{{evaluatedAt}}` is not a template value (it resolves as in production, to nothing). Emptiness checks on an object or array that only holds redacted values are known: sanitizing keeps keys and lengths.

- 2026-10-10: Design review (feasibility fact-check against the implemented insights stack + security/privacy/BC review). Corrections: CRUD payloads carry ids only (bulk-edit preview deferred), `input_context` is plaintext with key-name redaction and mixed sources (observed tier restricted to the CRUD trigger subscriber), absent fields are known outcomes, discovery semantics and the 100-rule limit, failure actions, clock option separated from `context.now`, `priceId` written by the browser only, definition hash includes `enabled` and effective dates, RBAC preview built on `RbacService`, no daily tick existed. Security decisions S10–S18 added (private runs, source features, ProgressJob hygiene, ACL preview gating, server-side verification, abuse limits, k-suppression, GDPR). Scheduling and bulk preview moved out of the MVP.
- 2026-10-08: Spec created from the approved plan (design + red-team review).
