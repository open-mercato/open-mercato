# Markdown code-block language customization (#8258)

Source doc: .ai/specs/2026-11-03-markdown-code-block-languages.md
Spec PR: https://github.com/open-mercato/open-mercato/pull/8621
Status: blocked (validation/environment)
Engine: om-auto-create-pr (steps: 4, --loop: no)

## Goal and scope

Allow module/app customizers to add, hide and rename Markdown language choices through the existing UMES component override system. Preserve exact defaults, persisted tags and controlled-value semantics. Scope: shared editor/helper/tests, one new catalog integration test, documentation. #8257 and unrelated fixes excluded.

## Implementation Plan

### Phase 1: Add customization

1.1 Add pure language patch helper/type and regression tests.
1.2 Wire optional prop and stable UMES host, with component/lifecycle tests.

### Phase 2: Verify and document

2.1 Add self-contained catalog integration coverage and developer documentation.
2.2 Run focused and configured gates, independent review and UI verification; publish evidence.

## Risks

Unknown/removed tags must survive. Dynamic overrides must not remount editor state. Plain text remains a fallback. Docker currently unavailable: full-app integration/UI may be blocked. No migrations or production dependency changes authorized. Design document is materialized locally from #8621 and merges separately.

## Progress

PR: #8622

### Phase 1: Add customization

- [x] 1.1 Add pure language patch helper/type and regression tests.
- [x] 1.2 Wire optional prop and stable UMES host, with component/lifecycle tests.

### Phase 2: Verify and document

- [x] 2.1 Add self-contained catalog integration coverage and developer documentation.
- [ ] 2.2 Run focused and configured gates, independent review and UI verification; publish evidence.

## Validation evidence

- Dependency install: `TMPDIR=/tmp/om8258 yarn install --immutable` passed (1m42s), existing peer warnings.
- New feature test before helper existed: failed with module-not-found, expected missing feature surface.
- `yarn jest --config packages/ui/jest.config.cjs --runInBand packages/ui/src/backend/inputs/__tests__/MarkdownField.languages.test.tsx packages/ui/src/backend/inputs/__tests__/MdxEditorImpl packages/ui/src/backend/markdown/__tests__/codeBlockLanguages.test.ts`: 7 suites, 24 tests passed.
- Pre-generation UI typecheck initially failed on the missing generated entity shim; generation resolved this and full workspace typecheck passed.
- Runner: local. Compose probes for both standard compose files found no running app; Docker socket unavailable.

- `yarn build:packages` → `yarn generate` → `yarn build:packages`: passed, respectively 42 tasks (24.118s), 1 task (40.405s), 42 tasks (35.559s).
- `yarn i18n:check-sync`: passed, 70 translated modules in sync.
- `yarn typecheck`: passed, 42 tasks (40 cached), 1m24.579s.
- `yarn template:sync`: passed app/template and package dependency parity.
- `yarn i18n:check-usage`: both the initial 180-second attempt and the single 600-second retry reached their time bounds (exit 124) while scanning 34,918 keys. No findings or pass reported.
- `yarn test`: exited 1 after 6m7.643s (12 successful / 49 tasks). CLI: 3 failed / 110 passed suites, 8 failed / 2342 passed tests. Failures in unchanged `agent-files-extension.test.ts`, `resolve-environment.test.ts`, and `resolver.enterprise.test.ts`. Only the warning assertion was retried: `yarn jest --config packages/cli/jest.config.cjs --runInBand packages/cli/src/lib/generators/__tests__/agent-files-extension.test.ts --testNamePattern='warns instead of silently dropping agents when no output root resolves'` passed (1 passed, 14 skipped). It clears neither the other failures nor the aggregate gate. No deterministic baseline defect is claimed and no out-of-scope CLI fix made.
- `yarn workspace @open-mercato/ui test --runInBand`: 300-second bound reached before test output, exit 124. Focused suites above are the passing UI evidence.
- `yarn build:app`: not repeated locally; GitHub CI prepare job passed this step at implementation SHA `cf680eb9f6a184b0c7d7e6e6c5d21813b279eea3`, along with package builds/generation. Source: https://github.com/open-mercato/open-mercato/actions/runs/41670415663/job/126037221103. Lint and DS lint also passed; other jobs remained pending. This precedes the evidence-only commit, whose current-head CI must still be checked.
- `yarn mercato test:integration TC-CAT-8258-markdown-language-options`: blocked before execution by unavailable Docker runtime. Discovery-only Playwright command hit 90-second limit; no live catalog pass claimed.
- Commands that could hang used the task-owned `/tmp/om8258/run.py` process-group timeout wrapper with `TMPDIR=/tmp/om8258`. Raw logs remain under `/tmp/om8258/` for parent inspection. Required-check metadata returned HTTP 404, so no branch-protection completeness claim is made.

## Review and browser evidence

Independent fresh-context spec review approved scope. Independent implementation review identified one minor bootstrap race in the test fixture; cf680eb9f6 fixes it. Re-review approved source with no remaining source findings; overall validation remains incomplete. Reviewer independently ran helper/host tests (2 suites/7 tests passed) and exercised actual registry replacement/cleanup against the accessor fixture.

An isolated browser harness bundled the actual editor, language helper, I18nProvider and ThemeProvider with esbuild and Chrome 156.0.8078.80. It passed defaults, add/rename/hide, unknown and metadata-tag preservation, selecting Rust, dynamic options and Polish locale changes with unsaved DOM/content preserved. No browser errors. The author independently reran it. The same harness with the original base editor failed at the expected label assertion (JavaScript instead of ECMAScript), providing before/after reproduction. This does not verify full-app bootstrap, generated module discovery or catalog persistence.

Evidence: https://github.com/open-mercato/open-mercato/pull/8622#issuecomment-6608875470

Review: https://github.com/open-mercato/open-mercato/pull/8622#pullrequestreview-5755636037. Posted as COMMENT because the automation is also the author. Source approved; overall changes requested due failed/incomplete validation. PR remains draft with `needs-qa`; no QA approval or merge performed. No further CI follow-up is promised by this run.

## Scope limitation

Standalone harness range classified read-only: new stable UMES handle and optional public prop, using existing component override mechanisms. Harness catalog/owner/release-suite mutations lie outside this assignment's allowed paths; no standalone release validation is claimed. The spec merges separately through #8621.
