# Exports leave a record and an event

> **Program:** an OSS seam for package G2 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), split from [`enterprise/GDPR/2026-11-16-security-event-alerting.md`](../enterprise/GDPR/2026-11-16-security-event-alerting.md) after its review.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. The routes that bypass the CRUD factory were inventoried in the council review by listing every API route file that sets an attachment header and every API route under an `export` path; each is classified below.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/GDPR/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Any list in the product can be exported in full — up to a thousand pages — by adding two query parameters. Afterwards nothing says it happened. In the query-engine export branch the access log gets rows for the first page only, marked as an ordinary list read, and those rows are deleted after eight hours. No event is emitted, so nothing can react. **Proposed (future):** with `audit_logs` enabled, every export the server produces attempts one audit entry — who, which kind of record, which format, how many rows — and one event with the same facts. A successful entry is durable; either sink can fail without failing the export, and the failure is reported. The ten routes that build an export without the shared factory, nine in OSS and one in the enterprise package, use the same helper, and a guard test holds every route that hands out a file to a classified list.

**Not in this spec:** exports assembled in the browser from rows a list already fetched, which never reach an export route and cannot be told from reading the list; alerting on exports (the enterprise spec); limiting or approving exports; outbound synchronisation runs.

## 📝 Overview

The boundary is the server: an export is a response built by an API route to hand a staff user or an API key a file of records. Everything else (browser-built tables, manual paging through JSON) is a stated limit.

The design has two parts. One shared helper, `exportResponse`, builds the response and records the export as an action-log entry plus an internal persistent event carrying the same generated id; the CRUD factory calls it in both export branches and every custom export route calls it instead of building its own response. A guard test keeps a hand-kept classified list of every route under the repository's module roots that could hand out a file, so a new one is classified when it is written.

Recording is best effort. The entry and the event are independent sinks; a failure or a slow write of either is reported and never fails the export, and with `audit_logs` disabled neither is attempted. Recording is OSS; the only consumer specified so far is the enterprise large-export alert, and one enterprise route adopts the OSS helper. Export entries get a finite lifetime through the dedicated `audit_logs.export_evidence` retention set, which waits for the contract's tenant settings, the erasure spec's `applyRetention` and the record-retention runner before it ships.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Where the record goes | The action log, as an entry with no undo | The access log requires a record id on every row and keeps ordinary rows for eight hours; PR #8472 will also drop access-log writes under load. An export is an action by a user, and the action log is the durable place for those. |
| 2 | Does the per-record access logging change | No | It is a different question — which records were read — and another PR is rewriting it. |
| 3 | What counts as an export | A server response whose purpose is to hand a staff user or an API key a file of records: a list, one record, or one person's records. A respondent's copy of their own submission is not one | A small export is still data leaving. The count lets a consumer decide what is large. The respondent receives their own data, and the action log has no actor for a respondent or a holder of a submission token. |
| 4 | What the entry and event carry | Tenant, organization, actor, resource kind, format, scope, row count, and a generated id. No filters, no content | Filters can contain search text about a person. |
| 5 | Edition | OSS | It corrects a gap in OSS audit; the consumer is optional. |
| 6 | Recording guarantee | Best effort, independent sinks; exports succeed if recording fails | An audit outage must not become an outage of reads the caller is already allowed. Each sink failure is logged and reported. This spec claims no guarantee that every completed export has a record. |
| 7 | Raw export event forwarding | Internal event with `excludeFromTriggers: true`, including organization-scoped exports | Metadata must not leave through every organization's webhooks for tenant-wide exports. Enterprise alert forwarding uses its own organization-scoped event. |
| 8 | Lifetime of export evidence | 365 days, minimum 30; an active hold delays expiry | The program's one age for privacy evidence, as for the subject-export contract's EVIDENCE-AGE. A year leaves time to investigate an export; the floor stops a tenant setting from removing evidence before it can be used. It is a product choice, not a statutory period. No indefinite evidence exemption is claimed. |

## 📝 Problem Statement

- **Exports are built into every CRUD list.** `makeCrudRoute` accepts `format=csv|json|xml|markdown` and `exportScope=full`, in batches of 1000 by default and at least 100, up to a thousand pages (`packages/shared/src/lib/crud/factory.ts:302-306, 324-328, 1699-1708`). There are two export branches (`:2055`, `:2303`).
- **There is no page-only export scope.** The query-engine branch starts at page 1 with the export batch size and keeps fetching while pages come back full, for the user's filtered view as for a full export (`factory.ts:1930-1932, 2055-2090`). `exportScope=full` only swaps the user's filters for the route's base filters (`:1706-1708, 1933-1939`). The UI sends `exportScope=view` or `exportScope=full` (`packages/core/src/modules/customers/backend/customers/deals/page.tsx:387-395`).
- **The query-engine trace is partial and short-lived.** `logCrudAccess` runs before the loop that fetches the remaining pages, so it sees the first page; it writes one access-log row per record, typed `read:list` (`factory.ts:933-1007, 2042, 2066-2090`). Ordinary access-log rows live eight hours by default. The ORM fallback instead loads the matching list with `repo.find(where)` and logs that whole list before serializing it (`factory.ts:2264-2304`); preserve both branches' existing reads and record the number actually sent.
- **The access log cannot hold a summary.** `access_logs.resource_id` is required (`audit_logs/data/entities.ts:128-129`).
- **Ten routes export without the factory**, nine in OSS and one in enterprise:
  - custom-entity records (`entities/api/records.ts:94-123`);
  - the audit log's own actions export (`audit_logs/api/audit-logs/actions/export/route.ts:257`);
  - the timesheet report (`staff/api/timesheets/reports/[id]/export/route.ts:253`), which already emits an event of its own;
  - one submission and one subject's submissions in forms, as JSON files (`forms/api/submissions/[submissionId]/export/route.ts:74`; `forms/api/subjects/[subjectType]/[subjectId]/export/route.ts:101`);
  - one submission in forms as a PDF, for staff (`forms/api/submissions/[submissionId]/pdf/route.ts:97`);
  - a document as DOCX or PDF (`packages/documents/…/api/[id]/export/route.ts:432, 470`);
  - the EUDR annual report as CSV (`eudr/api/reports/annual/route.ts:412`);
  - the EUDR due diligence statement evidence packet, as JSON or GeoJSON with no attachment header (`eudr/api/statements/[id]/export/route.ts:495, 686`);
  - the approved agent eval cases, as JSON with no attachment header (`packages/enterprise/src/modules/agent_orchestrator/api/eval-cases/export/route.ts:27, 74`).
