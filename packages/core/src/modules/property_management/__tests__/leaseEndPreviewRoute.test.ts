/** @jest-environment node */
import type { RecurrenceRead } from '../lib/salesRecurrence'

const LEASE_ID = '33333333-3333-4333-8333-333333333333'
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const requestEm = { name: 'request', fork: () => requestEm }

const mockReadRecurrence = jest.fn(async (_em: unknown, _scope: unknown, orderId: string): Promise<RecurrenceRead | null> => ({
  orderId,
  status: 'active',
  startsOn: '2026-01-10',
  periodCount: 12,
  endsOn: null,
  nextPeriodIndex: 1,
  nextInvoiceOn: null,
  scheduleVersion: 1,
  cancelEffectiveOn: null,
  cancelSettlement: null,
  invoicesAvailable: true,
  periods: [
    { periodIndex: 0, periodStart: '2026-05-10', periodEnd: '2026-06-09', invoiceId: `invoice-${orderId}`, creditMemoId: null, billedFactor: '1', creditedFactor: null },
  ],
}))

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('../api/routeContext', () => ({
  resolveStaffContext: jest.fn(async () => ({
    ctx: { container: {}, auth: {} },
    em: requestEm,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    translate: (_key: string, fallback: string) => fallback,
    permitted: null,
  })),
  readRouteParam: jest.fn(async () => LEASE_ID),
  handleRouteError: jest.fn(async (err: unknown) => {
    throw err
  }),
  guardedCommandInput: jest.fn(),
  runStaffGuard: jest.fn(),
}))
jest.mock('../lib/leaseRecords', () => ({
  loadPermittedLease: jest.fn(async () => ({ id: LEASE_ID, endsOn: '2027-07-09' })),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => [
    { id: 'version-1', salesOrderId: 'order-1', startsOn: '2026-01-10', endsOn: '2027-01-09', state: 'in_force' },
    { id: 'version-2', salesOrderId: 'order-2', startsOn: '2027-01-10', endsOn: '2027-07-09', state: 'in_force' },
  ]),
}))
jest.mock('../lib/creditPermission', () => ({ hasCreditPermission: jest.fn(async () => false) }))
jest.mock('../lib/salesRecurrence', () => {
  const actual = jest.requireActual('../lib/salesRecurrence')
  return {
    ...actual,
    readRecurrence: (...args: [unknown, unknown, string]) => mockReadRecurrence(...args),
    defaultCancelSettlement: jest.fn(async () => 'keep'),
    isRecurrenceCancelAvailable: jest.fn(async () => true),
  }
})

import { GET } from '../api/leases/[id]/end/route'

type PreviewBody = {
  ordersToCancel: number
  options: Array<{ settlement: string; wouldCredit: boolean; allowed: boolean }>
}

describe('GET /leases/{id}/end preview', () => {
  it('reads each order recurrence once while planning every settlement', async () => {
    const response = (await GET(new Request(`http://localhost/api/property_management/leases/${LEASE_ID}/end?endsOn=2026-05-14`), {
      params: Promise.resolve({ id: LEASE_ID }),
    })) as unknown as { body: PreviewBody; status: number }
    expect(response.status).toBe(200)
    expect(response.body.ordersToCancel).toBe(2)
    expect(response.body.options.map((option) => option.settlement)).toEqual(['prorate', 'credit_full', 'keep'])
    expect(mockReadRecurrence).toHaveBeenCalledTimes(2)
    expect(mockReadRecurrence.mock.calls.map((call) => call[2]).sort()).toEqual(['order-1', 'order-2'])
  })
})
