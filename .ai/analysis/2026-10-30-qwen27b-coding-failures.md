# Stopped Qwen 27B coding experiment: case-by-case analysis

## Scope and provenance

The user stopped the experiment. There are **13 completed coding failures and one interrupted task**, not 14 completed failures. No result is reclassified as passing. Pending catalog tasks were not run.

Model `qwen3.8:27b-mlx`, Pi 1.4.0, Ollama 0.40.8, local macOS arm64; sequential fresh processes with a 600-second ceiling. A local-only temporary transport uses the existing Claude CLI slot to invoke Pi; no Claude inference or official Pi-runner certification is implied. The local-source framework scaffold is version 0.10.0, originally recorded against repository `a2be0f1ab`. New work is based on `fd7c06569bd5fa282716b28e1375d2ddb2cc1eea`. The relevant original case, oracle and inspected examples are unchanged except unrelated OMH-039 SMTP coverage in the newer catalog.

The local Ollama tag is not an independent upstream release attestation: its server metadata reports family/architecture `qwen3_5`, 27.8B parameters, NVFP4 weights and a 262,144-token context length. These identify the current local artifact; they do not establish that quantization caused any particular failure. Declared server sampling defaults are not proof of effective per-request overrides. Fresh comparisons preserve the original transport and model selector.

Raw private captures remain local. Early 009/011/012/014 attempts have retained generated code and structured evidence but no original visible prose. Diagnostics in stored evaluator violations are truncated, so generated sources and exact installed contracts were also inspected.

| Case | Real output / model failure | Demonstrated harness defect or delivery gap | Smallest proposed correction |
|---|---|---|---|
| OMH-009 | Wrong MikroORM index column shape; generated entity does not typecheck. | Linked entity/validator/snapshot examples were refused. | Grant only the existing relevant source capabilities; keep the typecheck. |
| OMH-011 | Invalid CRUD metadata keys, missing exported metadata and nonexistent PATCH handler. | Linked canonical CRUD/OpenAPI examples were refused. | Repair exact example delivery; keep actual method/export checks. |
| OMH-012 | No runMutationGuards call, nonexistent commandBus singleton, original checkout stub unchanged. | Task does not identify its seeded checkout endpoint; linked command examples refused. | Name seeded entrypoints centrally and grant bounded command examples. |
| OMH-014 | Timeout; real invalid APIs/import depth and incomplete implementation. | Linked UI examples refused; structural scan misses components reachable from backend pages. | Follow only reachable module-local component imports; preserve orphan and typecheck negatives. |
| OMH-026 | Invented package/host, broken widget/save wiring and type errors. | Oracle expects an enrichMany call instead of an exported method; canonical examples refused. | Align connected enricher shape and source capability grants. |
| OMH-027 | Wrong host/InjectionPosition import, unsupported declarations and inert bulk action. | Mandatory initial closure exceeds its ceiling; oracle demands host extensionTableId in an injected contribution. | Measure mandatory closure, supply exact examples and validate actual contribution contracts. |
| OMH-029 | Invented replacement/types/URLs, disconnected entry and undeclared test runner. | Oracle expects singular page rather than routes.pages; canonical registry is outside write/read scope. | Permit the exact registry edit; require connected actual page overrides. |
| OMH-031 | Preserved obsolete match shape; invented bridge/fallback and untrusted scope. | Fixture itself teaches the obsolete interceptor ABI; predicate can admit disconnected untyped code. | Use a typed but behavior-broken current-ABI seed and meaningful interceptor checks. |
| OMH-042 | Timeout; invented adapter/interface/imports, invalid type-only instantiation and incomplete effects. | Relevant examples refused; required module facts were not read; actual initial reads exceed ceiling. | Supply exact relevant facts/examples and seeded paths; retain contract/effects/typecheck checks. |
| OMH-045 | Wrong file and ABI; original lib/client.ts unchanged; malformed test, wrong cursor/fetch and SSRF behavior. | The exact seeded client path is not disclosed in a tool environment without discovery. | Expose bounded seed paths and preserve input/effect/return ABI requirements. |
| OMH-049 | Timeout; ai-agents.ts missing and invented AI-tools import. | Canonical examples refused; separate AST check expects provider/model instead of defaultProvider/defaultModel. | Repair grounding and current agent-definition predicate; missing artifact still fails. |
| OMH-054 | Wrong file and ABI; original workflows/call-api.ts unchanged; undeclared test globals. | Broad prepared search makes QA files mandatory and allows huge optional instructions; AST demands unrelated dead fetch/header code. | Expose seed, narrow exact production evidence with preflight bounds, align AST to the real reserved-key effects seam. |
| OMH-057 | Wrong file and filter ABI; original api/scope/route.ts unchanged; TS narrowing fails. | Exact seed absent from prompt; required routed closure exceeds total budget. BC exists but was not observed. | Expose seed and calibrate only proven mandatory closure; keep every fail-closed behavior probe. |
| OMH-060 | Operator-interrupted; no completed evaluator result. Guessed filenames and no canonical command edit. | Seeded commands/update-record.ts is undisclosed. | Account as interrupted, not failed; validate seam disclosure and run a fresh attempt separately. |

