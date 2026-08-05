# Retiring the string emitters in `module-registry.ts`

**Issue:** [#4672](https://github.com/open-mercato/open-mercato/issues/4672)
**Spec:** [`.ai/specs/2026-07-30-ast-first-module-registry-emitters.md`](../specs/2026-07-30-ast-first-module-registry-emitters.md)
**Design PR:** [#4636](https://github.com/open-mercato/open-mercato/pull/4636) (merged 2026-07-30)
**Branch:** `refactor/issue-4672-ast-module-registry-emitters`

## Goal

`packages/cli/src/lib/generators/module-registry.ts` carried two parallel implementations of the same
generator, kept in lockstep by hand with no test asserting they agree. Converge on the AST emitter that
already existed, delete the duplicate, and convert the remaining string emitters in the file.

## Progress

- [x] **Phase 1, step 1** — pin the current output of `renderCommandLoadersFile` with a direct contract test
- [x] **Phase 1, step 2** — rewrite `renderCommandLoadersFile` on the ts-morph helpers
- [x] **Phase 1, step 3** — extract and convert the `bootstrap-registrations.generated.ts` emission into
      `renderBootstrapRegistrationsFile`, with tests for the core-only, one-plugin, overlapping-import and
      malformed-import cases
- [x] **Phase 1, step 4** — CLI suite green; `structural-contracts.test.ts` unmodified at this point
- [x] **Phase 2, step 5** — add `renderAstManifestFile`
- [x] **Phase 2, step 6** — convert the three manifest entry producers to `WriterFunction[]`
- [x] **Phase 2, step 7** — repoint the three call sites; delete `renderAstLegacyManifestOutput`
- [x] **Phase 2, step 8** — suite green, byte-exact expectations re-recorded
- [x] **Phase 3, step 9** — add `registry-variant-parity.test.ts` (passes against the pre-conversion code)
- [x] **Phase 3, steps 10–12** — convert `moduleDecls` and `runtimeModuleDecls`, repoint both call sites,
      delete `renderAstLegacyModuleRegistryOutput` and `renderLegacyCompatibleArray`
- [x] **Phase 3, step 13** — full validation gate
- [ ] **Phase 3, step 14** — file the `buildImportStatement` follow-up issue

## Deviations from the spec

1. **One pull request, not three.** The three phases edit one file; stacked pull requests would sit blocked
   behind an unmerged base and concurrent ones would conflict. Each phase is a separate, independently
   revertible commit group.
2. **`structural-contracts.test.ts` was touched twice.** The spec requires it to pass unmodified on the
   grounds that it is formatting-agnostic by construction. Two assertions are not:
   `/methods:.*GET.*POST.*PUT.*DELETE/` (a `.` cannot cross the newlines the emitter now introduces between
   array elements) and `toContain("'en':")` (pins a quote style). Both were widened with their meaning
   unchanged. Nothing else in the file was modified.
3. **Spec steps 10 and 11 ship in one commit.** Both entry builders read the same `translations` collection,
   whose type changes when the main path adopts `processTranslationsAst`.
4. **`output-snapshots.test.ts` has no jest snapshots.** The spec assumed it did. The only byte-exact
   expectations live in `module-subset.test.ts`; those were re-recorded.

## Bug found during implementation

`renderAstModuleRegistryFile` received the main path's shared import array unchanged. Generator extensions
push structured import specs — not strings — onto that array via `processStandaloneConfig`, and the deleted
legacy renderer was serialising them. Without normalising through `serializeGeneratedImport`, generation
throws `statement.trim is not a function` on any app enabling an extension. Caught by
`structural-contracts.test.ts`.
