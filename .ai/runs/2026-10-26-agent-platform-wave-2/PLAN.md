# Execution Plan — Agent platform capabilities, wave 2

- **Date:** 2026-10-26
- **Slug:** agent-platform-wave-2
- **Source specs:**
  - `.ai/specs/2026-10-21-agent-platform-capabilities-roadmap.md` (umbrella, wave 2)
  - `.ai/specs/2026-10-21-chat-run-tracing-and-citations.md` (Phase 2 + §6 model-call contract)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-agent-run-observability-full-fidelity.md` (Phases 0–1)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-eval-reports-and-reproducible-regression.md` (Phase 2)
- **Base branch:** `main` (open-mercato/open-mercato), **stacked on** `feat/agent-platform-wave-1` (PR #7794, not merged yet)
- **Branch:** `feat/agent-platform-wave-2`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 0 | 0.1 | Run the observability verification spikes and record the findings | dispatch | done | 9d5d8802e |
| 1 | 1.1 | Add the model-call contract types and settings merge | dispatch | done | b724c34af |
| 1 | 1.2 | Forward call settings to every model call branch | dispatch:capable | done | c57d82c74 |
| 1 | 1.3 | Invoke the call observer on every model call branch | dispatch:capable | done | 18b9ecad3 |
| 1 | 1.3-review-fix | Type the model-call end hook generically over the tool set | inline | done | 6b8848718 |
| 1 | 1.4 | Resolve prompt override metadata and report onPromptResolved | dispatch | done | eb24a57f9 |
| 1 | 1.5 | Compute the agent definition hash at registry load | dispatch | done | d6051d574 |
| 1 | 1.5-review-fix | Pass explicit comparators to the definition hash sorts | inline | done | cdb0d95f3 |
| 2 | 2.1 | Add the agent run entities, encryption entries and migration | dispatch:capable | done | c101f38ef |
| 2 | 2.2 | Add the best-effort agent run recorder with capture levels | dispatch:capable | done | 15488bd19 |
| 2 | 2.3 | Record text and object runs from the agent runtime | dispatch:capable | done | ae2e35868 |
| 2 | 2.4 | Return run ids from the chat and run-object routes | dispatch | done | 013febce7 |
| 2 | 2.5 | Emit the agent run completed event and register the run reader | dispatch | done | a6c1a627e |
| 2 | 2.6 | Prune expired agent runs and soft-delete them with conversations | dispatch | done | 0fc51def6 |
| 2 | 2.7 | Stop AO native runs from writing a second run record | dispatch:cheap | done | c7b1f195d |
| 2 | 2.8 | Document run tracing and add run-object integration coverage | dispatch | done | 5a5dcb0f3 |
| 2 | 2.8-review-fix | Resolve the OpenAPI path and schema refs in TC-AI-RUN-TRACE-016 | inline | done | 785a79a38 |
| 3 | 3.1 | Add the shared run observation collector | dispatch | done | dce125ccd |
| 3 | 3.2 | Hash AO agent definitions and stamp agent_version on new runs | dispatch:capable | done | 539974724 |
| 3 | 3.3 | Add the run manifest builder | dispatch | todo | — |
| 3 | 3.4 | Write the run.manifest span for native and OpenCode runs | dispatch:capable | todo | — |
| 3 | 3.5 | Count only llm and tool spans in the trace-completeness gate | dispatch:cheap | todo | — |
| 3 | 3.6 | Show a Versions and Identity card on the trace page | dispatch | todo | — |
| 3 | 3.7 | Cover the run manifest with an integration test | dispatch | todo | — |
| 4 | 4.1 | Add frozen eval-set manifests with deterministic ids | dispatch:capable | todo | — |
| 4 | 4.2 | Freeze the manifest on eval run start and merge the summary on complete | dispatch | todo | — |
| 4 | 4.3 | Replay cases and assertions from the frozen manifest | dispatch:capable | todo | — |
| 4 | 4.4 | Add snapshot pinning to the eval CLI and the eval-runs API | dispatch | todo | — |
| 4 | 4.5 | Report dataset sameness, drift warnings and the snapshot picker | dispatch | todo | — |
| 4 | 4.6 | Cover pinned eval replays with an integration test | dispatch | todo | — |
| 5 | 5.1 | Mirror the new env vars into the app and create-app template | dispatch:cheap | todo | — |
| 5 | 5.2 | Update the specs, roadmap and upgrade notes for wave 2 | inline | todo | — |

## Goal

Land the shared contracts of wave 2 so later waves reuse them instead of redefining them: the §6 model-call contract and OSS run persistence for ai-assistant agent runs, the AO run manifest (versions + identity on every AO run), and frozen, content-hashed eval-set manifests that make eval replays reproducible.

## Scope

- **ai-assistant (OSS):** `lib/agent-call-contract.ts` (`AiAgentCallSettings`, `AiAgentCallObserver`, `AiAgentRunChannel`, `AiAgentRunTraceOptions`), `AiAgentDefinition.version` / `modelSettings`, `callSettings` / `observe` / `trace` / `runId` inputs on `runAiAgentText` / `runAiAgentObject`, definition hash, `resolveSystemPromptWithOverrideMeta`, three run tables + recorder + event + reader + retention.
- **agent_orchestrator (enterprise):** `trace: { persist: false }` on native runs, `@open-mercato/shared/lib/ai/run-observation`, `lib/trace/{definitionHash,runManifest}.ts`, the `run.manifest` span, `agent_version` stamping, tightened trace-completeness gate, Versions & Identity card, frozen eval-set manifests with snapshot pinning (CLI, API, report, start dialog).
- No AO DDL (squash-only policy). One new stacked `ai_assistant` migration.

## Non-goals

- Chat Phase 3–4 (runs list/detail API and pages, citations). The `ai_assistant.runs.view` / `.view_all` features ship with the routes that consume them in Phase 3.
- Observability Phase 2+ (per-step `gen_ai.*` attributes, cost, content capture, capture-policy settings, compare route).
- Eval Phase 3+ (file eval sets, YAML, record/replay, rubrics, CI recipe) and the `eval-sets` import/export routes.
- **Optional step 4 of the handoff (MCP P4 + Identity P1 + P5) is deferred to wave 3.** ID-Q3 requires the three to ship in one release; the roadmap's delivery order places them in wave 3, and adding them would roughly double this PR. Decision logged in NOTIFY.md.
- Fixing #7794's own CI failures (pagination guard, CodeQL alert) and its conflicts with `main` — handled on #7794.
- Wave-1 follow-ups listed in the handoff (filed or folded into later waves).

## Risks

- **Stacked base:** #7794 conflicts with `main` and has a failing `test` check. This PR's diff against `main` includes wave 1 until #7794 merges; then it must be re-based on `main`.
- **Hot path:** the recorder runs after every chat turn. It is best-effort (never throws), one transaction, written once after the turn settles.
- **AI SDK hook drift:** `onLanguageModelCallStart/End` are AI SDK 7 call-level hooks; the spike (0.1) pins the behavior with a unit test.
- **Personal data:** run content is encrypted, capped at 16 KB per payload, and pruned after 30 days; the system prompt is hash-only by default.
- **Duplicate runs for AO:** until 2.7 lands, AO native runs would also be recorded by the OSS recorder (channel `internal`); 2.3 and 2.7 land in the same PR.
- **Pushing:** agent pushes to `open-mercato/open-mercato` are blocked; executors commit locally and the user pushes at checkpoints.

## External References

None (`--skill-url` not passed).

## Implementation Plan

### Phase 0: Verification spikes (observability P0)

#### 0.1 Run the observability verification spikes and record the findings
- Unit test (kept in the repo, `packages/ai-assistant/.../lib/__tests__/`) with a mock `LanguageModel` proving AI SDK 7 `generateText` fires `onLanguageModelCallStart` / `onLanguageModelCallEnd` once per step in a tool loop, after `prepareStep` has applied (the hook sees the step's active tools). If the hooks have different names or shapes in the installed `ai` version, record the actual API.
- Read the OpenCode client/session code at the pinned `OPENCODE_VERSION` to check whether per-assistant-message `tokens` / `cost` / `modelID` / `providerID` are exposed; read the DI-resolved `storage-s3` service for `list` / `delete`.
- Record all three findings in the observability spec changelog (2026-10-26 entry). If a finding contradicts a later Step's assumption, note the adjustment in the same entry.

### Phase 1: Model-call contract (chat spec §6)

#### 1.1 Add the model-call contract types and settings merge
- Create `lib/agent-call-contract.ts` exactly as chat spec §6: `AiAgentCallSettings`, `AiAgentRunChannel`, `AiAgentRunTraceOptions`, `AiAgentCallObserver`; a pure `mergeCallSettings(modelSettings, callSettings)` (key by key, `callSettings` wins, undefined keys dropped) and a zod schema for `AiAgentCallSettings` (strict: unknown keys rejected) for route validation.
- `AiAgentDefinition` gains optional `version?: string` and `modelSettings?: AiAgentCallSettings`; `RunAiAgentTextInput` / `RunAiAgentObjectInput` gain optional `runId`, `trace`, `callSettings`, `observe` (types only in this Step).
- Export the new types from the package entry used for `defineAiAgent` consumers. Unit tests for the merge and the zod schema.

#### 1.2 Forward call settings to every model call branch
- In `agent-runtime.ts`, compute `effective = mergeCallSettings(agent.modelSettings, input.callSettings)` once per run and spread it into every AI SDK call: `streamText` (chat), the object-mode tool-loop `generateText`, `generateObject`, `streamObject`, and pass it to the caller-supplied `input.generateObject` callback args when that branch exists (additive field).
- Unit tests (`agent-call-contract.test.ts` or extend the runtime tests) with a mock model: `callSettings` override `modelSettings` per key and reach the provider call; absent settings send nothing (provider default preserved).

#### 1.3 Invoke the call observer on every model call branch
- Wire `observe.onModelCallStart` / `onModelCallEnd` from AI SDK 7 `onLanguageModelCallStart/End` on `generateText` / `streamText` branches (one event per model call; `callSettings` = settings as sent, `tools` = the step's exposed set after `prepareStep`).
- Branches without call-level hooks (`generateObject`, `streamObject`, caller-supplied `generateObject`) synthesize `onModelCallStart` from `system` / `messages` / schema with `stepNumber = 0`, and `onModelCallEnd` from the result.
- Every observer call is wrapped in try/catch: a throwing observer is logged (structured logger) and ignored, never fails the run, and never sees or alters the `prepareStep` result. Unit tests: one start/end per step in a tool loop; throwing observer does not fail the run.

#### 1.3-review-fix Type the model-call end hook generically over the tool set
- Checkpoint 3's `yarn build:app` (Next type check) rejected the `onLanguageModelCallEnd` hook typed against the default `ToolSet` at `generateText` / `streamText` call sites whose tools infer as `Record<string, Tool<unknown, unknown>>`; the app typecheck script did not catch it. Make the hook (and `toModelCallEndEvent`) generic over `TOOLS extends ToolSet`.

#### 1.4 Resolve prompt override metadata and report onPromptResolved
- Add internal `resolveSystemPromptWithOverrideMeta` returning `{ prompt, override: { id, version } | null }` from the override repo lookup that prompt composition already does; the exported string-returning composition function keeps its signature (BC category 3) and delegates to it.
- `runAiAgentText` / `runAiAgentObject` call `observe.onPromptResolved({ agentId, systemPrompt, promptOverride, pageContextHydrated, attachmentCount, provider, modelId })` once per run (try/catch as in 1.3). Keep the override metadata available to the recorder (Step 2.2). Unit tests.

#### 1.5 Compute the agent definition hash at registry load
- In the agent registry, compute `agentDefinitionHash` = SHA-256 over canonical JSON `{ systemPrompt, allowedTools (sorted), executionMode, output.schemaName, mutationPolicy, defaultProvider, defaultModel, modelSettings, loop (serializable subset) }` once at load; expose a getter for the runtime/recorder. Reuse an existing canonical-JSON helper if one exists in shared.
- Unit tests: same definition → same hash; key-order independent; prompt change, `modelSettings` change → different hash.

#### 1.5-review-fix Pass explicit comparators to the definition hash sorts
- Checkpoint 2 found two bare `.sort()` calls in `lib/agent-definition-hash.ts` that fail `packages/core/src/__tests__/explicit-sort-comparators.test.ts`; use a code-point comparator (locale-independent, so the hash stays stable across environments).

### Phase 2: Run persistence (chat spec Phase 2)

#### 2.1 Add the agent run entities, encryption entries and migration
- `AiAgentRun`, `AiAgentRunStep`, `AiAgentRunToolCall` in `data/entities.ts` exactly per the chat spec Data Models (columns, indexes, uniques; FK ids only, no ORM relations).
- Encryption entries in `encryption.ts` per the spec. Migration via `yarn db:generate` scoped to `ai_assistant` (keep only this module's output), snapshot updated. Do not run `yarn db:migrate`.
- Unit test pinning the encryption map entries.

#### 2.2 Add the best-effort agent run recorder with capture levels
- `lib/agent-run-recorder.ts`: `recordAgentRun(container, payload)` writes run + steps + tool calls in one transaction on a forked EM; never throws (structured log + `reportError`), mirrors `token-usage-recorder.ts`.
- Capture levels from `OM_AI_RUN_TRACE_CAPTURE` (`full` default | `metadata` | `off`), caps from `OM_AI_RUN_TRACE_MAX_PAYLOAD_BYTES` (16384) via `lib/truncate.ts` with `*_truncated` flags, `system_prompt` only with `OM_AI_RUN_TRACE_CAPTURE_PROMPT` (parse with `parseBooleanToken`), always `system_prompt_hash`. `metadata` keeps `arg_keys`, sizes, timings, tokens, error codes; drops content.
- A recorder observer factory that fills `model_params` (`gen_ai.request.*` keys from the first `onModelCallStart.callSettings`, plus loop parameters and `modelSource`). Unit tests per the spec (`agent-run-recorder.test.ts`).

#### 2.3 Record text and object runs from the agent runtime
- `runAiAgentText`: generate `runId` when omitted, generalize the post-stream finalize hook so it runs whether or not `emitLoopTrace` is set, record `completed` / `failed` / `aborted` (steps collected so far). `LoopTrace.runId` set.
- `runAiAgentObject`: record after resolve, `failed` in catch; `RunAiAgentObjectGenerateResult.runId`.
- Honor `trace.persist === false` and capture `off` (no write); channel defaults `internal` when the caller does not set one; `correlationId` passthrough. Unit tests: persist false writes nothing; failure path records `failed`; recorder failure never fails the run.

#### 2.4 Return run ids from the chat and run-object routes
- Chat route: pass a generated `runId`, channel `chat` (or `playground` when the playground calls it), `correlationId` from `x-correlation-id` (≤128 chars) or generated; add `runId` to the `loop-finish` trace payload and to the persisted assistant message `metadata.runId`.
- `run-object` route: channel `run-object`, response gains `runId`; request gains optional `callSettings` validated by the strict zod schema (unknown keys → 400). Dispatcher delegation (`runId: null` + `agentRunId`) is out of scope (MCP P4). Update `openApi`. Unit/route tests.

#### 2.5 Emit the agent run completed event and register the run reader
- `events.ts`: `ai_assistant.agent_run.completed` (category `system`, persistent, `clientBroadcast: false`), payload ids only `{ runId, tenantId, organizationId, agentId, channel, status, conversationId }`, emitted after commit.
- DI `aiAgentRunReader` (`getRun`, `listSteps`, `listToolCalls`) reading through `findWithDecryption` / `findOneWithDecryption`, scoped by tenant/org. Unit tests.

#### 2.6 Prune expired agent runs and soft-delete them with conversations
- Worker `workers/ai-agent-run-prune.ts` (queue `ai-agent-run-prune`) + CLI `mercato ai_assistant run-agent-run-prune`, following `ai-token-usage-prune`: hard-delete runs older than `AI_AGENT_RUNS_RETENTION_DAYS` (30) and soft-deleted runs, cascade steps/tool calls by `run_id`, batches of 1000.
- Conversation delete in `conversation-storage` soft-deletes that conversation's runs in the same operation. Unit tests. Run `yarn generate`.

#### 2.7 Stop AO native runs from writing a second run record
- AO `nativeAgentRunner.ts` passes `trace: { persist: false }` to `runAiAgentObject`. Extend the native runner wiring test to assert it.

#### 2.8 Document run tracing and add run-object integration coverage
- Docs: `apps/docs/docs/framework/ai-assistant/agents.mdx` (`version`, `modelSettings`, `callSettings`, `observe`, run tracing env), `packages/ai-assistant/AGENTS.md` (recorder rules, capture env). Event registry docs if a guard test requires it.
- Integration test `TC-AI-RUN-TRACE-016` (`ai_assistant/__integration__/`, scripted/stub provider as in existing loop tests, self-contained): `run-object` returns a UUID `runId`; invalid `callSettings` key → 400. (Run list/detail assertions arrive with Chat Phase 3.)

#### 2.8-review-fix Resolve the OpenAPI path and schema refs in TC-AI-RUN-TRACE-016
- Checkpoint 3's ephemeral run failed the OpenAPI case: the document keys the path without the `/api` prefix and the 200 schema is a `$ref`. Look the path up with and without the prefix and resolve `$ref`s before asserting.

### Phase 3: Run manifest (observability P1)

#### 3.1 Add the shared run observation collector
- `packages/shared/src/lib/ai/run-observation.ts`: `bindRunObservation`, `reportKnowledgeVersion`, `reportRetrieval`, collector type; AsyncLocalStorage-based, no-op when unbound; limits (50 keys, 200 hits per retrieval, dropped counter). Unit tests.

#### 3.2 Hash AO agent definitions and stamp agent_version on new runs
- `lib/trace/definitionHash.ts`: code agents combine the ai-assistant `agentDefinitionHash` (1.5) with `{ resultKind, outcome JSON-Schema, agentType }`; file agents use `sourceFiles[].{path,content}` where `inContext: true`.
- Generator emits optional `definitionHash` on each `file-agents.generated.ts` entry (additive); regenerate.
- `createRun` stamps `agent_runs.agent_version` with `sha256:<first 16 hex>` when no explicit version exists. Unit tests (stability, change detection).

#### 3.3 Add the run manifest builder
- `lib/trace/runManifest.ts`: builds the `run.manifest` attributes per the observability spec (manifest version, runtime, agent id/definition hash/source, prompt override, system prompt sha256, skills, tools sha256 + names, declared/resolved model, provider, knowledge, invoker, entry point, channel, correlation id, principal, capture snapshot, platform traceparent). Invoker falls back to `{ kind: 'user', userId: ctx.userId }` when `ctx.invoker` is absent; `entry_point` omitted when absent.
- Enforces the ≤4000-char total by dropping/shortening lowest-priority keys (tool names, knowledge) with an `om.manifest.truncated` flag. Unit tests (size cap, invoker fallback, key set).

#### 3.4 Write the run.manifest span for native and OpenCode runs
- Native runner: observer `onPromptResolved` captures prompt-override metadata and system-prompt hash; `bindRunObservation` around the run; `buildNativeTracePayload` adds one `system` span `name = "run.manifest"`, `externalSpanId = "<runId>:manifest"` in the same ingest batch.
- OpenCode (`ingestSessionTrace`): same span with `om.runtime = "opencode"` and the fields it knows. `om.platform_trace.traceparent` from `captureTelemetryTrace()` when telemetry is on. The manifest write stays within the runtime-audit scope allowlist (`AgentSpan`). Unit tests on the payload builders.

#### 3.5 Count only llm and tool spans in the trace-completeness gate
- `dispositionService.ts` gate counts spans with `kind IN ('llm','tool')` so a manifest alone never makes a run look traced. Unit test.

#### 3.6 Show a Versions and Identity card on the trace page
- Trace page card reading the `run.manifest` span: definition hash, version, prompt override, model declared/resolved, provider, tools hash/count, knowledge versions, invoker, entry point, channel, correlation id; "not recorded (run predates capture)" when absent. Actions link only when the identity spec's route exists (feature-detected; hidden today).
- i18n keys in all module locales; DS tokens only. Unit/render test.

#### 3.7 Cover the run manifest with an integration test
- `TC-AGENT-TRACE-004` (AO `__integration__/`, scripted provider, self-contained): run via `POST /agents/:id/run` → trace has a `run.manifest` span with a definition hash, the prompt-override version from a fixture override, and an invoker; disposition still requires an `llm`/`tool` span. (AO cannot be registered in the local ephemeral app — runs in CI; recorded as such.)

### Phase 4: Frozen eval-set manifests (eval P2)

#### 4.1 Add frozen eval-set manifests with deterministic ids
- `lib/eval/manifest.ts`: `EvalSetManifest` type + zod, `freezeManifest(em, scope, agentId)` from approved cases and enabled assertions for the agent or `*` (deterministic + judge; `rubricRef` resolved into the frozen `rubric`), `hashManifest` (`sha256:` + `canonicalInputKey`, cases/assertions sorted by `key`), `resolveManifest(em, scope, agentId, version)` from its carrier suite run, `deterministicCaseId/AssertionId` (UUIDv5, namespace constant), size cap `OM_AGENT_EVAL_SET_MAX_BYTES` (5 MiB, clear error). Reads via `findWithDecryption`.
- Unit tests `eval-manifest.test.ts`: hash stable across key/authoring order, rubric edit changes the hash, size cap.

#### 4.2 Freeze the manifest on eval run start and merge the summary on complete
- `evalRuns.start` freezes the manifest and writes `summary.__evalSet = { version, label, source, caseCount, assertionCount, carrierSuiteRunId, body? }` (body only when no completed/running suite run in the same org + agent carries that version).
- `evalRuns.complete` merges into `summary` instead of overwriting. `GET /eval-runs/:id` strips `__evalSet.body`. Unit tests: carrier dedupe, merge keeps `__evalSet`, body stripped.

#### 4.3 Replay cases and assertions from the frozen manifest
- `runCase` / `scoreCaseRun` / the judge path resolve case content and effective assertions from the manifest when the suite run carries one; `aggregateSuiteRun` detects judges from the manifest. Runs without a manifest behave as today.
- Unit test `eval-pinned-replay.test.ts`: editing a live case after freezing does not change what a hash-pinned run executes.

#### 4.4 Add snapshot pinning to the eval CLI and the eval-runs API
- `POST /eval-runs` accepts `snapshot?: 'sha256:…' | 'latest'`; with it `evalCaseIds` becomes optional and the run executes the manifest's cases. `openApi` updated.
- CLI `--snapshot`, `--require-snapshot true` (label pin → exit 2); `EvalGateInput.snapshot`. Pin semantics per the eval spec. Unit tests (CLI exit-code matrix extended).

#### 4.5 Report dataset sameness, drift warnings and the snapshot picker
- Report: `evalSet.{version, pinKind, manifestHash, label, source, caseCount, assertionCount}` from `__evalSet`; `baseline.sameDataset` and a dataset-drift warning when a label pin's hashes differ. Existing runs without `__evalSet` render with `manifestHash: null`.
- Start dialog on the eval page: snapshot `Select` (`latest` / known hashes for the agent / none). i18n, DS tokens. Unit tests.

#### 4.6 Cover pinned eval replays with an integration test
- `TC-AGENT-EVAL-SET-002`: `POST /eval-runs { snapshot: 'latest' }` twice with a case edit in between; the pinned replay of the first hash ignores the edit and the report shows `sameDataset`. Self-contained fixtures via API, cleanup in `finally`. (Runs in CI with AO enabled.)

### Phase 5: Configuration and docs

#### 5.1 Mirror the new env vars into the app and create-app template
- `apps/mercato/.env.example`: `OM_AI_RUN_TRACE_CAPTURE`, `OM_AI_RUN_TRACE_CAPTURE_PROMPT`, `OM_AI_RUN_TRACE_MAX_PAYLOAD_BYTES`, `AI_AGENT_RUNS_RETENTION_DAYS`, `OM_AGENT_EVAL_SET_MAX_BYTES` (commented, defaults); `yarn template:sync:fix`.

#### 5.2 Update the specs, roadmap and upgrade notes for wave 2
- Changelog entries in the chat, observability and eval specs (what landed, deviations); roadmap wave-2 status; `UPGRADE_NOTES.md` (new tables + migration, env vars, `trace.persist` for custom runners calling `runAiAgentObject`). Generic content only.