## Shared owners and protected checks

The initial fixes use four existing runtime owners: the case/context catalog, evaluator prompt/preparation, writable structural oracles and fixture seed catalog. Recovery additionally requires an optional Pi delivery hook for demonstrated client-side truncation and current-factory recognition in the existing fresh-scaffold config validator. A validation-discovered CLI cache defect also requires its external build-input declaration. Supporting regression tests and generated inventories are required; do not add one prose rule per observed failure.

- Writable self-reads are already permitted and excluded from instruction budgets. Unexpected selectedContext entries in 029/031 are model/protocol violations; clarify instruction/fact-only bookkeeping without broadening the security allowlist.
- Reference delivery must use existing exact, readable source capabilities and preserve QA-only, unrelated-source, traversal and credential denials.
- Expose only safe, case-owned seeded paths and their existing source contracts. Do not reveal oracle answers or internals. Sidecar-only implementations must continue to fail the unchanged executable entrypoint.
- Prepared context must be exact and feasible before inference; match count does not bound file bytes. Avoid requiring QA-only hits or permitting whole installed snapshot trees.
- Fix false-negative AST predicates with compiling current-contract positive controls and disconnected/comment/orphan/wrong-scope negatives. Historical generated outputs still have genuine type or behavior failures.
- Preserve the original scores. Fresh Qwen runs use separate disposable targets and report first-attempt results, generated checks and remaining failures honestly.

## Retained evidence hashes

Hashes identify the local sanitized evaluator record and retained generated-file snapshot without committing their bodies.

