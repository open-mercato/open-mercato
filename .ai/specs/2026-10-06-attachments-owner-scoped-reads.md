# Attachments — owner-scoped reads for published files (pay link logos)

> Status: **Implemented, in review** · Date: 2026-10-06 · Scope: OSS
> Modules: `packages/core/src/modules/attachments/`, `packages/checkout/src/modules/checkout/`
> Related: [`2026-06-09-attachments-scope-invariant.md`](2026-06-09-attachments-scope-invariant.md),
> [`implemented/2026-03-19-checkout-pay-links.md`](implemented/2026-03-19-checkout-pay-links.md),
> [`2026-10-05-attachments-sanitised-vector-images.md`](2026-10-05-attachments-sanitised-vector-images.md) (separate change; see § Merge order)

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
to the partition the logo was uploaded to. The logo is served as the same 640×240 `contain` raster
rendition the old URL requested, produced by the attachments image pipeline.

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

A module cannot fix this alone. It would have to either fabricate an `AuthContext` to call
`readScoped` — which would carry roles and features every downstream check then trusts — or read
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
  rendition?: { width?: number; height?: number; cropType?: 'cover' | 'contain' }
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
   same private helper `readScoped` now uses (`serveOwnedAttachment`). That helper also reads the
   bytes and decides inline versus download exactly as `readScoped` does.
6. With `rendition`, the attachment must be an inline-safe raster image (otherwise 404, before the
   storage driver is touched). The bytes then go through `renderImageRendition`, the raster pipeline
   now shared with `GET /api/attachments/image/{id}`: the per-size thumbnail cache, magic-byte and
   dimension checks, and Sharp with a source pixel limit. A refusal from that pipeline keeps its
   status (400 or 413). Vector input never reaches Sharp.

Every refusal after step 1 is a 404, apart from a rendition pipeline refusal, so the method does not
reveal whether an id exists elsewhere. The method is optional on the interface, so third-party
`AttachmentService` implementations keep compiling.

`lib/imageRendition.ts` is extracted from the image route without changing that route's behaviour.
Its existing tests, including the spoofed-content refusal, pass unmodified.

**Security argument.** The caller's own ownership record is the authorization: the module has
already decided, from rows it owns, that this file is meant to be public — here, a published pay
link whose `logo_attachment_id` its editor set. The owner check makes the method useless as a
general file reader. It returns only an attachment whose `entity_id` and `record_id` are the ones
the caller names, in the caller's tenant, organization and partition. A leaked or guessed id of
another record's, module's, tenant's or partition's attachment yields 404. The JSDoc requires the
attachment id and owner to come from the module's own records, never from request input.

**No source-scanning test.** "No attachments route calls it" is an architectural rule. It is
recorded under Never in the attachments `AGENTS.md` and enforced in review. An earlier test grepped
`api/` for the method name. It was removed: it checked source text, not behaviour; it would fail on a
comment and miss an indirect call; and it guarded nothing the method does not already enforce. Any
caller, route or not, must still supply the owner, tenant, organization and partition the method
checks.

### 2. `GET /api/checkout/pay/{slug}/logo` (checkout)

Public (`requireAuth: false`). The link is resolved and gated as follows:

- a public request is rate limited with `checkoutPublicViewRateLimitConfig` (fail-open, namespace
  `checkout-public-logo`) and served only for a published link (`isCheckoutLinkPublic`). A
  password-protected link also requires a valid access cookie (`verifyCheckoutAccessToken`);
- a preview (`?preview=true`) requires the checkout preview context (`requirePreviewContext`:
  signed in, with `checkout.view`). It looks the link up by slug **only within the caller's own
  tenant and organization** (`auth.tenantId`, `auth.orgId`), so a preview of another tenant's or
  organization's link is a 404. Previews skip the publish and password gates, as a preview must show
  a draft.