- **The public submission PDF is the respondent's own copy** (`forms/api/public/submissions/[id]/pdf/route.ts:66`). It is authorized by a submission token or a portal session, not by a staff user.
- **Some exports never reach the server as exports.** The data table serialises rows in the browser (`packages/ui/src/backend/DataTable.tsx:974-993`), as do the inventory and CRM task tables.
- **An action-log entry needs a command id** (`audit_logs/data/validators.ts:18`), needs no undo token, and stores its resource kind in clear and indexed. The projection derives action type from command-id suffixes and label words; `audit_logs.export.record` falls through to `system` when it has no CRUD-like action label (`audit_logs/lib/projections.ts:24-69`), which the audit page's default filters hide. Its context is encrypted, so the count and format cannot be filtered in SQL.
- **`audit_logs` has no `events.ts`**; adding one is a new auto-discovered file.
- **The export batch size cannot be set by a request**: it is the route's own setting or at least a thousand rows (`factory.ts:303-305, 324-328`).
- **Eighteen API route files set an attachment header.** Eight are exports from the list above and one is the respondent's own copy. Nine are plain file downloads: stored attachments and files (`attachments/api/file/[id]`, the attachment routes of forms, public forms, documents, support tickets and warranty claims, the S3 download, agent artifacts) and the WMS import template. Content types are computed at run time. Two exports set no header at all, so neither a route's name nor its header finds every export.

## 📝 Proposed Solution

One helper in the shared package, `exportResponse`, builds the file response and records the export. A route gives it the body, type, optional download file name, trusted request auth/scope context and export facts: resource kind, format, scope and row count. It never takes actor or tenant/organization from an export query or body. The request context resolves permitted scope before the helper is called; the helper uses `ctx.auth.tenantId`, `ctx.auth.keyId` or `ctx.auth.sub`, and the organization the export's effective filter covers. That filter is the factory's `ctx.organizationIds` (`factory.ts:1554-1574`): when it holds exactly one id, that id is the export's organization; otherwise the organization is null, meaning "not one organization". Null therefore covers both an unrestricted export (`organizationIds === null`) and a filter spanning several organizations, such as a user allowed A and B who selects all; the entry's encrypted context records `organizationScope` (`'one'`, `'several'` or `'all'`) and, for `several`, the sorted organization ids. A custom route builds its context through `resolveExportRequestContext`, which applies the same rule to the scope that `resolveOrganizationScopeForRequest` resolves for that request; it never falls back to the caller's home `auth.orgId`. Without a file name it sets no attachment header, so the two JSON exports keep their responses. The export's scope is one of:

| Scope | Meaning |
|---|---|
| `view` | The rows matching the caller's filters, every page: factory `exportFullRequested === false` |
| `full` | Every row the route lets the caller read, filters ignored: `exportFullRequested === true`, including `exportScope=full`, `export_scope=full` and `full=true` |
| `record` | One record: a document, a submission, a statement packet, a report |
| `subject` | One person's records |

The helper:

1. generates the export's id, a UUID;
2. writes an action-log entry under the command id `audit_logs.export.record`, with resource kind `audit_logs.export`, the export's id as its resource id, the exported kind as its parent resource kind, `parent_resource_id = null` for a list or subject export (and the exported record id for a record export), and the format, scope, count and organization scope in its context — and starts the action-log sink independently of event publication;
3. independently emits `audit_logs.export.completed` with `{ persistent: true, tenantId, organizationId, skipPersistentSubscribersInline: true }`, carrying the same facts and the export's id, so that a consumer can recognise a redelivery;
4. waits for the two independently started sink attempts to settle, up to a single five-second recording deadline (`EXPORT_AUDIT_TIMEOUT_MS = 5000`) measured from before either starts, then returns the response. That bound includes taps, inline listeners and queue enqueue in the event path. Report each timed-out sink once using `export_audit_entry_timeout` or `export_audit_event_timeout`. Observe late settlement without a second attempt, unhandled rejection or duplicate failure report. Late completion keeps the original export id in either sink; it never delays the response.

The helper first checks that `audit_logs` is enabled in the module registry. If disabled, it attempts neither sink, emits no event, and returns the same response. With the module enabled each sink is attempted independently, including enqueue after an entry failure. A failure of either sink is logged and sent to `reportError` without content or filter values, and does not fail the export. The export's id is generated before both, so the event carries it even when the entry could not be written.

