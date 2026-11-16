# Message attachment source authorization (#9017)

**Status:** In progress
**Issue:** https://github.com/open-mercato/open-mercato/issues/9017

## TLDR

Messages may consume the acting principal's newly uploaded library staging files or copy files from messages that principal may read. Other owners require `attachments.manage` and a positive registered owner-policy decision. A missing policy is not authority to take another owner's file. Draft removal detaches message references rather than deleting source files. Draft email sends require `messages.email`, and delivery rechecks current sender permissions and reads bytes through `attachmentService`.

## Overview

Extends `2026-10-01-attachment-access-resolvers.md` using the existing access runner, metadata JSON and request actor. Related draft #7989 adds protected-owner checks only; this change additionally addresses resolver-less sources, staging provenance, draft unlinking, and email delivery. No schema, dependencies, startup settings, new authorization system or route shapes change.

## Problem Statement

Caller-supplied attachment IDs currently overwrite primary owners. Draft updates and attachment commands then delete these rows without the original owner's authority. Sending drafts bypasses the compose email feature check and delivery reads raw storage paths. Library staging is client-named and contains no uploader identity, so tenant/org filtering alone cannot distinguish the caller's staging from another user's.

## Proposed Solution

- Upload sets a reserved metadata provenance object from authenticated `sub`, tenant and organization, never from form data. Existing metadata PATCH accepts only tags/assignments/custom fields; transfer preserves provenance. Neither route may replace or erase the reserved object.
- Link operations receive optional authenticated access context; a missing context denies nonempty operations. Exact tenant/org scope is required, including no partial-null fallback.
- Own library staging requires provenance matching principal and scope and passes existing owner `reassign` checks, including assignment-based protection. Unknown/unowned legacy staging fails closed.
- Message sources require the existing scoped message-read rule and owner-policy evaluation. They are copied, keeping source rows, assignments and shared bytes intact. Forwarding validates each source attachment too.
- Other sources require both `attachments.manage` and positive registered `reassign` policy; unprotected/no-resolver owners deny. The existing attachments owner assertion accepts an optional protected-owner requirement, keeping partition loading and policy enforcement inside the attachments module.
- Draft unlink/update and undo detach/restore only exact message-owned references; snapshots cannot reparent an ID now owned elsewhere. No source attachment hard deletion through message commands.
- PATCH send checks effective email delivery settings, including persisted draft state. Delivery checks current sender permission and uses `attachmentService.readScoped` with authenticated sender and expected message owner immediately before bytes are sent.

## Architecture

Existing upload boundary records provenance; messages link commands enforce source access; existing owner resolver runner remains authoritative for protected owners; existing attachment service owns reads and storage. Commands retain mutation guards, optimistic locking, event/index/audit effects and transactions.

## Data Models

Reserved `storageMetadata` provenance is server-owned internal data. Existing JSON column only. Copy provenance belongs to the new reference's actor. Client-controlled tags/assignments do not establish provenance.

## API Contracts

Routes, request/response shapes and required arguments stay stable. Unauthorized source links answer 403. Legacy unowned transient staging must be re-uploaded. Existing sent-message attachments remain valid through the message-read rule. The `messages.email` requirement applies to draft sends as it already does to compose.

## Migration & Backward Compatibility

The accepted unowned staging/source-link behavior is itself the authorization bypass. A compatibility bridge would preserve the exploit, so the narrow tightening uses the Emergency Security Exception. No DB migration or operator configuration is needed. Users re-upload transient legacy staging files; operators communicate this and discard stale composer state. Existing sent attachments are not rewritten. Module authors pass the optional authenticated access context to attachment-link helpers. A dated compatibility entry and upgrade note accompany this change; named human maintainer acknowledgment remains required before merge.

## Testing Strategy

Unit regressions cover same-org foreign and resolver-less sources, own/foreign/legacy staging, message read access, policy denial, copy preservation, detach and undo boundaries, persisted draft email settings, and delivery denial before storage/email. Metadata mutation/transfer tests prove provenance cannot be forged or erased. Self-contained API integration creates distinct principals, roles and files, exercises compose, PATCH, attachment POST/DELETE, reply and forward, checks source preservation, email permission and tenant/org boundaries, and cleans up fixtures. Existing legitimate staging/compose/reply/forward suites remain regression coverage.

## Risks & Impact Review

| Risk | Severity | Mitigation / residual |
| --- | --- | --- |
| Old transient staging lacks provenance | Medium | Explicitly require re-upload; sent attachments preserved. |
| Reference copies share bytes | Medium | Never delete provider bytes during message unlink; attachment service retains reference-aware cleanup. |
| Permission revoked between compose and delivery | High | Recheck current sender permission and owner policy at byte read; fail the email rather than silently exporting denied files. |
| Metadata tampering launders provenance | High | Server-only field, allowlisted metadata patches, preservation on transfer, dedicated regression tests. |
| Unusual downstream link callers omit context | Medium | Fail closed; optional signature remains source-compatible and upgrade note explains context. |

## Final Compliance Report

Implementation and focused regression coverage are complete. Parent reproduced 1,083 message/attachment tests, package builds, generation, translation checks and core typechecking; managed HTTP verification is in progress. Full monorepo testing remains blocked by TS7/ts-jest tooling. New attachment copies enforce the existing scope invariant. No automated review grants `qa-approved` or satisfies the named maintainer security waiver acknowledgment.

## Changelog

- 2026-11-16: scoped #9017 security correction; parent authorized upload provenance and fail-closed legacy transient staging.
