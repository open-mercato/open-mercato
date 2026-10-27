import { z } from 'zod'
import {
  GEN_AI_ATTRIBUTES,
  GEN_AI_EVENTS,
  GEN_AI_OPERATIONS,
  GEN_AI_SEMCONV_VERSION,
  OM_LLM_ATTRIBUTES,
  readLlmSpanMetadata,
} from '../genAiAttributes'
import { redactAttributeValues } from '../redactStrings'
import { agentSpanId, dispositionSpanId, runSpanId, traceIdFor, workflowSpanId } from './ids'
import type {
  RunExportBundle,
  RunExportEffectorSpan,
  RunExportEvalResult,
  RunExportGuardrailCheck,
  RunExportProposal,
  RunExportSpan,
  RunExportToolCall,
} from './loadRunExportBundle'
import {
  OM_OTEL_EFFECTOR_ATTRIBUTES,
  OM_OTEL_EVENTS,
  OM_OTEL_GUARDRAIL_ATTRIBUTES,
  OM_OTEL_PROCESS_ATTRIBUTES,
  OM_OTEL_PROPOSAL_ATTRIBUTES,
  OM_OTEL_RESOURCE_ATTRIBUTES,
  OM_OTEL_RUN_ATTRIBUTES,
  OM_OTEL_SPAN_ATTRIBUTES,
  OM_OTEL_SPAN_NAMES,
  OM_OTEL_TOOL_ATTRIBUTES,
  OTEL_ERROR_TYPE_CANCELLED,
  OTEL_ERROR_TYPE_OTHER,
  OTEL_GEN_AI_TOOL_TYPE_FUNCTION,
  OTEL_LINK_ATTRIBUTES,
  OTEL_LINK_RELATIONS,
  OTEL_STANDARD_ATTRIBUTES,
} from './otelAttributes'
import type {
  OtlpAttributeValue,
  OtlpEventInput,
  OtlpLinkInput,
  OtlpResourceSpansInput,
  OtlpSpanInput,
  OtlpStatusInput,
} from './otlpJson'

export const OTEL_EXPORT_SCOPE_NAME = '@open-mercato/enterprise/agent_orchestrator'
export const OTEL_EXPORT_CHUNK_THRESHOLD = 1000
export const OTEL_EXPORT_CHUNK_SIZE = 512

export type MapAgentRunToOtlpOptions = {
  exportUserIds: boolean
  serviceName: string
  serviceVersion: string
  environment?: string | null
  scopeVersion: string
}

export type MapAgentRunBundle = RunExportBundle & { rerunOfTraceId?: string | null }

type MutableAttributes = Record<string, OtlpAttributeValue>

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/
const ZERO_ID_RE = /^0+$/
const TRACE_ID_RE = /^[0-9a-f]{32}$/

const effectorAttributesSchema = z.object({
  [OM_OTEL_EFFECTOR_ATTRIBUTES.ok]: z.boolean().optional().catch(undefined),
  [OM_OTEL_EFFECTOR_ATTRIBUTES.commandIds]: z.array(z.string()).optional().catch(undefined),
  [OM_OTEL_EFFECTOR_ATTRIBUTES.state]: z.string().min(1).optional().catch(undefined),
})

function setAttribute(target: MutableAttributes, key: string, value: OtlpAttributeValue): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && value.length === 0) return
  target[key] = value
}

function finalizeAttributes(attributes: MutableAttributes): MutableAttributes {
  return redactAttributeValues(attributes)
}

function endTimeFor(startedAt: Date, endedAt: Date | null, durationMs: number | null): Date {
  if (endedAt) return endedAt
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
    return new Date(startedAt.getTime() + durationMs)
  }
  return startedAt
}

function statusFor(status: string): { status: OtlpStatusInput; errorType: string | null } {
  if (status === 'error') return { status: { code: 'error' }, errorType: OTEL_ERROR_TYPE_OTHER }
  if (status === 'cancelled') return { status: { code: 'error' }, errorType: OTEL_ERROR_TYPE_CANCELLED }
  return { status: { code: 'unset' }, errorType: null }
}