It then reads the link's own `logoAttachmentId` — never an id from the request — with
`readScopedForOwner`:
- pinned to the link's tenant and organization;
- pinned to the partition `CHECKOUT_LOGO_ATTACHMENT_PARTITION` (`privateAttachments`, where the
  generic upload route puts checkout entities' files);
- with the link as owner, or, when that is a 404 and the link has a `templateId`, the template.

The read asks for the `{ width: 640, height: 240, cropType: 'contain' }` rendition, so the served
size is bounded exactly as the old image-route URL bounded it.

**Raster only.** The route serves the result only when it is inline and its content type is a raster
image (`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/bmp`). An SVG or
anything else is a 404, even if the attachments service would serve it inline. This keeps the route
safe whatever the attachments module later serves inline: this path carries the app-wide CSP, not
the sandbox the attachment file route uses.

**Refusals.** Every refusal, including a 4xx from the rendition pipeline, is a 404 with
`{ error: 'checkout.payPage.errors.logoNotFound' }`: the module's translation key, as the checkout
pay APIs return keys rather than English. A 5xx is passed on.

**Headers.** The rendition's `Content-Type` and inline `Content-Disposition`,
`X-Content-Type-Options: nosniff`, `Content-Length`, and `Cache-Control`:
- `public, max-age=300` for a published link: the logo is shown on a public page, and five minutes
  bounds how long a replaced logo or an unpublished link stays in shared caches;
- `private, max-age=300` for a password-protected link: only the unlocked visitor's browser may
  keep it;
- `private, no-store` for a preview.

### 3. Pay payload

`GET /api/checkout/pay/{slug}` keeps its shape. Only the value of `logoPreviewUrl` changes, and only
when `logoAttachmentId` is set: it becomes `buildCheckoutPublicLogoUrl(slug, { preview })`
(`/api/checkout/pay/{slug}/logo`, with `?preview=true` on a preview). Without an attachment it is
still `logoUrl ?? null`. The admin APIs that use `serializeTemplateOrLink` are unchanged: signed-in
staff keep the resized image-route preview.

## API Contracts

| Contract | Change | Class |
|---|---|---|
| `AttachmentService.readScopedForOwner?(input)` | new optional method | ADDITIVE |
| `ReadScopedAttachmentForOwnerInput` (exported from `@open-mercato/core/modules/attachments`), including `rendition` | new type | ADDITIVE |
| `lib/imageRendition.ts` (`renderImageRendition`, `ImageRenditionSize`) | new module, extracted from the image route | ADDITIVE |
| `GET /api/attachments/image/{id}` | uses the extracted pipeline | unchanged behaviour |
| `GET /api/checkout/pay/{slug}/logo` | new public route | ADDITIVE |
| `GET /api/checkout/pay/{slug}` → `logoPreviewUrl` | value changes from the image route to the logo route when a logo attachment is set | public pay-page API value change (Ask First in `packages/checkout/AGENTS.md`; requested in the PR) |
| `buildCheckoutPublicLogoUrl`, `CHECKOUT_LOGO_ATTACHMENT_PARTITION` (checkout lib) | new helpers | ADDITIVE |
| `checkout.payPage.errors.logoNotFound` | new translation key in all five locales | ADDITIVE |

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| `readScopedForOwner` used as a general reader | Medium | data exposure | owner, tenant, organization and partition all required and enforced; UUID check; blank inputs refused before querying; JSDoc and `AGENTS.md` require ids from the caller's own records | A caller passing request input straight through — reviewable at the call site |
| Logo route publishes a non-image or active file | Medium | data exposure / XSS | only the link's own `logoAttachmentId`; owner pinned to the link or its template; raster content types only; resized by Sharp | — |
| Logo of a locked, unpublished or foreign link leaks | Medium | privacy | public requests: publish and password gates. Previews: checkout preview context, and the link lookup restricted to the caller's tenant and organization | — |
| Oversized logo served publicly | Low | bandwidth | 640×240 rendition; per-size thumbnail cache | — |
| Extra request per pay page view | Low | load | separate rate-limit namespace, fail-open; 5-minute cache for published links | — |
| Logo uploaded to a non-default partition | Low | UX | the editor never sets a partition; such a logo is a 404 rather than served from an unexpected partition | Re-upload through the editor |

## Migration & Backward Compatibility

The service and type changes are additive and optional (BACKWARD_COMPATIBILITY.md § 2).
`readScoped` was refactored to share its owner, partition and serving checks with
`readScopedForOwner`, and the image route to use the extracted rendition pipeline. The behaviour of
both is unchanged, and their existing tests pass unmodified. The pay payload keeps every field.
`logoPreviewUrl` is a URL clients already render as-is, and the new URL works for exactly the
visitors the old one failed for. `UPGRADE_NOTES.md` records the change.

## Merge order with the sanitised vector images change

[`2026-10-05-attachments-sanitised-vector-images.md`](2026-10-05-attachments-sanitised-vector-images.md)
is a separate branch touching the same files. The intended order is **that change first**, then this
branch rebased onto it. The conflicts are textual and resolve as follows:

- `lib/attachment-service.ts` — keep this branch's `serveOwnedAttachment` helper and put the vector
  serving lines (`isTrustedVectorImage`, the inline content type, `contentSecurityPolicy`) into its
  non-rendition path. `readScoped` and `readScopedForOwner` then serve trusted vector rows the same
  way. The rendition path keeps requiring an inline-safe raster (`canRenderInlineAttachment`), so an
  SVG never reaches Sharp.
- `lib/__tests__/attachment-service.test.ts` — keep both appended `describe` blocks, the
  `readBuffer` harness option, and this branch's `imageRendition` mock.
- `.ai/specs/README.md`, `UPGRADE_NOTES.md`, `apps/docs/docs/api/attachments.mdx`,
  `packages/core/src/modules/attachments/AGENTS.md` — keep both entries; they cover different
  sections.

After both merge, `readScopedForOwner` without `rendition` serves trusted vector images inline. The
logo route is unaffected: it always asks for a raster rendition and refuses any non-raster content
type, which a test pins.

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
  - with `rendition`:
    - serves the image pipeline's output inline with the attachment's content type;
    - refuses a non-raster before touching storage;
    - passes on the pipeline's refusal of a damaged image.
- `core: api/__tests__/image.route.anonymous.test.ts` — with the real `checkAttachmentAccess`, an
  anonymous request for a tenant-scoped image is a 401 on a private and on a public partition and
  never reaches Sharp: the reason the old `logoPreviewUrl` could not work.
- `core: api/__tests__/image.route.test.ts` — unchanged, passing on the extracted pipeline.
- `checkout: api/pay/[slug]/__tests__/route.test.ts`:
  - the public payload's `logoPreviewUrl` is the logo route, with `?preview=true` on a preview;
  - it falls back to `logoUrl` when no attachment is set.
- `checkout: api/pay/[slug]/logo/__tests__/route.test.ts`:
  - serving:
    - serves the link-owned logo to an anonymous visitor, asking for the 640×240 rendition with
      the pinned tenant, organization and partition;
    - looks a public request's link up by slug only;
    - falls back to the template owner, and is a 404 when neither owns it;
    - does not try a template when there is none, and ignores ids in the query string;
    - serves an unlocked password-protected link with a private cache;
  - refusals:
    - a 404 for an unpublished link, a link without a logo, an unknown slug, a locked
      password-protected link, a download-only result, and a service without owner-scoped reads;
    - never serves an SVG (with or without parameters) or an HTML document, even when the
      attachments service would serve it inline;
    - answers refusals, including a pipeline refusal of a damaged image, with the translation key;
  - previews:
    - passes the rate limiter's response through, and requires (and is refused without) the
      preview context for previews;
    - in a preview, looks the link up only within the caller's tenant and organization;
    - is a 404 for a link stored in another tenant, or another organization of the same tenant,
      without reading attachments. The mock models the database: the link is found by any filter
      that does not exclude its tenant and organization.
- `checkout: __integration__/TC-CHKT-044-public-logo.spec.ts` — over HTTP, without a session:
  - an uploaded link logo loads from the payload's `logoPreviewUrl` as a PNG, while the old image
    route is still a 401;
  - a template logo inherited by a link loads;
  - a link pointing at another link's logo is a 404;
  - an unpublished link's logo is a 404.

Regression proofs:

- **Against unmodified `develop`:** the payload test fails (2 failed, 1 passed;
  `Received: "/api/attachments/image/33333333-…?width=640&height=240&cropType=contain"`), and the
  logo route suite cannot load (`Cannot find module '../route'`).
- **Against this branch before the review fixes:** 8 of 22 logo route tests failed, and the core
  service suite could not load (`Cannot find module '../imageRendition'`). The failures were the
  rendition request, the three non-raster refusals, the translation key, the tenant- and
  organization-scoped preview lookup, and both cross-tenant/organization preview refusals, which
  returned the other tenant's draft, password-protected logo.

## Final Compliance Report

- Tenant scoping is enforced at the database boundary and re-checked. No attachment row is read
  without either `checkAttachmentAccess` or the owner/tenant/organization/partition match. Previews
  of the logo route are scoped to the caller's tenant and organization.
- No direct cross-module ORM access: checkout reaches attachments only through the
  `attachmentService` DI contract and its exported types.
- The new user-facing error is a translation key present in all five checkout locales.
- No migration, no generated-file change, no new dependency.

## Changelog

- 2026-10-06 — Review fixes:
  - logo route previews scoped to the caller's tenant and organization;
  - raster-only logo serving;
  - the 640×240 rendition through the image pipeline, extracted into `lib/imageRendition.ts` and
    reachable through `readScopedForOwner`'s new `rendition`;
  - cache headers justified;
  - translation key for refusals;
  - the source-scanning test removed with its reason;
  - merge order with the vector images change documented.
- 2026-10-06 — Spec written and implemented: `readScopedForOwner`, the public pay link logo route,
  and the pay payload's `logoPreviewUrl` pointing at it.
