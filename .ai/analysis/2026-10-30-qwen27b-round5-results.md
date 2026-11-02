# Local Qwen 27B coding results — canonical-context Round 5

**Paused by user request.** A graceful stop is requested after active OMH-027. This report is the five-completed-case checkpoint; the producer may finish the active case after handoff. No later case should start. [Resume handoff](../runs/2026-10-30-qwen-coding-harness-recovery-handoff.md).

This fourteen-case experiment was **running at the saved checkpoint**. Runtime source: `0395f6246d13fac742fdd72df59aa22f3d8bdd49`; run `ac37befc-5efe-486e-a2f3-c37d437d446e`, started 2026-10-30 at 19:17:57 UTC. Model `qwen3.8:27b-mlx`, Pi 1.4.0, Ollama 0.40.8, sequential disposable targets.

The operator timeout is 1,200 seconds per attempt, compared with 600 in earlier experiments. Model, transport, sampling and grading remain unchanged. Source and time-budget changes are disclosed together; this is not an isolated causal comparison. Original evidence and all earlier experiments remain frozen.

The complete case covers routing, observed context/read boundaries and the implementation oracle. Implementation pass alone is narrower. Repository validation passed all eight commands before inference; that does not certify generated applications.

| Case | Complete case | Implementation oracle | Attempts / corrections | Observed outcome |
|---|---|---|---|---|
| OMH-009 | pass | pass | 1 / 0 | Canonical and implementation pass; broader generated-artifact validation is pending. |
| OMH-011 | fail | pass | 1 / 0 | Implementation passes; fullcase fails owner-before-source ordering and a missed required BC read. |
| OMH-012 | fail | fail | 1 / 0 | Timed out; required mutation/atomic helpers absent and generated checkout route imports nonexistent commandBus. |
| OMH-014 | fail | fail | 1 / 0 | API import-depth/type errors and source-before-owner violation; table-binding complaint is an oracle false negative. |
| OMH-026 | fail | fail | 1 / 0 | Invalid shared/db API import, absent declared interceptor artifact and missed required owner/facts/skill protocol. |
| OMH-027 | running | pending | — | In progress. |
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

OMH-011 also passes its implementation oracle (413,443 ms, one attempt, no correction), but fails the complete case: the CRUD/OpenAPI sources were read before their required procedure owner, and the now-readable compatibility document was never read or declared. No denied capability probe or transport error occurred. Both completed cases therefore pass implementation checks, while only one passes all policy/routing requirements. Across them, all 33 successful reads are attested and all 22 comparable immutable hashes match. These remaining policy failures must be corrected before the requested fourteen-pass completion is reached.

OMH-012 times out at 1,200,026 ms (one attempt, zero corrections; process exit 143). Its implementation still fails: the generated route imports a nonexistent `commandBus` singleton and omits the required registered mutation-guard and atomic-write calls. The seeded route and command were edited, and a generated test imports Jest globals explicitly, but no test execution is claimed. The required command reference was followed; one undeclared events-example read was denied. All seventeen successful reads are attested and ten comparable immutable hashes match. This is a genuine failed coding attempt, preserved separately from pending harness changes. OMH-014 is running.

OMH-014 completes in 906,781 ms, below the timeout, with one attempt and zero corrections. It retains an implementation failure because TypeScript rejects an incorrect import depth. Its separate table-binding diagnostic is a proven oracle false negative: the installed DataTable resolves a stable ID from `perspective.tableId`, exactly as both the canonical Todo table and generated Book table provide. Its table/form sources were delivered before their owning backend-UI guide; several optional guessed paths were denied, while the required sources were available. All 32 successful reads are attested and 21 comparable immutable hashes match. It reads one module-local locale (2,304 bytes) and no global locale; this is an ownership observation, not proof that the wording caused success or improved speed. Four cases have completed: one canonical pass and two implementation passes. OMH-026 is running.

OMH-026 completes in 483,357 ms (one attempt, zero corrections). Its new save API imports nonexistent `@open-mercato/shared/db`; the declared interceptor artifact/export is absent. The instruction owner, required backend-UI skill and customer facts were not read, even though all four permitted canonical sources were delivered. A separate custom-save API is not automatically evidence of a valid alternative round trip, and no such validation is claimed. Its eighteen successful reads are attested and twelve comparable immutable hashes match. Five cases have completed: one canonical pass and two implementation passes. OMH-027 is running.

[Machine-readable results and evidence hashes](2026-10-30-qwen27b-round5-results.json) remain content-free. Visible responses, tool calls and generated files are available in the [local dashboard](http://127.0.0.1:8768/), under “Qwen27B canonical context recovery · round5”. Internal reasoning and raw read bodies are excluded.

[The full recovery analysis](2026-10-30-qwen27b-coding-failures.md) records the source fixes, failure-first regressions and earlier case outcomes. The selected fourteen preparation cases pass; the full deterministic catalog remains 236/240 with the same four pre-existing budget deficits (008/082/153/155), separately recorded rather than silently relaxed.
