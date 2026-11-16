# Exports leave a record and an event

> **Program:** an OSS seam for package G2 of [`2026-11-15-gdpr-ready-deployments-program.md`](2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), split from [`enterprise/2026-11-16-security-event-alerting.md`](enterprise/2026-11-16-security-event-alerting.md) after its review.
> **Verified at** `main` @ `08dada9624` by reading code; nothing was run. Of the export routes that bypass the CRUD factory, one was read; the others were found by search and are confirmed in the first step.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-15-gdpr-ready-deployments-program.md

## 📝 TLDR

Any list in the product can be exported in full — up to a thousand pages — by adding two query parameters. Afterwards nothing says it happened. The access log gets rows for the records on the first page only, marked as an ordinary list read, and those rows are deleted after eight hours. No event is emitted, so nothing can react. **Proposed (future):** every export the server produces writes one durable audit entry — who, which kind of record, which format, how many rows — and emits one event with the same facts. The seven routes that build an export without the shared factory use the same helper.

**Not in this spec:** exports assembled in the browser from rows a list already fetched, which never reach an export route and cannot be told from reading the list; alerting on exports (the enterprise spec); limiting or approving exports; outbound synchronisation runs.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | Where the record goes | The action log, as an entry with no undo | The access log requires a record id on every row and keeps ordinary rows for eight hours; PR #8472 will also drop access-log writes under load. An export is an action by a user, and the action log is the durable place for those. |
| 2 | Does the per-record access logging change | No | It is a different question — which records were read — and another PR is rewriting it. |
| 3 | What counts as an export | A server response whose purpose is to hand the caller a file of records: a list, one record, or one person's records | A one-page CSV is still data leaving. The count lets a consumer decide what is large. |
| 4 | What the entry and event carry | Tenant, organization, actor, resource kind, format, scope, row count, and a generated id. No filters, no content | Filters can contain search text about a person. |
| 5 | Edition | OSS | It corrects a gap in OSS audit; the consumer is optional. |

## 📝 Problem Statement

- **Exports are built into every CRUD list.** `makeCrudRoute` accepts `format=csv|json|xml|markdown` and `exportScope=full`, in batches of 1000 by default and at least 100, up to a thousand pages (`packages/shared/src/lib/crud/factory.ts:302-306, 324-328, 1699-1708`). There are two export branches (`:2055`, `:2303`).
- **The only trace is partial and short-lived.** `logCrudAccess` runs before the loop that fetches the remaining pages, so it sees the first page; it writes one access-log row per record, typed `read:list` (`factory.ts:933-1007, 2042, 2066-2090`). Ordinary access-log rows live eight hours.
- **The access log cannot hold a summary.** `access_logs.resource_id` is required (`audit_logs/data/entities.ts:128-129`).
- **Seven routes export without the factory**: custom-entity records (`entities/api/records.ts:94-123`); the audit log's own actions export (`audit_logs/api/audit-logs/actions/export/route.ts:257`); the timesheet report (`staff/api/timesheets/reports/[id]/export/route.ts:253`), which already emits an event of its own; one submission and one subject's submissions in forms, as JSON files (`forms/api/submissions/[submissionId]/export/route.ts:74`; `forms/api/subjects/[subjectType]/[subjectId]/export/route.ts:101`); a document as DOCX or PDF (`packages/documents/…/api/[id]/export/route.ts:432, 470`); and the EUDR annual report as CSV (`eudr/api/reports/annual/route.ts:412`).
- **Some exports never reach the server as exports.** The data table serialises rows in the browser (`packages/ui/src/backend/DataTable.tsx:974-993`), as do the inventory and CRM task tables.
- **An action-log entry needs a command id** (`audit_logs/data/validators.ts:18`), needs no undo token, and stores its resource kind in clear and indexed. An entry not written by a user's command is typed as a system action, which the audit page's default filters hide. Its context is encrypted, so the count and format cannot be filtered in SQL.
- **`audit_logs` has no `events.ts`**; adding one is a new auto-discovered file.
- **The export batch size cannot be set by a request**: it is the route's own setting or at least a thousand rows (`factory.ts:303-305, 324-328`).
- **About twenty routes set an attachment header**, half of them file downloads that are not exports, with content types computed at run time.

## 📝 Proposed Solution

One helper in the shared package, `exportResponse`, builds the file response and records the export. A route gives it the body, the file name and type, and the facts: the scope, the actor, the kind of record, the format, the export's scope — `page`, `full`, `record` or `subject` — and the number of rows. It:

1. writes an action-log entry under the command id `audit_logs.export.record`, with resource kind `audit_logs.export`, the exported kind as its parent resource kind, and the format, scope and count in its context — and waits for it;
2. emits `audit_logs.export.completed`, persistent, with the same facts and the entry's id;
3. returns the response.

A failure of either is reported and does not fail the export.

The factory uses it in both of its export branches, once per response, after the last page. Each of the seven routes uses it in place of building its own response. The timesheet route keeps its own event as well.

A test lists the files that may set an attachment header without the helper — the plain file downloads — and fails when a route named `export` or reading `exportScope` does not use it.

| Alternative | Why rejected |
|---|---|
| A summary row in the access log | See assumption 1. |
| Emit from the access-log service | It may drop writes under load. |
| An event only | Nothing durable would remain for an investigation. |
| A helper that only records, called beside each route's own response code | Nothing ties the call to the response; a route could send the file and forget the call. |
| Detect exports by the attachment header | Half the routes that set it are not exports, and types are computed at run time. |

## 📝 Delta

### Capability: export-audit

#### ADDED Requirement: Exports are recorded
The system SHALL write one durable audit entry and emit one event for every export the server produces, carrying the actor, the kind of record, the format, the scope and the number of rows, and nothing of the content.

