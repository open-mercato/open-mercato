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
- **MUST call `assertAttachmentScopeInvariant({ tenantId, organizationId })` from
  `lib/access.ts` before persisting any new `Attachment` row.** It throws on a
  partial-null scope and accepts both fully-scoped and fully-global rows. The
  attachments upload route (`api/route.ts`) already guards its creation site.
- **MUST gate every attachment read through `checkAttachmentAccess`** (`lib/access.ts`)
  so tenant scoping and partition visibility are enforced consistently.
- When copying/cloning attachments across records, **carry the source row's scope
  pair as a unit** (both columns together) rather than overriding one column with a
  possibly-null value.
- A module that must store a vector image (a logo, a brand mark) MUST pass
  `allowVectorImage: true` to `attachmentService.createScoped()` rather than
  relaxing `lib/security.ts`. That flag routes SVG through `lib/vector-image.ts`
  (DOMPurify SVG profile on a fresh `jsdom` window plus the reference/CSS
  policy), stores only the sanitised bytes, and records
  `storageMetadata.vectorImage` with the sanitiser, its version, the policy
  version and the SHA-256 of the stored bytes. Files that would lose renderable
  or active content are rejected with a `vector_image_*` code, never stored
  silently altered. See
  `.ai/specs/2026-10-05-attachments-sanitised-vector-images.md`.
- Serve SVG inline **only** when `isTrustedVectorImage(attachment, bytes)` holds
  (record present, known policy version, digest matches the bytes just read),
  with `VECTOR_IMAGE_CONTENT_SECURITY_POLICY` and `X-Content-Type-Options:
  nosniff`. Every other SVG-typed row stays download-only.
- `GET /api/attachments/file/{id}` MUST set a sandboxing `Content-Security-Policy`
  on every response it produces, JSON errors included. In the app, `next.config.ts`
  (and the create-app template) give every response under
  `/api/attachments/file/` the vector CSP and exclude that path from the app CSP
  rule; a config header overrides a route handler header of the same name, and
  only config reaches the dispatcher's own responses. Keep both configs in sync
  (`yarn template:sync`).
- Build attachment preview URLs with `resolveAttachmentThumbnailUrl`
  (`lib/imageUrls.ts`): a sanitised vector row previews through the file route,
  everything else through the image route. Client code reads the vector record
  only through `lib/vector-image-record.ts`, never `lib/vector-image.ts` (which
  loads `jsdom` and `dompurify`).
- Keep every pass in `lib/vector-image.ts` linear: walk the DOM over
  `firstChild`/`nextSibling`, never copy jsdom's live `children`/`childNodes`
  collections, never remove scattered nodes one by one from a wide parent
  (rebuild it), refuse at the first non-inert finding instead of removing more,
  run DOMPurify on a copy (not `IN_PLACE`), and keep the markup, node, element,
  depth, attribute and rendered-element bounds that the `bounded cost` test
  enforces.
- A `<style>` may contain only text: check its children, and inspect exactly the
  concatenation of its direct text children (what browsers apply), never
  `textContent`.
- Trim a reference only as its own syntax does: C0 controls and spaces for an
  `href`, ASCII CSS whitespace for an unquoted `url()`, nothing for a quoted one.
  Never use JavaScript `trim()` on a reference, and refuse a reference-bearing
  attribute that DOMPurify's `trim()` would change.

## Never

- Never make a peer module construct `StorageDriverFactory` or read Attachment /
  AttachmentPartition entities directly as a fallback. Missing service wiring
  must fail closed.
- **Never create a partial-null attachment** (one scope column set, the other null).
- **Never read or expose attachment rows without `checkAttachmentAccess`** — bypassing
  it reintroduces the cross-tenant fail-open class.
- Never accept SVG on the generic `POST /api/attachments` route, and never hand
  vector input to Sharp (`api/image/...` keeps refusing `image/svg+xml`).
- Never write `storageMetadata.vectorImage` from anywhere but the scoped upload
  service's vector path.

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

## Validation Commands

```bash
yarn workspace @open-mercato/core test -- access
yarn workspace @open-mercato/core test -- src/modules/attachments
yarn workspace @open-mercato/core build
```