The factory uses it in both export branches, once per response: after the query-engine page loop, or after the fallback's complete list has been prepared. Both count final exported rows after hooks, not the first-page count or requested total. Each route classified as an export below uses it in place of building its own response. The timesheet route keeps its own event as well. The one enterprise route adopts the OSS helper in the same change; nothing enterprise-only is specified here.

**The classified list.** A guard test finds every API route file under the repository's module roots — `packages/*/src/modules/*/api/`, `apps/*/src/modules/*/api/`, `packages/create-app/template/src/modules/*/api/`, and the module API directories of `external/official-modules/` when that submodule is checked out — that sets an attachment header, lies under a path segment containing `export`, or reads `exportScope`. Each must be in a hand-kept list with a class and a reason, the way `packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts` keeps its list. The guard covers the code in this repository only: modules of a standalone app or an official module that is not checked out are outside it, and their custom export routes are recorded only if they call the helper. Today the app and template roots hold no route that matches. A route added later joins the list in its own change. Phase 2 of [portal self-service](2026-11-16-portal-privacy-self-service.md) adds `customer_accounts/api/portal/privacy/export.ts` as a mandatory C1 subject copy. The enterprise DSR engine's Phase 2 adds `data_erasure/api/subjects/export` as an export ([`../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md`](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md), **A subject request from the page**):

| Class | Routes | Rule |
|---|---|---|
| Export | The ten routes above, and `data_erasure/api/subjects/export` once the DSR engine's Phase 2 adds it (`scope: 'subject'`) | Must call `exportResponse` |
| Own copy | `forms/api/public/submissions/[id]/pdf` | Must not call it (assumption 3) |
| Mandatory C1 subject copy | Portal `POST /api/customer_accounts/portal/privacy/export` once self-service Phase 2 adds it | Require the strict C1 export service and completed terminal audit before attaching data. No `exportResponse` call or `audit_logs.export.completed` event. |
| Plain download | The nine file and template routes above | Must not call it |
| Factory route | `devices/api/route.ts`, which names `exportScope` in a comment and has exports disabled | Builds no export response of its own; the factory records any export |

A route found by the scan and absent from the list fails the test, so a new route that hands out a file is classified when it is written. A listed route that no longer exists fails it too. Each owner adds its row when the route lands and this guard classifies an already present portal route when the guard lands later. The mandatory C1 subject-copy class checks the C1 owner-service call, excludes the generic helper and links the owner integration case that refuses an attachment when terminal proof is missing. C1 owns that evidence and its expiry.

| Alternative | Why rejected |
|---|---|
| A summary row in the access log | See assumption 1. |
| Emit from the access-log service | It may drop writes under load. |
| An event only | Nothing durable would remain for an investigation. |
| A helper that only records, called beside each route's own response code | Nothing ties the call to the response; a route could send the file and forget the call. |
| Detect exports by the attachment header alone | Half the routes that set it are not exports, two exports set none, and types are computed at run time. The header is one trigger for classification instead. |
| Guard by route name alone | Misses the submission PDF and every export not under an `export` path. |
| Record the respondent's own copy | The action log has no actor for a respondent or a submission token, and an entry about a person reading their own submission is not an export by staff. |
| A transactional outbox with a fail-closed response | Every export would depend on audit availability, under a new response contract. See assumption 6. |
| Require a controller-chosen age before recording | Recording would stay off wherever nobody chose. The 365-day default is finite and a tenant can change it. See assumption 8. |

### Export-evidence expiry

The [change-history retention spec](../enterprise/GDPR/2026-11-16-action-log-retention.md), “Enterprise”, excludes the `audit_logs.export` prefix from both stripping and deletion. It does not supply this entry's lifetime. This spec owns a separate expiry for the exact `audit_logs.export` resource kind, including helper entries with `scope: 'subject'`, such as the forms subject export and the DSR engine's subject download. It does not change the general-history exemption or C1's own subject-export evidence: the `privacy.subject_export` and `privacy.subject_export_request` entries that `exportSubjects` writes expire through C1's `privacy.export_evidence` set ([contract spec](2026-11-16-privacy-data-class-contract.md), **Export-evidence expiry**), never through this one.

Declare `retention.audit_logs.exportEvidenceAgeDays` in `audit_logs/privacy.ts.settings`: integer, days, minimum 30, default 365. Read it through contract-owned `privacySettingsService.get({ tenantId }, name)` under **R3-3 — Tenant privacy settings live in `module_configs`**. Declare `audit_logs.export_evidence` in `retentionSets`, with locale-key `title`/`ageBasis`, `minimumDays: 30`, `targets: ['records']`, `excludableSubjectKinds: []`, `unmatchedHoldsOptOut: 'forbidden'`, `handlerService: 'auditExportEvidenceRetentionHandler'` and `runEvidence: 'aggregate'`. **R3-2 — The registry carries the whole `privacy.ts` default export** owns discovery; preserve the existing `dataClasses` and other members.

