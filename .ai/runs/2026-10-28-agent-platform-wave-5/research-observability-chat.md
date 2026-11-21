# Research — Observability P3–P4 and Chat P3–P4 (verified on `2d407b96f`)

Shorthand: `AO` = `packages/enterprise/src/modules/agent_orchestrator`, `AI` = `packages/ai-assistant/src/modules/ai_assistant`.

## Code facts

### Observability (AO)
- `AO/lib/trace/artifactStore.ts`: single namespace `AGENT_TRACE_ARTIFACT_NAMESPACE='agent-trace-artifacts'` (L24); `putArtifact` has no namespace param (L134–159); `ARTIFACT_REFS` = `runOutput`, `runRawOutput`, `toolRequest`, `toolResponse` (L35–40); `StorageServiceLike` = `upload`/`download` only (L50–59); `getArtifact` collapses every failure to `null` (L165–194) so 410 vs 502 is not distinguishable. Encryption maps `agent_run` `input`/`output` exist (`AO/encryption.ts:8–11`).
- `AO/api/runs/[id]/artifact/route.ts`: `kind` = `output|tool_request|tool_response|raw_output` (L28); guard `trace.view` only (L22); 502 on null (L95–97); no 410, no access log.
- Content is hashed then dropped: `lib/runtime/nativeModelCallRecorder.ts` `buildPendingCall` (L74–99), `onModelCallEnd` (L113). `nativeTraceCapture.ts:201` hard-codes `om.content.status='disabled'`. `buildNativeTracePayload` is pure/sync (L237); offload must run in `captureNativeRunTrace` (L367) before building the payload.
- Span attributes are capped at 4000 chars (`SUMMARY_CHAR_LIMIT`, `traceIngestionService.ts:44,178`); `buildLlmSpanAttributes` falls back to legacy-only when over (L216–231) — content keys must get priority.
- `genAiAttributes.ts:65–73,86` already defines `om.content.request.key`, `.response.key`, `.status`, `.redactions`, `CONTENT_STATUSES` (unused).
- `lib/trace/redactStrings.ts` (wave 4): `redactSecretStrings` covers the Session Authorization line, `_sessionToken`, auth headers, Bearer/Basic/ApiKey (L22–32); `redactEmails` (L14). No phone/IBAN/card, no per-rule counts.
- `lib/trace/capturePolicy.ts`: `retentionDays`/`redactPii` come from the policy (L167–197); `includeProviderBody` is in the schema (`data/validators.ts:460–472`), settings page renders it disabled (`backend/settings/trace-capture/page.tsx:421`); retention/redactPii controls are disabled with "not available yet" (wave-4 review fix) — re-enable them once Phase 3 enforces them.
- `nativeAgentRunner.ts`: `resolveRunCapture` at L262 runs AFTER context assembly at L186 — must move earlier for context offload.
- `contextResolver.ts:295` hard-codes `payloadRef: null`; untrusted span text in memory only (L238–259); `payload_ref varchar(500)` (`data/entities.ts:1232`); `contextBundleRoutedSourcesSchema` (`validators.ts:852`) has no `retrieval`.
- Ingest schemas (`validators.ts:406–443`) have no `llm`/`manifest`; OpenCode ingest goes through the `agent_orchestrator.trace.ingest` command with `createArtifactOffloader` (`commands/trace.ts:37`).
- `openCodeAgentRunner.ts`: SSE handles only `message.part.updated` + `session.status` (L761–772); `ingestSessionTrace` emits tool spans + at most one synthetic llm span (L510–585); `buildMessage` embeds the session token (L597). Usage sources: `step-finish` (`cost`, `tokens`) and `message.updated` `info.modelID/providerID` (`AI/lib/opencode-handlers.ts:298–318,672–701`).
- storage-s3: `list`/`delete` exist (`storage-service.ts:177,237`); `list` takes a raw prefix without the configured `pathPrefix` (`s3-driver.ts:265–271`); `download` propagates S3 `NoSuchKey` (`s3-driver.ts:178–189`); `upload` reserves attachment quota.
- MCP path: `AI/lib/http-server.ts:498` tool execution has no hook; session token = `effectiveContext.sessionId` (L436). Shared collector `packages/shared/src/lib/ai/run-observation.ts` is bound only by the native runner (`nativeAgentRunner.ts:483`); nothing calls `reportKnowledgeVersion`/`reportRetrieval`.
- ACL `agent_orchestrator.trace.view_content` exists (`acl.ts:41`). Per-org schedule pattern: `setup.ts` `seedDefaults` (L166–197). `accessLogService` (core `audit_logs`) not used by AO yet; precedent `AI/lib/mcp-audit.ts:176`.
- Trace page `backend/traces/[id]/page.tsx` (1390 lines) has the Model calls card (`components/trace/LlmStepMetadataCard.tsx`) and `RunManifestCard`. No diff util in `packages/ui`.
- Existing integration: TC-AGENT-TRACE-001…005.

