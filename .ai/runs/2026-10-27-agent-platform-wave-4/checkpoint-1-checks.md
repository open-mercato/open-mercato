# Checkpoint 1 — Steps 1.1..1.4 (Phase 1)

- **When:** 2026-10-27T17:14:38Z
- **Steps:** 1.1, 1.2, 1.3, 1.3-review-fix, 1.4 (`99b7b97f4`..`81f8e2e3d`)
- **Areas:** agent_orchestrator `lib/trace/genAiAttributes.ts`, `lib/runtime/{modelPricing,nativeModelCallRecorder,nativeAgentRunner,nativeTraceCapture}.ts`, `lib/trace/traceIngestionService.ts` (export only); ai-assistant `lib/agent-call-{contract,observer}.ts`, `lib/agent-runtime.ts` (additive `synthesized` / `callerManaged` start-event flags).

| Check | Result |
|---|---|
| `yarn typecheck` | pass (40/40 tasks) |
| `npx jest src/modules/agent_orchestrator` (packages/enterprise) | pass — 202 suites, 2048 tests |
| `npx jest` (packages/ai-assistant) | pass — 159 suites, 2182 tests |
| UI / integration | skipped — no UI or route touched in this window |

Review notes (main session):
- 1.3 marked every synthesized call `reconstructed`; the spec reserves that for the caller-supplied callback. Fixed in 1.3-review-fix (`callerManaged` flag).
- 1.4 aligned the sha256 reader with the `sha256:<hex>` format the recorder and manifest write.
