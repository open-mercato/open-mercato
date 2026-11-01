jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined),
}))

type FakeRow = Record<string, any>

function matchesWhere(row: FakeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    return row[key] === value
  })
}

let seededSessions: FakeRow[] = []
let seededEvents: FakeRow[] = []

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
  return seededSessions.find((row) => matchesWhere(row, where)) ?? null
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) =>
    mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CheckoutSession, CheckoutSessionEvent } from '../../data/entities'
import { emitCheckoutEvent } from '../../events'
import { requestApprovalCommand, type CheckoutSessionRequestApprovalCommandInput } from '../approval'

const TENANT_ID = 'tenant-approval-cmd-1'
const ORG_ID = 'org-approval-cmd-1'
const SESSION_ID = 'session-approval-1'
const CART_ID = 'cart-approval-1'

function backingArrayFor(entity: unknown): FakeRow[] {
  return entity === CheckoutSessionEvent ? seededEvents : seededSessions
}

function makeFakeEm() {
  const em: any = {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      backingArrayFor(entity).filter((row) => matchesWhere(row, where))),
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      backingArrayFor(entity).find((row) => matchesWhere(row, where)) ?? null),
    create: jest.fn((_entity: unknown, data: FakeRow) => ({ id: 'event-1', createdAt: new Date(), ...data })),
    persist: jest.fn((row: FakeRow) => {
      seededEvents.push(row)
    }),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, set: FakeRow) => {
      const matched = backingArrayFor(entity).filter((row) => matchesWhere(row, where))
      for (const row of matched) Object.assign(row, set)
      return matched.length
    }),
  }
  return em
}

function seedSession(overrides: FakeRow = {}): FakeRow {
  const row: FakeRow = {
    id: SESSION_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    cartId: CART_ID,
    status: 'open',
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ...overrides,
  }
  seededSessions.push(row)
  return row
}

function makeCtx(
  em: unknown,
  opts: { cartServiceAvailable?: boolean; commandBusExecute?: jest.Mock } = {},
): CommandRuntimeContext {
  const cartServiceAvailable = opts.cartServiceAvailable ?? true
  const commandBusExecute = opts.commandBusExecute
    ?? jest.fn(async () => ({ result: { approvalId: 'approval-1', created: true } }))
  return {
    container: {
      resolve: (token: string): any => {
        if (token === 'em') return em
        if (token === 'cartService') {
          if (!cartServiceAvailable) throw new Error('cartService is not registered')
          return {}
        }
        if (token === 'commandBus') return { execute: commandBusExecute }
        throw new Error(`Unexpected DI token: ${token}`)
      },
      register: jest.fn(),
    } as any,
    auth: null,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
    request: undefined,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  seededSessions = []
  seededEvents = []
})

describe('checkout.session.requestApproval (Step 5.2, C11/§8.2 step 1)', () => {
  it('answers 503 checkout_sessions_unavailable when cart is absent (C10/D-R5-18)', async () => {
    seedSession()
    const em = makeFakeEm()
    const ctx = makeCtx(em, { cartServiceAvailable: false })
    const input: CheckoutSessionRequestApprovalCommandInput = { sessionId: SESSION_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

    await expect(requestApprovalCommand.execute(input, ctx)).rejects.toMatchObject({
      status: 503,
      body: expect.objectContaining({ code: 'checkout_sessions_unavailable' }),
    })
  })

  it('answers 404 when the session does not exist', async () => {
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionRequestApprovalCommandInput = { sessionId: 'missing', tenantId: TENANT_ID, organizationId: ORG_ID }

    await expect(requestApprovalCommand.execute(input, ctx)).rejects.toMatchObject({ status: 404 })
  })

  it('answers 409 session_not_open when the session is submitting/terminal', async () => {
    seedSession({ status: 'submitting' })
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionRequestApprovalCommandInput = { sessionId: SESSION_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

    await expect(requestApprovalCommand.execute(input, ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'session_not_open' }),
    })
  })

  it('delegates to cart.approval.request with the session cart id and scope', async () => {
    seedSession()
    const em = makeFakeEm()
    const commandBusExecute = jest.fn(async () => ({ result: { approvalId: 'approval-1', created: true } }))
    const ctx = makeCtx(em, { commandBusExecute })
    const input: CheckoutSessionRequestApprovalCommandInput = { sessionId: SESSION_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

    await requestApprovalCommand.execute(input, ctx)

    expect(commandBusExecute).toHaveBeenCalledWith('cart.approval.request', expect.objectContaining({
      input: { cartId: CART_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
    }))
  })

  it('propagates a refusal from cart.approval.request unchanged and makes no session-state change', async () => {
    seedSession()
    const em = makeFakeEm()
    const commandBusExecute = jest.fn(async () => {
      const err: any = new Error('[internal] approval_not_required')
      err.status = 409
      err.body = { error: '[internal] approval_not_required', code: 'approval_not_required' }
      throw err
    })
    const ctx = makeCtx(em, { commandBusExecute })
    const input: CheckoutSessionRequestApprovalCommandInput = { sessionId: SESSION_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

    await expect(requestApprovalCommand.execute(input, ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'approval_not_required' }),
    })
    expect(seededSessions[0].status).toBe('open')
  })

  it('moves an open session to awaiting_approval and emits checkout.session.approval_requested', async () => {
    seedSession()
    const em = makeFakeEm()
    const ctx = makeCtx(em)
    const input: CheckoutSessionRequestApprovalCommandInput = { sessionId: SESSION_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

    const result = await requestApprovalCommand.execute(input, ctx)

    expect(result.session.status).toBe('awaiting_approval')
    expect(result.approvalId).toBe('approval-1')
    expect(seededSessions[0].status).toBe('awaiting_approval')
    expect(emitCheckoutEvent).toHaveBeenCalledWith('checkout.session.approval_requested', expect.objectContaining({
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      cartId: CART_ID,
      approvalId: 'approval-1',
    }))
    const eventRows = seededEvents.filter((row) => row.kind === 'approval_state')
    expect(eventRows).toHaveLength(1)
    expect(eventRows[0].payload).toEqual({ approvalId: 'approval-1', outcome: 'requested' })
  })

  it('accepts an idempotent re-request while already awaiting_approval (same-state no-op transition)', async () => {
    seedSession({ status: 'awaiting_approval' })
    const em = makeFakeEm()
    const commandBusExecute = jest.fn(async () => ({ result: { approvalId: 'approval-1', created: false } }))
    const ctx = makeCtx(em, { commandBusExecute })
    const input: CheckoutSessionRequestApprovalCommandInput = { sessionId: SESSION_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

    const result = await requestApprovalCommand.execute(input, ctx)

    expect(result.session.status).toBe('awaiting_approval')
    expect(result.created).toBe(false)
  })
})
