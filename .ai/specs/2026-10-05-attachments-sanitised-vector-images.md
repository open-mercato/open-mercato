# Attachments — opt-in sanitised vector images for module-owned uploads

> Status: **Implemented, in review** · Date: 2026-10-05 · Scope: OSS
> Module: `packages/core/src/modules/attachments/`
> Related: [`2026-06-09-attachments-scope-invariant.md`](2026-06-09-attachments-scope-invariant.md)

## TLDR

The attachments module rejects every SVG upload as active content. That is the right default for the
generic `POST /api/attachments` route, but it leaves a module that needs a vector asset — a company
logo, a brand mark on a printable document — with no way to store one.

This change adds one **optional, default-off** field, `allowVectorImage`, to
`CreateScopedAttachmentInput` (the public `attachmentService.createScoped()` contract) and to the
internal `ScopedAttachmentUploadInput`. When a module opts in and the file is an SVG, the server
runs it through DOMPurify (SVG profile) on a `jsdom` DOM plus a small reference/CSS policy, stores
**only the sanitised bytes**, and records on the row that it went through this path. Files that are
not well-formed, are over the size/complexity bound, or would lose renderable or active content to
sanitisation are **rejected with an explicit error code** rather than stored silently broken.

It also adds an optional server-side method, `readScopedForOwner`, so a module that publishes its
own files to anonymous visitors (a public logo) can read them by owner, tenant, organization and
partition without fabricating an `AuthContext` (§ 6).

Serving changes only for rows carrying that record *and* whose stored bytes still hash to the
recorded digest: they are returned as `image/svg+xml` with `inline` disposition under a sandboxing
CSP. Every other SVG-typed row, every existing caller, the generic upload route and the image
(thumbnail) route behave exactly as before.

## Overview

| Surface | Before | After |
|---|---|---|
| `POST /api/attachments` (generic route) | SVG → 400 `activeContentBlocked` | unchanged |
| `attachmentService.createScoped()` without the flag | SVG → 400 | unchanged |
| `attachmentService.createScoped({ allowVectorImage: true })` | SVG → 400 | SVG sanitised and stored, or rejected with a `vector_image_*` code |
| `attachmentService.readScoped()` on a sanitised vector row | `application/octet-stream`, `attachment` | `image/svg+xml`, `inline` (unless `forceDownload`), plus a `contentSecurityPolicy` hint |
| `GET /api/attachments/file/{id}` on a sanitised vector row | `application/octet-stream`, `attachment` | `image/svg+xml`, `inline` (unless `?download=1`), vector CSP |
| `attachmentService.readScopedForOwner()` | — (did not exist) | owner/tenant/org/partition-pinned read with no principal, same result shape |
| `GET /api/attachments/image/{id}` | SVG → 400 | unchanged — Sharp never rasterises vector input |
| Any other SVG-typed row (legacy, copied, hash mismatch) | download | unchanged — download |

## Problem Statement

`lib/security.ts` classifies `image/svg+xml`, the `.svg` extension and an `<svg` sniff as active
content (`ACTIVE_CONTENT_MIME_TYPES`, `ACTIVE_CONTENT_EXTENSIONS`, `detectMimeTypeFromBuffer`).
Both upload paths refuse it:

- `api/route.ts` (`POST /api/attachments`) — `isActiveContentAttachment(...)` → 400.
- `lib/scoped-upload-service.ts` (`ScopedAttachmentUploadService.upload`, behind
  `attachmentService.createScoped`) — `isActiveContentAttachment(...)` → `active_content` 400.

The refusal exists because an SVG is an XML document that a browser will execute when it is opened
directly: `<script>`, `on*` handlers, `javascript:` links, `<foreignObject>` HTML, and external
references (`href`, CSS `url()`/`@import`) that leak the viewer's IP or pull in remote content.

