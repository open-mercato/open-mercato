/** @jest-environment node */
import { IsolationLevel } from '@mikro-orm/core'

const reads: Array<{ what: string; em: unknown }> = []
const stored: {
  refusal: Record<string, unknown> | null
  operations: Array<Record<string, unknown>>
  versions: Array<Record<string, unknown>>
  proposals: Array<Record<string, unknown>>
  lease: Record<string, unknown>
} = { refusal: null, operations: [], versions: [], proposals: [], lease: {} }
const LEASE_ID = '33333333-3333-4333-8333-333333333333'
const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

const mockCrmGrants: string[] = []
const snapshotEm = { name: 'snapshot' }
const transactional = jest.fn(async (run: (em: unknown) => Promise<unknown>, _options: unknown) => run(snapshotEm))
const requestEm = { name: 'request', transactional, fork: () => requestEm }

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}))
jest.mock('../api/routeContext', () => ({
  resolveStaffContext: jest.fn(async () => ({
    ctx: {
      container: {
        resolve: () => ({
          userHasAllFeatures: async (_user: string, features: string[]) => {
            const { matchFeature } = jest.requireActual('@open-mercato/shared/lib/auth/featureMatch')
            return features.every((feature) => mockCrmGrants.some((grant) => matchFeature(feature, grant)))
          },
        }),
      },
      auth: { sub: 'user-1' },
    },
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
}))
jest.mock('../lib/leaseRecords', () => ({
  loadPermittedLease: jest.fn(async (em: unknown) => {
    reads.push({ what: 'lease', em })
    return {
      id: LEASE_ID,
      status: 'active',
      daysLeft: 75,
      endsOn: '2027-08-15',
      salesOrderId: 'order-1',
      salesOrderNumber: 'SO-1',
      pendingChange: null,
      lastBillingRefusal: stored.refusal,
      ...stored.lease,
    }
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (em: unknown, entity: { name: string }) => {
    reads.push({ what: entity.name, em })
    if (entity.name === 'SalesOperation') return stored.operations
    if (entity.name === 'LeaseVersion') return stored.versions
    if (entity.name === 'LeaseProposal') return stored.proposals
    return []
  }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => `${key}|${fallback ?? ''}`,
  }),
}))
jest.mock('../lib/leaseView', () => ({ summarizeLeases: jest.fn(async (_em: unknown, _scope: unknown, leases: Array<{ id: string }>) => leases) }))
jest.mock('../lib/settings', () => ({ loadSettings: jest.fn(async () => ({ leaseEndingThresholdDays: 90 })) }))
jest.mock('../lib/creditPermission', () => ({
  hasCreditPermission: jest.fn(async () => false),
  resolveSalesAccess: jest.fn(async () => ({ orders: false, quotes: false, invoices: false })),
}))
jest.mock('../lib/salesRecurrence', () => ({
  defaultCancelSettlement: jest.fn(async () => 'keep'),
  isRecurrenceCancelAvailable: jest.fn(() => false),
  readRecurrences: jest.fn(async () => new Map()),
}))
jest.mock('../lib/salesLookups', () => ({
  loadSalesDocuments: jest.fn(async (_em: unknown, _scope: unknown, kind: string, ids: string[]) =>
    new Map(ids.filter(Boolean).map((id) => [id, { id, number: `${kind}-number`, status: null, deleted: false }])),
  ),
  loadDocumentNumbers: jest.fn(async (_em: unknown, _scope: unknown, kind: string, ids: string[]) =>
    new Map(ids.filter(Boolean).map((id) => [id, `${kind}-number`])),
  ),
}))

import { GET } from '../api/leases/[id]/route'
import { loadPermittedLease } from '../lib/leaseRecords'
import { resolveSalesAccess } from '../lib/creditPermission'
import { loadDocumentNumbers } from '../lib/salesLookups'
import { readRecurrences, type RecurrenceRead } from '../lib/salesRecurrence'
import { summarizeLeases } from '../lib/leaseView'

type GatedBody = {
  lease: Record<string, unknown>
  crmAccess: { people: boolean; companies: boolean }
  salesAccess: { orders: boolean; quotes: boolean; invoices: boolean }
  versions: Array<Record<string, unknown>>
  proposals: Array<Record<string, unknown>>
}

const createdAt = new Date('2026-11-01T10:00:00Z')

function seedSalesDocuments(): void {
  stored.versions = [{ id: 'version-1', versionNo: 1, salesOrderId: 'order-1', startsOn: '2026-01-01', endsOn: '2026-12-31', createdAt }]
  stored.proposals = [{ id: 'proposal-1', kind: 'extension', status: 'sent', salesQuoteId: 'quote-1', createdAt }]
  jest.mocked(readRecurrences).mockResolvedValue(new Map([['order-1', {
    orderId: 'order-1',
    status: 'active',
    nextInvoiceOn: '2026-12-01',
    cancelEffectiveOn: null,
    invoicesAvailable: true,
    periods: [
      {
        periodIndex: 0,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        invoiceId: 'invoice-1',
        creditMemoId: 'credit-1',
        billedFactor: '1',
        creditedFactor: '1',
      },
    ],
  } as unknown as RecurrenceRead]]))
}

async function fetchGated(): Promise<GatedBody> {
  const response = (await GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: LEASE_ID }) })) as unknown as { body: GatedBody }
  return response.body
}

