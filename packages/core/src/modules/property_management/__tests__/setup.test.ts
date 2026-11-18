/** @jest-environment node */
jest.mock('../lib/unavailabilityReasons', () => ({ seedUnavailabilityReasons: jest.fn(async () => undefined) }))

import { bookingSweepScheduleId, leaseSweepScheduleId, setup } from '../setup'
import { seedUnavailabilityReasons } from '../lib/unavailabilityReasons'
import { BOOKING_SWEEP_QUEUE, LEASE_SWEEP_QUEUE } from '../lib/queues'

const reportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError }) }))

describe('property_management setup', () => {
  it('seeds the unavailability reasons and registers both sweeps for an organization created later', async () => {
    const register = jest.fn(async () => undefined)
    const em = {}
    const container = {
      hasRegistration: (name: string) => name === 'schedulerService',
      resolve: (name: string) => {
        if (name === 'schedulerService') return { register }
        throw new Error(`[internal] unexpected registration: ${name}`)
      },
    }

    await setup.onOrganizationCreated?.({ em, container, tenantId: 'tenant-1', organizationId: 'organization-2' } as never)

    expect(seedUnavailabilityReasons).toHaveBeenCalledWith(em, { tenantId: 'tenant-1', organizationId: 'organization-2' })
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ id: leaseSweepScheduleId('organization-2'), organizationId: 'organization-2', targetQueue: LEASE_SWEEP_QUEUE }),
    )
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ id: bookingSweepScheduleId('organization-2'), organizationId: 'organization-2', targetQueue: BOOKING_SWEEP_QUEUE }),
    )
  })

  it('still registers both sweeps when seeding the reasons fails, and reports the failure', async () => {
    const failure = new Error('[internal] duplicate key')
    jest.mocked(seedUnavailabilityReasons).mockRejectedValueOnce(failure)
    const register = jest.fn(async () => undefined)
    const container = {
      hasRegistration: (name: string) => name === 'schedulerService',
      resolve: () => ({ register }),
    }

    await setup.seedDefaults?.({ em: {}, container, tenantId: 'tenant-1', organizationId: 'organization-3' } as never)

    expect(reportError).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'property_management.unavailability_reasons_seed_failed' }))
    expect(register).toHaveBeenCalledTimes(2)
  })
})