### Chat (OSS ai-assistant + ui)
- Tables `ai_agent_runs` (+ steps, tool calls) exist with all spec columns incl. `citations` jsonb, `capture_level`, five indexes (`AI/data/entities.ts:1011–1290`, `Migration20261026192929_ai_assistant`). **No migration needed.**
- `aiAgentRunReader` exists (`lib/agent-run-reader.ts`). No `api/ai/runs*` routes; no runs pages under `backend/config/ai-assistant/`. `acl.ts` has no `runs.view`/`runs.view_all`; `setup.ts:151–164` grants none.
- `LoopTrace.runId` (`ai-agent-definition.ts:248`) and assistant `metadata.runId` (`api/ai/chat/route.ts:396`) are set; UI never reads `runId`; `LoopTracePanel.tsx` has no `useT`.
- Conversation access: `AiChatConversationRepository.getById` / `canAccessConversation` / `list` participant logic (L193–280).
- Citations transport: `AiUiPartQueue` is never drained (`agent-tools.ts:98–122,429`); UI parts travel inside tool output JSON as `{ uiPart }` / `{ uiParts:[{componentId,payload}] }`, parsed by `ui/src/ai/useAiChat.ts:463–545`, persisted by `api/ai/chat/route.ts:268–297`. Field is `payload`. `McpToolContext` has no `uiParts` (`lib/types.ts:9`).
- No AO citation registry exists (no `components/citationResolvers.ts`, no `registerCitationResolver`) — the registry is new code in `packages/ui/src/ai/citations/`.

## Steps — Observability P3 (O3.x)
- **O3.1 Artifact store: content namespace, refs, tri-state reads.** `AGENT_TRACE_CONTENT_NAMESPACE='agent-trace-content'`; optional `namespace` on `putArtifact`; `ARTIFACT_REFS.llmRequest/llmResponse/contextPayload` (agent_run input/output); `readArtifact → {status:'ok',value}|{status:'missing'}|{status:'unavailable'}` (NoSuchKey/404 → missing), `getArtifact` kept as wrapper; widen `StorageServiceLike` with `list`/`delete`; `deleteArtifact`. Unit tests.
- **O3.2 Content builders, redaction, caps (`lib/trace/contentCapture.ts`).** `llm_request.v1` / `llm_response.v1` builders (spec "LLM span attributes" shapes); redaction order key `redactSecrets` → `redactSecretStrings` → optional `redactPiiStrings` (email/phone/IBAN/card with `{rule,count}`, added to `redactStrings.ts`); file/image parts → `{type:'file',mediaType,bytes,sha256}`; cap `OM_AGENT_TRACE_CONTENT_MAX_BYTES` (1 MiB), truncate largest message first with `{_truncated:true,originalBytes}`; return `{payload,bytes,truncated,redactions}`. Tests: session-token line, Bearer, emails only with `redactPii`, truncation markers, file parts.
- **O3.3 Native content retention + offload.** `createNativeModelCallCollector({retainContent})` keeps content only at `full`; `captureNativeRunTrace` builds + uploads artifacts before `buildNativeTracePayload` (bounded concurrency 4); `buildLlmSpanAttributes` writes `om.content.*.key`, status (`stored|storage_unavailable|over_cap_truncated`, `disabled` below `full`), `om.content.redactions`; over the 4000-char cap drop stop sequences then redactions, never the keys/status. Re-enable `retentionDays`/`redactPii` on the settings page and drop the "full = metadata only" notices (i18n ×5). Tests.
- **O3.4 Context payload offload.** Move `resolveRunCapture` before context assembly; `assemble` gets optional `contentCapture:{level,container}` → at `full` uploads packed records + untrusted span text + retrieval query, sets `payloadRef`; optional `retrieval:{queryHash,rank,k}` on routed sources. Tests (only at `full`; upload failure does not break assembly).
- **O3.5 Artifact route: content kinds, 403, 410, access log.** Kinds `llm_request|llm_response|context_payload` with in-handler `trace.view_content` (403); ownership: key must equal `om.content.*.key` on an llm span of this run or the run's bundle `payloadRef`; 410 when missing or the key's epoch prefix is older than `retentionDays`; access log via soft `accessLogService` resolve (`resourceKind 'agent_orchestrator.agent_run.content'`); `openApi`. Route tests.
- **O3.6 Retention worker.** `workers/trace-content-retention.ts` + queue constant + daily per-org schedule in `seedDefaults`; enumerate keys from the DB (llm spans + bundles in [cutoff−7d, cutoff]); strict delete, NoSuchKey = success; skip tenant when storage unavailable; env `OM_AGENT_TRACE_CONTENT_MAX_BYTES` mirrored into `.env.example` + template. Tests.
- **O3.7 TC-AGENT-TRACE-006 + docs.** 403 without `view_content`, 404 foreign key, cross-org 404, policy reset in finally; storage/provider-dependent cases skip with reason. Update `agent-trace-capture.mdx` and AO `AGENTS.md`.

