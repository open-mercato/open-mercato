import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  AgentEvalResult,
  AgentGuardrailCheck,
  AgentProposal,
  AgentRun,
  AgentSpan,
  AgentToolCall,
  ProcessInstance,
  type AgentEvalSeverity,
  type AgentProposalAutoDispositionBlock,
  type AgentProposalDisposition,
  type AgentRunSource,
  type AgentRunStatus,
  type AgentSpanKind,
  type AgentSpanStatus,
  type AgentToolCallStatus,
  type GuardrailKind,
  type GuardrailPhase,
  type GuardrailResult,
  type ProcessInstanceStatus,
} from '../../../data/entities'
import type { AgentType } from '../../../data/validators'
import { getAgentEntry } from '../../sdk/defineAgent'
import { isRunManifestSpan, parseRunManifestAttributes, type RunManifestView } from '../runManifestView'

export const RUN_EXPORT_ROOT_RUN_MAX_DEPTH = 10
export const EFFECTOR_CLAIM_SPAN_PREFIX = 'proposal-execution:'

export type RunExportTerminalStatus = Exclude<AgentRunStatus, 'running'>

export type RunExportRun = {
  id: string
  tenantId: string
  organizationId: string
  agentId: string
  source: AgentRunSource
  status: RunExportTerminalStatus
  parentRunId: string | null
  rerunOfRunId: string | null
  workflowInstanceId: string | null
  stepId: string | null
  invocationId: string | null
  proposalId: string | null
  agentVersion: string | null
  model: string | null
  runtime: string | null
  confidence: number | null
  inputTokens: number | null
  outputTokens: number | null
  costMinor: number | null
  currency: string | null
  latencyMs: number | null
  resultKind: string | null
  agentType: AgentType | null
  createdAt: Date
  completedAt: Date | null
}

export type RunExportSpan = {
  id: string
  externalSpanId: string
  parentSpanId: string | null
  sequence: number
  name: string
  kind: AgentSpanKind
  status: AgentSpanStatus
  startedAt: Date
  endedAt: Date | null
  durationMs: number | null
  attributes: Record<string, unknown> | null
}

export type RunExportEffectorSpan = RunExportSpan & { proposalId: string }

export type RunExportToolCall = {
  id: string
  spanId: string
  toolName: string
  status: AgentToolCallStatus
  isError: boolean
  latencyMs: number | null
  createdAt: Date
}

export type RunExportDispositionByKind = 'user' | 'rule'

export type RunExportProposal = {
  id: string
  disposition: AgentProposalDisposition
  dispositionByKind: RunExportDispositionByKind | null
  selectedOptionId: string | null
  autoDispositionBlock: AgentProposalAutoDispositionBlock | null
  createdAt: Date
  updatedAt: Date
}

export type RunExportEvalResult = {
  id: string
  assertionKey: string
  score: number | null
  passed: boolean | null
  severity: AgentEvalSeverity
  evaluatedAt: Date
}

export type RunExportGuardrailCheck = {
  id: string
  proposalId: string | null
  guardrailSetVersion: string
  capability: string
  phase: GuardrailPhase
  kind: GuardrailKind
  result: GuardrailResult
  createdAt: Date
}

export type RunExportProcessInstance = {
  id: string
  workflowInstanceId: string | null
  processDefinitionId: string | null
  workflowId: string | null
  status: ProcessInstanceStatus
  subjectType: string | null
  createdAt: Date
  completedAt: Date | null
}

export type RunExportBundle = {
  run: RunExportRun
  rootRunId: string
  agentLabel: string
  manifest: RunManifestView | null
  spans: RunExportSpan[]
  effectorSpans: RunExportEffectorSpan[]
  toolCalls: RunExportToolCall[]
  proposals: RunExportProposal[]
  evalResults: RunExportEvalResult[]
  guardrailChecks: RunExportGuardrailCheck[]
  processInstance: RunExportProcessInstance | null
}

export type RunExportBundleSource = EntityManager | { resolve: (name: string) => unknown }

type RunExportScope = { tenantId: string; organizationId: string }

const runIdSchema = z.string().uuid()

function isEntityManager(source: RunExportBundleSource): source is EntityManager {
  return typeof (source as Partial<EntityManager>).find === 'function'
}

function resolveEntityManager(source: RunExportBundleSource): EntityManager {
  if (isEntityManager(source)) return source
  return (source.resolve('em') as EntityManager).fork()
}

function toAttributeRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function toDispositionByKind(value: string | null | undefined): RunExportDispositionByKind | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.startsWith('rule:') ? 'rule' : 'user'
}

function effectorClaimSpanId(proposalId: string): string {
  return `${EFFECTOR_CLAIM_SPAN_PREFIX}${proposalId}`
}