A module that owns a record with a logo field has three bad options today: rasterise on the client
(loses the vector), store the SVG outside the attachments module (loses scoping, quota and the
storage-driver abstraction), or ask users for PNG only. None of these is acceptable for a shared
platform, and the module cannot safely relax the check itself because the security helpers and the
storage pipeline are deliberately behind the `attachmentService` boundary.

## Proposed Solution

### 1. Opt-in input flag

```ts
export type CreateScopedAttachmentInput = AttachmentOwner & {
  // … existing fields …
  /**
   * Accept an SVG by sanitising it server-side instead of rejecting it as
   * active content. Default false.
   */
  allowVectorImage?: boolean
}
```

`DefaultAttachmentService.createScoped` forwards it to `ScopedAttachmentUploadInput.allowVectorImage`.
The name follows the existing boolean options on these inputs (`requirePrivatePartition`,
`forceDownload`): a verb plus the thing it governs.

### 2. Upload path (`ScopedAttachmentUploadService.upload`)

Order of checks — nothing that runs today is removed or reordered:

1. Sanitise file name; reject dangerous executable extensions (unchanged).
2. Reject `buffer.length > maxBytes` (unchanged).
3. Detect MIME type (unchanged).
4. If the file is active content:
   - when `allowVectorImage` is **not** true → `active_content` 400 (unchanged);
   - when it is true but the file is **not a vector-image candidate** → `active_content` 400.
     A candidate has the `.svg` extension, or no extension at all with an `image/svg+xml` declared
     or sniffed type. An `.html`, `.xhtml` or `.xml` name never qualifies, whatever its content;
   - otherwise run the vector pipeline (§ 3). A rejection maps to a `vector_image_*` code. On
     success the **sanitised** buffer replaces the input buffer for quota, storage and `fileSize`,
     the MIME type is fixed to `image/svg+xml`, an extension-less name gains `.svg`, and the row's
     `storageMetadata.vectorImage` records the pass (§ 4).
5. Partition lookup, `requirePrivatePartition`, quota reservation, storage, scope invariant and the
   persistence transaction — unchanged. OCR/text extraction is skipped for a sanitised vector image
   (an SVG is not an OCR input; LLM OCR would otherwise be invoked for any `image/*`).

### 3. Vector pipeline (`lib/vector-image.ts`)

`sanitizeVectorImage(buffer)` returns either a sanitised document plus the list of what it removed,
or a rejection code when the input cannot be sanitised at all. `prepareVectorImageUpload(buffer)`
applies the storage policy on top: any removal that is not **inert** is a rejection.

**Pre-parse gates**

| Gate | Code | Why |
|---|---|---|
| `buffer.length > 1 MiB` | `vector_image_too_large` (413) | Logos are typically 2–150 KB; a logo with an embedded raster rarely exceeds a few hundred KB. 1 MiB keeps the jsdom parse and DOMPurify walk well under a second and bounds memory per request. The caller's own `maxBytes` still applies first. |
| not valid UTF-8 | `vector_image_malformed` | jsdom decodes as UTF-8; a mis-decoded document is not the document the user uploaded. |
| `<!ENTITY` anywhere, or a `<!DOCTYPE` with an internal subset (`[`) | `vector_image_entity_declaration` | Closes entity expansion (billion laughs) and external-entity tricks before any parser sees them. A plain `<!DOCTYPE svg PUBLIC …>` (common in editor exports) is not an entity declaration; it is removed as inert. |

**Parse gates** (`DOMParser.parseFromString(text, 'image/svg+xml')` on a `jsdom` window)

| Gate | Code |
|---|---|
| parse error / root is not `<svg>` in the SVG namespace | `vector_image_malformed` |
| more than 10,000 elements | `vector_image_too_complex` |
| nesting deeper than 64 elements | `vector_image_too_complex` |
| in-document `<use>` expansion over 10,000 instances, or a `<use>` reference cycle | `vector_image_too_complex` |

