# Markdown code-block language customization (#8258)

Source doc: .ai/specs/2026-11-03-markdown-code-block-languages.md
Spec PR: https://github.com/open-mercato/open-mercato/pull/8621
Status: in-progress
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

- [ ] 2.1 Add self-contained catalog integration coverage and developer documentation.
- [ ] 2.2 Run focused and configured gates, independent review and UI verification; publish evidence.

## Validation evidence

- Dependency install: `TMPDIR=/tmp/om8258 yarn install --immutable` passed (1m42s), existing peer warnings.
- New feature test before helper existed: failed with module-not-found, expected missing feature surface.
- `yarn jest --config packages/ui/jest.config.cjs --runInBand packages/ui/src/backend/inputs/__tests__/MarkdownField.languages.test.tsx packages/ui/src/backend/inputs/__tests__/MdxEditorImpl packages/ui/src/backend/markdown/__tests__/codeBlockLanguages.test.ts`: 7 suites, 24 tests passed.
- Pre-generation UI typecheck: failed because `#generated/entities.ids.generated` is missing in fresh worktree. Full ordered generation/build gate in progress.
- Runner: local. Compose probes for both standard compose files found no running app; Docker socket unavailable.
