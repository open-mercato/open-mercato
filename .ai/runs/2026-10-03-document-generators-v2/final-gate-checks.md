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

Integration suite (Playwright against the local dev app, `OM_INTEGRATION_MODULES=document_generators`, 1 worker): **25 passed, 1 skipped, 0 failed** across TC-DOCUMENT-001..022.
- First run: 21 passed; failures were 3 browser cases (Playwright browser not installed) and TC-017 (the test sent the malformed body as a JSON-serialised string → fixed by sending raw bytes, `97273eb8b`).
- TC-022 selectors fixed (`#main-content`-scoped Documents tab instead of the sidebar group; dialog closed with Escape instead of an ambiguous "Close"); both order and quote tab cases pass.
- Skipped by design: TC-022 "successful generate with no persisted row" (needs persistence fault injection; covered by the generate route unit test).

Not run in this gate: DS guardian, browser screenshots, standalone harness refresh — remaining scope for Step 10.3 / follow-up.
