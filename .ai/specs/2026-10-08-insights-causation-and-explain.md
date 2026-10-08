# Insights: Causation Foundation and "Why?" Explainer

| Field | Value |
|---|---|
| Status | In Progress |
| Owner | insights (new core module) |
| Related specs | `implemented/SPEC-017-2026-02-03-version-history-panel.md`, `implemented/SPEC-020-2026-02-07-related-entity-version-history.md`, `2026-07-28-audit-log-read-tenant-scope-fail-closed.md`, `2026-06-18-call-openmercato-business-rule-action.md`, `2026-08-07-auth-acl-change-audit-logging.md`, `2026-08-21-scheduler-manual-trigger-audit-logging.md`, `2026-07-20-correlated-workflow-signal-waits.md` |
| Follow-up specs (planned) | `2026-10-08-insights-process-xray.md`, `2026-10-08-insights-change-simulator.md`, enterprise `enterprise/2026-10-08-agent-orchestrator-causation.md` |

## TLDR

Every mutation in Open Mercato already flows through the command bus and lands in `action_logs` with an actor, a command id, before/after snapshots and the changed fields. Nothing records **why** a mutation happened: a human edit, an API key, a workflow step, a business rule loopback, an AI action, a scheduled job or an import all look the same.

This spec adds:
1. **Causation foundation**: a server-derived cause (kind, id, correlation, parent log) stamped on every new `action_logs` row and propagated across in-process calls, queue jobs, event subscribers, workflow activities and HTTP loopbacks.
2. **"Why?" (Dlaczego?)**: a new `insights` module that explains any declared value or state of a record as a causal chain with an honest confidence level (`proven / inferred / unknown`), plus explanations of access-denied decisions.

The design rule is: **a false cause is worse than "unknown"**.

## Overview

- **Value**: support teams, auditors and users get a verifiable answer to "why is this value X / why can't I open this?" without reading raw audit logs. Automations (workflows, rules, AI agents) become accountable. The causation data also feeds Process X-Ray and the Change Simulator (follow-up specs).
- **Scope (MVP)**: causation columns + propagation; `insights.explain.ts` convention; explain engine; API; providers for generic fields, status, derived fields, sales line price and access-denied; record drawer, deep-link page, version-history and access-denied injection; CrudForm per-field "?" behind an explain mode; read-only AI tool.
- **Out of scope**: process mining and simulation (follow-up specs); enterprise agent-run frames (enterprise spec); fixing writes that bypass the command bus (they are surfaced as coverage hints).

## Problem Statement

1. `action_logs` has no link to the workflow instance, business rule run, AI pending action, schedule, sync run or subscriber that produced it. Workflow `UPDATE_ENTITY` writes look like human UI writes (`source_key='ui'`).
2. `rule_execution_logs.entity_id` is always `'unknown'` for CRUD-triggered rules, rule versions are never recorded, and the log row is written after actions run.
3. The business-rule HTTP loopback (`CALL_OPEN_MERCATO`) and workflow `CALL_API` identify themselves only through a key name (`__business_rule_<ruleId>__`) and client-sendable headers.
4. Undo trace rows copy the source row's `context_json`, inheriting any attribution stored there.
5. Some writes bypass the command bus (`sales/subscribers/reconcileOnCustomerDelete.ts`, `customer_accounts/subscribers/autoLinkCrm.ts`, the whole `customer_groups` CRUD, `warranty_claims` SLA sweep, Akeneo raw SQL); some commands have no `buildLog`; older rows have `changed_fields = NULL`.
6. There is no user-facing way to explain a value; the audit log list filters only by the alphabetically-first changed field (`primary_changed_field`).

## Proposed Solution

### Design decisions