function readEffectorProposalId(span: Pick<RunExportSpan, 'externalSpanId' | 'name'>): string | null {
  for (const candidate of [span.externalSpanId, span.name]) {
    if (candidate.startsWith(EFFECTOR_CLAIM_SPAN_PREFIX)) {
      const proposalId = candidate.slice(EFFECTOR_CLAIM_SPAN_PREFIX.length)
      if (proposalId.length > 0) return proposalId
    }
  }
  return null
}

function resolveAgentLabel(agentId: string): string {
  const label = getAgentEntry(agentId)?.label
  return typeof label === 'string' && label.trim().length > 0 ? label : agentId
}

const SPAN_FIELDS = [
  'id',
  'externalSpanId',
  'parentSpanId',
  'sequence',
  'name',
  'kind',
  'status',
  'startedAt',
  'endedAt',
  'durationMs',
  'attributes',
] as const

type SpanRow = Pick<AgentSpan, (typeof SPAN_FIELDS)[number]>

function toExportSpan(row: SpanRow): RunExportSpan {
  return {
    id: row.id,
    externalSpanId: row.externalSpanId,
    parentSpanId: row.parentSpanId ?? null,
    sequence: row.sequence,
    name: row.name,
    kind: row.kind,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
    durationMs: row.durationMs ?? null,
    attributes: toAttributeRecord(row.attributes),
  }
}