The element bound is two orders of magnitude above a realistic logo (tens to low thousands of
paths). The depth bound keeps recursive serialisation away from the stack limit. The `<use>`
expansion bound closes the "billion laughs" analogue in SVG — nested groups that each reference the
previous one ten times expand exponentially at render time even though the file is tiny.

**Sanitisation**

1. *Inert pre-pass* (recorded as `inert`): comments, processing instructions other than
   `xml-stylesheet`, the DOCTYPE node, `<metadata>`, elements outside the SVG/XHTML/MathML
   namespaces (editor data such as Inkscape/Sodipodi/RDF), attributes outside the
   null/XLink/XML/XMLNS namespaces, and namespace declarations other than the SVG and XLink ones (kept so the serialiser does
   not invent `ns1:` prefixes). None of these render.
2. *`xml-stylesheet` processing instruction* — removed and recorded as `external_reference`.
3. *DOMPurify* (`USE_PROFILES: { svg: true, svgFilters: true }`, `ADD_TAGS: ['use']`,
   `ADD_DATA_URI_TAGS: ['feimage']`, `IN_PLACE`
   on the parsed XML document, fresh window per call, no shared hooks). DOMPurify's SVG profile
   omits `<use>` because it can pull in another document; it is added back because logos rely on
   in-document reuse, and step 4 restricts every `href` on it to `#id`. DOMPurify
   permits `data:` URIs only on its own list (`<img>`, `<image>`, …), so `feImage` is added to it; step
   4 still limits those URIs to base64 PNG/JPEG/GIF/WebP with a matching signature. `KEEP_CONTENT: false`: DOMPurify
   otherwise hoists the children of a removed element whose name it does not recognise as a
   content-forbidding one (for example the text of a prefixed `<html:script>`); since any removed
   element already rejects the upload, there is nothing worth keeping. Its allowlist removes `<script>`,
   `<foreignObject>`, `<iframe>`, `<embed>`, `<object>`, `<set>`, `<animate>`, every `on*`
   handler and `javascript:` URLs. Every entry DOMPurify records in `removed` is classified as
   `active_content`, except an attribute DOMPurify does not know whose name is not `on*`/`href`-like
   and whose value carries no URL or scheme (`enable-background`, editor presentation hints), which
   is `inert`.
4. *Reference post-pass* on the surviving DOM (DOMPurify's URI check accepts `https:` links, so this
   policy is ours):
   - `href` / `xlink:href` must be an in-document fragment (`#id`); on `<image>`/`<feImage>` a
     `data:image/(png|jpeg|gif|webp);base64,…` URI is also accepted, and its decoded bytes must
     carry the matching raster signature. `javascript:`/`vbscript:`/other `data:` → `active_content`;
     anything else → `external_reference`. The attribute is removed.
   - any attribute value containing `url(` (`fill`, `clip-path`, `mask`, `filter`, `marker-*`) is
     checked with the CSS rule below; a failing attribute is removed.
   - `style=""` and every `<style>` element are checked with the CSS rule; a failing attribute is
     removed, a failing `<style>` element is removed.
   - animation elements whose `attributeName` targets `href`/`xlink:href` are removed
     (`active_content`) — a backstop in case a future DOMPurify allowlist admits them.
5. *Serialise* the root with `XMLSerializer`.

**CSS rule** (DOMPurify does not parse CSS). After stripping `/* … */` comments, the text is
rejected when it contains: a backslash (escape sequences are the standard way to smuggle
`\75 rl(` or `@\69mport` past a lexical check, and logos do not need them) or `expression(`,
`javascript:`, `vbscript:`, `-moz-binding`, `behavior:` → `active_content`; `@import`, any of
`image()`, `image-set()`, `cross-fade()`, `element()`, `src()` (functions that accept a bare string
URL), or a `url()` whose target is not `#id` or an allowed raster `data:` URI → `external_reference`.
Every `url(` occurrence must parse; an unparseable one is external. The check is deliberately a
reject-list over a normalised string — the CSP below is the second layer.

