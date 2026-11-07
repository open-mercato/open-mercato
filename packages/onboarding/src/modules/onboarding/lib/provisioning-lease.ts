import type { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('onboarding').child({ component: 'verify' })

export const PROVISIONING_LEASE_STALE_MS = 60 * 1000
export const PROVISIONING_LEASE_HEARTBEAT_MS = 5 * 1000

export class ProvisioningLeaseLostError extends Error {
  constructor() {
    super('[internal] PROVISIONING_LEASE_LOST')
    this.name = 'ProvisioningLeaseLostError'
  }
}

export type ProvisioningLease = {
  assertHeld: () => void
  release: () => Promise<Date | null>
}

export function isProvisioningLeaseActive(processingStartedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!processingStartedAt) return false
  return processingStartedAt.getTime() > now.getTime() - PROVISIONING_LEASE_STALE_MS
}

export function startProvisioningLeaseHeartbeat(
  service: Pick<OnboardingService, 'renewProcessing'>,
  requestId: string,
  heldSince: Date,
): ProvisioningLease {
  let currentHeldSince: Date | null = heldSince
  let pendingRenewal: Promise<void> | null = null
  const heartbeat = setInterval(() => {
    if (pendingRenewal || !currentHeldSince) return
    const expectedHeldSince = currentHeldSince
    const renewedAt = new Date()
    pendingRenewal = service.renewProcessing(requestId, expectedHeldSince, renewedAt).then((renewed) => {
      if (renewed) {
        currentHeldSince = renewedAt
        return
      }
      currentHeldSince = null
      clearInterval(heartbeat)
      logger.warn('Provisioning lease no longer held', { requestId })
    }).catch((error: unknown) => {
      logger.warn('Provisioning lease renewal failed', { requestId, err: error })
      try {
        getTelemetryRuntime()?.reportError(error, {
          module: 'onboarding',
          code: 'onboarding.provisioning_lease_renewal_failed',
        })
      } catch (reportingError: unknown) {
        logger.warn('Provisioning lease renewal failure could not be reported', { requestId, err: reportingError })
      }
    }).finally(() => {
      pendingRenewal = null
    })
  }, PROVISIONING_LEASE_HEARTBEAT_MS)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()
  return {
    assertHeld: () => {
      if (!currentHeldSince) throw new ProvisioningLeaseLostError()
    },
    release: async () => {
      clearInterval(heartbeat)
      await pendingRenewal
      return currentHeldSince
    },
  }
}