describe('lease detail GET', () => {
  describe('a deleted lease', () => {
    afterEach(() => {
      stored.lease = {}
      reads.length = 0
    })

    async function fetchDeleted() {
      return (await GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: LEASE_ID }) })) as unknown as {
        status: number
        body: { deleted: boolean }
      }
    }

    it('stays readable while its billing needs attention, flagged as deleted', async () => {
      stored.lease = { deletedAt: new Date('2026-11-10T10:00:00Z'), billingAttention: true }
      const response = await fetchDeleted()
      expect(response.status).toBe(200)
      expect(response.body.deleted).toBe(true)
      expect(jest.mocked(loadPermittedLease)).toHaveBeenLastCalledWith(snapshotEm, scope, null, LEASE_ID, { includeDeleted: true })
    })

    it('stays readable while its delete is still pending in sales', async () => {
      stored.lease = { deletedAt: new Date('2026-11-10T10:00:00Z'), billingAttention: false, pendingChange: { kind: 'delete', changeId: 'change-1' } }
      expect((await fetchDeleted()).body.deleted).toBe(true)
    })

    it('is not found once its billing has settled', async () => {
      stored.lease = { deletedAt: new Date('2026-11-10T10:00:00Z'), billingAttention: false }
      await expect(fetchDeleted()).rejects.toMatchObject({ status: 404 })
    })

    it('reports a live lease as not deleted', async () => {
      expect((await fetchDeleted()).body.deleted).toBe(false)
    })
  })

  it('reads the lease, its versions, proposals and open operations from one repeatable-read snapshot', async () => {
    const response = (await GET(new Request('http://localhost/api/property_management/leases/x'), { params: Promise.resolve({ id: LEASE_ID }) })) as unknown as {
      status: number
      body: { lease: { endsOn: string }; leaseEnding: boolean; leaseEndingThresholdDays: number }
    }
    expect(response.status).toBe(200)
    expect(response.body.lease.endsOn).toBe('2027-08-15')
    expect(response.body).toMatchObject({ leaseEnding: true, leaseEndingThresholdDays: 90, salesCancelAvailable: false })
    expect(transactional).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true })
    expect(reads.map((entry) => entry.what)).toEqual(['lease', 'LeaseVersion', 'LeaseProposal', 'SalesOperation'])
    expect(reads.every((entry) => entry.em === snapshotEm)).toBe(true)
  })

  it('describes stored sales errors instead of returning their raw text', async () => {
    reads.length = 0
    const createdAt = new Date('2026-11-01T10:00:00Z')
    stored.refusal = {
      changeId: 'change-1',
      kind: 'extend',
      code: 'sales_status_missing',
      message: '[internal] Sales status "x" is not configured',
      at: '2026-11-01T10:00:00Z',
      restored: null,
    }
    stored.operations = [
      { id: 'op-1', kind: 'order_status', status: 'refused', attempts: 1, lastError: { code: 'sales_status_missing', message: '[internal] Sales status "x" is not configured', status: null }, createdAt },
      { id: 'op-2', kind: 'lease_order', status: 'pending', attempts: 2, lastError: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.12:5432', status: null }, createdAt },
      { id: 'op-3', kind: 'lease_order', status: 'refused', attempts: 1, lastError: { code: 'order_locked', message: 'Order is locked', status: 409, compensation: true }, createdAt },
      { id: 'op-4', kind: 'lease_order', status: 'refused', attempts: 0, lastError: { code: 'predecessor_refused', message: null, status: null }, createdAt },
      { id: 'op-5', kind: 'lease_order', status: 'pending', attempts: 0, lastError: null, createdAt },
    ]
    try {
      const response = (await GET(new Request('http://localhost/api/property_management/leases/x'), { params: Promise.resolve({ id: LEASE_ID }) })) as unknown as {
        body: {
          lastBillingRefusal: Record<string, unknown> | null
          operations: Array<{ id: string; lastError: { code: string | null; message: string | null; status: number | null; compensation?: boolean } | null }>
        }
      }
      expect(response.body.lastBillingRefusal).toEqual({
        ...stored.refusal,
        message: 'property_management.salesErrors.statusMissing|The requested sales status is not configured.',
      })
      const errors = Object.fromEntries(response.body.operations.map((operation) => [operation.id, operation.lastError]))
      expect(errors['op-1']).toEqual({ code: 'sales_status_missing', status: null, message: 'property_management.salesErrors.statusMissing|The requested sales status is not configured.' })
      expect(errors['op-2']?.message).not.toContain('10.0.0.12')
      expect(errors['op-2']).toMatchObject({ code: 'ECONNREFUSED', status: null, message: expect.stringMatching(/^property_management\.salesErrors\.unexpected\|/) })
      expect(errors['op-3']).toEqual({ code: 'order_locked', message: 'Order is locked', status: 409, compensation: true })
      expect(errors['op-4']?.message).toMatch(/^property_management\.salesErrors\.predecessorRefused\|/)
      expect(errors['op-5']).toBeNull()
    } finally {
      stored.refusal = null
      stored.operations = []
    }
  })

  it('shows a refusal message sales returned and hides an unknown internal one', async () => {
    stored.refusal = { changeId: 'change-2', kind: 'end', code: 'order_locked', message: 'Order is locked', at: '2026-11-01T10:00:00Z', restored: null }
    try {
      const first = (await GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: LEASE_ID }) })) as unknown as { body: { lastBillingRefusal: { message: string } } }
      expect(first.body.lastBillingRefusal.message).toBe('Order is locked')
      stored.refusal = { changeId: 'change-3', kind: 'end', code: 'some_code', message: '[internal] boom', at: '2026-11-01T10:00:00Z', restored: null }
      const second = (await GET(new Request('http://localhost/x'), { params: Promise.resolve({ id: LEASE_ID }) })) as unknown as { body: { lastBillingRefusal: { message: string } } }
      expect(second.body.lastBillingRefusal.message).toMatch(/^property_management\.salesErrors\.unexpected\|/)
    } finally {
      stored.refusal = null
    }
  })

  describe('sales document details', () => {
    afterEach(() => {
      stored.versions = []
      stored.proposals = []
      jest.mocked(readRecurrences).mockResolvedValue(new Map())
      jest.mocked(resolveSalesAccess).mockResolvedValue({ orders: false, quotes: false, invoices: false })
    })

    it('omits order, quote and invoice details from a caller without sales features but keeps ids and recurrence', async () => {
      seedSalesDocuments()
      jest.mocked(loadDocumentNumbers).mockClear()
      const body = await fetchGated()
      expect(body.salesAccess).toEqual({ orders: false, quotes: false, invoices: false })
      expect(body.lease).toMatchObject({ salesOrderId: 'order-1' })
      expect(body.lease).not.toHaveProperty('salesOrderNumber')
      expect(body.versions[0]).toMatchObject({ salesOrderId: 'order-1', recurrence: { status: 'active', cancelEffectiveOn: null } })
      expect(body.versions[0]).not.toHaveProperty('salesOrderNumber')
      expect(body.versions[0]).not.toHaveProperty('invoices')
      expect(readRecurrences).toHaveBeenLastCalledWith(expect.anything(), scope, ['order-1'])
      expect(body.proposals[0]).toMatchObject({ salesQuoteId: 'quote-1' })
      expect(body.proposals[0]).not.toHaveProperty('salesQuoteNumber')
      for (const call of jest.mocked(loadDocumentNumbers).mock.calls) expect(call[3]).toEqual([])
    })

    it('returns each group of details only for the matching sales feature', async () => {
      seedSalesDocuments()
      jest.mocked(resolveSalesAccess).mockResolvedValue({ orders: true, quotes: false, invoices: true })
      const body = await fetchGated()
      expect(body.salesAccess).toEqual({ orders: true, quotes: false, invoices: true })
      expect(body.lease).toMatchObject({ salesOrderNumber: 'SO-1' })
      expect(body.versions[0]).toMatchObject({
        salesOrderNumber: 'order-number',
        invoices: [{ invoiceId: 'invoice-1', invoiceNumber: 'invoice-number', creditMemoId: 'credit-1', creditMemoNumber: 'credit_memo-number', billedFactor: '1', creditedFactor: '1' }],
      })
      expect(body.proposals[0]).not.toHaveProperty('salesQuoteNumber')
    })

    it('returns the quote number to a caller who can view quotes', async () => {
      seedSalesDocuments()
      jest.mocked(resolveSalesAccess).mockResolvedValue({ orders: false, quotes: true, invoices: false })
      const body = await fetchGated()
      expect(body.proposals[0]).toMatchObject({ salesQuoteNumber: 'quote-number' })
      expect(body.versions[0]).not.toHaveProperty('invoices')
    })
  })

  describe('CRM access', () => {
    afterEach(() => {
      mockCrmGrants.length = 0
      jest.mocked(summarizeLeases).mockClear()
    })

    it.each([
      { grants: [], access: { people: false, companies: false } },
      { grants: ['customers.people.view'], access: { people: true, companies: false } },
      { grants: ['customers.companies.view'], access: { people: false, companies: true } },
      { grants: ['customers.*'], access: { people: true, companies: true } },
    ])('reports $access for grants $grants and summarizes the lease with it', async ({ grants, access }) => {
      mockCrmGrants.push(...grants)
      const body = await fetchGated()
      expect(body.crmAccess).toEqual(access)
      expect(summarizeLeases).toHaveBeenLastCalledWith(expect.anything(), scope, expect.any(Array), { crmAccess: access })
    })
  })
})
