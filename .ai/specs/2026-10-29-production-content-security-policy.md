# Production Content Security Policy

## TLDR

Issue #7264 hardens one application boundary in both the main application and generated apps: production scripts and style elements require trusted sources or request nonces, and browser connections require explicit origins. Development tooling keeps its development-only exceptions.

## Problem Statement

Both Next configurations send unrestricted inline/eval script permissions and scheme-wide connection permissions in production. Removing them without request-time nonce handling breaks hydration and theme initialization.

## Proposed Solution

Use a shared policy builder, pass fresh nonces through both proxies and the root layouts, keep provider origin declarations in their provider packages, and document additional operator origins. Keep the attachment sandbox unchanged.

## Overview and Architecture

`shared/lib/security/contentSecurityPolicy` builds the static fallback policy and
the per-document policy from the same options. The proxies generate a 128-bit
cryptographic nonce, replacing client-provided nonce/CSP headers. They send the
same policy into Next rendering and back to the browser on platform, unknown
custom-domain, rewrite, and resolver-error responses. Existing custom-domain
pathname headers and error statuses remain intact.

The root layout reads `x-nonce` with `headers()`, making nonce-dependent pages
dynamic, and annotates the pre-hydration theme script. Next applies the nonce to
its own hydration scripts. `ContentSecurityPolicyProvider` carries the original
document nonce through client navigation and initializes the runtime nonce used
by Radix's style singleton. Brand styles, document pagination/presence style
elements, and all four TipTap editor entry points receive that nonce explicitly.

Only `NODE_ENV=development` permits eval and scheme-wide websocket connections.
Production and unset/test/preview environments use the restrictive policy.
Production `script-src-attr` is `none`. `style-src` requires self-hosted assets or
nonces; `style-src-attr` retains `unsafe-inline` for existing React/Radix/chart
attributes. Removing that separate exception would require a distinct styling
migration. Existing image/font permissions and attachment sandboxing stay intact.

Stripe.js/Link source declarations live in `gateway-stripe/contentSecurityPolicy`.
They cover Stripe.js script/frame hosts, API connections, 3DS hooks, and Link.
Tpay uses server-side requests and a top-level redirect, so needs no new browser
connection origin. Operators allow other browser SDKs, telemetry collectors,
and collaboration WebSockets explicitly. Provider credentials stay server-side.

## Data Models and API Contracts

No entities, persistence, auth/session semantics, API routes, response payloads,
ACL identifiers, or extension spots change. The HTTP CSP and internal `x-nonce`
header are the affected integration boundary. Nonces are random per request and
are never persisted or accepted from the client.

## Migration & Backward Compatibility

Adopt config, proxy, root-layout and AppProviders changes together in existing
apps. Generated apps receive all four. Configure space-separated explicit origins
using `OM_CSP_CONNECT_ORIGINS`, `OM_CSP_SCRIPT_ORIGINS`, `OM_CSP_STYLE_ORIGINS`, and
`OM_CSP_FRAME_ORIGINS` at build and runtime. HTTPS is accepted everywhere, WSS for
connections, and explicit HTTP/WS only in development. CSP keywords, scheme-only
sources, wildcards, paths, queries, fragments and credentials are rejected with
a generic internal configuration error. Provider-owned wildcard declarations
remain narrowly scoped to the documented provider's subdomains.

Module-authored inline assets need a trusted nonce, from `headers()` on the server
or `useContentSecurityPolicyNonce()` on the client. Optional provider props and
new helper import paths are additive; existing ThemeProvider APIs are unchanged.
Do not place nonce HTML in a public static cache or separate the HTML from its
matching response CSP. Upgrade instructions are in `UPGRADE_NOTES.md`.

## Research

- [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy):
  request/response nonce propagation and dynamic rendering.
- [Stripe integration security](https://docs.stripe.com/security/guide):
  Stripe.js, redirect challenges and Link source requirements.
- Installed `react-style-singleton`/`get-nonce` and TipTap source: runtime nonce
  and `injectNonce` hooks used by existing UI dependencies.

## Coverage and Validation

Unit cases exercise restrictive production/test/preview defaults, development
permissions, every operator-origin knob, deduplication, injection/invalid-origin
rejection, forged request headers and nonce uniqueness. UI cases verify stable
document nonces after navigation and dynamic brand stylesheet annotation.

Node integration cases execute both real config modules and both real proxies
with NextResponse, stubbing only custom-domain resolution. They verify all proxy
branches, request/response policy equality, preserved rewrites and attachment CSP.

`TC-AUTH-CSP-001` covers production `/login`, hydration-script nonces, reload nonce
rotation, blocked inline script/style injection and `/backend` using a newly
created account with cleanup. Required manual QA additionally covers a dialog's
scroll-lock stylesheet, document editor/preview and collaboration, Stripe Elements
including 3DS/Link, Tpay redirects, and a custom module using an additional origin.
No payment or provider connection is claimed verified without live evidence.

## Risks & Impact Review

| Severity | Failure | Mitigation | Residual risk |
|---|---|---|---|
| High | Hydration or theme initialization blocked | Match response/request nonces; explicit theme nonce; browser regression | Requires production app QA |
| High | Provider, telemetry or collaboration browser connection blocked | Provider-owned Stripe sources; explicit per-directive operator origins | Custom integrations must migrate |
| High | Nonced HTML cached with another response header | Dynamic root layout; prohibit separated/shared nonce caching | Operator/CDN overrides can still break it |
| Medium | Dynamic UI styles blocked or nonce rotates on SPA navigation | Stable client context, webpack nonce, brand and TipTap nonce wiring | Third-party modules must use nonce hooks |
| Medium | Origin text injects another CSP directive | Parse URLs and validate host/origin token, negative tests | Trusted source code controls provider source lists |
| Medium | Style attributes remain injectable | Narrow exception to `style-src-attr`; script attributes blocked | Style-attribute hardening remains out of scope |

## Phasing

One coordinated change: config and nonce consumers must ship together so neither
the monorepo nor scaffolded apps receive a policy their inline assets cannot use.

## Implementation Plan

1. Implement the shared policy and provider declaration with negative regression cases.
2. Wire configs, all proxy response branches, root layouts, and mirrored template files.
3. Verify headers, browser enforcement, template parity, and production hydration; record unavailable validation explicitly.

## Final Compliance Report

Root, shared, UI, create-app, auth and QA instructions were reviewed. The shared
builder has no domain imports or new dependencies; provider sources remain in the
provider package; app-shell edits are mirrored. Data scoping, commands, migrations,
optimistic locking and locale keys are unaffected. Validation and fresh review
results remain required before calling the implementation merge-ready.

## Changelog

- 2026-10-29: Defined and implemented the production policy, nonce plumbing,
  provider origin declaration, consumer compatibility and regression coverage.