##### Scenario: Full export
- WHEN a user exports a list in full
- THEN one entry records the number of rows sent, and one event carries the same count

##### Scenario: One page
- WHEN a user exports the current page as CSV
- THEN one entry records that page's row count with scope "page"

##### Scenario: An ordinary list read
- WHEN a list is fetched as JSON for the page
- THEN no export entry is written

##### Scenario: A route outside the factory
- WHEN custom-entity records, a document, or one person's form submissions are exported
- THEN an entry and an event are produced in the same way

##### Scenario: Recording fails
- WHEN the entry cannot be written
- THEN the export still succeeds and the failure is reported

Frozen by: `packages/shared/src/lib/crud/__tests__/export-access-logging.characterization.test.ts`

## 📝 Architecture

- **`packages/shared/src/lib/crud/export-response.ts`**: the helper. It resolves the action-log service and the event bus softly from the container.
- **`packages/shared/src/lib/crud/factory.ts`**: both export branches.
- **`audit_logs/events.ts`**: new; declares the event. Generators are re-run.
- **The seven routes**: use the helper.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Helper → action log and event | `actionLogService` and the bus by DI key | Audit module disabled: neither; the export is unaffected |
| Consumers | Subscribe to the event; the enterprise alerting spec is the first | Nobody listens |

## 📝 Data Models

None. One new `resource_kind` value in the action log.

## 📝 API Contracts

- **Event** `audit_logs.export.completed` — `{ id, tenantId, organizationId?, actorKind: 'user' | 'api_key', actorUserId?, apiKeyId?, resourceKind, format, scope: 'page' | 'full' | 'record' | 'subject', rowCount, occurredAt }`. Additive; frozen once released.
- **`exportResponse(container, input)`** from `@open-mercato/shared/lib/crud/export-response`. Additive.
- No route changes.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| The export fails part-way | Nothing is recorded; only a completed response is an export |
| An export by an API key | `actorKind` is `api_key` and the actor is the key |
| A client that pages by hand through JSON, or a table exported in the browser | Not an export to the server; stated as a limit |
| The entry cannot be written | Reported; the response is unaffected |
| A document or a single record | Recorded with scope "record" and a count of one |
| The audit page | Export entries are system actions and are hidden by its default filters; a filter for them is added |
| Searching entries by row count | Not possible in SQL: the context is encrypted. The event is the way to act on a count |
| Retention of change history | An export entry is kept as long as any other entry of the action log; the change-history retention spec decides, and may treat these as evidence |

## 📝 Migration & Backward Compatibility

Additive: an event, a helper, a resource kind, a new `events.ts`. The action log gains an entry per export. The seven routes keep their paths, parameters and file formats.

## 📋 Implementation Plan

1. **Characterize** that a multi-page export leaves access-log rows for the first page only and nothing else. Commit alone.
2. Add `exportResponse` with unit tests: both sinks; either failing; the entry awaited before the response; no content in the payload; each scope.
3. Use it in the factory's two branches. Unit tests, with a small configured batch, for page and full scope across several pages and for a non-export response.
4. Add `audit_logs/events.ts`; run the generators.
5. Move each of the seven routes to the helper, one step per module. One unit test per route.
6. The guard test with its list of plain file downloads. The audit page's filter.
7. Integration test TC-AUD-EXPORT-001; the audit-logs docs page; the dated entry.
8. Archive this Delta into `.ai/specs/capabilities/export-audit.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/shared/src/lib/crud/{export-response.ts,factory.ts}` and tests | Create / modify |
| `packages/core/src/modules/audit_logs/events.ts` | Create |
| The seven export routes in `entities`, `audit_logs`, `staff`, `forms`, `eudr` and `packages/documents` | Modify |
| `packages/core/src/__tests__/export-route-coverage.test.ts` | Create |
| `packages/core/src/modules/audit_logs/__integration__/TC-AUD-EXPORT-001.spec.ts` | Create |

## 🧪 Integration Coverage

| Test | Covers |
|---|---|
| TC-AUD-EXPORT-001 | A few records are created through the API and exported in full as CSV. `GET /api/audit_logs/audit-logs/actions` filtered to the export kind returns one new entry, with the user as actor. An ordinary list request adds none. The records are removed |

Counting across several pages is unit-tested: the batch size cannot be set by a request, so an integration test would need more than a thousand records.

## 📝 Risks & Impact Review

#### An export path is missed
- **Scenario**: A new route builds a file itself.
- **Severity**: High
- **Affected area**: that module's exports
- **Mitigation**: The helper is the way to build an export response; the guard test fails for a route named `export` or reading `exportScope` that does not use it.
- **Residual risk**: A route that exports under another name, and every export assembled in the browser.

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
| Integration coverage | Compliant | One test; routes outside the factory are unit-tested |

**Verdict:** approved for implementation.

## Changelog

### 2026-11-16
- Split from the security-alerting spec on its reviewer's advice. That review showed the first design could not work: the access log cannot hold a summary row, its rows expire in eight hours, an open PR lets it drop writes under load, the factory has two export branches, and at least one export route bypasses the factory. The record now goes to the action log and the event is emitted independently of it.
- Revised after its own independent review. The requirement is narrowed to exports the server produces: tables exported in the browser never reach a route. The seven routes outside the factory are named, including per-record and per-subject exports, which needed two more scopes. Recording moved into one helper that also builds the response, because a header-based guard could not tell exports from file downloads. The entry gets a named command id and is awaited; its limits on the audit page and in SQL are stated. `audit_logs/events.ts` is a new file. The multi-page case is unit-tested, since a request cannot set the batch size. The sequencing after PR #8472 is dropped: that PR does not touch the export branches.
