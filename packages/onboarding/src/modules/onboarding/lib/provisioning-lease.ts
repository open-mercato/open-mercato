import type { OnboardingRequest } from '@open-mercato/onboarding/modules/onboarding/data/entities'
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
  request: OnboardingRequest,
): () => void {
  const heartbeat = setInterval(() => {
    void service.renewProcessing(request, new Date()).then((renewed) => {
      if (!renewed) logger.warn('Provisioning lease no longer held', { requestId: request.id })
    }).catch((error: unknown) => {
      logger.warn('Provisioning lease renewal failed', { requestId: request.id, err: error })
      getTelemetryRuntime()?.reportError(error, {
        module: 'onboarding',
        code: 'onboarding.provisioning_lease_renewal_failed',
      })
    })
  }, PROVISIONING_LEASE_HEARTBEAT_MS)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()
  return () => clearInterval(heartbeat)
}
