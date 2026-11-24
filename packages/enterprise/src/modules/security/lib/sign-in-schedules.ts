import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('security.sign-in-activity')
const schedules = [
  {
    id: '9b8adff1-311d-595c-b2fe-307f0bcfaf5d',
    name: 'Staff sign-in activity retention',
    scheduleType: 'cron',
    scheduleValue: '15 3 * * *',
    targetQueue: 'security-sign-in-retention',
  },
  {
    id: '840ee15a-029c-5256-9c7a-21849db02a1d',
    name: 'Staff sign-in notification recovery',
    scheduleType: 'interval',
    scheduleValue: '60s',
    targetQueue: 'security-sign-in-notification',
  },
] as const

type Schedule = typeof schedules[number] & {
  scopeType: 'system'
  timezone: 'UTC'
  targetType: 'queue'
  sourceType: 'module'
  sourceModule: 'security'
  isEnabled: true
}
type Scheduler = { register: (schedule: Schedule) => Promise<unknown> }

export async function registerSignInSchedules(container: {
  hasRegistration?: (name: string) => boolean
  resolve: (name: string) => unknown
}) {
  if (!container.hasRegistration?.('schedulerService')) {
    logger.warn('Sign-in retention and notification recovery require manually scheduled worker jobs')
    return
  }
  try {
    const scheduler = container.resolve('schedulerService') as Scheduler
    for (const schedule of schedules) {
      await scheduler.register({
        ...schedule,
        scopeType: 'system',
        timezone: 'UTC',
        targetType: 'queue',
        sourceType: 'module',
        sourceModule: 'security',
        isEnabled: true,
      })
    }
  } catch {
    const error = new Error('[internal] Unable to register sign-in activity schedules')
    const code = 'security.sign_in_schedule_registration_failed'
    logger.error('Sign-in retention and notification recovery schedules are unavailable', { code })
    getTelemetryRuntime()?.reportError(error, { module: 'security', code })
  }
}
