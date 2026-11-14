/** @jest-environment node */

const emittedEvents: Array<{ id: string; payload: Record<string, unknown> }> = []

jest.mock('../../events', () => ({
  emitAvailabilityEvent: async (id: string, payload: Record<string, unknown>) => {
    emittedEvents.push({ id, payload })
  },
}))

import { commitAvailability } from '../reservationCommands'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PRODUCT = '88888888-8888-4888-8888-888888888888'
const VARIANT = '77777777-7777-4777-8777-777777777777'

type WmsRow = { id: string; tenantId: string; organizationId: string; sourceType: string; sourceId: string; status: string }

function buildEnvironment(wmsRows: WmsRow[]) {
  const hold: Record<string, unknown> = {
    id: 'hold-1',
    tenantId: TENANT,
    organizationId: ORG,
    idempotencyKey: 'key-1',
    sourceType: 'checkout',
    sourceId: 'session-1',
    status: 'active',
    orderId: null,
    items: [{ catalogProductId: PRODUCT, catalogVariantId: VARIANT, requested: 2, outcome: 'held', heldQuantity: 2, backorderQuantity: 0 }],
    wmsReservationIds: wmsRows.map((row) => row.id),
  }
  const em: Record<string, unknown> = {
    fork: () => em,
    findOne: async () => hold,
    nativeUpdate: async (_entity: unknown, where: Record<string, unknown>, set: Record<string, unknown>) => {
      if (hold.status !== where.status) return 0
      Object.assign(hold, set)
      return 1
    },
    transactional: async (cb: (trx: unknown) => Promise<unknown>) => {
      const before = { ...hold }
      const rowsBefore = wmsRows.map((row) => ({ ...row }))
      try {
        return await cb(em)
      } catch (error) {
        Object.assign(hold, before)
        wmsRows.forEach((row, index) => Object.assign(row, rowsBefore[index]))
        throw error
      }
    },
  }
  const calls = { converted: [] as string[], released: [] as string[], gate: [] as unknown[] }
  const wms = {
    async convertInTransaction(_trx: unknown, _ctx: unknown, input: { reservationId: string; sourceId: string; expectedSourceId?: string }) {
      const row = wmsRows.find((candidate) => candidate.id === input.reservationId)!
      if (row.status !== 'active' || row.sourceType !== 'checkout' || row.sourceId !== input.expectedSourceId) {
        return { reservationId: row.id, reservationEntity: row, outcome: 'not_convertible', touchedBalances: [] }
      }
      row.sourceType = 'order'
      row.sourceId = input.sourceId
      calls.converted.push(row.id)
      return { reservationId: row.id, reservationEntity: row, outcome: 'converted', touchedBalances: [] }
    },
    async releaseInTransaction(_trx: unknown, _ctx: unknown, input: { reservationId: string }) {
      const row = wmsRows.find((candidate) => candidate.id === input.reservationId)!
      row.status = 'released'
      calls.released.push(row.id)
      return { reservationEntity: row, touchedBalances: [] }
    },
    async findReservationsByIds() {
      return wmsRows.map((row) => ({ ...row }))
    },
    async reserveLinesForCheckout(_trx: unknown, _ctx: unknown, input: { lines: Array<{ key: string; quantity: number }> }) {
      calls.gate.push(input)
      return { ok: true, lines: [], sideEffects: {} }
    },
    async emitSideEffects() {},
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'wmsReservationService') return wms
      throw new Error(`unexpected resolve(${name})`)
    },
  }
  return { hold, container, calls }
}

beforeEach(() => {
  emittedEvents.length = 0
})

describe('commitAvailability row ownership', () => {
  it('converts only active checkout rows owned by the hold', async () => {
    const rows: WmsRow[] = [
      { id: 'w1', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', sourceId: 'session-1', status: 'active' },
    ]
    const { container, calls, hold } = buildEnvironment(rows)

    const result = await commitAvailability(container as never, {
      tenantId: TENANT,
      organizationId: ORG,
      idempotencyKey: 'key-1',
      orderId: ORDER_ID,
    })

    expect(result.status).toBe('committed')
    expect(calls.converted).toEqual(['w1'])
    expect(calls.gate).toHaveLength(0)
    expect(hold.status).toBe('committed')
  })

  it('rolls back and re-reserves through the gate when a row was released, never relabeling it as an order row', async () => {
    const rows: WmsRow[] = [
      { id: 'w1', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', sourceId: 'session-1', status: 'active' },
      { id: 'w2', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', sourceId: 'session-1', status: 'released' },
    ]
    const { container, calls } = buildEnvironment(rows)

    const result = await commitAvailability(container as never, {
      tenantId: TENANT,
      organizationId: ORG,
      idempotencyKey: 'key-1',
      orderId: ORDER_ID,
    })

    expect(result.status).toBe('recovered')
    expect(rows.find((row) => row.id === 'w2')!.sourceType).toBe('checkout')
    expect(rows.find((row) => row.id === 'w1')!.sourceType).toBe('checkout')
    expect(calls.released).toEqual(['w1'])
    expect(calls.gate).toHaveLength(1)
    expect(calls.gate[0]).toMatchObject({ sourceType: 'order', sourceId: ORDER_ID })
  })

  it('reports stock_lost when the fresh gated reserve cannot cover the order', async () => {
    const rows: WmsRow[] = [
      { id: 'w1', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', sourceId: 'other-session', status: 'active' },
    ]
    const { container, calls } = buildEnvironment(rows)
    const original = container.resolve('wmsReservationService') as { reserveLinesForCheckout: unknown }
    original.reserveLinesForCheckout = async (_t: unknown, _c: unknown, input: { lines: Array<{ key: string; quantity: number }> }) => ({
      ok: false,
      lines: input.lines.map((line) => ({ key: line.key, requested: line.quantity, sellable: 0 })),
    })

    const result = await commitAvailability(container as never, {
      tenantId: TENANT,
      organizationId: ORG,
      idempotencyKey: 'key-1',
      orderId: ORDER_ID,
    })

    expect(result.status).toBe('stock_lost')
    expect(calls.converted).toEqual([])
    expect(calls.released).toEqual([])
    expect(emittedEvents.some((event) => event.id === 'availability.shortfall.detected')).toBe(true)
  })

  it('keeps intact checkout holds active when the recovery re-gate fails', async () => {
    const rows: WmsRow[] = [
      { id: 'w1', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', sourceId: 'session-1', status: 'active' },
      { id: 'w2', tenantId: TENANT, organizationId: ORG, sourceType: 'checkout', sourceId: 'session-1', status: 'released' },
    ]
    const { container, calls, hold } = buildEnvironment(rows)
    const wms = container.resolve('wmsReservationService') as { reserveLinesForCheckout: unknown }
    wms.reserveLinesForCheckout = async (_t: unknown, _c: unknown, input: { lines: Array<{ key: string; quantity: number }> }) => ({
      ok: false,
      lines: input.lines.map((line) => ({ key: line.key, requested: line.quantity, sellable: 0 })),
    })

    const result = await commitAvailability(container as never, {
      tenantId: TENANT,
      organizationId: ORG,
      idempotencyKey: 'key-1',
      orderId: ORDER_ID,
    })

    expect(result.status).toBe('stock_lost')
    expect(calls.released).toEqual(['w1'])
    expect(rows.find((row) => row.id === 'w1')!.status).toBe('active')
    expect(hold.status).toBe('active')
  })
})