async function resolveRootRunId(
  em: EntityManager,
  scope: RunExportScope,
  run: Pick<AgentRun, 'id' | 'parentRunId'>,
): Promise<string> {
  const visited = new Set<string>([run.id])
  let rootRunId = run.id
  let parentRunId = run.parentRunId ?? null
  for (let depth = 0; depth < RUN_EXPORT_ROOT_RUN_MAX_DEPTH && parentRunId && !visited.has(parentRunId); depth += 1) {
    visited.add(parentRunId)
    const parent = await em.findOne(
      AgentRun,
      { id: parentRunId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { fields: ['id', 'parentRunId'] },
    )
    if (!parent) break
    rootRunId = parent.id
    parentRunId = parent.parentRunId ?? null
  }
  return rootRunId
}

export async function loadRunExportBundle(
  source: RunExportBundleSource,
  runId: string,
): Promise<RunExportBundle | null> {
  if (!runIdSchema.safeParse(runId).success) return null
  const em = resolveEntityManager(source)

  const run = await em.findOne(
    AgentRun,
    { id: runId, deletedAt: null },
    {
      fields: [
        'id',
        'tenantId',
        'organizationId',
        'agentId',
        'source',
        'status',
        'parentRunId',
        'rerunOfRunId',
        'workflowInstanceId',
        'stepId',
        'invocationId',
        'proposalId',
        'agentVersion',
        'model',
        'runtime',
        'confidence',
        'inputTokens',
        'outputTokens',
        'costMinor',
        'currency',
        'latencyMs',
        'resultKind',
        'agentType',
        'createdAt',
        'completedAt',
      ],
    },
  )
  if (!run || run.status === 'running') return null
  const status: RunExportTerminalStatus = run.status

  const scope: RunExportScope = { tenantId: run.tenantId, organizationId: run.organizationId }
  const where = { tenantId: scope.tenantId, organizationId: scope.organizationId }

  const [spanRows, toolCallRows, proposalRows, evalRows, guardrailRows, processRow, rootRunId] = await Promise.all([
    em.find(
      AgentSpan,
      { ...where, agentRunId: run.id },
      { orderBy: { sequence: 'asc' }, fields: [...SPAN_FIELDS] },
    ),
    em.find(
      AgentToolCall,
      { ...where, agentRunId: run.id },
      { orderBy: { createdAt: 'asc' }, fields: ['id', 'spanId', 'toolName', 'status', 'latencyMs', 'createdAt'] },
    ),
    em.find(
      AgentProposal,
      { ...where, runId: run.id, deletedAt: null },
      {
        orderBy: { createdAt: 'asc' },
        fields: ['id', 'disposition', 'dispositionBy', 'selectedOptionId', 'autoDispositionBlock', 'createdAt', 'updatedAt'],
      },
    ),
    em.find(
      AgentEvalResult,
      { ...where, agentRunId: run.id },
      { orderBy: { evaluatedAt: 'asc' }, fields: ['id', 'assertionKey', 'score', 'passed', 'severity', 'evaluatedAt'] },
    ),
    em.find(
      AgentGuardrailCheck,
      { ...where, agentRunId: run.id },
      {
        orderBy: { createdAt: 'asc' },
        fields: ['id', 'proposalId', 'guardrailSetVersion', 'capability', 'phase', 'kind', 'result', 'createdAt'],
      },
    ),
    run.workflowInstanceId
      ? em.findOne(
          ProcessInstance,
          { ...where, workflowInstanceId: run.workflowInstanceId, deletedAt: null },
          {
            fields: [
              'id',
              'workflowInstanceId',
              'processDefinitionId',
              'workflowId',
              'status',
              'subjectType',
              'createdAt',
              'completedAt',
            ],
          },
        )
      : Promise.resolve(null),
    resolveRootRunId(em, scope, run),
  ])

  const proposalIds = proposalRows.map((proposal) => proposal.id)
  const claimSpanIds = proposalIds.map(effectorClaimSpanId)
  const claimRows =
    claimSpanIds.length > 0
      ? await em.find(
          AgentSpan,
          { ...where, $or: [{ externalSpanId: { $in: claimSpanIds } }, { name: { $in: claimSpanIds } }] },
          { orderBy: { startedAt: 'asc' }, fields: [...SPAN_FIELDS] },
        )
      : []

  const knownProposalIds = new Set(proposalIds)
  const effectorSpans: RunExportEffectorSpan[] = []
  const effectorSpanRowIds = new Set<string>()
  for (const row of [...spanRows, ...claimRows]) {
    if (effectorSpanRowIds.has(row.id)) continue
    const span = toExportSpan(row)
    const proposalId = readEffectorProposalId(span)
    if (!proposalId || !knownProposalIds.has(proposalId)) continue
    effectorSpanRowIds.add(row.id)
    effectorSpans.push({ ...span, proposalId })
  }

  let manifest: RunManifestView | null = null
  const spans: RunExportSpan[] = []
  for (const row of spanRows) {
    if (effectorSpanRowIds.has(row.id)) continue
    if (isRunManifestSpan(row)) {
      manifest = manifest ?? parseRunManifestAttributes(row.attributes)
      continue
    }
    spans.push(toExportSpan(row))
  }

  return {
    run: {
      id: run.id,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
      agentId: run.agentId,
      source: run.source,
      status,
      parentRunId: run.parentRunId ?? null,
      rerunOfRunId: run.rerunOfRunId ?? null,
      workflowInstanceId: run.workflowInstanceId ?? null,
      stepId: run.stepId ?? null,
      invocationId: run.invocationId ?? null,
      proposalId: run.proposalId ?? null,
      agentVersion: run.agentVersion ?? null,
      model: run.model ?? null,
      runtime: run.runtime ?? null,
      confidence: run.confidence ?? null,
      inputTokens: run.inputTokens ?? null,
      outputTokens: run.outputTokens ?? null,
      costMinor: run.costMinor ?? null,
      currency: run.currency ?? null,
      latencyMs: run.latencyMs ?? null,
      resultKind: run.resultKind ?? null,
      agentType: run.agentType ?? null,
      createdAt: run.createdAt,
      completedAt: run.completedAt ?? null,
    },
    rootRunId,
    agentLabel: resolveAgentLabel(run.agentId),
    manifest,
    spans,
    effectorSpans,
    toolCalls: toolCallRows.map((row) => ({
      id: row.id,
      spanId: row.spanId,
      toolName: row.toolName,
      status: row.status,
      isError: row.status === 'error',
      latencyMs: row.latencyMs ?? null,
      createdAt: row.createdAt,
    })),
    proposals: proposalRows.map((row) => ({
      id: row.id,
      disposition: row.disposition,
      dispositionByKind: toDispositionByKind(row.dispositionBy),
      selectedOptionId: row.selectedOptionId ?? null,
      autoDispositionBlock: row.autoDispositionBlock ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    evalResults: evalRows.map((row) => ({
      id: row.id,
      assertionKey: row.assertionKey,
      score: row.score ?? null,
      passed: row.passed ?? null,
      severity: row.severity,
      evaluatedAt: row.evaluatedAt,
    })),
    guardrailChecks: guardrailRows.map((row) => ({
      id: row.id,
      proposalId: row.proposalId ?? null,
      guardrailSetVersion: row.guardrailSetVersion,
      capability: row.capability,
      phase: row.phase,
      kind: row.kind,
      result: row.result,
      createdAt: row.createdAt,
    })),
    processInstance: processRow
      ? {
          id: processRow.id,
          workflowInstanceId: processRow.workflowInstanceId ?? null,
          processDefinitionId: processRow.processDefinitionId ?? null,
          workflowId: processRow.workflowId ?? null,
          status: processRow.status,
          subjectType: processRow.subjectType ?? null,
          createdAt: processRow.createdAt,
          completedAt: processRow.completedAt ?? null,
        }
      : null,
  }
}
