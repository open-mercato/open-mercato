import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { LedgerAccount } from '../../data/entities'

const mockFindAndCount = jest.fn()
const mockFind = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'viewer', tenantId: 'tenant-a', orgId: 'org-a' }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => ({ findAndCount: mockFindAndCount, find: mockFind }),
  }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ tenantId: 'tenant-a', filterIds: ['org-a'] }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const ENTRY_ID = '11111111-1111-4111-8111-111111111111'
const PLN_ID = '22222222-2222-4222-8222-222222222222'
const EUR_ID = '33333333-3333-4333-8333-333333333333'
const MISSING_ID = '44444444-4444-4444-8444-444444444444'
const ACCOUNT_ID = '55555555-5555-4555-8555-555555555555'

const entry = {
  id: ENTRY_ID,
  sequenceNumber: 1,
  postedAt: new Date('2034-01-15T10:00:00Z'),
  operationDate: '2034-01-15',
  documentType: null,
  documentNumber: null,
  documentDate: null,
  postedBy: null,
  description: 'Mixed currency entry',
  type: 'NORMAL',
  currencyId: EUR_ID,
  exchangeRate: '4.30001234',
  referenceType: null,
  referenceId: null,
  organizationId: 'org-a',
  tenantId: 'tenant-a',
}

const line = (id: string, currencyId: string, debit: string, credit: string) => ({
  id,
  accountId: ACCOUNT_ID,
  debit,
  credit,
  currencyId,
  exchangeRate: currencyId === PLN_ID ? '1.00000000' : '4.30001234',
  amountCurrency: currencyId === PLN_ID ? '430.0017' : '100.0001',
})

beforeEach(() => {
  jest.resetAllMocks()
  mockFindAndCount.mockResolvedValue([[entry], 1])
  mockFind.mockImplementation(async (entity: unknown) => {
    if (entity === LedgerAccount) return [{ id: ACCOUNT_ID, number: '456-01', description: 'Materials' }]
    if (entity === Currency) return [{ id: PLN_ID, code: 'PLN' }, { id: EUR_ID, code: 'EUR' }]
    return []
  })
})

async function loadDetailLines() {
  const { GET } = await import('../journal-entries/route')
  const response = await GET(new Request(`http://localhost/api/ledger/journal-entries?id=${ENTRY_ID}`))
  expect(response.status).toBe(200)
  const body = await response.json() as { items: Array<{ lines?: Array<Record<string, unknown>> }> }
  return body.items[0].lines ?? []
}

it('returns a readable currency code next to the unchanged currency id on each line', async () => {
  mockFindWithDecryption.mockResolvedValue([
    line('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PLN_ID, '430.0017', '0'),
    line('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', EUR_ID, '0', '430.0017'),
  ])

  const lines = await loadDetailLines()

  expect(lines.map((row) => [row.currencyId, row.currencyCode])).toEqual([[PLN_ID, 'PLN'], [EUR_ID, 'EUR']])
  const currencyCall = mockFind.mock.calls.find(([entity]) => entity === Currency)
  expect(currencyCall?.[1]).toEqual({ id: { $in: [PLN_ID, EUR_ID] }, organizationId: 'org-a', tenantId: 'tenant-a' })
})

it('falls back to the currency id when the code cannot be resolved', async () => {
  mockFindWithDecryption.mockResolvedValue([
    line('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PLN_ID, '430.0017', '0'),
    line('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', MISSING_ID, '0', '430.0017'),
  ])

  const lines = await loadDetailLines()

  expect(lines.map((row) => [row.currencyId, row.currencyCode])).toEqual([[PLN_ID, 'PLN'], [MISSING_ID, MISSING_ID]])
})

it('keeps the list response free of lines and of currency lookups', async () => {
  const { GET } = await import('../journal-entries/route')

  const response = await GET(new Request('http://localhost/api/ledger/journal-entries'))

  expect(response.status).toBe(200)
  const body = await response.json() as { items: Array<Record<string, unknown>> }
  expect(body.items[0]).not.toHaveProperty('lines')
  expect(mockFind).not.toHaveBeenCalled()
})
