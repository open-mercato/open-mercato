# Qwen 27B complete-delivery experiment, Round 4

This report is **in progress**. Runtime source: `b478b301e4ee3af3e78380a6e4df0c398ee95617`; started 2026-10-30 at 17:34:54 UTC. All fourteen selected cases run sequentially on local `qwen3.8:27b-mlx` through Pi 1.4.0 and Ollama 0.40.8. The original experiment and Rounds 1–3 remain frozen.

The complete case includes routing, required observed context, permitted reads and the implementation oracle. A passing implementation alone does not pass the complete case. Each driver invocation retains evaluator-owned attempts and corrections; the timeout remains 600 seconds per invocation. No source, grading or transport setting changes during this run.

| Case | Complete case | Implementation oracle | Attempts / corrections | Observed cause |
|---|---|---|---|---|
| OMH-009 | fail | fail | 1 / 0 | Completed without timeout: undeclared example-source read, extra UMES route, and generated Jest test globals missing. |
| OMH-011 | running | pending | — | In progress. |
| OMH-012 | pending | pending | — | Not run yet. |
| OMH-014 | pending | pending | — | Not run yet. |
| OMH-026 | pending | pending | — | Not run yet. |
| OMH-027 | pending | pending | — | Not run yet. |
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

OMH-009 followed all three declared source references and completed without a timeout or format retry. Its generated tests use undeclared Jest globals (`describe`, `it`, `expect`), causing the real typecheck failure. The complete case also rejects an undeclared example-index read and an extra UMES route. A separate denied command-example attempt remains visible in the capture even though the compact evaluator refusal field is empty. Complete source delivery does not establish that the model used it correctly; this outcome does not demonstrate a new shared harness defect.

[Machine-readable results and evidence hashes](2026-10-30-qwen27b-round4-results.json) are content-free. Responses, tool calls and generated files remain available in the local experiment dashboard. [The recovery analysis](2026-10-30-qwen27b-coding-failures.md) records the actual runtime fixes, failure-first proofs and historical runs.

All eight configured repository checks pass at this source, before inference. The packed controller and all fourteen target preparations, broken-before oracles and prompt/framework projections also pass. These repository/preparation checks do not certify model-generated applications. The local Pi transport remains experimental; the complete release lane is unavailable on native macOS because its isolated-loopback prerequisite requires Linux/Bubblewrap. No cloud model or official Pi certification is implied.