| Case | Evaluator SHA-256 | Generated snapshot SHA-256 |
|---|---|---|
| OMH-009 | c3d86805702c3ad350d922d512d1b8c3f41a581455db4a97b55b7ceeb59d5696 | 5d2febf70652bedccf2fd874a23952ce26532102c2a4c346b7af0172995141fb |
| OMH-011 | d2bf36276b5a594f873c7c14ce59ee80b70e4956cb532c3c39e3d194e1699381 | e3d0d80a0c95ae89b14c69fcea76bee43012e1ad73399bf2a475534160723529 |
| OMH-012 | 8d0e1ede8494263f3e1cd760ac8c9f84e3bd51f3502b1411d1da47a4c8465cb6 | 61aa77ef63568d06f383ad9c86162467afbafb8179b689e4b9e11bf1df9f82cb |
| OMH-014 | 7a20f9e7b832e05d6664628d40d1b490a7827928786b94a9cdff20fe5d6109b5 | 7864614275a3a1e76372ec76410a33aa8e44e3520779aec70016e7fd3615224c |
| OMH-026 | 21b048378181a86f42131b440dbcd6af02cee4e14903bc162332e2161d58aacf | 75e9bc9151100b01855ac3ee122173f87dee3b829ba41eff7a94564693123937 |
| OMH-027 | 2828a8ca3c961a01935ed7f5824577c4a1908f0ad3b52d85bf9913f62769992d | a977886dfa202d7a6e456842476d0b5b0c7e46396bfc8c221dcc1de0ab7b5d95 |
| OMH-029 | b88294910ffadbce922db41bd35ca2402ee160911ca3490d2ac7f6eb7be6a2e2 | 882f1ab39cdbd208ea6f430a4170e0fb6347a1644f570cdb3ea788417c837397 |
| OMH-031 | 97ebaf7bfa682aea961837df708607bdc715437659ca3aac5b52d26e93286740 | cec8c29ed37a042547f6648e8c98da0c207170919300395fb85b530802d98ee6 |
| OMH-042 | 34dc7ebb314b8beb947cf20bdce25a37b693e1c32ec18f32e460b407ce77c4b0 | 72b0c60e02f90b238c716f985f44efa9baf874d766299b6ba6928c3a0a939ab6 |
| OMH-045 | 93bc43f98f33aa47cebb13ff9b92babb16f860703e76d93f4f8d76d48f9a6d90 | fb882259e773314aaeb47fa599ac04e895236dcf524ebe28a73a247b4e12a405 |
| OMH-049 | 759114eec2d3aa9d6a51d204d548f22dd2fc9e409dcbecb18ff2b46174d1bf59 | 6d127adbf819168c44c7a6cbdd8d1beb3dbc4f4c3c8286dc15d496c4a67fa685 |
| OMH-054 | 4ab4e65022a00be4acf05515730acdd05f8b7507f0aec0d336755e80c9e37861 | 98b3166c2cbf6d86542f44d307f78b5b648b3436b210f8dd382b7d6bc34c4197 |
| OMH-057 | fd4368d4533d08c687d4fb4296da148c4ba05ce7b9b139acb0e57c964de568b1 | c6d7261713632b199b4a7e5bbf4e798c54e3670e2445c996799c08814383ce3a |
| OMH-060 | Unavailable / interrupted | Unavailable / interrupted |

## Validation status

[Round 4 per-case results](2026-10-30-qwen27b-round4-results.md) track the complete fourteen-case rerun, including narrower implementation outcomes and content-free evidence hashes.

The first three recovery experiments are stopped. The fourth complete fourteen-case run started at 17:34:54 UTC on 2026-10-30, frozen to source `b478b301e4ee3af3e78380a6e4df0c398ee95617`, after all preparation and repository checks passed. Full-case results and implementation-oracle results are recorded separately; neither is a complete release certificate. The frozen-target attribution below remains historical evidence.

Round 4 is frozen after six completed cases (0/6 full passes, 1/6 implementation passes, three timeouts, eight not run), without interrupting an active case. The shared permission-input defect was reproduced before its fix; a separate corrected full fourteen-case cohort is being prepared. Follow-ups are implemented in candidate `9af38b204` (canonical projection itself is in `c4bc1ab10`): exact canonical permissions in the existing prompt, corrected public-contract delivery classification, and root ownership/Jest/module-locale clarification. [Read-scope regression evidence](2026-10-30-qwen-harness-read-scope-regression.json) and [compatibility-read evidence](2026-10-30-qwen-harness-bc-read-regression.json) record focused checks. Exact final-test knowledge and complete repository/packed validation for this candidate are running, with fresh-model results pending. The next local run uses a disclosed 1,200-second operator timeout versus the earlier 600 seconds; no isolated causal score improvement is claimed; the following pass belongs specifically to the earlier scored source.

The true-base knowledge controller passes at source commit `b478b301e4ee3af3e78380a6e4df0c398ee95617`, against `fd7c06569bd5fa282716b28e1375d2ddb2cc1eea`. Each focused test is overlaid alone onto the base, and the same test runs against the complete fixed tree:

| Focused regression | Base exit | Fixed exit |
|---|---:|---:|
| Coding reference grants and context bounds | 1 | 0 |
| Seed paths and bounded installed-context delivery | 1 | 0 |
| Current typed interceptor seed | 1 | 0 |
| Connected writable AST contracts | 1 | 0 |
| Actual Turbo cache invalidation and restored output | 1 | 0 |
| Complete approved Pi read delivery and guard boundaries | 1 | 0 |
| Current factory Yarn policy through canonical preparation | 1 | 0 |

