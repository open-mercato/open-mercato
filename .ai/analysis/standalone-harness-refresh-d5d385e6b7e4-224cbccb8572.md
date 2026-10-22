# Standalone Harness Refresh

- Outcome: blocked — required full release suite is running; focused evidence passes.
- Local range: `d5d385e6b7e4..224cbccb8572`
- Knowledge validation base: `224cbccb85722ebb33576f884b0e0d3d3ae0df22`, with the working-tree knowledge overlay.
- Catalog before/after: 239 / 239
- External systems mutated: none

## Evidence and classification

| Candidate | Classes | Risk | Repository-relative evidence | Contract/ID summary |
|---|---|---|---|---|
| Canonical locators, aliases, installation preflight and generator collision guards | contract, generator/discovery, CLI | medium | `packages/cli/src/lib/module-install.ts`, `packages/cli/src/lib/module-identity.ts` | Binding, canonical origin and runtime ID are distinct; every active binding consumer must survive an update; duplicate runtime IDs fail before generator writes. |
| Safe source ejection | contract, generator/discovery, CLI | medium | `packages/cli/src/lib/eject.ts` | Preserve available provenance and existing local source; validate configuration before copying. |
| Provider replacement instructions | knowledge-contract | medium | `packages/create-app/agentic/guides/module-tool.md`, `apps/docs/docs/cli/module-add.mdx` | Disable every consumer; resolve old-origin dependants and manual imports; successfully generate/build before replacing the binding; enable and generate/build again. |
| Current generated Yarn policy compatibility | evaluator | low | `packages/create-app/agentic/shared/scripts/run-agent-harness-release.mjs` | Accept only the exact pinned current policy/comment prefix, then retain strict registry-suffix validation. The copied five-day cooldown, package preapproval and comments remain byte-identical. |
| Artifact output bounds and regression-suite preservation | implementation evidence | low | `packages/cli/src/lib/module-inspection.ts`, `packages/cli/src/__integration__` | Bounded artifact inspection and separate regression IDs preserve the same user contract; no additional teaching case. |

## Deduplication

| Candidate | Disposition | Existing/new case | Rationale |
|---|---|---|---|
| Receiving a published module | expand | OMH-239 | Existing creation/publication workflow already owns the receiving-app boundary; extend it rather than add a competing owner or case. |
| Replacement, aliases and ejection | expand | OMH-239 | Add semantic decisions and require three exact installed CLI source reads. Decision labels alone were insufficient evidence. |
| Fresh scaffold context growth | measured budget calibration | OMH-008 | Actual fresh classic initial context is 41,892 bytes, exceeding the old 40,960 ceiling. Use 45,056, matching the readiness branch; exclude temporary local artifact-map overhead from the measurement. |
| Private-helper export checks, artifact buffers and preserved integration IDs | evidence only | existing CLI tests | Implementation correctness checks do not introduce a separate extension or routing topic. |

## Failure-first and owners

| Case | Sanitized failure before owner edit | One primary owner | Result after edit |
|---|---|---|---|
| OMH-239 | New semantic guide regression fails against the old guide. Live routing with three mandatory installed-source reads fails 0/1: none of those reads was selected/observed. Sanitized result SHA256 `053bfe87f6fb46b074dfe42f830df3ae9181ab5e9f816b7e9ebd7f75bd787d31`. | `.ai/guides/module-tool.md`, authored at `packages/create-app/agentic/guides/module-tool.md` | Final live Codex routing passes 1/1 in 31,725 ms; result SHA256 `46eaa3ae66415b9a8b0cc3ad910592e922c82d55be670684ad3b44015c3d8ed6`. |
| Ordered provider replacement | New ordered-stage regression fails before the correction, requiring successful intermediate generation/build. | Same module-tool guide | Focused regression passes with both intermediate and final verification stages. Public CLI documentation agrees. |
| OMH-008 | Deterministic fresh-scaffold context exceeded the former initial ceiling. | Existing trim-module skill, unchanged | Final live routing passes 1/1 in 32,944 ms; result SHA256 `e5048c17de860f774ba2c5a26bfca7050ec7f8b056b490a562a8c58a11231750`. |
| Fresh controller preparation | The old controller rejected the real generated Yarn template before preparing any writable target. New focused template-copy test fails at base. | Existing release controller | Real default, HTTP and HTTPS generator output, including CRLF, copies byte-for-byte. Altered cooldown/preapproval, auth fields and credential/query URLs fail before copying. Machine controller independently proves base fail and head pass. |

Owner inventory: module-tool is source-required and renders exact links to installed `module-install.ts`, `module-identity.ts` and `eject.ts`. Root routing instructions and the architecture pointer remain self-authoritative and unchanged. The module-scaffold skill retains its supported-tool pointer. The ejection skill retains its approval and verification procedure; it is not a second owner of installation identity. No ordinary example extension surface changed, so no new example integration test is declared.