**Storage policy** (`prepareVectorImageUpload`): reject with `vector_image_unsafe_content` when any
removal is `active_content`, else with `vector_image_external_reference` when any is
`external_reference`; store only when every removal is `inert`. "Materially" therefore means: any
removed element other than comments, processing instructions, the DOCTYPE, `<metadata>` and
non-rendering foreign-namespace elements; any removed event handler, link, URL-bearing or style
attribute; any removed or neutralised CSS. Storing a logo whose gradient silently lost its
`url(#…)` or whose web font was dropped is worse than asking for a clean export.

### 4. Provenance record

```jsonc
// attachments.storage_metadata
{
  "assignments": [...], "tags": [...],
  "vectorImage": {
    "sanitizer": "dompurify",
    "sanitizerVersion": "3.4.11",
    "policyVersion": 1,
    "sha256": "<hex digest of the stored bytes>",
    "sanitizedAt": "2026-10-05T12:00:00.000Z"
  }
}
```

No HTTP endpoint writes arbitrary `storageMetadata` keys (`PATCH /attachments/library/{id}` and the
transfer route only merge `tags`/`assignments` through `mergeAttachmentMetadata`, which preserves
other keys). Copy paths (`messages` forward, `catalog` variant media) copy metadata together with
the bytes, so the digest still matches.

### 5. Serving

`isTrustedVectorImage(attachment, bytes)` is true only when the row's MIME type is `image/svg+xml`,
the record has a known `sanitizer` and `policyVersion`, and the SHA-256 of the bytes just read from
storage equals the recorded digest. The digest binds the record to the bytes: a storage object that
was replaced out-of-band, or a legacy SVG row that somehow acquired the key, falls back to download.

- `readScoped`: inline `image/svg+xml` unless `forceDownload`; the result gains an optional
  `contentSecurityPolicy` (present on every result; the vector value for a trusted vector image,
  `default-src 'none'; sandbox` otherwise) so a calling route can emit the right header.
- `GET /api/attachments/file/{id}`: same decision; `Content-Security-Policy` becomes
  `default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox` for a trusted vector
  image. `style-src 'unsafe-inline'` lets the document's own `<style>` apply when it is opened
  directly; `img-src data:` lets embedded rasters render; `default-src 'none'` blocks every
  fetch; `sandbox` disables script and gives the document an opaque origin.
  `X-Content-Type-Options: nosniff` stays on every response.
- `readScopedForOwner` (§ 6): same serving decision as `readScoped`.
- `GET /api/attachments/image/{id}` is unchanged: `canRenderInlineAttachment` still excludes
  `image/svg+xml`, so Sharp is never handed vector input. Callers embed the file URL in `<img>`,
  where browsers render SVG with scripting and external loads disabled regardless of headers.

### 6. Owner-scoped reads without a principal (`readScopedForOwner`)

A module that publishes its own files to anonymous visitors (a company's public logo on a
storefront or a printable page) cannot call `readScoped`: it requires a non-null `AuthContext`, and
`checkAttachmentAccess` refuses anonymous reads of tenant-scoped rows. Without a sanctioned path the
only option is to fabricate a principal, which is worse than any narrow contract — a forged
`AuthContext` carries roles and features that every downstream check would then trust.

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

Behaviour:

1. Blank `tenantId`, `organizationId`, `expectedPartitionCode` or owner fields → 500 before any
   query, so a caller bug can never widen the lookup (for example to the global both-null shape).
2. The row is looked up by `{ id, tenantId, organizationId }` at the database boundary and the
   returned row's scope pair is re-checked (defence in depth against a regressed filter).
3. The partition must be global or owned by exactly that tenant and organization.
4. Partition code, owner (`entityId` + `recordId`) and, when given, assignment are enforced by the
   same helper `readScoped` uses. Every refusal is a 404, so the method does not reveal whether an
   id exists elsewhere.
