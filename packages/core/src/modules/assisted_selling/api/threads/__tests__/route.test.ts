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

const mockCommandBusExecute = jest.fn(async () => ({
  result: {
    threadId: 'thread-1',
    organizationId: ORG_ID,
    storeId: 'store-1',
    buyerCartId: 'cart-1',
    customerId: null,
    customerUserId: null,
    status: 'open',
    modeSnapshot: 'rep',
    liveProposalCount: 0,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    participantId: 'participant-1',
    messageId: 'message-1',
    alreadyOpen: false,
  },
}))

let guards: MutationGuard[] = []
jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(() => guards),
}))

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return fakeEm
    if (name === 'commandBus') return { execute: mockCommandBusExecute }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn(async () => ({ cartId: '33333333-3333-4333-8333-333333333333' })),
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

import { GET, POST } from '../route'
import { CustomerEntity as CustomerEntityRef } from '@open-mercato/core/modules/customers/data/entities'
import { User as UserRef } from '@open-mercato/core/modules/auth/data/entities'
import { resolveOrganizationScopeForRequest as mockedResolveScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const resolveScopeMock = mockedResolveScope as jest.MockedFunction<typeof mockedResolveScope>

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

  // Review finding: the assignee name lookup had no `tenantId` filter — any tenant's user
  // matching the id resolved, leaking another tenant's name/email and, combined with an
  // unvalidated `assign` actorId, acting as a cross-tenant user-id oracle.
  it('scopes the assignee User lookup by tenantId, not just by id', async () => {
    seededThreads = [makeThreadRow({ assignedActorId: 'rep-1' })]
    seededUsers = [{ id: 'rep-1', name: 'Rep One', email: 'rep1@example.com' }]

    await callGet()

    const userLookupCall = mockFindWithDecryption.mock.calls.find((call) => call[1] === UserRef)
    expect(userLookupCall?.[2]).toMatchObject({ tenantId: TENANT_ID })
  })
})

describe('assisted_selling threads list — scope resolution and query parsing (review findings)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    seededThreads = []
    seededCustomers = []
    seededUsers = []
    mockAuth = { sub: 'staff-1', tenantId: TENANT_ID, orgId: ORG_ID }
    resolveScopeMock.mockReset()
    resolveScopeMock.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID] } as never)
  })

  function callGet(query = '') {
    return GET(new Request(`http://localhost/api/assisted_selling/threads${query}`))
  }

  // A scope-resolution failure used to be swallowed into a `null` scope, which fell through
  // to this module's own unrestricted/raw-org fallback — silently widening a transient
  // failure into access the caller's real, unresolved scope might have denied.
  it('fails closed (503) when organization-scope resolution throws, rather than falling open', async () => {
    resolveScopeMock.mockRejectedValueOnce(new Error('scope service unavailable'))
    seededThreads = [makeThreadRow()]

    const response = await callGet()

    expect(response.status).toBe(503)
    expect((fakeEm.findAndCount as jest.Mock)).not.toHaveBeenCalled()
  })

  // `z.coerce.boolean()` turned the literal string `"false"` into `true` — any non-empty
  // query value coerces truthy.
  it('treats hasLiveProposals=false as "no filter", never coercing it truthy', async () => {
    seededThreads = [makeThreadRow()]

    const response = await callGet('?hasLiveProposals=false')

    expect(response.status).toBe(200)
    const [, where] = (fakeEm.findAndCount as jest.Mock).mock.calls[0]
    expect(where.liveProposalCount).toBeUndefined()
  })

  it('applies the liveProposalCount filter when hasLiveProposals=true', async () => {
    seededThreads = [makeThreadRow()]

    const response = await callGet('?hasLiveProposals=true')

    expect(response.status).toBe(200)
    const [, where] = (fakeEm.findAndCount as jest.Mock).mock.calls[0]
    expect(where.liveProposalCount).toEqual({ $gt: 0 })
  })
})

// M12 fix (review finding): `POST /threads` dispatched `assisted_selling.thread.open`
// without going through the shared route mutation-guard registry at all — the same
// wrapper `api/settings/[storeId]/route.ts` already uses for its own write.
describe('POST /threads — mutation guard registry (review finding M12)', () => {
  beforeEach(() => {
    mockCommandBusExecute.mockClear()
    mockAuth = { sub: 'staff-1', tenantId: TENANT_ID, orgId: ORG_ID }
    guards = []
  })

  function callPost() {
    return POST(new Request('http://localhost/api/assisted_selling/threads', { method: 'POST' }))
  }

  it('refuses with the guard\'s own status/body and never dispatches the open command when a guard denies', async () => {
    const denyingGuard: MutationGuard = {
      id: 'test.deny-thread-open',
      targetEntity: 'assisted_selling.thread',
      operations: ['create'],
      async validate() {
        return { ok: false, status: 422, body: { error: 'blocked by test guard', code: 'test_guard_blocked' } }
      },
    }
    guards = [denyingGuard]

    const response = await callPost()

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'blocked by test guard', code: 'test_guard_blocked' })
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })

  it('merges a transforming guard\'s modifiedPayload into the dispatched command input and still runs afterSuccess', async () => {
    const afterSuccess = jest.fn(async () => undefined)
    const transformingGuard: MutationGuard = {
      id: 'test.transform-thread-open',
      targetEntity: 'assisted_selling.thread',
      operations: ['create'],
      async validate() {
        return { ok: true, modifiedPayload: { message: 'transformed note' }, shouldRunAfterSuccess: true }
      },
      afterSuccess,
    }
    guards = [transformingGuard]

    const response = await callPost()

    expect(response.status).toBe(201)
    expect(mockCommandBusExecute).toHaveBeenCalledTimes(1)
    const [, options] = mockCommandBusExecute.mock.calls[0]
    expect((options as { input: { message?: unknown } }).input.message).toBe('transformed note')
    expect(afterSuccess).toHaveBeenCalledTimes(1)
  })

  it('passes the caller\'s own userId (not "anonymous") to the guard registry for an authenticated caller', async () => {
    const seenUserIds: string[] = []
    const recordingGuard: MutationGuard = {
      id: 'test.record-user-id',
      targetEntity: 'assisted_selling.thread',
      operations: ['create'],
      async validate(input) {
        seenUserIds.push(input.userId)
        return { ok: true }
      },
    }
    guards = [recordingGuard]

    await callPost()

    expect(seenUserIds).toEqual([mockAuth!.sub])
  })
})