export function parseTraceparent(value: unknown): { traceId: string; spanId: string } | null {
  if (typeof value !== 'string') return null
  const match = TRACEPARENT_RE.exec(value.trim().toLowerCase())
  if (!match) return null
  const [, traceId, spanId] = match
  if (ZERO_ID_RE.test(traceId) || ZERO_ID_RE.test(spanId)) return null
  return { traceId, spanId }
}

function workflowName(bundle: MapAgentRunBundle): string | null {
  const processInstance = bundle.processInstance
  return processInstance?.workflowId ?? processInstance?.processDefinitionId ?? bundle.run.workflowInstanceId
}

function buildWorkflowSpan(bundle: MapAgentRunBundle, traceId: string): OtlpSpanInput | null {
  const workflowInstanceId = bundle.run.workflowInstanceId
  const processInstance = bundle.processInstance
  if (!workflowInstanceId || !processInstance || bundle.run.parentRunId) return null
  const name = workflowName(bundle)
  const attributes: MutableAttributes = {}
  setAttribute(attributes, GEN_AI_ATTRIBUTES.operationName, GEN_AI_OPERATIONS.invokeWorkflow)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.workflowName, name)
  setAttribute(attributes, OM_OTEL_PROCESS_ATTRIBUTES.executionId, processInstance.id)
  setAttribute(attributes, OM_OTEL_PROCESS_ATTRIBUTES.definitionId, processInstance.processDefinitionId)
  setAttribute(attributes, OM_OTEL_PROCESS_ATTRIBUTES.status, processInstance.status)
  setAttribute(attributes, OM_OTEL_PROCESS_ATTRIBUTES.subjectType, processInstance.subjectType)
  const { status, errorType } = statusFor(processInstance.status === 'failed' ? 'error' : processInstance.status)
  setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.errorType, errorType)
  const runEnd = bundle.run.completedAt ?? bundle.run.createdAt
  return {
    traceId,
    spanId: workflowSpanId(workflowInstanceId),
    name: name ? `${GEN_AI_OPERATIONS.invokeWorkflow} ${name}` : GEN_AI_OPERATIONS.invokeWorkflow,
    kind: 'internal',
    startTime: processInstance.createdAt,
    endTime: processInstance.completedAt ?? (runEnd > processInstance.createdAt ? runEnd : processInstance.createdAt),
    attributes: finalizeAttributes(attributes),
    status,
  }
}

function runParentSpanId(bundle: MapAgentRunBundle): string | null {
  if (bundle.run.parentRunId) return runSpanId(bundle.run.parentRunId)
  if (bundle.run.workflowInstanceId && bundle.processInstance) return workflowSpanId(bundle.run.workflowInstanceId)
  return null
}

function applyManifestAttributes(attributes: MutableAttributes, bundle: MapAgentRunBundle, options: MapAgentRunToOtlpOptions): void {
  const manifest = bundle.manifest
  if (!manifest) return
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.agentDefinitionHash, manifest['om.agent.definition_hash'])
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.promptOverrideVersion, manifest['om.prompt.override']?.version)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.toolsSha256, manifest['om.tools.sha256'])
  for (const [key, value] of Object.entries(manifest['om.knowledge'] ?? {})) {
    setAttribute(attributes, `${OM_OTEL_RUN_ATTRIBUTES.knowledgePrefix}${key}`, value)
  }
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.entryPoint, manifest['om.entry_point'])
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.channel, manifest['om.channel'])
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.correlationId, manifest['om.correlation_id'])
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.invokerKind, manifest['om.invoker']?.kind)
  if (options.exportUserIds) {
    setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.endUserId, manifest['om.invoker']?.userId)
  }
}

