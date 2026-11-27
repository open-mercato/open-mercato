import {
  PROVISIONING_LEASE_HEARTBEAT_MS,
  PROVISIONING_LEASE_STALE_MS,
  ProvisioningLeaseLostError,
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
  const heldSince = new Date('2026-11-01T12:00:00.000Z')

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

    const lease = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1', heldSince)
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 3)
    const releasedHeldSince = await lease.release()
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 3)

    expect(renewProcessing).toHaveBeenCalledTimes(3)
    const [firstCall, secondCall, thirdCall] = renewProcessing.mock.calls
    expect(firstCall[0]).toBe('req-1')
    expect(firstCall[1]).toBe(heldSince)
    expect(secondCall[1]).toBe(firstCall[2])
    expect(thirdCall[1]).toBe(secondCall[2])
    expect(releasedHeldSince).toBe(thirdCall[2])
    expect(() => lease.assertHeld()).not.toThrow()
  })

  it('reports a failed renewal without throwing and keeps renewing', async () => {
    const failure = new Error('connection lost')
    const renewProcessing = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(true)

    const lease = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1', heldSince)
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 2)
    const releasedHeldSince = await lease.release()

    expect(renewProcessing).toHaveBeenCalledTimes(2)
    expect(renewProcessing.mock.calls[1][1]).toBe(heldSince)
    expect(releasedHeldSince).toBe(renewProcessing.mock.calls[1][2])
    expect(reportError).toHaveBeenCalledWith(failure, {
      module: 'onboarding',
      code: 'onboarding.provisioning_lease_renewal_failed',
    })
  })

  it('keeps the heartbeat and release healthy when error reporting itself throws', async () => {
    reportError.mockImplementation(() => {
      throw new Error('telemetry exporter down')
    })
    const renewProcessing = jest.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue(true)

    const lease = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1', heldSince)
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS)
    expect(reportError).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS)
    const releasedHeldSince = await lease.release()

    expect(renewProcessing).toHaveBeenCalledTimes(2)
    expect(releasedHeldSince).toBe(renewProcessing.mock.calls[1][2])
    expect(() => lease.assertHeld()).not.toThrow()
  })

  it('resolves release when error reporting throws during an in-flight renewal', async () => {
    reportError.mockImplementation(() => {
      throw new Error('telemetry exporter down')
    })
    let failRenewal: (error: Error) => void = () => {}
    const renewProcessing = jest.fn(
      (_requestId: string, _heldSince: Date, _renewedAt: Date) => new Promise<boolean>((_resolve, reject) => {
        failRenewal = reject
      }),
    )

    const lease = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1', heldSince)
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS)
    const stopping = lease.release()
    failRenewal(new Error('connection lost'))

    await expect(stopping).resolves.toBe(heldSince)
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('stops renewing and reports the lease as lost once it is no longer held', async () => {
    const renewProcessing = jest.fn().mockResolvedValue(false)

    const lease = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1', heldSince)
    expect(() => lease.assertHeld()).not.toThrow()
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 4)

    expect(() => lease.assertHeld()).toThrow(ProvisioningLeaseLostError)
    expect(await lease.release()).toBeNull()
    expect(renewProcessing).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight renewal when stopped and never overlaps renewals', async () => {
    let finishRenewal: (renewed: boolean) => void = () => {}
    const renewProcessing = jest.fn(
      (_requestId: string, _heldSince: Date, _renewedAt: Date) => new Promise<boolean>((resolve) => {
        finishRenewal = resolve
      }),
    )

    const lease = startProvisioningLeaseHeartbeat({ renewProcessing }, 'req-1', heldSince)
    await jest.advanceTimersByTimeAsync(PROVISIONING_LEASE_HEARTBEAT_MS * 3)
    let stopped = false
    const stopping = lease.release().then((releasedHeldSince) => {
      stopped = true
      return releasedHeldSince
    })
    await Promise.resolve()

    expect(renewProcessing).toHaveBeenCalledTimes(1)
    expect(stopped).toBe(false)

    finishRenewal(false)

    expect(await stopping).toBeNull()
    expect(stopped).toBe(true)
  })
})