| # | Decision | Rejected alternatives |
|---|---|---|
| D1 | Hybrid propagation: explicit `ctx.causation` (mirrors the existing `ctx.runAs`), ambient AsyncLocalStorage on `globalThis` (`Symbol.for('@open-mercato/shared/causation-context')`, like `packages/cache/src/tenantContext.ts`), server fallback from `ctx.auth`. | ALS only (lost at queue/HTTP boundaries, leaks into timers); metadata only (nested commands unreachable); headers (spoofable). |
| D2 | Frame **stack**; the innermost frame is the primary cause. Only the HTTP dispatcher seeds an entry frame (`originCausation ?? auth-derived`); in-process route calls (AI API runner) inherit the caller's frame; every queue job, scheduler tick and CLI command sets its own entry frame. | Wrapping every route handler (would erase `ai_tool` frames for in-process calls); outer frame wins (hides the actual automation). |
| D3 | Plaintext projection columns on `action_logs` (`cause_kind`, `cause_id`, `correlation_id`, `caused_by_log_id`); full envelope in encrypted `context_json.causation`. Columns contain identifiers only. | Context-only (no SQL aggregation under tenant encryption); separate causation table (second non-atomic write). |
| D4 | `ActionLogCreateInput` gains no cause fields. `ActionLogService.log(input, transactionalEm?, causation?)` writes the cause columns only from the new optional server-only third argument (or the ambient ALS envelope when omitted); the `causation` key is stripped from the merged log context (`metadata.context` → interceptor `logContext` → `buildLog().context`) and replaced by the server envelope. | Accepting cause from callers (spoofable). |
| D5 | HTTP loopback origin: new `api_keys.causation_json` (ids only) stamped server-side by `withOnetimeApiKey`; `resolveApiKeyAuth` exposes `auth.originCausation`. The HTTP create schema never accepts it. No key-name reservation is needed. | Parsing key names / reading `X-Business-Rule-*` headers (spoofable); reserving the `__` prefix (behavior change, unnecessary). |
| D6 | Undo/redo rows get kind `undo` / `redo` with `cause_id` = source log id; inherited `context.causation` is stripped from the copied context. Actor fields keep existing behavior. | Inheriting the original cause (misattribution). |
| D7 | Business rules: `runId` (UUID) generated before actions; `rule_execution_logs` gains `run_id`, `rule_version`, `rule_definition_hash`, `causation_json`; the CRUD trigger passes `entityId`. Rule version stays client-managed; the server records the definition hash so history can detect edits without changing the API contract. | Server-managed version bump (behavior change to a client-settable field). |
| D8 | `insights` owns no knowledge of other modules' records. Modules contribute `insights.explain.ts` (resources, fields, cause/reference resolvers) discovered by a module-level generator plugin, like `notifications.delivery-strategies.ts`. | `explain.ts` (too generic a convention name); hardcoded adapters in insights; putting the engine in `audit_logs`. |
| D9 | Field history is read **by resource** (`action_logs_resource_idx`), decrypted, and filtered in memory; rows with `changed_fields = NULL` are candidates. Consistency is checked **per field** at the declared snapshot path only when both sides contain it; a missing side yields `inferred`, never a gap. | Querying `changed_fields && $keys` (silently drops legacy rows); comparing whole snapshots (shapes differ per command). |
| D10 | Organization scope via `resolveOrganizationScopeFilter` (`directory/utils/organizationScopeFilter.ts`): `organizationIds === undefined` (unrestricted user, resolved tenant) = tenant-wide, `[]` = deny, list = `IN`. Every explain route additionally requires a resolved tenant (fail closed). | "null never means all" (locks out unrestricted admins). |
| D11 | Access explanations are composed from the public `RbacService.loadAcl`, `resolveFeatureOrganizationAccess` and `authorizeFeatures` (`packages/shared/src/security/featurePolicy.ts`) in a new additive `RbacService.explainAccess`; `loadAcl` itself is not refactored. A parity test asserts the explained decision equals `userHasAllFeatures`. | Re-implementing ACL evaluation in insights; refactoring the hot `loadAcl` path. |
| D12 | AI summary is deterministic (i18n templates over engine facts), never free-form inference. | LLM summarization (hallucination, prompt injection from notes). |
| D13 | Legacy rows (`cause_kind IS NULL`) are never backfilled; they are shown as "recorded as user X — may have been automation" with `inferred` confidence and bucketed as `legacy` by analytics. | Backfilling as `user` (would teach X-Ray to automate what is already automated). |
| D14 | Events emitted inside `execute()` before the log is persisted (e.g. `customers.deal.won`) cannot know `causedByLogId`; they are linked through `correlationId` with `inferred` confidence. Moving those emits after commit is out of scope. | Changing emit timing (behavior change). |

### Resolved open questions

| # | Question | Resolution |
|---|---|---|
| Q1 | `seq` column on `action_logs` | Not added. Ordering uses `(created_at, id)`; ties within 5 ms are flagged `orderUncertain`. Avoids touching the hottest table further. |
| Q2 | Past values for viewers without `audit_logs.view_tenant` | Hidden (`redacted: true`) except for the viewer's own changes; current value is always shown (the viewer can already read it). |
| Q3 | Server-managed rule version | No (D7). Definition hash recorded instead. |
| Q4 | `insights` in the create-app template | Yes, mirrored with a harness case, so standalone apps get the feature. |
| Q5 | Queue propagation scope | All queues (attached at enqueue in both strategies). |
| Q6 | Writes that bypass the bus | Surfaced via `unloggedWriters` / coverage labels; fixes are follow-up issues. |
| Q7 | CrudForm per-field spot rendering | Yes: render `crud-form:<entityId>:field:<fieldId>:after` only when widgets are registered for the form's field-spot prefix; insights' icon is visible only in explain mode; kill switch via feature toggle `insights_field_explain`. |
| Q8 | Default AI agents with `insights.explain_record` | None by default; tool is registered and available to agents that allowlist it. |
| Q9 | Enterprise agent-run frames | Separate enterprise spec + change set. |
| Q10 | Envelope cap | 8 frames / 2 KB, truncation flagged. |

## Architecture

### Causation types (`packages/shared/src/lib/causation/`)

