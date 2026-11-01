jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

jest.mock('../sessionEvents', () => ({
  writeSessionEvent: jest.fn(async () => undefined),
}))

type FakeRow = Record<string, any>

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value)
}

let seededSessions: FakeRow[] = []

function makeSession(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    cartId: 'cart-1',
    status: 'awaiting_approval',
    quotedTotals: { deliveryMethodCode: 'acme:standard' },
    failureCode: null,
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeEm() {
  const em: any = {
    find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
      seededSessions.filter((row) => matchesWhere(row, where))),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>, data: FakeRow) => {
      const rows = seededSessions.filter((row) => matchesWhere(row, where))
      rows.forEach((row) => Object.assign(row, data))
      return rows.length
    }),
  }
  em.fork = jest.fn(() => em)
  return em
}

function makeCtx() {
  const em = makeEm()
  return { ctx: { resolve: (name: string) => (name === 'em' ? em : undefined) }, em }
}

import { writeSessionEvent } from '../sessionEvents'
import { emitCheckoutEvent } from '../../events'

beforeEach(() => {
  jest.clearAllMocks()
  seededSessions = [makeSession()]
})

// Release 5, Step 5.2 (C11, §8.2 step 3) — shared by all four `.approved`/`.rejected`/
// `.expired`/`.withdrawn` subscriber files.
describe.each([
  ['approval-approved', 'approved', 'checkout.session.approval_approved'],
  ['approval-rejected', 'rejected', 'checkout.session.approval_rejected'],
  ['approval-expired', 'expired', 'checkout.session.approval_rejected'],
  ['approval-withdrawn', 'withdrawn', 'checkout.session.approval_rejected'],
])('checkout subscriber %s (%s)', (fileName, outcome, expectedEventId) => {
  it('ignores a payload for a different subjectType (reserved quote subject)', async () => {
    const mod = await import(`../../subscribers/${fileName}`)
    const { ctx, em } = makeCtx()

    await mod.default(
      { subjectType: 'quote', subjectId: 'cart-1', approvalId: 'approval-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    expect(em.find).not.toHaveBeenCalled()
  })

  it('is a no-op (never throws) on an incomplete payload', async () => {
    const mod = await import(`../../subscribers/${fileName}`)
    const { ctx, em } = makeCtx()

    await expect(mod.default({ subjectType: 'cart' }, ctx)).resolves.toBeUndefined()
    expect(em.find).not.toHaveBeenCalled()
  })

  it('does nothing when no live awaiting_approval session matches the cart (already expired/canceled/superseded)', async () => {
    seededSessions = []
    const mod = await import(`../../subscribers/${fileName}`)
    const { ctx, em } = makeCtx()

    await mod.default(
      { subjectType: 'cart', subjectId: 'cart-1', approvalId: 'approval-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('never touches a session in a DIFFERENT tenant/organization for the same cart id (tenant/org isolation)', async () => {
    seededSessions = [makeSession({ id: 'session-other-tenant', tenantId: 'tenant-2', organizationId: 'org-2' })]
    const mod = await import(`../../subscribers/${fileName}`)
    const { ctx, em } = makeCtx()

    await mod.default(
      { subjectType: 'cart', subjectId: 'cart-1', approvalId: 'approval-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(seededSessions[0].status).toBe('awaiting_approval')
  })

  it(`resumes the live session and emits ${expectedEventId}`, async () => {
    const mod = await import(`../../subscribers/${fileName}`)
    const { ctx } = makeCtx()

    await mod.default(
      { subjectType: 'cart', subjectId: 'cart-1', approvalId: 'approval-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    if (outcome === 'rejected') {
      expect(seededSessions[0].status).toBe('failed')
      expect(seededSessions[0].failureCode).toBe('approval_rejected')
    } else {
      expect(seededSessions[0].status).toBe('open')
    }
    if (outcome === 'approved') {
      expect(seededSessions[0].quotedTotals).toBeNull()
    } else {
      // §8.2 step 3: only `approved` clears `quoted_totals` — nothing about the cart
      // changed for a rejection/expiry/withdrawal, so it is left as-is.
      expect(seededSessions[0].quotedTotals).toEqual({ deliveryMethodCode: 'acme:standard' })
    }

    expect(writeSessionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      sessionId: 'session-1',
      kind: 'approval_state',
      actor: 'system',
    }))
    expect(emitCheckoutEvent).toHaveBeenCalledWith(expectedEventId, expect.objectContaining({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      cartId: 'cart-1',
      approvalId: 'approval-1',
    }))
  })

  it('is a safe no-op when the event is redelivered after the session already resumed (CAS matches zero rows)', async () => {
    seededSessions[0].status = 'open'
    const mod = await import(`../../subscribers/${fileName}`)
    const { ctx, em } = makeCtx()

    await mod.default(
      { subjectType: 'cart', subjectId: 'cart-1', approvalId: 'approval-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(writeSessionEvent).not.toHaveBeenCalled()
  })
})
