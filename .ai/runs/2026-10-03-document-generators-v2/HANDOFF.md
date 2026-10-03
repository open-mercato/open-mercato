# Handoff — 2026-10-03-document-generators-v2

**Last updated:** 2026-10-03T12:31:11Z
**Branch:** feat/document-generators-v2
**PR:** https://github.com/open-mercato/open-mercato/pull/6892
**Current phase/step:** 5.1
**Last commit:** 0ec18287c — order invoice PDF and Markdown templates (checkpoint 4 commit follows)

## What just happened
- Resumed by om-auto-continue-pr-loop (Claude Code) after the Codex session was interrupted.
- Phase 4 complete: QuotesDocumentService / OrdersDocumentService (scoped decrypted fetch, strict id validation, normalized localized data), `sales.offer` PDF, `sales.order-invoice` PDF, `sales.order-invoice-markdown`, Sales convention file `sales/document-generators.ts`.
- Checkpoint 4 passed (see checkpoint-4-checks.md).

## Next concrete action
- Step 5.1: API validators and response helpers (strict request/query schemas, translated error codes, organization guards, RFC 5987 filenames, no-store/nosniff).

## Notes for Phase 5
- Sales services throw `CrudHttpError` with codes `invalid_request` (400), `organization_scope_required` (403), `not_found` (404); routes must map them to the spec's stable error contract (409 organization_required is guarded before fetch).
- Services read scope from `auth.tenantId` / `auth.orgId`; routes must pass an auth whose `orgId` is the selected organization.
- Engine helpers must be imported via explicit `/index` barrel paths.

## Blockers / open questions
- Maintainer must apply labels/assignee (GitHub refuses writes for this account).
- DS lint governance requires an exact reviewable override before permission request at UI step.
- History service constructor exception requires explicit final review signoff per spec.

## Environment caveats
- Local runner; no Docker app container. App not launched; no migrations applied.
- Local `dist` for shared/document-generators/core rebuilt during checkpoint 4.

## Worktree
- Path: /private/tmp/om-document-generators-v2
