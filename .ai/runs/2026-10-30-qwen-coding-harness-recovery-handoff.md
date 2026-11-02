# Qwen coding harness recovery — paused handoff

The user requested a pause and PR handoff. This is unfinished work, not a merge-ready verdict. Resume the existing task and PR; do not open a replacement or merge it.

## Acceptance and PR

- PR: [#8262](https://github.com/open-mercato/open-mercato/pull/8262), branch `fix/qwen-coding-harness-recovery`.
- Complete all fourteen canonical **and** implementation cases, preserving failed attempts, then integrate the latest base and finish review/CI/approval. Do not weaken grading or edit generated model outputs to obtain passes.
- [Fourteen-step execution plan](2026-10-30-qwen-coding-harness-recovery.md), [spec](../specs/2026-10-30-coding-harness-contract-recovery.md), [analysis](../analysis/2026-10-30-qwen27b-coding-failures.md).
- Original PR base: `fd7c06569bd5fa282716b28e1375d2ddb2cc1eea`. Do not change that provenance in existing knowledge reports.
- Existing dashboard changes belong to separate PR #8259.

## Model checkpoint and graceful stop

Frozen Round 5 runtime source is `0395f6246d13fac742fdd72df59aa22f3d8bdd49`, run `ac37befc-5efe-486e-a2f3-c37d437d446e`. Model `qwen3.8:27b-mlx`, Pi1.4.0/Ollama0.40.8, sequential attempts with a 1,200-second ceiling. Earlier trials used600 seconds; do not imply an isolated source or throughput comparison.

At pause: five completed cases, one canonical PASS (009), four canonical FAIL (011/012/014/026); implementation PASS009/011. OMH-027 is active; eight cases are pending (029/031/042/045/049/054/057/060). A graceful stop was requested after the active case using the existing stop sentinel, without sending a signal. The producer can finish027 after this handoff; inspect its authoritative status before starting checks or another model run. Do not claim027 passed, failed or interrupted from this checkpoint.

[Per-case checkpoint](../analysis/2026-10-30-qwen27b-round5-results.md) and [content-free evidence hashes](../analysis/2026-10-30-qwen27b-round5-results.json) preserve all outcomes. Original/earlier trials are immutable. Local responses/generated files remain in the retained experiment dashboard and ignored operation records; no raw captures or machine paths are committed here. Do not re-execute the old driver against non-empty result storage: it intentionally refuses to hide earlier attempts. A new-source evaluation needs new versioned experiment storage and fresh targets.

## Proposed fixes saved on this branch

- `c3d9d7b74`: existing read tool withholds canonical source bytes until the exact public owner and a declared entrypoint have succeeded. Paired permitted refusals are excluded from delivered context; unsafe probes, ambiguous results and the existing exploration cap stay failures. No new tool schema/grant or compatibility-write gate.
- `86e56ed5e`: coding completion audit covers the public route/work-unit/fact axes and offered decisions without disclosing expected answers.
- `5b569f168`: current DI/CommandBus/route-guard guidance, exact existing guarded POST access, and a real canonical POST bug fix that merges/revalidates guard-modified payloads before scoped durable claims. Only four precisely measured source caps change; ordinary/initial caps stay fixed. [Closure proof](../analysis/2026-10-30-qwen-harness-custom-write-closure.json).
- This handoff commit adds modern `runRouteMutationGuards` recognition connected to checkoutPOST and recognizes the actual DataTable `perspective.tableId` form, including bounded inert extension-point constants. Legacy guard and atomic predicates remain unchanged. Ordinary UI guidance matches runtime; metadata stays within the existing module/file/byte boundaries. [Bounded proof](../analysis/2026-10-30-qwen-harness-current-contract-proof.json).

Current014's table-ID diagnostic is a proven oracle false negative: installed runtime and canonical TodosTable use `perspective.tableId`. Its real wrong import paths and owner-order violation remain FAIL. Current012 has a nonexistent commandBus import and no supported guard; current026 has an invented shared/db import and missing interceptor artifact. No old result is regraded.

## Validation completed versus pending

At frozen0395, all eight ordered repository commands, coherent packed-scaffold preparation for all14, and the nine-file V8 knowledge controller passed. Those verdicts do not transfer to the newer source automatically.

For follow-ups, bounded actual MCP/configuration tests pass18/18, plus two named real-response observer/integration checks. Two named AST positives fail by assertion at0395 and pass after the fix; fast candidate controls pass30 guard +22 table checks. These AST controls do **not** compile the actual SDK. The initial missing-request recognizer error was fixed; its failure log is retained. Native template/source-link generation/check/validation pass at the custom-write snapshot (151 topics,32 owners,128 links,136 baseline dispositions).

UI wording is byte-safe: backend guide8982B (−1), progressive CRUD reference7509B (+46). Read-only arithmetic finds no new ordinary/initial/max-root deficits and only the same four baseline cases008/082/153/155. This is not fresh-scaffold or executed catalog evidence.

Still required:

1. Confirm the model process has stopped; finish the final027 checkpoint if it completed after pause.
2. Run full new observer/MCP suites and actual SDK compiler controls, existing affected oracle suites, and the real canonical POST Jest regressions. Prove the new handler tests fail against the original route and pass after; run applicable existing self-contained integration coverage in a prepared environment. Do not claim these unrun tests passed.
3. Run the complete ordered gate from `.ai/agentic.config.json`; previous0395 passes remain historical. Use the configured Node/Yarn and appropriate local/container runner.
4. Regenerate/pass a new controller-owned knowledge manifest against the original base with every changed authority/focused test. Preserve V3–V8 evidence. Include the new tool-server, context accounting, guard/table recognition, API procedure/canonical-source changes and derived inventories.
5. Build fresh coherent packed/scaffold assets, verify source/emitted/installed parity and actual read policy/budgets, then evaluate all14 in new disposable targets. Preserve attempts/corrections, code results and generated-app checks separately.
6. Run eligible generated target generate/typecheck/lint/build, applicable tests and isolated artifact judgment. Existing local-only review is not an official cloud judge certificate.
7. Only after all14 pass: latest-base integration, the same authoritative `om-auto-review-pr --autofix` engine, required CI, applicable QA and independent approval via `om-auto-fix-pr`. Never merge.

Native macOS full release stops at the Linux/Bubblewrap isolated-loopback prerequisite; experimental Pi transport is not an official release runner. Do not fabricate certification. Main branch protection requires an independent review; author self-approval is rejected. The single authoritative review record is [this comment](https://github.com/open-mercato/open-mercato/pull/8262#issuecomment-6525406896); newer source needs review again. No base merge or CI stabilization was performed ahead of the required model passes.

## Resume cautions

The pre-commit hook automatically synchronizes/stages **all** template app/module mirrors and locale files. Freeze app edits before any commit, inspect the index, and commit intended authors and mirrors together. A partial test mirror was accidentally staged in4475cd40b and was repaired without rewriting history by3d2c57b09; the final test pair is identical. Keep generated inventory updates native and preserve current experiment authorities. Do not commit local-only operation scripts, private paths, environment values or raw model captures.

Applied workflow: `om-evolve-harness`, `om-auto-create-pr`, and the same `om-auto-review-pr` engine; `om-auto-fix-pr` is prepared for the post-pass phase. The user requested commit/push as changes land. The PR remains draft, with no all14/merge-ready claim.