Run this set only through `privacyRetentionService.run`, using **DEC-C — Retention sets and holds**, from the [record-retention spec](2026-11-16-privacy-record-retention.md), API Contracts and Implementation Plan steps 1–2. The audit-owned handler implements its `pruneRecords` signature, calls its own `actionLogService.applyRetention` under **DEC-B — The audit-history strip routine**, and uses `tenantId: scope.tenantId`, optional `organizationId`, `olderThan: new Date(input.cutoff)` from the service's fixed ISO cutoff, `mode: 'delete'`, `includeResourceKinds: ['audit_logs.export']`, `limit`, `after` and `dryRun`. Return `matched`, `deleted: changed`, `next`, `done` and `filesPending: 0`; never query another module's table. Reject a caller window shorter than the configured age. Invalid/unavailable settings refuse; continuations bind the setting version and require a fresh preview after a change. The [erasure spec](2026-11-16-privacy-subject-erasure.md) owns `applyRetention`, in API Contracts, so expiry waits for its Phase 2. Its replay-lease rule under **R3-1 — The audit-history rule for every erasure** also applies: a skipped live replay keeps the pass incomplete and retryable; do not advance past unresolved entries and claim successful expiry.

An export does not enumerate every person whose data it contains, especially for list and subject exports. Any active subject hold therefore skips the whole set with `hold_not_honourable`; a failed registered guard refuses. Explicit OSS exclusions have the same conservative result. The declaration's `unmatchedHoldsOptOut: 'forbidden'` makes the engine's policy validation refuse that opt-out for this set, and the handler also refuses nonempty `excludeSubjects` if an engine policy permits unmatched holds: this evidence set cannot honour that opt-out. Held entries become eligible at their original age after release. Delete the whole entry, including actor, resource/parent/related ids and context. Use the record-retention owner's **Aggregate evidence for expiry runs** and exact `PrivacyRetentionAggregateSummary` in **API Contracts**: only validated set id, counts and invocation dates survive as variable evidence; no actor, export, record or subject id or free-text reference is copied into new evidence. The declaration's `runEvidence: 'aggregate'` selects the shared writer in `privacyRetentionService.run`; the command and engine cannot override it or add a second identifying run entry. That writer and its tests in the owner's Implementation Plan step 7 must ship before expiry; the handler returns counts and never bypasses or duplicates runner logging. This dedicated expiry does not make the best-effort recording path fail closed.

OSS operators schedule the record-retention command by the configured deadline; the enterprise engine may run the same set. Until a runner is configured, the bound is not enforced. Recording docs state this gap. The helper's evidence has validated tenant scope; null-tenant history is outside this tenant set and is not claimed expired. Event/queue copies follow the [queue-payload spec](2026-11-16-queue-payload-minimization.md), not this action-log expiry.

## 📝 Delta

### Capability: export-audit

#### ADDED Requirement: Exports attempt recording
With `audit_logs` enabled, the system SHALL attempt one durable audit entry and one persistent event enqueue for every export the server produces for a staff user or API key. Each carries actor, record kind, format, scope and row count, with no content. It SHALL report a sink failure and still return the export. With `audit_logs` disabled it attempts neither. This is best effort, not a guarantee that every completed export has a record. Custom export routes are held to the helper by a guard over this repository's module roots; routes outside the repository are recorded only if they call it.

##### Scenario: Full export
- WHEN a user exports a list in full
- THEN one entry records the number of rows sent, and one event carries the same count

##### Scenario: A filtered view
- WHEN a user exports as CSV the rows matching their filters, and those rows span several export pages
- THEN one entry records every matching row sent, with scope "view", and one event carries the same count

##### Scenario: An ordinary list read
- WHEN a list is fetched as JSON for the page
- THEN no export entry is written

##### Scenario: A route outside the factory
- WHEN custom-entity records, a document, a submission as a PDF, a statement packet, or one person's form submissions are exported
- THEN an entry and an event are produced in the same way

##### Scenario: A respondent's own copy
- WHEN a respondent downloads the PDF of their own submission through the public route
- THEN nothing is recorded

##### Scenario: A portal subject's own copy
- WHEN the authenticated portal download is present
- THEN the guard classifies it as a mandatory C1 subject copy. The portal's C1 evidence must complete before an attachment is sent. The route emits no generic best-effort record or event.

##### Scenario: An unclassified route
- WHEN an API route sets an attachment header, lies under an `export` path or reads `exportScope`, and is not in the classified list
- THEN the guard test fails

##### Scenario: Recording fails
- WHEN either sink fails
- THEN the export still succeeds, that failure is logged and reported, and the other sink is independently attempted

##### Scenario: A recording sink stalls
- WHEN the entry write or event publication has not finished by the shared five-second deadline
- THEN the helper reports each pending sink timeout, the other attempt has already started independently, and the export returns

##### Scenario: An export across several organizations
- WHEN a user allowed organizations A and B, but not every organization, exports with all organizations selected
- THEN the entry and event carry a null organization, and the entry's encrypted context records `organizationScope: 'several'` with both ids

##### Scenario: Audit module disabled
- WHEN an export completes with `audit_logs` disabled
- THEN no entry or event is attempted; the large-export alert rule has no signal

##### Scenario: Raw export event is internal
- WHEN a webhook subscribes to `audit_logs.export.completed`, including a tenant-wide export
- THEN no delivery is created because the event declares `excludeFromTriggers: true`

Frozen by: `packages/shared/src/lib/crud/__tests__/export-access-logging.characterization.test.ts`

#### ADDED Requirement: Finite export evidence
Successful export entries SHALL expire through the dedicated set after their configured finite age, subject to holds; general history retention SHALL keep its evidence exclusion. An unconfigured expiry runner SHALL remain an explicit deployment gap.

##### Scenario: Old export evidence
- WHEN `audit_logs.export_evidence` applies with the configured age
- THEN only old `audit_logs.export` entries of that tenant are deleted, helper entries with `scope: 'subject'` included; recent and foreign-tenant entries remain, and C1's `privacy.subject_export` and `privacy.subject_export_request` evidence is untouched

