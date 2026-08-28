import type { FilterQuery } from '@mikro-orm/postgresql'
import type {
  AuditEvidenceCollectContext,
  AuditEvidenceContributor,
  AuditEvidenceRecordInput,
} from '@open-mercato/core/modules/audit_logs/services/evidenceExportService'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentGuardrailCheck,
  AgentProposal,
  AgentRun,
  AgentSpan,
  AgentToolCall,
} from '../../data/entities'

function createdAtFilter(after?: Date, before?: Date): Record<string, Date> | undefined {
  if (!after && !before) return undefined
  return {
    ...(after ? { $gte: after } : {}),
    ...(before ? { $lte: before } : {}),
  }
}

function requireCompleteSource<Entity>(source: string, rows: Entity[], limit: number): Entity[] {
  if (rows.length > limit) {
    throw new Error(`[internal] Audit evidence source ${source} exceeds the ${limit} record limit; narrow the time range or increase --limit`)
  }
  return rows
}

export class AgentAuditEvidenceContributor implements AuditEvidenceContributor {
  readonly id = 'agent-orchestrator'

  async collect({ em, scope }: AuditEvidenceCollectContext): Promise<AuditEvidenceRecordInput[]> {
    const createdAt = createdAtFilter(scope.after, scope.before)
    const baseScope = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
    const decryptionScope = baseScope
    const options = {
      orderBy: { createdAt: 'asc' as const, id: 'asc' as const },
      limit: scope.limitPerSource + 1,
    }
    const runs = requireCompleteSource('agent.run', await findWithDecryption(
      em,
      AgentRun,
      { ...baseScope, deletedAt: null, ...(createdAt ? { createdAt } : {}) } as FilterQuery<AgentRun>,
      options,
      decryptionScope,
    ), scope.limitPerSource)
    const proposals = requireCompleteSource('agent.proposal', await findWithDecryption(
      em,
      AgentProposal,
      { ...baseScope, deletedAt: null, ...(createdAt ? { createdAt } : {}) } as FilterQuery<AgentProposal>,
      options,
      decryptionScope,
    ), scope.limitPerSource)
    const spans = requireCompleteSource('agent.span', await findWithDecryption(
      em,
      AgentSpan,
      { ...baseScope, ...(createdAt ? { createdAt } : {}) } as FilterQuery<AgentSpan>,
      options,
      decryptionScope,
    ), scope.limitPerSource)
    const toolCalls = requireCompleteSource('agent.tool-call', await findWithDecryption(
      em,
      AgentToolCall,
      { ...baseScope, ...(createdAt ? { createdAt } : {}) } as FilterQuery<AgentToolCall>,
      options,
      decryptionScope,
    ), scope.limitPerSource)
    const guardrailChecks = requireCompleteSource('agent.guardrail', await findWithDecryption(
      em,
      AgentGuardrailCheck,
      { ...baseScope, ...(createdAt ? { createdAt } : {}) } as FilterQuery<AgentGuardrailCheck>,
      options,
      decryptionScope,
    ), scope.limitPerSource)

    return [
      ...runs.map((run) => this.runRecord(run)),
      ...proposals.map((proposal) => this.proposalRecord(proposal)),
      ...spans.map((span) => this.spanRecord(span)),
      ...toolCalls.map((toolCall) => this.toolCallRecord(toolCall)),
      ...guardrailChecks.map((check) => this.guardrailRecord(check)),
    ]
  }

  private runRecord(run: AgentRun): AuditEvidenceRecordInput {
    return {
      source: 'agent.run',
      type: run.status,
      id: run.id,
      correlationId: run.id,
      occurredAt: run.createdAt,
      tenantId: run.tenantId,
      organizationId: run.organizationId,
      payload: {
        agentId: run.agentId,
        source: run.source,
        parentRunId: run.parentRunId,
        processId: run.processId,
        stepId: run.stepId,
        proposalId: run.proposalId,
        agentVersion: run.agentVersion,
        model: run.model,
        runtime: run.runtime,
        externalRunId: run.externalRunId,
        confidence: run.confidence,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        costMinor: run.costMinor,
        currency: run.currency,
        latencyMs: run.latencyMs,
        contextRouting: run.contextRouting,
        input: run.input,
        output: run.output,
        outputArtifactKey: run.outputArtifactKey,
        resultKind: run.resultKind,
        agentType: run.agentType,
        errorMessage: run.errorMessage,
        humanConfirmedAt: run.humanConfirmedAt,
        completedAt: run.completedAt,
        updatedAt: run.updatedAt,
      },
    }
  }

  private proposalRecord(proposal: AgentProposal): AuditEvidenceRecordInput {
    return {
      source: 'agent.proposal',
      type: proposal.disposition,
      id: proposal.id,
      correlationId: proposal.runId,
      occurredAt: proposal.createdAt,
      tenantId: proposal.tenantId,
      organizationId: proposal.organizationId,
      actorId: proposal.dispositionBy,
      payload: {
        agentId: proposal.agentId,
        runId: proposal.runId,
        processId: proposal.processId,
        stepId: proposal.stepId,
        userTaskId: proposal.userTaskId,
        payload: proposal.payload,
        confidence: proposal.confidence,
        guardResults: proposal.guardResults,
        source: proposal.source,
        dispositionReason: proposal.dispositionReason,
        selectedOptionId: proposal.selectedOptionId,
        autoDispositionBlock: proposal.autoDispositionBlock,
        updatedAt: proposal.updatedAt,
      },
    }
  }

  private spanRecord(span: AgentSpan): AuditEvidenceRecordInput {
    return {
      source: 'agent.span',
      type: span.kind,
      id: span.id,
      correlationId: span.agentRunId,
      occurredAt: span.createdAt,
      tenantId: span.tenantId,
      organizationId: span.organizationId,
      payload: {
        agentRunId: span.agentRunId,
        externalSpanId: span.externalSpanId,
        parentSpanId: span.parentSpanId,
        sequence: span.sequence,
        name: span.name,
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        durationMs: span.durationMs,
        status: span.status,
        attributes: span.attributes,
      },
    }
  }

  private toolCallRecord(toolCall: AgentToolCall): AuditEvidenceRecordInput {
    return {
      source: 'agent.tool-call',
      type: toolCall.status,
      id: toolCall.id,
      correlationId: toolCall.agentRunId,
      occurredAt: toolCall.createdAt,
      tenantId: toolCall.tenantId,
      organizationId: toolCall.organizationId,
      payload: {
        agentRunId: toolCall.agentRunId,
        spanId: toolCall.spanId,
        toolName: toolCall.toolName,
        requestSummary: toolCall.requestSummary,
        responseSummary: toolCall.responseSummary,
        requestArtifactKey: toolCall.requestArtifactKey,
        responseArtifactKey: toolCall.responseArtifactKey,
        latencyMs: toolCall.latencyMs,
        errorMessage: toolCall.errorMessage,
      },
    }
  }

  private guardrailRecord(check: AgentGuardrailCheck): AuditEvidenceRecordInput {
    return {
      source: 'agent.guardrail',
      type: check.result,
      id: check.id,
      correlationId: check.agentRunId,
      occurredAt: check.createdAt,
      tenantId: check.tenantId,
      organizationId: check.organizationId,
      payload: {
        agentRunId: check.agentRunId,
        proposalId: check.proposalId,
        guardrailSetVersion: check.guardrailSetVersion,
        capability: check.capability,
        phase: check.phase,
        kind: check.kind,
        evidence: check.evidence,
      },
    }
  }
}

export const agentAuditEvidenceContributor = new AgentAuditEvidenceContributor()
