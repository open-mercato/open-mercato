# Attachments — owner-scoped reads for published files (pay link logos)

> Status: **Implemented, in review** · Date: 2026-10-06 · Scope: OSS
> Modules: `packages/core/src/modules/attachments/`, `packages/checkout/src/modules/checkout/`
> Related: [`2026-06-09-attachments-scope-invariant.md`](2026-06-09-attachments-scope-invariant.md),
> [`implemented/2026-03-19-checkout-pay-links.md`](implemented/2026-03-19-checkout-pay-links.md)

## TLDR

A logo uploaded to a checkout pay link never renders on the published pay page for a visitor who is
not signed in. The public pay payload points the page's `<img>` at `/api/attachments/image/{id}`,
and `checkAttachmentAccess` refuses every anonymous read of a tenant-scoped attachment (401) —
on a private partition and on a public one alike.

This change adds a sanctioned server-side read for exactly this case,
`attachmentService.readScopedForOwner()`, and uses it from a new public route,
`GET /api/checkout/pay/{slug}/logo`, which the pay payload's `logoPreviewUrl` now points to. The
read takes no principal: the module's own record (the pay link that names the logo) is the
authorization, and the read is pinned to that record as owner, to its tenant and organization, and
to the partition the logo was uploaded to.

## Problem Statement

Reproduced on `develop` @ `32b05ab84`:

| Step | Code | Result |
|---|---|---|
| Admin uploads a logo in the link editor | `LogoUploadField` → `POST /api/attachments` with `entityId: checkout:checkout_link`, no partition | row in `privateAttachments`, `tenant_id`/`organization_id` set |
| Visitor opens `/pay/{slug}` | `GET /api/checkout/pay/{slug}` → `serializeTemplateOrLink` | `logoPreviewUrl: /api/attachments/image/{id}?width=640&height=240&cropType=contain` |
| The page renders `<img src={logoPreviewUrl}>` | `GET /api/attachments/image/{id}` with no session | `checkAttachmentAccess` → 401 (`lib/access.ts`: a private partition requires auth; on a public partition `!auth && isTenantScoped` also returns 401) |

So the uploaded logo is only ever visible to signed-in staff (the editor preview and `?preview=true`).
A link created from a template inherits the template's `logoAttachmentId`
(`PROPAGATED_TEMPLATE_FIELD_KEYS`), so the logo row can be owned by the template rather than the link.

A module cannot fix this alone without either fabricating an `AuthContext` to call `readScoped` —
which would carry roles and features every downstream check then trusts — or reading
`Attachment` rows and storage drivers directly, which the attachments `AGENTS.md` forbids.

## Proposed Solution

### 1. `attachmentService.readScopedForOwner` (core)

```ts
export type ReadScopedAttachmentForOwnerInput = {
  attachmentId: string
  tenantId: string
  organizationId: string
  expectedOwner: AttachmentOwner          // entityId + recordId, required
  expectedAssignment?: AttachmentAssignment
  expectedPartitionCode: string           // required
  forceDownload?: boolean
}

interface AttachmentService {
  // …
  readScopedForOwner?(input: ReadScopedAttachmentForOwnerInput): Promise<ReadScopedAttachmentResult>
}
```

Behaviour, in order:

1. A blank `tenantId`, `organizationId`, `expectedPartitionCode`, `expectedOwner.entityId` or
   `expectedOwner.recordId` is a 500 (`[internal]` message) before any query, so a caller bug can
   never widen the lookup (for example to the global both-null shape).
2. An `attachmentId` that is not a UUID (`z.string().uuid()`) is a 404 before any query.
3. The row is looked up by `{ id, tenantId, organizationId }` at the database boundary, and the
   returned row's scope pair is re-checked (defence in depth against a regressed filter).
4. The partition must be global or owned by exactly that tenant and organization.
5. Partition code, owner (`entityId` + `recordId`) and, when given, assignment are enforced by the
   same private helper `readScoped` now uses (`serveOwnedAttachment`), which also reads the bytes
   and decides inline versus download exactly as `readScoped` does.

