# Pre-Implementation Analysis: DAM — Digital Asset Management Module (Media)

- Target: `.ai/specs/2026-10-06-dam-module.md` (PR #6967, branch `spec/dam-module`), including the review fixes from commit `0f453d5f6`
- Brief: `.ai/specs/briefs/2026-10-06-dam-module.md`
- Analysis date: 2026-10-08
- Verified against: `develop` @ `ce49b2a40`

## Executive Summary

The spec is implementation-ready.

**Design.** The riskiest decisions are grounded in the code:
- bytes live in an isolated owned-blob store that no existing attachments reader can see;
- effective grants are stored per principal, with roles resolved live, so no new `auth` event is needed;
- one shared visibility predicate serves every read;
- every outside change is additive.

**Fixes already applied (commit `0f453d5f6`).** The first review found eight issues, now fixed in the spec:
- an ACL-semantics contradiction;
- a duplicated "Media" nav group;
- TIFF/BMP and PDF preview assumptions;
- a quota lock held during the byte write;
- full-tree hierarchy rebuilds;
- implicit encryption;
- missing move undo;
- numbering.

**Remaining.** What's left is minor: download filenames, the cost of recursive stats, and a few items that need deciding before or during P1. **Recommendation: ready to implement**, with the items under "Before Implementation" settled in P1 step 1.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Auto-discovery conventions | None. The new `dam` module uses standard files, including `encryption.ts`, `subscribers/` and `workers/`. The `dam` id is free; the only hit is an unrelated lucide icon key. | — | — |
| 2 | Type definitions & interfaces | `AttachmentService` (`attachments/lib/attachment-service.ts:163-176`) gains `createOwnedBlob`, `readOwnedBlob`, `previewOwnedBlob`, `inspectOwnedBlob`, `releaseOwnedBlob` and `getOwnedBlobUsage`. The spec makes them optional, following the `readUploadForm?` / `releaseScoped?` precedent. | OK (additive) | Keep them `?`-optional in the implementation. A unit test asserts that a stub implementing only the old members still type-checks. |
| 3 | Function signatures | No existing signature changes. `checkAttachmentAccess`, `createScoped` and `releaseScoped` are untouched. | — | — |
| 4 | Import paths | DAM imports only `@open-mercato/core/modules/attachments` (index.ts) types. `renderPdfFirstPage` is internal to `attachments`. | — | Do not export `renderPdfFirstPage` through the `./*` wildcard as a documented API. |
| 5 | Event IDs | New: `dam.folder.*`, `dam.asset.*`, `dam.folder_grant.changed`, `dam.document_link.*`. Nothing renamed. No `auth` event added (A4). | OK (additive) | Freeze names at P1 merge; payloads carry ids only. |
| 6 | Widget spot IDs | None removed. DAM declares none yet. | — | Optional: reserve asset-detail spots in `extension-points.ts` (nice-to-have). |
| 7 | API routes | New `/api/dam/*` only. Generic `/api/attachments/file|image|library` are unchanged; DAM blob ids return 404 there because owned blobs are in another table. | — | The P1 integration test asserting this is already in the spec. |
| 8 | Database schema | New `dam_*` tables and a new `attachment_owned_blobs` table (with `status` and `lease_token`). No existing column changes. | OK (additive) | Migrations and snapshots per module (`attachments` and `dam`), with no unrelated generator output. |
| 9 | DI service names | New `damAccessService` etc. P5 adds `documentsAccessService` in `documents`. Reuses the existing `authPrincipalService`, a key verified in `auth/di.ts:43`. | OK (additive) | — |
| 10 | ACL feature IDs | New `dam.view`, `dam.manage`, `dam.root_folders.create`, `dam.admin`. Their meaning is now stable across phases (A16, P2 step 3 fixed). | OK | — |
| 11 | Notification type IDs | None. | — | — |
| 12 | CLI commands | New `dam grant`, `dam rebuild-permissions`, `dam purge-trash`, `dam purge-all`. | OK (additive) | — |
| 13 | Generated files | Registry growth only. | — | — |

### Missing BC Section

Present ("Migration & Backward Compatibility" under Risks). It covers:
- additive surfaces;
- rollback (`dam purge-all`);
- the P2 visibility change (A15) with an UPGRADE_NOTES entry.

No gaps.

## Spec Completeness

### Missing Sections

None. The spec has TLDR, Overview, Problem, Solution with alternatives, Architecture, Data Model, API Contracts, UI/UX, Edge Cases, Risks, Migration & BC, Phasing, Implementation Plan, Integration Test Coverage, Final Compliance Report and Changelog.

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Attachments seam → `readOwnedBlob` | Returns `buffer \| stream`, so the shape is undecided. The existing `readScoped` returns a whole buffer. | Decide in P1 step 1. Recommend a stream for `/download` (25 MB × concurrent downloads) and a buffer for internal use. |
| API → `GET /assets/{id}/download` | `attachments` stores a sanitized ASCII `file_name` (`sanitizeUploadedFileName`, `security.ts:87`), but DAM names allow Unicode. The download would get the sanitized name. | DAM builds `Content-Disposition` itself from `dam_assets.name`, with RFC 6266/5987 `filename*=UTF-8''…` plus an ASCII fallback. Add an integration test with a Polish-diacritics name. |
| API → `GET /folders/{id}/stats` | Recursive "visible only" counts combine the subtree (`ancestor_ids @>`) with the per-folder EXISTS visibility predicate. Cost on large trees is not specified. | One aggregate query joining `dam_folder_effective_grants` once, not EXISTS per folder. Add a performance note and a test on about 1 000 folders. |
| API → `POST /assets/{id}/file` (replace) | During replace, the new blob is `reserved` while the old one is still `stored`, so the quota needs 2× the file size. | State that a replace near the quota limit returns the quota error, and add an edge-case row. |
| Upload validation | `createOwnedBlob` runs "the same security validation as `createScoped`". That path only blocks active content (`scoped-upload-service.ts:125-126`), and `detectAttachmentMimeType` does not know TIFF. | Note that the DAM allowlist (`lib/fileTypes.ts`) is the authoritative type gate and that owned-blob validation is a second, deny-only layer. This avoids anyone "fixing" a TIFF rejection in attachments later. |
| Storage location | Owned blobs use a "default driver" resolved by `StorageDriverFactory`. The factory (`attachments/lib/drivers/driverFactory.ts:30`) currently resolves drivers per partition and has no `resolveDefault()`. | The spec already says "add if missing". Define "default" precisely: the local driver, or the driver configured for the private default partition `privateAttachments`. Recommend the latter, so S3 deployments keep DAM bytes in S3. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| Module id: plural, snake_case | Module `dam` | Already flagged in the spec's compliance report as an acronym exception like `auth`. Get an explicit maintainer ack on the PR. |
| `.env.example` + create-app template sync | `OM_ATTACHMENT_OWNED_BLOB_QUOTA_MB` (P1), `OM_DAM_TRASH_RETENTION_DAYS` (P3) | Already planned. Run `yarn template:sync:fix` in the same PR. |
| i18n locale set | `i18n/{en,pl,de,es,ko}.json` | Confirm the set matches the app's configured locales at implementation time; add or remove files to match. |

No other violations. Verified:
- zod validators;
- `findWithDecryption` plus `encryption.ts`;
- tenant/org scoping on every table;
- wildcard-aware `dam.admin` via `rbacService`;
- `enforceCommandOptimisticLockWithGuards`;
- `CrudForm` / `DataTable`;
- dialog shortcuts;
- `pageSize ≤ 100`;
- `reportError` on cleanup failures;
- idempotent workers;
- scheduler guarded by `hasRegistration('schedulerService')` (pattern: `payment_gateways/setup.ts:17-47`).

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Effective-permission logic bug leaks a restricted folder | Confidential sales material visible to the wrong users | Already in the spec: one `visibleFolderScope` predicate, a randomized reference-resolver test suite, nightly reconcile, and 404-not-403. Add a review gate: any new DAM read route must use `visibleFolderScope`, and a unit test enumerates `api/` routes to enforce it. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| P2 rollout hides P1 folders (A15) | Users lose sight of content after upgrade | UPGRADE_NOTES plus `dam grant --folder all-roots`. Consider making P1 → P2 a single release if P1 is not deployed to real tenants first. |
| Owned-blob seam duplicates part of the scoped upload path | Two code paths to maintain in `attachments` | Already in the spec: shared internal functions and shared fixtures. |
| Recursive stats cost | Slow folder pane on large trees | See the incomplete-section fix (single aggregate query). |
| PDF preview worker load during P4 bulk upload | Queue backlog; previews appear late | Worker concurrency 1–2, which is CPU-bound per `queue/AGENTS.md`. The UI already falls back to an icon. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Unicode filename lost on download | Downloaded file has an `_`-mangled name | Build `filename*` from the DAM name (see above). |
| Thumbnail cache on local disk in multi-instance deployments | Preview re-renders per instance | Existing attachments behaviour; acceptable. |
| Description not searchable (encrypted) | User expectation | Documented limitation. |
| TIFF/BMP without preview in P1 | UX only | Documented; icon fallback. |

## Gap Analysis

### Critical Gaps (Block Implementation)

None.

### Important Gaps (Should Address)

- **`readOwnedBlob` return shape**: decide stream vs buffer.
- **Download filename**: RFC 5987 `filename*` from `dam_assets.name`.
- **Default storage driver**: define it as the `privateAttachments` partition's driver.
- **Recursive stats query**: specify the single-aggregate approach.

### Nice-to-Have Gaps

- Replace-near-quota edge-case row.
- A note that the DAM allowlist is the authoritative type gate.
- Reserved injection spot IDs for future consumers (asset detail, folder header).
- Download audit events (`dam.asset.downloaded`), if the partner needs usage tracking of sales materials.

## Remediation Plan

### Before Implementation (Must Do)

1. Decide `readOwnedBlob` shape and the default driver definition. Record both as assumptions A19/A20 in the spec.

### During Implementation (Add to Spec)

1. Specify `Content-Disposition` handling with Unicode names, plus an integration test.
2. Specify the stats aggregate query, plus a performance test.
3. Add the replace-near-quota edge case.
4. Add the route-enumeration unit test enforcing `visibleFolderScope` on every read route.

### Post-Implementation (Follow Up)

1. Consider promoting `renderPdfFirstPage` to also serve the generic attachments thumbnail route. It would be a separate spec, because it changes existing behaviour.
2. TIFF/BMP previews by widening `imageSafety`. That is a separate change to the shared image route.
3. Shared tree helper in `shared`, which the brief declares out of scope.

## Recommendation

**Ready to implement.** Settle the two "Before Implementation" decisions in P1 step 1. The remaining items are small spec additions that can land with the P1 implementation PR.