The reproducible authored input is [2026-10-30-qwen-harness-knowledge-change.json](2026-10-30-qwen-harness-knowledge-change.json): seven authoritative files and seven focused regressions cover all 240 catalog IDs. Raw controller output remains local because it contains the actual executable's machine path. The [sanitized version 6 summary](2026-10-30-qwen-harness-knowledge-result-summary-v6.json) SHA-256 is `0a3da019d383c4999463a33d8678633e9a3db0959867087e8b1953fd7af18240`. Prior results remain available: [version 5 at 4e1a67552](2026-10-30-qwen-harness-knowledge-result-summary-v5.json), [version 4 at 6c68fee7c](2026-10-30-qwen-harness-knowledge-result-summary-v4.json), and [version 3 at 0692dbed2](2026-10-30-qwen-harness-knowledge-result-summary.json). Each remains bound to its original source hash. A retained intermediate controller attempt failed because an inherited Mise shim could not launch the contained fake Node executable; rerunning with the actual Node 26 binary first in PATH passed without source or check changes.

Fresh packed and clean Verdaccio scaffolds pass generation, typechecking and the selected deterministic 14/14 at both `f40d9e798` and `0692dbed2`, through separate controllers and physical dependencies. The `0692dbed2` controller was fetched from a dedicated temporary registry/cache: all 43 archive integrities match, 41 archives remain unchanged and the CLI/create-app archives carry the new evaluator. Five authority hashes match across seven source/emitted/installed surfaces, including the actual wizard and CLI refresh. All fourteen deliberately broken fixtures fail their before oracle; all fourteen actual writable prompt/framework preparations pass, covering 22 declared source references without new grants or retained raw prompts. That registry service was removed after validation. The sanitized packed-validation summary SHA-256 is `1ecc7da08eb6ee393100d7806fd8c5590c4109ae6c6b812b2cda8cd08dcd1265`. The final independent `b478b301e` cohort also passes baseline generation/typecheck, all 43 archive-integrity checks, seven authority assets across seven source/emitted/installed surfaces, fourteen canonical target preparations and generations, fourteen genuine before-oracle failures, and fourteen actual prompt/framework projections. Parser controls (31/31), result-binding controls (9/9), collector and sandbox smoke pass before inference. The content-free preflight summary SHA-256 is `1016d4765cab63a5243a8be6163f2ec2d09b80135a644dc30c3843a8816f6bcc`. Earlier scaffold verdicts remain bound to their own source hashes.

The complete deterministic catalog remains 236/240, with unchanged budget deficits in OMH-008/082/153/155. Their caps were not changed.

Normal cached builds exposed another delivery defect: the CLI restored an older embedded harness because sibling knowledge sources were absent from its Turbo inputs. The exact copied authority inputs are now declared, and both actual restored-output tests and normal source/create-app/CLI hash parity pass. Caching remains enabled.

The full release command was attempted from the coherent controller and stopped with exit 2 before model execution: macOS lacks the isolated-loopback lane that requires Linux/Bubblewrap. The experimental Pi transport and missing certified lanes remain explicit limits.

All eight configured repository validation commands passed with the local runner at `0692dbed2`: build packages, generate, build packages again, translation sync/usage, typecheck, all 51 workspace test tasks and the app build. An earlier full-run `CrudForm.transformData` test failure is retained alongside its isolated 3/3 pass and unchanged-source full ordered retry. Heavy validation completed before Round 2 inference. The same full ordered gate also passes at final source `b478b301e`: all eight commands exit zero, all 51 workspace test tasks pass, create-app reports 1,102 passing tests and five platform skips, and the app build passes. All heavy checks completed before Round 4 inference. These are repository checks; they do not attest that model-generated artifacts pass their separate gates.

## First recovery experiment

Source `f40d9e798` was tested through the same local Pi/Ollama transport and 600-second invocation limit. This experiment is stopped and retained separately from the original and the next experiment. Five completed tasks failed their full canonical case; OMH-011 passed its implementation oracle, which is a narrower result.

