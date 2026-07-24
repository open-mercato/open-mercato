import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
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
  expectedUpdatedAtById?: Record<string, string | null>
  requestHeaders?: Record<string, string>
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

type IncidentBulkCommandContext = CommandRuntimeContext & {
  incidentOptimisticLockExpectedUpdatedAtById?: Record<string, string | null>
}

type GuardAfterSuccessCallback = {
  guard: MutationGuard
  metadata: Record<string, unknown> | null
}

const BULK_REQUEST_HEADER_ALLOWLIST = ['content-type', 'accept-language', 'user-agent'] as const

export function serializeIncidentBulkRequestHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of headers.entries()) {
    const normalized = key.toLowerCase()
    if (normalized.startsWith('x-om-') || (BULK_REQUEST_HEADER_ALLOWLIST as readonly string[]).includes(normalized)) {
      result[normalized] = value
    }
  }
  return result
}

function deserializeRequestHeaders(headers: Record<string, string> | undefined): Headers {
  const result = new Headers()
  for (const [key, value] of Object.entries(headers ?? {})) {
    result.set(key, value)
  }
  return result
}

export async function runIncidentBulkGuards(
  container: AwilixContainer,
  input: MutationGuardInput,
  userFeatures: string[],
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: GuardAfterSuccessCallback[]
}> {
  const guards: MutationGuard[] = [...getAllMutationGuardInstances()]
  const legacyGuard = bridgeLegacyGuard(container)
  if (legacyGuard) guards.push(legacyGuard)
  if (guards.length === 0) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  return runMutationGuards(guards, input, { userFeatures })
}

async function runIncidentBulkGuardAfterSuccessCallbacks(
  callbacks: GuardAfterSuccessCallback[],
  input: {
    tenantId: string
    organizationId: string | null
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete'
    requestMethod: string
    requestHeaders: Headers
  },
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    try {
      await callback.guard.afterSuccess({
        ...input,
        metadata: callback.metadata ?? null,
      })
    } catch (error) {
      console.error(`[incidents.bulk] afterSuccess failed for guard ${callback.guard.id}`, error)
    }
  }
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
  expectedUpdatedAtById?: Record<string, string | null>,
): IncidentBulkCommandContext {
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
    incidentOptimisticLockExpectedUpdatedAtById: expectedUpdatedAtById,
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
  expectedUpdatedAtById?: Record<string, string | null>
  requestHeaders?: Record<string, string>
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

  const commandContext = buildCommandContext(scope, container, params.expectedUpdatedAtById)
  const requestHeaders = deserializeRequestHeaders(params.requestHeaders)
  const failures: IncidentBulkOpsFailure[] = []
  let affectedCount = 0

  for (const [index, id] of ids.entries()) {
    try {
      const expectedUpdatedAt = params.expectedUpdatedAtById?.[id] ?? null
      const guardResult = await runIncidentBulkGuards(
        container,
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: scope.userId ?? '',
          resourceKind: 'incidents.incident',
          resourceId: id,
          operation: 'update',
          requestMethod: 'POST',
          requestHeaders,
          mutationPayload: { action, id, expectedUpdatedAt },
        },
        scope.userFeatures ?? [],
      )
      if (!guardResult.ok) {
        throw new CrudHttpError(
          guardResult.errorStatus ?? 422,
          guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        )
      }

      await executeSingleIncidentAction({
        action,
        commandBus,
        commandContext,
        id,
        scope,
      })
      await runIncidentBulkGuardAfterSuccessCallbacks(guardResult.afterSuccessCallbacks, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId ?? '',
        resourceKind: 'incidents.incident',
        resourceId: id,
        operation: 'update',
        requestMethod: 'POST',
        requestHeaders,
      })
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
