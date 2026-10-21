# Bound `attachmentIds` of `POST /api/attachments/transfer`

- **Status:** draft — primary path per the [#7692 review](https://github.com/open-mercato/open-mercato/pull/7692#pullrequestreview-5586373032); awaiting the `security` label and a named maintainer waiver
- **Date:** 2026-10-21
- **Type:** OSS core API input bound (resource-exhaustion hardening)
- **Module:** `attachments`
- **Issue:** [#7672](https://github.com/open-mercato/open-mercato/issues/7672) (follow-up from #7590)
- **Depends on:** [#7728](https://github.com/open-mercato/open-mercato/pull/7728) (built-in callers transfer in chunks of at most 100)

## TLDR

`POST /api/attachments/transfer` accepts an `attachmentIds` array of any length, loads every listed row with one `$in` query and rewrites each row's `recordId` and `storageMetadata.assignments` in one flush. This spec caps the array at `ATTACHMENT_TRANSFER_MAX_IDS` (`100`), the same ceiling as the attachment list `pageSize`. A request with more ids answers `400 { error: "Invalid payload" }` and transfers nothing. URL, method, success and error response shapes are unchanged.

The narrowing removes previously accepted input, so it is a STABLE contract change (category 7, API request shape). The primary path ships it under the [Emergency Security Exception](../../BACKWARD_COMPATIBILITY.md#emergency-security-exception). The ordinary deprecation protocol is specified as the alternative in [Alternative: ordinary deprecation](#alternative-ordinary-deprecation) and replaces the primary path if the maintainer declines the waiver.

## Overview

The route lives at `packages/core/src/modules/attachments/api/transfer/route.ts`. Its zod schema is duplicated in `api/openapi.ts` (`transferAttachmentsRequestSchema`) for the generated OpenAPI document. Both declare `attachmentIds: z.array(z.string().uuid()).min(1)` with no maximum.

Callers in the repository:

| Caller | Ids per request | After #7728 |
|--------|-----------------|-------------|
| `catalog` product create (`products/create/page.tsx`) | every media id uploaded to the draft, unbounded (`ProductMediaManager` has no cap) | `transferDraftMedia` → `transferAttachmentsInChunks`, at most 100 per request, incomplete transfer surfaced as a `warning` flash |
| `catalog` variant create (`products/[productId]/variants/create/page.tsx`) | same as product create | same as product create |
| `checkout` link template logo (`LinkTemplateForm.tsx`) | exactly 1 | unchanged |
| Integration tests `TC-ATT-002`, `TC-ATT-013`, `TC-CAT-042` | 1 to 2 | unchanged |

Third-party modules and API clients may call the endpoint with any number of ids. They are the population the compatibility path protects.

## Problem Statement

A caller holding `attachments.manage` can send one request with an arbitrarily large `attachmentIds` array. The cost grows linearly with the array: the JSON body is parsed in full, every id is validated by zod, all ids become bind parameters of a single `SELECT … WHERE id IN (…)`, every matching row is hydrated into the identity map, its `storageMetadata` is rewritten in memory, and one flush writes all of them inside a single request. Past the PostgreSQL bind-parameter ceiling (65 535) the query fails with a `500` after the parse and validation work has already been done. No other attachment id payload is unbounded: list and library `pageSize` are capped at `100`.

The exposure is smaller than an unauthenticated vector because the route requires `requireAuth` plus `attachments.manage`, but any tenant user with that feature can hold a web worker on one request.

## Proposed Solution

1. Use the `ATTACHMENT_TRANSFER_MAX_IDS = 100` constant introduced by #7728 in `packages/core/src/modules/attachments/lib/transferLimits.ts` as the single source of the limit.
2. Add `.max(ATTACHMENT_TRANSFER_MAX_IDS)` to `attachmentIds` in both `transferSchema` (`api/transfer/route.ts`) and `transferAttachmentsRequestSchema` (`api/openapi.ts`). Update the OpenAPI description to state the maximum.
3. Keep the existing failure path: `safeParse` failure answers `400 { error: "Invalid payload" }`. No new error code, no partial processing of the first 100 ids.
4. Document the limit in `apps/docs/docs/api/attachments.mdx`.

No change to the transfer semantics for requests of 1 to 100 ids.

## Architecture

The change is local to the `attachments` route schema. The client helper `transferAttachmentsInChunks` (`attachments/lib/transferClient.ts`, from #7728) already splits by the same constant, so client and server cannot drift. No event, command, subscriber, DI registration or cross-module import is added.

## Data Models

None. No entity, column, index or migration change.

## API Contracts

`POST /api/attachments/transfer`

| Field | Before | After |
|-------|--------|-------|
| `attachmentIds` | `uuid[]`, `min 1` | `uuid[]`, `min 1`, `max 100` |
| `entityId`, `fromRecordId`, `toRecordId` | unchanged | unchanged |
| `200 { ok, updated }` | unchanged | unchanged |
| `400 { error: "Invalid payload" }` | malformed body | malformed body **or more than 100 ids** |
| `401`, `404`, `500` | unchanged | unchanged |

## Internationalization

None. The `400` body is the existing internal `Invalid payload` string. The user-facing message for an incomplete catalog transfer ships with #7728.

## UI/UX

None in this change. #7728 owns the catalog warning flash.

## Edge Cases & Failure Scenarios

| Case | Behavior |
|------|----------|
| Exactly 100 ids | Accepted, transferred as before |
| 101 ids | `400 Invalid payload`, no row changed |
| 101 ids of which some duplicate | Rejected: the limit counts array entries, not distinct ids, matching zod `.max()` |
| Old third-party client sending > 100 | Rejected; must chunk (see Migration) |
| Catalog create with > 100 uploaded media | Two or more requests via `transferAttachmentsInChunks`; a failed chunk leaves those media on the draft and shows a warning (#7728) |

## Rollout and Operations

Ships in the next release after #7728. No feature flag, no environment variable and no tenant action. Operators can find affected clients by searching access logs for `POST /api/attachments/transfer` answered `400` after the upgrade.

## Testing Strategy and Acceptance Criteria

- Unit (`attachments/api/__tests__/transfer.route.test.ts`): 100 ids accepted; 101 ids answer `400` and `em.find` is never called; the OpenAPI schema rejects 101 ids.
- Integration (`TC-ATT-013`): a 101-id request answers `400` and the attachments stay on the source record.
- Consumer coverage already in #7728: `transferClient.test.ts` (101 ids → two requests of 100 and 1, failed chunk reported), `mediaTransfer.test.ts`, `TC-CAT-042`.
- Acceptance: the full validation gate in `.ai/agentic.config.json` passes on the PR head.

## Out of Scope and Follow-up Specifications

- Server-side chunking or async transfer of more than 100 ids.
- A cap on the number of media `ProductMediaManager` lets a user upload to one draft.
- Bounding other unbounded id arrays outside `attachments`.

## Risks & Impact Review

### Third-party client breakage

- **Scenario:** an integration moves 150 attachments in one call after the upgrade and gets `400 Invalid payload`.
- **Severity:** medium. **Affected area:** external API clients and third-party modules calling the endpoint.
- **Mitigation:** the request fails before any read or write, so there is no half-moved state; the fix is mechanical (chunk by 100, or `transferAttachmentsInChunks` in backend pages); detection through access logs (Rollout and Operations).
- **Residual risk:** low. A client that ignores the `400` leaves attachments on the source record, which is visible to the user.

### Built-in caller regression

- **Scenario:** #7692 merges before #7728, so catalog create sends 101 media ids in one request and every image stays on the draft.
- **Severity:** high. **Affected area:** `catalog` product and variant create.
- **Mitigation:** implementation step 1 makes #7728 a hard prerequisite; `TC-CAT-042` and `mediaTransfer.test.ts` cover the chunked path.
- **Residual risk:** none once the merge order holds.

### Qualifying argument for the exception is rejected

- **Scenario:** the maintainer judges that authenticated exhaustion behind `attachments.manage` does not meet "acceptance of the old shape *is* the exploit".
- **Severity:** low (process only). **Affected area:** this PR's compatibility path.
- **Mitigation:** the alternative path below is fully specified and swaps in without touching other sections. Precedent cuts both ways: #3816 capped the unpaginated `GET /api/attachments` at 100 with an `UPGRADE_NOTES.md` entry only.
- **Residual risk:** with the alternative path the unbounded request stays reachable for one minor version.

## Migration & Backward Compatibility

### Classification

| Surface | Change | Classification |
|---------|--------|----------------|
| API request shape (`POST /api/attachments/transfer`, `attachmentIds`) | Maximum length `100`; longer arrays answer `400` | ✗ BREAKING for clients sending more than 100 ids |
| `transferAttachmentsRequestSchema` export (`attachments/api/openapi.ts`) | Gains `.max(100)` | ✗ BREAKING for code validating more than 100 ids against it |
| API URL, method, response schemas | No change | ✓ n/a |
| Database schema, event IDs, ACL features, DI names, CLI commands, generated files | No change | ✓ n/a |

### Primary path: Emergency Security Exception

| Requirement (`BACKWARD_COMPATIBILITY.md`) | How it is satisfied |
|-------------------------------------------|---------------------|
| 1. Qualifying condition argued | The surface removed is acceptance of an unbounded `attachmentIds` array. Accepting it *is* the resource-exhaustion vector: the cost of one request is proportional to the array length. A bridge release that keeps accepting long arrays, even with a warning, keeps the vector reachable for the whole deprecation window |
| 2. Narrowest removal, no retained branch | Only `.max(100)` on one field in the route schema and its OpenAPI twin. No other field is tightened. No flag, environment variable or opt-in keeps long arrays accepted |
| 3. Steps 4 and 5 | `UPGRADE_NOTES.md` `0.9.0 → 0.9.1` entry with client and operator actions; this section |
| 4. Dated entry | `BACKWARD_COMPATIBILITY.md` § Attachment Transfer Id Limit (2026-10-21) |
| 5. Maintainer sign-off | PR #7692 carries the `security` label and a named human maintainer approval acknowledging the waiver |

**What stops working, for whom.** Any client of `POST /api/attachments/transfer` that sends more than 100 ids in one request. First-party UIs are unaffected after #7728. No stored data becomes unusable or suspect: rejected requests change nothing, and earlier successful transfers are untouched.

**Client migration.** Split the ids into chunks of at most 100 and send one request per chunk. Backend pages (monorepo or standalone app) can call `transferAttachmentsInChunks` from `@open-mercato/core/modules/attachments/lib/transferClient`, which uses `apiCall` and reports failed chunks.

**Operator migration.** No data migration. After upgrading, check access logs for `400` responses on `POST /api/attachments/transfer` to find integrations that still send long arrays.

### Alternative: ordinary deprecation

Used only if the maintainer declines the waiver. The primary path's rows 1, 2, 4 and 5 are dropped and replaced by:

1. **Bridge (0.9.x):** keep accepting more than 100 ids. When the array is longer than `ATTACHMENT_TRANSFER_MAX_IDS`, process it as today, log a structured warning through `createLogger` (`attachments.transfer.deprecated_length`, with tenant, organization and id count, no ids), and add a `Deprecation` response header (RFC 9745) plus a `Link` header pointing at the upgrade note.
2. **Deprecation markers:** OpenAPI description of `attachmentIds` states that more than 100 ids are deprecated and rejected from `0.10.0`. The `transferAttachmentsRequestSchema` export gets `@deprecated` JSDoc on the unbounded form.
3. **Removal (0.10.0):** enforce `.max(100)` exactly as in Proposed Solution.
4. `UPGRADE_NOTES.md` gets two entries: the deprecation in `0.9.0 → 0.9.1` and the removal in `0.9.x → 0.10.0`. Tests cover the warning path in the bridge release and the `400` in the removal release.

## Implementation Plan

1. Wait for #7728 to merge (provides `ATTACHMENT_TRANSFER_MAX_IDS` and the batching callers).
2. Rebase #7692 onto `develop`; replace the literal `100` with `ATTACHMENT_TRANSFER_MAX_IDS` in `route.ts` and `openapi.ts`.
3. Rewrite the `UPGRADE_NOTES.md` entry with client and operator actions; point clients at `transferAttachmentsInChunks`.
4. Add the dated `BACKWARD_COMPATIBILITY.md` entry (primary path) or the bridge code and two upgrade entries (alternative path).
5. Update `apps/docs/docs/api/attachments.mdx`, unit tests and `TC-ATT-013`.
6. Run the full validation gate; request the `security` label and the maintainer waiver (primary path).

## Final Compliance Report — 2026-10-21

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/attachments/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule | Status | Notes |
|------|--------|-------|
| Contract change references a spec with Migration & Backward Compatibility | Compliant | This spec |
| Emergency exception requirements 1–5 | Pending | Requirement 5 needs the `security` label and a named maintainer sign-off |
| Tenant and organization scoping | Compliant | Unchanged filters on `tenantId` and `organizationId` |
| Integration coverage for affected API path | Compliant | `TC-ATT-013` extended |

### Verdict

Ready to implement once #7728 is merged and the maintainer confirms the compatibility path.

## Changelog

### 2026-10-21

- Draft: primary path under the Emergency Security Exception, ordinary deprecation as the alternative.
- Added the dated `BACKWARD_COMPATIBILITY.md` entry, rewrote the `UPGRADE_NOTES.md` entry with client and operator actions, listed the spec in `.ai/specs/README.md`. The `BACKWARD_COMPATIBILITY.md` entry is a one-line pointer to this section, because `BACKWARD_COMPATIBILITY.md` counts toward the create-app harness context budgets (`compatibility-context-budget.test.ts`, OMH-057 had 319 bytes of headroom).
