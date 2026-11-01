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

    const stop = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1')
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 3)
    await stop()
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 3)

    expect(renewProcessing).toHaveBeenCalledTimes(3)
    expect(renewProcessing).toHaveBeenCalledWith('req-1', expect.any(Date))
  })

  it('reports a failed renewal without throwing and keeps renewing', async () => {
    const failure = new Error('connection lost')
    const renewProcessing = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(true)

    const stop = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1')
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 2)
    await stop()

    expect(renewProcessing).toHaveBeenCalledTimes(2)
    expect(reportError).toHaveBeenCalledWith(failure, {
      module: 'onboarding',
      code: 'onboarding.provisioning_lease_renewal_failed',
    })
  })

  it('stops renewing once the lease is no longer held', async () => {
    const renewProcessing = jest.fn().mockResolvedValue(false)

    const stop = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1')
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 4)
    await stop()

    expect(renewProcessing).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight renewal when stopped and never overlaps renewals', async () => {
    let finishRenewal: (renewed: boolean) => void = () => {}
    const renewProcessing = jest.fn(
      () => new Promise<boolean>((resolve) => {
        finishRenewal = resolve
      }),
    )

    const stop = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1')
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 3)
    let stopped = false
    const stopping = stop().then(() => {
      stopped = true
    })
    await Promise.resolve()

    expect(renewProcessing).toHaveBeenCalledTimes(1)
    expect(stopped).toBe(false)

    finishRenewal(true)
    await stopping

    expect(stopped).toBe(true)
  })
})
