# Issue 8207 — Document mention feedback

## TLDR

A commenter only sees “Share and notify” for mentioned users whose missing document relationship can be remedied by sharing. Users without effective Documents view permission remain inaccessible and produce the existing “weren't notified” feedback after a successful comment save.

## Overview and Problem Statement

This corrects the feedback follow-up to the merged notification authorization fix (#7986, #7837), described in #8207. The collaborative editor specification remains the parent design: `2026-07-08-documents-collaborative-editor.md`. Revoked module access correctly blocks notifications even for owners or retained user/role shares, but the preflight response previously could not distinguish this from a missing share.

## Proposed Solution and Architecture

Reuse the existing scoped, wildcard-aware module view check as `hasUserDocumentViewPermission`. The access-check route combines that check with the existing relationship-tier resolver. The client intersects grantable IDs with inaccessible requested mentions, only prompts for that subset, and shows the existing localized information flash after a successful guarded write when any mention was excluded or the actor declined sharing. Failed saves and cancelled/obsolete submissions do not claim that recipients were notified or skipped. Missing grantability metadata defaults to no sharing offer.

Notification selection and persistence keep their existing effective-access revalidation. Grant commands retain relationship-tier semantics so existing editor and role shares cannot be downgraded by a revoked view permission.

## Data Models

No entity, migration, identifier, or storage change.

## API Contracts

`POST /api/documents/:id/comments/access-check` retains its input, bounds, commenter authorization, `withoutAccess`, and nullable-label `withoutAccessUsers` fields. It adds optional `shareableUserIds: UUID[]`, a subset of `withoutAccess` whose effective scoped module permission allows a new share to provide access. It returns no title, identity data, or reason for denial.

## Migration & Backward Compatibility

The optional response field and new helper export are additive. Existing request/response fields, paths, signatures, ACL IDs, notification IDs, and command behavior remain available. Older clients retain their original behavior. New clients talking to servers without the optional metadata conservatively avoid promising sharing and show existing denial feedback. No deployment migration is required.

## Risks & Impact Review

- High: revoked access or tenant/organization scope could disclose titles. Mitigation: reuse the same policy; preserve notification-time checks and title-free preflight responses.
- Medium: mixed mentions could either suppress useful sharing or still promise impossible delivery. Mitigation: intersect only grantable requested IDs and retain feedback for the remaining recipients.
- Low: failed or cancelled writes could incorrectly show “weren't notified.” Mitigation: emit only after the guarded operation succeeds and the submission context is current.
- Residual: preflight is advisory. Authorization may change before actual notification persistence; the existing backend recheck still fails closed. This change does not add delivery acknowledgements or promise transport success.

## Verification

Route tests cover revoked owners/direct shares/role shares/no share, exact and wildcard grants, and scope rejection. Hook tests cover denied, mixed, skipped, allowed, missing-metadata and failed-save behavior, retaining existing context-change/unmount coverage. Existing permission and notification authorization tests verify scope, share preservation, and disclosure prevention. `TC-DOCUMENTS-022` extends the live API flow to owner/user/role/no-share preflight decisions, preserved shares, and absent notifications after revocation and private-title rename. `TC-DOCUMENTS-004` adds cross-tenant recipient/caller preflight and notification isolation. Live browser evidence depends on an available prepared app environment.

## Final Compliance Report

Changes stay within Documents plus issue-specific artifacts; no shared UI, governance, registry, dependency, or migration changes. Validation results and remaining gates are recorded in `.ai/runs/issue-8207/REPORT.md`.

## Changelog

- 2026-11-04: Separate sharing eligibility from effective recipient access and defer denial feedback until successful comment submission.