5. Serving (content type, disposition, CSP hint) is the shared helper too: inline `image/svg+xml`
   only for trusted vector rows.

**Security argument.** The caller's own ownership record is the authorization: the module has
already decided, from rows it owns (say, an organisation profile whose `logo_attachment_id` it
stored when the user uploaded the logo), that this file is meant to be public. The owner check makes
the method useless as a general file reader — it returns only an attachment whose `entity_id` and
`record_id` are the ones the caller names, in the caller's tenant, organization and partition, so a
leaked or guessed attachment id from another record, module, tenant or partition yields 404. The
method is a server-side DI contract only: no attachments route calls it (a test walks `api/` to keep
it that way), and its JSDoc tells callers to resolve the attachment id and owner from their own
records, never from request input. It is optional on the interface so third-party
`AttachmentService` implementations keep compiling.

## Architecture

```
module ──createScoped({ allowVectorImage: true })──▶ DefaultAttachmentService
                                                     │ (assertAttachmentScopeInvariant, validateUpload)
                                                     ▼
                                         ScopedAttachmentUploadService.upload
                                                     │ executable ext ✗ · maxBytes ✗
                                                     │ active content? ── flag off ──▶ active_content 400
                                                     │        └─ flag on ─▶ lib/vector-image.ts
                                                     │                      jsdom + DOMPurify + policy
                                                     │                      ✗ vector_image_* | ✓ sanitised bytes
                                                     ▼
                                    partition (private) · quota · store · persist (+ vectorImage record)
```

`jsdom` and `dompurify` are loaded with dynamic `import()` inside the pipeline, so processes that
never take the vector path never load them. Next.js already treats `jsdom` as a server-external
package, so it is not bundled.

## Data Models

No schema change. The record lives in the existing `attachments.storage_metadata` JSON column under
a new key, `vectorImage`. No migration, no `yarn db:generate`.

## API Contracts

| Contract | Change | Class |
|---|---|---|
| `CreateScopedAttachmentInput.allowVectorImage?: boolean` | new optional field | ADDITIVE |
| `ReadScopedAttachmentResult.contentSecurityPolicy?: string` | new optional field | ADDITIVE |
| `AttachmentService.readScopedForOwner?(input)` + exported `ReadScopedAttachmentForOwnerInput` | new optional method and type | ADDITIVE |
| `ScopedAttachmentUploadInput.allowVectorImage?: boolean` | new optional field (internal DI service) | ADDITIVE |
| `ScopedAttachmentUploadErrorCode` | new members `vector_image_*` (internal, not exported from the module index) | ADDITIVE |
| `createScoped` error body | `{ error }` gains `code` for `vector_image_*` rejections only | ADDITIVE |
| `GET /api/attachments/file/{id}` | inline SVG only for trusted vector rows | behaviour on rows that cannot exist before this change |

Rejection codes and statuses:

| Code | Status | Meaning |
|---|---|---|
| `vector_image_too_large` | 413 | over the 1 MiB vector bound |
| `vector_image_malformed` | 400 | not UTF-8, not well-formed XML, root not `<svg>`, or not parseable |
| `vector_image_entity_declaration` | 400 | `<!ENTITY>` or a DOCTYPE internal subset |
| `vector_image_too_complex` | 400 | element count, depth or `<use>` expansion bound exceeded |
| `vector_image_unsafe_content` | 400 | sanitisation removed script, handlers, `foreignObject`, embedded documents, unsafe URLs or CSS |
| `vector_image_external_reference` | 400 | sanitisation removed an external link, `url()`, `@import` or stylesheet PI |
| `vector_image_sanitizer_unavailable` | 500 | `dompurify`/`jsdom` could not be loaded |

## Dependencies