| Case | Full case | Implementation oracle | Attempts / corrections | Remaining observed cause |
|---|---|---|---|---|
| OMH-009 | Fail | Fail | 1 / 0 | Canonical examples were read successfully; unsupported Vitest import and extra testing route remain. |
| OMH-011 | Fail | Pass | 1 / 0 | Generated code passed structural/type checks; source-owner read order, a refused undeclared read, and extra testing route failed the complete case. |
| OMH-012 | Fail | Fail | 1 / 0 | Timeout with wrong APIs/signature, missing guards and atomic flush, and untrusted header-derived scope. Correct seed and permitted command example were read. |
| OMH-014 | Fail | Fail | 1 / 0 | Timeout, invalid table/conflict wiring and TypeScript failures. Exact permitted UI examples were never attempted. |
| OMH-026 | Fail | Fail | 2 / 1 | Final timeout and incomplete/incorrect enricher/save implementation. A transport parsing defect caused the one unnecessary correction. |
| OMH-027 | Operator-interrupted | Ungraded | — | Stopped to supersede the known adapter and context defects. |
| OMH-029/031/042/045/049/054/057/060 | Not run | Not run | — | Pending when the experiment stopped. |

The transport defect is outside the shipped harness: the last visible OMH-026 response contained a 329-byte prose prefix followed by a multiline JSON object. The object validates against the unchanged routing-response schema, but the old adapter recognized only whole-text, fenced or single-line objects. Its failure to extract this object triggered the evaluator's correction policy. The separate Round 2 adapter handles bounded top-level JSON containers and passes 11/11 synthetic positive/negative controls, compared with the old parser's 4/11. It does not repair values, unwrap nested answers or replace later invalid payloads with earlier valid ones. No original or Round 1 score is changed, and no first-attempt code pass is inferred without a retained implementation attestation.

The Round 1 observations justify one further shared context change in `0692dbed2`: project the already-declared instruction-to-source references into exact owner/source/access metadata, and disclose the immutable baseline package's real test script with a content hash. This addresses guessing and missed references without embedding expected routing answers, adding read permissions or counting metadata as an observed read. The 351 focused tests pass; read-only prompt bytes remain unchanged. Timed inference in Round 1 overlapped repository validation and installation, so its throughput and timeout counts do not establish isolated model performance or causal improvement.

## Explicit-context recovery experiment

Round 2 used the independently packed `0692dbed2` controller after all heavy repository/scaffold validation completed. It is stopped and frozen: OMH-009 completed with full-case and implementation-oracle failures (two attempts, one correction); OMH-011 was operator-interrupted and ungraded; twelve cases were not run.

In OMH-009, the prior unsupported Vitest import and extra testing-route mistakes are absent. The correction attempt followed all three declared source references in the correct order. Its final generated source still fails real typechecking: a validator rewrite leaves imports of missing exports in earlier test/API/command files, and a newer test omits its Jest globals. Two generated migrations both create the same table; that is a static finding, with no database execution or additional score assigned. The refusal of an undeclared canonical `index.ts` read is a valid capability boundary, not a denied required reference.

The format correction has a separate local transport cause. The first response contains one schema-valid fenced JSON object followed by explanatory Markdown. The strict parser introduced for Round 2 rejects trailing prose, including an inline JavaScript `{ transaction: true }` expression that is not a later JSON answer. The model failed the requested response format, and the adapter also imposed an avoidable extraction failure. Installed Pi's JSON mode emits events rather than constraining the final answer schema. The next local parser uses bounded Markdown-aware answer-container extraction while retaining exact values, canonical validation, and fail-closed handling of later genuine malformed/schema-invalid answers. No historical result is regraded; no first-attempt code pass is inferred from a valid routing object.

The frozen Round 2 analysis hashes are `dbf896905e140d5bc87d52ee5760ea54a5236f6fec35f5792624fb0eee523c9d` (Markdown) and `a8737e840a0ae52cecb9525d21d49e67d9d28b5f30413359d7c22dc9e380f6b5` (JSON). The content-free response-normalization audit SHA-256 is `91e36ea7c07e49b35c408dff93ed8b8981d320750b79dee64d99405694c51484`. Original scores, both prior reports, the frozen original-before lane and all eleven controller assets were verified unchanged.