Every refusal after step 1 is a 404, so the method does not reveal whether an id exists elsewhere.
The method is optional on the interface, so third-party `AttachmentService` implementations keep
compiling. No attachments HTTP route calls it; a test walks `api/` to keep it that way, as
`module-decoupling.test.ts` does for module boundaries.

**Security argument.** The caller's own ownership record is the authorization: the module has
already decided, from rows it owns, that this file is meant to be public — here, a published pay
link whose `logo_attachment_id` its editor set. The owner check makes the method useless as a
general file reader: it returns only an attachment whose `entity_id` and `record_id` are the ones
the caller names, in the caller's tenant, organization and partition, so a leaked or guessed id of
another record's, module's, tenant's or partition's attachment yields 404. The JSDoc requires the
attachment id and owner to come from the module's own records, never from request input.

### 2. `GET /api/checkout/pay/{slug}/logo` (checkout)

Public (`requireAuth: false`). It gates the link exactly as `GET /api/checkout/pay/{slug}` does:

- `?preview=true` requires the preview context (`requirePreviewContext`); otherwise the request is
  rate limited with `checkoutPublicViewRateLimitConfig` (fail-open, namespace
  `checkout-public-logo`), and the link must be published (`isCheckoutLinkPublic`);
- a password-protected link must carry a valid access cookie (`verifyCheckoutAccessToken`), as the
  pay page itself requires before returning any content.

