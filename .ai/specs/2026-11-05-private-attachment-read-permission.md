# Private attachment read permission (#8760)

Status: Implemented; original HTTP scenarios passed in CI. Current-head CI, manual QA and named human maintainer security-waiver approval remain before merge.

## TLDR

Require current `attachments.view` for private attachment file/download/image bytes. Preserve public partitions, scope isolation and additional owner restrictions.

## Overview

The list API already requires the module read feature. The file and image routes currently permit same-scope authenticated users without it when no owner policy applies.

## Problem Statement

Knowing a private attachment ID lets an underprivileged same-scope principal retrieve its content. This is a source-confirmed capability bypass; no anonymous or cross-tenant exploit is claimed.

## Proposed Solution

Both byte routes opt into an additive `requirePrivateReadFeature` runner option. For their private `read` and `render` actions, resolve the current server subject even without owner resolvers and authorize `attachments.view` through shared `authorizeFeatures`. Current effective features and the live superadmin flag are authoritative; token grants are not. Owner resolvers remain additional restrictions and cannot be bypassed by this grant.

## Architecture

Keep the immutable authentication/scope baseline first in `evaluateAttachmentAccess`. Preserve required-provider validation, bounded subject projection and live-scope recheck. Check the private read capability before callbacks and before callers reach storage or thumbnail caches. Mark feature-gated private byte reads as protected so successful original/download/image responses use `Cache-Control: private, no-store`, including fresh renders and warm thumbnail hits. Unadopted public partitions retain the existing early return, including anonymous global public access. Metadata, upload, delete, reassign and export policies do not gain a new generic capability requirement.

## Data Models

No schema, stored-byte, partition, migration or entity changes.

## API Contracts

`GET /api/attachments/file/:id` (inline and `?download=1`) and `GET /api/attachments/image/:id/...` return the existing localized 403 shape when the private read feature is missing. URLs, success payloads, public caching and supported superadmin behavior remain. Existing service callers retain their current owner-policy contract; the new runner option is additive and explicitly enabled by both byte routes.

## Integration Coverage

- Runner tests: no read grant, forged token grants, exact/module/global wildcard grants, live/revoked superadmin, global private, public bypass, missing context, scope and owner denial.
- Route API tests: original/forced download/inline and warm thumbnail denied before cache/storage; authorized bytes use `private, no-store` on original/download/fresh-image/warm-thumbnail responses; public behavior retained.
- Self-contained `TC-ATT-028`: create a fresh role/users, grant distinct ACLs before login, upload a synthetic PNG into a private partition; verify all three byte paths for denied, exact and wildcard users and clean up fixtures. Existing API regressions retain scope and owner-provider coverage.
- No UI code changes. Manual QA should open a private image/download with a reader and repeat with a same-org user lacking `attachments.view`.

## Migration & Backward Compatibility

Surface: STABLE attachment HTTP authorization behavior. Previously accepted private byte reads without `attachments.view` stop working. Keeping that permissive branch during a bridge release would preserve the vulnerability; no compatibility flag or fallback retains it. This is the narrow security tightening proposed under the Emergency Security Exception; approval is not asserted by this implementation or an automated review.

Clients: authenticate using a principal granted `attachments.view` (or an existing covering wildcard), handle 403 and do not rely on possession of an attachment ID. `attachments.manage` alone does not imply read permission. Public partitions and owner restrictions remain unchanged.

Operators: audit roles, user ACLs and API-key grants before rollout and grant read only to intended readers. Deploy consistently to all byte-serving instances; purge previously cached affected private responses at browsers/proxies where possible. Already downloaded content cannot be recalled. No database migration or storage rewrite is required. Rolling back the binary reopens the bypass; block private byte routes at the deployment boundary before an unavoidable rollback.

Before merge: a named human maintainer must explicitly approve the steps 1–3 security waiver; the required dated `BACKWARD_COMPATIBILITY.md` entry records the surface, qualifying argument and migration. Keep the PR security-labelled and pending human approval; automated review cannot clear this gate.

## Risks & Impact Review

- High: legacy clients lose private reads; communicate ACL migration and test representative clients before rollout.
- High: accidental public or owner-policy weakening; preserve existing branches and regressions, never let read permission override owner denial.
- Medium: RBAC unavailability now denies private byte reads; bounded projection fails closed with existing 403/504 behavior. Public unadopted reads remain independent.
- Residual: previously downloaded/cached copies cannot be revoked; operators must handle cache cleanup and incident response separately.

## Final Compliance Report

Private byte routes and their regression tests are implemented. The original five TC-ATT-028 HTTP scenarios passed in GitHub Actions; the old environment-blocked authoring report is historical. The 2026-11-12 cache correction passes all 47 attachment suites / 533 tests locally, and TC-ATT-028 now also asserts no-store on freshly generated and warm thumbnails and successful file/download reads. Current-head CI and human QA must validate the updated HTTP assertions. Detailed evidence is recorded in `packages/core/src/modules/attachments/__integration__/issue-8760-validation.md`. The existing input contract gains only an optional trusted runner property; identifiers, route metadata, generated contracts, production dependencies and database structure remain unchanged. Human waiver approval, required CI and manual QA remain merge gates.

## Changelog

- 2026-11-12: Merged current main and fixed cache sensitivity for feature-only private reads; added runner, fresh/warm image and file/download header regressions, including HTTP assertions.

- 2026-11-05: Implemented the private byte capability gate, runner/route regressions, self-contained HTTP scenarios and client/operator migration for #8760; recorded pending external gates.