```ts
type CauseKind = 'user' | 'api_key' | 'agent' | 'workflow' | 'business_rule' | 'ai_action' | 'ai_tool'
  | 'sync_run' | 'schedule' | 'subscriber' | 'undo' | 'redo' | 'system' | 'unknown'
type CausationFrame = { kind: CauseKind; id?: string | null; ref?: string | null; meta?: Record<string, string | number | boolean | null> }
type CausationEnvelope = { correlationId: string; frames: CausationFrame[]; causedByLogId?: string | null; truncated?: boolean }
```

- `types.ts` and `index.ts` are isomorphic; `server.ts` holds `runWithCausation`, `withCausationFrame`, `getAmbientCausation`, `runOutsideCausation`, `resolveCausationForCommand`, `sanitizeCausation`, `primaryCause`.
- `cause_id` is text: ids are UUIDs for records and runs, but subscriber ids (`business_rules:crud-rule-trigger`) and AI tool names are not.
- `meta` values are identifiers or small scalars only (no labels, no PII).

### Resolution order (command bus)

1. `ctx.causation` (explicit)
2. ambient ALS envelope (seeded by the HTTP dispatcher from `auth.originCausation` when `auth.isApiKey`, else from auth)
3. `ctx.runAs` → `agent`
4. `auth.isApiKey` → `api_key` (id = key id)
5. `auth.sub` → `user`
6. `ctx.systemActor` → `system`
7. `unknown`

`correlationId` is created by the entry point (HTTP dispatcher, job, scheduler tick, CLI) and stored in ALS; it is never read from `x-request-id`. When no ambient envelope exists (standalone apps on an older dispatcher, server components, direct callers), the command bus builds the entry envelope itself via `buildEntryCausationForAuth` — which also restores `auth.originCausation` for one-time loopback keys — and mints a fresh `correlationId`. The dispatcher change is a one-line call to the shared helper `runWithRequestCausation(auth, fn)`.

Kill switch: `OM_CAUSATION=off` disables resolution and stamping (columns stay null), mirroring `OM_OPTIMISTIC_LOCK`.

Cause kinds are core-owned and ADDITIVE-ONLY (persisted values, frozen once shipped). Third-party automations are represented by the generic frames they run in (`subscriber`, `schedule`, `system`) with identifiers in `id`/`ref`.

### Propagation points