It then reads the link's own `logoAttachmentId` — never an id from the request — with
`readScopedForOwner`, pinned to the link's tenant and organization, to the partition
`CHECKOUT_LOGO_ATTACHMENT_PARTITION` (`privateAttachments`, where the generic upload route puts
checkout entities' files), and to the link as owner; when that is a 404 and the link has a
`templateId`, to the template as owner. Only a result the attachments service serves inline (a
raster image) is returned; anything it would serve as a download is a 404, so the route cannot be
used to publish arbitrary files. Every refusal is a 404 (`Logo not found`).

Response headers: the attachment's `Content-Type` and inline `Content-Disposition`,
`X-Content-Type-Options: nosniff`, `Content-Length`, and `Cache-Control` of `public, max-age=300`
for an open link, `private, max-age=300` for a password-protected one and `private, no-store` for a
preview. The app-wide `Content-Security-Policy` from `next.config.ts` applies to this path, which is
harmless for an image response.

### 3. Pay payload

`GET /api/checkout/pay/{slug}` keeps its shape; only the value of `logoPreviewUrl` changes, and only
when `logoAttachmentId` is set: it becomes `buildCheckoutPublicLogoUrl(slug, { preview })`
(`/api/checkout/pay/{slug}/logo`, with `?preview=true` on a preview). Without an attachment it is
still `logoUrl ?? null`. The admin APIs that use `serializeTemplateOrLink` are unchanged: signed-in
staff keep the resized image-route preview.

## API Contracts

| Contract | Change | Class |
|---|---|---|
| `AttachmentService.readScopedForOwner?(input)` | new optional method | ADDITIVE |
| `ReadScopedAttachmentForOwnerInput` (exported from `@open-mercato/core/modules/attachments`) | new type | ADDITIVE |
| `GET /api/checkout/pay/{slug}/logo` | new public route | ADDITIVE |
| `GET /api/checkout/pay/{slug}` → `logoPreviewUrl` | value changes from the image route to the logo route when a logo attachment is set | public pay-page API value change (Ask First in `packages/checkout/AGENTS.md`; requested in the PR) |
| `buildCheckoutPublicLogoUrl`, `CHECKOUT_LOGO_ATTACHMENT_PARTITION` (checkout lib) | new helpers | ADDITIVE |

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| `readScopedForOwner` used as a general reader | Medium | data exposure | owner, tenant, organization and partition all required and enforced; UUID check; blank inputs refused before querying; no attachments route calls it (test-enforced); JSDoc requires ids from the caller's own records | A caller passing request input straight through — reviewable at the call site |
| Logo route publishes a non-image file | Medium | data exposure | only the link's own `logoAttachmentId`; only inline-safe results; owner pinned to the link or its template | — |
| Logo of a locked or unpublished link leaks | Low | privacy | same publish, preview and password gates as the pay payload | — |
| Extra request per pay page view | Low | load | separate rate-limit namespace, fail-open like the pay payload; 5-minute cache for open links | — |
| Logo uploaded to a non-default partition | Low | UX | the editor never sets a partition; such a logo is a 404 rather than served from an unexpected partition | Re-upload through the editor |

## Migration & Backward Compatibility

The service and type changes are additive and optional (BACKWARD_COMPATIBILITY.md § 2).
`readScoped` was refactored to share its owner, partition and serving checks with
`readScopedForOwner`; its behaviour is unchanged (its existing tests pass unmodified). The pay
payload keeps every field; `logoPreviewUrl` is a URL clients already render as-is, and the new URL
works for exactly the visitors the old one failed for. `UPGRADE_NOTES.md` records the change.

## Testing Strategy

- `core: lib/__tests__/attachment-service.test.ts` (`readScopedForOwner`):
  - reads by owner with the lookup pinned to `{ id, tenantId, organizationId }`, as a download for a
    non-image and inline for an image;
  - refuses a different owner entity, owner record, tenant, organization, partition, and an
    assignment the row does not carry (404, storage never touched);
  - refuses a foreign row even if the scoped filter regresses, and a foreign-tenant partition;
  - refuses a non-UUID, an empty and an injected id before querying (404);
  - refuses a blank tenant, organization, partition or owner record with an `[internal]` 500 before
    querying;
  - is called from no file under `api/`.
- `core: api/__tests__/image.route.anonymous.test.ts` — with the real `checkAttachmentAccess`, an
  anonymous request for a tenant-scoped image is a 401 on a private and on a public partition and
  never reaches Sharp: the reason the old `logoPreviewUrl` could not work.
- `checkout: api/pay/[slug]/__tests__/route.test.ts`:
  - the public payload's `logoPreviewUrl` is the logo route, with `?preview=true` on a preview;
  - it falls back to `logoUrl` when no attachment is set.
- `checkout: api/pay/[slug]/logo/__tests__/route.test.ts`:
  - serves the link-owned logo to an anonymous visitor through the link owner with the pinned
    tenant, organization and partition;
  - falls back to the template owner, and is a 404 when neither owns it;
  - does not try a template when there is none, and ignores ids in the query string;
  - is a 404 for an unpublished link, a link without a logo, an unknown slug, a locked
    password-protected link, a download-only result, and a service without owner-scoped reads;
  - serves an unlocked password-protected link with a private cache;
  - passes the rate limiter's response through, and requires (and is refused without) the preview
    context for previews.
- `checkout: __integration__/TC-CHKT-044-public-logo.spec.ts` — over HTTP, without a session:
  - an uploaded link logo loads from the payload's `logoPreviewUrl`, while the old image route is
    still a 401;
  - a template logo inherited by a link loads;
  - a link pointing at another link's logo is a 404;
  - an unpublished link's logo is a 404.

Regression proof: against unmodified `develop`, the payload test fails (2 failed, 1 passed;
`Received: "/api/attachments/image/33333333-…?width=640&height=240&cropType=contain"`) and the
logo route suite cannot load (`Cannot find module '../route'`).

## Final Compliance Report

- Tenant scoping is enforced at the database boundary and re-checked; no attachment row is read
  without either `checkAttachmentAccess` or the owner/tenant/organization/partition match.
- No direct cross-module ORM access: checkout reaches attachments only through the
  `attachmentService` DI contract and its exported types.
- No migration, no generated-file change, no new dependency.

## Changelog

- 2026-10-06 — Spec written and implemented: `readScopedForOwner`, the public pay link logo route,
  and the pay payload's `logoPreviewUrl` pointing at it.
