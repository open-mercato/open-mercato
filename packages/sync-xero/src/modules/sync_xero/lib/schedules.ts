import type { SyncScheduleService } from '@open-mercato/core/modules/data_sync/lib/sync-schedule-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { XERO_INTEGRATION_ID, XERO_SUPPORTED_ENTITY_TYPES } from './constants'
import type { XeroScope } from './owner'

export type XeroScheduleView = {
  entityType: string
  exists: boolean
  isEnabled: boolean
  fullSync: boolean
  scheduleValue: string | null
}

export type EnsureDefaultSchedulesResult = {
  schedules: XeroScheduleView[]
  failed: string[]
}

export const XERO_DEFAULT_SCHEDULE = { scheduleType: 'interval', scheduleValue: '1h', timezone: 'UTC', fullSync: false, isEnabled: true } as const

const SCHEDULE_CREATE_FAILED_MESSAGE =
  'The default hourly Xero schedule could not be created; create it from the Xero tab or the Sync schedules tab.'

export async function listXeroSchedules(
  scheduleService: Pick<SyncScheduleService, 'getByKey'>,
  scope: XeroScope,
): Promise<XeroScheduleView[]> {
  const views: XeroScheduleView[] = []
  for (const entityType of XERO_SUPPORTED_ENTITY_TYPES) {
    const schedule = await scheduleService.getByKey(XERO_INTEGRATION_ID, entityType, 'import', scope)
    views.push({
      entityType,
      exists: schedule !== null,
      isEnabled: schedule?.isEnabled ?? false,
      fullSync: schedule?.fullSync ?? false,
      scheduleValue: schedule?.scheduleValue ?? null,
    })
  }
  return views
}

/**
 * Creates the hourly incremental schedule of every `xero.*` entity type that has none (App Spec
 * § 6.7, US-4.1), behind the same `data_sync.schedule` create guard as the platform's schedule
 * route. An existing schedule — the admin's, or a disabled one — is never changed. A blocked or
 * failed creation is logged as `xero.schedule_create_failed` and returned, never thrown, so it
 * never undoes the Organisation save that called it.
 */
export async function ensureDefaultSchedules(input: {
  container: AppContainer
  scope: XeroScope
  guard: { req: Request; userId: string }
}): Promise<EnsureDefaultSchedulesResult> {
  const { container, scope } = input
  const failed: string[] = []

  const reportFailure = async (entityType: string, error: unknown | null) => {
    failed.push(entityType)
    if (error !== null) getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: 'sync_xero.schedule_create_failed' })
    try {
      await container.resolve<IntegrationLogService>('integrationLogService').write(
        { integrationId: XERO_INTEGRATION_ID, level: 'warn', message: SCHEDULE_CREATE_FAILED_MESSAGE, code: 'xero.schedule_create_failed', payload: { entityType } },
        scope,
      )
    } catch (logError) {
      getTelemetryRuntime()?.reportError(logError, { module: 'sync_xero', code: 'sync_xero.log_write_failed' })
    }
  }

  let scheduleService: SyncScheduleService
  try {
    scheduleService = container.resolve<SyncScheduleService>('dataSyncScheduleService')
  } catch (error) {
    for (const entityType of XERO_SUPPORTED_ENTITY_TYPES) await reportFailure(entityType, error)
    return { schedules: [], failed }
  }

  for (const entityType of XERO_SUPPORTED_ENTITY_TYPES) {
    try {
      if (await scheduleService.getByKey(XERO_INTEGRATION_ID, entityType, 'import', scope)) continue
      const payload = { integrationId: XERO_INTEGRATION_ID, entityType, direction: 'import' as const, ...XERO_DEFAULT_SCHEDULE }
      const guard = await runRouteMutationGuards({
        container,
        req: input.guard.req,
        auth: { userId: input.guard.userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        input: { resourceKind: 'data_sync.schedule', resourceId: scope.organizationId, operation: 'create', mutationPayload: payload },
      })
      if (!guard.ok) {
        await reportFailure(entityType, null)
        continue
      }
      await scheduleService.saveSchedule(payload, scope, container)
      await guard.runAfterSuccess()
    } catch (error) {
      await reportFailure(entityType, error)
    }
  }

  try {
    return { schedules: await listXeroSchedules(scheduleService, scope), failed }
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, { module: 'sync_xero', code: 'sync_xero.schedule_list_failed' })
    return { schedules: [], failed }
  }
}