## Steps — Observability P4 (O4.x)
- **O4.1 Ingest `llm`/`manifest` fields.** Additive `traceLlmIngestSchema` / `traceManifestIngestSchema`; `ingestTrace` maps to `gen_ai.*`; `trace.ingest` resolves the policy, offloads `request`/`response` at `full`, drops otherwise; `manifest` → `run.manifest` span with `om.invoker.kind='integration'`. Tests.
- **O4.2 OpenCode per-message llm spans.** `subscribeSession` also captures `message.updated` and `step-finish`; `ingestSessionTrace` emits one llm span per assistant message, `fidelity='reported'`, `om.cost.micros` from USD `cost` with `pricing_source='reported'` (new `PRICING_SOURCES` value); at `full`, reconstructed request artifact (redacted `buildMessage` + rendered agent); manifest gains `om.model.resolved`/`om.provider`. Tests with SSE fixtures; parse defensively.
- **O4.3 Tool-side knowledge/retrieval over MCP.** OSS: optional soft-resolved DI hook `mcpToolExecutionObserver` wrapping `executeTool` in `http-server.ts` (no-op when absent). AO `di.ts` registers a binder: resolve the run via `agentRunSessionStore.resolveActiveRunId(sessionId)`, wrap in `bindRunObservation`, write an idempotent `system` span `tool.observation` (`<runId>:obs:<correlationId>`) under `withRuntimeAuditWrite` when something was reported; OpenCode ingest folds into manifest `om.knowledge` and tool-span `om.knowledge`/`om.retrieval`. Tests both sides.
- **O4.4 Compare API.** Pure `lib/trace/runCompare.ts` (manifest/params `FieldDiff`, LCS line diff for the system prompt, JSON-path diff for messages/tools; no new dependency); `GET /runs/:id/compare?with&step` — `trace.view` metadata diff, content diff only with `view_content`; each run decrypted in its own scope; out of tenant/org → 404; `openApi`. Tests.
- **O4.5 Request/Response tabs.** `components/trace/LlmStepPanels.tsx` via `next/dynamic` in the Model calls rows; lazy `apiCall`; badges for expired / not captured / storage unavailable; without `view_content` an `Alert` + hashes/sizes; "Copy as JSON" per panel; virtualize > 200 messages; i18n ×5; render tests with/without the feature.
- **O4.6 Compare dialog + run-level copy.** `RunCompareDialog.tsx` (Cmd/Ctrl+Enter, Escape), default target `rerunOfRunId` else previous run of the same agent; header action; run-level copy (metadata / with content when permitted); i18n; tests.
- **O4.7 TC-AGENT-TRACE-007 + Playwright tabs + spec changelog.** Ingest two runs with different system prompts → compare shows the changed section; Playwright for the tabs; record deviations.

