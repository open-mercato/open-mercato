import { AssistedSellingThread } from '../../data/entities'
import { handleCartAdoptedForAssistedSellingIdentity } from '../cartAdoptedIdentityMigration'

type Row = Record<string, any>

const TENANT_ID = 'tenant-adopt-1'
const ORG_ID = 'org-adopt-1'
const CART_ID = 'cart-adopt-1'
const CUSTOMER_ID = 'customer-adopt-1'
const CUSTOMER_USER_ID = 'customer-user-adopt-1'
const THREAD_ID = 'thread-adopt-1'

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => (row[key] ?? null) === (value ?? null))
}

function makeThread(overrides: Row = {}): Row {
  return {
    id: THREAD_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    buyerCartId: CART_ID,
    status: 'open',
    customerId: null,
    customerUserId: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeFakeEm(seed: { threads?: Row[] } = {}) {
  const threads = seed.threads ? [...seed.threads] : []
  const em: Row = {
    findOne: jest.fn(async (Cls: unknown, where: Row) => {
      const rows = Cls === AssistedSellingThread ? threads : []
      return rows.find((row) => matches(row, where)) ?? null
    }),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
  }
  em.fork = jest.fn(() => em)
  return { em, threads }
}

function makeContainer(em: Row) {
  return { resolve: (name: string): any => (name === 'em' ? em : undefined) }
}

function makePayload(overrides: Row = {}): Row {
  return {
    cartId: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    customerId: CUSTOMER_ID,
    customerUserId: CUSTOMER_USER_ID,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('handleCartAdoptedForAssistedSellingIdentity — #8268 review Major 5 / issue #9392', () => {
  test('fills in the open thread\'s customerId/customerUserId when the thread shares the adopted cart id', async () => {
    const thread = makeThread()
    const { em } = makeFakeEm({ threads: [thread] })
    const container = makeContainer(em)

    await handleCartAdoptedForAssistedSellingIdentity(makePayload(), container)

    expect(thread.customerId).toBe(CUSTOMER_ID)
    expect(thread.customerUserId).toBe(CUSTOMER_USER_ID)
  })

  test('no-ops when no open thread exists for the adopted cart', async () => {
    const { em } = makeFakeEm({ threads: [] })
    const container = makeContainer(em)

    await expect(handleCartAdoptedForAssistedSellingIdentity(makePayload(), container)).resolves.toBeUndefined()
    expect(em.begin).not.toHaveBeenCalled()
  })

  test('ignores a closed thread even if its buyerCartId matches', async () => {
    const thread = makeThread({ status: 'closed' })
    const { em } = makeFakeEm({ threads: [thread] })
    const container = makeContainer(em)

    await handleCartAdoptedForAssistedSellingIdentity(makePayload(), container)

    expect(thread.customerId).toBeNull()
    expect(thread.customerUserId).toBeNull()
  })

  test('skips an incomplete payload without throwing', async () => {
    const { em } = makeFakeEm({ threads: [makeThread()] })
    const container = makeContainer(em)

    await expect(
      handleCartAdoptedForAssistedSellingIdentity({ cartId: CART_ID }, container),
    ).resolves.toBeUndefined()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  test('is idempotent on redelivery once the thread already carries the adopted identity', async () => {
    const thread = makeThread({ customerId: CUSTOMER_ID, customerUserId: CUSTOMER_USER_ID })
    const { em } = makeFakeEm({ threads: [thread] })
    const container = makeContainer(em)

    await handleCartAdoptedForAssistedSellingIdentity(makePayload(), container)
    await handleCartAdoptedForAssistedSellingIdentity(makePayload(), container)

    expect(thread.customerId).toBe(CUSTOMER_ID)
    expect(thread.customerUserId).toBe(CUSTOMER_USER_ID)
  })

  test('re-throws on a lookup failure so the persistent subscriber redelivers', async () => {
    const { em } = makeFakeEm({ threads: [] })
    em.findOne.mockRejectedValueOnce(new Error('boom'))
    const container = makeContainer(em)

    await expect(handleCartAdoptedForAssistedSellingIdentity(makePayload(), container)).rejects.toThrow('boom')
  })
})