function buildRunLinks(bundle: MapAgentRunBundle): OtlpLinkInput[] {
  const links: OtlpLinkInput[] = []
  const platformTrace = parseTraceparent(bundle.manifest?.['om.platform_trace']?.traceparent)
  if (platformTrace) {
    links.push({
      ...platformTrace,
      attributes: { [OTEL_LINK_ATTRIBUTES.relation]: OTEL_LINK_RELATIONS.platformTrace },
    })
  }
  const rerunOfTraceId = bundle.rerunOfTraceId?.toLowerCase() ?? null
  if (bundle.run.rerunOfRunId && rerunOfTraceId && TRACE_ID_RE.test(rerunOfTraceId) && !ZERO_ID_RE.test(rerunOfTraceId)) {
    links.push({
      traceId: rerunOfTraceId,
      spanId: runSpanId(bundle.run.rerunOfRunId),
      attributes: { [OTEL_LINK_ATTRIBUTES.relation]: OTEL_LINK_RELATIONS.rerunOf },
    })
  }
  return links
}

function hasRerunLink(links: readonly OtlpLinkInput[]): boolean {
  return links.some((link) => link.attributes?.[OTEL_LINK_ATTRIBUTES.relation] === OTEL_LINK_RELATIONS.rerunOf)
}

function evalScoreLabel(result: RunExportEvalResult): string | null {
  if (result.passed === true) return 'pass'
  if (result.passed === false) return result.severity === 'warn' ? 'warn' : 'fail'
  return null
}

function buildEvalEvent(result: RunExportEvalResult): OtlpEventInput {
  const attributes: MutableAttributes = {}
  setAttribute(attributes, GEN_AI_ATTRIBUTES.evaluationName, result.assertionKey)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.evaluationScoreValue, result.score)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.evaluationScoreLabel, evalScoreLabel(result))
  return { time: result.evaluatedAt, name: GEN_AI_EVENTS.evaluationResult, attributes: finalizeAttributes(attributes) }
}

function buildGuardrailEvent(check: RunExportGuardrailCheck): OtlpEventInput {
  const attributes: MutableAttributes = {}
  setAttribute(attributes, OM_OTEL_GUARDRAIL_ATTRIBUTES.capability, check.capability)
  setAttribute(attributes, OM_OTEL_GUARDRAIL_ATTRIBUTES.verdict, check.result)
  setAttribute(attributes, OM_OTEL_GUARDRAIL_ATTRIBUTES.kind, check.kind)
  setAttribute(attributes, OM_OTEL_GUARDRAIL_ATTRIBUTES.phase, check.phase)
  setAttribute(attributes, OM_OTEL_PROPOSAL_ATTRIBUTES.proposalId, check.proposalId)
  return { time: check.createdAt, name: OM_OTEL_EVENTS.guardrailCheck, attributes: finalizeAttributes(attributes) }
}

function buildRunSpan(
  bundle: MapAgentRunBundle,
  traceId: string,
  options: MapAgentRunToOtlpOptions,
): OtlpSpanInput {
  const run = bundle.run
  const attributes: MutableAttributes = {}
  setAttribute(attributes, GEN_AI_ATTRIBUTES.operationName, GEN_AI_OPERATIONS.invokeAgent)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.agentId, run.agentId)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.agentName, bundle.agentLabel)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.agentVersion, run.agentVersion)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestModel, run.model)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.usageInputTokens, run.inputTokens)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.usageOutputTokens, run.outputTokens)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.runId, run.id)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.source, run.source)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.runtime, run.runtime)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.resultKind, run.resultKind)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.agentType, run.agentType)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.confidence, run.confidence)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.costMinor, run.costMinor)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.costCurrency, run.currency)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.workflowStepId, run.stepId)
  setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.invocationId, run.invocationId)
  applyManifestAttributes(attributes, bundle, options)
  const links = buildRunLinks(bundle)
  if (run.rerunOfRunId && !hasRerunLink(links)) {
    setAttribute(attributes, OM_OTEL_RUN_ATTRIBUTES.rerunOf, run.rerunOfRunId)
  }
  const { status, errorType } = statusFor(run.status)
  setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.errorType, errorType)
  return {
    traceId,
    spanId: runSpanId(run.id),
    parentSpanId: runParentSpanId(bundle),
    name: `${GEN_AI_OPERATIONS.invokeAgent} ${run.agentId}`,
    kind: 'internal',
    startTime: run.createdAt,
    endTime: endTimeFor(run.createdAt, run.completedAt, run.latencyMs),
    attributes: finalizeAttributes(attributes),
    events: [...bundle.evalResults.map(buildEvalEvent), ...bundle.guardrailChecks.map(buildGuardrailEvent)],
    links,
    status,
  }
}

