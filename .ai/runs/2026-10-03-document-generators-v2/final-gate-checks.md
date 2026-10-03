🤖 `om-auto-continue-pr-loop` — final gate verification (Step 10.2)

Runner: local (no Docker app container); commands run sequentially, the last three by the author in their own terminal. Head: `cc02607c4`.

| # | Command | Result |
|---|---|---|
| 1 | `yarn build:packages` | ✅ 39/39 |
| 2 | `yarn generate` | ✅ no repository changes |
| 3 | `yarn build:packages` | ✅ 39/39 |
| 4 | `yarn i18n:check-sync` | ✅ all locales in sync |
| 5 | `yarn i18n:check-usage` | ✅ after fix `0648cc031` (the docs example module referenced keys without shipping dictionaries); unused keys advisory only |
| 6 | `yarn typecheck` | ✅ after fix `cc02607c4` (two in-package self-imports of the history DTO type did not resolve through the package `exports` map; the third error was its consequence) |
| 7 | `yarn test` | ✅ **scoped** to changed packages: `@open-mercato/document-generators` 32 suites / 230 tests; `@open-mercato/core` `src/modules/sales` + `module-decoupling` 123 suites / 929 tests; `@open-mercato/shared` document-generators 6 tests. Full monorepo suite not run (author's machine). |
| 8 | `yarn build:app` | ✅ |
| + | `yarn lint` | ✅ (run by the author) |
| + | `yarn check:client-boundaries` | ✅ (run by the author) |

Additional evidence:
- `yarn db:generate`: `document_generators: no changes` → hand-written `template_version` migration + snapshot match the entity. (WMS emits an unrelated migration due to a stale WMS snapshot on develop — discarded, not part of this PR.)
- Local `yarn db:migrate` applied both document_generators migrations after removing a stale table left by the closed PR #5170 implementation.
- Manual dev-app run: preview, generate (PDF/Markdown), scoped history and private attachment storage work. It surfaced two defects, fixed in `bd405329f` (registry re-registration on repeated bootstrap) and `9863f6ea7` (stored files released by their owner assignment).

Not run in this gate: integration suite (TC-DOCUMENT-001..022), DS guardian, browser screenshots, standalone harness refresh — remaining scope for Step 10.3 / follow-up.
