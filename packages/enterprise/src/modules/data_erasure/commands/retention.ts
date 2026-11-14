import { z } from 'zod'
import { registerSchedulerSafeCommands } from '@open-mercato/scheduler'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { PrivacyGovernanceService } from '../services/governanceService'

export const DATA_ERASURE_RETENTION_RUN_COMMAND_ID = 'data_erasure.retention.run'

const scheduledRetentionInputSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  policyId: z.string().uuid(),
  dryRun: z.boolean().default(true),
  maxBatches: z.number().int().min(1).max(100).default(20),
})

export type ScheduledRetentionInput = z.infer<typeof scheduledRetentionInputSchema>

export type ScheduledRetentionResult = {
  operationId: string
  status: 'running' | 'completed' | 'partial' | 'failed' | 'blocked'
  dryRun: boolean
}

const scheduledRetentionCommand: CommandHandler<ScheduledRetentionInput, ScheduledRetentionResult> = {
  id: DATA_ERASURE_RETENTION_RUN_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = scheduledRetentionInputSchema.parse(rawInput)
    const actorId = ctx.auth?.sub?.trim()
    if (!actorId) throw new Error('[internal] Scheduled retention requires an authenticated actor')
    if (ctx.auth?.tenantId !== input.tenantId) {
      throw new Error('[internal] Scheduled retention tenant scope does not match the command context')
    }
    if (
      ctx.selectedOrganizationId !== input.organizationId
      || !ctx.organizationIds?.includes(input.organizationId)
    ) {
      throw new Error('[internal] Scheduled retention organization scope does not match the command context')
    }

    const service = ctx.container.resolve<PrivacyGovernanceService>('privacyGovernanceService')
    const operation = await service.runRetention(
      { tenantId: input.tenantId, organizationId: input.organizationId },
      actorId,
      {
        policyId: input.policyId,
        dryRun: input.dryRun,
        maxBatches: input.maxBatches,
      },
      ctx,
    )
    return {
      operationId: operation.id,
      status: operation.status,
      dryRun: operation.dryRun,
    }
  },
  buildLog({ input, result }) {
    return {
      actionLabel: 'data_erasure.retention.run',
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      resourceKind: 'data_erasure.retention_policy',
      resourceId: input.policyId,
      context: {
        operationId: result.operationId,
        status: result.status,
        dryRun: result.dryRun,
      },
    }
  },
}

registerSchedulerSafeCommands([
  {
    commandId: DATA_ERASURE_RETENTION_RUN_COMMAND_ID,
    requiredFeatures: ['data_erasure.manage'],
  },
])

registerCommand(scheduledRetentionCommand)
