# Checkpoint 1 — Phase 1 knowledge governance

- **Recorded:** 2026-08-01T18:18:18Z
- **Steps:** 1.1..1.4
- **SHA range:** `16bdbdfec..bad3b8bd2`
- **Touched areas:** create-app harness knowledge classification/controller, evolution workflow contracts, recursive emission, and harness documentation

## Checks

| Check | Result | Evidence |
|---|---|---|
| Knowledge-change controller and fixture suite | Pass | 13/13 tests passed. |
| Standalone overlay/workflow contract suite | Pass | 17/17 tests passed. |
| Recursive shared-emission suite | Pass | 3/3 tests passed with repository-local `TMPDIR`. |
| Create-app package typecheck | Pass | `node node_modules/typescript/bin/tsc -p packages/create-app/tsconfig.json --noEmit`. |
| Controller and contract syntax | Pass | `node --check` passed for both added `.mjs` files. |
| JSON/schema parsing | Pass | Package templates, knowledge schema, and case catalog parsed successfully. |
| Catalog continuity | Pass | All 202 production IDs remain contiguous from `OMH-001` through `OMH-202`; `cases.json` was not changed. |
| Diff whitespace | Pass | The Phase 1 implementation commits pass `git diff --check`. |
| UI/browser evidence | Skip | Phase 1 changed no rendered surface; screenshots are not applicable. |

## Environment note

The host returns `Unknown system error -122` for Yarn wrapper output and OS `/tmp` writes. This is not a product failure: all focused commands completed through direct Node/tsx execution, and the emission suite passed with `TMPDIR` set to a repository-local ignored directory.
