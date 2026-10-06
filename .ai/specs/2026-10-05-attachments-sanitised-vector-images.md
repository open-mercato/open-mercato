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
runs it through DOMPurify (SVG profile) on a `jsdom` DOM plus a reference and CSS policy, stores
**only the sanitised bytes**, and records on the row that it went through this path. Files that are
not well-formed, exceed the size or complexity bounds, or would lose renderable or active content
to sanitisation are **rejected with an explicit error code** rather than stored silently broken.

Serving changes only for rows carrying that record *and* whose stored bytes still hash to the
recorded digest: they are returned as `image/svg+xml` with `inline` disposition under a sandboxing
CSP that allows the document's own styles and embedded rasters. The file route now owns its
`Content-Security-Policy`; the app's `next.config.ts` no longer pins one for it, because Next.js
lets a config header override a route handler's header of the same name. Every other SVG-typed row,
every existing caller, the generic upload route and the image (thumbnail) route behave as before.

## Overview

| Surface | Before | After |
|---|---|---|
| `POST /api/attachments` (generic route) | SVG → 400 `activeContentBlocked` | unchanged |
| `attachmentService.createScoped()` without the flag | SVG → 400 | unchanged |
| `attachmentService.createScoped({ allowVectorImage: true })` | SVG → 400 | SVG sanitised and stored, or rejected with a `vector_image_*` code |
| `attachmentService.readScoped()` on a sanitised vector row | `application/octet-stream`, `attachment` | `image/svg+xml`, `inline` (unless `forceDownload`), plus a `contentSecurityPolicy` hint |
| `GET /api/attachments/file/{id}` on a sanitised vector row | `application/octet-stream`, `attachment` | `image/svg+xml`, `inline` (unless `?download=1`), vector CSP |
| `GET /api/attachments/file/{id}`, every other response | CSP `default-src 'none'; sandbox` from `next.config.ts` | the same CSP, now set by the route (including its JSON errors) |
| `GET /api/attachments/library`, `GET /api/attachments` `thumbnailUrl` of a sanitised vector row | image route (which refuses SVG) | file route |
| `GET /api/attachments/image/{id}` | SVG → 400 | unchanged — Sharp never rasterises vector input |
| Any other SVG-typed row (legacy, copied, digest mismatch) | download | unchanged — download |

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
  allowVectorImage?: boolean
}
```

`DefaultAttachmentService.createScoped` forwards it (as `allowVectorImage: input.allowVectorImage === true`)
to `ScopedAttachmentUploadInput.allowVectorImage`, next to the `requirePrivatePartition: true` it
already passes. The name follows the existing boolean options on these inputs
(`requirePrivatePartition`, `forceDownload`): a verb plus the thing it governs.

### 2. Upload path (`ScopedAttachmentUploadService.upload`)

Order of checks — nothing that runs today is removed or reordered:

1. Sanitise file name; reject dangerous executable extensions (unchanged).
2. Reject `buffer.length > maxBytes` (unchanged; `maxBytes` is the caller's limit or the module default).
3. Detect MIME type (unchanged).
4. If the file is active content:
   - when `allowVectorImage` is **not** true → `active_content` 400 (unchanged);
   - when it is true but the file is **not a vector-image candidate** → `active_content` 400.
     A candidate has the `.svg` extension, or no extension at all with an `image/svg+xml` declared
     or sniffed type. An `.html`, `.xhtml` or `.xml` name never qualifies, whatever its content;
   - otherwise run the vector pipeline (§ 3). A rejection maps to a `vector_image_*` code. The
     sanitised bytes are checked against `maxBytes` again (`max_upload_size`, 413), because
     serialisation can make a document larger (`>` in text becomes `&gt;`). On success the
     **sanitised** buffer replaces the input buffer for quota, storage and `fileSize`, the MIME type
     is fixed to `image/svg+xml`, an extension-less name gains `.svg`, and the row's
     `storageMetadata.vectorImage` records the pass (§ 4).
5. Partition lookup, `requirePrivatePartition`, quota reservation, storage, scope invariant and the
   persistence transaction — unchanged. OCR/text extraction is skipped for a sanitised vector image
   (an SVG is not an OCR input; LLM OCR would otherwise be invoked for any `image/*`).

### 3. Vector pipeline (`lib/vector-image.ts`)

`sanitizeVectorImage(buffer)` returns either a sanitised document plus the list of what it removed,
or a rejection code when the input cannot be sanitised at all. `prepareVectorImageUpload(buffer)`
applies the storage policy on top: any removal that is not **inert** is a rejection.

**Bounds** (all measured below; each one caps the work of every later pass)

| Bound | Value | Code |
|---|---|---|
| input bytes, and serialised output bytes | 1 MiB | `vector_image_too_large` (413) |
| elements | 5,000 | `vector_image_too_complex` |
| nesting depth | 64 | `vector_image_too_complex` |
| attributes on one element | 64 | `vector_image_too_complex` |
| attributes in the document | 25,000 | `vector_image_too_complex` |
| in-document `<use>` expansion, or any `<use>` reference cycle | 10,000 instances | `vector_image_too_complex` |

Real logos are typically 2–150 KB with tens to low thousands of paths and under 20 attributes per
element; a 5,000-path logo carrying `d`, `fill`, `class` and `id` is 20,000 attributes. The
attribute bounds exist because jsdom removes or re-sets an attribute in time linear in the element's
attribute count and DOMPurify touches every attribute, so one element with 80,000 attributes took
over 200 s. The `<use>` bound closes the "billion laughs" analogue in SVG: nested groups that each
reference the previous one ten times expand exponentially at render time.

**Pre-parse gates**

| Gate | Code | Why |
|---|---|---|
| not valid UTF-8 | `vector_image_malformed` | jsdom decodes as UTF-8; a mis-decoded document is not the document the user uploaded. |
| `<!ENTITY`, `<!ATTLIST`, `<!ELEMENT` or `<!NOTATION` anywhere, or a `<!DOCTYPE` with an internal subset | `vector_image_entity_declaration` | Closes entity expansion, external entities and DTD default attributes (`<!ATTLIST svg onload CDATA #FIXED …>`) before any parser sees them. `hasDtdDeclarations` scans each DOCTYPE with quoted public/system identifiers treated as strings, so a `>` or `[` inside them can neither end the DOCTYPE early nor hide the subset. A plain `<!DOCTYPE svg PUBLIC …>` (common in editor exports) is accepted and removed as inert. |

**Parse gate**: `DOMParser.parseFromString(text, 'image/svg+xml')` on a `jsdom` window; a parse
error or a root that is not `<svg>` in the SVG namespace is `vector_image_malformed`.

**Sanitisation**

1. *Inert pre-pass* (recorded as `inert`): comments, processing instructions other than
   `xml-stylesheet`, the DOCTYPE node, `<metadata>`, elements outside the SVG/XHTML/MathML
   namespaces (editor data such as Inkscape/Sodipodi/RDF), attributes outside the
   null/XLink/XML/XMLNS namespaces, and namespace declarations other than the SVG and XLink ones
   (kept so the serialiser does not invent `ns1:` prefixes). None of these render. A foreign or
   `<metadata>` wrapper that hides a rendering element (for example a `<script>`) is recorded as
   `active_content` instead.
2. *`xml-stylesheet` processing instruction* — removed and recorded as `external_reference`.
3. *CDATA in `<style>`* — design tools wrap stylesheets in `<![CDATA[ … ]]>`, which DOMPurify drops
   as a node. The CDATA text becomes an ordinary text node, so the stylesheet survives and is still
   inspected by the CSS rule in step 5.
4. *DOMPurify* (`USE_PROFILES: { svg: true, svgFilters: true }`, `ADD_TAGS: ['use']`,
   `ADD_DATA_URI_TAGS: ['feimage']`, `KEEP_CONTENT: false`, `IN_PLACE` on the parsed XML document,
   fresh window per call, no shared hooks).
   - DOMPurify's SVG profile omits `<use>` because it can pull in another document; it is added
     back because logos rely on in-document reuse, and step 5 restricts every `href` on it to `#id`.
   - DOMPurify permits `data:` URIs only on its own list (`<img>`, `<image>`, …), so `feImage` is
     added; step 5 still limits those URIs to base64 PNG/JPEG/GIF/WebP with a matching signature.
   - `KEEP_CONTENT: false` because DOMPurify otherwise hoists the children of a removed element
     whose name it does not recognise as content-forbidding (the text of a prefixed
     `<html:script>`); any removed element already rejects the upload.
   - Its allowlist removes `<script>`, `<foreignObject>`, `<iframe>`, `<embed>`, `<object>`,
     `<set>`, `<animate>`, every `on*` handler and `javascript:` URLs. Every entry DOMPurify records
     in `removed` is `active_content`, except an attribute DOMPurify does not know whose name is not
     `on*`/`href`-like and whose value carries no URL or scheme (`enable-background`, editor
     presentation hints), which is `inert`.
5. *Reference post-pass* on the surviving DOM (DOMPurify's URI check accepts `https:` links, so this
   policy is ours):
   - `href` / `xlink:href` must be an in-document fragment (`#id`); on `<image>`/`<feImage>` a
     `data:image/(png|jpeg|gif|webp);base64,…` URI is also accepted, and its decoded bytes must
     carry the matching raster signature. `javascript:`/`vbscript:`/other `data:` →
     `active_content`; anything else → `external_reference`. The attribute is removed.
   - `style` and the CSS-parsed presentation attributes that can carry a URL (`fill`, `stroke`,
     `clip-path`, `mask`, `filter`, `marker`, `marker-start`, `marker-mid`, `marker-end`,
     `cursor`), plus any other attribute whose value contains `url(`, are checked with the CSS rule;
     a failing attribute is removed. Every `<style>` element is checked too; a failing one is removed.
   - animation elements whose `attributeName` targets `href`/`xlink:href` are removed
     (`active_content`) — a backstop in case a future DOMPurify allowlist admits them.
6. *Serialise* the root with `XMLSerializer`; output over 1 MiB is `vector_image_too_large`.

**CSS rule** (`inspectVectorImageCss`; DOMPurify does not parse CSS). The text is tokenised the way
CSS Syntax Level 3 does — comments, quoted strings, `url(` tokens, functions and at-keywords are
tokens — so a comment opener inside a string (`content:"/*"`) cannot hide the declarations after it,
and a comment inside an unquoted `url(` stays part of the URL. The result is:

- `active_content` for any backslash (escapes are the standard way to smuggle `\75 rl(` or
  `@\69mport` past a check, and logos need none); a string ended by a newline or by the end of the
  text; an unterminated comment or `url(` token; a malformed unquoted URL (quote, `(`, or inner
  whitespace); `expression()`; and the identifiers `behavior`, `-moz-binding`, `javascript`,
  `vbscript`;
- `external_reference` for `@import`; any of `image()`, `image-set()`, `cross-fade()`, `element()`,
  `src()`, `attr()` (with or without a vendor prefix; these accept a bare string URL); and a `url()`
  whose target is neither `#id` nor an allowed raster `data:` URI;
- nothing otherwise.

The rule is deliberately stricter than a browser: anything that could make two CSS parsers disagree
is refused. The serving CSP is the second layer.

**Storage policy** (`prepareVectorImageUpload`): reject with `vector_image_unsafe_content` when any
removal is `active_content`, else with `vector_image_external_reference` when any is
`external_reference`; store only when every removal is `inert`. "Materially" therefore means: any
removed element other than comments, processing instructions, the DOCTYPE, `<metadata>` and
non-rendering foreign-namespace elements; any removed event handler, link, URL-bearing or style
attribute; any removed or neutralised CSS. Storing a logo whose gradient silently lost its
`url(#…)` or whose web font was dropped is worse than asking for a clean export.

### 4. Cost: linear passes, measured bounds, and why not a worker thread

Every pass walks the DOM once over `firstChild`/`nextSibling` links. jsdom's live
`children`/`childNodes` collections are proxies whose indexed access is linear, so the first
implementation, which copied them per node, was quadratic. The `<use>` expansion check records
each element's pre-order range in one pass, so the `<use>` elements inside a referenced subtree are
a contiguous, binary-searched slice, and each referenced subtree is expanded once (memoised).

Measured on an Intel i5-1235U laptop (Windows 11, Node 24) while another build was running; warm
timings are the maximum of three runs after one warm-up call.

| Document | Before | After (at the final bounds) |
|---|---|---|
| 9,990 `<rect>`s (280 KB) | 22,323 ms | — (over the element bound) |
| 9,990 `<rect fill="url(#g)">` (220 KB) | 21,441 ms | — (over the element bound) |
| 9,000 `<use href="#a">` (144 KB) | 15,807 ms | — (over the element bound) |
| one element with 80,000 attributes | 201,836 ms | — (over the attribute bounds) |
| 4,990 elements × 5 attributes at the attribute bound | — | 288 ms |
| 4,990 paths with `url()` paint at the attribute bound | — | 315 ms |
| 390 elements × 64 attributes | — | 146 ms |
| 4,990 elements with editor-namespaced attributes | — | 215 ms |
| 4,990 `<use>` elements | — | 531 ms |
| nesting at the depth bound, 5,000 elements | — | 454 ms |
| a 1 MiB stylesheet | — | 143 ms |
| 1 MiB of text | — | 106 ms |
| first call in a process (loads `jsdom` and `dompurify`) | — | 518–604 ms, once |

The warm worst case at the bounds is about half a second on a loaded laptop. A test
(`sanitizeVectorImage — bounded cost`) sanitises the five worst shapes at the bounds and asserts
each finishes under 5 s: about ten times the measured worst case, so a slow CI runner cannot make it
flaky, while a return of the quadratic traversal (15–27 s on 10,000 elements) still fails it.

Sanitising stays on the request's event loop rather than in a worker thread:

- **The cost is now bounded and small.** About 0.5 s worst case, on an upload path that is
  authenticated, module-initiated and rare (a logo per record).
- **A worker would cost more than it saves.** A worker per call reloads `jsdom` (about 0.5 s cold),
  which is the size of the cost being protected against.
- **A pool is a lifecycle problem for a library.** A worker pool means start, crash recovery and
  shutdown inside a library module.
- **Bundling breaks worker entries.** `@open-mercato/core` ships as `dist/` consumed through the
  app's Next.js server bundle, where a worker entry file must be resolvable at runtime — fragile
  under both webpack and Turbopack.

The bounds are the defence instead, and the cost test keeps them honest.

### 5. Provenance record

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

Reading the record lives in `lib/vector-image-record.ts`, which has no server-only imports, so list
views and client code can use `hasVectorImageRecord` without pulling in `node:crypto`, `jsdom` or
`dompurify`. `lib/vector-image.ts` re-exports it.

No HTTP endpoint writes arbitrary `storageMetadata` keys (`PATCH /attachments/library/{id}` and the
transfer route only merge `tags`/`assignments` through `mergeAttachmentMetadata`, which preserves
other keys). Copy paths (`messages` forward, `catalog` variant media) copy metadata together with
the bytes, so the digest still matches.

### 6. Serving

`isTrustedVectorImage(attachment, bytes)` is true only when the row's MIME type is `image/svg+xml`,
the record has a known `sanitizer` and `policyVersion`, and the SHA-256 of the bytes just read from
storage equals the recorded digest. The digest binds the record to the bytes: a storage object that
was replaced out-of-band, or a legacy SVG row that somehow acquired the key, falls back to download.

- `readScoped`: inline `image/svg+xml` unless `forceDownload`; the result gains an optional
  `contentSecurityPolicy` (present on every result; the vector value for a trusted vector image,
  `default-src 'none'; sandbox` otherwise) so a calling route can emit the right header.
- `GET /api/attachments/file/{id}`: same decision; `Content-Security-Policy` is
  `default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox` for a trusted vector
  image and `default-src 'none'; sandbox` for every other response, its JSON errors included.
  `style-src 'unsafe-inline'` lets the document's own `<style>` apply when it is opened directly;
  `img-src data:` lets embedded rasters render; `default-src 'none'` blocks every fetch; `sandbox`
  disables script and gives the document an opaque origin. `X-Content-Type-Options: nosniff` stays
  on every response.
- `GET /api/attachments/image/{id}` is unchanged: `canRenderInlineAttachment` still excludes
  `image/svg+xml`, so Sharp is never handed vector input.
- Thumbnails: `resolveAttachmentThumbnailUrl` (`lib/imageUrls.ts`) returns the file URL for a row
  with a vector record and the image-route URL otherwise. `GET /api/attachments/library` and
  `GET /api/attachments` use it, so the library grid and `AttachmentMetadataDialog` (which renders
  the list's `thumbnailUrl`) preview a sanitised SVG instead of a 400. Every other row keeps the URL
  it had.

**Header ownership (`next.config.ts`).** Next.js 16 applies `headers()` rules before the handler
runs, and `send-response.js` only appends a handler header when `res.getHeader(name)` is undefined
(or the header is multi-valued); a later matching rule overrides an earlier one for the same key
(`resolve-routes.js`). The previous `/api/attachments/file/:path*` rule therefore replaced whatever
CSP the route set. Config cannot unset a header, so the app CSP rule now uses the source
`/:path((?!api/attachments/file/).*)`, which Next's build-time route regex (`buildCustomRoute`)
matches for every path except the file route and its sub-paths. The `Referrer-Policy`,
`X-Content-Type-Options` and `X-Frame-Options` headers stay global. The same change is mirrored in
`packages/create-app/template/next.config.ts` (`yarn template:sync` passes).

## Architecture

```
module ──createScoped({ allowVectorImage: true })──▶ DefaultAttachmentService
                                                     │ (assertAttachmentScopeInvariant, validateUpload)
                                                     ▼
                                         ScopedAttachmentUploadService.upload
                                                     │ executable ext ✗ · maxBytes ✗
                                                     │ active content? ── flag off ──▶ active_content 400
                                                     │        └─ flag on ─▶ lib/vector-image.ts
                                                     │                      bounds · jsdom + DOMPurify + policy
                                                     │                      ✗ vector_image_* | ✓ sanitised bytes
                                                     │ sanitised bytes ≤ maxBytes
                                                     ▼
                                    partition (private) · quota · store · persist (+ vectorImage record)
```

## Data Models

No schema change. The record lives in the existing `attachments.storage_metadata` JSON column under
a new key, `vectorImage`. No migration, no `yarn db:generate`.

## API Contracts

| Contract | Change | Class |
|---|---|---|
| `CreateScopedAttachmentInput.allowVectorImage?: boolean` | new optional field | ADDITIVE |
| `ReadScopedAttachmentResult.contentSecurityPolicy?: string` | new optional field | ADDITIVE |
| `ScopedAttachmentUploadInput.allowVectorImage?: boolean` | new optional field (DI service `attachmentScopedUploadService`) | ADDITIVE |
| `ScopedAttachmentUploadErrorCode` | new members `vector_image_*` (not exported from the module index) | ADDITIVE |
| `createScoped` error body | `{ error }` gains `code` for `vector_image_*` rejections only | ADDITIVE |
| `lib/imageUrls.ts` | new `resolveAttachmentThumbnailUrl` | ADDITIVE |
| `lib/vector-image.ts`, `lib/vector-image-record.ts` | new modules | ADDITIVE |
| `GET /api/attachments/file/{id}` | inline SVG only for trusted vector rows; CSP now set by the route on every response | behaviour on rows that cannot exist before this change; header value unchanged for every other response |
| `GET /api/attachments`, `GET /api/attachments/library` | `thumbnailUrl` of a vector row is the file URL | behaviour on rows that cannot exist before this change |
| `apps/mercato/next.config.ts`, template `next.config.ts` | app CSP rule excludes `/api/attachments/file/*`; the file-route CSP rule is removed | config change, mirrored in the template |

Rejection codes and statuses:

| Code | Status | Meaning |
|---|---|---|
| `vector_image_too_large` | 413 | input or serialised output over 1 MiB |
| `vector_image_malformed` | 400 | not UTF-8, not well-formed XML, or root not `<svg>` in the SVG namespace |
| `vector_image_entity_declaration` | 400 | a DTD declaration or a DOCTYPE internal subset |
| `vector_image_too_complex` | 400 | element, depth, attribute or `<use>` expansion bound exceeded, or a `<use>` cycle |
| `vector_image_unsafe_content` | 400 | sanitisation removed script, handlers, `foreignObject`, embedded documents, unsafe URLs or unsafe CSS |
| `vector_image_external_reference` | 400 | sanitisation removed an external link, `url()`, `@import` or stylesheet PI |
| `vector_image_sanitizer_unavailable` | 500 | `dompurify`/`jsdom` could not be loaded |

A sanitised document that fits the 1 MiB bound but exceeds the caller's `maxBytes` is
`max_upload_size` (413), the existing code.

## Dependencies (Ask First — requested in the PR)

Both production dependencies are already resolved in `yarn.lock`; adding them to
`@open-mercato/core` adds no new resolution and therefore nothing subject to the five-day
`npmMinimalAgeGate`.

| Package | Range | Resolved | Why this package |
|---|---|---|---|
| `dompurify` | `^3.4.11` | 3.4.11 (root `resolutions` pin, already used by `mermaid`) | The OWASP-recommended allowlist sanitiser, with a maintained SVG profile, namespace checks and mXSS defences. |
| `jsdom` | `^26.1.0` | 26.1.0 (already resolved via `jest-environment-jsdom`) | DOMPurify needs a DOM on the server. jsdom is the server DOM DOMPurify documents and tests against (`happy-dom` is documented as unsafe for it). Its XML parser (saxes) fetches no DTDs or external entities. |
| `@types/jsdom` (dev) | `^21.1.7` | 21.1.7 | Types for the dynamic import. |

Why not an existing dependency: `sanitize-html` (already in core) is an HTML allowlist over
`htmlparser2` with no model of SVG namespaces, reference attributes or `<use>`; making it safe for
SVG means re-deriving DOMPurify's allowlist without its review history. A hand-rolled XML walker
has the same problem.

Server-only loading and bundle impact:

- Both packages are loaded with a dynamic `import()` inside `sanitizeVectorImage`, so a process
  that never takes the vector path never loads them.
- `jsdom` is on Next.js's built-in `serverExternalPackages` list, so it is never bundled.
- `dompurify` (28 KB minified, about 11 KB gzipped) can land only in server chunks that import
  `attachment-service.ts`.
- No client module imports `lib/vector-image.ts`; client code reaches only
  `lib/vector-image-record.ts`, which has no dependencies.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Sanitiser bypass yields script in a stored SVG | High | XSS on direct navigation | DOMPurify allowlist, reference and tokenised CSS policy, reject-on-material-removal, serving CSP `sandbox`/`default-src 'none'`, `nosniff`; `<img>` embedding disables script regardless | Low: requires a DOMPurify bypass *and* a CSP bypass |
| CSS parser differential hides an external fetch | Medium | privacy | CSS Syntax Level 3 tokenisation; escapes, bad strings, unterminated comments and malformed URLs refused; `default-src 'none'` at serve | Low |
| Event-loop stall (huge, deep or attribute-heavy files) | Medium | availability | byte, element, depth and attribute bounds; linear passes; DTD gate before parse; fresh jsdom window closed in `finally`; cost test | ~0.5 s worst case per upload |
| Render DoS via `<use>` amplification | Low | client | `<use>` expansion bound with cycle detection | Low |
| Legitimate logos rejected (editor cruft, CDATA styles) | Low | UX | editor namespaces, metadata, comments, DOCTYPE, CDATA styles and unknown presentation attributes are accepted; rejection codes name the problem | Exports with `foreignObject` fallbacks, web fonts or CSS escapes need re-exporting |
| Forged `vectorImage` record on an unsanitised row | Low | XSS | no endpoint writes arbitrary metadata keys; SHA-256 binding to stored bytes; CSP still applies | Requires DB write access |
| Config change exposes other paths to a weaker CSP | Low | headers | the exclusion matches only `/api/attachments/file/*` (verified with Next's route regex and a template test); the file route sets a CSP on every response, JSON errors included | — |
| `jsdom` weight | Low | memory/startup | lazy load; server-external | ~0.5 s first-call load per process |

## Migration & Backward Compatibility

The type changes are additive optional fields (BACKWARD_COMPATIBILITY.md § 2: "Optional fields may
be added freely"). With the flag absent — every existing caller — `createScoped` takes exactly the
code path it took before, and the generic route does not read the flag at all. Serving and
thumbnail URLs change only for rows that carry a `vectorImage` record, and no such row can exist
before this change. `ReadScopedAttachmentResult.contentSecurityPolicy` is optional, so third-party
`AttachmentService` implementations keep compiling.

Apps scaffolded from the template keep a working configuration: the file route already set
`default-src 'none'; sandbox`, so removing the config rule leaves that header unchanged on every
non-vector response. An app that copied the old `/api/attachments/file/:path*` rule into its own
`next.config.ts` keeps working but will not serve sanitised SVGs inline until it drops that rule's
CSP; `UPGRADE_NOTES.md` says so.

## Testing Strategy

Every bullet below is a test that exists.

- `lib/__tests__/vector-image.test.ts` (fixtures in `vector-image.fixtures.ts`)
  - **Hostile documents** — 41 fixtures. For each, `prepareVectorImageUpload` rejects with the
    listed code, and (except the four DTD fixtures, which are refused before parsing) the sanitised
    output no longer contains the payload:
    - `vector_image_unsafe_content` (22): `<script>`; XHTML-namespaced `<html:script>`; a script
      hidden inside a foreign-namespace wrapper; a script hidden inside `<metadata>`; `onload` on
      the root; `onclick` on a shape; `<foreignObject>` with HTML; `javascript:` link; `javascript:`
      link obfuscated with a character reference; non-raster `data:image/svg+xml` on `<image>`; a
      `data:image/png` URI on `<image>` whose bytes are not a PNG; an `<feImage>` `data:image/png`
      URI whose bytes are not a PNG; an `<feImage>` declaring `data:image/jpeg` while carrying PNG
      bytes; a CSS string left unterminated at a newline; a CSS string left unterminated at the end
      of the stylesheet; an escaped quote keeping a CSS string open; a CSS escape smuggling `url()`;
      `<set attributeName="href">`; `<animate attributeName="xlink:href">`; `<iframe>`; `<embed>`;
      `<object>`.
    - `vector_image_external_reference` (15): external `xlink:href` on `<image>`; external `href`
      on `<feImage>`; a comment opener hidden in a double-quoted CSS string before an external
      `url()`; the same before an external `@font-face`; the same inside a `style=""` attribute; the
      same in a single-quoted CSS string; a comment inside an unquoted `url()`; an external `url()`
      after a quoted `url()` containing a comment opener; external `url()` in a `<style>` element,
      in `style=""` and in a presentation attribute (`fill`); `@import`; `image-set()` with a bare
      string URL; `<use href="https://…">`; an `xml-stylesheet` processing instruction.
    - `vector_image_entity_declaration` (4): DOCTYPE with entity expansion (billion laughs); an
      external (`SYSTEM`) entity; a DOCTYPE whose double-quoted public id contains `>` ahead of an
      internal subset carrying `<!ATTLIST … onload …>`; the same with a single-quoted system id.
  - **Benign documents** that are stored, with the structures named here present in the output:
    - a combined logo — `<style>` block, linear and radial gradients, clip path, mask,
      in-document `<use>` via both `href` and `xlink:href`, embedded base64 PNG on `<image>`,
      `viewBox`/`preserveAspectRatio`, a `style=""` attribute and `<title>` — with no non-inert
      removal;
    - a mask-based logo (`<mask maskUnits="userSpaceOnUse">` applied with `mask="url(#…)"`) with
      no removal at all;
    - an `<feImage>` filter carrying an embedded PNG with a real PNG signature, composited with
      `<feComposite>` and applied with `filter="url(#…)"`, with no removal at all;
    - a design-tool export whose `<style type="text/css">` wraps its rules in CDATA, with no
      non-inert removal and every rule present; and CSS that arrives inside CDATA is still
      inspected (an external `url()` there is `vector_image_external_reference`);
    - an editor export (comment, plain `<!DOCTYPE svg PUBLIC …>`, Inkscape/Sodipodi/RDF metadata)
      where every removal is inert and the drawing survives.
  - **Idempotence**: sanitising the sanitised output of the combined, editor, mask and `<feImage>`
    documents removes nothing and yields identical bytes.
  - **Provenance**: the record carries `sanitizer`, the DOMPurify version, `policyVersion`, the
    SHA-256 of the stored bytes and `sanitizedAt`.
  - **Bounds and well-formedness**: over 1 MiB → `too_large`; a document under 1 MiB whose
    serialised form exceeds it → `too_large`; over 5,000 elements, nesting over 64, an element with
    more than 64 attributes, more than 25,000 attributes in total, exponential `<use>` expansion,
    and a `<use>` cycle → `too_complex`; modest `<use>` reuse is accepted; not well-formed XML, an
    HTML document, an `<svg>` root outside the SVG namespace, plain text, and non-UTF-8 bytes →
    `malformed`.
  - **Bounded cost**: five documents at the bounds (flat elements at the element and attribute
    bounds, paths with `url()` paint, elements at the per-element attribute bound, `<use>` at the
    element bound, nesting at the depth bound) each sanitise successfully in under 5 s (see § 4).
  - **`inspectVectorImageCss`**: a 15-case table — fragment and raster `data:` `url()`s, plain
    declarations and a commented `url(#…)` pass; external, protocol-relative and relative `url()`,
    `@import` (any case) and `-webkit-image-set()` are external; an unterminated `url(`, a CSS
    escape, `expression()` and `javascript:` inside `url()` are unsafe.
  - **`isVectorImageUploadCandidate`**: `.svg` accepted; extension-less accepted by declared or
    sniffed type; `.html`, `.xhtml`, `.xml`, `.htm` never accepted.
  - **`isTrustedVectorImage`**: matching digest trusted; tampered bytes, a missing record, null
    metadata, an unknown sanitiser, an unknown policy version and a non-SVG MIME type not trusted.
- `lib/__tests__/imageUrls.test.ts` — `resolveAttachmentThumbnailUrl` returns the file URL for a
  vector row, the image URL for a raster row, the unchanged image URL for an SVG row without a
  record, and the image URL for a non-SVG row carrying a record.
- `lib/__tests__/scoped-upload-service.test.ts` — without the flag an SVG is `active_content` with
  no quota or storage work; with the flag the sanitised document is stored, quota is reserved for
  the sanitised size, and the row has `image/svg+xml`, that size and the record whose digest matches
  the stored bytes; an extension-less SVG is named `.svg`; a hostile SVG is rejected with its
  `vector_image_*` code before any quota or storage work; an `.html` file with SVG content and an
  `.xhtml` file stay `active_content` with the flag; an executable extension and an oversized file
  are still refused with the flag; sanitised bytes that outgrow the caller's `maxBytes` are
  `max_upload_size` before any quota or storage work; a public partition is still refused when a
  private one is required.
- `lib/__tests__/attachment-service.test.ts` — `createScoped` forwards `allowVectorImage` as
  `false` unless the caller passes `true`; without opting in, an SVG is a 400 with no `code` and no
  quota or storage work; opting in (through the real upload service) stores the sanitised bytes and
  returns `image/svg+xml` with the sanitised size; a hostile SVG is a 400 with
  `code: vector_image_unsafe_content` before any quota reservation; each of the seven
  `vector_image_*` codes maps to its status with `code` in the body; `readScoped` serves a trusted
  vector row inline as `image/svg+xml` with the vector CSP, `forceDownload` still yields an
  `attachment` download, and a row with no record or with a digest mismatch stays a download with
  the default CSP.
- `api/__tests__/file.route.test.ts` — a trusted vector row is served as `image/svg+xml`, `inline`,
  with the vector CSP and `nosniff`; `?download=1` forces an `attachment` download; a row with no
  record or a digest mismatch is `application/octet-stream`, `attachment`, with the default CSP and
  `nosniff`; the route's JSON error responses carry the default CSP and `nosniff`.
- `api/__tests__/attachments.api.test.ts` — the generic route rejects a clean `.svg` logo as active
  content even when the form carries `allowVectorImage=true`; the `GET /api/attachments` list gives
  a vector row the file URL as `thumbnailUrl`.
- `api/__tests__/image.route.test.ts` — a sanitised vector row is refused with 400 and Sharp is
  never called.
- `packages/create-app/src/lib/template-security-headers.test.ts` — resolving the template's
  `headers()` with Next's own route regex: `/`, a backend page and the image route receive the app
  CSP (with the Stripe allowances); `/api/attachments/file/{id}` and its sub-paths receive no CSP
  from config; `nosniff` still applies to both. The app and template configs stay identical.
- `__integration__/TC-ATT-015.spec.ts` (Playwright, monorepo only) — stores a logo through the real
  `attachmentService.createScoped({ allowVectorImage: true })` in-process (no HTTP endpoint stores
  vector images), confirms the flag-off and hostile uploads are refused, then over HTTP:
  `GET /api/attachments/file/{id}` is `200`, `image/svg+xml`, `inline`, the vector CSP and
  `nosniff`, with the comment stripped and the stylesheet kept; `?download=1` is an `attachment`
  download under the strict CSP; after the record is removed in the database the same row is an
  `application/octet-stream` download under the strict CSP; a missing id is `404` under the strict
  CSP. Cleans up the attachment in `finally`.

Regression proofs run during implementation:

- **Upstream wiring restored:** every new upload and serving behaviour test fails.
- **DOMPurify pass disabled:** every script, handler and embedded-document fixture fails.
- **Reference/CSS post-pass and DTD gate disabled:** every external-reference, CSS, `data:` and DTD
  fixture fails.
- **Post-pass `href` check skipped for `<feImage>`:** all three `<feImage>` rejection fixtures fail.
- **Before the review fixes:** the CSS-string, CDATA, serialised-size and DOCTYPE-quote tests (16
  in `vector-image.test.ts`) and the `maxBytes` re-check failed.
- **Upstream `next.config.ts`:** the template header test fails, because the file route received
  `default-src 'none'; sandbox` from config.
- **`walk` reverted to copying live collections:** four of the five bounded-cost tests fail.

## Final Compliance Report

- Tenant scoping, `assertAttachmentScopeInvariant`, `checkAttachmentAccess`, the private-partition
  requirement of `createScoped`, quota accounting and the executable-extension check are untouched
  and still run on the vector path.
- No direct cross-module ORM relations; no new DI keys, events, ACL features or routes.
- User-facing rejection messages go through `attachments.errors.*` translation keys in all five
  locales.
- No database migration and no generated-file change.
- `apps/mercato/next.config.ts` and the create-app template stay in sync (`yarn template:sync`).

## Changelog

- 2026-10-06 — Review fixes:
  - CSS inspection rewritten as a CSS Syntax Level 3 tokenizer.
  - Linear DOM passes, plus element, attribute and serialised-size bounds sized from measurements;
    recorded the worker-thread decision.
  - CDATA stylesheets accepted; DOCTYPE gate made quote-aware and extended to every DTD
    declaration; the caller's `maxBytes` re-checked after sanitising.
  - The file route owns its CSP and the app CSP rule excludes it, so the vector CSP reaches the
    browser.
  - Thumbnails of vector rows use the file route; record reading split into the client-safe
    `lib/vector-image-record.ts`.
  - Integration test `TC-ATT-015` added.
  - The principal-less owner-scoped read moved to its own change, together with the consumer that
    needs it.
- 2026-10-06 — Testing Strategy rewritten to list exactly the tests that exist; added the mask and
  `<feImage>` raster cases, which surfaced that DOMPurify strips `data:` URIs on `<feImage>` (now
  `ADD_DATA_URI_TAGS: ['feimage']`, still bounded by the raster check).
- 2026-10-05 — Spec written and implemented: `allowVectorImage` on `createScoped`, DOMPurify/jsdom
  vector pipeline with reject-on-material-removal, provenance record bound by SHA-256, inline
  serving under a sandboxing CSP for trusted rows only.
