// Step 6.5 — unit coverage for `services/code-reservation-sweeper.ts`. `findWithDecryption` is
// mocked to a thin pass-through so these tests exercise the sweep's own query/delete logic
// against a fake EntityManager, not the real tenant-encryption pipeline — same convention as
// `cart/lib/__tests__/sweepers.test.ts`.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async (em: any, entity: any, where: any, options: any) => em.find(entity, where, options),
}))

import { CodeReservation } from '../../data/entities'
import { sweepExpiredCodeReservations } from '../code-reservation-sweeper'

const TENANT = 'tenant-reservation-sweep-1'
const OTHER_TENANT = 'tenant-reservation-sweep-2'
const ORG = 'org-reservation-sweep-1'
const NOW = new Date('2026-10-15T12:00:00.000Z')

function makeReservation(overrides: Partial<CodeReservation> = {}): CodeReservation {
  return {
    id: `reservation-${Math.random().toString(36).slice(2)}`,
    codeId: 'code-1',
    codeString: 'SAVE10',
    cartId: `cart-${Math.random().toString(36).slice(2)}`,
    customerId: null,
    organizationId: ORG,
    tenantId: TENANT,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    ...overrides,
  } as CodeReservation
}

// Evaluates one MikroORM-style filter value ($in/$lte), ANDed when combined on one key —
// mirrors cart/lib/__tests__/sweepers.test.ts's own matchesValue/matchesWhere helpers.
function matchesValue(actual: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) {
    return Object.entries(condition as Record<string, unknown>).every(([op, opValue]) => {
      switch (op) {
        case '$in':
          return (opValue as unknown[]).includes(actual)
        case '$lte':
          return actual instanceof Date && opValue instanceof Date && actual <= opValue
        default:
          return true
      }
    })
  }
  return actual === condition
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => matchesValue(row[key], value))
}

function makeEm(initialReservations: CodeReservation[]) {
  let reservations = initialReservations

  return {
    find: jest.fn(
      async (
        _entity: unknown,
        where: Record<string, unknown>,
        options?: { limit?: number; orderBy?: Record<string, 'ASC' | 'DESC'> },
      ) => {
        let matched = reservations.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where))
        if (options?.orderBy) {
          const entries = Object.entries(options.orderBy)
          matched = [...matched].sort((a: any, b: any) => {
            for (const [field, dir] of entries) {
              const av = a[field]
              const bv = b[field]
              const cmp = av < bv ? -1 : av > bv ? 1 : 0
              if (cmp !== 0) return dir === 'DESC' ? -cmp : cmp
            }
            return 0
          })
        }
        if (typeof options?.limit === 'number') matched = matched.slice(0, options.limit)
        return matched
      },
    ),
    nativeDelete: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      const matched = reservations.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where))
      const matchedIds = new Set(matched.map((row) => row.id))
      reservations = reservations.filter((row) => !matchedIds.has(row.id))
      return matched.length
    }),
    _rows: () => reservations,
  }
}

describe('sweepExpiredCodeReservations', () => {
  it('releases a reservation past its TTL', async () => {
    const lapsed = makeReservation({ id: 'lapsed-1', expiresAt: new Date(NOW.getTime() - 1000) })
    const em = makeEm([lapsed])

    const result = await sweepExpiredCodeReservations(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ released: 1 })
    expect(em._rows()).toHaveLength(0)
  })

  it('releases a reservation expiring at exactly now (<=, matches entity note "expires_at > NOW() is still active")', async () => {
    const exactlyNow = makeReservation({ id: 'exactly-now-1', expiresAt: new Date(NOW.getTime()) })
    const em = makeEm([exactlyNow])

    const result = await sweepExpiredCodeReservations(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ released: 1 })
  })

  it('leaves a reservation not yet expired alone', async () => {
    const active = makeReservation({ id: 'active-1', expiresAt: new Date(NOW.getTime() + 1000) })
    const em = makeEm([active])

    const result = await sweepExpiredCodeReservations(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ released: 0 })
    expect(em._rows()).toHaveLength(1)
  })

  it('never releases a lapsed reservation belonging to a different tenant', async () => {
    const otherTenantLapsed = makeReservation({
      id: 'other-tenant-1',
      tenantId: OTHER_TENANT,
      expiresAt: new Date(NOW.getTime() - 1000),
    })
    const em = makeEm([otherTenantLapsed])

    const result = await sweepExpiredCodeReservations(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ released: 0 })
    expect(em._rows()).toHaveLength(1)
  })

  it('pages through a backlog larger than one page without infinite-looping or skipping rows', async () => {
    // SWEEP_PAGE_SIZE is 500 — 530 lapsed rows forces a second, partial page.
    const lapsedRows = Array.from({ length: 530 }, (_, i) =>
      makeReservation({ id: `lapsed-${i}`, expiresAt: new Date(NOW.getTime() - 1000) }),
    )
    const em = makeEm(lapsedRows)

    const result = await sweepExpiredCodeReservations(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ released: 530 })
    expect(em._rows()).toHaveLength(0)
    // Two pages: one full (500) + one partial (30) — the loop must have made exactly 2 find calls.
    expect((em.find as jest.Mock).mock.calls.length).toBe(2)
  })

  it('mixes lapsed and active rows across a backlog, releasing only the lapsed ones', async () => {
    const lapsed = Array.from({ length: 3 }, (_, i) =>
      makeReservation({ id: `mixed-lapsed-${i}`, expiresAt: new Date(NOW.getTime() - 1000) }),
    )
    const active = Array.from({ length: 2 }, (_, i) =>
      makeReservation({ id: `mixed-active-${i}`, expiresAt: new Date(NOW.getTime() + 1000) }),
    )
    const em = makeEm([...lapsed, ...active])

    const result = await sweepExpiredCodeReservations(em as never, { tenantId: TENANT }, NOW)

    expect(result).toEqual({ released: 3 })
    expect(em._rows()).toHaveLength(2)
    expect(em._rows().every((row) => row.id.startsWith('mixed-active-'))).toBe(true)
  })
})