## Synchronized surfaces

| Catalog/schema/matrix/spec/doc/test surface | Before | After |
|---|---|---|
| Cases / writable cases | 239 / 49 | 239 / 49 |
| OMH-239 exact source links | 0 | 3, visible in the primary guide and source inventory |
| Source inventory records / source-required / owners / rendered links | 150 / 125 / 33 / 127 | 153 / 128 / 33 / 130 |
| Pinned parity assets / dispositions | 8 / 136 | 8 / 136, unchanged |
| Validators, oracles and release matrix | Existing analysis/routing mode | Unchanged mode and certified lanes; no oracle weakened |
| Catalog, guide, projection, source topics, README, spec and tests | Previous installation contract | Regenerated projection and coherent receiving-app contract |
| Packed CLI/create-app guide SHA256 | Previous guide | `4943772acfd4e5802427c9f153056d5690718260157f9f8dfa116ab1ae2c251e` |

## Validation

| Command/lane | Runner/model/version | Result | Sanitized artifact or reason unavailable |
|---|---|---|---|
| Focused guide regression | local Node 24.19.0 with tsx | PASS 2/2; controller independently proves base-with-test-only fail and head-overlay pass | `standalone-harness-knowledge-change-224cbccb8572.json` |
| Owner/source-link/baseline/root-budget suite | local Node 24.19.0 with tsx | PASS 50/50 | Proper package test loader preserves TypeScript import resolution. |
| Catalog and read-policy suite | local Node 24.19.0 with tsx | PASS 152/152 | Installed-source fixture includes the three exact CLI source files. |
| Release-controller and generated-template regressions | Linux, regular installed dependencies, Node 24.19.0 with tsx | PASS 52; 4 skips | Three macOS-only cases and the old browser test's architecture-specific probe skip on Linux ARM64. A separate real Playwright browser launch passes with installed headless revision 1248. The macOS shared-symlink run had 45 passes, 4 protected-dependency rejections and 5 Linux skips; it is not counted as passing full-suite evidence. |
| Source links and generated inventory | local Node | PASS 153 records, 128 source-required, 33 owners, 130 links; 8 pinned assets and 136 dispositions | Regenerate-and-check gates retain exact source ownership. |
| Packed applicable presets | packed create-app and final CLI artifacts | PASS empty, crm and wms; final classic controller also passes | All three installed source hashes and guide hash match the worktree; declared context 56,277 / 56,441 / 56,368 bytes, within the existing 73,728 initial and 81,920 total ceilings. |
| Focused OMH-239 and OMH-008 certified routing | Codex CLI 0.163.0; default model selector | PASS 1/1 each | Sanitized result hashes above; fresh process per case. |
| `yarn harness:validate --all` | Linux container, Node 24.19.0 | PASS 239/239 | Final packed controller, including the measured OMH-008 ceiling. |
| Knowledge-change machine validation | local controller, knowledge-contract | PASS; source-link/context-read/evaluator contracts; both focused files prove base fail and head-overlay pass | Sanitized evidence export above. Original controller output SHA256 `e4f76c695adbf492eb1f412cefa4237d5fa7a85706b8fa15ba2a54e7f588ddbe`. Ignored build copies are verified independently by packed hash checks; the manifest maps the tracked generated inventory projection. |
| Full `yarn harness:release --runner codex --prepare-targets <absolute-empty-dir> --acknowledge-writes` | Disposable Linux container, Codex CLI 0.163.0; default model selector; portability not requested | RUNNING | Primary Codex owns every blocking live lane. Exact Playwright Chromium/headless runtime 1248 is provisioned; nested sandbox host isolation probe passes. Full sanitized report hash/status will be recorded when it finishes. |

## Blockers or evidence-only decisions

- Full release completion remains required; deterministic and focused passes do not waive it.
- Initial preparation correctly rejected the disposable scaffold's generated local environment file; it was removed while the example was retained. The next preflight exposed the controller's old generated-Yarn whitelist, repaired through the exact-prefix compatibility regression above without changing package-install policy.
- A label-only pilot passed against the previous guide. Mandatory exact source reads were then added; the before-owner run failed, demonstrating the actual missing contract.
- Temporary local package archives replace unavailable unpublished workspace versions for verification only. No registry publication or production dependency change occurred.
- Runner authentication is supplied through one read-only runtime file; evaluator tools and writable validations use isolated environments. No broad credential mount is used.

## Sanitization attestation

No raw diff, commit/PR body, private prompt/transcript, credential, token, environment value, absolute path, remote URL, or author identity is included. The machine evidence export normalizes only the local executable path to `node`; it retains the controller's exit codes and output hashes and identifies the original controller output by hash.
