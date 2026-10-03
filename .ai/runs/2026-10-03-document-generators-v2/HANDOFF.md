# Handoff — 2026-10-03-document-generators-v2

**Last updated:** 2026-10-03T12:50:57Z
**Branch:** feat/document-generators-v2
**PR:** https://github.com/open-mercato/open-mercato/pull/6892
**Current phase/step:** 5.6
**Last commit:** 05cf126d8 — generation history service (checkpoint 5 commit follows)

## What just happened
- Phase 4 done (checkpoint 4). Phase 5 steps 5.1–5.5 + 5.1-review-fix done (checkpoint 5): validators, error envelope, RFC 5987 document response, selected-organization scope, catalogue/options/preview routes, GeneratedDocument entity/encryption/migration, GenerationHistoryService.

## Next concrete action
- Step 5.6: POST /document-generators/generate — same flow as preview + mutation guards (create) + `historyService.prepare` OUTSIDE and `persist` INSIDE the best-effort catch; afterSuccess callbacks with try/catch logging (factory pattern), never turning a rendered document into a 500.

## Notes
- Routes: files under `api/document-generators/**` with `metadata.path = '/document-generators/...'` (router prefixes module id otherwise).
- Use `resolveDocumentRequestContext`, `requireOrganization` (returns scoped auth), `mapDocumentError`, `documentResponse`. Preview route passes an inline translate adapter to `templateRegistry.load`.
- No local Postgres; throwaway Docker Postgres on :55432 used only for `db:generate`.

## Blockers / open questions
- Before Step 7.1 / UI evidence: needs user approval to run migrations against a database (local or throwaway) for the running app.
- Maintainer must apply labels/assignee (GitHub refuses writes for this account).
- DS lint governance override must be shown to the user before applying at UI steps.
- GenerationHistoryService constructor exception needs explicit review sign-off (10.3).

## Worktree
- Path: /private/tmp/om-document-generators-v2
