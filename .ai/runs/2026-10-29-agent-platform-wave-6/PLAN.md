# Execution Plan — Agent platform capabilities, wave 6

- **Date:** 2026-10-29
- **Slug:** agent-platform-wave-6
- **Source specs:**
  - `.ai/specs/2026-10-21-agent-platform-capabilities-roadmap.md` (umbrella, wave 6: "OTel P2 (and P3 as its own spec); DocStructure P4"; OTEL-Q2 and DOC-Q3 approved 2026-10-22)
  - `.ai/specs/enterprise/agent-orchestrator/2026-10-21-otel-genai-trace-export.md` (Phase 2; Phase 1 shipped in wave 4, PR #8061 — see its 2026-10-27 changelog deviations)
  - `.ai/specs/2026-10-21-document-structure-extraction.md` (Phase 4; Phases 1–3 shipped in waves 1 and 3)
- **Base branch:** `main` (open-mercato/open-mercato), **stacked on** `feat/agent-platform-wave-5` (PR #8099 at `283f5f509`; #7794/#8011/#8018/#8061/#8099 unmerged). Reviewers look only at wave 6's own commits: `git log feat/agent-platform-wave-5..feat/agent-platform-wave-6 --no-merges`.
- **Branch:** `feat/agent-platform-wave-6`
- **Run folder:** `.ai/runs/2026-10-29-agent-platform-wave-6/`
- **User decisions (2026-10-29):**
  - Q1 protobuf: hand-encode OTLP protobuf inside agent_orchestrator (no new dependency, no `@opentelemetry/*` import).
  - Q2 per-tenant OTLP endpoints: include (integration credentials per organization, `OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS` default `deny`, SSRF vetting via `@open-mercato/web-research`).
  - Q3 section-search gate: add optional `SearchEntityConfig.shouldIndex` in `@open-mercato/shared`, honored by `SearchIndexer`.
  - Q5 PR shape: ONE PR for all of wave 6.
  - Defaults kept (not asked): tool args/results exported only from llm content artifacts matched by call id; Step 4.7 records itself deferred if wave-5 `emitCitations` is not on the base.

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. When a Step lands, set `Status` to `done` and put its short SHA in `Commit`. The first row whose `Status` is not `done` is where `om-auto-continue-pr-loop` resumes. Step ids and `Exec` cells are immutable once the plan is committed; per-Step commits change only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Accept content export in the OTel settings when the deployment allows it | dispatch | done | pending |
| 1 | 1.2 | Map LLM content artifacts to GenAI message attributes | dispatch:capable | done | pending |
| 1 | 1.3 | Load a run's content artifacts for export | dispatch:capable | done | pending |
| 1 | 1.4 | Emit content events on exported chat and tool spans | dispatch:capable | done | pending |
| 1 | 1.5 | Enable the content control on the OTel export settings page | dispatch | done | pending |
| 2 | 2.1 | Add the OTLP protobuf encoder | dispatch:capable | todo | — |
| 2 | 2.2 | Send OTLP over http/protobuf | dispatch | todo | — |
| 3 | 3.1 | Declare the OTLP export integration | dispatch | todo | — |
| 3 | 3.2 | Vet tenant OTLP endpoints and pin their addresses | dispatch:capable | todo | — |
| 3 | 3.3 | Resolve the export destination per run | dispatch:capable | todo | — |
| 3 | 3.4 | Pick the export destination on the settings page | dispatch | todo | — |
| 3 | 3.5 | Cover content, protobuf and tenant endpoints with integration tests | dispatch | todo | — |
| 3 | 3.6 | Document OTel export phase 2 and mirror env vars | dispatch:cheap | todo | — |
| 4 | 4.1 | Add a shouldIndex hook to search entity configs | dispatch:capable | todo | — |
| 4 | 4.2 | Declare the document section search entity | dispatch:capable | todo | — |
| 4 | 4.3 | Add section search sync jobs to the structure queue | dispatch:capable | todo | — |
| 4 | 4.4 | Index sections when an extraction completes | dispatch | todo | — |
| 4 | 4.5 | Remove section search records when structure is purged | dispatch:capable | todo | — |
| 4 | 4.6 | Sync section search when a partition toggles indexing | dispatch | todo | — |
| 4 | 4.7 | Emit attachment citations from get_document_sections | dispatch | todo | — |
| 4 | 4.8 | Cover section search with integration tests | dispatch | todo | — |
| 4 | 4.9 | Document section search | dispatch:cheap | todo | — |
| 5 | 5.1 | Update the roadmap, upgrade notes and spec changelogs for wave 6 | inline | todo | — |

## Goal

Finish the last wave of the agent platform roadmap:
- **OTel export P2 (enterprise AO):** opt-in prompt/completion content events behind three locks (deployment `OM_AGENT_OTEL_EXPORT_CONTENT=allow`, tenant setting `content: full` set by a holder of `trace.view_content`, run captured at `full`); content leaves only through this separate channel. OTLP/HTTP protobuf. Per-tenant OTLP endpoints stored as encrypted integration credentials.
- **Document structure P4 (OSS core):** opt-in per-section search indexing so retrieval returns the paragraph, off by default, enabled per partition, with the plaintext-egress warning.

## Scope

- **agent_orchestrator (enterprise):** OTel P2 items 1–3. No AO DDL (squash-only).
- **attachments (OSS core):** `search.ts`; section index/delete/sync jobs on the existing `attachments-document-structure` queue; post-commit search cleanup on purge; partition toggle sync; `attachments structure search-sync` CLI; citations from `attachments.get_document_sections`. No attachments migration (partition columns already exist, `Migration20261023080922_attachments.ts`).
- **shared + search (OSS):** additive optional `SearchEntityConfig.shouldIndex`, honored by `SearchIndexer`.
- **New production dependencies:** none. `@open-mercato/web-research` is already an enterprise dependency.
- i18n en/pl/de/es/ko. Integration tests self-contained.

## Non-goals

- OTel P3 (live streaming via the platform telemetry bridge) — its own future spec (OTEL-Q5 "split").
- OTel P2.4 export ledger table `agent_trace_exports` (needs AO DDL; next re-squash list).
- Exporting OSS chat runs (OTEL-Q7). A search per-record visibility post-filter (residual snippet leak accepted in the spec's Risk Register).
- AO `AttachmentStructureDocumentProvider`, a `sections` conversion strategy, encrypting legacy `Attachment.content`, the `messages` nativeDelete purge gap.

## Code facts (verified on wave-5 at `9d6ae05fa`; re-check against `283f5f509` when a Step starts)

**OTel (AO = `packages/enterprise/src/modules/agent_orchestrator`)**
- Phase 1 in `lib/trace/otel/`: `exportBackfill.ts`, `exportHealth.ts`, `exportJob.ts`, `exportSettings.ts`, `exportSettingsForm.ts`, `finishedProcessExport.ts`, `ids.ts`, `loadRunExportBundle.ts`, `mapAgentRunToOtlp.ts`, `otelAttributes.ts`, `otlpHttpClient.ts`, `otlpJson.ts`, `traceLink.ts`. Worker `workers/otel-export.ts`. Routes `api/otel-export/{settings,test}/route.ts`. Page `backend/settings/otel-export/page.tsx`. Command `commands/otelExport.ts`.
- `exportSettings.ts`: `OTEL_EXPORT_ENV` reserves `content: 'OM_AGENT_OTEL_EXPORT_CONTENT'`, `protocol: 'OM_AGENT_OTEL_EXPORT_PROTOCOL'`; `OTEL_EXPORT_SUPPORTED_PROTOCOL = 'http/json'`; `resolveOtelExportDeployment()` → `enabled = switchOn && protocolSupported && endpoint !== null`; `contentAllowed` only when `allow`; `isExportEnabledFor({ deployment, tenant, agentId, runSource })`.
- `data/validators.ts:640` `otelExportSettingsSchema = { enabled, content: enum(OTEL_EXPORT_CONTENT_MODES) default 'none', exportUserIds, agentAllowlist? }`.
- `commands/otelExport.ts:101` `resolveOtelExportContentError`: `content_export_unavailable` when deployment allows (P1 deviation), `content_export_not_allowed` otherwise; `OTEL_EXPORT_CONTENT_WRITE_FEATURES` requires `trace.view_content`; PUT route calls it ~l.110, command l.159.
- `mapAgentRunToOtlp.ts`: pure `mapAgentRunToOtlp(bundle: MapAgentRunBundle, options)`; `buildLlmSpan` l.265, `buildToolSpan` l.319 (no `gen_ai.tool.call.id` today); strings pass `finalizeAttributes` → `redactAttributeValues`; chunking `OTEL_EXPORT_CHUNK_THRESHOLD = 1000`, chunk 512.
- `exportJob.ts`: `postAllChunks` → `JSON.stringify(encodeOtlpTraceRequest(chunk))` → `post({ endpoint, headers, body })`; `processOtelExportJob` re-reads tenant settings per job.
- `otlpHttpClient.ts`: `PostOtlpTracesInput.body: string`; content-type hard-coded `application/json`; gzip; `redirect: 'manual'`; `x-om-otel-export: 1`.
- `genAiAttributes.ts`: `GEN_AI_EVENTS.inferenceOperationDetails = 'gen_ai.client.inference.operation.details'`; `GEN_AI_ATTRIBUTES.toolCallArguments/toolCallResult/toolCallId`; `OM_LLM_ATTRIBUTES.contentRequestKey = 'om.content.request.key'`, `contentResponseKey = 'om.content.response.key'`; no keys yet for `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `gen_ai.tool.definitions`.
- Content (wave 5 O3): `contentCapture.ts` `LlmRequestArtifact` (`'om.llm_request.v1'`, `system`, `messages`, `tools`, `params`), `LlmResponseArtifact` (`'om.llm_response.v1'`, `finishReason`, `content[]`, `object?`, `usage`); `artifactStore.ts` `readArtifact(container, scope, ref, key)` tri-state `ok|missing|unavailable`, `ARTIFACT_REFS.llmRequest/llmResponse`; `contentArtifactAccess.ts` `isTraceContentKeyExpired(key, retentionDays)`, `recordTraceContentAccess(container, entry)`; manifest `'om.capture': { level }`, `RunManifestCapture` (`runManifest.ts:39`); artifact route takes `retentionDays` from the tenant capture policy (`api/runs/[id]/artifact/route.ts:116`).
- `AgentToolCall.requestArtifactKey/responseArtifactKey` are ingest offload-when-large (`traceIngestionService.ts:322`) — summaries; the spec forbids exporting them.
- Redaction `lib/trace/redactStrings.ts`: `redactString`, `redactPiiStrings`, `redactAttributeValues`.
- `packages/telemetry/AGENTS.md` Ask First: OTel packages imported only by `provider/otlp-provider.ts` and `browser/BrowserTelemetry.tsx` (hence Q1 = hand-encode in AO).
- `@open-mercato/web-research` exports `assertPublicUrl(url, label, { allowPrivateHosts })`, `createPinnedLookup(addresses)`, `isPrivateHostAllowed` (`src/net/ssrf.ts`, `src/net/client.ts`, re-exported from `src/index.ts`).
- Integrations: `IntegrationDefinition` + credential field types (`text|secret|url|boolean|select|oauth|ssh_keypair`) in `packages/shared/src/modules/integrations/types.ts`; credentials scoped by tenant AND organization (`integrationCredentialsService.resolve(id, scope)`, `packages/core/src/modules/integrations/lib/credentials-service.ts`); secrets must be `secret` fields, never inside a `url`; no enterprise module declares `integration.ts` today.
- Integration tests: `__integration__/TC-AGENT-OTEL-001-export-settings.spec.ts`, `TC-AGENT-OTEL-002-export-delivery.spec.ts`; `helpers/otelExportFixtures.ts` (fake receiver on `127.0.0.1:4319`, skips unless exporter env). `TC-AGENT-TRACE-006` shows the storage-unavailable skip.
- Docs `apps/docs/docs/framework/ai-assistant/agent-trace-otel-export.mdx`; env `apps/mercato/.env.example:841+`; compose `starters/docker/compose.agent-otel.yml`, `docker/otel-collector-config.jaeger.yaml`.

**Document structure (`packages/core/src/modules/attachments`)**
- Partition flags exist end to end: entity, migration, `api/partitions/route.ts` (l.69–70, 155–156, 200–228; PUT persists directly), `components/AttachmentPartitionSettings.tsx` (switches + plaintext-egress `Alert`), i18n `attachments.partitions.indexDocumentSections.{label,help,warning}` ×5. `encryption.ts` covers `attachments:attachment_document_section` (`heading`, `heading_path`, `text`) and extraction (`normalized_text`, `failure_reason`).
- No `search.ts`; nothing references search.
- `workers/document-structure.ts`: `runDocumentStructureExtraction` → `persistDraft` → `writeDraft` (l.364) soft-deletes live extractions (`nativeUpdate(..., { deletedAt })`) and inserts extraction + sections in one flush; outcomes `persisted|reused|failed_previous_kept|aborted|not_found|disabled`; `stats` jsonb on the extraction.
- `lib/documentStructure/queue.ts`: `documentStructureJobSchema` (requires `attachmentId`); `enqueueDocumentStructureExtraction(container | null, input)` falls back to `createModuleQueue`.
- `lib/documentStructure/purge.ts`: `purgeDocumentStructure(em, { attachmentId, tenantId, organizationId }, { flush })` scoped `nativeDelete`s, returns counts; called by `lib/storageReferences.ts` `removeAttachmentRecord` (own tx; used by `api/route.ts`, `api/library/[id]/route.ts`, `cli.ts`, warranty-claims portal) and `lib/attachment-service.ts` `releaseScoped` (l.493; returns provider-cleanup callback).
- `lib/documentStructure/locator.ts`: `buildCitation`, `buildCitationRef`, `formatSectionLocator`. `ai-tools.ts` imports types from `@open-mercato/ai-assistant` (peer dep of core).
- Search: `SearchEntityConfig` (`packages/shared/src/modules/search.ts:305`) has no index gate; `SearchIndexer.indexRecord` (`packages/search/src/indexer/search-indexer.ts:193`) indexes `fields: params.record` for fulltext + tokens even when `buildSource` returns null; `buildContext` has no `container`; `reindexEntity`/`reindexAll` → `listEnabledEntities()`; events `query_index.upsert_one` → `query_index.vectorize_one` + `search.index_record`; `query_index.delete_one` → vector delete + `search.delete_record` (`packages/core/src/modules/query_index/subscribers/{upsert_one,delete_one}.ts`); query engine decrypts mapped fields; no per-record result post-filter (`packages/documents/.../search.ts` keeps `enabled: false` for that reason).
- Integration tests `__integration__/TC-ATT-STRUCT-001..005,007.spec.ts`, `helpers/documentStructure.ts`; search call `/api/search/search?q=…&entityTypes=…&strategies=fulltext,tokens` (`packages/documents/.../TC-DOCUMENTS-004.spec.ts:136`).
- Wave-5 Step 6.1 adds `emitCitations(ctx, citations, { title })` (`@open-mercato/ai-assistant` `lib/citations.ts`) — needed by 4.7.

**Cross-cutting:** AO migrations squash-only; no new ACL features; `yarn generate` after `integration.ts`/`search.ts`; `yarn agents:check-budget`; AO i18n caps English-identical values.

## Implementation Plan

### Phase 1 — OTel P2: content events (AO)
#### 1.1 Accept content export in the OTel settings when the deployment allows it
- `commands/otelExport.ts` `resolveOtelExportContentError`: return `content_export_not_allowed` only while `deployment.contentAllowed` is false; drop the `unavailable` branch (keep `OTEL_EXPORT_CONTENT_ERRORS.unavailable` exported for BC). PUT route + command keep requiring `trace.view_content` for `content: 'full'`; undo restores prior value.
- `exportSettings.ts`: pure `resolveContentExportMode({ deployment, tenant, runCapture }): 'full' | 'none'` — `full` only when `deployment.contentAllowed && tenant.content === 'full' && runCapture?.level === 'full'`; missing manifest → `none`; re-evaluated per job.
- Tests: update `otel-export-settings-api.test.ts`, `otel-export-settings.test.ts` (lock matrix deny / allow w/o view_content → 403 / allow + view_content → 200); new `resolveContentExportMode` table test.
#### 1.2 Map LLM content artifacts to GenAI message attributes
- `genAiAttributes.ts`: `inputMessages: 'gen_ai.input.messages'`, `outputMessages: 'gen_ai.output.messages'`, `systemInstructions: 'gen_ai.system_instructions'`, `toolDefinitions: 'gen_ai.tool.definitions'`. `otelAttributes.ts`: `om.truncated`, `om.content.export_status` (`exported|unavailable|expired|over_budget|not_captured`).
- New pure `lib/trace/otel/genAiContent.ts`: `toSystemInstructions`, `toInputMessages` (text → `{type:'text',content}`, tool-call → `{type:'tool_call',id,name,arguments}`, tool-result → `{type:'tool_call_response',id,response}`, file → `{type:'file',mime_type,size,sha256}` never bytes), `toOutputMessages` (`[{role:'assistant',parts,finish_reason}]`, `object` as JSON text part), `toToolDefinitions`, `indexToolCallContent(req[], res[])` → `Map<callId,{arguments?,result?}>`. JSON-string attributes; every string leaf gets `redactPiiStrings` then `redactString`; cap 64 KiB per attribute (`OTEL_CONTENT_ATTRIBUTE_MAX_BYTES`), truncated → `om.truncated = true`.
- Tool args/results only from llm content artifacts matched by call id; never `agent_tool_calls` summaries/offload keys; tool spans without a call id omit them (changelog).
- Tests `otel-genai-content.test.ts`: parts, caps/truncation, PII + secret scrub, file parts without bytes, unknown schema → `null`.
#### 1.3 Load a run's content artifacts for export
- New `lib/trace/otel/loadRunExportContent.ts`: `loadRunExportContent(container, bundle, { retentionDays })` → `{ bySpanId: Map<spanRowId,{request?,response?,status}>, toolCalls: Map<callId,…> }`; only when mode is `full`; per `llm` span reads `om.content.request.key`/`.response.key` via `readArtifact` + `ARTIFACT_REFS.llmRequest/llmResponse`, scope from the run row; expired (`isTraceContentKeyExpired`, same retentionDays source as the artifact route) or `missing` → `expired`; `unavailable` → `unavailable`; concurrency 4; per-run budget `OTEL_CONTENT_RUN_MAX_BYTES = 4 MiB` → `over_budget`.
- Each successful read → `recordTraceContentAccess` with `actorUserId: null`, `apiKeyId: null`, `kind: 'otel_export:llm_request|llm_response'`. Never throws.
- Tests `otel-load-run-export-content.test.ts` (mock `readArtifact`): metadata run → no reads; expired → no read; budget; access-log entries.
#### 1.4 Emit content events on exported chat and tool spans
- `MapAgentRunBundle.content?: RunExportContent`. `buildLlmSpan` adds event `gen_ai.client.inference.operation.details` (timestamp = span end) with the four content attributes, sets `om.content.export_status`; `buildToolSpan` sets `gen_ai.tool.call.arguments/.result` by call id.
- Without `content` output byte-identical to P1 (golden `__tests__/fixtures/otel/trace-request.golden.json` unchanged); add a second golden with content.
- `exportJob.ts` `processOtelExportJob`: resolve mode → load content → map; byte-aware chunking (≤ `OTEL_EXPORT_MAX_REQUEST_BYTES = 4 MiB` uncompressed per request) on top of span count.
- `exportBackfill.ts` / `otel:export --dry-run` never prints content (document).
- Tests: extend `otel-map-agent-run.test.ts`, `otel-export-job.test.ts` with the lock matrix end to end.
#### 1.5 Enable the content control on the OTel export settings page
- `backend/settings/otel-export/page.tsx` + `exportSettingsForm.ts`: content select enabled when `deployment.contentAllowed` and the user holds `trace.view_content` (existing page feature-check pattern or `/api/auth/feature-check`); `full` shows `Alert variant="warning"` listing the three locks and the external transfer; surface 422/403.
- i18n ×5 (`agent_orchestrator.settings.otelExport.contentWarning`, `.contentRequiresViewContent`; update `contentHint`). Tests: `otel-export-settings-page.test.tsx`, `otel-export-settings-form.test.ts`.

### Phase 2 — OTel P2: protobuf (AO) — decision Q1: hand-encode in AO
#### 2.1 Add the OTLP protobuf encoder
- New `lib/trace/otel/otlpProto.ts`: `encodeOtlpTraceRequestProto(resourceSpans: OtlpResourceSpansInput[]): Uint8Array` — same input as `encodeOtlpTraceRequest`; wire format of `opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest`. Field numbers: `ExportTraceServiceRequest{1 resource_spans}`, `ResourceSpans{1 resource, 2 scope_spans}`, `Resource{1 attributes}`, `ScopeSpans{1 scope, 2 spans}`, `InstrumentationScope{1 name, 2 version}`, `Span{1 trace_id bytes, 2 span_id bytes, 4 parent_span_id bytes, 5 name, 6 kind, 7 start fixed64, 8 end fixed64, 9 attributes, 11 events, 13 links, 15 status}`, `Event{1 time fixed64, 2 name, 3 attributes}`, `Link{1 trace_id, 2 span_id, 4 attributes}`, `Status{2 message, 3 code}`, `KeyValue{1 key, 2 value}`, `AnyValue{1 string, 2 bool, 3 int64, 4 double, 5 array, 6 kvlist, 7 bytes}`, `ArrayValue{1 values}`, `KeyValueList{1 values}`. Hex ids → raw bytes; doubles per `OTLP_DOUBLE_ATTRIBUTE_KEYS`.
- Tests `otel-otlp-proto.test.ts`: in-test minimal wire decoder; golden hex fixture for one span/event/link generated once offline with `@opentelemetry/otlp-transformer` `ProtobufTraceSerializer` (provenance in fixture README; no runtime import); round-trip + JSON parity.
#### 2.2 Send OTLP over http/protobuf
- `exportSettings.ts`: `OTEL_EXPORT_SUPPORTED_PROTOCOLS = ['http/json','http/protobuf']` (keep `OTEL_EXPORT_SUPPORTED_PROTOCOL` for BC as default).
- `otlpHttpClient.ts`: `body: string | Uint8Array`, optional `contentType` (default `application/json`; `application/x-protobuf`).
- `exportJob.ts`, `api/otel-export/test/route.ts`, backfill pick the encoder by protocol; `--dry-run` keeps JSON. Page shows `deployment.protocol`; update i18n `protocolUnsupported` ×5.
- Tests: `otel-http-client.test.ts` (headers, binary body), `otel-export-job.test.ts` (protocol switch).

### Phase 3 — OTel P2: per-tenant endpoints (AO) + verification — decision Q2: include
#### 3.1 Declare the OTLP export integration
- New `AO/integration.ts` `IntegrationDefinition`: `id: 'agent_orchestrator_otel_export'`, closest existing `category` (observability if present), i18n title/description; credentials `endpoint` (`url`, required, no credentials in URL), `headers` (`secret`, optional, `k=v,k2=v2`), `protocol` (`select`: `http/json`|`http/protobuf`); `healthCheck: { service: 'agentOrchestratorOtelExportHealthCheck' }` registered in `di.ts`, sending the synthetic `om.export.test` span through 3.2/3.3 (extract the test-route logic into `lib/trace/otel/sendTestSpan.ts`). `yarn generate`; verify on `/backend/integrations`. i18n ×5.
#### 3.2 Vet tenant OTLP endpoints and pin their addresses
- New `lib/trace/otel/tenantEndpoint.ts`: `vetTenantOtlpEndpoint(url, env)` → `assertPublicUrl(url, 'otel export', { allowPrivateHosts: parse(OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS) })` → `{ url, addresses }` or `endpoint_blocked`.
- `otlpHttpClient.ts`: optional `pinnedAddresses` → `node:http`/`node:https` `request` with `lookup: createPinnedLookup(addresses)` (SNI/cert on hostname); keep no-redirect, gzip, timeout, marker header. Deployment endpoints keep `fetch`.
- New envs (default deny): `OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS` (`deny|allow`) → `tenantEndpointsAllowed` in `resolveOtelExportDeployment`; `OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS` (comma list).
- Tests `otel-tenant-endpoint.test.ts`: metadata IP, loopback, allowlisted private host, URL with credentials, non-http scheme.
#### 3.3 Resolve the export destination per run
- `otelExportSettingsSchema.destination = z.enum(['deployment','integration']).default('deployment')` (additive).
- New `lib/trace/otel/exportDestination.ts`: `resolveOtelExportDestination(container, deployment, settings, { tenantId, organizationId })` → `{ endpoint, headers, protocol, pinnedAddresses?, source }` | `{ error: 'integration_unconfigured'|'integration_disabled'|'tenant_endpoints_denied'|'endpoint_blocked' }`; `integration` → `integrationCredentialsService.resolve('agent_orchestrator_otel_export', scope)` (run's org), integration-state enabled check, `parseOtlpHeaders`, vetting; fails closed (never falls back to the deployment endpoint).
- `resolveOtelExportDeployment`: `enabled = switchOn && (deploymentEndpointUsable || tenantEndpointsAllowed)`; add `tenantEndpointsAllowed` to the GET deployment view (additive).
- `exportJob.ts` (per run), test route (caller's org), backfill use the destination; errors → `recordOtelExportHealth` + `reportError` (`agent_orchestrator.otel_export_rejected`), not retried. PUT `destination: 'integration'` while denied → 422 `tenant_endpoints_not_allowed`.
- Tests `otel-export-destination.test.ts` + job/settings API updates.
#### 3.4 Pick the export destination on the settings page
- Destination select (deployment / tenant integration), disabled with explanation when denied; for `integration` show status for the current org (`integration: { configured, enabled }` added to the settings GET, never URL/headers) + link to `/backend/integrations/agent_orchestrator_otel_export`; "Send test span" uses the resolved destination. i18n ×5. Page + form tests.
#### 3.5 Cover content, protobuf and tenant endpoints with integration tests
- `TC-AGENT-OTEL-003-content-export.spec.ts`: settings lock matrix (deny → 422 `content_export_not_allowed`; allow + user without `trace.view_content` → 403; admin → 200, restore in finally); ingested run with an `llm` span carrying a fake `om.content.request.key` at capture `full` → receiver gets the `chat` span with `om.content.export_status` `expired`/`unavailable` and no `gen_ai.input.messages`; metadata-captured run → no content event; real-content path only with trace storage (skip as TRACE-006); deployment-dependent cases skip unless `OM_AGENT_OTEL_EXPORT_CONTENT=allow`.
- `TC-AGENT-OTEL-004-protobuf-tenant-endpoint.spec.ts`: save integration credentials (`PUT /api/integrations/agent_orchestrator_otel_export/credentials`) to the fake receiver with `protocol: http/protobuf`, `destination: 'integration'` → receiver gets `content-type: application/x-protobuf` and the decoder finds `invoke_agent`; endpoint `http://169.254.169.254/v1/traces` → test span `ok: false`, `endpoint_blocked`; erase in finally; skips unless `OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS=allow` and `OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS=127.0.0.1`.
- Extend `helpers/otelExportFixtures.ts`: content-type capture, protobuf mini-decoder, credential helpers; env block in spec header comments.
#### 3.6 Document OTel export phase 2 and mirror env vars
- `agent-trace-otel-export.mdx`: content export (three locks, attributes, caps, access log, dry-run never prints content), protobuf, tenant destinations + SSRF rules, health codes.
- `apps/mercato/.env.example` + `packages/create-app/template/.env.example` (`yarn template:sync:fix`): protocol accepts `http/protobuf`; `OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS`, `OM_AGENT_OTEL_EXPORT_PRIVATE_HOSTS`; content text updated.
- AO `AGENTS.md` "Trace Capture and OTel Export": content only via `loadRunExportContent` + `genAiContent` (three locks, second redaction pass, access-logged); tenant endpoints only via `resolveOtelExportDestination` (vetted, pinned). `yarn agents:check-budget`.

### Phase 4 — DocStructure P4: per-section search (OSS) — decision Q3: shouldIndex hook
#### 4.1 Add a shouldIndex hook to search entity configs
- `packages/shared/src/modules/search.ts`: optional `SearchEntityConfig.shouldIndex?: (ctx: SearchBuildContext) => boolean | Promise<boolean>` (additive, documented).
- `packages/search/src/indexer/search-indexer.ts` `indexRecord`: false → `searchService.delete(entityId, recordId, tenantId)` and return; throwing hook = false (fail closed); same gate in `indexRecordsById`, `bulkIndexRecords`, reindex paths.
- Check the `query_index` token writer (`query_index/lib/indexer.ts` `reindexSearchTokensForRecord`): hashed tokens in Postgres are not plaintext egress; gate it too if any read path would surface non-opted sections, else document why tokens are acceptable.
- `packages/search/AGENTS.md`: one line on `shouldIndex`. Tests: indexer (false → delete, throw → delete, true → index).
#### 4.2 Declare the document section search entity
- New `attachments/search.ts`, entity `attachments:attachment_document_section`: `strategies: ['fulltext','vector','tokens']` (tokens-free if 4.1 shows they can't be gated); `aclFeatures: ['attachments.view']`; `fieldPolicy.searchable: ['number_label','heading','text']`, everything else non-structural excluded; `shouldIndex`: extraction live (`deleted_at` null) and partition `index_document_sections = true` via `ctx.queryEngine` (`attachments:attachment_document_extraction`, `attachments:attachment_partition`, global or same-tenant), tenant-less → false; `buildSource`: `{ text: [headingPath.join(' › '), text], presenter: { title: buildCitation(...), subtitle: fileName, icon: 'file-text', badge }, checksumSource: { textSha256, engineVersion } }`; `formatResult` renders the citation; `resolveUrl` → attachments library page (no deep link; record).
- i18n ×5 `attachments.search.badge.section`, `attachments.search.fallback.title`. `yarn generate`. Tests `__tests__/search-config.test.ts` (gate matrix, presenter, checksum).
#### 4.3 Add section search sync jobs to the structure queue
- `queue.ts`: job schema union — existing extract job stays default when `kind` absent (BC); new `{ kind: 'section-search', mode: 'index'|'delete', tenantId, organizationId, extractionId?, sectionIds?, partitionCode?, afterOrdinal? }`; helper `enqueueDocumentSectionSearch(container|null, input)` with no-container fallback.
- New `lib/documentStructure/sectionSearchSync.ts`: page 200 sections by `(extraction_id, ordinal)`, emit `query_index.upsert_one` / `query_index.delete_one` via `eventBus` with `{ entityType, recordId, tenantId, organizationId }`; continuation job with `afterOrdinal`; skip tenant-less; failures `reportError` `attachments.document_structure_search_failed`, never thrown into extraction. Worker `handle` dispatches by `kind`. Tests: schema BC, paging.
#### 4.4 Index sections when an extraction completes
- `writeDraft`: before soft-delete collect superseded live extraction ids with `stats.searchIndexed === true`; set `stats.searchIndexed = true` on the new extraction when partition `indexDocumentSections`, status `completed|partial`, tenant present. After commit enqueue `section-search/index` (new) and `section-search/delete` (superseded); `failed_previous_kept` changes nothing. Tests: extend `lib/documentStructure/__tests__/worker.test.ts`.
#### 4.5 Remove section search records when structure is purged
- `purge.ts`: before delete select scoped section ids of extractions with `stats.searchIndexed` (jsonb predicate) → additive `indexedSectionIds`. `removeAttachmentRecord`: after commit enqueue `section-search/delete` in chunks of 500 (default queue, no caller changes); errors logged, never fail the delete. `releaseScoped`: `flush: false` → enqueue inside the returned post-commit callback; own-tx → after commit. Tests `purge.test.ts`, `delete-paths-structure-purge.test.ts` (after commit, not on rollback).
#### 4.6 Sync section search when a partition toggles indexing
- `api/partitions/route.ts` PUT: on `indexDocumentSections` change enqueue `section-search` with `partitionCode`, mode `index`/`delete`, after flush; handler pages live extractions by `attachment_document_extractions.partition_code` (all scopes for a global partition), fans out per extraction; on enable sets `stats.searchIndexed`.
- CLI `mercato attachments structure search-sync --partition <code> [--tenant <id>] [--org <id>] [--mode index|delete] [--dry-run]` in `cli.ts` (same exit codes as `structure *`). Tests: partitions route (enqueue on change only), `cli-structure.test.ts`.
#### 4.7 Emit attachment citations from get_document_sections
- Requires wave-5 Step 6.1 `emitCitations`; if absent on the base, mark done as "deferred" with a note and no code.
- `ai-tools.ts`: `emitCitations(ctx, items.map(...), { title })` with `{ kind: 'attachment', ref: buildCitationRef({ attachmentId, anchorKey }) (≤ 300 chars), label: citation, locator: numberLabel ?? 'p. N', quote: text.slice(0, 1000) }`; keep existing `citation`/`locator` fields. If the wave-5 UI registry (`packages/ui/src/ai/citations/registry.ts`) supports module registration, register an `attachment` resolver to the library page; else label fallback. Tests `__tests__/ai-tool.test.ts`.
#### 4.8 Cover section search with integration tests
- New `TC-ATT-STRUCT-006.spec.ts` (self-contained; partition + upload via API; cleanup in finally): indexing on → upload synthetic rulebook PDF, poll extraction `completed`, poll `GET /api/search/search?q=<phrase unique to §8.12>&entityTypes=attachments:attachment_document_section&strategies=tokens` (+ `fulltext` when available) until presenter title contains `§8.12`; second partition with indexing off → no hit; toggle off → hit disappears; delete attachment → no hit; user without `attachments.view` → no results. Reuse `helpers/documentStructure.ts`; skip with reason when search strategies are unavailable.
#### 4.9 Document section search
- `apps/docs/docs/api/attachments.mdx`: partition flag, plaintext-egress warning, gate, `search-sync` CLI, reindex behavior, residual snippet-visibility caveat. `attachments/AGENTS.md`: section search records only via `section-search` jobs; purge enqueues their delete.

### Phase 5 — Close
#### 5.1 Update the roadmap, upgrade notes and spec changelogs for wave 6
- Roadmap wave-6 changelog; OTel P3 split into its own future spec (OTEL-Q5); record decisions Q1–Q3 + one-PR shape; keep `agent_trace_exports` on the next-re-squash list.
- `UPGRADE_NOTES.md` wave-6: content export (three locks, access-log entry per exported artifact); `http/protobuf`; envs `OM_AGENT_OTEL_EXPORT_TENANT_ENDPOINTS`/`_PRIVATE_HOSTS`; integration `agent_orchestrator_otel_export`; settings `destination` (additive); `SearchEntityConfig.shouldIndex` (additive); search entity `attachments:attachment_document_section`; toggling `indexDocumentSections` enqueues a sync; `attachments structure search-sync`.
- Every new env var in `apps/mercato/.env.example` + create-app template.
- OTel + DocStructure spec 2026-10-29 changelog entries with deviations (tool args by call id; protobuf hand-encoded in AO; credentials per organization; shouldIndex instead of buildSource-only gate; no deep link; no result post-filter; citations deferred if so).

## Risks

- **Content leaving the system (Critical):** three locks re-checked per job, second redaction pass, 64 KiB/attribute + 4 MiB/run caps, access-log per exported artifact, dry-run never prints content, lock-matrix tests (unit + integration). Residual: free-text PII evading pattern redaction once all locks are opened.
- **SSRF via tenant endpoints (High):** `assertPublicUrl` + pinned lookup (no DNS-rebinding window), no redirects, deny by default, private hosts only via allowlist; headers a `secret` field, never logged/returned.
- **Protobuf correctness:** hand-written encoder (fixed64, ids as bytes); golden fixture from the reference serializer, round-trip decoder test, manual QA against the Jaeger compose profile with `OM_AGENT_OTEL_EXPORT_PROTOCOL=http/protobuf`.
- **Plaintext section text in fulltext/vector stores (High, DOC-Q3 exception):** off by default, UI warning, gated in `SearchIndexer` so a manual reindex can't push non-opted sections; purge, toggle-off and supersede delete records.
- **Snippet visibility within an org (Medium, accepted):** no per-record post-filter; opening a hit still enforces `checkAttachmentAccess`.
- **Event volume:** up to 20,000 sections/document; 200 per job with continuation; async, fail-open.
- **Shared/search contract touch:** `shouldIndex` additive but in shared types + core indexer — flag for search owners.
- **Validation limits:** OTel delivery cases need the exporter env (skip otherwise); content-with-storage needs `storage-s3`; fulltext/vector need Meilisearch + embeddings, so CI asserts via `tokens`.
- **Size:** 23 Steps in one PR (user decision); checkpoints every 10+ Steps (user preference) — after 3.2 and after 4.9 at least.

## External References

None.
