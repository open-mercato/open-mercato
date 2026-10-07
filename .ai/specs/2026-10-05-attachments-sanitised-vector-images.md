# Attachments — opt-in sanitised vector images for module-owned uploads

> Status: **Implemented, in review** · Date: 2026-10-05 · Scope: OSS
> Module: `packages/core/src/modules/attachments/`
> Related: [`2026-06-09-attachments-scope-invariant.md`](2026-06-09-attachments-scope-invariant.md),
> [`2026-10-06-attachments-owner-scoped-reads.md`](2026-10-06-attachments-owner-scoped-reads.md) (separate change; see § Merge order)

## TLDR

The attachments module rejects every SVG upload as active content. That is the right default for the
generic `POST /api/attachments` route, but it leaves a module that needs a vector asset — a company
logo, a brand mark on a printable document — with no way to store one.

This change adds one **optional, default-off** field, `allowVectorImage`, to
`CreateScopedAttachmentInput` (the public `attachmentService.createScoped()` contract) and to the
internal `ScopedAttachmentUploadInput`. When a module opts in and the file is an SVG, the server
checks it against structural bounds, removes only what never renders, runs DOMPurify (SVG profile)
on a `jsdom` DOM and applies a reference and CSS policy. It stores **only the sanitised bytes** and
records on the row that the file went through this path. The first finding that is not inert —
active content, an external reference — **refuses the file with an explicit error code**; nothing is
stored silently altered.

Serving changes only on the attachment file route, only for rows carrying that record *and* whose
stored bytes still hash to the recorded digest, and only when the request uses the canonical path:
they are returned as `image/svg+xml` with `inline` disposition under a sandboxing CSP that allows
the document's own styles and embedded rasters. `attachmentService.readScoped()`, every other
SVG-typed row, every existing caller, the generic upload route and the image (thumbnail) route
behave as before.

## Overview

| Surface | Before | After |
|---|---|---|
| `POST /api/attachments` (generic route) | SVG → 400 `activeContentBlocked` | unchanged |
| `attachmentService.createScoped()` without the flag | SVG → 400 | unchanged |
| `attachmentService.createScoped({ allowVectorImage: true })` | SVG → 400 | SVG sanitised and stored, or refused with a `vector_image_*` code |
| `attachmentService.readScoped()` on a sanitised vector row | `application/octet-stream`, `attachment` | unchanged — a module route cannot keep a sandboxing CSP (§ Serving) |
| `GET /api/attachments/file/{id}` on a sanitised vector row, canonical path | `application/octet-stream`, `attachment` | `image/svg+xml`, `inline` (unless `?download=1`) |
| the same row through a percent-encoded spelling of the path | `application/octet-stream`, `attachment` | unchanged — download |
| CSP on responses whose raw path starts with `/api/attachments/file/` (app `next.config.ts`) | `default-src 'none'; sandbox` | `default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox` |
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

**Intended first caller.** A module that stores a vector logo against one of its own records — an
organisation or company profile, a branded document template — calls
`createScoped({ …, allowVectorImage: true })` from its upload handler. No module in this repository
sets the flag yet. **Question for maintainers:** ship the option ahead of its first in-repo caller
(it is additive and default-off), or land it together with one?

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
   - otherwise run the vector pipeline (§ 3). A refusal maps to a `vector_image_*` code. The
     sanitised bytes are checked against `maxBytes` again (`max_upload_size`, 413), because
     serialisation can make a document larger (`>` in text becomes `&gt;`). On success the
     **sanitised** buffer replaces the input buffer for quota, storage and `fileSize`, the MIME type
     is fixed to `image/svg+xml`, an extension-less name gains `.svg`, and the row's
     `storageMetadata.vectorImage` records the pass (§ 5).
5. Partition lookup, `requirePrivatePartition`, quota reservation, storage, scope invariant and the
   persistence transaction — unchanged. OCR/text extraction is skipped for a sanitised vector image
   (an SVG is not an OCR input; LLM OCR would otherwise be invoked for any `image/*`).

### 3. Vector pipeline (`lib/vector-image.ts`)

`sanitizeVectorImage(buffer)` returns either the sanitised document plus the inert removals it made,
or a refusal code. `prepareVectorImageUpload(buffer)` adds the provenance record, and refuses again
on any non-inert removal as defence in depth.

**The principle: refuse at the first non-inert finding.** Removing hostile content and storing the
rest is never the goal. Any finding that is not inert refuses the whole file, so the pipeline stops
there instead of removing the rest. That keeps the result simple (store it unchanged in meaning, or
refuse it) and keeps every pass linear however much hostile content the input carries (§ 4).

**Pre-parse gates**

| Gate | Code |
|---|---|
| more than 1 MiB | `vector_image_too_large` (413) |
| not valid UTF-8 | `vector_image_malformed` |
| `<!ENTITY`, `<!ATTLIST`, `<!ELEMENT` or `<!NOTATION` anywhere, or a DOCTYPE with an internal subset | `vector_image_entity_declaration` |
| more than 4,000 `<` characters (markup) | `vector_image_too_complex` |

The DOCTYPE gate (`hasDtdDeclarations`) scans markup the way an XML parser reads it:
- comments, CDATA sections and processing instructions are skipped as units, so text inside them
  can neither open a fake DOCTYPE nor hide a real one;
- a DOCTYPE's quoted public and system identifiers are skipped as strings, so a `>` or `[` inside
  them can neither end the DOCTYPE early nor hide the subset;
- an unterminated DOCTYPE counts as having a subset.

A plain `<!DOCTYPE svg PUBLIC …>` (common in editor exports) is accepted. `<` can only start markup
in well-formed XML, so the markup count bounds the nodes the parser can build (at most twice the
count plus one) before any parsing happens.

**Parse and structure gates** (`DOMParser.parseFromString(text, 'image/svg+xml')` on a `jsdom` window)

| Bound | Value | Code |
|---|---|---|
| parse error, or root not `<svg>` in the SVG namespace | — | `vector_image_malformed` |
| nodes of every type (elements, text, comments, processing instructions, CDATA, the DOCTYPE), prolog included | 4,000 | `vector_image_too_complex` |
| elements | 2,000 | `vector_image_too_complex` |
| nesting depth | 64 | `vector_image_too_complex` |
| attributes on one element / in the document | 64 / 6,000 | `vector_image_too_complex` |
| rendered elements: every element once, plus every in-document reference's target again, recursively and weighted by how often it renders (§ 4); any reference cycle | 50,000 | `vector_image_too_complex` |

