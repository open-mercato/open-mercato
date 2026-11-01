/** @jest-environment node */

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

type FakeRow = Record<string, unknown>

let seededThreads: FakeRow[] = []
let seededCustomers: FakeRow[] = []
let seededUsers: FakeRow[] = []

function makeThreadRow(overrides: FakeRow = {}): FakeRow {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 'thread-1',
    organizationId: ORG_ID,
    storeId: 'store-1',
    buyerCartId: 'cart-1',
    customerId: null,
    customerUserId: null,
    status: 'open',
    modeSnapshot: 'guided',
    assignedActorId: null,
    liveProposalCount: 0,
    lastActivityAt: now,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const mockFindWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  const ids = (where.id as { $in: string[] } | undefined)?.$in ?? []
  if (entity === CustomerEntityRef) return seededCustomers.filter((row) => ids.includes(row.id as string))
  if (entity === UserRef) return seededUsers.filter((row) => ids.includes(row.id as string))
  return []
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

const fakeEm: FakeRow = {
  findAndCount: jest.fn(async () => [seededThreads, seededThreads.length]),
}
fakeEm.fork = jest.fn(() => fakeEm)
const container = { resolve: jest.fn((name: string) => (name === 'em' ? fakeEm : undefined)) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

let mockAuth: { sub: string; tenantId: string | null; orgId: string | null } | null = {
  sub: 'staff-1',
  tenantId: TENANT_ID,
  orgId: ORG_ID,
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => mockAuth),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID] })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { GET } from '../route'
import { CustomerEntity as CustomerEntityRef } from '@open-mercato/core/modules/customers/data/entities'
import { User as UserRef } from '@open-mercato/core/modules/auth/data/entities'

// Regression (bug 16, round-4 QA): the buyer/assignee name enrichment used a plain
// `em.find` against `CustomerEntity.displayName`/`User.name`, both encrypted columns, so
// staff saw ciphertext instead of names. Must go through `findWithDecryption`.
describe('assisted_selling threads list — buyer/assignee name enrichment (decryption)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    seededThreads = []
    seededCustomers = []
    seededUsers = []
    mockAuth = { sub: 'staff-1', tenantId: TENANT_ID, orgId: ORG_ID }
  })

  function callGet(query = '') {
    return GET(new Request(`http://localhost/api/assisted_selling/threads${query}`))
  }

  it('resolves customerName and assignedActorName via findWithDecryption, never a plain em.find', async () => {
    seededThreads = [makeThreadRow({ customerId: 'customer-1', assignedActorId: 'rep-1' })]
    seededCustomers = [{ id: 'customer-1', displayName: 'Alice Buyer' }]
    seededUsers = [{ id: 'rep-1', name: 'Rep One', email: 'rep1@example.com' }]

    const response = await callGet()
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.items).toHaveLength(1)
    expect(body.items[0].customerName).toBe('Alice Buyer')
    expect(body.items[0].assignedActorName).toBe('Rep One')
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(2)
  })

  it('falls back to null names when no match is found, without throwing', async () => {
    seededThreads = [makeThreadRow({ customerId: 'customer-missing', assignedActorId: 'rep-missing' })]

    const response = await callGet()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items[0].customerName).toBeNull()
    expect(body.items[0].assignedActorName).toBeNull()
  })
})
