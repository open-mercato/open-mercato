/** @jest-environment node */
import type { AwilixContainer } from 'awilix'
import { Booking, Lease } from '../data/entities'
import { FakeEm } from './support/fakeEm'

const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError }) }))
jest.mock('../lib/staffNotifications', () => ({ notifyStaff: jest.fn(async () => ['user-1']) }))

import { reportStalledOperation, STALLED_OPERATION_ATTEMPTS } from '../lib/salesOperationAlerts'
import type { ClassifiedSalesError } from '../lib/salesErrors'
import { notifyStaff } from '../lib/staffNotifications'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const error: ClassifiedSalesError = { kind: 'transient', status: 503, code: null, message: 'Sales is down' }
const container = { resolve: jest.fn() } as unknown as AwilixContainer

beforeEach(() => jest.clearAllMocks())

describe('reportStalledOperation', () => {
  it('reports the failure and notifies the building staff of the lease', async () => {
    const em = new FakeEm()
    em.seed(Lease, { id: 'lease-1', ...scope, reference: 'L-2030-004', buildingId: 'building-1', deletedAt: null } as never)
    const cause = new Error('boom')
    await reportStalledOperation({
      container,
      em: em as never,
      scope,
      op: { id: 'op-1', kind: 'lease_order', targetType: 'lease_version', targetId: 'v1', leaseId: 'lease-1' },
      error,
      cause,
      attempts: STALLED_OPERATION_ATTEMPTS,
    })
    expect(reportError).toHaveBeenCalledWith(cause, expect.objectContaining({ code: 'property_management.sales_operation_stalled' }))
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'property_management.sales_operation.stalled',
        buildingId: 'building-1',
        leaseId: 'lease-1',
        bookingId: null,
        groupKey: 'property_management.sales_operation.stalled:op-1',
        bodyVariables: expect.objectContaining({ reference: 'L-2030-004', attempts: String(STALLED_OPERATION_ATTEMPTS) }),
      }),
    )
  })

  it('names the booking for a booking order', async () => {
    const em = new FakeEm()
    em.seed(Booking, { id: 'booking-1', ...scope, buildingId: 'building-2', productName: 'Hot desk', startsAt: '2030-03-01T09:00:00' } as never)
    await reportStalledOperation({
      container,
      em: em as never,
      scope,
      op: { id: 'op-2', kind: 'booking_order', targetType: 'booking', targetId: 'booking-1', leaseId: null },
      error,
      cause: new Error('boom'),
      attempts: STALLED_OPERATION_ATTEMPTS,
    })
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        buildingId: 'building-2',
        bookingId: 'booking-1',
        leaseId: null,
        bodyVariables: expect.objectContaining({ reference: 'Hot desk · 2030-03-01 09:00' }),
      }),
    )
  })

  it('still reports the failure when the subject is gone', async () => {
    const em = new FakeEm()
    await reportStalledOperation({
      container,
      em: em as never,
      scope,
      op: { id: 'op-3', kind: 'lease_order', targetType: 'lease_version', targetId: 'v1', leaseId: 'lease-missing' },
      error,
      cause: new Error('boom'),
      attempts: STALLED_OPERATION_ATTEMPTS,
    })
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(notifyStaff).not.toHaveBeenCalled()
  })
})
