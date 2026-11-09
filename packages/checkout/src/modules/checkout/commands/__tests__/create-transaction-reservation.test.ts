/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'

import '../transactions'

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

const { emitCheckoutEvent } = jest.requireMock('../../events') as {
  emitCheckoutEvent: jest.Mock
}

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const LINK_ID = '123e4567-e89b-12d3-a456-426614174010'
const TX_ID = '123e4567-e89b-12d3-a456-426614174020'

type ReservedRow = { id?: string; active_reservation_count: number }

function makeMockEm(options: { isLocked?: boolean; reserved?: ReservedRow[] } = {}) {
  const reserved = options.reserved ?? [{ id: LINK_ID, active_reservation_count: 1 }]
  const link = {
    id: LINK_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    slug: 'test-link',
    templateId: null,
    gatewayProviderKey: 'stripe',
    status: 'active',
    isLocked: options.isLocked ?? false,
    deletedAt: null,
  }
  const poolExecute = jest.fn(async () => reserved)
  const tx = {
    findOne: jest.fn(async () => link),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: TX_ID, ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
    execute: jest.fn(async () => reserved),
    getConnection: jest.fn(() => ({ execute: poolExecute })),
  }
  const em = {
    transactional: jest.fn(async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  return { em, tx, poolExecute }
}

function makeContext(em: unknown): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string) => (token === 'em' ? em : null),
    } as unknown as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
}

async function runCreate(em: unknown) {
  const handler = commandRegistry.get('checkout.transaction.create')
  if (!handler) throw new Error('checkout.transaction.create not registered')
  return handler.execute({
    linkId: LINK_ID,
    amount: 49.99,
    currencyCode: 'USD',
    idempotencyKey: 'idempotency-key-0001',
    customerData: {},
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
  }, makeContext(em))
}

function reservationCalls(mock: jest.Mock) {
  return mock.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('UPDATE checkout_links'))
}

describe('createTransactionCommand — usage slot reservation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reserves the slot through the transaction, after inserting the transaction row', async () => {
    const { em, tx, poolExecute } = makeMockEm()

    await runCreate(em)

    expect(reservationCalls(poolExecute)).toHaveLength(0)
    const calls = reservationCalls(tx.execute)
    expect(calls).toHaveLength(1)
    const [sql, params] = calls[0] as [string, unknown[]]
    expect(sql).toMatch(/active_reservation_count = active_reservation_count \+ 1/)
    expect(sql).toMatch(/completion_count \+ active_reservation_count < max_completions/)
    expect(params).toEqual([LINK_ID, ORG_ID, TENANT_ID])
    expect(tx.flush.mock.invocationCallOrder[0]).toBeLessThan(tx.execute.mock.invocationCallOrder[0])
  })

  it('rejects with 422 and emits nothing when no slot is left', async () => {
    const { em } = makeMockEm({ reserved: [] })

    await expect(runCreate(em)).rejects.toMatchObject({ status: 422 })
    expect(emitCheckoutEvent).not.toHaveBeenCalled()
  })

  it('emits checkout.link.locked when this reservation takes the link from zero to one', async () => {
    const { em } = makeMockEm({ isLocked: false, reserved: [{ id: LINK_ID, active_reservation_count: 1 }] })

    await runCreate(em)

    expect(emitCheckoutEvent).toHaveBeenCalledWith('checkout.link.locked', expect.objectContaining({ id: LINK_ID }))
  })

  it('does not emit checkout.link.locked when another reservation already holds the link', async () => {
    const { em } = makeMockEm({ isLocked: false, reserved: [{ id: LINK_ID, active_reservation_count: 2 }] })

    await runCreate(em)

    expect(emitCheckoutEvent).not.toHaveBeenCalledWith('checkout.link.locked', expect.any(Object))
    expect(emitCheckoutEvent).toHaveBeenCalledWith('checkout.transaction.created', expect.any(Object))
  })
})