| Boundary | Mechanism | File(s) |
|---|---|---|
| HTTP API | dispatcher seeds entry frame + correlation | `apps/mercato/src/app/api/[...slug]/route.ts` (+ template mirror) |
| Command → side effects | the `runPostCommit` closures in `execute()` and `undo()` run after-interceptors, cache invalidation and `flushCrudSideEffects` inside `runWithCausation({ ...env, causedByLogId })`; callbacks deferred through `onTransactionLifetimeComplete` capture the envelope explicitly | `packages/shared/src/lib/commands/command-bus.ts` |
| Queue | `metadata._causation` attached at enqueue (independent of telemetry), restored at dispatch; missing → explicit `unknown` entry frame (never the poller's ALS) | `packages/queue/src/causation.ts`, `strategies/{local,async}.ts` |
| Event subscribers | each delivery wrapped in a `subscriber` frame (`id` = subscriber id, `ref` = event name) | `packages/events/src/bus.ts` |
| Workflow | `startWorkflow` sets `metadata.causation` itself, last (client metadata cannot override); activities run in a `workflow` frame (`id` = instance, `ref` = step instance) stacked on the current trigger (queue restore, scheduler tick, signal sender); on resume without an ambient envelope the entry frame is `system` and the start causation stays in metadata as `origin` | `workflows/lib/workflow-executor.ts`, `workflows/lib/activity-executor.ts` |
| Business rules | `executeActions` (`business_rules/lib/action-executor.ts`, invoked from `rule-engine.ts`) runs in a `business_rule` frame (`id` = rule UUID, `ref` = run id) | `business_rules/lib/rule-engine.ts` |
| HTTP loopback | `withOnetimeApiKey` captures ambient causation into `api_keys.causation_json`; `resolveApiKeyAuth` → `auth.originCausation` | `api_keys/services/apiKeyService.ts`, `packages/shared/src/lib/auth/server.ts` |
| AI | `ai_action` frame (pending action), `ai_tool` frame (tool name) | `ai-assistant/.../lib/pending-action-executor.ts`, `tool-executor.ts` |
| Scheduler | `schedule` frame | `scheduler/.../lib/commandContext.ts`, `workers/execute-schedule.worker.ts` |
| Data sync | `sync_run` frame (`id` = run id) in the sync engine run entry points; `syncOrigin` (loop prevention) unchanged | `data_sync/lib/sync-engine.ts` |
| Undo / redo | `undo` frame in `undo()`; `redo` frame in `execute()` with `options.redoLogEntry` (incl. `atomicReplay`); inherited `context.causation` stripped from copied contexts | `command-bus.ts` |
| CLI | `system` entry frame with `ref = cli:<module>:<command>` | `packages/cli` module command dispatch |

### `insights` module

- `packages/core/src/modules/insights/`: `index.ts` (`requires: ['audit_logs','auth']`), `acl.ts`, `setup.ts`, `di.ts`, `generators.ts`, `lib/explain-registry.ts`, `lib/engine/*` (pure), `lib/providers/*`, `services/explainService.ts`, `services/accessExplainService.ts`, `api/explain/**`, `widgets/**`, `components/**`, `backend/insights/why/*`, `ai-tools.ts`, `i18n/{en,pl,de,es,ko}.json`, `AGENTS.md`, `__integration__/`.
- Convention file `insights.explain.ts` (types in `packages/shared/src/modules/insights/explain.ts`, `defineExplainConfig`, `version: 1`), generated `insights-explain.generated.ts` registered at bootstrap; registry lives on `globalThis` and rejects duplicate `resourceKind`s.

```ts
export const explainConfig = defineExplainConfig({
  version: 1,
  resources: [{
    resourceKind: 'customers.deal',
    logResourceKinds?: string[],
    labelKey: string,
    formEntityIds?: string[],
    requiredFeatures: string[],
    loadCurrent: (ctx: ExplainLoadContext, id: string) => Promise<Record<string, unknown> | null>,
    fields: [{ key: 'status', labelKey, valueKind, snapshotPaths: ['deal.status'], changeKeys: ['deal.status'],
               currentPath: 'status', provider?: string, derived?: { dependsOn: string[] },
               requiredFeatures?: string[], unloggedWriters?: [{ id, labelKey }] }],
    customFields?: { entityId: string, snapshotContainers: string[], allowKeys?: string[], requiredFeatures?: string[] },
    collections?: [{ key: 'lines', snapshotPath: 'lines', itemIdPath: 'id', requiredFeatures?: string[], fields: [...] }],
    noHistory?: { reasonKey: string },
  }],
  causeResolvers?: [{ kind: CauseKind, requiredFeatures: string[], resolve: (ctx, refs) => Promise<CauseDetail[]> }],
  referenceResolvers?: [{ kind: string, requiredFeatures: string[], resolve: (ctx, refs) => Promise<ReferenceDetail[]> }],
  providers?: Record<string, ExplainFieldProvider>,
})
```

### Engine verdicts and confidence

- Verdict: `explained | partially_explained | unexplained | no_history | pending`.
- `pending`: current value differs from the last logged value but the record's `updated_at` is within the 2-minute grace window (log written after commit).
- `unexplained`: current value differs from the last logged value outside the grace window → "no history record found" (with a known `unloggedWriters` label when declared). Never worded as "bypass".
- Confidence per entry and overall:
  - `proven`: post-foundation cause columns present **and** the field value at the declared path is consistent with the neighbouring entries/current value;
  - `inferred`: legacy row, value only from `changes`, derived field, provider inference, stale identity-map snapshot (`before == after` for the field), dangling `caused_by_log_id`, correlation-only link;
  - `unknown`: everything else.

### Field-level authorization

A field, collection or custom field the viewer cannot read through the owning module's API is excluded from descriptors and returns 400 `unknown_field`; the engine never emits snapshot values for undeclared keys. Custom fields are limited to `allowKeys` when declared.

### Viewer visibility matrix

| Viewer | Actor identity of others | Past values (`from`/`to`) of others' changes | Own changes | Current value |
|---|---|---|---|---|
| `audit_logs.view_tenant` | shown | shown | shown | shown |
| `audit_logs.view_self` only | "another user" | redacted | shown | shown |
| neither | "another user" | redacted | redacted | shown |

Cause details (workflow, rule, AI action, sync run, schedule, api key) are shown only when the matching resolver's `requiredFeatures` pass; otherwise the cause shows its kind with `available: false`. Causes whose target belongs to another organization (including hops via `caused_by_log_id`) are `available: false`.

### Scan budget and caching

- At most `OM_INSIGHTS_EXPLAIN_SCAN_MAX` (default 500) log rows per request, keyset `(created_at, id)` descending, `statement_timeout` 5 s. The overview reuses the same single scan. `truncated: true` caps overall confidence at `inferred`.
- Query budget per request: in-memory descriptor lookup, 1 `loadCurrent`, ≤ ⌈scan/100⌉ log batches, 1 batched resolver call per cause kind (no N+1).
- No server cache for `/explain*`: responses are viewer-redacted and must be fresh. Descriptors are computed from the in-memory registry × caller features. No new cache tags; command-bus cache invalidation unchanged.

### MVP resources

| Module | Resource | Fields | Provider |
|---|---|---|---|
| customers | `customers.deal` | status, pipeline stage, value amount, owner, custom fields | generic / status |
| customers | `customers.person`, `customers.company` | display name, status, lifecycle stage, custom fields | generic / status |
| sales | `sales.order`, `sales.quote` | status, totals (derived from lines), lines collection (unit price, quantity) | status / derived / `sales.line_price` |
| customer_groups | (no history) | — | coverage label "this module records no history" |
| workflows, business_rules, ai_assistant, data_sync, scheduler, api_keys | cause resolvers | — | — |
| catalog | reference resolver `catalog.price` | — | — |
| dictionaries | reference resolver `dictionary.entry` (labels) | — | — |

## Data Models

All new columns are nullable without defaults (metadata-only `ALTER`, executed with `SET LOCAL lock_timeout = '5s'`). Indexes are declared on the entities (so the snapshot stays in sync and `db:generate` does not re-emit them) but created in a separate hand-written migration with `isTransactional(): false`, `drop index concurrently if exists` before `create index concurrently` (lesson `concurrent-index-migrations-must-recover-from-invalid-build-stubs`, precedent `catalog/migrations/Migration20260914120100.ts`).

| Table | Columns | Indexes (concurrent) | Serves |
|---|---|---|---|
| `action_logs` | `cause_kind text`, `cause_id text`, `correlation_id uuid`, `caused_by_log_id uuid` | `action_logs_cause_idx (tenant_id, cause_kind, cause_id, created_at)` | audit filter `causeKind`/`causeId` (causeId requires causeKind), cause resolvers "writes by workflow instance X" |
| | | `action_logs_correlation_idx (tenant_id, correlation_id)` | correlation-linked events (D14) |
| | | `action_logs_caused_by_idx (caused_by_log_id)` | chain hops from a log to its follow-up writes |
| `rule_execution_logs` | `run_id uuid`, `rule_version int`, `rule_definition_hash text`, `causation_json jsonb` | `rule_execution_logs_run_idx (tenant_id, run_id) where run_id is not null` | business-rule cause resolver by run id |
| `api_keys` | `causation_json jsonb` | — | — |

The organization-level cause aggregation index is deferred to the Process X-Ray spec. Plaintext copies of the envelope (`api_keys.causation_json`, `rule_execution_logs.causation_json`, `workflow_instances.metadata.causation`) are reduced with `toIdentifierOnlyCausation` (kinds, ids, uuid refs; no `meta`, no free-text refs); the full envelope lives only in the encrypted `action_logs.context_json`. `rule_definition_hash` is computed at execution time from the rule definition (no rules API change). Column migrations run with `set local lock_timeout = '5s'` (retry on timeout); index migrations are non-transactional.

### Degradation signals and known limitations

- `reportCausationDegradation(reason)` warns once per reason per process (then debug) when causation is weaker than expected: `queue_missing_envelope` / `queue_invalid_envelope` (job runs under `unknown` with `ref = queue:missing_causation|queue:invalid_causation`), `api_key_origin_invalid`, `onetime_key_no_ambient`, `log_fallback_actor` (log written without ambient causation; frame carries `meta.derivedFrom = 'actor'` and the explain engine caps it at `inferred`), `workflow_frame_no_instance`, `rule_entity_id_unresolved`.
- An envelope whose innermost frame kind is unknown to the running process (rolling deploy) is rejected instead of silently promoting the outer frame.
- Undo post-commit effects are linked to the undo by `correlationId` (the trace row id is not returned by `markUndone`; changing that return is a BC break).
- Loopback writes keep the origin's `causedByLogId` and record the one-time key on the innermost frame (`meta.viaKeyId`).
- Viewers without `audit_logs.view_tenant` receive `causeId`/`causedByLogId` = null for `user`/`agent` causes in the audit list.
- Known limitations (documented, out of scope): AI Code Mode `api.request()` loopbacks use the chat session key and are recorded as `api_key`; BullMQ `failed`/abandonment callbacks run without the job envelope (they write no audit rows today).

No new insights tables in this spec. No FK constraints on `caused_by_log_id` (log writes are not atomic with domain writes).

## API Contracts

All routes export `openApi` and per-method `metadata`; inputs validated with zod in `insights/data/validators.ts`.

### `GET /api/insights/explain`
- Query: `resourceKind` (required), `resourceId` (required), `field?`, `itemId?`, `limit` (1–100, default 20), `before?` (cursor: ISO timestamp + id).
- Metadata: `{ GET: { requireAuth: true, requireFeatures: ['insights.explain.view'] } }` plus the resource's `requiredFeatures` (wildcard-aware).
- 404 `{ error: 'not_found' }` (identical body) for unknown kind, invisible or out-of-scope record; 400 for unknown field.
- Field response:

```ts
{ resourceKind, resourceId, field, itemId, current: { value, display, valueKind },
  verdict, confidence, summary: { key, params }, chain: ChainEntry[], gaps: Gap[], hints: Hint[],
  page: { limit, nextBefore, scanned, truncated }, viewer: { canSeeActors, canSeePastValues } }
ChainEntry = { logId, at, state: 'done'|'undone'|'redone', action, commandId, from: ExplainValue|null, to: ExplainValue|null,
  actor: { kind, id: string|null, label: string|null, isSelf: boolean, redacted: boolean }, onBehalfOf,
  cause: Cause, origin?: Cause, undoneBy?: string|null, confidence, orderUncertain?: boolean }
Cause = { kind, id, label, href, available, frames: CauseFrameView[] }
Gap = { afterLogId, beforeLogId, reason: 'unlogged_change'|'current_differs'|'missing_snapshot', at }
```
- Overview (no `field`): `{ fields: [{ field, labelKey, valueKind, verdict, confidence, lastChangeAt }], coverage }`.

### `GET /api/insights/explain/descriptors`
Returns resources/fields the caller may explain (filtered by features).

### `GET /api/insights/explain/log?logId=`
Explains one audit entry's cause. Audit read rules apply (`requireResolvedTenantScope`, own rows only without `audit_logs.view_tenant`) plus the owning record check; other-organization ids → 404.

### `GET /api/insights/explain/access?features=a,b&path=&userId=`
- Auth required (resolved tenant); `features` parsed with `readQueryParamList`, at most 20 ids, validated against the ACL catalog; `userId` optional (self by default; a user outside the caller's tenant/organization scope → 404).
- Response: `{ decision: 'granted'|'denied', required: [{ feature, granted }], reasons: ('missing_feature'|'organization_out_of_scope'|'user_acl_override'|'module_disabled'|'feature_removed'|'not_determinable')[], detail: AccessDetail|null, confidence }`.
- `detail` (roles, user ACL, roles that would grant, recent ACL changes) requires `insights.explain.access_detail`; explaining another user (`userId`) additionally requires `auth.users.list`.

### `GET /api/audit_logs/audit-logs/actions` (additive)
Items gain `causeKind`, `causeId`, `correlationId`, `causedByLogId`; filters `causeKind`, `causeId`, `correlationId`.

## UI

- Record drawer widget on `backend:record:current`; deep link `/backend/insights/why?resourceKind=&resourceId=&field=`.
- New spots: `version-history:entry:after`, `backend:access-denied:after` (context `{ path, requiredFeatures }`), consumed by insights; `detail:customers.deal:status-badges` consumer.
- New spot family `crud-form:<entityId>:field:<fieldId>:after` (declared in `CRUD_FORM_EXTENSION_SURFACES.fieldAfter`, flipped to `bound: true`; module facts regenerated). CrudForm renders it only in edit mode and only when the new `hasInjectionWidgetsForSpotPrefix` helper (in `shared/modules/widgets/injection-loader.ts`, re-evaluated when the registry registers late) finds registrations whose spot key contains `:field:` (exact or pattern). A bare `crud-form:*` registration (e.g. `record_locks.injection.crud-form-locking`) never resolves to field spots. Forms without field registrations render byte-identical DOM. insights registers field widgets only for the `formEntityIds` declared in explain configs (no global wildcard). The insights icon shows only in explain mode; kill switch: feature toggle `insights_field_explain` (default on, seeded soft-optionally, fail-open when `feature_toggles` is disabled).
- `AccessDeniedMessage` gains optional `path` and `requiredFeatures` props (additive) passed by `renderAccessDenied()` in the backend catch-all page and template mirror.
- Components: `WhyDrawer`, `WhyChain`, `CauseChip`, `ConfidenceBadge` (icon + text + status token, never colour-only), `AccessWhyPanel`. Empty → `TabEmptyState`; not found → `RecordNotFoundState`; errors → `ErrorMessage` with retry.

### Frontend Architecture Contract
- Server/client boundary: backend page `backend/insights/why/page.tsx` is a server component rendering a client leaf; injection widgets are `*.client.tsx` loaded lazily.
- `"use client"` ledger: `WhyDrawer.client.tsx` (interactive drawer), `WhyChain.tsx` (expand/collapse), `field-why/widget.client.tsx` (icon toggle), `access-why/widget.client.tsx` (fetch on demand). No other client files.
- Client blob guardrail: no new heavy dependencies; descriptors fetched lazily and cached per session.
- Hydration/interactivity tests: RTL tests for each widget; Playwright TC-INS-030..033.

## AI

`insights.explain_record` (`ai-tools.ts`, `isMutation: false`, `requiredFeatures: ['insights.explain.view']`) returns engine facts plus a deterministic i18n summary. Untrusted strings are encoded as data. Not allowlisted for any agent by default.

## Access Control

| Feature | Default roles |
|---|---|
| `insights.explain.view` | admin, employee |
| `insights.explain.access_detail` | admin |

## Integration Coverage

| Path | Test |
|---|---|
| Cause stamping, spoof rejection, API key, undo/redo | `audit_logs/__integration__/TC-AUD-*` (causation cases) |
| Workflow `UPDATE_ENTITY` cause; client metadata ignored | `workflows/__integration__/TC-WF-*` (causation cases) |
| Business-rule loopback cause + `entity_id` | `business_rules/__integration__/TC-BR-*` (causation case) |
| `GET /api/insights/explain` (proven, unexplained, redaction, other org, custom field, redo, no-history coverage) | `insights/__integration__/TC-INS-010..016, 019` |
| `GET /api/insights/explain/descriptors` | TC-INS-017 |
| `GET /api/insights/explain/log` | TC-INS-018 |
| `GET /api/insights/explain/access` + line price | TC-INS-020, TC-INS-021 |
| Drawer, deep link, access denied, field icon | TC-INS-030..033 |

## Migration & Backward Compatibility

| Surface (BACKWARD_COMPATIBILITY.md) | Change | Class |
|---|---|---|
| §1 Auto-discovery files | New convention `insights.explain.ts` | Additive; frozen once shipped |
| §2 Types | `CommandRuntimeContext.causation?`, `AuthContext.originCausation?`, `CommandActionLogService.log` optional third argument; `ActionLogCreateInput` unchanged; new `CauseKind` union (ADDITIVE-ONLY, persisted values frozen) | Additive optional |
| §3 Function signatures / component props | `ActionLogService.log(input, em?, causation?)`; new `ActionLogService.findFieldHistory`; new `RbacService.explainAccess`; `AccessDeniedMessage` optional `path` / `requiredFeatures` props | Additive |
| §4 Import paths | New `@open-mercato/shared/lib/causation`, `@open-mercato/shared/lib/causation/server`, `@open-mercato/shared/modules/insights/explain`, `@open-mercato/queue` causation helpers | Additive |
| §5 Event IDs / payloads | None (no payload changes) | — |
| §6 Widget spot IDs | New spot family `crud-form:<entityId>:field:<fieldId>:after` (was declared with `bound: false`, now bound), `version-history:entry:after`, `backend:access-denied:after` | Additive; frozen once shipped; UPGRADE_NOTES entry |
| §7 API routes | New `/api/insights/explain/**`; additive fields/filters on audit actions | Additive |
| §8 DB schema | Nullable columns on `action_logs`, `rule_execution_logs`, `api_keys`; concurrent indexes | Additive |
| §10 ACL features | `insights.explain.view`, `insights.explain.access_detail` | Additive; frozen once shipped |
| §12 AI tool ids | `insights.explain_record` | Additive |
| §9 DI service names | `actionLogService`, `rbacService` unchanged names, additive methods; new `explainService`, `accessExplainService` | Additive |
| §11 / §13 | Notification ids / CLI commands: new CLI `mercato insights explain:coverage` only | Additive |
| §14 Generated files | `insights-explain.generated.ts`; module facts regenerated for the bound field spot | Additive |
| Behavior | `rule_execution_logs.entity_id` now the record id for CRUD-triggered rules; `startWorkflow` ignores client `metadata.causation`; undo rows strip inherited `context.causation`; `source_key` derivation (`ui/api/system/agent`) and `sortField=source` unchanged | Documented in UPGRADE_NOTES |

Operator steps: run migrations (the index migrations are non-transactional and may take time on large `action_logs`), then `yarn mercato auth sync-role-acls`. Standalone apps: update the API catch-all dispatcher to call `runWithRequestCausation` (one line; without it the command bus still derives causation, only correlation across a request is lost).

## Phasing

Each phase is one independently reviewable change set (stacked branches).

| Phase | Scope | Exit criteria |
|---|---|---|
| 1a — Causation core | `shared/lib/causation`, command bus resolution + post-commit + undo/redo, `ActionLogService` stamping, `action_logs` columns + concurrent indexes, audit API fields/filters | Unit tests; TC-AUD-009..012 |
| 1b — Propagation | Dispatcher + CLI entry, queue `_causation`, event subscriber frames, workflows, business rules (`entity_id`, run id, hash), api_keys origin, AI, scheduler, data_sync | Unit tests; TC-WF (causation), TC-BR (causation) |
| 2 — Explain core | `insights` module, `insights.explain.ts` contract + generator, engine, `/explain`, `/explain/descriptors`, `/explain/log`, MVP resources, `explain:coverage` CLI | Unit tests; TC-INS-010..019 |
| 3 — Price and access | `sales.line_price` provider, `catalog.price` resolver, `RbacService.explainAccess`, `/explain/access` | Unit tests incl. RBAC parity; TC-INS-020..021 |
| 4a — UI and AI | Record drawer, deep link, `version-history:entry:after`, `backend:access-denied:after`, AI tool | RTL tests; TC-INS-030..032 |
| 4b — Field spots | CrudForm field spot family, explain mode, kill switch | RTL tests incl. byte-identical DOM; TC-INS-033 |

## Implementation Plan

1. Phase 1a: causation library and tests → `CommandRuntimeContext.causation` → command bus resolution/strip/post-commit/undo/redo → `ActionLogService` → entity + migrations (columns, then concurrent indexes) → audit route filters → integration tests.
2. Phase 1b: dispatcher + template mirror + CLI → queue strategies → events bus → api_keys entity/service/auth → workflows start/activities → business rules trigger/engine/logs → AI executors → scheduler → data_sync → integration tests.
3. Phase 2: module skeleton (acl, setup, di, i18n, AGENTS.md, modules.ts + template + harness case) → shared explain types → generator plugin + registry → engine (pure) → providers → services → routes → module declarations → CLI → tests.
4. Phase 3: line price provider + catalog resolver → `RbacService.explainAccess` + parity tests → access route → tests.
5. Phase 4a: components → widgets + injection table → deep-link page → new spots in ui → AI tool → tests. Phase 4b: injection-loader helper → CrudForm field spot → extension-point flip + facts → toggle seed → tests.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Index build blocks `action_logs` writes during deploy | High | Ops | Separate non-transactional concurrent index migration; `lock_timeout` on ALTERs | Concurrent build time on huge tables |
| Spoofed causation (headers, body, key names, metadata context) | High | Security | Server-only argument; stripping; key `causation_json` never accepted from HTTP | None known |
| Cross-organization leakage via explain or cause details | High | Security | Owning-module `loadCurrent` + org scope filter; cause resolvers query with tenant + org; identical 404 | — |
| False "proven" attribution | High | Trust | Per-field consistency, legacy → inferred, grace window, unlogged writer hints | Bypass write later reverted is undetectable (documented) |
| ALS leaks into timers/pools | Medium | Correctness | `runOutsideCausation`; entry points reset context; queue dispatch resets | — |
| ALS overhead per subscriber/command | Low | Performance | Micro-benchmark gate | — |
| CrudForm renders third-party widgets registered on previously unrendered spot | Medium | UX/BC | Rendered only when registered; UPGRADE note; kill switch | — |
| Explain query cost on long histories | Medium | Performance | Resource index, `statement_timeout`, limit ≤ 100, truncation flag | — |

## Final Compliance Report

| Rule | Status |
|---|---|
| No cross-module ORM relations | Pass (FK ids, resolvers via contract) |
| Tenant + organization scoping | Pass (D10) |
| zod validation, `openApi`, `metadata` | Pass |
| `findWithDecryption` for encrypted reads | Pass (`ActionLogService` decrypt path) |
| Encryption maps for sensitive data | No new PII columns; causation JSON holds ids only |
| Commands/undo | Read-only feature; no new mutations in insights |
| i18n en/pl/de/es/ko, DS tokens, a11y | Pass |
| pageSize ≤ 100 | Pass |
| Backward compatibility | Additive only (table above) |

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1a — Causation core | Done | 2026-10-08 | Library, command bus, ActionLogService stamping, audit API filters, migrations (columns + concurrent indexes); TC-AUD-009..012 pass |
| 1b — Propagation | Done | 2026-10-08 | Dispatcher + CLI, queue, events, workflows, business rules, api_keys origin, AI, scheduler, data_sync; TC-WF-066 and TC-BR-013 pass (person events carry the profile id as `id`, the customer entity id as `entityId`; rule logs use the payload `id`) |
| 2 — Explain core | Done | 2026-10-08 | Module, contract + generator, engine, service, 3 routes, coverage CLI, 11 module declarations; review fixes (record-org feature binding, exact custom-field comparison, continuation caps, envelope verification, synthesized undo values, collection item kinds); TC-INS-010..019 pass |
| 3 — Price and access | Not Started | — | — |
| 4a — UI and AI | Not Started | — | — |
| 4b — Field spots | Not Started | — | — |

## Changelog

- 2026-10-08: Spec created; open questions resolved with recommended defaults (owner decision: implement end-to-end without further questions).
- 2026-10-08: Revised after `om-spec-writing` review and `om-pre-implement-spec` audit: phasing and implementation plan, MVP resources, viewer visibility matrix, field-level authorization, scan budget and cache strategy, field-spot resolution rule (bare `crud-form:*` excluded), corrected D4/D10/D11 and propagation paths, correlation fallback in the command bus, kill switch, BC rows for §3/§4/§5/§9/§11/§13, non-partial concurrent indexes mapped to queries.
- 2026-10-08: Phase 2 implemented. Contract additions: `itemResourceKinds` on collections, `listRecordIds` on resources, verdict/confidence/gap constant sets, optional history-entry fields; response additions: `causedBy`, `stale`, `orderUncertain`, value `source` (`synthesized` for undo traces), `labelKey`, `dependencies`, `page.continuation`, `viewer.canSeeOwnValues`, summary `logId`.

### Review — 2026-10-08
- **Reviewer**: Agent (om-spec-writing fresh-context review) + Agent (om-pre-implement-spec audit)
- **Security**: Field-level authorization, visibility matrix, fail-closed tenant scope on all explain routes, cross-org cause hops — addressed
- **Performance**: Scan cap, index justification, field-spot fan-out gate, ALS micro-benchmark — addressed
- **Cache**: No explain cache (viewer-redacted, freshness) — declared
- **Commands**: Read-only module; undo/redo frames; `ActionLogService.log` signature row added
- **Risks**: Kill switch, dispatcher fallback, workflow resume semantics — addressed
- **Verdict**: Approved for implementation
