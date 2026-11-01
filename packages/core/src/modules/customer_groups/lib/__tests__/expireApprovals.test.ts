/**
 * Step 2.5 (D-R5-27, §6.6, §11). `expirePendingApprovals` against a mocked
 * `EntityManager` — same mocked-dependency style `availability/lib/reservationSweep.ts`'s
 * own test (`expireAvailabilityReservations`) and `customer_groups:credit-exposure-audit`'s
 * own test use.
 *
 * Covers:
 *  - the false-positive guard: only `pending` rows PAST `expires_at` are CAS-transitioned;
 *    `pending`-but-not-due, and every other status, are left untouched;
 *  - a row a concurrent decide/withdraw already resolved is skipped silently (CAS affected
 *    = 0), never double-processed, never reported as an error;
 *  - exactly one `.expired` event per transitioned row, carrying `tenantId`/`organizationId`
 *    and a `decidedBy: { actorType: 'system' }` marker;
 *  - tenant scoping: a row in another tenant is never touched by this tenant's tick.
 */
const emittedEvents: Array<{ id: string; payload: Record<string, unknown> }> = []

jest.mock('../../events', () => ({
  emitCustomerGroupsEvent: async (id: string, payload: Record<string, unknown>) => {
    emittedEvents.push({ id, payload })
  },
}))

import { expirePendingApprovals } from '../expireApprovals'

const TENANT = 'tenant-1'
const OTHER_TENANT = 'tenant-2'
const ORG = 'org-1'

type Row = Record<string, unknown>

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
    const ops = condition as Record<string, unknown>
    if ('$lte' in ops) {
      const target = ops.$lte
      return value instanceof Date && target instanceof Date ? value.getTime() <= target.getTime() : false
    }
  }
  return value === condition
}

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => matchesCondition(row[key], condition))
}

function createFakeEm(rows: Row[]) {
  const em = {
    fork: () => em,
    find: async (_entity: unknown, where: Row, options?: { limit?: number }) => {
      const matched = rows.filter((row) => matchesWhere(row, where)).sort((a, b) => String(a.id).localeCompare(String(b.id)))
      return options?.limit ? matched.slice(0, options.limit) : matched
    },
    nativeUpdate: async (_entity: unknown, where: Row, set: Row) => {
      const matched = rows.filter((row) => matchesWhere(row, where))
      for (const row of matched) Object.assign(row, set)
      return matched.length
    },
  }
  return em as unknown as import('@mikro-orm/postgresql').EntityManager
}

function buildContainer(em: unknown) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      throw new Error(`unexpected resolve(${name})`)
    },
  }
}

function buildApproval(overrides: Partial<Row> = {}): Row {
  return {
    id: 'approval-1',
    tenantId: TENANT,
    organizationId: ORG,
    customerId: 'customer-1',
    requestedByActorType: 'customer_user',
    requestedByActorId: 'customer-user-1',
    subjectType: 'cart',
    subjectId: 'cart-1',
    amountGross: '100.00',
    currencyCode: 'USD',
    approvalPolicy: 'both',
    status: 'pending',
    buyerDecision: 'pending',
    merchantDecision: 'pending',
    expiresAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2025-12-31T23:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  emittedEvents.length = 0
})

describe('expirePendingApprovals (D-R5-27)', () => {
  const now = new Date('2026-01-01T00:10:00Z')

  it('CAS-transitions only past-due pending rows and leaves every other status/timing untouched', async () => {
    const dueApproval = buildApproval({ id: 'approval-due' })
    const notYetDue = buildApproval({ id: 'approval-not-due', expiresAt: new Date('2026-01-01T01:00:00Z') })
    const approved = buildApproval({ id: 'approval-approved', status: 'approved' })
    const alreadyExpired = buildApproval({ id: 'approval-already-expired', status: 'expired' })
    const rows = [dueApproval, notYetDue, approved, alreadyExpired]
    const em = createFakeEm(rows)

    const result = await expirePendingApprovals(buildContainer(em), { tenantId: TENANT }, now)

    expect(result.expiredCount).toBe(1)
    expect(dueApproval.status).toBe('expired')
    expect(notYetDue.status).toBe('pending')
    expect(approved.status).toBe('approved')
    expect(alreadyExpired.status).toBe('expired')

    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].id).toBe('customer_groups.approval.expired')
    expect(emittedEvents[0].payload).toMatchObject({
      tenantId: TENANT,
      organizationId: ORG,
      approvalId: 'approval-due',
      status: 'expired',
      decidedBy: { actorType: 'system', actorId: null },
    })
  })

  it('skips a row that lost its CAS race to a concurrent decide/withdraw between read and update, without reporting it as an error', async () => {
    const racedApproval = buildApproval({ id: 'approval-raced' })
    const em = createFakeEm([racedApproval])
    // Simulate another transaction winning the race right after this job's own `find`
    // already returned the row as `pending` — the CAS `nativeUpdate`'s own
    // `WHERE status = 'pending'` must then match nothing.
    const originalFind = (em as unknown as { find: (...args: unknown[]) => Promise<Row[]> }).find.bind(em)
    ;(em as unknown as { find: typeof originalFind }).find = (async (...args: Parameters<typeof originalFind>) => {
      const found = await originalFind(...args)
      racedApproval.status = 'approved'
      return found
    }) as typeof originalFind

    const result = await expirePendingApprovals(buildContainer(em), { tenantId: TENANT }, now)

    expect(result.expiredCount).toBe(0)
    expect(racedApproval.status).toBe('approved') // the decider's status stands, untouched by expiry
    expect(emittedEvents).toHaveLength(0)
  })

  it('never touches a row in a different tenant', async () => {
    const otherTenantApproval = buildApproval({ id: 'approval-other-tenant', tenantId: OTHER_TENANT })
    const em = createFakeEm([otherTenantApproval])

    const result = await expirePendingApprovals(buildContainer(em), { tenantId: TENANT }, now)

    expect(result.expiredCount).toBe(0)
    expect(otherTenantApproval.status).toBe('pending')
    expect(emittedEvents).toHaveLength(0)
  })

  it('is a no-op (zero count, zero events) when nothing is past due', async () => {
    const notDue = buildApproval({ id: 'approval-not-due', expiresAt: new Date('2026-06-01T00:00:00Z') })
    const em = createFakeEm([notDue])

    const result = await expirePendingApprovals(buildContainer(em), { tenantId: TENANT }, now)

    expect(result).toEqual({ expiredCount: 0 })
    expect(emittedEvents).toHaveLength(0)
  })
})
