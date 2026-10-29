---
title: "Content Security Policy must cover srcDoc previews"
modules: ["ecommerce","ui","shared"]
areas: ["backend-ui","testing"]
topics: ["content-security-policy","srcdoc","nonces","security-regression"]
---

# Content Security Policy must cover srcDoc previews

An iframe rendered with `srcDoc` inherits its parent's CSP even when it has an
opaque sandbox origin. An iframe meta policy adds restrictions; it cannot relax
the inherited policy. Tightening application `style-src` to nonce-based sources
therefore blocks an existing preview's unnonced styles, despite its own
`style-src 'unsafe-inline'` meta tag.

When hardening CSP, inspect generated HTML and iframe previews as well as JSX and
dynamic style insertion. Carry the original document nonce into trusted preview
styles and its meta policy. Validate nonce syntax before interpolating it into
HTML, preserve legacy helper callers with an optional argument, and verify actual
computed styles in a browser under the parent's enforcing CSP.

Exercise emitted headers in existing regression suites instead of parsing how a
configuration string is constructed. Root-layout tests also need a scoped request
header mock once nonce propagation reads Next's `headers()` API.

Evidence: issue #7264 / PR #8220; `StoreBrandingPreview.tsx` and
`buildBrandingPreviewDocument` in the ecommerce module; failing-before/passing-after
helper and component tests; `TC-ECOM-CSP-001.spec.ts`; production Next.js/Chromium
probe showing the preview background, margin and primary token survive enforcement.
