import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentGuardrailCheck } from '../../data/entities'
import type { AgentRun, AgentSpan, AgentToolCall } from '../../data/entities'
import { readCheckOutcome, readCheckRuleId } from '../guardrails/integrity/summary'
import type { Json, ScorerGuardrailCheckView, ScorerRunView, ScorerToolCallView } from './types'

/**
 * Projects already-loaded ORM rows into the dependency-free view scorers consume.
 * A pure function over rows — never queries — so the scorer path stays free of the
 * EntityManager and remains identical online and offline.
 *
 * Rows MUST be loaded through `findWithDecryption` by the caller: `AgentRun.input`
 * / `.output` and `AgentToolCall.request_summary` are encrypted at rest.
 */
export type ProjectRunViewInput = {
  run: AgentRun
  toolCalls?: ReadonlyArray<AgentToolCall>
  /** Supplies tool-call ordering; `AgentToolCall` itself carries no sequence. */
  spans?: ReadonlyArray<AgentSpan>
  /** From the run's AgentProposal, when one exists. */
  disposition?: string | null
  /** The run's AgentGuardrailCheck rows, for the `guardrail_check` scorer. */
  guardrailChecks?: ReadonlyArray<Pick<AgentGuardrailCheck, 'kind' | 'phase' | 'result' | 'evidence'>>
}

export function projectRunView(input: ProjectRunViewInput): ScorerRunView {
  const { run, toolCalls = [], spans = [], disposition = null, guardrailChecks = [] } = input

  const sequenceBySpanId = new Map<string, number>()
  for (const span of spans) sequenceBySpanId.set(span.id, span.sequence)

  const projectedCalls: ScorerToolCallView[] = toolCalls
    .map((call, index) => ({
      toolName: call.toolName,
      args: (call.requestSummary ?? null) as Json | null,
      status: call.status,
      // Fall back to load order when the span is absent, so ordering is stable
      // rather than arbitrary.
      sequence: sequenceBySpanId.get(call.spanId) ?? index,
    }))
    .sort((left, right) => left.sequence - right.sequence)

  return {
    input: (run.input ?? null) as Json | null,
    output: (run.output ?? null) as Json | null,
    resultKind: (run.resultKind ?? null) as ScorerRunView['resultKind'],
    agentType: (run.agentType ?? null) as ScorerRunView['agentType'],
    confidence: run.confidence ?? null,
    status: run.status,
    latencyMs: run.latencyMs ?? null,
    costMinor: run.costMinor ?? null,
    inputTokens: run.inputTokens ?? null,
    outputTokens: run.outputTokens ?? null,
    toolCalls: projectedCalls,
    stepCount: projectedCalls.length,
    disposition,
    guardrailChecks: guardrailChecks.map(
      (check): ScorerGuardrailCheckView => ({
        kind: check.kind,
        phase: check.phase,
        result: check.result,
        ruleId: readCheckRuleId(check.evidence),
        outcome: readCheckOutcome(check.evidence),
      }),
    ),
  }
}

export type RunViewScope = { tenantId: string; organizationId: string | null }

/** Loads a run's guardrail check rows (tenant + organization scoped) for `projectRunView`. */
export function loadRunGuardrailChecks(
  em: EntityManager,
  runId: string,
  scope: RunViewScope,
): Promise<Array<Pick<AgentGuardrailCheck, 'kind' | 'phase' | 'result' | 'evidence'>>> {
  return em.find(
    AgentGuardrailCheck,
    { agentRunId: runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { createdAt: 'asc' }, fields: ['kind', 'phase', 'result', 'evidence'] },
  )
}
