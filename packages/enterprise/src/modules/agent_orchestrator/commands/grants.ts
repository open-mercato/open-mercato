import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  validateCrudMutationGuard,
  runCrudMutationGuardAfterSuccess,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  enforceCommandOptimisticLock,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { AgentDelegationGrant } from '../data/entities'
import { emitAgentOrchestratorEvent } from '../events'

const RESOURCE_KIND = 'agent_orchestrator.delegation_grant'
const RESOURCE_KIND_GUARD = 'agent_orchestrator:delegation_grant'

const revokeGrantCommandInputSchema = z.object({
  grantId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  /** Optional expected updated_at; the request header is also honored. */
  expectedUpdatedAt: z.string().optional(),
})
export type RevokeGrantCommandInput = z.infer<typeof revokeGrantCommandInputSchema>

export type RevokeGrantCommandResult = {
  grantId: string
  revokedAt: string
  updatedAt: string
}

/**
 * Revoke an `AgentDelegationGrant` (Wave 4 Phase 3). Sets `revokedAt` through the
 * audited Command path with the standard mutation guard + optimistic lock (409 on
 * a stale `updatedAt`). After revoke the grant is no longer active, so the
 * `/token` server refuses to mint and every already-minted token is denied on its
 * NEXT request — revocation stops further agent action immediately. Org-scoped:
 * a grant in another tenant is never loaded (its absence surfaces as 404, or 409
 * when the client sent an expected-version token).
 */
const revokeGrantCommand: CommandHandler<RevokeGrantCommandInput, RevokeGrantCommandResult> = {
  id: 'agent_orchestrator.grants.revoke',
  async execute(rawInput, ctx) {
    const input = revokeGrantCommandInputSchema.parse(rawInput)
    const container = ctx.container

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      userId: input.userId,
      resourceKind: RESOURCE_KIND_GUARD,
      resourceId: input.grantId,
      operation: 'update',
      requestMethod: ctx.request?.method ?? 'POST',
      requestHeaders: ctx.request?.headers ?? new Headers(),
    })
    if (guardResult && !guardResult.ok) {
      throw new CrudHttpError(guardResult.status, guardResult.body)
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const grant = await em.findOne(AgentDelegationGrant, {
      id: input.grantId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    })
    if (!grant) {
      enforceRecordGoneIsConflict({
        resourceKind: RESOURCE_KIND,
        resourceId: input.grantId,
        expected: input.expectedUpdatedAt,
        request: ctx.request ?? null,
      })
      throw new CrudHttpError(404, { error: '[internal] delegation grant not found' })
    }

    // Re-revoking is idempotent (same terminal state); a stale modal still gets a
    // structured 409 via the optimistic-lock check below.
    if (grant.revokedAt != null) {
      return {
        grantId: grant.id,
        revokedAt: grant.revokedAt.toISOString(),
        updatedAt: grant.updatedAt.toISOString(),
      }
    }

    enforceCommandOptimisticLock({
      resourceKind: RESOURCE_KIND,
      resourceId: grant.id,
      current: grant.updatedAt,
      expected: input.expectedUpdatedAt,
      request: ctx.request ?? null,
    })

    const revokedAt = new Date()
    await withAtomicFlush(
      em,
      [
        () => {
          grant.revokedAt = revokedAt
          grant.revokedByUserId = input.userId
        },
      ],
      { transaction: true, label: 'agent_orchestrator.grants.revoke' },
    )

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        userId: input.userId,
        resourceKind: RESOURCE_KIND_GUARD,
        resourceId: grant.id,
        operation: 'update',
        requestMethod: ctx.request?.method ?? 'POST',
        requestHeaders: ctx.request?.headers ?? new Headers(),
        metadata: guardResult.metadata ?? null,
      })
    }

    await emitAgentOrchestratorEvent(
      'agent_orchestrator.delegation_grant.revoked',
      {
        grantId: grant.id,
        agentPrincipalId: grant.agentPrincipalId,
        revokedByUserId: input.userId,
        tenantId: grant.tenantId,
        organizationId: grant.organizationId,
      },
      { persistent: true },
    )

    return {
      grantId: grant.id,
      revokedAt: revokedAt.toISOString(),
      updatedAt: grant.updatedAt.toISOString(),
    }
  },
}

registerCommand(revokeGrantCommand)

export { revokeGrantCommand }