Both are already resolved in `yarn.lock`; adding them to `@open-mercato/core` adds no new resolution
and therefore nothing subject to the five-day `npmMinimalAgeGate`.

| Package | Range | Resolved | Why |
|---|---|---|---|
| `dompurify` | `^3.4.11` | 3.4.11 (root `resolutions` pin) | OWASP-recommended allowlist sanitiser with a maintained SVG profile; already pinned for `mermaid`. |
| `jsdom` | `^26.1.0` | 26.1.0 (via `jest-environment-jsdom`) | DOMPurify needs a DOM on the server; jsdom is the server DOM DOMPurify documents and tests against (`happy-dom` is documented as unsafe). Its XML parser (saxes) does not fetch DTDs or external entities. |
| `@types/jsdom` (dev) | `^21.1.7` | 21.1.7 (via `@jest/environment-jsdom-abstract`) | types for the dynamic import. |

Alternatives rejected: `sanitize-html` (already a core dependency) is an HTML allowlist over
`htmlparser2`; it has no notion of SVG reference semantics or namespaces. A hand-rolled
regex/XML walker would re-implement DOMPurify's allowlist and mXSS defences without its review
history.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Sanitiser bypass yields script in a stored SVG | High | XSS on direct navigation | DOMPurify allowlist + our reference/CSS policy + reject-on-material-removal + serving CSP `sandbox`/`default-src 'none'` + `nosniff`; `<img>` embedding disables script regardless | Low: requires a DOMPurify bypass *and* a CSP bypass |
| External fetch (tracking pixel, remote font) | Medium | privacy | href/url()/@import/image-set rejected at upload; `default-src 'none'` at serve | Low |
| Parser DoS (entities, huge or deep files) | Medium | availability | entity gate before parse, 1 MiB cap, element/depth bounds, fresh jsdom window closed in `finally` | Low |
| Render DoS via `<use>` amplification | Low | client | `<use>` expansion bound with cycle detection | Low |
| Legitimate logos rejected (editor cruft) | Low | UX | editor namespaces, metadata, comments, DOCTYPE and unknown presentation attributes are inert; rejection codes name the problem so users can re-export | Some exports (e.g. with `foreignObject` fallbacks or web fonts) need re-exporting |
| Forged `vectorImage` record on an unsanitised row | Low | XSS | no endpoint writes arbitrary metadata keys; SHA-256 binding to stored bytes; CSP still applies | Requires DB write access |
| `readScopedForOwner` used as a general reader | Medium | data exposure | owner + tenant + organization + partition all required and enforced; blank inputs refused before querying; no HTTP route calls it (test-enforced); JSDoc requires ids from the caller's own records | Caller passing request input straight through — reviewable at the call site |
| `jsdom` weight in the server bundle | Low | memory/startup | dynamic import on the vector path only; jsdom is a Next.js server-external package | — |

## Migration & Backward Compatibility

