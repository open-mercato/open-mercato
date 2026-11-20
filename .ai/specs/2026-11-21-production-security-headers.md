# Production security headers

Issue: #10174

## TLDR

Production responses advertise HTTPS transport protection and both app configurations deny unused browser sensors. The main app and create-app template use the same policy. This corrects omitted headers without changing CSP or provider configuration.

## Overview and problem

The global Next.js header rule currently sets CSP, referrer, MIME and frame protections, but omits HSTS and Permissions-Policy. HTTPS browsers therefore receive no app-owned transport upgrade policy or explicit sensor restrictions.

## Proposed solution and architecture

Extend the existing `buildSecurityHeaders` global `/:path*` rule in both Next.js configurations:

- Production builds emit `Strict-Transport-Security: max-age=31536000; includeSubDomains` by default. `OM_HSTS_ENABLED=false` (also shared boolean false tokens) omits it.
- The development-server phase never emits HSTS, including when the dev runtime sets `NODE_ENV=production`.
- `Permissions-Policy` denies accelerometer, camera, geolocation, gyroscope, magnetometer, microphone and USB. It does not restrict payment or fullscreen, preserving the existing checkout/provider policy.
- Existing CSP, attachment sandbox and provider launch exceptions are unchanged. The global rule covers HTML and API routes, including routes with additional header rules.

No helper, dependency or cross-module architecture is added.

## Data models and API contracts

No database, API route, payload, event or ACL change. The new environment variable is a server-side build configuration, not a client variable. Additional response headers are the intended behavior change.

## Migration & Backward Compatibility

Set `OM_HSTS_ENABLED=false` **before building** for HTTP-only deployments or hosts whose subdomains cannot all serve HTTPS. Next.js records configured headers in the build manifest; changing only the running server environment does not update that manifest. Configure transport policy at the HTTPS reverse proxy if the app-owned header is disabled.

HSTS is learned only over HTTPS. It cannot protect a first visit made over HTTP; deploy an HTTPS redirect and secure cookies independently. Once learned, browsers retain it for one year. Omitting the header after a rebuild does not revoke cached policy. An operator needing revocation must serve `Strict-Transport-Security: max-age=0` over HTTPS and account for separately cached subdomain policies.

No public shape is removed and no emergency compatibility waiver is used. Custom modules using the denied sensors must account for the browser policy in their deployment configuration. This fix does not receive `automerge` because it changes app configuration.

## Risks & Impact Review

- **HTTP subdomains become unreachable after HTTPS policy learning (high):** `includeSubDomains` is deliberate; document HTTPS readiness and build-time opt-out. Residual browser cache outlives an opt-out.
- **Sensor-using custom modules stop prompting (medium):** the shipped application has no browser sensor call sites found in source inspection. Operators extending these features must configure an appropriate policy.
- **Payment regressions (medium):** do not add a payment directive; retain provider-owned Stripe origins and test existing CSP/sandbox behavior.

## Verification

Configuration regression tests execute both actual configs through the existing source loader across development/build/server phases, production/development environments and enabled/disabled boolean values. They assert header values, sensor denial and preservation of payment/fullscreen defaults. Existing tests retain Stripe origins, attachment sandbox and main/template parity.

Runtime QA should inspect `/backend`, an API route and the pay page on a production build, confirm the development omission and rebuild with the opt-out. Report unavailable live-app checks explicitly.

## Final Compliance Report

Uses the shared boolean parser, mirrors template configuration and env guidance, and preserves existing integration/CSP policies. No migrations, public removals or production dependencies.

## Changelog

- 2026-11-21: Added the production header policy, build-time opt-out and regression coverage.