function buildLlmSpan(span: RunExportSpan, bundle: MapAgentRunBundle, traceId: string, parentSpanId: string): OtlpSpanInput {
  const metadata = readLlmSpanMetadata(span.attributes)
  const requestModel = metadata.requestModel ?? bundle.run.model ?? undefined
  const displayModel = metadata.responseModel ?? requestModel
  const attributes: MutableAttributes = {}
  setAttribute(attributes, GEN_AI_ATTRIBUTES.operationName, GEN_AI_OPERATIONS.chat)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.providerName, metadata.providerName)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestModel, requestModel)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.responseModel, metadata.responseModel)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.responseId, metadata.responseId)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestTemperature, metadata.params.temperature)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestTopP, metadata.params.topP)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestTopK, metadata.params.topK)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestMaxTokens, metadata.params.maxTokens)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestSeed, metadata.params.seed)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestStopSequences, metadata.params.stopSequences)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestPresencePenalty, metadata.params.presencePenalty)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.requestFrequencyPenalty, metadata.params.frequencyPenalty)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.usageInputTokens, metadata.usage.inputTokens)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.usageOutputTokens, metadata.usage.outputTokens)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.usageCacheReadInputTokens, metadata.usage.cachedInputTokens)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.usageReasoningOutputTokens, metadata.usage.reasoningTokens)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.responseFinishReasons, metadata.finishReasons)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.outputType, metadata.outputType)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.costMicros, metadata.costMicros)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.costCurrency, metadata.costCurrency)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.costPricingSource, metadata.pricingSource)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.latencyMs, metadata.latencyMs)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.promptSystemSha256, metadata.promptSystemSha256)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.toolsSha256, metadata.toolsSha256)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.toolsCount, metadata.toolsCount)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.messagesCount, metadata.messagesCount)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.contentRequestSha256, metadata.contentRequestSha256)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.contentRequestBytes, metadata.contentRequestBytes)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.contentResponseSha256, metadata.contentResponseSha256)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.contentResponseBytes, metadata.contentResponseBytes)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.contentStatus, metadata.contentStatus)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.captureFidelity, metadata.fidelity)
  setAttribute(attributes, OM_LLM_ATTRIBUTES.paramsDefaults, metadata.paramsDefaults)
  const { status, errorType } = statusFor(span.status)
  setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.errorType, errorType)
  return {
    traceId,
    spanId: agentSpanId(span.id),
    parentSpanId,
    name: displayModel ? `${GEN_AI_OPERATIONS.chat} ${displayModel}` : GEN_AI_OPERATIONS.chat,
    kind: 'client',
    startTime: span.startedAt,
    endTime: endTimeFor(span.startedAt, span.endedAt, span.durationMs),
    attributes: finalizeAttributes(attributes),
    status,
  }
}

function buildToolSpan(
  span: RunExportSpan,
  toolCall: RunExportToolCall | undefined,
  traceId: string,
  parentSpanId: string,
): OtlpSpanInput {
  const toolName = toolCall?.toolName ?? span.name
  const isError = span.status === 'error' || toolCall?.isError === true
  const attributes: MutableAttributes = {}
  setAttribute(attributes, GEN_AI_ATTRIBUTES.operationName, GEN_AI_OPERATIONS.executeTool)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.toolName, toolName)
  setAttribute(attributes, GEN_AI_ATTRIBUTES.toolType, OTEL_GEN_AI_TOOL_TYPE_FUNCTION)
  setAttribute(attributes, OM_OTEL_TOOL_ATTRIBUTES.status, toolCall?.status ?? span.status)
  setAttribute(attributes, OM_OTEL_TOOL_ATTRIBUTES.latencyMs, toolCall?.latencyMs ?? span.durationMs)
  const { status, errorType } = statusFor(isError ? 'error' : 'ok')
  setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.errorType, errorType)
  return {
    traceId,
    spanId: agentSpanId(span.id),
    parentSpanId,
    name: `${GEN_AI_OPERATIONS.executeTool} ${toolName}`,
    kind: 'internal',
    startTime: span.startedAt,
    endTime: endTimeFor(span.startedAt, span.endedAt, span.durationMs),
    attributes: finalizeAttributes(attributes),
    status,
  }
}

