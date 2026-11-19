import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('data_sync').child({ component: 'schedules' })

type ScheduleWriteContext = {
  operation: 'create' | 'update' | 'delete'
  organizationId: string
  tenantId: string
  scheduleId?: string
  integrationId?: string
}

export async function scheduleWriteErrorResponse(error: unknown, context: ScheduleWriteContext) {
  logger.error('Failed to write sync schedule', { ...context, err: error })
  getTelemetryRuntime()?.reportError(error, {
    module: 'data_sync',
    code: 'data_sync.schedule_write_failed',
    attributes: context,
  })
  const { translate } = await resolveTranslations()
  const key = context.operation === 'delete'
    ? 'data_sync.dashboard.schedule.deleteError'
    : 'data_sync.dashboard.schedule.error'
  return NextResponse.json({ error: translate(key) }, { status: 500 })
}
