# Attachments Module — Agent Guidelines

The `attachments` module owns file uploads, storage drivers, partitions, OCR, and
the `attachments` table. Every attachment row carries a `tenant_id` /
`organization_id` scope pair that governs cross-tenant access.

## Scope & Access Policy

`attachments.tenant_id` and `attachments.organization_id` are **nullable** at the
DB level, but only two scope shapes are valid:

| Shape | `tenant_id` | `organization_id` | Meaning | Who can read it |
|-------|-------------|-------------------|---------|-----------------|
| **Scoped** | set | set | Belongs to one tenant + org | Same-scope principals + superadmin |
| **Global** | null | null | Legacy "global attachment" | Any authenticated principal (and unauthenticated only on a `is_public` partition) |
| **Partial-null** ❌ | set / null | null / set | **Invalid — never create** | Nobody (fail-closed) except superadmin |

The "both-or-neither" rule is the legitimate-unscoped use case referenced by
[#2109](https://github.com/open-mercato/open-mercato/issues/2109): a fully-global
(both-null) attachment is intentionally supported by `isSameScope`, so the columns
cannot simply be made `NOT NULL` without breaking that semantic or backfilling a
sentinel tenant onto legacy rows.

### Why partial-null is dangerous

`isSameScope` (`lib/access.ts`) deliberately **fails closed** on partial-null rows
(#2107): a row with one scope column set and the other null matches no principal's
auth and is unreadable by everyone except a superadmin. Such a row is therefore
*dead data* — it can only ever leak through a future code path that reads or
exports attachments **without** going through `checkAttachmentAccess` (a new export
endpoint, webhook delivery, OCR worker, or migration backfill). That is exactly the
fail-open class the access fix closed at read time; the creation guard closes it at
write time.

## Always

- Cross-module consumers MUST resolve the public `attachmentService` DI contract
  and import its type from `@open-mercato/core/modules/attachments`. Keep
  attachment entities, partitions, storage drivers, quota accounting, file
  security, and `checkAttachmentAccess` behind that boundary.
- Cross-module multipart uploads MUST use `attachmentService.readUploadForm()` so
  the raw request stream is bounded before `FormData` decoding, including when
  `Content-Length` is missing or the request is chunked.
- Cross-module permanent deletion MUST use `attachmentService.releaseScoped()`
  with the exact owner, assignment, partition, and tenant/organization scope. In
  an ambient transaction pass `{ flush: false }`, commit the returned database
  removal first, and invoke the returned provider cleanup only after commit;
  never delete provider bytes before a transaction can still roll back.
- To drop **every** reference an owner record holds (as primary owner or as an
  assignment), for example when the owner is deleted, use
  `attachmentService.releaseOwnedScoped({ owner, tenantId, organizationId })`. Contract:
  a row owned by `owner` with no other assignment is deleted (its bytes only once no
  other row shares the stored object); a row owned by `owner` with other assignments is
  re-pointed to the first remaining assignment in stored order; a row owned by
  something else only loses `owner`'s assignment (array and legacy single-object
  `storage_metadata.assignments` shapes); a re-pointed or detached row's `storage_metadata`
  is written back normalized (`assignments` and `tags` in their canonical shape). Only rows
  of the given tenant and organization change. It commits its own transaction (it refuses an ambient one), locks the owner's
  rows together with every row sharing their stored objects in one id-ordered statement
  (so only a concurrent single-object `releaseScoped` is guaranteed not to deadlock with it;
  other writers can still abort it with 40P01 or a serialization failure, which it throws
  with nothing committed, so callers MUST report it and retry later), and is idempotent (a
  retry returns zeros). It handles all of one owner's rows in that
  single transaction (plus one storage-reference read per deleted row), so it is meant for
  owners with a bounded number of rows (an inbound email holds at most its ledger's parts);
  do not use it for an owner whose row count is unbounded. Storage drivers are resolved
  before the transaction from a non-locking read of the owner's partitions; only a partition
  first seen under the lock is resolved while the rows are locked. A row created for or assigned to
  `owner` by a transaction that commits concurrently with the lock statement may be missed, so
  callers MUST fence new writes for the owner (commit a change that makes every later write for it
  fail) before releasing. Provider byte cleanup runs after commit and
  is best-effort: failures are logged and reported as `attachments.release_cleanup_failed`,
  never thrown. It emits no CRUD events and does not update the query index (same as
  `releaseScoped`).
- `createScoped` takes `textExtraction`: `'partition'` (default; the partition's OCR
  settings decide and the text lands in `Attachment.content`), `'return'` (the pure-JS
  extractor always runs, LLM OCR is never queued, `Attachment.content` stays empty and
  the text reaches the caller only through `persistLink`'s third argument and the
  result's `content`; use it when the owner stores the text itself, e.g. encrypted), or
  `'none'` (nothing is extracted). Any other value is a caller bug and throws before quota or
  storage work.
- A protected target declared with `listInLibrary: false` keeps rows whose **exact
  primary** `entity_id` equals its `targetEntity` (no wildcards; assignments do not
  count) out of `GET /api/attachments/library` (records, count, tag facets). The
  exclusion is persisted on partitions (`library_excluded_entities`, union-merged, never
  removed) and applied globally across all partitions, so it survives disabling the
  declaring module. Record-scoped `GET /api/attachments` is unaffected. Like
  `access_resolver_requirements`, a malformed `library_excluded_entities` on a partition with
  declared protection fails uploads to it closed (the protection check parses it strictly);
  only the library listing reads it leniently.
- Rows MAY share a stored object (`partition_code` + `storage_path`). Any other
  code deleting a row with its bytes MUST use `removeAttachmentRecord`
  (`lib/storageReferences.ts`, outside a transaction) and delete the bytes only
  when it returns `releaseStorage: true`.
- **MUST call `assertAttachmentScopeInvariant({ tenantId, organizationId })` from
  `lib/access.ts` before persisting any new `Attachment` row.** It throws on a
  partial-null scope and accepts both fully-scoped and fully-global rows. The
  attachments upload route (`api/route.ts`) already guards its creation site.
- **MUST gate every attachment read through `checkAttachmentAccess`** (`lib/access.ts`)
  so tenant scoping and partition visibility are enforced consistently.
- Code that loads attachment rows directly (outside the attachment routes and
  `attachmentService`), for example an AI tool or a link into another record,
  **MUST filter them with `evaluateAttachmentRowAccess`** (exported from the module
  index) for the acting principal, so owner access policies apply. When moving rows to
  another owner, pass a `destination`, load them with `ATTACHMENT_ROW_WRITE_LOCK`
  (`lib/access-rows`) and evaluate and write in one transaction; build key-authenticated
  principals with `buildAttachmentAccessAuth` so the key, not its creator, is evaluated.
- A module that reads attachment rows by caller-supplied id outside the helper
  **MUST be listed in `KNOWN_DIRECT_ATTACHMENT_READER_MODULES`** (`lib/access-readers.ts`)
  until it is fixed; it then exports `enforcesOwnerAccessOnDirectReads = true` from its
  `data/attachment-access.ts`. A CLI, worker or MCP process that cannot load the generated bootstrap registrations treats the access registry as invalid. Owner modules whose files must never reach such a reader
  check `listUnguardedAttachmentReaders()` before storing them.
- When copying/cloning attachments across records, **carry the source row's scope
  pair as a unit** (both columns together) rather than overriding one column with a
  possibly-null value.

## Never

- Never make a peer module construct `StorageDriverFactory` or read Attachment /
  AttachmentPartition entities directly as a fallback. Missing service wiring
  must fail closed.
- **Never create a partial-null attachment** (one scope column set, the other null).
- **Never read or expose attachment rows without `checkAttachmentAccess`** — bypassing
  it reintroduces the cross-tenant fail-open class.

## Known cross-module creation paths

These paths create `Attachment` rows from other modules and must preserve the
both-or-neither invariant (audited for #2109):

- `packages/core/src/modules/attachments/api/route.ts` — primary upload; scope comes
  from authenticated request context (both set). **Guarded.**
- `packages/core/src/modules/sync_excel/lib/upload-storage.ts` — both scopes are
  required inputs (type-enforced). Safe.
- `packages/core/src/modules/catalog/seed/examples.ts` — both scopes required on
  `SeedScope`. Safe.
- `packages/core/src/modules/catalog/commands/variants.ts` — clones variant media to
  the product; inherits the source/variant scope pair (`?? null` only collapses to
  the global both-null shape).
- `packages/core/src/modules/messages/lib/attachments.ts`
  (`copyAttachmentsForForwardMessages`) — copies forwarded message attachments and
  accepts a nullable `targetOrganizationId` with a non-null `tenantId`. This is the
  one path that can construct a partial-null row; copy the **source attachment's**
  scope pair when wiring new callers, and apply the creation guard if this path is
  refactored.
- `packages/sync-akeneo/src/modules/sync_akeneo/lib/catalog-importer.ts` (`upsertAsset`)
  — product media go through `attachmentScopedUploadService` with the importer's scope
  (both set) and the public `productsMedia` partition, so it cannot use
  `attachmentService.createScoped` (private partitions only). Safe.

## Validation Commands

```bash
yarn workspace @open-mercato/core test -- access
yarn workspace @open-mercato/core build
```