function buildSystemSpan(span: RunExportSpan, traceId: string, parentSpanId: string): OtlpSpanInput {
  const attributes: MutableAttributes = {}
  setAttribute(attributes, OM_OTEL_SPAN_ATTRIBUTES.spanName, span.name)
  const { status, errorType } = statusFor(span.status)
  setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.errorType, errorType)
  return {
    traceId,
    spanId: agentSpanId(span.id),
    parentSpanId,
    name: `${OM_OTEL_SPAN_NAMES.systemPrefix}${span.name}`,
    kind: 'internal',
    startTime: span.startedAt,
    endTime: endTimeFor(span.startedAt, span.endedAt, span.durationMs),
    attributes: finalizeAttributes(attributes),
    status,
  }
}

function buildDispositionSpan(proposal: RunExportProposal, traceId: string, parentSpanId: string): OtlpSpanInput {
  const attributes: MutableAttributes = {}
  setAttribute(attributes, OM_OTEL_PROPOSAL_ATTRIBUTES.proposalId, proposal.id)
  setAttribute(attributes, OM_OTEL_PROPOSAL_ATTRIBUTES.disposition, proposal.disposition)
  setAttribute(attributes, OM_OTEL_PROPOSAL_ATTRIBUTES.dispositionByKind, proposal.dispositionByKind)
  setAttribute(attributes, OM_OTEL_PROPOSAL_ATTRIBUTES.autoDispositionBlock, proposal.autoDispositionBlock)
  setAttribute(attributes, OM_OTEL_PROPOSAL_ATTRIBUTES.selectedOptionId, proposal.selectedOptionId)
  return {
    traceId,
    spanId: dispositionSpanId(proposal.id),
    parentSpanId,
    name: OM_OTEL_SPAN_NAMES.proposalDisposition,
    kind: 'internal',
    startTime: proposal.createdAt,
    endTime: proposal.updatedAt > proposal.createdAt ? proposal.updatedAt : proposal.createdAt,
    attributes: finalizeAttributes(attributes),
    status: { code: 'unset' },
  }
}

function buildEffectorSpan(span: RunExportEffectorSpan, traceId: string): OtlpSpanInput {
  const effector = effectorAttributesSchema.safeParse(span.attributes ?? {})
  const values = effector.success ? effector.data : {}
  const attributes: MutableAttributes = {}
  setAttribute(attributes, OM_OTEL_PROPOSAL_ATTRIBUTES.proposalId, span.proposalId)
  setAttribute(attributes, OM_OTEL_EFFECTOR_ATTRIBUTES.ok, values[OM_OTEL_EFFECTOR_ATTRIBUTES.ok])
  setAttribute(attributes, OM_OTEL_EFFECTOR_ATTRIBUTES.commandIds, values[OM_OTEL_EFFECTOR_ATTRIBUTES.commandIds])
  setAttribute(attributes, OM_OTEL_EFFECTOR_ATTRIBUTES.state, values[OM_OTEL_EFFECTOR_ATTRIBUTES.state])
  const { status, errorType } = statusFor(span.status)
  setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.errorType, errorType)
  return {
    traceId,
    spanId: agentSpanId(span.id),
    parentSpanId: dispositionSpanId(span.proposalId),
    name: OM_OTEL_SPAN_NAMES.proposalExecute,
    kind: 'internal',
    startTime: span.startedAt,
    endTime: endTimeFor(span.startedAt, span.endedAt, span.durationMs),
    attributes: finalizeAttributes(attributes),
    status,
  }
}

