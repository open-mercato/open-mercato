export const OTEL_STANDARD_ATTRIBUTES = {
  serviceName: 'service.name',
  serviceVersion: 'service.version',
  deploymentEnvironmentName: 'deployment.environment.name',
  endUserId: 'enduser.id',
  errorType: 'error.type',
} as const

export const OTEL_ERROR_TYPE_OTHER = '_OTHER'
export const OTEL_ERROR_TYPE_CANCELLED = 'cancelled'

export const OM_OTEL_RESOURCE_ATTRIBUTES = {
  tenantId: 'om.tenant.id',
  organizationId: 'om.organization.id',
  genAiSemconv: 'om.genai.semconv',
} as const

export const OM_OTEL_RUN_ATTRIBUTES = {
  runId: 'om.run.id',
  source: 'om.run.source',
  runtime: 'om.run.runtime',
  resultKind: 'om.run.result_kind',
  agentType: 'om.run.agent_type',
  confidence: 'om.run.confidence',
  rerunOf: 'om.run.rerun_of',
  costMinor: 'om.cost.minor',
  costCurrency: 'om.cost.currency',
  workflowStepId: 'om.workflow.step_id',
  invocationId: 'om.invocation.id',
  entryPoint: 'om.entry_point',
  channel: 'om.channel',
  correlationId: 'om.correlation_id',
  invokerKind: 'om.invoker.kind',
  agentDefinitionHash: 'om.agent.definition_hash',
  promptOverrideVersion: 'om.prompt.override.version',
  toolsSha256: 'om.tools.sha256',
  knowledgePrefix: 'om.knowledge.',
} as const

export const OM_OTEL_PROCESS_ATTRIBUTES = {
  executionId: 'om.process.execution_id',
  definitionId: 'om.process.definition_id',
  status: 'om.process.status',
  subjectType: 'om.subject.type',
} as const

export const OM_OTEL_TOOL_ATTRIBUTES = {
  status: 'om.tool.status',
  latencyMs: 'om.tool.latency_ms',
} as const

export const OM_OTEL_SPAN_ATTRIBUTES = {
  spanName: 'om.span.name',
} as const

export const OM_OTEL_PROPOSAL_ATTRIBUTES = {
  proposalId: 'om.proposal.id',
  disposition: 'om.proposal.disposition',
  dispositionByKind: 'om.proposal.disposition_by_kind',
  autoDispositionBlock: 'om.proposal.auto_disposition_block',
  selectedOptionId: 'om.proposal.selected_option_id',
} as const

export const OM_OTEL_EFFECTOR_ATTRIBUTES = {
  ok: 'om.effector.ok',
  commandIds: 'om.effector.command_ids',
  state: 'om.effector.state',
} as const

export const OM_OTEL_GUARDRAIL_ATTRIBUTES = {
  capability: 'om.guardrail.capability',
  verdict: 'om.guardrail.verdict',
  kind: 'om.guardrail.kind',
  phase: 'om.guardrail.phase',
} as const

export const OM_OTEL_SPAN_NAMES = {
  proposalDisposition: 'om.proposal.disposition',
  proposalExecute: 'om.proposal.execute',
  systemPrefix: 'om.',
} as const

export const OM_OTEL_EVENTS = {
  guardrailCheck: 'om.guardrail.check',
} as const

export const OTEL_LINK_ATTRIBUTES = {
  relation: 'om.link.relation',
} as const

export const OTEL_LINK_RELATIONS = {
  platformTrace: 'platform_trace',
  rerunOf: 'rerun_of',
} as const

export const OTEL_GEN_AI_TOOL_TYPE_FUNCTION = 'function'
