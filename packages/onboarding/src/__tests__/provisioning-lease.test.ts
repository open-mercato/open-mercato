import { OnboardingRequest } from '../modules/onboarding/data/entities'
import {
  PROVISIONING_LEASE_HEARTBEAT_MS,
  PROVISIONING_LEASE_STALE_MS,
  isProvisioningLeaseActive,
  startProvisioningLeaseHeartbeat,
} from '../modules/onboarding/lib/provisioning-lease'

const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

describe('isProvisioningLeaseActive', () => {
  const now = new Date('2026-11-01T12:00:00.000Z')

  it('treats a missing lease as inactive', () => {
    expect(isProvisioningLeaseActive(null, now)).toBe(false)
    expect(isProvisioningLeaseActive(undefined, now)).toBe(false)
  })

  it('treats a lease renewed within the stale window as active', () => {
    expect(isProvisioningLeaseActive(new Date(now.getTime() - PROVISIONING_LEASE_STALE_MS + 1), now)).toBe(true)
  })

  it('treats a lease older than the stale window as inactive', () => {
    expect(isProvisioningLeaseActive(new Date(now.getTime() - PROVISIONING_LEASE_STALE_MS), now)).toBe(false)
  })
})

describe('startProvisioningLeaseHeartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    reportError.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renews the lease well inside the stale window until stopped', async () => {
    expect(PROVISIONING_LEASE_HEARTBEAT_MS * 4).toBeLessThan(PROVISIONING_LEASE_STALE_MS)
    const renewProcessing = jest.fn().mockResolvedValue(true)
    const request = Object.assign(new OnboardingRequest(), { id: 'req-1' })

    const stop = startProvisioningLeaseHeartbeat({ renewProcessing }, request)
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 3)
    stop()
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 3)

    expect(renewProcessing).toHaveBeenCalledTimes(3)
    expect(renewProcessing).toHaveBeenCalledWith(request, expect.any(Date))
  })

  it('reports a failed renewal without throwing and keeps renewing', async () => {
    const failure = new Error('connection lost')
    const renewProcessing = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(true)
    const request = Object.assign(new OnboardingRequest(), { id: 'req-1' })

    const stop = startProvisioningLeaseHeartbeat({ renewProcessing }, request)
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 2)
    stop()

    expect(renewProcessing).toHaveBeenCalledTimes(2)
    expect(reportError).toHaveBeenCalledWith(failure, {
      module: 'onboarding',
      code: 'onboarding.provisioning_lease_renewal_failed',
    })
  })
})