##### Scenario: Held export evidence
- WHEN a subject is held and this set cannot attribute every exported subject
- THEN the set skips with `hold_not_honourable`; after release the old entry expires without restarting its age

## 📝 Architecture

- **`packages/shared/src/lib/crud/export-response.ts`**: the helper and `resolveExportRequestContext`. It resolves the action-log service and the event bus softly from the container.
- **`packages/shared/src/lib/crud/factory.ts`**: both export branches.
- **`audit_logs/events.ts`**: new; declares the internal event with `excludeFromTriggers: true`. Generators are re-run.
- **The ten export routes**: use the helper. Nine are in OSS packages; the agent eval-case export is in `packages/enterprise`.
- **`audit_logs/privacy.ts`, `di.ts`, `lib/exportEvidenceRetention.ts`**: declare the setting/set and register the audit-owned handler; reuse the contract settings service and record-retention driver. This expiry phase needs contract Phase 7 step 1, erasure Phase 2, record-retention steps 1–2 and step 7's shared aggregate writer and tests under **Aggregate evidence for expiry runs**; it does not add a table or a private timer.
- **`packages/core/src/__tests__/export-route-coverage.test.ts`**: the guard and its classified list.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Helper → action log and event | `actionLogService` and the bus by DI key | Audit module disabled: neither; the export is unaffected |
| Consumers | Subscribe to the event; the enterprise alerting spec is the first | Nobody listens |

## 📝 Data Models

None. One new `resource_kind` value in the action log.

## 📝 API Contracts

- **Event** `audit_logs.export.completed` — `{ id, tenantId, organizationId: string | null, actorKind: 'user' | 'api_key', actorUserId?, apiKeyId?, resourceKind, format, scope: 'view' | 'full' | 'record' | 'subject', rowCount, occurredAt }`, emitted with `{ persistent: true, tenantId, organizationId, skipPersistentSubscribersInline: true }` and declared `excludeFromTriggers: true`. Internal subscribers receive it; webhooks and workflow triggers do not. `organizationId` is the one organization the export's effective filter covers, or null when it covers every organization or several. `id` is the export's generated id and the entry's resource id. Additive; frozen once released. The scope values were checked against the factory, whose exports are `view` and `full` (`factory.ts:1706-1708, 1930-1939`).
- **`exportResponse(container, input)`** from `@open-mercato/shared/lib/crud/export-response`. New input contract below; zod validates facts, UUID scope, nonnegative integer count and the actor discriminant. It accepts only the route's trusted resolved context, never a client-populated actor or scope object. `auth.keyId` selects `actorKind: api_key` and `apiKeyId`; otherwise `auth.sub` selects `user` and `actorUserId`. `resourceId` is always the generated export UUID. The helper maps the trusted actor to the action-log service's existing actor fields; the context preserves the typed actor facts when the actor is a key. List and subject exports set `parentResourceId` to null; record exports pass only an already authorized record id. Additive.

```ts
type ExportFacts = {
  body: string | Uint8Array | ArrayBuffer | Blob; contentType: string; filename?: string; headers?: HeadersInit; status?: number
  resourceKind: string; format: string
  scope: 'view' | 'full' | 'record' | 'subject'; rowCount: number
  exportedRecordId?: string
}
```

