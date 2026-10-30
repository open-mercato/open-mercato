# Stopped Qwen 27B coding experiment: case-by-case analysis

## Scope and provenance

The user stopped the experiment. There are **13 completed coding failures and one interrupted task**, not 14 completed failures. No result is reclassified as passing. Pending catalog tasks were not run.

Model `qwen3.8:27b-mlx`, Pi 1.4.0, Ollama 0.40.8, local macOS arm64; sequential fresh processes with a 600-second ceiling. A local-only temporary transport uses the existing Claude CLI slot to invoke Pi; no Claude inference or official Pi-runner certification is implied. The local-source framework scaffold is version 0.10.0, originally recorded against repository `a2be0f1ab`. New work is based on `fd7c06569bd5fa282716b28e1375d2ddb2cc1eea`. The relevant original case, oracle and inspected examples are unchanged except unrelated OMH-039 SMTP coverage in the newer catalog.

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

Prefer four existing authoritative owners: the case/context catalog, evaluator prompt/preparation, writable structural oracles and fixture seed catalog. Supporting regression tests and generated inventories are required; do not add one prose rule per observed failure.

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

Analysis only at this checkpoint. No fixed case or generated app is claimed to pass. Required follow-up: fail-before/head-pass semantic tests, bounded context consistency, fresh coherent/packed scaffold, actual affected local-model reruns and eligible generated-code/release checks. Unavailable certified lanes remain blockers, not implied passes.
