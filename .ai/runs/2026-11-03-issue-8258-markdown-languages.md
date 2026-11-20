# Markdown code-block language customization (#8258)

Spec: `.ai/specs/2026-11-03-markdown-code-block-languages.md`, published separately in https://github.com/open-mercato/open-mercato/pull/8621.
Implementation: https://github.com/open-mercato/open-mercato/pull/8622.
Status: implemented; certification blocked by environment. PR remains draft for the remaining validation.
Engine: `om-auto-fix-issue` feature route → `om-auto-write-spec` → `om-auto-implement-spec`.

## Scope and implementation

The optional `MarkdownFieldProps.codeBlockLanguages` patch adds, hides or renames choices while preserving defaults and stored language tags. The mounted `section:ui.inputs.MarkdownField` host uses the existing UMES component props-transform contract, including app-level `widgets.components` overrides. Plain text remains available; translated labels have a fallback. There is no new production dependency, migration, override domain, or change to Markdown normalization (#8257).

The parent subsequently authorized the required standalone follow-up: exact framework-host facts, a focused Markdown routing case (final ID OMH-242), exact installed-source links, corrected canonical-example guidance, generated inventories and tests. The final catalog contains 242 total and 49 writable cases; OMH-030 retains its original task and budgets. Runtime/editor files were frozen before the sibling normalization task began.

## Delivery plan

- [x] Pure language helper/type and regression tests.
- [x] Optional field prop, mounted UMES host and lifecycle tests.
- [x] Self-contained catalog integration test and developer documentation.
- [x] Independent spec and implementation review; actual-editor and full-app browser evidence.
- [x] Exact host facts, standalone routing/source coverage and failure-first checks.
- [x] Repair final-head CI harness regressions with preserved compatibility coverage and a separate measured Markdown case.
- [ ] Complete standalone certified routing/release gates: required containment is unavailable.

## Product validation

Runner: local; no compose app container was running at gate selection. All long processes had bounded task-owned wrappers. Temp fixtures use TMPDIR, TMP and TEMP outside the repository; Turbo strips TMPDIR but preserves TMP/TEMP.

- `yarn jest --config packages/ui/jest.config.cjs --runInBand packages/ui/src/backend/inputs/__tests__/MarkdownField.languages.test.tsx packages/ui/src/backend/inputs/__tests__/MdxEditorImpl packages/ui/src/backend/markdown/__tests__/codeBlockLanguages.test.ts`: **7 suites / 24 tests passed**.
- Initial ordered `yarn build:packages` → `yarn generate` → `yarn build:packages`: **42 / 1 / 42 tasks passed**. `yarn i18n:check-sync`: 70 modules passed. `yarn typecheck`: 42 tasks passed. `yarn template:sync`: passed.
- Initial full `yarn test` failed in three unchanged CLI suites because temp fixtures inside the outer repository detected a monorepo. The root `yarn test --filter=@open-mercato/cli -- --runInBand --runTestsByPath src/lib/generators/__tests__/agent-files-extension.test.ts src/lib/__tests__/resolve-environment.test.ts src/lib/__tests__/resolver.enterprise.test.ts`, with all three temp variables outside the repository, **passed 3 suites / 33 tests**. No unrelated CLI source fix was made.
- Initial `yarn i18n:check-usage` reached 180- and 600-second limits; full UI tests reached 300 seconds. These were not passes. At implementation head `2602e210`, CI run **41672484565** subsequently passed i18n, typecheck, unit tests, template parity, lint, DS and app build, as reported by the parent. That result does not certify later harness changes.
- Docker recovered. The isolated native catalog integration attempt completed package/generation phases, **app build in 698 seconds**, and readiness in 28 seconds. The 1500-second overall bound expired during global Playwright discovery before any test result. A module-filtered retry was stopped when the cache guard required another cold rebuild. Neither is a native integration pass.
- At follow-up head `190910422c0adcb800c88c57ce6ab82bdd307681`, CI run **41684691635** passed all 15 integration shards. The shipped `TC-CAT-8258` passed in job **126091972030** at **2026-11-03T18:15:33Z**, taking **5.5 seconds**. The exact job log was independently inspected. This supersedes the earlier native-test uncertainty; editor/runtime sources remain unchanged in the subsequent harness-only repair.
- All owned app, worker, browser and container processes were cleaned. The parent owns Docker Desktop lifecycle and current-head CI monitoring.

## Reproduction, browser QA and review

The isolated browser harness bundled the actual editor, helper, I18nProvider and ThemeProvider. Chrome 156.0.8078.80 passed default choices, additions, rename/hide, unknown/metadata-tag preservation, Rust selection, dynamic options and Polish locale changes while preserving unsaved DOM/content; no browser errors. The author reran it independently. Substituting the base editor fails the expected rename assertion (JavaScript instead of ECMAScript).

Full-app catalog browser QA subsequently passed against the actual built app and mounted UMES host: custom choices, keyboard-edited code, save HTTP 200, API readback and reload preserved Rust, hidden SQL and unknown language metadata. No page errors; fixture deletion returned HTTP 200. The first attempt used CodeMirror `fill` incorrectly; the successful keyboard-based retry is the reported result. Full-app dynamic locale switching was not exercised; the isolated check covers it.

- Isolated evidence: https://github.com/open-mercato/open-mercato/pull/8622#issuecomment-6608875470
- Full-app evidence: https://github.com/open-mercato/open-mercato/pull/8622#issuecomment-6610023394
- Source review: https://github.com/open-mercato/open-mercato/pull/8622#pullrequestreview-5755636037

The independent implementation reviewer found and then approved the correction to the integration fixture's deferred registry-bootstrap race. The independent harness reviewer found and then approved the context-budget and two-file evaluator-fixture corrections. Source approval is separate from aggregate validation. The author account posts COMMENT reviews, not a self-approval. No `qa-approved`, PR merge, shared/base push or official-module pointer change occurred.

## Standalone knowledge contract

Refresh range: `586cee8389f08..2602e210a171`; follow-up manifest baseline: `2602e210a171`.

1. Contracts: discovery, skill-link, source-link, context-read and evaluator; cases OMH-030 (preserved generic coverage), OMH-242 (new Markdown coverage), OMH-088 and OMH-089.
2. Owners: CLI extractor owns generated host facts; the existing component branch owns the customization procedure. The umbrella skill only points to that branch. Existing canonical `widgets/components.ts` remains the syntax source. Its previously contradictory wrapper-only/QA-only prose was pre-existing drift, corrected only where this case needs it.
3. Exact installed links identify `MarkdownField.tsx` and `codeBlockLanguages.ts`; inventories are generated, never hand-edited. No canonical module surface was added or changed, so the baseline example-disposition ledger is unchanged.
4. Failure-first: CLI catalog/correlation assertions fail on the missing first-party host; emitted catalog assertion fails before regeneration; new routing/source-link tests fail on the old owner and missing source topics. The actual evaluator fixture failed on the two missing installed files.
5. OMH-242 now requires the existing props-transform example, exact installed contracts, patch composition, stored-tag preservation and translated labels.
6. Final counts are 242 total / 49 writable. The release matrix already selects all cases for deterministic and primary routing; writable/portability membership is unchanged. Source inventories contain 157 records, 132 source-required entries, 134 rendered links and 32 owners. OMH-242 uses 16 initial files, 73,728 initial bytes and 344,064 total bytes, plus a 9-file/204,800-byte exact source allowance; global ceilings are unchanged.
7. Fresh packed `create-mercato-app` generated classic, CRM, empty and WMS presets. All four passed OMH-030, resolved 132/132 applicable exact source links, and verified 15/15 pinned external core skill hashes/ownership records. The four changed emitted knowledge assets and both installed UI sources matched their authoring hashes. This is packed-source delivery, not a full application dependency installation or runtime build. Classic `--all` passed 240/241: unchanged OMH-008 exceeded its declared initial context budget by 241 bytes (45,297/45,056). Its nine counted-source templates/generator inputs are byte-identical to base `586cee8389f08`; no fresh baseline execution is claimed. No unrelated case or global budget was changed.
8. Certified routing/full release remains **blocked**. The parent's ordinary Linux Bubblewrap probe failed private user/network namespaces, capability-free payload and isolated-loopback requirements. Native macOS cannot satisfy the release loopback boundary. No privileges, sandbox policy or credential handling were weakened; no repeated failing probe or fabricated release report.
9. The machine knowledge-change validator passed: the focused source test exits 1 against base plus test-only patch and 0 against the changed tree. Result SHA-256: `719403c097493b736d5ac415761c25b885aaf313816fadfb43961961328befb6`. Its hash/regression verdict is separate from certified execution.

Focused commands and packed artifact hashes are retained in the final task report. Primary runner is Codex; a portability runner was not requested. No complete release-suite pass is claimed.

## Follow-up validation commands

- `yarn jest --config packages/cli/jest.config.cjs --runInBand packages/cli/src/lib/generators/__tests__/module-extension-facts.test.ts`: **17/17 passed**, independently rerun by the author.
- `yarn workspace @open-mercato/cli build`, `yarn workspace create-mercato-app build`, and `yarn generate`: **passed**. Initial create-app build hit 300 seconds; one final coherent 600-second attempt passed. Generation passed in 131 seconds (one Turbo task).
- `yarn workspace @open-mercato/cli typecheck` and `yarn workspace create-mercato-app typecheck`: **passed**.
- `node --import tsx --test --test-name-pattern='framework extension catalog' packages/create-app/src/lib/module-facts-build.test.ts`: **1/1 passed**.
- `node --import tsx --test --test-name-pattern='Markdown|checked inventory|covers exactly|capability joins|projection lands|source reference id' packages/create-app/src/lib/source-link-inventory.test.ts packages/create-app/src/lib/agent-surface-coverage.test.ts`: **8/8 passed**. The complete two-file attempt hit 300 seconds during repeated npm package dry-packs; no complete suite pass is claimed.
- `node --import tsx --test --test-name-pattern='deterministic evaluation passes every concrete' packages/create-app/src/lib/agent-harness-evaluator.test.ts`: **1 test / all 241 cases passed** in its emitted-layout fixture.
- `yarn workspace create-mercato-app harness:check-source-link-inventory`: **passed**.
- `yarn workspace create-mercato-app harness:validate-knowledge-change --root <repository> --manifest <local-manifest> --base 2602e210a171b7328ecfc76b0c4e9c58aa74b37c --execution-timeout 60000`: **passed** with controller-owned base/head evidence.
- In each packed preset: `node scripts/install-skills.mjs --tiers core` and `node scripts/evaluate-agent-harness.mjs --case OMH-030`: **passed**. In classic: `node scripts/evaluate-agent-harness.mjs --all`: **240/241**, OMH-008 budget failure above.
- The original packed measurement omitted the automatically allowed 125,146-byte surface inventory. Its claim of complete context coverage is withdrawn. Corrected full context is 18 files / 343,124–343,326 bytes, including 13 initial files / 72,938–73,140 bytes; the new exact-source regression includes that inventory.

All follow-up long commands used bounded wrappers with all three temp variables outside the repository. Final full-workspace CI belongs to the final committed head and is monitored by the parent; earlier CI results are not promoted to it.

Packed-proof summary SHA-256: `4d4721acf2e4577fa505eaa1d35b905f45b7958511b010e30a0e3753866d1a38`; Node 24.18.0, Yarn 4.17.1, external skills pin `c6103c034571f3610323a1b53d97c81abe110b58`.


## CI regression repair after head 190910

CI test job `126091970315` failed on the omitted example-declaring case pin, the 9-file declaration exceeding its 8-file bound, and the missing generated framework-guide fixture. Local reproduction returned 68 passes / 4 failures (three assertions plus their parent suite). Supplying the real generated guide exposed the intentionally frozen generic compatibility guard; its original initial cap and tight total-slack assertion were not a fixture defect.

The parent reviewed the design conflict and required a distinct case. All original 241 records are restored exactly to `2602e210a171`; `compatibility-context-budget.test.ts` is unchanged. New OMH-242 owns the specific Markdown task, exact installed contracts and canonical example. The shared skill grows only 30 bytes; original OMH-030 still passes at 124,113/126,976 total bytes and retains its 49,152-byte initial cap. No generic guide was removed to force a pass.

The new `markdown-language-context-budget.test.ts` calls the actual framework-guide renderer and stages real canonical/installed source files. It obtains the complete read set from the evaluator, pins all nine source paths, and checks both source and total context with at most 4 KiB spare capacity. It fails before OMH-242 exists. Final source-fixture measurement is 18 files / 343,145 total bytes, 13 initial files / 72,959 initial bytes. Catalog/schema/validator/declaring-case/source-inventory/docs/spec counts are synchronized; global limits, evaluator policy, release matrix and runtime/editor code are unchanged.

Bounded local commands (all TMP variables outside the repository):

- `node --import tsx --test --test-timeout=120000 --test-reporter=spec packages/create-app/src/lib/agent-harness-example-read-policy.test.ts packages/create-app/src/lib/compatibility-context-budget.test.ts packages/create-app/src/lib/markdown-language-context-budget.test.ts`: **74/74 passed, no skips** (36.6s).
- `node --import tsx --test --test-timeout=120000 --test-name-pattern='deterministic evaluation passes every concrete|deterministic evaluation enforces the case schema|catalog contains|published catalog|Markdown|242-case' --test-reporter=spec packages/create-app/src/lib/agent-harness-evaluator.test.ts packages/create-app/src/lib/agent-surface-coverage.test.ts packages/create-app/src/lib/source-link-inventory.test.ts`: **5/5 passed**, including the **242/242** deterministic fixture.
- `node --import tsx --test --test-name-pattern='published|catalog routes|Markdown' --test-reporter=spec packages/create-app/src/lib/agent-surface-coverage.test.ts packages/create-app/src/lib/markdown-language-context-budget.test.ts`: **6/6 passed**, including the existing published-count guard after the matching spec update.

The successful native CI integration belongs to head 190910. New-head aggregate CI belongs to the parent; packed OMH-008 and certified containment limitations remain separate and are not relabeled as passes.

The updated knowledge-change manifest passed for the new source/context tests: controller-owned base executions exit 1 and head executions exit 0. Result SHA-256: `08b46608b904ffd19390cd526156d49458a545bd0dd00ef3a7dec4998441e8fc`. An initial manifest declaration incorrectly listed the unchanged compatibility test as a new regression; the validator rejected that declaration. It was removed from the manifest, while its separate full-suite pass remains recorded above. No test or validator behavior was changed to satisfy the manifest.
