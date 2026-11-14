# Checkpoint 4 — Steps 3.2..3.4 (safety stop for user review)

- **When:** 2026-10-26
- **Steps:** 3.2 `083b3ec85`, 3.3 `0636ac240`, 3.4 `ac31357da`
- **Touched areas:** agent_orchestrator `lib/trace/{definitionHash,runManifest,runManifestEntry}.ts`, `lib/sdk/defineAgent.ts`, `lib/runtime/{persistence,nativeAgentRunner,nativeTraceCapture,openCodeAgentRunner}.ts`, `commands/runs.ts`, tests
- **Runner:** local mode

| Check | Result |
|---|---|
| `packages/shared` jest `src/lib/ai` | ✅ 8 suites, 67 tests |
| `packages/enterprise` jest `agent_orchestrator` | ✅ 172 suites, 1567 tests |
| Enterprise `tsc --noEmit` | ✅ |
| `packages/core/src/__tests__` guard suites | ✅ 25 suites, 244 tests |
| `yarn build:app` | ✅ |
| `yarn lint` | ✅ |
| UI verification | ⏭️ no UI touched in this window |

## Decisions in this window
- 3.2: file-agent definition hashes are computed at load time, not emitted by the generator (no generated-manifest contract change; no 64-hex digests in a committed file). Spec changelog records it in 5.2.
- 3.4: OpenCode manifests omit resolved model/provider, system-prompt hash and prompt override (not observable by AO today; Phase 0 finding). Invoker falls back to `ctx.userId` until the identity spec adds `ctx.invoker`.
- Safety stop: ~20 Steps landed since the run started; pausing for the user's review before Step 3.5.
