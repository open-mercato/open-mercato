# Handoff — 2026-10-03-document-generators-v2

**Last updated:** 2026-10-03T13:17:53Z
**Branch:** feat/document-generators-v2
**PR:** https://github.com/open-mercato/open-mercato/pull/6892
**Current phase/step:** 8.1
**Last commit:** fe02a4262 — integration tests authored (not executed)

## What just happened
- Phase 4 done (checkpoint 4). Phase 5 steps 5.1–5.5 + 5.1-review-fix done (checkpoint 5): validators, error envelope, RFC 5987 document response, selected-organization scope, catalogue/options/preview routes, GeneratedDocument entity/encryption/migration, GenerationHistoryService.

## Next concrete action
- Step 8.1: Retention and erasure contract (inline). User-approved policy: no automatic expiry; deleting source data deletes generated files and anonymizes history. Then 8.2, 8.3, 9.1, 9.2, 10.1 (all inline), then 10.2 full gate + 10.3 review/QA — both need explicit user approval (heavy validation; app + migrated DB for browser evidence).
- Session paused at user request (computer shutdown). Resume with `/om-auto-continue-pr-loop 6892`.

## Reduced validation mode (user request, 2026-10-03)
- The user's machine froze under repeated full typecheck/build/generate runs. Run only each Step's own test file (`npx jest --runInBand <file>`); defer package typecheck, builds, `yarn generate`, full suites and the final gate until the user asks.

## Integration tests (7.1)
- Authored in `packages/document-generators/src/modules/document_generators/__integration__/` (TC-DOCUMENT-001..022), never executed. First-run risks: UI selectors in 022, quote detail URL, restricted-user role scoping, heuristic resourceLabel decryption check, raw-string invalid_json request.

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
