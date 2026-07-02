import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'
import type { IncidentAcknowledgeInput, IncidentTransitionInput } from '../data/action-validators'
import type { IncidentCommandResult } from '../commands/incident'

export const INCIDENT_BULK_OPS_QUEUE = 'incidents-bulk-ops'

const queues = new Map<string, Queue<Record<string, unknown>>>()

export type IncidentBulkAction = 'acknowledge' | 'close'

export type IncidentBulkOpsScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
  userFeatures?: string[]
  isSuperAdmin?: boolean
}

export type IncidentBulkOpsJobPayload = {
  progressJobId: string
  action: IncidentBulkAction
  ids: string[]
  scope: IncidentBulkOpsScope
}

export type IncidentBulkOpsFailure = {
  id: string
  message: string
}

export type IncidentBulkOpsSummary = {
  action: IncidentBulkAction
  totalCount: number
  affectedCount: number
  failedCount: number
  failures: IncidentBulkOpsFailure[]
}

export function getIncidentBulkOpsQueue(queueName = INCIDENT_BULK_OPS_QUEUE): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.max(1, Number.parseInt(process.env.INCIDENTS_QUEUE_CONCURRENCY ?? '3', 10) || 3)
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency })

  queues.set(queueName, created)
  return created
}

function buildCommandContext(
  scope: IncidentBulkOpsScope,
  container: AwilixContainer,
): CommandRuntimeContext {
  return {
    container,
    auth: {
      sub: scope.userId ?? '',
      userId: scope.userId ?? '',
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
      features: scope.userFeatures ?? [],
      isSuperAdmin: scope.isSuperAdmin === true,
    },
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

function errorMessage(error: unknown): string {
  if (isCrudHttpError(error)) {
    const bodyError = error.body.error
    return typeof bodyError === 'string' && bodyError.trim() ? bodyError : error.message
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Unknown error'
}

async function executeSingleIncidentAction(params: {
  action: IncidentBulkAction
  commandBus: CommandBus
  commandContext: CommandRuntimeContext
  id: string
  scope: IncidentBulkOpsScope
}): Promise<void> {
  const { action, commandBus, commandContext, id, scope } = params
  if (action === 'acknowledge') {
    await commandBus.execute<IncidentAcknowledgeInput, IncidentCommandResult>('incidents.incident.acknowledge', {
      input: {
        id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      ctx: commandContext,
    })
    return
  }

  await commandBus.execute<IncidentTransitionInput, IncidentCommandResult>('incidents.incident.transition_status', {
    input: {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      status: 'closed',
    },
    ctx: commandContext,
  })
}

export async function executeIncidentBulkOpsWithProgress(params: {
  container: AwilixContainer
  progressJobId: string
  action: IncidentBulkAction
  ids: string[]
  scope: IncidentBulkOpsScope
}): Promise<IncidentBulkOpsSummary> {
  const { container, progressJobId, action, ids, scope } = params
  const commandBus = container.resolve('commandBus') as CommandBus
  const progressService = container.resolve('progressService') as ProgressService
  const progressContext: ProgressServiceContext = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: scope.userId,
  }

  await progressService.startJob(progressJobId, progressContext)
  await progressService.updateProgress(
    progressJobId,
    {
      totalCount: ids.length,
      processedCount: 0,
      meta: { action, affectedCount: 0, failedCount: 0 },
    },
    progressContext,
  )

  const commandContext = buildCommandContext(scope, container)
  const failures: IncidentBulkOpsFailure[] = []
  let affectedCount = 0

  for (const [index, id] of ids.entries()) {
    try {
      await executeSingleIncidentAction({ action, commandBus, commandContext, id, scope })
      affectedCount += 1
    } catch (error) {
      failures.push({ id, message: errorMessage(error) })
    }

    await progressService.updateProgress(
      progressJobId,
      {
        totalCount: ids.length,
        processedCount: index + 1,
        meta: { action, affectedCount, failedCount: failures.length },
      },
      progressContext,
    )
  }

  const summary: IncidentBulkOpsSummary = {
    action,
    totalCount: ids.length,
    affectedCount,
    failedCount: failures.length,
    failures,
  }

  await progressService.completeJob(progressJobId, { resultSummary: summary }, progressContext)
  return summary
}
