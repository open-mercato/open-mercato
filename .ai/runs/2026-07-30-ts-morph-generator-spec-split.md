# Run plan — Address review on PR #4636 (AST-first code generation, issue #1637)

**PR:** https://github.com/open-mercato/open-mercato/pull/4636
**Issue:** https://github.com/open-mercato/open-mercato/issues/1637
**Branch:** `spec/ts-morph-generator-migration` → `develop`
**Scope:** design-only (markdown under `.ai/specs/`). No implementation ships on this PR.

## Review findings being addressed

Review by @pkarw, 2026-07-29, `CHANGES_REQUESTED` (head `9828bd85e`):

| # | Severity | Finding | Resolution |
|---|---|---|---|
| H1 | High | The spec bundles three independently deployable capabilities; scope-cohesion FAIL. Split at least the standalone build-script work from the CLI/plugin-contract work, or split all three phases. | Split into **three** specs (the review's stated alternative), one per capability, cross-linked. Bundled file deleted. |
| H2 | High | `buildAstOutput` optional while `buildOutput` stays required ⇒ an AST-only plugin cannot be written and the planned "AST hook only" test cannot type-check. | Contract redesigned as a **union of two complete interfaces** (`GeneratorPlugin \| AstGeneratorPlugin`) plus a compile-time contract-test matrix (legacy-only / AST-only / both / neither). |
| M1 | Medium | The builder's `addStatement(string)` / string initializers reintroduce the raw-source escape hatch the spec claims to avoid. | Free-form statement and import methods removed. Structural expression/type vocabulary mirroring `ast/writers.ts`, with a single explicitly named `{ kind: 'raw' }` node that is parse-validated, plus a whole-file syntactic-diagnostics gate. Goal restated honestly as "AST-managed file structure + no unparsed fragment reaches output". |

## Progress

- [x] Read PR, review, issue #1637, and the bundled spec
- [x] Re-verify all findings against current `develop@ecc10b3db` (target files unchanged since `4efa7961c`)
- [x] Ground the design in the actual code (`module-registry.ts`, `ast/*`, `types.ts`, `build.mjs`, enterprise plugin, existing test suites)
- [x] Split spec 1/3 — `.ai/specs/2026-07-30-ast-first-package-build-scripts.md`
- [x] Split spec 2/3 — `.ai/specs/2026-07-30-ast-first-module-registry-emitters.md`
- [x] Split spec 3/3 — `.ai/specs/2026-07-30-generator-plugin-ast-output-contract.md` (fixes H2 + M1)
- [x] Delete the bundled `2026-07-29-ts-morph-generator-migration.md`; verify no stale references and that all cross-links resolve
- [x] Verify cited line numbers and factual claims against the tree
- [x] Commit + push
- [x] PR body updated, review comment posted, re-review requested
- [x] `Implement:` tracking issues opened per spec — #4671 (build scripts), #4672 (module-registry emitters), #4673 (plugin contract, gated on D1)
- [x] Merge-ready pass: latest `develop` merged in (19 commits, no conflicts), specification re-review run against the merged tree
- [x] Re-review findings amended in place (two minors + one nit — no blockers, no majors)

## Corrections found while re-verifying (beyond the review's findings)

1. `renderAstLegacyAliasFile` (`module-registry.ts:2343`) was listed as a string emitter in the bundled spec. **It is already fully AST-based** — only its name is legacy. Removed from scope.
2. `renderCommandLoadersFile` (`module-registry.ts:1235`, emits `command-loaders.generated.ts`) **is** a string emitter and was listed neither in issue #1637 nor in the bundled spec. Added to scope.
3. The real defect in `module-registry.ts` is **duplication, not string-ness**: `generateModuleRegistryApp`/`Cli` already build entries as `WriterFunction[]` and emit via `renderAstModuleRegistryFile`, while the main path does the same job with template literals and `renderAstLegacyModuleRegistryOutput`. Plan changed from "rewrite the legacy renderers" to "convert the main path's entry builders and delete the duplicates".
4. The "byte-identical generated output" bar was unachievable. Corrected to the bar the 2026-04-06 migration actually set — structural parity via `structural-contracts.test.ts` (unmodified) with snapshots intentionally re-recorded.
5. `GeneratorPlugin` is **not** enumerated in `BACKWARD_COMPATIBILITY.md` § 2, contrary to the bundled spec's claim. Adding it is now a deliverable of the contract spec.

## Specification re-review (merge-ready pass, head after the `develop` merge)

Re-ran the specification review against the merged tree. All three specs re-grounded: every cited line number
(`module-registry.ts` 1235 / 2288 / 2343 / 2377 / 2406 / 2416 / 2437 / 2462 / 3153 / 3173 / 3391 / 3722,
`ast/imports.ts:11`, `packages/ui/build.mjs` 94–145 with the helpers at 111–143 and the React import at 105,
`packages/shared/build.mjs` 11–22, `module-subset.test.ts` 124–165), the current `GeneratorPlugin` member set,
the `lucideRegistry.ts` export list, the 45 writers in `ast/writers.ts`, and the absence of `GeneratorPlugin`
from `BACKWARD_COMPATIBILITY.md` still hold exactly as written. No blockers, no majors.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| m1 | Minor | The contract spec's `GeneratedTypeReference` covers only named references and arrays, so the object type alias the only known implementation declares needs `{ kind: 'raw' }` — while D3 mentioned raw only for arrow bodies and generics, over-stating structural coverage in type positions. | Stated the limitation explicitly in § The expression vocabulary, D3 and Residual gaps, with `{ kind: 'members' }` named as the additive fix. |
| m2 | Minor | The module-registry spec claimed each phase is independently shippable and, three sections later, that Phase 3 depends on Phase 2's manifest emitter. Phase 3 routes through the already-existing `renderAstModuleRegistryFile`, so the dependency claim was false. | Phase order restated as an ascending-blast-radius recommendation; the single-spec justification rewritten around the shared file, emitter, harness and parity method. |
| n1 | Nit | `GeneratedObjectProperty.kind?: 'property'` was the one optional discriminant in an otherwise uniformly discriminated vocabulary, weakening exhaustive `switch` narrowing in the CLI mapper. | Made required, with a sentence explaining why every node carries `kind`. |

## Validation

Re-verification base: `develop@7dad6df29` (the merge commit `2211a714e` on this branch), not the `ecc10b3db` the initial pass used.

Runner: local. Diff is markdown-only under `.ai/specs/` and `.ai/runs/`; verified that no validation command or test reads either path, so no build/type/test surface is affected. `validation.commands` is entirely build/type/test work with no markdown-applicable member, so all eight were skipped locally and the GitHub checks are the gate — as they were for the previous review pass. It was green on the previous head, with `build:app` correctly scope-skipped for a docs-only diff.

## Labels requested

`documentation`, `review` (replacing `changes-requested`), `skip-qa`, `priority-medium`, `risk-low`.
This account has no `triage` permission — label writes return 403, so a maintainer must apply them.