All contract changes are additive optional fields (BACKWARD_COMPATIBILITY.md § 2: "Optional fields
may be added freely"). With the flag absent — every existing caller — `createScoped` takes exactly
the code path it took before, and the generic route does not read the flag at all. Serving changes
only for rows that carry a `vectorImage` record whose digest matches, and no such row can exist
before this change. `ReadScopedAttachmentResult.contentSecurityPolicy` and
`AttachmentService.readScopedForOwner` are optional, so third-party `AttachmentService`
implementations keep compiling. `readScoped` was refactored to share its owner/partition/serving
checks with `readScopedForOwner`; its observable behaviour for non-vector rows is unchanged (the
existing `readScoped` tests pass unmodified). No `UPGRADE_NOTES.md` entry is required.

## Testing Strategy

Every bullet below is a test that exists; nothing is planned-but-unwritten.

- `lib/__tests__/vector-image.test.ts` (fixtures in `vector-image.fixtures.ts`)
  - **Hostile documents** — 30 fixtures. For each, `prepareVectorImageUpload` rejects with the
    listed code, and (except the two entity fixtures, which are refused before parsing) the
    sanitised output no longer contains the payload:
    - `vector_image_unsafe_content`: `<script>`; XHTML-namespaced `<html:script>`; a script hidden
      inside a foreign-namespace wrapper; a script hidden inside `<metadata>`; `onload` on the root;
      `onclick` on a shape; `<foreignObject>` with HTML; `javascript:` link; `javascript:` link
      obfuscated with a character reference; non-raster `data:image/svg+xml` on `<image>`; a
      `data:image/png` URI on `<image>` whose bytes are not a PNG; an `<feImage>` `data:image/png`
      URI whose bytes are not a PNG; an `<feImage>` declaring `data:image/jpeg` while carrying PNG
      bytes; a CSS escape smuggling `url()`; `<set attributeName="href">`;
      `<animate attributeName="xlink:href">`; `<iframe>`; `<embed>`; `<object>`.
    - `vector_image_external_reference`: external `xlink:href` on `<image>`; external `href` on
      `<feImage>`; external `url()` in a `<style>` element, in `style=""` and in a presentation
      attribute (`fill`); `@import`; `image-set()` with a bare string URL;
      `<use href="https://…">`; an `xml-stylesheet` processing instruction.
    - `vector_image_entity_declaration`: DOCTYPE with entity expansion (billion laughs); an
      external (`SYSTEM`) entity.
  - **Benign documents** that are stored, with the structures named here present in the output:
    - a combined logo — `<style>` block, linear and radial gradients, clip path, mask,
      in-document `<use>` via both `href` and `xlink:href`, embedded base64 PNG on `<image>`,
      `viewBox`/`preserveAspectRatio`, a `style=""` attribute and `<title>` — with no non-inert
      removal;
    - a mask-based logo (`<mask maskUnits="userSpaceOnUse">` applied with `mask="url(#…)"`) with
      no removal at all;
    - an `<feImage>` filter carrying an embedded PNG (`data:image/png;base64,…` with a real PNG
      signature) composited with `<feComposite>` and applied with `filter="url(#…)"`, with no
      removal at all;
    - an editor export (comment, plain `<!DOCTYPE svg PUBLIC …>`, Inkscape/Sodipodi/RDF metadata)
      where every removal is inert and the drawing survives.
  - **Idempotence**: sanitising the sanitised output of all four benign documents removes nothing
    and yields identical bytes.
  - **Provenance**: the record carries `sanitizer`, the DOMPurify version, `policyVersion`, the
    SHA-256 of the stored bytes and `sanitizedAt`.
  - **Bounds and well-formedness**: over 1 MiB → `too_large`; over 10,000 elements, nesting over
    64, exponential `<use>` expansion, and a `<use>` cycle → `too_complex`; modest `<use>` reuse is
    accepted; not well-formed XML, an HTML document, an `<svg>` root outside the SVG namespace,
    plain text, and non-UTF-8 bytes → `malformed`.
  - **`inspectVectorImageCss`**: a 15-case table — fragment and raster `data:` `url()`s, plain
    declarations and a commented `url(#…)` pass; external, protocol-relative and relative `url()`,
    `@import` (any case), `-webkit-image-set()` and an unterminated `url(` are external; a CSS
    escape, `expression()` and `javascript:` inside `url()` are unsafe.
  - **`isVectorImageUploadCandidate`**: `.svg` accepted; extension-less accepted by declared or
    sniffed type; `.html`, `.xhtml`, `.xml`, `.htm` never accepted.
  - **`isTrustedVectorImage`**: matching digest trusted; tampered bytes, a missing record, null
    metadata, an unknown sanitiser, an unknown policy version and a non-SVG MIME type not trusted.
- `lib/__tests__/scoped-upload-service.test.ts` — without the flag an SVG is `active_content` with
  no quota or storage work; with the flag the sanitised document is stored, quota is reserved for
  the sanitised size, and the row has `image/svg+xml`, that size and the record whose digest matches
  the stored bytes; an extension-less SVG is named `.svg`; a hostile SVG is rejected with its
  `vector_image_*` code before any quota or storage work; an `.html` file with SVG content and an
  `.xhtml` file stay `active_content` with the flag; an executable extension and an oversized file
  are still refused with the flag; a public partition is still refused when a private one is
  required.
- `lib/__tests__/attachment-service.test.ts` (vector images) — `createScoped` forwards
  `allowVectorImage` as `false` unless the caller passes `true`; without opting in, an SVG is a 400
  with no `code` and no quota or storage work; opting in (through the real upload service) stores
  the sanitised bytes and returns `image/svg+xml` with the sanitised size; a hostile SVG is a 400
  with `code: vector_image_unsafe_content` before any quota reservation; each of the seven
  `vector_image_*` codes maps to its status with `code` in the body; `readScoped` serves a trusted
  vector row inline as `image/svg+xml` with the vector CSP, `forceDownload` still yields an
  `attachment` download, and a row with no record or with a digest mismatch stays a download with
  the default CSP.
- `lib/__tests__/attachment-service.test.ts` (`readScopedForOwner`) — reads by owner with the
  lookup pinned to `{ id, tenantId, organizationId }`; refuses a different owner entity, owner
  record, tenant, organization, partition, and an assignment the row does not carry (404, storage
  never touched); refuses a foreign row even if the scoped filter regresses; refuses a
  foreign-tenant partition; refuses a blank tenant, organization, partition or owner record with a
  500 before any query; serves a trusted vector row inline and an untrusted SVG as a download; no
  file under `api/` references it.
- `api/__tests__/file.route.test.ts` — a trusted vector row is served as `image/svg+xml`, `inline`,
  with the vector CSP and `nosniff`; `?download=1` forces an `attachment` download; a row with no
  record or a digest mismatch is `application/octet-stream`, `attachment`, with the default CSP and
  `nosniff`.
- `api/__tests__/attachments.api.test.ts` — the generic route rejects a clean `.svg` logo as active
  content even when the form carries `allowVectorImage=true` (alongside the existing test for a
  scripted SVG posing as a JPEG).
- `api/__tests__/image.route.test.ts` — a sanitised vector row is refused with 400 and Sharp is
  never called.

Regression proofs run during implementation: with the upstream wiring restored, every new upload,
serving and `readScopedForOwner` behaviour test fails; with the DOMPurify pass disabled, every
script/handler/embedded-document fixture fails; with the reference/CSS post-pass and entity gate
disabled, every external-reference, CSS, `data:` and entity fixture fails; with the post-pass
`href` check skipped for `<feImage>`, all three `<feImage>` rejection fixtures fail.

## Final Compliance Report

- Tenant scoping, `assertAttachmentScopeInvariant`, `checkAttachmentAccess`, the private-partition
  requirement of `createScoped`, quota accounting and the executable-extension check are untouched
  and still run on the vector path.
- No direct cross-module ORM relations; no new DI keys, events, ACL features or routes.
- User-facing rejection messages go through `attachments.errors.*` translation keys in all locales.
- No database migration and no generated-file change.

## Changelog

- 2026-10-06 — Testing Strategy rewritten to list exactly the tests that exist; added the mask
  and `<feImage>` raster cases, which surfaced that DOMPurify strips `data:` URIs on `<feImage>`
  (now `ADD_DATA_URI_TAGS: ['feimage']`, still bounded by the step 4 raster check).
- 2026-10-05 — Spec written and implemented: `allowVectorImage` on `createScoped`, DOMPurify/jsdom
  vector pipeline with reject-on-material-removal, provenance record bound by SHA-256, inline
  serving under a sandboxing CSP for trusted rows only; `readScopedForOwner` for principal-less
  owner-scoped reads by module code.