A separate capture-order counterfactual replay reconstructs the first OMH-009 implementation from eleven complete successful writes into eight files through the canonical MCP guards. All eight structural checks pass, but the unchanged canonical typecheck fails on incorrect API relative imports and unsupported CRUD configuration fields. That API file is byte-identical to the retained final API, so these errors predate the format correction. The later stale-validator-export error is a separate regression; the retry did not turn a demonstrated passing implementation into failing code. The replay has no original first-attempt filesystem/oracle attestation or per-tool completion timestamps and does not regrade routing or historical scores. Baseline/dependency pins and frozen artifacts remain unchanged; no model, DB/API, generated tests or build ran. Sanitized replay evidence SHA-256: `8302f5c63083a0a92eda4fa3d13c6de84b0282a9839782ea9b413bad5164eb74`.

## Markdown-aware local transport recovery

Round 3 retains the same model, system prompt, timeout, correction policy, canonical schema/grader and all eleven controller assets. Only the local response parser and fresh report/runtime bindings change. Its bounded Markdown protocol selects JSON answer containers rather than explanatory code examples; a later genuine answer controls even when malformed or schema-invalid. It does not unwrap nested answers, repair values or choose a candidate by its grade.

The final parser passes 31/31 synthetic regressions, compared with the frozen Round 2 parser's 17/31 on the same tests. The parent independently reviewed ordinary Markdown/code examples, later invalid answers, standalone inline answers, nested containers, quote/multiline handling and resource bounds. Parser SHA-256: `01053bc7a7588115b2dd8e77df6a40c2fdc55f90c0aa55c452e3f9f1146823b8`. Both previously observed response shapes normalize to their exact schema-valid objects; no earlier score changes.

Fresh fourteen-case fixture/before-oracle, prompt/framework projection and selected deterministic checks pass. Authenticated collector self-tests, version-only canonical sandbox and dry-run checks pass before inference; the source/dependency cohort is unchanged. The sanitized preflight summary SHA-256 is `2802ca1591872962a9bdca743fe80ee3e19be7fba1aac7c4654e9d7479746fb4`. The complete model-result matrix is pending; these setup checks are not model passes.

## Confirmed native Pi MCP truncation

The installed Pi 1.4 CLI bundle middle-truncates direct MCP text above 20,480 bytes. In Round 3, OMH-009 successfully read a 47,378-byte canonical surface map and a 20,970-byte migration snapshot. Applying that exact installed converter to those immutable source bytes produces approximately 20 KiB plus a truncation warning, omitting 91 and two complete nonempty lines respectively. The full-output pointer is unusable: built-in filesystem/shell tools are disabled, and `harness.read` permits neither the absolute temporary path nor offset/limit recovery. The read ledger therefore measures successful server reads, not complete model delivery.

All fourteen cases have eligible guide/source files above this limit, including both optional and mandatory context. This is not a claim that every case actually read every oversized file. The content-free audit pins the paths, byte counts, source hashes, actual bundled converter and deterministic reproduction; its SHA-256 is `af5c3883fc9d3425c1976a72c9c0c31ac007e7bede4cd978b325eb40115a10f2`. Captures retain paths/status rather than raw read bodies, so the proof is exact-version reconstruction, not a captured wire attestation. Specific coding-error causation remains unproven; key OMH-009 contract markers survive the clipped map.

The correction is implemented in `344f63c3b`: one optional shared Pi extension. Its supported `tool_result` hook receives the original untruncated structured MCP result after conversion and replaces model-visible content in memory. It requires the exact successful harness read identity and one text block within the server's existing 256 KiB bound, preserves unrelated tools/errors and explicitly fails malformed or oversized successful-read delivery. It needs no filesystem recovery, additional tool/read grant, provider dependency, model change or grader change. Existing recursive scaffold copying and Turbo inputs cover the new asset.

