# Checkpoint 2 — Phase 2 capability-scoped example reads

- **Recorded:** 2026-08-02T05:56:26Z
- **Steps:** 2.1..2.3
- **SHA range:** `5b0ac4268..dc4cee802`
- **Touched areas:** create-app harness case/result schemas, example-read policy, MCP tool server, evaluator, and focused security/compatibility fixtures

## Checks

| Check | Result | Evidence |
|---|---|---|
| Example-read policy and tool-server suite | Pass | 12/12 tests passed, including exact capability paths, progressive local entrypoints, reason-gated installed fallback, independent budgets, path/symlink/cache/sensitive denials, and omitted-policy compatibility. |
| Harness evaluator suite | Pass | 89/89 tests passed, including ordered redacted example/fallback evidence, first-violation reporting, and exclusion from selected/actual context. |
| Recursive shared-emission suite | Pass | 3/3 tests passed with repository-local `TMPDIR`. |
| Create-app package typecheck | Pass | `tsc -p packages/create-app/tsconfig.json --noEmit` passed through linked repository dependencies. |
| Script and JSON/schema parsing | Pass | All three touched `.mjs` scripts passed `node --check`; case, result, and catalog JSON parsed successfully. |
| Catalog continuity | Pass | All 202 production IDs remain contiguous from `OMH-001` through `OMH-202`; no production case was added or changed in Phase 2. |
| Diff whitespace | Pass | Phase 2 implementation commits pass `git diff --check`. |
| UI/browser evidence | Skip | Phase 2 changed no rendered surface; screenshots are not applicable. |

## Environment note

Yarn wrapper output and host OS `/tmp` writes return error `-122` in this linked worktree. The same focused checks pass through direct Node/tsx execution, linked repository dependencies, and a repository-local ignored `TMPDIR`.