## Steps — Chat P3 (C3.x)
- **C3.1 ACL + query validators.** `ai_assistant.runs.view` (dependsOn `ai_assistant.view`), `runs.view_all`; defaults admin both, employee `view`; list/detail zod schemas (`pageSize ≤ 100`); i18n skeleton; auth ACL catalog titles ×5 (core guard). Tests.
- **C3.2 Runs API.** `lib/agent-run-access.ts` scope rule (own runs + conversations owned/participated/org-visible; `view_all` = all in tenant/org); `api/ai/runs/route.ts` (list, no content), `runs/[id]/route.ts` (detail via reader; 404 out of scope), `conversations/[conversationId]/runs/route.ts`; `openApi`; custom handlers (not `makeCrudRoute`). Route tests.
- **C3.3 Backend pages.** `backend/config/ai-assistant/runs/page.tsx` + list client, `[id]/page.tsx` + detail client; DataTable, StatusBadge, CollapsibleSection, JSON display, content-not-captured notice; `page.meta.ts` with feature guard + lucide icon; i18n ×5.
- **C3.4 Chat links.** `useAiChat` reads `loop-finish.trace.runId` and persisted `metadata.runId`; `AiChat` footer icon button (feature-gated); `LoopTracePanel` `useT` (`ui.ai.loopTrace.*`) + "Open full trace" link. Tests.
- **C3.5 Integration tests.** TC-AI-RUN-TRACE-015/017/018 + TC-AI-RUN-UI-019 with self-contained fixtures (stub/skip where a provider is needed).

## Steps — Chat P4 (C4.x)
- **C4.1 Citations helper.** `lib/citations.ts`: `aiCitationSchema`, `isSafeHref`, `emitCitations(ctx, citations, {title})` (dedupe, cap 20); per-call `McpToolContext.uiParts` collector; `adaptToolToAiSdk` merges collected parts into the tool output `uiParts` envelope as `{componentId:'ai_assistant:citations', payload}`; package export. Tests.
- **C4.2 UI registry + CitationsPart.** `packages/ui/src/ai/citations/registry.ts` (globalThis storage, last registration wins, fallback `label ?? ref`); `parts/CitationsPart.tsx` registered in the default registry; merge consecutive parts; external links `rel="noopener noreferrer"`; href re-check on the client; `ui.ai.citations.*` i18n. Tests.
- **C4.3 Recorder + Sources.** Recorder collects citation parts from the turn's tool outputs into `ai_agent_runs.citations`; detail page "Sources" section; `ai-tools/search-pack.ts` emits `record` citations. Tests.
- **C4.4 TC-AI-CITATIONS-020 + docs.** Integration test; correct `ui-parts.mdx`, `agents.mdx`, ai-assistant and ui `AGENTS.md`, `UPGRADE_NOTES` (ACL sync), spec changelog.

## Defaults applied
1. `om.content.*.sha256` stays the hash of the request as sent (pre-redaction); artifacts are redacted.
2. `includeProviderBody` stays a no-op (the AI SDK start event has no raw body); keep disabled, document.
3. 410 when the object is missing or the key's `<epochMs>` prefix is older than `retentionDays`.
4. Retention enumerates keys from the DB, not S3 listing (`list` cannot know `pathPrefix`).
5. Per-tool knowledge attribution on native runs deferred (run-level manifest only); per-tool for OpenCode/MCP.
6. OpenCode cost from reported `step-finish.cost` (USD → micros), `pricing_source='reported'`.
7. Chat runs routes are custom handlers (conversation-access join) — deviation from spec §API.
8. Citation registry is new code (no AO source to move); the chat spec's AO import-path BC rows are void.
9. Citations travel in the tool-output `uiParts` envelope (field `payload`), not `data-aiui`.

## Risks
- 4000-char span cap vs content keys (O3.3 drop order + test).
- Capture latency (awaited post-run upload; concurrency 4; queue fallback if needed).
- Trace content consumes tenant attachment quota (document).
- MCP-process `tool.observation` writes must pass `agentNoBypassSubscriber` (`withRuntimeAuditWrite`).
- OpenCode 1.18.3 event shapes are typed only in-repo; parse defensively.
- Retention schedule reaches only tenants that run `seedDefaults`.
- Full-content integration paths skip without storage/provider; ingest fixtures (O4.1) are the deterministic path.
- New chat ACL features need `yarn mercato auth sync-role-acls` on existing tenants.
