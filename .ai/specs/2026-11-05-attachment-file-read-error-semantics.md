# Attachment File Route — Storage Read Error Semantics

**Date:** 2026-11-05
**Status:** Implemented in PR #7044
**Issue:** #6994
**Module:** `attachments` (`packages/core/src/modules/attachments`)

## TLDR

`GET /api/attachments/file/{id}` used to answer every storage read failure with the same silent `404 { error: "File not available" }`. It now tells a missing object apart from a broken read: a missing object is still a 404, any other read failure becomes a 500, both carry a stable `code`, and both are logged and reported to telemetry.

## Problem Statement

`driver.read()` failures (file deleted, unreadable directory, misconfigured driver, unreachable bucket) all fell into one `catch` that returned 404 and logged nothing. In #6994 that hid months of attachment loss on an ephemeral filesystem and sent the investigation toward permissions. Operators could not tell "the file is gone" from "storage is broken", and nothing reached logs or error reporting.

## Proposed Solution

Classify the error thrown by `driver.read()` by its code (`code`, S3-style `Code`, or `name`):

| Storage error | Status | Body | Log level | Telemetry code |
|---|---|---|---|---|
| `ENOENT`, `NoSuchKey`, `NotFound` (object missing) | 404 | `{ "error": "File not available", "code": "STORAGE_FILE_MISSING" }` | `warn` | `attachments.storage_file_missing` |
| Anything else (e.g. `EACCES`, `EISDIR`, `NoSuchBucket`, network errors) | 500 | `{ "error": "File not available", "code": "STORAGE_READ_FAILED" }` | `error` | `attachments.storage_read_failed` |

Logs include the attachment id, partition code, storage path, driver key and error code. The response body never includes the path, driver, or underlying error message.

Unchanged: the 200 response (body, headers, caching), the 400 for a missing id, the 401/403/404 for auth, scope, and unknown-attachment cases, the 500 `Partition misconfigured` response, and the 503 storage-policy response from `2026-10-01-attachment-storage-validation.md`.

## API Contracts

`GET /api/attachments/file/{id}`, error responses only:

- `404`: either `Attachment not found` (unknown id or out of scope, unchanged) or `File not available` + `code: "STORAGE_FILE_MISSING"` (row exists, backing object missing). The `code` field is new and additive.
- `500`: `Partition misconfigured` (unchanged) or `File not available` + `code: "STORAGE_READ_FAILED"` (**new for this route**; previously reported as 404).

The OpenAPI description for 500 now says "Partition misconfigured or storage read failed".

## Migration & Backward Compatibility

- **Contract surface:** API routes (`BACKWARD_COMPATIBILITY.md` category 7). The URL, method, auth, and success response don't change.
- **Intentional correction (404 → 500 for non-missing read failures):** a 404 for a row that exists but whose storage can't be read was wrong. It told clients the resource was gone when the server was failing. This is treated as a bug fix, not a removal, so no deprecation bridge applies: keeping the old 404 would reproduce the defect in #6994.
- **Additive:** the `code` field on both error bodies. Clients that only read `error` or the status code keep working.
- **Client handling:** treat `404 STORAGE_FILE_MISSING` as permanent (the file is gone; offer re-upload or removal). Treat `500 STORAGE_READ_FAILED` as transient/operational (retry later, alert operators). A client that previously treated any 404 as "missing" will now see a 500 for storage outages. The built-in UI only uses the route as a download/preview URL and needs no change.
- **Interaction with the storage-validation spec:** `2026-10-01-attachment-storage-validation.md` says "provider operational errors retain their semantics". That still holds for its new 503 policy error. This spec refines what happens to provider operational errors on this one route: they are now a 500 instead of being hidden behind a 404.
- **Database / events / DI / ACL:** none.
- **Upgrade notes:** no action required. Monitoring can alert on `attachments.storage_read_failed`.

## Testing

- Unit (`api/__tests__/file.route.test.ts`): `ENOENT` → 404 + warn + `storage_file_missing` report; S3 `NoSuchKey` → 404; `EACCES` → 500 + error log + `storage_read_failed` report.
- Integration (`__integration__/TC-ATT-028.spec.ts`): uploads a fixture through the real API with the local driver. It removes the stored file and asserts 404 `STORAGE_FILE_MISSING`. It then puts a directory at the stored path (a deterministic `EISDIR` that doesn't depend on file permissions, so it also fails under a root runner) and asserts 500 `STORAGE_READ_FAILED` with a body that leaks no path or error detail. It restores and deletes fixtures in `finally`.

## Changelog

- 2026-11-05: Created to record the response-contract change shipped in PR #7044 (#6994).
