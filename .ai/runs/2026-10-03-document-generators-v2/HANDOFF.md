# Handoff — 2026-10-03-document-generators-v2

**Last updated:** 2026-10-03T17:13:56Z
**Branch:** feat/document-generators-v2
**PR:** https://github.com/open-mercato/open-mercato/pull/6892
**Current phase/step:** 9.1
**Last commit:** c506a70f9 — stored document download (checkpoint 8 commit follows)

## What just happened
- Phase 4 done (checkpoint 4). Phase 5 steps 5.1–5.5 + 5.1-review-fix done (checkpoint 5): validators, error envelope, RFC 5987 document response, selected-organization scope, catalogue/options/preview routes, GeneratedDocument entity/encryption/migration, GenerationHistoryService.

## Next concrete action
- Step 9.1: template versioning (code-defined immutable versions, latest by default, explicit older-version selection, used version recorded in history — needs a `template_version` column + migration; without heavy tooling, write the migration in the generated format and update the snapshot by hand per the coding-agent exception). Then 9.2 draft watermark, 10.1 docs. 10.2/10.3 need user approval.

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