The body is fully built before the call; zod rejects a `ReadableStream` or any other streaming body, because the helper records the export before it returns the response. The complete input is `{ context: ExportRequestContext, ...ExportFacts }`. `ExportRequestContext` projects the already authenticated `auth` and the effective organization filter from the route context, and derives `organizationId` (the filter's single id, otherwise null) and `organizationScope` (`'one' | 'several' | 'all'`) by the rule under Proposed Solution; it is built server-side, by the factory from its `CrudCtx` and by custom routes through `resolveExportRequestContext({ container, auth, request })` from the same module. Preserve the route's existing response status and other headers; absence of `filename` preserves the absence of a disposition header. Do not trust a body field with that shape. Unit tests give forged query/body scope and verify it cannot override this context. Full versus view is derived once from the factory's `exportFullRequested`, rather than re-parsing one spelling of its flags.

- No route path, parameter, format or header changes. The document export's GET and POST methods both use the helper; a route-file inventory must not omit its second method.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| The export fails part-way | Nothing is recorded if the body cannot be built; recording happens once the response body is fully built, and a transport abort after that is not detected |
| A route passes a streaming body | zod refuses it before anything is recorded; exports hand the helper a built body |
| The action-log write or event path stalls | The other sink is already in progress. After the common deadline, the response returns and the pending sink is reported. Late completion retains the original occurrence id |
| An export whose filter covers several organizations but not all | Null organization on the entry and event; the encrypted context records `organizationScope: 'several'` and the ids. The alert consumer treats it as tenant-wide |
| An export by an API key | `actorKind` is `api_key` and the actor is the key |
| A client that pages by hand through JSON, or a table exported in the browser | Not an export to the server; stated as a limit |
| The entry cannot be written or the event enqueue fails | Each failure logged and reported; the other sink still attempted; response unaffected |
| Audit module disabled | No entry and no event, even if a bus is present; export alerts have no source |
| Tenant-wide export with no organization | Entry retains its trusted null organization with `organizationScope: 'all'`; the trigger-excluded event reaches internal subscribers only |
| A document or a single record | Recorded with scope "record" and a count of one |
| A filtered export of many pages | Recorded once with scope "view" and the number of rows sent, never as a page |
| A JSON export with no file name | The helper sets no attachment header; the response is unchanged |
| A respondent's own copy of a submission | Not recorded; classified as an own copy in the guard's list |
| A plain file download, such as an attachment | Not recorded; classified as a plain download |
| The audit page | Export entries are system actions and are hidden by its default filters; a filter for them is added |
| Searching entries by row count | Not possible in SQL: the context is encrypted. The event is the way to act on a count |
| Retention of change history | The two general-history sets exclude `audit_logs.export`; the dedicated `audit_logs.export_evidence` set supplies finite expiry, subject to holds and a configured runner |

## 📝 Migration & Backward Compatibility

Additive: an event, a helper, a resource kind, a new `events.ts`. With the audit module enabled, the action log attempts one entry per export. The ten routes keep their paths, parameters, file formats and headers. Existing responses are not made dependent on audit availability. The new event is excluded from triggers from first release, and persistent alert subscribers stay queued even with single delivery off; no existing event contract changes. Audit disablement and enqueue failures limit large-export detection, and are documented with the consumer. The optional setting/set declarations and audit-owned expiry handler are additive; only new `audit_logs.export` evidence is affected by the 365-day finite-age default of assumption 8, once the named prerequisites ship. General-history exclusions stay in force.

## 📋 Implementation Plan

1. **Characterize** that a query-engine multi-page export leaves access-log rows for the first page only and nothing else. Commit alone.
2. Add `exportResponse` and `resolveExportRequestContext` with named suite `export-response.test.ts`: both sinks; either failing, with the event still carrying the export's id; both sinks independently started before waiting; stalled database write, event tap and queue enqueue each bounded by the same deadline, including when both stall; assert timeout codes, response returned, and late success or rejection uses the original occurrence id without a retry or duplicate report; a `ReadableStream` body refused before either sink; one, several and all organizations mapped to the organization id and `organizationScope`, and a custom-route context that never falls back to the home `auth.orgId`; the skip-inline emit options with single delivery off; trigger exclusion; no content; trusted auth/scope and parent id mapping; disabled audit module; each scope; no attachment header without a file name.
3. Use it in the factory's two branches. `factory-export-audit.test.ts`, with a small configured batch, for `view` scope with filters and `full` scope, each across several pages, and for a non-export response; assert all full-export aliases use `exportFullRequested`. Add a user allowed two of three organizations who selects all (null organization, `organizationScope: 'several'` with both ids), one selected organization, and an unrestricted user (`'all'`).
4. Add `audit_logs/events.ts`; run the generators.
5. Move each of the ten routes to the helper, one step per module: `entities`; `audit_logs`; `staff`; `forms`, its two exports and the staff PDF; `packages/documents`; `eudr`, the annual report and the statement packet; `agent_orchestrator` in `packages/enterprise`. One unit test per route, asserting its scope and unchanged response, plus the matching table-driven integration case TC-AUD-EXPORT-002 below. Each case observes the actual event in the test queue and the audit entry, rather than only mocking the helper.
6. The guard test with its classified list: exports, the own copy, mandatory C1 subject copies, plain downloads and the factory route, scanning the package, app, create-app template and present official-module roots. Unit tests that an unlisted route found by each trigger fails it under each root, that an absent official-module checkout is skipped rather than failed, and that a listed export without the helper fails it. The audit page's filter and its i18n keys; do not change default action-type filters. Check that the portal class uses the C1 operation and refuses use of the generic helper when the portal route exists. TC-PORTAL-PRIVACY-002 exercises the C1 success and audit failure paths.
7. Integration tests TC-AUD-EXPORT-001 and TC-AUD-EXPORT-002 (enterprise eval export case runs in the enterprise environment); the audit-logs docs page; the dated entry.
8. Add the evidence-expiry setting, set, DI handler and docs after their named prerequisites, including the record-retention owner's shared aggregate writer and `retentionEvidenceSummary.test.ts` in step 7. `exportEvidenceRetention.test.ts`: exact kind and cutoff mapping to DEC-B, helper `scope: 'subject'` entries expiring with the set while C1 `privacy.subject_export` / `privacy.subject_export_request` entries are untouched, the `unmatchedHoldsOptOut: 'forbidden'` declaration, current setting minimum, version-change refusal, dry-run/keyset batches of at most 100, old/recent/foreign-kind and foreign-tenant entries, whole-entry removal of actor/resource/parent/related/context, any subject hold even under engine opt-out, guard failure/release, active replay incomplete then successful retry, declaration-selected `PrivacyRetentionAggregateSummary` only and null-tenant evidence reported outside this set. Add TC-AUD-EXPORT-003. The feature ships with this expiry path and operator scheduling instructions; it never claims a running job from a declaration alone.
9. Archive this Delta into `.ai/specs/capabilities/export-audit.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/lib/crud/{export-response.ts,factory.ts}` and tests | Create / modify |
| `packages/core/src/modules/audit_logs/{events.ts,privacy.ts,di.ts,lib/exportEvidenceRetention.ts}` and audit-page filter component/i18n files | Create / modify |
| The ten export routes in `entities`, `audit_logs`, `staff`, `forms`, `eudr`, `packages/documents` and `packages/enterprise/src/modules/agent_orchestrator/api/eval-cases/export/route.ts` | Modify |
| `packages/core/src/__tests__/export-route-coverage.test.ts` | Create |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUD-EXPORT-00{1,2,3}.spec.ts` | Create |

## 🧪 Integration Coverage

Tests own disposable tenants/organizations, users, API keys, data and generated files; create fixtures through owner APIs and remove all fixture records and test audit entries in `finally`. A test-only subscriber/queue capture records `audit_logs.export.completed` without exposing an inspection endpoint in production. Assert one unique export id with the expected actor, tenant, organization, kind, format, scope and count; at-least-once redelivery may repeat that id, never create a second logical export. Verify event and entry share the id. Assert content type, disposition presence/value and representative response content against each route's existing contract.

| Test | Covers |
|---|---|
| TC-AUD-EXPORT-001 | Factory list full CSV and filtered view export, event capture plus `GET /api/audit_logs/audit-logs/actions`, full aliases, exact counts and user actor. Ordinary list read adds neither. Exercise the audit-page export filter in the browser. An API-key-authenticated export verifies `api_key` actor mapping |
| TC-AUD-EXPORT-002 | Table-driven custom-route cases below, one case for every changed API path; each owns its prerequisites and asserts the real entry and event plus unchanged response headers |
| TC-AUD-EXPORT-003 | Create own export entries through the helper and backdate only owned fixtures; set the tenant age, preview then apply `audit_logs.export_evidence` through the command, and verify old evidence gone, including an old helper entry with `scope: 'subject'` from the forms subject export, and recent/other-tenant evidence kept. A separate C1 fixture, an old `privacy.subject_export` entry written by `exportSubjects`, survives this set unchanged. Use distinct caller actor/reference/export/subject markers; preview writes no summary, and apply's only run evidence uses exactly `PrivacyRetentionAggregateSummary`, the validated set id as resource id and null actor/parent/related fields, with every marker absent from all persisted audit fields and no competing identifying run entry. Enterprise profile creates an own subject hold through the DSR API: apply skips; release then apply expires the old row. Remove holds, settings, fixture rows and summaries in `finally` |

| TC-AUD-EXPORT-002 case | Path | Own fixture and expected scope/count |
|---|---|---|
| Custom entity | `/api/entities/records` with export format | Custom entity and two records; `view` or `full` per request flag; two rows; exercise both filtered and full modes |
| Action logs | `/api/audit_logs/audit-logs/actions/export` | One fixture action under a unique resource filter; `view`; count of returned actions; the export's own entry is added after rendering |
| Timesheet | `/api/staff/timesheets/reports/:id/export` | Staff/report and its rows; `record`; count follows report export rows, not unrelated records; existing timesheet event also observed |
| Submission JSON | `/api/forms/submissions/:submissionId/export` | Form and submission; `record`, one |
| Subject submissions | `/api/forms/subjects/:subjectType/:subjectId/export` | Subject with two submissions; `subject`, two |
| Staff submission PDF | `/api/forms/submissions/:submissionId/pdf` | Staff-authorized form submission; `record`, one; PDF response |
| Document | `GET` and `POST /api/documents/:id/export` | Document with renderer-owned template and valid POST pagination-snapshot fixture; `record`, one; cover DOCX and PDF formats and both methods |
| Annual report | `/api/eudr/reports/annual` with CSV export | Organization, reporting-year records; `view`; count of exported rows |
| Statement packet | `/api/eudr/statements/:id/export` | Statement and required evidence fixtures; `record`, one; JSON and GeoJSON keep their lack of attachment header |
| Approved eval cases | `/api/agent_orchestrator/eval-cases/export` | Enterprise fixture agent and approved cases; `view`; count of cases; JSON keeps its lack of attachment header |
| DSR subject export | `/api/data_erasure/subjects/export` | Enterprise profile, after the DSR engine's Phase 2: own person with records and a tenant-wide administrator; `subject`; count of exported records; null organization with `organizationScope: 'all'`; download header kept |

The respondent public submission PDF and one classified plain download have negative cases: neither produces an entry or event. Both tests drain/capture the queue before and after the request to avoid attributing fixture events to the export, and unregister the capture in teardown. A disabled-audit test app profile verifies a successful export emits neither sink; sink-failure injection remains in unit tests.

The dedicated expiry has no new API path; its command case runs after the settings and retention prerequisites. Null-tenant rows and event copies are outside that test's claim.

Counting across several pages is unit-tested: the batch size cannot be set by a request, so an integration test would need more than a thousand records.

## 📝 Risks & Impact Review

#### Export evidence never expires
- **Scenario**: General-history sets exempt export entries and no dedicated expiry runner is configured, or a hold delays it.
- **Severity**: High
- **Affected area**: actor ids and encrypted export facts
- **Mitigation**: Finite tenant setting, exact-kind set, DEC-C fail-closed holds, age-preserving release and operator scheduling instructions.
- **Residual risk**: A declaration is not a running schedule; null-tenant history and queue copies have separate ownership.

#### An export path is missed
- **Scenario**: A new route builds a file itself.
- **Severity**: High
- **Affected area**: that module's exports
- **Mitigation**: The helper is the way to build an export response. Every API route that sets an attachment header, lies under an `export` path or reads `exportScope` belongs on the classified list. A staff or API key export uses the helper. A portal subject copy uses the strict C1 route contract.
- **Residual risk**: A route that hands out records as a plain JSON body, under no `export` path and without an attachment header, and every export assembled in the browser. A route misclassified as a plain download is caught only in review. Custom routes in a standalone app or an official module that is not checked out are outside the guard.

#### Export evidence is missing
- **Scenario**: The audit module is disabled, a log write fails, or event enqueue fails after a successful export.
- **Severity**: High
- **Affected area**: audit evidence and large-export alerting
- **Mitigation**: Independent sink attempts, structured logging and `reportError`; rule shown unavailable with the audit module off; docs state the best-effort guarantee.
- **Residual risk**: Both sinks may be absent, and a successful entry without an event does not trigger the alert rule. No outbox or recovery guarantee is claimed.

#### The audit page fills with export entries
- **Scenario**: An integration exports a list every minute.
- **Severity**: Low
- **Affected area**: the audit page's readability
- **Mitigation**: The entries have their own resource kind and can be filtered out; the page's default filter is unchanged.
- **Residual risk**: Accepted.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md` for events.

| Rule | Status | Notes |
|---|---|---|
| Event ids: module, singular entity, past tense | Compliant | `audit_logs.export.completed` |
| Additive contract change | Compliant | One event, one helper |
| A catch that records an error also reports it | Compliant | Both sinks |
| Tenant scoping | Compliant | The scope comes from the request |
| Integration coverage | Compliant | Three suites: factory entry/event and audit-filter UI; table-driven entry/event cases for all ten custom routes plus the DSR subject export once it ships; dedicated expiry command and holds; unit tests for sink failures and multi-page counting; classification guard |
| Enterprise scope in the OSS specs directory | Compliant | One enterprise route adopts the OSS helper; nothing enterprise-only is specified |

**Verdict:** design ready, subject to the settings, retention, erasure and scheduling prerequisites. Under program DEC-2, work proposed for OSS requires written upstream maintainer approval naming the carrier before implementation. An independent security fix may proceed on its own named, explicitly approved carrier. The design verdict and ordinary PR review do not grant that approval.

## Changelog

### 2026-11-18 — Follow-up review

- Classify the portal subject copy under its mandatory C1 audit rather than the generic export event.

### 2026-11-18 — Review corrections

- Bound the independent action-log and event attempts by one deadline and preserve occurrence identity on late settlement.

### 2026-11-16
- Split from the security-alerting spec on its reviewer's advice. That review showed the first design could not work: the access log cannot hold a summary row, its rows expire in eight hours, an open PR lets it drop writes under load, the factory has two export branches, and at least one export route bypasses the factory. The record now goes to the action log and the event is emitted independently of it.
- Revised after its own independent review. The requirement is narrowed to exports the server produces: tables exported in the browser never reach a route. The seven routes outside the factory are named, including per-record and per-subject exports, which needed two more scopes. Recording moved into one helper that also builds the response, because a header-based guard could not tell exports from file downloads. The entry gets a named command id and is awaited; its limits on the audit page and in SQL are stated. `audit_logs/events.ts` is a new file. The multi-page case is unit-tested, since a request cannot set the batch size. The sequencing after PR #8472 is dropped: that PR does not touch the export branches.
- Council review (Opus, GPT-5.6 Sol, DeepSeek V4 Flash, Kimi K3.1 Pro), high fixes: g7-10 — the scope `page` does not exist in the factory, whose every export runs to the last page; it is replaced by `view` (the caller's filters, every page) beside `full`, `record` and `subject`, checked against `factory.ts`, and the scenario, unit tests and integration test now cover a filtered export. g7-11 — the inventory is re-run over every route with an attachment header or an `export` path: three more exports (the EUDR statement packet, the staff submission PDF, the enterprise eval-case export) join the helper, the public submission PDF is classified as the respondent's own copy, and the guard checks a classified list instead of route names. g7-09 (consumer side) — the event is emitted persistent with its scope, and its `id` is generated before both sinks, so the alerting spec can use it as the occurrence key.

- Council round two fixes (GPT-6.1 Sol workers): r9-03 — real entry/event integration coverage for all ten custom paths; r9-11 — best-effort requirement and disabled-audit dependency; r9-31 — trigger-excluded export event; g7-34 — trusted request actor/scope and explicit resource/parent ids; F-59 — full scope derived from `exportFullRequested` across every alias.

- Council round two fixes, pass two (GPT-6.1 Sol workers): correct the general-history evidence exemption; add finite `audit_logs.export_evidence` expiry and its R3-2/R3-3/DEC-B/DEC-C handoffs, conservative holds and scheduling gap; make event organization nullability explicit for the alerting consumer; add expiry coverage.
- Council round two fixes, pass three (GPT-6.1 Sol workers): retain the existing finite expiry and null-tenant gap; make whole-entry identity removal and aggregate-only surviving totals explicit, refuse unmatched-hold bypasses and consume the record-retention owner's now-specified evidence-summary path without changing the export event or best-effort response.
- Council round two fixes, pass four alignment (GPT-6.1 Sol workers): select `runEvidence: 'aggregate'` for `audit_logs.export_evidence`, cite the record-retention owner's **Aggregate evidence for expiry runs** and exact `PrivacyRetentionAggregateSummary`, require its shared writer and tests before expiry, and align TC-AUD-EXPORT-003 with identifier-free persisted evidence.

### 2026-11-17
- Added an Overview. The export's organization is the effective filter's single id, otherwise null, with the organization scope recorded in the encrypted context; custom routes resolve it through `resolveExportRequestContext` rather than the home organization.
- The awaited entry write is bounded at five seconds and reported as a sink failure; the body must be fully built, and streams are refused.
- The guard scans the app, template and present official-module roots, and the guarantee is narrowed to this repository. The DSR engine's subject download joins the classified list as an export when it ships.
- Export-evidence expiry names C1's separate `privacy.subject_export` kinds, states that helper `scope: 'subject'` entries expire with this set, and declares `unmatchedHoldsOptOut: 'forbidden'`.
