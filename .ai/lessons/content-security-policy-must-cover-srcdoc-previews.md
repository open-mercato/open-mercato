---
title: "Content Security Policy must cover srcDoc previews"
modules: ["ecommerce","ui","shared","documents"]
areas: ["backend-ui","testing","integration"]
topics: ["content-security-policy","srcdoc","nonces","security-regression","configured-origins"]
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

Audit existing service endpoint configuration as well. Reuse its owning package's
validator and production/test gates, then allow only its parsed origin. Requiring
a second allowlist setting for an already configured collaboration endpoint can
silently break that supported connection, including explicit loopback CI flows.

Classify any cross-package policy regression test in `scripts/repo-wide-guards.mjs`.
The create-app suite already runs unfiltered in its parity step, so register that
existing coverage instead of leaving the new audit unclassified. If an endpoint
passes its legacy URL validator but cannot safely become a CSP source, emit a
configuration warning without logging the endpoint, credentials or query string.

Evidence: issue #7264 / PR #8220; `StoreBrandingPreview.tsx` and
`buildBrandingPreviewDocument` in the ecommerce module; failing-before/passing-after
helper and component tests; `TC-ECOM-CSP-001.spec.ts`; production Next.js/Chromium
probe showing the preview background, margin and primary token survive enforcement.