function buildChildSpans(bundle: MapAgentRunBundle, traceId: string, runSpan: string): OtlpSpanInput[] {
  const llmSpanRowIds = new Set(bundle.spans.filter((span) => span.kind === 'llm').map((span) => span.id))
  const toolCallBySpanId = new Map<string, RunExportToolCall>()
  for (const toolCall of bundle.toolCalls) {
    if (!toolCallBySpanId.has(toolCall.spanId)) toolCallBySpanId.set(toolCall.spanId, toolCall)
  }
  const spans: OtlpSpanInput[] = []
  for (const span of bundle.spans) {
    if (span.kind === 'llm') {
      spans.push(buildLlmSpan(span, bundle, traceId, runSpan))
    } else if (span.kind === 'tool') {
      const parent = span.parentSpanId && llmSpanRowIds.has(span.parentSpanId) ? agentSpanId(span.parentSpanId) : runSpan
      spans.push(buildToolSpan(span, toolCallBySpanId.get(span.id), traceId, parent))
    } else {
      spans.push(buildSystemSpan(span, traceId, runSpan))
    }
  }
  const disposedProposalIds = new Set<string>()
  for (const proposal of bundle.proposals) {
    if (proposal.disposition === 'pending') continue
    disposedProposalIds.add(proposal.id)
    spans.push(buildDispositionSpan(proposal, traceId, runSpan))
  }
  for (const effectorSpan of bundle.effectorSpans) {
    if (!disposedProposalIds.has(effectorSpan.proposalId)) continue
    spans.push(buildEffectorSpan(effectorSpan, traceId))
  }
  return spans
}

function buildResourceAttributes(bundle: MapAgentRunBundle, options: MapAgentRunToOtlpOptions): MutableAttributes {
  const attributes: MutableAttributes = {}
  setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.serviceName, options.serviceName)
  setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.serviceVersion, options.serviceVersion)
  setAttribute(attributes, OTEL_STANDARD_ATTRIBUTES.deploymentEnvironmentName, options.environment)
  setAttribute(attributes, OM_OTEL_RESOURCE_ATTRIBUTES.tenantId, bundle.run.tenantId)
  setAttribute(attributes, OM_OTEL_RESOURCE_ATTRIBUTES.organizationId, bundle.run.organizationId)
  setAttribute(attributes, OM_OTEL_RESOURCE_ATTRIBUTES.genAiSemconv, GEN_AI_SEMCONV_VERSION)
  return finalizeAttributes(attributes)
}

function chunkSpans(spans: OtlpSpanInput[]): OtlpSpanInput[][] {
  if (spans.length <= OTEL_EXPORT_CHUNK_THRESHOLD) return [spans]
  const chunks: OtlpSpanInput[][] = []
  for (let offset = 0; offset < spans.length; offset += OTEL_EXPORT_CHUNK_SIZE) {
    chunks.push(spans.slice(offset, offset + OTEL_EXPORT_CHUNK_SIZE))
  }
  return chunks
}

export function mapAgentRunToOtlp(
  bundle: MapAgentRunBundle,
  options: MapAgentRunToOtlpOptions,
): OtlpResourceSpansInput[] {
  const traceId = traceIdFor({
    tenantId: bundle.run.tenantId,
    workflowInstanceId: bundle.run.workflowInstanceId,
    rootRunId: bundle.rootRunId,
  })
  const workflowSpan = buildWorkflowSpan(bundle, traceId)
  const runSpan = buildRunSpan(bundle, traceId, options)
  const spans: OtlpSpanInput[] = [
    ...(workflowSpan ? [workflowSpan] : []),
    runSpan,
    ...buildChildSpans(bundle, traceId, runSpan.spanId),
  ]
  const resourceAttributes = buildResourceAttributes(bundle, options)
  const scope = { name: OTEL_EXPORT_SCOPE_NAME, version: options.scopeVersion }
  return chunkSpans(spans).map((chunk) => ({
    resource: { attributes: resourceAttributes },
    scopeSpans: [{ scope, spans: chunk }],
  }))
}
