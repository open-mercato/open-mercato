import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('customers')

export type ActivityRefreshHandler = () => void | Promise<void>

/**
 * Runs a refresh that follows an activity change without letting its failure reach the
 * caller: the change itself already succeeded, so a failed reload must not be reported
 * to the user as a failed mutation.
 */
export async function runActivityRefresh(
  refresh: ActivityRefreshHandler | undefined,
  component: string,
): Promise<void> {
  if (!refresh) return
  try {
    await refresh()
  } catch (err) {
    logger.warn('Activity refresh failed', { component, err })
    try {
      getTelemetryRuntime()?.reportError(err, {
        module: 'customers',
        code: 'customers.activity_refresh_failed',
        attributes: { component },
      })
    } catch (reportingErr) {
      logger.warn('Activity refresh failure could not be reported', { component, err: reportingErr })
    }
  }
}
