# Sales quote send refresh (#8137)

Status: Implemented; pending review and release.

## Problem and solution
The send action deliberately commits the quote before email delivery (#1415). The route must invalidate `sales.quote` CRUD caches after commit, before attempting email. The detail page must reload committed status, validity and `updatedAt` even if email delivery fails, close the dialog and explain that only delivery failed. Precommit errors and optimistic-lock conflicts retain their existing handling.

## Migration & Backward Compatibility
No database, route, ACL or successful response changes. HTTP 400 and its `error` string remain on email failure. The error body adds optional `quoteSent: true` only when delivery fails after the quote has been durably saved. Existing clients keep seeing an error; the updated detail page uses the optional field to refresh. No deprecation is required for this additive field.

## Coverage
- API unit regression: tenant/org/id-scoped invalidation on success and email failure; commit → invalidation → email ordering; committed failure marker.
- Detail page regression: successful and failed delivery both close the dialog, reload validity and version, and use the refreshed optimistic-lock header for another send.
- Existing email integration flow: warm the exact quote detail URL, send, re-read the same URL without cache busting, assert cache miss and fresh status/version/validity. Run with `ENABLE_CRUD_API_CACHE=true` to exercise cache invalidation.
- Separate send/edit integration regression: warm detail, send, read the same URL, then edit using the refreshed optimistic-lock version.
- Browser regression: resend uses the refreshed version after successful delivery and a simulated postcommit delivery failure; failure recovery also runs at a narrow viewport. Real SMTP failure is covered by the route unit test.
- Existing quote editing regression retains intentional token invalidation on edits.

## Risks and validation
Cache invalidation remains scoped to the quote tenant, organization and record through the shared helper. Sending and email delivery remain separate outcomes. Manual QA must exercise SMTP failure and CRUD cache enabled; no QA approval is implied by unit tests. Validation outcomes are recorded in the PR/run evidence.

## Changelog
- 2026-11-04: Documented the minimal correction and additive delivery-failure response for #8137.