Real logos are typically 2–150 KB with tens to hundreds of paths and a handful of attributes per
element (a 1,000-path logo with `d`, `fill` and `id` uses 3,000 attributes). Every node type counts because jsdom removes a node in time linear in its preceding
siblings (`symbol-tree`'s `index()` after any change to the parent), so removal cost grows with
removed × kept nodes whatever their type (§ 4). The rendered-element bound weights every reference by
the size of what it renders: counting `<use>` elements alone accepted a large group reused 1,000
times through three levels of ten `<use>`s, and counting only `<use>` accepted eight nested patterns
of 200 rects each (200^8 rendered rects from 1,600 elements).

The bounds are sized from measurement (§ 4). Real exports stay well inside them: of the 230 SVG
files in this repository's dependencies, 224 are accepted, at most 267 ms each. The six refused
are SVG web fonts (`<font-face>` is outside DOMPurify's SVG profile), not logos.

**Sanitisation**

1. *Pre-pass* (`prepareForPurify`). One parent at a time, children are classified:
   - **removed as inert** (they never render): comments, processing instructions other than
     `xml-stylesheet`, `<metadata>`, elements outside the SVG/XHTML/MathML namespaces (editor data
     such as Inkscape/Sodipodi/RDF), attributes outside the null/XLink/XML/XMLNS namespaces, and
     every namespace declaration except the default SVG one and `xmlns:xlink`. The serialiser
     re-declares any prefix it needs, and DOMPurify allows no other declaration: Inkscape writes
     `xmlns:svg` in both of its SVG formats;
   - **rewritten**: XLink attributes under another prefix (`xmlns:x` + `x:href`) become `xlink:`, the
     only XLink spelling DOMPurify allows. `xmlns:xlink` is declared on the root when that happens,
     so the output uses the `xlink:` prefix rather than an invented one;
   - **turned into text**: every CDATA section. Design tools wrap stylesheets in CDATA; CDATA is
     text, and DOMPurify drops CDATA nodes;
   - **refusals**:
     - `active_content` for an XHTML or MathML element (outside a `foreignObject`, which DOMPurify
       refuses anyway, it never renders as intended and an XHTML `<script>` would execute);
     - `active_content` for a foreign or `<metadata>` wrapper that hides a rendering element;
     - `active_content` for a `<style>` holding anything but text and CDATA;
     - `external_reference` for an `xml-stylesheet` processing instruction;
     - a reference-bearing attribute (`href`, a CSS-parsed attribute, any value with `url(`) whose
       value DOMPurify would rewrite. DOMPurify re-sets every attribute value through JavaScript
       `trim()`, which also strips non-ASCII spaces that browsers keep: `href="\u3000#a"` is a
       relative URL to a browser but `#a` after DOMPurify. That is `external_reference` for
       `href`-like names and `active_content` otherwise. Elsewhere the trim changes nothing that
       renders or fetches.

   A parent with removals is rebuilt linearly (§ 4) rather than having nodes removed one by one.
   Nodes outside the root element (DOCTYPE, prolog comments and PIs) are classified but not
   removed: only the root is serialised.

   **Why `<style>` may hold only text.** Browsers build a `<style>` element's stylesheet from its
   direct Text children only and skip nested elements, comments and PIs. Text inside a nested
   element would otherwise let the inspected CSS differ from the applied CSS:
   `<style><g>/*</g>rect{fill:url(https://…)}<g>*/</g></style>` hides an external `url()` behind a
   comment that only exists in the concatenated text.
2. *DOMPurify* (`USE_PROFILES: { svg: true, svgFilters: true }`, `ADD_TAGS: ['use']`,
   `ADD_DATA_URI_TAGS: ['feimage']`, `ADD_ATTR: ['role']`, `KEEP_CONTENT: false`,
   `SANITIZE_DOM: false`, `RETURN_DOM`; fresh window per call).
   - It runs on an imported copy of the document, not `IN_PLACE`. A `beforeSanitizeElements` hook
     inspects DOMPurify's `removed` list as it grows, and throws at the first removal that is not
     inert. On the `IN_PLACE` path DOMPurify answers a throw by stripping the root through a live
     child list, which jsdom re-materialises on every removal (quadratic in the root's fan-out). On
     the copy path a throw is free.
   - DOMPurify's removal of its own `<body>` container, which the SVG profile disallows, is not
     content and is skipped.
   - `<use>` is added back because logos rely on in-document reuse; step 3 restricts every `href`
     to `#id`.
   - `feImage` joins the `data:` URI list; step 3 still limits those URIs to base64
     PNG/JPEG/GIF/WebP with a matching signature.
   - `KEEP_CONTENT: false`: nothing of a removed element is hoisted.
   - `SANITIZE_DOM: false`. DOMPurify's DOM-clobbering guard removes any `id` or `name` that
     matches a property of `document` or a form (`title`, `body`, `images`, `links`, `fonts`,
     `style`, `name`, `action`, …). It guards markup about to be inserted into a live HTML document,
     where such an id would shadow `document.title` for the page's own scripts. Clobbering needs a
     script that reads the clobbered property **in the same DOM** as the markup. The stored SVG never
     shares a DOM with a script:
     - it carries no script of its own (refused);
     - it is only ever rendered as its own document: through `<img>` (an isolated image document,
       no script, nothing shared with the page) or opened from the file route (its own document,
       under `sandbox`/`default-src 'none'`);
     - inserting its markup into a page DOM (`innerHTML`, inline `<svg>`) is forbidden by the
       attachments `AGENTS.md`, so no page script ever sees these ids.

     The guarantee rests on that "no script in the same DOM" rule, not on the sandboxing CSP alone:
     an `<img>`-embedded SVG gets no CSP from the file route and is still safe. With the guard on,
     `<linearGradient id="title">` lost its id and the stored logo silently lost its paint, and the
     accessible pattern `<title id="title">` + `aria-labelledby` broke.
   - `ADD_ATTR: ['role']`. `aria-*` is already allowed (`ALLOW_ARIA_ATTR`); `role` is not in the SVG
     profile. Neither can fetch or execute anything, and `role="img"` with `aria-labelledby` is how
     an SVG logo gets an accessible name.
   - DOMPurify's allowlist refuses `<script>`, `<foreignObject>`, `<iframe>`, `<embed>`, `<object>`,
     `<set>`, `<animate>`, every `on*` handler and `javascript:` URLs. Every DOMPurify removal is
     `active_content`, with two exceptions that are `inert`:
     - a namespace declaration;
     - an attribute DOMPurify does not know whose value carries no URL or scheme
       (`enable-background`, editor presentation hints) — unless its name is `on*`/`href`-like, or is
       one other content depends on: `id`, `name`, `class`, `attributeName`. DOMPurify drops an
       `attributeName` naming `href` from an otherwise allowed animation element, which must refuse
       rather than store a changed animation.
3. *Reference and CSS policy* on the sanitised copy (`findReferenceViolation`). It returns the first
   violation and removes nothing, because a violation refuses the document:
   - an element carrying both `href` and `xlink:href` with different values → `active_content`.
     Browsers follow SVG 2 `href` over `xlink:href`, so a decoy `xlink:href` must not be what the
     policy reads; when they agree, `href` is the one followed;
   - `href` / `xlink:href` must be an in-document fragment (`#id`) after stripping only what the URL
     parser strips (leading and trailing C0 controls and spaces). On `<image>`/`<feImage>` a
     `data:image/(png|jpeg|gif|webp);base64,…` URI is also accepted, and its decoded bytes must
     carry the matching raster signature. `javascript:`/`vbscript:`/other `data:` →
     `active_content`; anything else → `external_reference`;
   - a `<style>` is checked again for text-only children, and the CSS rule is applied to exactly the
     concatenation of its direct text children, which is what browsers apply;
   - `style` and the CSS-parsed presentation attributes that can carry a URL (`fill`, `stroke`,
     `clip-path`, `mask`, `filter`, `marker`, `marker-start`, `marker-mid`, `marker-end`, `cursor`),
     plus any other attribute whose value contains `url(`, are checked with the CSS rule;
   - an animation element whose `attributeName` targets `href`/`xlink:href` → `active_content`
     (a backstop in case a future DOMPurify allowlist admits it).
4. *Rendered size* (the bound above), then *serialise* the root with `XMLSerializer`; output over
   1 MiB is `vector_image_too_large`.

**CSS rule** (`inspectVectorImageCss`; DOMPurify does not parse CSS). The text is tokenised the way
CSS Syntax Level 3 does: comments, quoted strings, `url(` tokens, functions and at-keywords are
tokens. So a comment opener inside a string (`content:"/*"`) cannot hide the declarations after it,
and a comment inside an unquoted `url(` stays part of the URL. The result is:

- `active_content` for:
  - any backslash (escapes are the standard way to smuggle `\75 rl(` or `@\69mport` past a check,
    and logos need none);
  - a string ended by a newline or by the end of the text;
  - an unterminated comment or `url(` token;
  - a malformed unquoted URL (quote, `(`, or inner ASCII whitespace);
  - `expression()`, and the identifiers `behavior`, `-moz-binding`, `javascript`, `vbscript`;
- `external_reference` for:
  - `@import`;
  - any of `image()`, `image-set()`, `cross-fade()`, `element()`, `src()`, `attr()`, with or without
    a vendor prefix (these accept a bare string URL);
  - a `url()` whose target is neither `#id` nor an allowed raster `data:` URI. An unquoted target loses
    only the ASCII whitespace the tokenizer drops, and a quoted one loses nothing. So `url(\u3000#a)`
    and `url(" #a")` are relative URLs, as browsers read them;
- nothing otherwise.

The rule is deliberately stricter than a browser: anything that could make two CSS parsers disagree
is refused. The serving CSP is the second layer.

**Storage policy.** A document is stored only when every removal was inert. "Materially" therefore
means:
- any element other than comments, processing instructions, `<metadata>` and non-rendering
  foreign-namespace elements;
- any event handler, link, URL-bearing or style attribute;
- any non-text content in a `<style>`;
- any CSS the rule refuses.

Storing a logo whose gradient silently lost its `url(#…)` or whose web font was dropped is worse than
asking for a clean export.

### 4. Cost: linear passes, measured bounds, and why not a worker thread

Three sources of super-linear cost were found by profiling and are removed:

1. **Live collections.** jsdom's `children`/`childNodes` are proxies whose indexed access is linear.
   Every pass walks `firstChild`/`nextSibling` instead, and attributes are read with one proxy
   access per element.
2. **Node removal.** jsdom's `_remove` calls `symbol-tree`'s `index()`, which walks the node's
   preceding siblings after any change to the parent. Removing children of the Document
   additionally recomputes `activeElement` → `body` → `documentElement` over the Document's
   children. So per-node removal is quadratic in a wide parent. The fixes:
   - inert removals rebuild the parent: every child is removed from the front (always index 0,
     O(1)) and the kept ones are appended back;
   - the Document's children are not removed at all;
   - non-inert findings stop the pipeline instead of being removed;
   - DOMPurify runs on a copy, so its abort is O(1) (§ 3).
3. **Reference expansion.** One pre-order pass collects ids and stylesheets, and an iterative
   post-order over the reference graph computes each node's rendered size once. Nodes are the
   elements and one *bucket* per stylesheet selector key (an id, a class, a type, or "any
   element"). Edges are:
   - tree children and `<use>` targets, which pass on inheritance;
   - other `href`s (`feImage`, `textPath`, paint-server templates), once; `<a>` renders nothing;
   - `url(#…)` in an attribute or `style` attribute, weighted by the property: once for
     `clip-path`, `mask` and `filter` (not inherited); once per painted element below for inherited
     paint (`fill`, `stroke`, or any property the policy does not know); once per markable element
     for `marker-start`/`marker-end`; once per vertex (bounded by the length of `d`/`points`) for
     `marker-mid` and the `marker` shorthand;
   - one edge per bucket an element falls into. A bucket sums its targets' rendered sizes per
     weight once, so a stylesheet costs an element at most one edge per key it matches, however many
     rules feed the key.

   A selector is reduced to its subject compound's single most selective key, and every other
   constraint is dropped; a subject with no id, class or type, a rule nested in another rule, and
   any at-rule block other than a grouping rule (`@media`, `@supports`, `@layer`, `@container`,
   `@scope`) count as "any element". Dropping constraints only widens a match and the cascade is
   ignored, so the estimate can only exceed what a browser renders. A cycle anywhere in the graph is
   refused: a browser ignores a cyclic reference, but no benign export has one.

Measured on an Intel i5-1235U laptop (Windows 11, Node 24) while another agent's build was running
on the same machine. Each case was run seven times, each run in its own macrotask after a forced GC,
as separate uploads are. The table gives the median and the maximum. Run-to-run variance from the
concurrent build was large: the same shape measured a 173 ms maximum in one run and a 478 ms median in
another.

| Document (just under every bound unless stated) | Before these fixes | After: median / max |
|---|---|---|
| `<text>` filled with `a<!---->`, 128 KiB | 16,216 ms, accepted | refused by the markup bound in 3 ms |
| `<style>` filled with `<?a?>`, 64 KiB | 12,471 ms | refused by the markup bound in 2 ms |
| 1 MiB of flat `<!---->` | 2,482 ms, accepted | refused by the markup bound in 15 ms |
| 1 MiB of `a<g/>` | not measured (minutes) | refused by the markup bound in 52 ms |
| 1,000 rects × 3 levels of 10 `<use>` (1 million rendered) | accepted | refused by the rendered bound |
| text with a comment between every character | — | 201 / 247 ms |
| text with a PI between every character | — | 194 / 279 ms |
| text with a CDATA section between every character | — | 240 / 273 ms |
| flat comments / flat PIs / prolog comments | — | 130 / 223, 83 / 103, 52 / 71 ms |
| text alternating with allowed elements | — | 262 / 289 ms |
| text alternating with disallowed elements (refused) | — | 217 / 327 ms |
| text alternating with XHTML elements (refused) | — | 162 / 202 ms |
| text alternating with foreign editor elements | — | 156 / 236 ms |
| `<metadata>` holding foreign elements | — | 50 / 76 ms |
| elements at the element and attribute bounds | — | 328 / 412 ms |
| elements at the per-element attribute bound | — | 187 / 408 ms |
| editor-namespaced attributes at the bounds | — | 298 / 339 ms |
| rects with five kept presentation attributes at the attribute bound | — | 401 / 483 ms |
| paths with `url()` paint at the attribute bound | — | 426 / 715 ms |
| `<use>` at the element bound | — | 338 / 580 ms |
| `<use>` rendering just under the rendered bound | — | 187 / 255 ms |
| nesting at the depth bound | — | 283 / 368 ms |
| a 1 MiB stylesheet / 1 MiB of text | — | 243 / 410, 145 / 365 ms |
| whitespace-formatted rects at the node bound | — | 478 / 655 ms |
| stylesheet rules referencing 900 targets from every rect (fourth round) | — | 208 / 270 ms |
| a 1 MiB stylesheet of `url()` rules applied to an element (fourth round) | — | 167 / 200 ms |
| a stylesheet of compound selectors, 860 KiB, with 1,996 matching rects (fourth round) | — | 372 / 408 ms |
| inherited pattern paint over every element (fourth round) | — | 171 / 184 ms |
| eight nested patterns of 200 rects (fourth round, refused by the rendered bound) | accepted | 128 / 158 ms |
| a mid-path marker on a 1 MiB path (fourth round, refused by the rendered bound) | accepted | 202 / 288 ms |
| first call in a process (loads `jsdom` and `dompurify`) | — | 0.5–1.6 s, once |

Every median at the bounds is under 0.5 s. The maxima, up to 0.72 s, coincide with spikes from the
concurrent build. The previous bounds (3,000 elements, 15,000 attributes) measured 1.0–1.65 s on
attribute-heavy shapes under the same conditions, which is why they were lowered.

The fourth-round rows come from an A/B run: the third-round and fourth-round sanitisers alternated
on every shape in one process, seven runs each, while other processes kept the CPU about half busy.
Reference expansion adds 0–90 ms per shape. The largest additions are on stylesheet-heavy
documents (a 1 MiB stylesheet: 112 → 198 ms median), because the stylesheet is scanned once more to
index its references. The first bucket-less version gave every element one edge per stylesheet
reference and took 0.87–1.28 s on the 900-target shape, which is why buckets are graph nodes.

Benchmarks that keep calls inside one macrotask measure up to three times more and a growing heap:
jsdom tracks NodeIterators through `WeakRef`s, which keep their targets alive until the current job
ends. With one call per macrotask, as in a server, the heap stays flat (28–30 MB over 12 consecutive
calls on the largest shape).

The `bounded cost` test sanitises eighteen shapes at the bounds (the above plus the node floods) and
asserts each finishes under 5 s. That is more than ten times the measured worst case, so a slow CI
runner cannot make it flaky, while the pre-fix behaviour (2.5–27 s at sizes the bounds now refuse)
would fail it.

**Why sanitising stays on the request's event loop rather than in a worker thread:**
- **The cost is small and bounded.** It is under half a second at the median and under three
  quarters of a second at worst, on an upload path that is authenticated, module-initiated and rare
  (a logo per record).
- **A worker would cost more than it saves.** A worker per call reloads `jsdom` (0.5 s or more cold),
  which is more than the work it would move.
- **A pool is a lifecycle problem for a library.** Start, crash recovery and shutdown would live
  inside a library module.
- **Bundling breaks worker entries.** `@open-mercato/core` ships as `dist/` consumed through the
  app's Next.js server bundle, where a worker entry file must resolve at runtime — fragile under both
  webpack and Turbopack.

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

- `readScoped` is unchanged: an SVG, trusted or not, is an `application/octet-stream` `attachment`.
  Its caller is a module route, and a module route outside `/api/attachments/file/` gets the
  app-wide CSP from `next.config.ts`, which Next.js keeps over the route's own header (the
  documents attachment route's `default-src 'none'; sandbox` is already dropped that way). A hint
  telling such a route which CSP to send could never take effect, so there is none; inline SVG is
  exclusive to the file route.
- `GET /api/attachments/file/{id}` serves a trusted vector image inline only when the raw request
  pathname is exactly `/api/attachments/file/<encodeURIComponent(id)>`, and as a download on any
  other spelling (see *Header ownership* below). The route itself sets
  `default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox` for a trusted vector
  image and `default-src 'none'; sandbox` for its other responses, JSON errors included, plus
  `X-Content-Type-Options: nosniff`.
  - `style-src 'unsafe-inline'` lets the document's own `<style>` apply when opened directly.
  - `img-src data:` lets embedded rasters render.
  - `default-src 'none'` blocks every fetch.
  - `sandbox` disables script and gives the document an opaque origin.
- `GET /api/attachments/image/{id}` is unchanged: `canRenderInlineAttachment` still excludes
  `image/svg+xml`, so Sharp is never handed vector input.
- Thumbnails: `resolveAttachmentThumbnailUrl` (`lib/imageUrls.ts`) returns the file URL for a row
  with a vector record and the image-route URL otherwise. `GET /api/attachments/library` and
  `GET /api/attachments` use it, so the library grid and `AttachmentMetadataDialog` (which renders
  the list's `thumbnailUrl`) preview a sanitised SVG instead of a 400. Every other row keeps the URL
  it had.

**Header ownership in the Next.js app (`next.config.ts`).** Next.js 16 applies `headers()` rules
before the handler runs, and `send-response.js` appends a handler header only when
`res.getHeader(name)` is undefined (or the header is multi-valued). A config CSP for a path
therefore always wins over the route's. Some responses under the path never reach the route at all:
the API dispatcher's 404 for an unknown sub-path or method, and an unhandled throw.

So the config, not the route, decides the CSP the browser sees under `/api/attachments/file/`:
- the app-wide CSP rule uses the source `/:path((?!api/attachments/file/).*)`, which Next's
  build-time route regex (`buildCustomRoute`) matches for every path except the file path;
- a separate rule gives every response whose raw path starts with `/api/attachments/file/` the
  vector CSP above;
- `Referrer-Policy`, `X-Content-Type-Options` and `X-Frame-Options` stay global.

**Encoded spellings.** Next.js matches `headers()` sources against the raw, still percent-encoded
pathname (`resolve-routes.js`), while the `/api/[...slug]` dispatcher decodes segments before it
looks up the module route. `/api/attachments/%66ile/<id>`, `/api/attachments%2Ffile%2F<id>` and
`/api/%61ttachments/file/<id>` therefore reach the file route but match only the app-wide rule (its
`script-src 'self' 'unsafe-inline' 'unsafe-eval'`, no `sandbox`). Next.js rebuilds the request URL a route handler
sees from the original `initURL` (`base-server.js`, `next-server.js`), and WHATWG URL parsing keeps
percent-encoding, so the route can tell; `TC-ATT-015` checks it over real HTTP. The canonical-path check is the
single gate for inline SVG: a request whose raw path is exactly the canonical one is, by
construction, a path the vector rule matches. Dot segments (`/./`, `/x/../`, `%2e`) are resolved by
URL parsing before either side sees them, and an encoded id or an upper-case path segment fails the
equality and gets a download. Checked against Next 16.3.6's own matchers in the fourth review
round: of thirteen spellings, every one that serves inline SVG gets the vector CSP. The trade-off: an
app with a `basePath` serves sanitised SVG as a download, since its canonical path carries the
prefix.

**Why the vector CSP for every file response is safe.** On the file route only a trusted vector
image requested at the canonical path is served inline as a document. Everything else is a raster image served inline, or an
`application/octet-stream` `attachment` download, and no CSP directive affects either. JSON errors
are not rendered as documents. Every response keeps `default-src 'none'` and `sandbox`.

The route's own CSP values still apply wherever its handler is served without that config. The same
change is mirrored in `packages/create-app/template/next.config.ts` (`yarn template:sync` passes).

## Architecture

```
module ──createScoped({ allowVectorImage: true })──▶ DefaultAttachmentService
                                                     │ (assertAttachmentScopeInvariant, validateUpload)
                                                     ▼
                                         ScopedAttachmentUploadService.upload
                                                     │ executable ext ✗ · maxBytes ✗
                                                     │ active content? ── flag off ──▶ active_content 400
                                                     │        └─ flag on ─▶ lib/vector-image.ts
                                                     │             bytes · UTF-8 · DTD · markup
                                                     │             parse · nodes/elements/depth/attributes
                                                     │             pre-pass ─▶ DOMPurify (copy) ─▶ policy
                                                     │             rendered size · serialise · bytes
                                                     │             (first non-inert finding refuses)
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
| `ScopedAttachmentUploadInput.allowVectorImage?: boolean` | new optional field (DI service `attachmentScopedUploadService`) | ADDITIVE |
| `ScopedAttachmentUploadErrorCode` | new members `vector_image_*` (not exported from the module index) | ADDITIVE |
| `createScoped` error body | `{ error }` gains `code` for `vector_image_*` refusals only | ADDITIVE |
| `lib/imageUrls.ts` | new `resolveAttachmentThumbnailUrl` | ADDITIVE |
| `lib/vector-image.ts`, `lib/vector-image-record.ts` | new modules | ADDITIVE |
| `GET /api/attachments/file/{id}` | inline SVG only for trusted vector rows requested at the canonical path; the route sets a CSP on every response it produces | behaviour on rows that cannot exist before this change |
| `GET /api/attachments`, `GET /api/attachments/library` | `thumbnailUrl` of a vector row is the file URL | behaviour on rows that cannot exist before this change |
| `apps/mercato/next.config.ts`, template `next.config.ts` | app CSP rule excludes `/api/attachments/file/*`; that path gets the vector CSP from its own rule | config change, mirrored in the template |

Refusal codes and statuses:

| Code | Status | Meaning |
|---|---|---|
| `vector_image_too_large` | 413 | input or serialised output over 1 MiB |
| `vector_image_malformed` | 400 | not UTF-8, not well-formed XML, or root not `<svg>` in the SVG namespace |
| `vector_image_entity_declaration` | 400 | a DTD declaration or a DOCTYPE internal subset |
| `vector_image_too_complex` | 400 | markup, node, element, depth, attribute or rendered-element bound exceeded, or a reference cycle |
| `vector_image_unsafe_content` | 400 | script, handlers, `foreignObject`, embedded documents, XHTML/MathML elements, unsafe URLs, a `<style>` with non-text content, conflicting `href`s, unsafe CSS, or an `id`/`class` that DOMPurify's trim would change |
| `vector_image_external_reference` | 400 | an external link, `url()`, `@import` or stylesheet PI |
| `vector_image_sanitizer_unavailable` | 500 | `dompurify`/`jsdom` could not be loaded |

A sanitised document that fits the 1 MiB bound but exceeds the caller's `maxBytes` is
`max_upload_size` (413), the existing code.

## Dependencies (Ask First — requested in the PR)

Both production dependencies are already resolved in `yarn.lock`, so adding them to
`@open-mercato/core` adds no new resolution and nothing subject to the five-day
`npmMinimalAgeGate`.

| Package | Range | Resolved | Why this package |
|---|---|---|---|
| `dompurify` | `^3.4.11` | 3.4.11 (root `resolutions` pin, already used by `mermaid`) | The OWASP-recommended allowlist sanitiser, with a maintained SVG profile, namespace checks and mXSS defences. |
| `jsdom` | `^26.1.0` | 26.1.0 (already resolved via `jest-environment-jsdom`) | DOMPurify needs a DOM on the server. jsdom is the server DOM DOMPurify documents and tests against (`happy-dom` is documented as unsafe for it). Its XML parser (saxes) fetches no DTDs or external entities. |
| `@types/jsdom` (dev) | `^21.1.7` | 21.1.7 | Types for the dynamic import. |

**Why not an existing dependency.** `sanitize-html` (already in core) is an HTML allowlist over
`htmlparser2` with no model of SVG namespaces, reference attributes or `<use>`. Making it safe for
SVG means re-deriving DOMPurify's allowlist without its review history, and a hand-rolled XML walker
has the same problem.

**Server-only loading and bundle impact:**
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
| Sanitiser bypass yields script in a stored SVG | High | XSS on direct navigation | DOMPurify allowlist; refusal at the first non-inert finding; reference and tokenised CSS policy on exactly what browsers apply; serving CSP `sandbox`/`default-src 'none'`; `nosniff`; `<img>` embedding disables script regardless | Low: requires a DOMPurify bypass *and* a CSP bypass |
| Parser differential (CSS strings, `<style>` children, `href` precedence, DOCTYPE lexing) hides a reference | Medium | privacy | CSS Syntax Level 3 tokenisation; text-only `<style>`; conflicting `href`s refused; XML-aware DTD scan; `default-src 'none'` at serve | Low |
| Event-loop stall | Medium | availability | byte, markup, node, element, depth, attribute and rendered bounds; linear passes; first-finding stop; DOMPurify on a copy; cost test | under 0.5 s median and 0.72 s maximum per upload at the bounds, measured under concurrent load |
| Render DoS via reference amplification | Low | client | rendered-element bound over every in-document reference — `<use>`, `href`s, paint servers, clip paths, masks, filters, markers (per vertex for `marker-mid`), inherited paint and stylesheet rules — with cycle refusal | Pattern tiles repeat with the painted area, and filters cost per pixel, both of which a browser bounds by resolution |
| Sandbox lost on an encoded path or a module route | Medium | XSS defence in depth | inline SVG only from the file route at the canonical path; `readScoped` never inline; encoded spellings tested against Next's matchers and over HTTP | Requires a sanitiser bypass as well; an `<img>`-embedded SVG runs no script either way |
| Legitimate logos refused | Low | UX | editor namespaces and declarations (Inkscape's `xmlns:svg`), any XLink prefix, metadata, comments, DOCTYPE, CDATA, unknown presentation attributes, ids such as `title`, `role` and `aria-*` are accepted; codes name the problem; 224 of 230 SVGs in the dependency tree accepted (the rest are SVG fonts) | Exports with `foreignObject` fallbacks, web fonts, CSS escapes, or more than 2,000 elements or 6,000 attributes need re-exporting |
| Forged `vectorImage` record on an unsanitised row | Low | XSS | no endpoint writes arbitrary metadata keys; SHA-256 binding to stored bytes; CSP still applies | Requires DB write access |
| A non-SVG response under the file path gets the vector CSP's extra allowances | Low | headers | they only affect a document rendered inline, and the route renders only sanitised SVG inline; `default-src 'none'` and `sandbox` stay | — |
| `jsdom` weight | Low | memory/startup | lazy load; server-external; heap flat across requests (measured) | 0.5–1.6 s first-call load per process |

## Migration & Backward Compatibility

The type changes are additive optional fields (BACKWARD_COMPATIBILITY.md § 2: "Optional fields may
be added freely"). With the flag absent — every existing caller — `createScoped` takes exactly the
code path it took before, and the generic route does not read the flag at all. Serving and
thumbnail URLs change only for rows that carry a `vectorImage` record, and no such row can exist
before this change. `readScoped` returns exactly what it returned before, so third-party
`AttachmentService` implementations keep compiling and behaving.

Apps scaffolded from the template get the new header rules. An app that keeps the old
`/api/attachments/file/:path*` rule (`default-src 'none'; sandbox`) keeps every existing file
working, but a sanitised SVG's inline `<style>` and embedded rasters will not apply when the file is
opened directly. `UPGRADE_NOTES.md` says so.

## Merge order with the owner-scoped reads change

[`2026-10-06-attachments-owner-scoped-reads.md`](2026-10-06-attachments-owner-scoped-reads.md) is a
separate branch touching the same files. The intended order is **this change first**, then the
owner-scoped reads branch rebased onto it.

Verified with a trial merge of the owner-scoped reads branch into this one:

- `lib/attachment-service.ts` merges **automatically and correctly**. Since the fourth review round
  neither branch serves SVG inline from the service: `readScoped` and `readScopedForOwner` share the
  owner-scoped branch's `serveOwnedAttachment` helper, which returns any SVG, trusted or not, as an
  `application/octet-stream` download. Inline SVG lives only in `GET /api/attachments/file/{id}`.
  The rendition path keeps requiring an inline-safe raster (`canRenderInlineAttachment`), so an SVG
  never reaches Sharp.
- Five files conflict, all textually:
  - `.ai/specs/README.md` and `UPGRADE_NOTES.md`: keep both sides; they add different entries.
  - `apps/docs/docs/api/attachments.mdx` has two hunks: keep both module-code sections, and on the
    image route's line keep the vector branch's sentence and append "A stored image that cannot be
    decoded returns `422`."
  - `lib/__tests__/attachment-service.test.ts`: keep both appended `describe` blocks. Add the
    closing `})` of the vector block, which the two sides share in the conflict hunk, between them.
    The harness additions (`readBuffer`, identical on both sides, and the `imageRendition` mock)
    merge automatically.
  - `packages/core/src/modules/attachments/AGENTS.md` has two hunks: keep both `Always` blocks, and
    in the `Never` list keep the owner-scoped branch's `checkAttachmentAccess` exception and
    `readScopedForOwner` rule, then the vector rules.
- The merged tree (re-verified on 2026-10-07 after the fourth review round) passes:
  - core and checkout typecheck;
  - every attachments suite (562 tests), then `attachment-service.test.ts` again (67) after the
    owner-scoped branch's last test was added. The only failures are six in `storage.test.ts` and
    `localDriver.test.ts`, suites neither branch touches, which fail on the Windows machine used
    because they expect POSIX absolute paths;
  - checkout's pay route suites (47).

After both merge, `readScopedForOwner` returns a sanitised SVG as a download, like `readScoped`; a
test on the owner-scoped branch pins it, and passes in the merged tree. The logo route is unaffected:
it always asks for a raster rendition and refuses any non-raster content type, which a test pins.

## Testing Strategy

Every bullet below is a test that exists.

- `lib/__tests__/vector-image.test.ts` (fixtures in `vector-image.fixtures.ts`)
  - **Hostile documents** — 74 fixtures. For each, `sanitizeVectorImage` refuses with the listed
    code and returns no document, and `prepareVectorImageUpload` refuses with the same code:
    - `vector_image_unsafe_content` (39):
      - script and handlers: `<script>`; XHTML-namespaced `<html:script>`; a script hidden inside
        a foreign-namespace wrapper; a script hidden inside `<metadata>`; `onload` on the root;
        `onclick` on a shape;
      - embedded and animated content: `<foreignObject>` with HTML; `<iframe>`; `<embed>`;
        `<object>`; `<set attributeName="href">`; `<animate attributeName="xlink:href">`;
        `<animateTransform attributeName="href">` (DOMPurify drops the `attributeName`);
        `<animateMotion attributeName="xlink:href">`; a paint attribute starting with U+3000 that
        DOMPurify would trim away;
      - identity DOMPurify would change: a `class` starting with U+3000; an `id` starting with a
        no-break space; an `id` starting with an ASCII space;
      - unsafe URLs: a `javascript:` link, plain and obfuscated with a character reference;
        non-raster `data:image/svg+xml` on `<image>`; a `data:image/png` URI on `<image>` whose
        bytes are not a PNG; an `<feImage>` `data:image/png` URI whose bytes are not a PNG; an
        `<feImage>` declaring `data:image/jpeg` while carrying PNG bytes;
      - unsafe CSS: a CSS string left unterminated at a newline, and at the end of the stylesheet;
        an escaped quote keeping a CSS string open; a CSS escape smuggling `url()`;
      - `<style>` with non-text children: a stylesheet hidden by a comment split across nested
        `<g>`, `<title>`, `<desc>` and `<tspan>` elements; a stylesheet hidden by a CSS string
        split across nested elements; `@import` hidden by a split comment; `url(` split by an XML
        comment, and by a processing instruction; CDATA and an element mixed;
      - `href` decoys: a `<use>` chain whose `href` differs from an `xlink:href` decoy; a `<use>`
        self-cycle hidden behind an `xlink:href` decoy.
    - `vector_image_external_reference` (18):
      - links: external `xlink:href` on `<image>`; external `href` on `<feImage>`;
        `<use href="https://…">`; an `href` whose target starts with U+3000;
      - whitespace that browsers keep: `fill="url(\u3000#a)"`; `url(" #a")` in a stylesheet;
      - CSS comment and string tricks: a comment opener hidden in a double-quoted CSS string before
        an external `url()`, and before an external `@font-face`; the same in a `style=""`
        attribute; the same in a single-quoted CSS string; a comment inside an unquoted `url()`; an
        external `url()` after a quoted `url()` containing a comment opener;
      - plain external CSS: external `url()` in a `<style>` element, in `style=""` and in a
        presentation attribute (`fill`); `@import`; `image-set()` with a bare string URL;
      - an `xml-stylesheet` processing instruction.
    - `vector_image_entity_declaration` (5): billion laughs; an external (`SYSTEM`) entity; a
      DOCTYPE whose double-quoted public id contains `>` ahead of an internal subset carrying
      `<!ATTLIST … onload …>`; the same with a single-quoted system id; a DOCTYPE quote opened
      inside a comment ahead of a real internal subset.
    - `vector_image_too_complex` (12), each inside every other bound, so the rendered-element bound
      is what refuses it:
      - a 1,000-rect group amplified by three levels of ten `<use>`, through `href` and through
        `xlink:href`;
      - eight nested levels of 200 rects (about 200^8 rendered) through patterns referenced by a
        `fill` attribute, a `style` attribute, stylesheet classes, stylesheet classes inside
        `@media`, and `fill` inherited from a group; through masks; through clip paths; and through
        filters whose `feImage` renders the level below;
      - a 1,000-rect marker repeated by `marker-mid` at every vertex of a 20,000-segment path, and
        the same marker applied by a stylesheet `marker` shorthand.
  - **Benign documents** that are stored, with the structures named here present in the output:
    - a combined logo: `<style>` block, linear and radial gradients, clip path, mask, in-document
      `<use>` via both `href` and `xlink:href`, embedded base64 PNG on `<image>`,
      `viewBox`/`preserveAspectRatio`, a `style=""` attribute and `<title>`;
    - a mask-based logo;
    - an `<feImage>` filter carrying an embedded PNG with a real PNG signature;
    - a design-tool export with a CDATA-wrapped `<style>` (and CSS inside CDATA is still
      inspected);
    - an editor export (comment, plain DOCTYPE, Inkscape/Sodipodi/RDF metadata);
    - a `<style>` that mentions a DOCTYPE inside a CSS comment in CDATA;
    - CDATA text outside `<style>`, kept as text;
    - `href` and `xlink:href` that agree;
    - an Inkscape 1.3.2 "Inkscape SVG" export (`xmlns:svg`, `xmlns:inkscape`, `xmlns:sodipodi`,
      `sodipodi:namedview`, `inkscape:*` attributes) and an Inkscape "Plain SVG" export
      (`xmlns:svg`). Only editor data is dropped and the drawing is kept. The fixtures reproduce
      Inkscape 1.3.2's standard root element and named view, as no Inkscape export exists in this
      repository;
    - an XLink reference under the prefix `x` (`xmlns:x` + `x:href`), stored as `xlink:href`;
    - ids that clash with document properties (`title`, `body`, `images`, `links`, `fonts`,
      `style`, `name`, `action`) together with the `url(#…)` references to them;
    - the accessible-name pattern: `role="img"`, `aria-labelledby` and the `<title id>`/`<desc id>`
      it points at;
    - an unquoted `url( #a )` with ASCII whitespace;
    - a non-ASCII space at the edge of an attribute that carries no reference;
    - a design-tool export in the Illustrator style: classed gradient fill, a clip path applied by a
      class through `<use>`, a pattern swatch filling 40 paths by class, an arrow `marker-end`, and a
      `class` with ASCII spaces at its edges.

    A stored document reports only inert removals.
  - **Idempotence**: sanitising the sanitised output of the four main benign documents removes
    nothing and yields identical bytes.
  - **Provenance**: the record carries `sanitizer`, the DOMPurify version, `policyVersion`, the
    SHA-256 of the stored bytes and `sanitizedAt`.
  - **Bounds and well-formedness**:
    - `too_large`: over 1 MiB, and a document under 1 MiB whose serialised form exceeds it;
    - `too_complex`: more markup than the markup bound (refused before parsing); more nodes than the
      node bound (text and comments); more elements; nesting over 64; an element with more than 64
      attributes; more than 6,000 attributes in total; exponential `<use>` expansion; a `<use>`
      cycle;
    - accepted: modest `<use>` reuse;
    - `malformed`: not well-formed XML, an HTML document, an `<svg>` root outside the SVG namespace,
      plain text, and non-UTF-8 bytes.
  - **Bounded cost**: eighteen documents at the bounds sanitise (or are refused) in under 5 s each
    (§ 4):
    - elements at the element and attribute bounds; paths with `url()` paint; rects with five kept
      presentation attributes; elements at the per-element attribute bound; editor-namespaced
      attributes;
    - `<use>` at the element bound; nesting at the depth bound;
    - text interleaved with comments, with PIs and with CDATA; flat comments; flat PIs; prolog
      comments;
    - text interleaved with disallowed elements (refused) and with foreign editor elements;
    - 900 stylesheet rules referencing 900 targets from every rect; a 1 MiB stylesheet of `url()`
      rules;
    - whitespace-formatted elements at the node bound.
  - **`inspectVectorImageCss`**: a 17-case table:
    - pass: fragment and raster `data:` `url()`s, plain declarations, a commented `url(#…)`;
    - external: external, protocol-relative and relative `url()`, `@import` (any case),
      `-webkit-image-set()`, `url(\u3000#a)`, `url(" #a")`;
    - unsafe: an unterminated `url(`, a CSS escape, `expression()`, `javascript:` inside `url()`.
  - **`isVectorImageUploadCandidate`**: `.svg` accepted; extension-less accepted by declared or
    sniffed type; `.html`, `.xhtml`, `.xml`, `.htm` never accepted.
  - **`isTrustedVectorImage`**: matching digest trusted; tampered bytes, a missing record, null
    metadata, an unknown sanitiser, an unknown policy version and a non-SVG MIME type not trusted.
- `lib/__tests__/imageUrls.test.ts` — `resolveAttachmentThumbnailUrl` returns:
  - the file URL for a vector row;
  - the image URL for a raster row;
  - the unchanged image URL for an SVG row without a record;
  - the image URL for a non-SVG row carrying a record.
- `lib/__tests__/scoped-upload-service.test.ts`:
  - without the flag, an SVG is `active_content` with no quota or storage work;
  - with the flag, the sanitised document is stored, quota is reserved for the sanitised size, and
    the row has `image/svg+xml`, that size and a record whose digest matches the stored bytes;
  - an extension-less SVG is named `.svg`;
  - a hostile SVG is refused with its code before any quota or storage work;
  - `.html`/`.xhtml` stay `active_content` with the flag;
  - an executable extension and an oversized file are still refused;
  - sanitised bytes that outgrow the caller's `maxBytes` are `max_upload_size` before any quota or
    storage work;
  - a public partition is still refused when a private one is required.
- `lib/__tests__/attachment-service.test.ts`:
  - `createScoped` forwards `allowVectorImage` as `false` unless the caller passes `true`;
  - without opting in, an SVG is a 400 with no `code` and no quota or storage work;
  - opting in through the real upload service stores the sanitised bytes and returns
    `image/svg+xml` with the sanitised size;
  - a hostile SVG is a 400 with `code: vector_image_unsafe_content` before any quota reservation;
  - each of the seven `vector_image_*` codes maps to its status with `code` in the body;
  - `readScoped` returns a trusted vector row, a row with no record and a row whose digest does not
    match as an `application/octet-stream` `attachment`, with no CSP field on the result.
- `api/__tests__/file.route.test.ts`:
  - a trusted vector row at the canonical path is `image/svg+xml`, `inline`, with the vector CSP
    and `nosniff`;
  - the same row requested as `/api/attachments/%66ile/{id}`, `/api/attachments%2Ffile%2F{id}`,
    `/api/%61ttachments/file/{id}` or with a percent-encoded id is an `application/octet-stream`
    `attachment` with the default CSP;
  - `?download=1` forces a download;
  - a row with no record or a digest mismatch is an `application/octet-stream` `attachment` with
    the default CSP and `nosniff`;
  - JSON errors carry the default CSP and `nosniff`.
- `api/__tests__/attachments.api.test.ts`:
  - the generic route rejects a clean `.svg` logo even when the form carries `allowVectorImage=true`;
  - the `GET /api/attachments` list gives a vector row the file URL as `thumbnailUrl`.
- `api/__tests__/image.route.test.ts` — a sanitised vector row is refused with 400 and Sharp is
  never called.
- `packages/create-app/src/lib/template-security-headers.test.ts`, resolving the template's
  `headers()` with Next's own route regex:
  - `/`, a backend page and the image route receive the app CSP (with the Stripe allowances);
  - `/api/attachments/file/{id}`, a sub-path, and the bare prefix receive the vector CSP from
    config;
  - `/api/attachments/%66ile/abc` and `/api/%61ttachments/file/abc` do not: header sources match
    the undecoded path, which is why the route gates inline SVG itself;
  - `nosniff` applies to both kinds of path;
  - the app and template configs stay identical.
- `__integration__/TC-ATT-015.spec.ts` (Playwright, monorepo only). It stores a logo in-process
  through the real `attachmentService.createScoped({ allowVectorImage: true })`, since no HTTP
  endpoint stores vector images, and confirms the flag-off and hostile uploads are refused. Then,
  over HTTP:
  - `GET /api/attachments/file/{id}` is `200`, `image/svg+xml`, `inline`, the vector CSP and
    `nosniff`, with the comment stripped and the stylesheet kept;
  - the three encoded spellings of the path never return inline SVG;
  - `?download=1` is an `attachment` download;
  - after the record is removed in the database, the row is an `application/octet-stream`
    download;
  - a missing id is `404`, and so is an unknown sub-path answered by the dispatcher;
  - every one of these responses carries the file-path CSP.

  It cleans up in `finally`.

Regression proofs run during implementation:

- **Upstream wiring restored:** every new upload and serving behaviour test fails.
- **DOMPurify pass disabled / reference policy and DTD gate disabled / `<feImage>` href check
  skipped:** the corresponding fixtures fail.
- **First review round, before its fixes:** the CSS-string, CDATA, serialised-size and
  DOCTYPE-quote tests (16) and the `maxBytes` re-check failed; the template header test failed on
  the old config.
- **Second review round, against the round-one sanitiser:** 68 of 179 `vector-image.test.ts`
  tests failed.
  - Twelve of them are uploads the old code accepted: seven `<style>`-nesting cases, four `<use>`
    amplification and decoy cases, and the comment-hidden DOCTYPE.
  - The rest are the change from stripping to refusing.
  - The template header test failed on the round-one config (`actual: undefined`).
- **A red-team probe** (68 inputs: every class above, the floods at 128 KiB–1 MiB, the third-round
  cases, and 22 fourth-round cases — nested patterns through attributes, `style`, classes, `@media`,
  `*|rect`, `:is()`, attribute selectors, descendant selectors with comments, CSS nesting and
  `@keyframes`; masks, clip paths, `feImage` filters, a pattern template `href` and stylesheet
  `marker` shorthands; trimmed `id`/`class`; two benign documents) refused or accepted each as
  expected, in at most 356 ms per input outside the first-load call.
- **Serving red-team**: thirteen spellings of the file path run through Next 16.3.6's own header
  matcher (`getPathMatch`) and dispatcher matcher (`getRouteRegex('/api/[...slug]')`) together with
  the route's canonical-path check. Every spelling that serves inline SVG gets the vector CSP; the
  three encoded spellings found by the review get a download.

## Final Compliance Report

- Tenant scoping, `assertAttachmentScopeInvariant`, `checkAttachmentAccess`, the private-partition
  requirement of `createScoped`, quota accounting and the executable-extension check are untouched
  and still run on the vector path.
- No direct cross-module ORM relations; no new DI keys, events, ACL features or routes.
- User-facing refusal messages go through `attachments.errors.*` translation keys in all five
  locales.
- No database migration and no generated-file change.
- `apps/mercato/next.config.ts` and the create-app template stay in sync (`yarn template:sync`).

## Changelog

- 2026-10-07 — Fourth review round:
  - Merge order re-verified with a trial merge.
  - The file route serves sanitised SVG inline only at the canonical path; percent-encoded
    spellings, which reach the route without the sandboxing header rule, get a download.
  - `readScoped` no longer serves SVG inline, and `ReadScopedAttachmentResult.contentSecurityPolicy`
    is removed: a module route cannot keep its own CSP over the app-wide one.
  - The `SANITIZE_DOM` justification rests on "no script in the same DOM", backed by a new `Never`
    rule against injecting stored SVG into a page.
  - The rendered-size bound covers every in-document reference (paint servers, clip paths, masks,
    filters, markers, inherited paint, stylesheet rules), not only `<use>`.
  - An `id` or `class` that DOMPurify's trim would change is refused.
  - The unreachable animation-target check is removed: DOMPurify refuses `<set>` and `<animate>`,
    and removes an `attributeName` naming `href`, which refuses the document first.
  - Dependency corpus unchanged: 224 of 230 accepted (the rest SVG fonts), at most 217 ms.
- 2026-10-07 — Third review round:
  - Merge order re-verified with a trial merge.
  - Inkscape exports accepted: every namespace declaration except the default and `xmlns:xlink` is
    dropped as inert, and other XLink prefixes are rewritten as `xlink:`.
  - `SANITIZE_DOM: false` (justified in § 3) and `role` allowed, so ids such as `title` and the
    accessible-name pattern survive; DOMPurify removals of `id`, `name`, `class` or
    `attributeName` refuse.
  - References are trimmed only as their own syntax trims; attributes DOMPurify would trim
    differently from a browser are refused.
  - Bounds lowered to 2,000 elements, 4,000 nodes and markup, and 6,000 attributes after
    re-measuring under load (§ 4).
  - Dependency corpus: 224 of 230 accepted, the rest SVG fonts.
- 2026-10-06 — Second review round:
  - `<style>` restricted to text children and inspected as browsers read it.
  - Every node type counted, plus a pre-parse markup bound and lower measured bounds.
  - The pipeline refuses at the first non-inert finding, rebuilds parents instead of removing nodes
    one by one, and runs DOMPurify on a copy.
  - `<use>` bounded by rendered size, `href` preferred over `xlink:href`, and conflicting values
    refused.
  - XML-aware DOCTYPE scan.
  - The file-path CSP moved into a config rule that covers the dispatcher's responses.
  - The intended first caller and the merge order are stated.
- 2026-10-06 — First review round:
  - CSS tokenizer; linear passes and measured bounds; worker-thread decision.
  - CDATA stylesheets; quote-aware DOCTYPE gate; `maxBytes` re-check.
  - CSP ownership for the file route; thumbnails via the file route; client-safe record module.
  - TC-ATT-015.
  - Owner-scoped reads moved to their own change.
- 2026-10-06 — Testing Strategy aligned with the tests; mask and `<feImage>` raster cases added
  (`ADD_DATA_URI_TAGS: ['feimage']`).
- 2026-10-05 — Spec written and implemented: `allowVectorImage` on `createScoped`, DOMPurify/jsdom
  vector pipeline, provenance record bound by SHA-256, inline serving under a sandboxing CSP for
  trusted rows only.
