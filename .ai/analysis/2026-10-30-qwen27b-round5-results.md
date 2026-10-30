# Local Qwen 27B coding results — canonical-context Round 5

This complete fourteen-case experiment is **running**. Runtime source: `0395f6246d13fac742fdd72df59aa22f3d8bdd49`; run `ac37befc-5efe-486e-a2f3-c37d437d446e`, started 2026-10-30 at 19:17:57 UTC. Model `qwen3.8:27b-mlx`, Pi 1.4.0, Ollama 0.40.8, sequential disposable targets.

The operator timeout is 1,200 seconds per attempt, compared with 600 in earlier experiments. Model, transport, sampling and grading remain unchanged. Source and time-budget changes are disclosed together; this is not an isolated causal comparison. Original evidence and all earlier experiments remain frozen.

The complete case covers routing, observed context/read boundaries and the implementation oracle. Implementation pass alone is narrower. Repository validation passed all eight commands before inference; that does not certify generated applications.

| Case | Complete case | Implementation oracle | Attempts / corrections | Observed outcome |
|---|---|---|---|---|
| OMH-009 | pass | pass | 1 / 0 | Canonical and implementation pass; broader generated-artifact validation is pending. |
| OMH-011 | running | pending | — | In progress. |
| OMH-012 | pending | pending | — | Pending. |
| OMH-014 | pending | pending | — | Pending. |
| OMH-026 | pending | pending | — | Pending. |
| OMH-027 | pending | pending | — | Pending. |
| OMH-029 | pending | pending | — | Pending. |
| OMH-031 | pending | pending | — | Pending. |
| OMH-042 | pending | pending | — | Pending. |
| OMH-045 | pending | pending | — | Pending. |
| OMH-049 | pending | pending | — | Pending. |
| OMH-054 | pending | pending | — | Pending. |
| OMH-057 | pending | pending | — | Pending. |
| OMH-060 | pending | pending | — | Pending. |

## First completed case

OMH-009 passes its full canonical case and implementation oracle in one attempt, with zero corrections or violations (257,720 ms). All three required source references are followed in owner order. Its 21 successful reads carry finalized byte/hash metadata and all thirteen independently comparable immutable hashes match. No denied read or extra UMES selection is observed in this attempt.

Five data/migration files were retained; no generated test file was produced. Therefore this result does not demonstrate that the Jest wording changed test generation. Controlled app generation/typecheck/lint/build, applicable generated tests and read-only artifact judgment remain pending until all fourteen model cases finish. No migration is applied. This canonical pass is not a complete app/release certificate.

[Machine-readable results and evidence hashes](2026-10-30-qwen27b-round5-results.json) remain content-free. Visible responses, tool calls and generated files are available in the [local dashboard](http://127.0.0.1:8768/), under “Qwen27B canonical context recovery · round5”. Internal reasoning and raw read bodies are excluded.

[The full recovery analysis](2026-10-30-qwen27b-coding-failures.md) records the source fixes, failure-first regressions and earlier case outcomes. The selected fourteen preparation cases pass; the full deterministic catalog remains 236/240 with the same four pre-existing budget deficits (008/082/153/155), separately recorded rather than silently relaxed.
