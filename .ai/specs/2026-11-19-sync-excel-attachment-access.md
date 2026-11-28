# Sync Excel Upload Attachment Access

## 📝 TLDR

Adopt the existing [Attachment Access Resolver](2026-10-01-attachment-access-resolvers.md) extension for the `sync_excel` module's import-upload attachments. A caller who can browse generic attachments but lacks `sync_excel.view` could previously read, derive, or otherwise access a restricted spreadsheet-import upload through generic attachment routes even though the native import preview endpoint (`sync_excel.view`-gated) would deny them. `sync_excel` declares a resolver and backfills existing `privateAttachments` partition rows the same way Documents did for #6726.

Issue: [#8763](https://github.com/open-mercato/open-mercato/issues/8763).

## 📝 Overview and Problem Statement

`createSyncExcelUploadAttachment` (`sync_excel/lib/upload-storage.ts`) stores every import upload as an `Attachment` with `entityId: 'sync_excel:upload'`, `recordId: uploadId`, in the shared `privateAttachments` partition. The native preview endpoint (`sync_excel/api/preview/route.ts`) requires `sync_excel.view` and re-loads the scoped `SyncExcelUpload` row before returning its contents.

`sync_excel` declared no `data/attachment-access.ts`, so `evaluateAttachmentAccess` (`@open-mercato/core/modules/attachments`) found no resolver and no durable partition requirement for `sync_excel:upload` targets and fell back to the baseline tenant/organization scope check. A same-organization user with only generic attachment features (for example `attachments.view`) could therefore read the stored spreadsheet, its derived bytes, or its content through the generic attachment file/image routes and any direct reader (AI tools, search) that already enforces owner policy for adopted modules — even without `sync_excel.view`.

This is the same class of gap #6726/#6829 closed for Documents, and the same host mechanism #7989 is extending to direct readers. `sync_excel` is simply a second, unprotected owner.

## 📝 Proposed Solution

Declare `sync_excel/data/attachment-access.ts` exporting:

- `attachmentAccessResolvers`: one resolver (`sync_excel.upload-attachments`, `targetPartition: 'privateAttachments'`, `targetEntity: 'sync_excel:upload'`) that denies unless the caller holds `sync_excel.view` (wildcard-aware, via `authorizeFeatures`) **and** the referenced `SyncExcelUpload` row still exists in the attachment's own tenant/organization scope. Missing, deleted, or wrong-scope uploads deny with a generic `sync_excel_upload_not_found` reason (404), matching the Documents resolver's "don't confirm existence" behavior.
- `protectedAttachmentTargets`: one durable requirement for the same resolver/partition/entity, so the registry backfills new `privateAttachments` partitions automatically (`ensureDefaultPartitions`) and `createSyncExcelUploadAttachment` calls `ensureAttachmentPartitionProtection` before storing a new upload, mirroring `createAttachmentFromBuffer`.

A new additive attachments-module migration backfills `access_resolver_requirements` on existing `privateAttachments`-coded partitions that already hold `sync_excel:upload` attachments, exactly like `Migration20261001120000_attachments.ts` did for `documents:document`. No schema change: the `access_resolver_requirements` column already exists.

### Non-goals

- No change to unrelated owners sharing `privateAttachments` (Documents, or any other future adopter) — the selector is scoped to `targetEntity: 'sync_excel:upload'`.
- No new authorization infrastructure; this is adoption of an existing, already-shipped extension point.
- No change to public partitions.

## 📝 Architecture

Enforcement is unchanged: every host read path (`evaluateAttachmentAccess` and its callers — byte/image routes, generic metadata/list, search visibility, and any direct reader already wired through the row-level helper) consults the registry built from every module's `data/attachment-access.ts`. Declaring the resolver is therefore sufficient for every existing enforcement point; no route-level code changes beyond the upload-time durable sync call.

## 📝 Data Model

`attachment_partitions.access_resolver_requirements` (existing nullable `jsonb`) gains, for any partition already holding a `sync_excel:upload` attachment, `{"resolverId":"sync_excel.upload-attachments","targetEntity":"sync_excel:upload"}`, unioned with existing entries. No new columns or tables.

## 📝 API Contracts

No URL, method, request, or successful response shape changes. Only the **authorization outcome** for `sync_excel:upload` attachments narrows: a caller without `sync_excel.view`, or whose referenced upload row is missing/deleted/out of scope, now receives the same denial the generic access runner already returns for other protected owners (`401`/`403`/`404`/`504` per `evaluateAttachmentAccess`), instead of a baseline-scoped success.

## 📝 Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| A legitimate `sync_excel.view` holder loses access to their own upload | Medium | sync_excel import UX | Resolver grants on `sync_excel.view` + live scoped row, matching the preview endpoint's own gate exactly | Low — same gate as the already-shipped preview endpoint |
| Existing partitions never backfilled (new installs only) | Medium | Historical uploads stay exposed after upgrade | Additive migration backfills `privateAttachments` partitions with existing `sync_excel:upload` rows, run before serving new binaries (operator action in UPGRADE_NOTES) | Low, same operational step as #6726 |
| Resolver denies a request before confirming identity (login/signup) | Low | n/a | Partition/entity selector only matches `sync_excel:upload`; no change to unauthenticated flows | None |
| Unrelated `privateAttachments` owners (e.g. Documents) accidentally restricted | Low | Cross-module regression | Selector matching is `targetEntity`-scoped; covered by `access-registry`/`access-runner` unit tests plus new sync_excel resolver tests | Low |

## 📝 Migration & Backward Compatibility

This is an **intentional security narrowing**: a caller who could previously read a `sync_excel:upload` attachment through generic attachment routes with only baseline tenant/organization scope (no `sync_excel.view`) is now denied. Preserving that path would preserve the disclosure, so this ships under the Emergency Security Exception in `BACKWARD_COMPATIBILITY.md` (steps 1–3 waived; dated entry added there) rather than the ordinary deprecation protocol — mirroring `#6726`/#6829's precedent exactly.

**Client action:** none for any client that already holds `sync_excel.view` for its uploads (the preview endpoint required it already). A client relying on reading a `sync_excel:upload` attachment through generic attachment routes without `sync_excel.view` loses that access; it was unintended.

**Operator action:** run the additive attachments migration (`Migration20261119120000_attachments.ts`) before serving the new binaries, then `yarn generate` and rebuild modules so the registry picks up the new `sync_excel` declaration. The migration backfills the durable requirement for existing partitions that already hold `sync_excel:upload` attachments; it needs no enabled `sync_excel` module. It preserves unrelated owners and requirements in `privateAttachments` and fails closed on malformed existing policy data (unchanged shared behavior from #6726).

**Rollback:** keep the additive schema and roll forward. Dropping the backfilled requirement is not a supported security rollback; block the generic attachment routes at the deployment boundary instead if an emergency binary rollback is required.

**Maintainer sign-off:** PENDING. This PR carries the `security` label; it needs a named human maintainer's acknowledgment of the steps 1–3 waiver before merge, per `BACKWARD_COMPATIBILITY.md` § Emergency Security Exception.

## 📝 Final Compliance Report

- Contract surfaces touched: database (additive jsonb data backfill only, no column/shape change), module convention file (new, additive `data/attachment-access.ts`). No API route URL, event ID, DI name, ACL feature ID, or generated-file shape changed.
- Tests: new unit tests for the resolver (`sync_excel/__tests__/attachment-access.test.ts`) and the upload-time durable sync call (`sync_excel/lib/__tests__/upload-storage.test.ts`); full `packages/core` test suite green.
- Outstanding: named maintainer acknowledgment of the Emergency Security Exception waiver (see Migration & Backward Compatibility).

## 📝 Changelog

- 2026-11-19: Initial spec, implementing #8763.