The focused regression has four semantic failures and one passing control without the hook; all five pass afterward. Source generators and both normally built package owners bring the focused total to 8/8. Actual native converter/registered-hook/session/provider proof restores 60,027 bytes from a 20,653-byte clipped result. Separately, the actual bundled extension loader runs the emitted asset inside the canonical network-none sandbox: it registers one hook and no tools, restores all 60,019 bytes from a 20,645-byte native result, and serializes exactly one complete provider tool message. Source/create-app/CLI extension SHA-256 is `a606dd1d305261ff3ab66831b89107e9767f4f36bb07b94deadb38b6084fbe44`; the emitted-loader proof SHA-256 is `7b92252c02abbcde8aeac3891cc6623d48eb7b1f40c9e36b52fca679a11207b5`. No model, network or temporary-output recovery call ran in those probes. A fresh full model-result matrix remains pending.

Round 3 stopped cleanly after two completed cases: OMH-009 passed on its first attempt with zero corrections; OMH-011 failed only for an undeclared reference attempt. Both implementation oracles passed. No case was killed, and twelve remain not run. The frozen analysis hashes are `30012ecb734ef560273d3f487498f0fccbdd7acc49701e5647753a22af1a6934` (Markdown) and `1f35949e1bef35e9578d3a6a83b3e92103c4be9c46d4e53bdd65e318a2dceaf2` (JSON).

Additional OMH-009 app validation failed during workspace preparation, before any generate/typecheck/lint/build command ran. The private experiment copier omitted `verbatimSymlinks`; Node changed a safe 48-byte relative skill alias into a 103-byte absolute backlink to the controller. The canonical validator correctly rejects this already-escaping target, and its own scaffold-copy helper correctly remaps contained aliases. The next experiment will reuse exported canonical target preparation. No upstream guard change, old-target mutation or passing validation attestation is justified. The symlink audit SHA-256 is `62e436618ae86e30096cd2bdef10afafa8726b4488e6c09c9ca090446a6fe79c`; actual failed validation returns are pinned by `a1f0ece28059e4ef4a48566f904790ebae43408fe17632845fdd3a889c553e15`.

## Current generated Yarn-config compatibility

Canonical preparation of the next fresh scaffold rejects its valid generated `.yarnrc.yml`. The wizard proof and controller files are byte-identical (901 bytes, SHA-256 `a2a97744f00de02ebe41e020f742263bf4bc08f1093f1aef5c3a415ab4f84502`) and exactly match the current template prefix/suffix and registry generator. The existing recognizer accepts older bare/migrated forms but not the current comments, `npmMinimalAgeGate: 5d` and sole `@open-mercato/*` preapproval. This is a shipped compatibility defect, distinct from the earlier private symlink-copy mistake.

The failure-first regression uses the real template, real registry renderer and exported canonical target preparation. Default, loopback-HTTP and HTTPS factory variants fail at the stale guard; sixteen unsafe mutations remain rejected. The correction in `4e1a67552` accepts the exact current prefix and bounded full-line comments, preserves legacy forms, and rejects literal registry interpolation. Current configs remain byte-identical; no security settings, release commands/lanes or generators change. The focused regression passes 4/4 with 26 unsafe variants; the full release-helper suite passes 49 tests with five platform skips, and package typechecking passes. One retained initial helper-test invocation used the wrong inherited Mise PATH; the unchanged-source retry with explicit Node/Yarn paths passes.

The independent factory audit SHA-256 is `157d73c21bb9c3f5581308fe6f46a7eecb131b5f5dbc77acb7c478ba8fc77d0c`. A cheap diagnostic using the corrected source preparer against the preserved real factory controller succeeds: all 22 relative aliases are contained, and all 1,698 copyable files/aliases remain unchanged in the source controller. This is a preparation diagnostic, not certification of a new package cohort or a model pass. Failed preflight candidates remain retained without model execution.

