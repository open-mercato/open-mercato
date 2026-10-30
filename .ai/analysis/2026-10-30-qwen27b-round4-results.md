# Qwen 27B complete-delivery experiment, Round 4

This report is **in progress**. Runtime source: `b478b301e4ee3af3e78380a6e4df0c398ee95617`; started 2026-10-30 at 17:34:54 UTC. All fourteen selected cases run sequentially on local `qwen3.8:27b-mlx` through Pi 1.4.0 and Ollama 0.40.8. The original experiment and Rounds 1–3 remain frozen.

The complete case includes routing, required observed context, permitted reads and the implementation oracle. A passing implementation alone does not pass the complete case. Each driver invocation retains evaluator-owned attempts and corrections; the timeout remains 600 seconds per invocation. No source, grading or transport setting changes during this run.

| Case | Complete case | Implementation oracle | Attempts / corrections | Observed cause |
|---|---|---|---|---|
| OMH-009 | fail | fail | 1 / 0 | Generated Jest test globals missing; extra UMES ambiguity and undisclosed example-read boundary also affect full-case failure. |
| OMH-011 | fail | pass | 1 / 0 | Implementation oracle passed; undeclared example read caused full failure across an undisclosed per-case boundary. |
| OMH-012 | fail | fail | 1 / 0 | Timed out; mutation-guard/atomic calls absent and entity typecheck fails; example boundary was undisclosed. |
| OMH-014 | fail | fail | 1 / 0 | Timed out; generated CRUD PATCH metadata/handler fails typecheck, with unsafe and undeclared reads also rejected. |
| OMH-026 | fail | fail | 1 / 0 | Missing interceptor/write roundtrip and unsupported widget clearable property; required sources read before their owner. |
| OMH-027 | running | pending | — | In progress. |
| OMH-029 | pending | pending | — | Not run yet. |
| OMH-031 | pending | pending | — | Not run yet. |
| OMH-042 | pending | pending | — | Not run yet. |
| OMH-045 | pending | pending | — | Not run yet. |
| OMH-049 | pending | pending | — | Not run yet. |
| OMH-054 | pending | pending | — | Not run yet. |
| OMH-057 | pending | pending | — | Not run yet. |
| OMH-060 | pending | pending | — | Not run yet. |

## Live delivery evidence

OMH-009 has 19 successful reads with finalized byte/hash metadata; all twelve independently comparable immutable reads match exactly, with no missing metadata or mismatches. These include the complete 47,378-byte surface map and 20,970-byte snapshot that the native Pi formatter previously clipped. Mutable self-reads are attested but are not retrospectively reconstructed. No private read body or hidden reasoning is retained in this report.

OMH-009 followed all three declared source references and completed without a timeout or format retry. Its generated tests use undeclared Jest globals (`describe`, `it`, `expect`), causing the real typecheck failure. The complete case also rejects an undeclared example-index read and an extra UMES route. The root router contains broad UMES wording that conflicts with its narrower app-owned-module table, so that extra route has ambiguous instructions rather than being wholly unsupported. A separate denied command-example attempt remains visible in the capture even though the compact evaluator refusal field is empty. Complete source delivery does not establish that the model used it correctly; the generated test failure is genuine, while the shared routing wording needs clarification. Jest and its types are installed and the actual Jest script was supplied; the model did not read the linked verification reference requiring explicit `@jest/globals` imports.

OMH-011 completes with its implementation oracle passing. Its sole scored violation is a customer-priorities example read outside the declared capability. Both required CRUD/OpenAPI references were followed. An additional denied compatibility-document read exposes a scope conflict: the root and scaffold skill literally require the existing file for route/schema changes, while the new-app case explicitly excludes that compatibility context. This is recorded separately and is not an invented additional scored violation. Across both completed cases, all 33 successful reads carry metadata and all 21 independently comparable immutable hashes match.

OMH-012 times out at 600,013 ms without final routing JSON (one attempt, no correction). The required command example was delivered and followed, but the generated command lacks mutation guards and atomic flush, the original endpoint remains unchanged, and the generated entity fails real typechecking. All eleven successful reads carry metadata; all ten comparable immutable hashes match. The timeout leaves model resource/completion limits uncertain and does not establish a missing command-source grant. Across three completed cases the aggregate is 44/44 delivery metadata and 31/31 immutable matches.

OMH-014 also times out (600,019 ms, one attempt, no correction). The fixed UI structural checks accept the connected table/form surfaces, but actual typechecking rejects generated CRUD PATCH metadata/handler usage. The required table/form sources and all granted page-shell variants were read successfully. All 22 successful reads are attested and all 21 comparable immutable hashes match. This is not a UI/runtime/design-system certification. Aggregate delivery across four completed cases is 66/66 metadata and 52/52 immutable matches.

OMH-026 completes without a timeout (468,734 ms, one attempt, no correction). Its four exact required examples were delivered, but the reference was first read before its required instruction owner. The final implementation omits the interceptor artifact/export and uses unsupported `InjectionFieldDefinition.clearable`; real typechecking fails. All 31 successful reads are attested and all seventeen comparable immutable hashes match. Across five completed cases, delivery totals are 97/97 metadata and 69/69 immutable matches.

A separate audit confirms that the generic tool schema and writable prompt do not disclose the complete case-specific canonical permissions; the map marks some denied paths readable. This is a shared harness limitation relevant to the read-denial failures, including OMH-011, and must not be blamed solely on model choice. Candidate `c4bc1ab10` now projects that exact existing canonical allowlist, while `d92ca4b66` delivers required compatibility context and `bcc3a3c1b` clarifies root ownership/Jest imports. These commits do not alter this b478b301e experiment or regrade any old result. Candidate fresh-model and full repository/scaffold validation remain pending.

[Machine-readable results and evidence hashes](2026-10-30-qwen27b-round4-results.json) are content-free. Responses, tool calls and generated files remain available in the local experiment dashboard. [The recovery analysis](2026-10-30-qwen27b-coding-failures.md) records the actual runtime fixes, failure-first proofs and historical runs.

All eight configured repository checks pass at this source, before inference. The packed controller and all fourteen target preparations, broken-before oracles and prompt/framework projections also pass. These repository/preparation checks do not certify model-generated applications. The local Pi transport remains experimental; the complete release lane is unavailable on native macOS because its isolated-loopback prerequisite requires Linux/Bubblewrap. No cloud model or official Pi certification is implied.
