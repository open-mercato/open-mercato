import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AiAgentRun, AiAgentRunStep, AiAgentRunToolCall } from '../data/entities'

export type AiAgentRunReaderScope = {
  tenantId: string
  organizationId: string | null
}

export type AiAgentRunReader = {
  getRun(scope: AiAgentRunReaderScope, runId: string): Promise<AiAgentRun | null>
  listSteps(scope: AiAgentRunReaderScope, runId: string): Promise<AiAgentRunStep[]>
  listToolCalls(scope: AiAgentRunReaderScope, runId: string): Promise<AiAgentRunToolCall[]>
}

function compareSteps(left: AiAgentRunStep, right: AiAgentRunStep): number {
  return left.stepIndex - right.stepIndex
}

function compareToolCalls(left: AiAgentRunToolCall, right: AiAgentRunToolCall): number {
  if (left.stepIndex !== right.stepIndex) return left.stepIndex - right.stepIndex
  return left.callIndex - right.callIndex
}

function isUsableScope(scope: AiAgentRunReaderScope, runId: string): boolean {
  return Boolean(scope.tenantId) && Boolean(runId)
}

/**
 * Tenant/organization-scoped, read-only access to persisted agent runs. Every
 * read goes through the decryption helpers so encrypted columns come back as
 * plaintext. Soft-deleted runs are invisible, and steps/tool calls are only
 * returned when their parent run is visible in the given scope.
 */
export function createAgentRunReader(resolveEm: () => EntityManager): AiAgentRunReader {
  async function loadRun(em: EntityManager, scope: AiAgentRunReaderScope, runId: string): Promise<AiAgentRun | null> {
    return findOneWithDecryption<AiAgentRun>(
      em,
      AiAgentRun,
      {
        id: runId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      {},
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  }

  return {
    async getRun(scope, runId) {
      if (!isUsableScope(scope, runId)) return null
      return loadRun(resolveEm().fork(), scope, runId)
    },
    async listSteps(scope, runId) {
      if (!isUsableScope(scope, runId)) return []
      const em = resolveEm().fork()
      const run = await loadRun(em, scope, runId)
      if (!run) return []
      const steps = await findWithDecryption<AiAgentRunStep>(
        em,
        AiAgentRunStep,
        { runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { orderBy: { stepIndex: 'asc' } },
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      return [...steps].sort(compareSteps)
    },
    async listToolCalls(scope, runId) {
      if (!isUsableScope(scope, runId)) return []
      const em = resolveEm().fork()
      const run = await loadRun(em, scope, runId)
      if (!run) return []
      const toolCalls = await findWithDecryption<AiAgentRunToolCall>(
        em,
        AiAgentRunToolCall,
        { runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { orderBy: { stepIndex: 'asc', callIndex: 'asc' } },
        { tenantId: scope.tenantId, organizationId: scope.organizationId },
      )
      return [...toolCalls].sort(compareToolCalls)
    },
  }
}
