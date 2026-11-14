import { commandRegistry } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getSchedulerSafeCommand } from '@open-mercato/scheduler'
import {
  DATA_ERASURE_RETENTION_RUN_COMMAND_ID,
  type ScheduledRetentionInput,
  type ScheduledRetentionResult,
} from '../retention'

const tenantId = '10000000-0000-4000-8000-000000000001'
const organizationId = '20000000-0000-4000-8000-000000000002'
const actorId = '30000000-0000-4000-8000-000000000003'
const policyId = '40000000-0000-4000-8000-000000000004'

describe('scheduled data retention command', () => {
  it('registers as a scheduler-safe command requiring privacy management access', () => {
    expect(getSchedulerSafeCommand(DATA_ERASURE_RETENTION_RUN_COMMAND_ID)).toEqual({
      commandId: DATA_ERASURE_RETENTION_RUN_COMMAND_ID,
      requiredFeatures: ['data_erasure.manage'],
    })
  })

  it('runs an active policy in the schedule-bound tenant and organization scope', async () => {
    const runRetention = jest.fn(async () => ({
      id: '50000000-0000-4000-8000-000000000005',
      status: 'completed' as const,
      dryRun: true,
    }))
    const context = createContext(runRetention)
    const result = await handler().execute({ tenantId, organizationId, policyId }, context)

    expect(runRetention).toHaveBeenCalledWith(
      { tenantId, organizationId },
      actorId,
      { policyId, dryRun: true, maxBatches: 20 },
      context,
    )
    expect(result).toEqual({
      operationId: '50000000-0000-4000-8000-000000000005',
      status: 'completed',
      dryRun: true,
    })
  })

  it('rejects a payload outside the schedule-bound organization', async () => {
    const runRetention = jest.fn()
    const context = createContext(runRetention)

    await expect(handler().execute({
      tenantId,
      organizationId: '60000000-0000-4000-8000-000000000006',
      policyId,
      dryRun: false,
      maxBatches: 1,
    }, context)).rejects.toThrow('organization scope does not match')
    expect(runRetention).not.toHaveBeenCalled()
  })
})

function handler(): CommandHandler<ScheduledRetentionInput, ScheduledRetentionResult> {
  const registered = commandRegistry.get<ScheduledRetentionInput, ScheduledRetentionResult>(
    DATA_ERASURE_RETENTION_RUN_COMMAND_ID,
  )
  if (!registered) throw new Error('[internal] Scheduled retention command was not registered')
  return registered
}

function createContext(runRetention: jest.Mock): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'privacyGovernanceService') return { runRetention }
        throw new Error(`[internal] Unexpected service: ${name}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: actorId,
      userId: actorId,
      tenantId,
      orgId: organizationId,
      isSuperAdmin: false,
    },
    organizationScope: {
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
}
