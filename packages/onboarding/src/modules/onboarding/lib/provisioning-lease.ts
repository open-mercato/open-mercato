import type { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('onboarding').child({ component: 'verify' })

export const PROVISIONING_LEASE_STALE_MS = 60 * 1000
export const PROVISIONING_LEASE_HEARTBEAT_MS = 5 * 1000

export function isProvisioningLeaseActive(processingStartedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!processingStartedAt) return false
  return processingStartedAt.getTime() > now.getTime() - PROVISIONING_LEASE_STALE_MS
}

export function startProvisioningLeaseHeartbeat(
  service: Pick<OnboardingService, 'renewProcessing'>,
  requestId: string,
): () => Promise<void> {
  let pendingRenewal: Promise<void> | null = null
  const heartbeat = setInterval(() => {
    if (pendingRenewal) return
    pendingRenewal = service.renewProcessing(requestId, new Date()).then((renewed) => {
      if (renewed) return
      clearInterval(heartbeat)
      logger.warn('Provisioning lease no longer held', { requestId })
    }).catch((error: unknown) => {
      logger.warn('Provisioning lease renewal failed', { requestId, err: error })
      getTelemetryRuntime()?.reportError(error, {
        module: 'onboarding',
        code: 'onboarding.provisioning_lease_renewal_failed',
      })
    }).finally(() => {
      pendingRenewal = null
    })
  }, PROVISIONING_LEASE_HEARTBEAT_MS)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()
  return async () => {
    clearInterval(heartbeat)
    await pendingRenewal
  }
}
