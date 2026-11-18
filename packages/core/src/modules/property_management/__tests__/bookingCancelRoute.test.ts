/** @jest-environment node */
import type { RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const BOOKING = '40000000-0000-4000-8000-0000000000b1'
const CUSTOMER_USER = '40000000-0000-4000-8000-0000000000c1'

const commandBus = {
  execute: jest.fn(async (_id: string, _args: { input: Record<string, unknown> }) => ({
    result: { bookingId: BOOKING, status: 'cancelled', operationId: null },
    logEntry: null,
  })),
}
const guardState: { result: RouteMutationGuardResult } = { result: { ok: true, runAfterSuccess: async () => undefined } }

jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string, fallback?: string) => fallback ?? key, translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('../lib/bookingRecords', () => {
  const actual = jest.requireActual('../lib/bookingRecords')
  return { ...actual, loadPermittedBooking: jest.fn(async () => ({ id: BOOKING })) }
})
jest.mock('../api/routeContext', () => {
  const actual = jest.requireActual('../api/routeContext')
  return {
    ...actual,
    resolveStaffContext: jest.fn(async () => ({
      ctx: { container: { resolve: (name: string) => (name === 'commandBus' ? commandBus : null) }, auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } },
      em: {},
      permitted: null,
      tenantId: TENANT,
      organizationId: ORG,
      userId: 'user-1',
      translate: (_key: string, fallback?: string) => fallback,
    })),
    runStaffGuard: jest.fn(async () => guardState.result),
  }
})

import { POST } from '../api/bookings/[id]/cancel/route'

function request(body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/property_management/bookings/${BOOKING}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const routeParams = { params: Promise.resolve({ id: BOOKING }) }

function executedInput(): Record<string, unknown> {
  const [call] = commandBus.execute.mock.calls
  return call[1].input
}

describe('POST /bookings/[id]/cancel', () => {
  beforeEach(() => {
    commandBus.execute.mockClear()
    guardState.result = { ok: true, runAfterSuccess: async () => undefined }
  })

  it('forces the manager reason even when the body asks for a customer cancellation', async () => {
    const response = await POST(request({ reason: 'customer', customerUserId: CUSTOMER_USER }), routeParams)
    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith('property_management.booking.cancel', expect.anything())
    expect(executedInput()).toMatchObject({ id: BOOKING, reason: 'manager', tenantId: TENANT, organizationId: ORG })
  })

  it('re-pins the manager reason over a mutation guard that rewrites it to a customer cancellation', async () => {
    guardState.result = {
      ok: true,
      modifiedPayload: { id: BOOKING, reason: 'customer', customerUserId: CUSTOMER_USER, tenantId: TENANT, organizationId: ORG },
      runAfterSuccess: async () => undefined,
    }
    const response = await POST(request({}), routeParams)
    expect(response.status).toBe(200)
    expect(executedInput()).toMatchObject({ id: BOOKING, reason: 'manager' })
  })
})