Review caught a parser mismatch introduced by comment filtering: a bare carriage return could hide a directive from the guard while actual Yarn treated it as a new line. A harmless unknown-key probe against the pinned Yarn CLI reproduced the mismatch without executing a plugin. `b478b301e` adds one early bare-CR rejection before filtering, preserving ordinary LF and native CRLF configs. Two regression tests fail on the intermediate guard; all seven focused config tests pass afterward. Combined with the existing release-helper suite, 56 tests pass with five platform skips. No config is rewritten and no release command, lane or sandbox boundary changes.

## Offline attribution on the frozen generated targets

Replayed the unchanged retained source through the legacy and corrected structural oracles, deliberately using `--phase before` for structural-only checks. This avoids executing target scripts or writing build caches; it is not a new before-edit model attempt. Existing isolated behavior probes were also replayed where configured. The original typecheck diagnostics remain historical evidence and were not rerun. No historical score is changed.

| Case | Corrected structural replay | Unchanged behavior / remaining evidence |
|---|---|---|
| OMH-009 | Structural checks already passed before this repair. | Original entity typecheck failure remains recorded. |
| OMH-011 | Structural checks already passed before this repair. | Original CRUD typecheck failure remains recorded. |
| OMH-012 | `command.guards` still fails. | Original typecheck failure remains recorded. |
| OMH-014 | Invalid exit 2: retained rendered-component import cannot be resolved. | No completed comparable check set; do not count the old UI complaints as removed. Original typecheck failure remains recorded. |
| OMH-026 | `umes.enricher` still fails. | Original typecheck failure remains recorded. |
| OMH-027 | `umes.table-id` still fails under the corrected contribution predicate. | Original typecheck failure remains recorded. |
| OMH-029 | `umes.page-override` still fails. | Original typecheck failure remains recorded. |
| OMH-031 | `umes.interceptor-scope` still fails. | No typecheck failure diagnostic was recorded; this replay does not imply a fresh typecheck pass. |
| OMH-042 | `provider.adapter` and `provider.effects` still fail. | Original typecheck failure remains recorded. |
| OMH-045 | `rest.url` and `rest.retry` still fail at the unchanged canonical client. | Retry response/count/cursor and private-endpoint probes still fail. Original typecheck failure remains recorded. |
| OMH-049 | Expected agent artifact and source are still missing. | Original typecheck failure remains recorded. |
| OMH-054 | Obsolete `workflow.activity` and `workflow.idempotency` complaints disappear; structural checks now pass. | `idempotency-survives-rollback` and `reservation-precedes-transaction` still fail at the unchanged canonical activity. Original typecheck failure remains recorded. |
| OMH-057 | `regression.fail-closed` still fails at the unchanged canonical route. | All four scope/query behavior probes still fail. Original typecheck failure remains recorded. |
| OMH-060 | Interrupted task; unchanged seeded baseline still fails `regression.atomic`. | `rolls-back-all-phases` still fails. Excluded from completed-failure attribution. |

All fourteen independently computed target source/config fingerprints were identical before and after replay. The original stopped summary hash was also checked before and after. No generator, target build/lint/test/typecheck, model process, or original-report writer ran. The isolated replay removes an artificial structural requirement for OMH-054 while retaining meaningful behavior failures; it establishes no complete implementation pass.

Content-free evidence pins this specific replay, including OMH-014's invalid classification before authoritative review:

- Legacy structural oracle SHA-256: `b8035e423fac9db8d0e779d4bd339a148d4d25f34265297567b74cad3cc489b5`.
- Corrected structural oracle SHA-256: `ea015b409bef16fec9b747168d08eb31f8094173e6af1adfe24e22acfba7c392`.
- Unchanged behavior oracle SHA-256: `96a5f781527555b7ef61ed6ea6a656b70f0b2ce4afd9325e0494bb22a36f0e65`.
- Ignored machine replay report SHA-256: `88a47a66efb2189e82d6ff01364decf401d4b42b218e61b0baae2299a2e7d48f`.
- Ignored sanitized table and per-case before/after fingerprint report SHA-256: `fb9be412edebe3491e34f42147315fb4e3204b42deaa1407c6362ce7d529d085`.

Raw per-case results and complete before/after fingerprints remain local. No generated code, private response, credential, environment value, or absolute machine path is included here.
