/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { ActionLog } from '../../../audit_logs/data/entities'
import { SalesOrder, SalesOrderLine } from '../../data/entities'
import { deriveHistoryChangedFields } from '../../lib/historyHelpers'
import { DefaultSalesCalculationService, type SalesCalculationService } from '../../services/salesCalculationService'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    translate: (key: string, fallback?: string) => fallback ?? key,
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({ invalidateCrudCache: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  ...jest.requireActual<typeof import('@open-mercato/shared/lib/crud/custom-fields')>('@open-mercato/shared/lib/crud/custom-fields'),
  loadCustomFieldValues: jest.fn(async () => ({})),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (em: TestEntityManager, entity: EntityConstructor, where: Record<string, unknown>, options?: FindOptions) =>
    em.findOne(entity, where, options),
  findWithDecryption: async (em: TestEntityManager, entity: EntityConstructor, where: Record<string, unknown>) =>
    em.find(entity, where),
}))

const ORGANIZATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OTHER_ORDER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const FIRST_LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const SECOND_LINE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const THIRD_LINE_ID = '11111111-1111-4111-8111-111111111111'
const INITIAL_VERSION = '2026-10-05T10:00:00.000Z'

type EntityConstructor = { new(): object; name: string }
type FindOptions = { refresh?: boolean }
type LockPredicate = { column: string; operator: '=' | 'is'; value: string | null }
type LockQuery = {
  select: (column: string) => LockQuery
  where: (column: string, operator: '=' | 'is', value: string | null) => LockQuery
  forNoKeyUpdate: () => LockQuery
  executeTakeFirst: () => Promise<{ id: string } | undefined>
}
type LockQueryRecord = {
  label: string
  table: string
  column: string
  predicates: LockPredicate[]
  noKeyUpdate: boolean
  inTransaction: boolean
}
type Graph = { order: SalesOrder; lines: SalesOrderLine[] }
type LineInput = { body: Record<string, unknown> }
type LineResult = { orderId: string; lineId: string }
type GraphSnapshot = { order: { grandTotalNetAmount: string }; lines: Array<{ id: string; quantity: string }> }
type Deferred = { promise: Promise<void>; resolve: () => void }
type TestWorld = {
  graphs: Map<string, Graph>
  trace: string[]
  heldOrders: Set<string>
  lockTails: Map<string, Promise<void>>
  lockQueries: LockQueryRecord[]
  refreshedHeaders: Array<{ label: string; where: Record<string, unknown>; locked: boolean }>
  events: Array<{ orderId: string; total: number }>
  firstCalculation: Deferred
  releaseFirstCalculation: Deferred
  secondProgress: Deferred
  startedFirstCalculation: boolean
  pauseFirst: boolean
  failFlush: boolean
  deleteBeforeLock: boolean
  version: number
}
type TestEntityManager = {
  fork: () => TestEntityManager
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  isInTransaction: () => boolean
  findOne: (entity: EntityConstructor, where: Record<string, unknown>, options?: FindOptions) => Promise<object | null>
  find: (entity: EntityConstructor, where: Record<string, unknown>) => Promise<object[]>
  count: () => Promise<number>
  create: (entity: EntityConstructor, data: Record<string, unknown>) => object
  persist: (entity: object) => void
  remove: (entity: object) => void
  flush: () => Promise<void>
  clear: () => void
  getKysely: () => { selectFrom: (table: string) => LockQuery }
}

function deferred(): Deferred {
  let complete: () => void = () => undefined
  const promise = new Promise<void>((resolve) => { complete = resolve })
  return { promise, resolve: complete }
}

function seedGraph(orderId: string, amounts: number[]): Graph {
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  const order = Object.assign(new SalesOrder(), {
    id: orderId,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    currencyCode: 'USD',
    deletedAt: null,
    paidTotalAmount: '0',
    refundedTotalAmount: '0',
    grandTotalNetAmount: String(total),
    grandTotalGrossAmount: String(total),
    lineItemCount: amounts.length,
    updatedAt: new Date(INITIAL_VERSION),
  })
  const ids = [FIRST_LINE_ID, SECOND_LINE_ID, THIRD_LINE_ID]
  const lines = amounts.map((amount, index) => Object.assign(new SalesOrderLine(), {
    id: ids[index],
    order,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    lineNumber: index + 1,
    kind: 'product',
    name: `Line ${index + 1}`,
    currencyCode: 'USD',
    quantity: '1',
    normalizedQuantity: '1',
    unitPriceNet: String(amount),
    unitPriceGross: String(amount),
    discountAmount: '0',
    discountPercent: '0',
    taxRate: '0',
    taxAmount: '0',
    totalNetAmount: String(amount),
    totalGrossAmount: String(amount),
    reservedQuantity: '0',
    fulfilledQuantity: '0',
    invoicedQuantity: '0',
    returnedQuantity: '0',
  }))
  return normalizePersistedDecimals({ order, lines })
}

function cloneGraph(graph: Graph): Graph {
  const order = Object.assign(new SalesOrder(), graph.order)
  const lines = graph.lines.map((line) => Object.assign(new SalesOrderLine(), line, { order }))
  return { order, lines }
}

function normalizePersistedDecimals(graph: Graph): Graph {
  const persisted = cloneGraph(graph)
  const lineDecimalFields = [
    'quantity', 'reservedQuantity', 'fulfilledQuantity', 'invoicedQuantity', 'returnedQuantity',
    'unitPriceNet', 'unitPriceGross', 'discountAmount', 'discountPercent', 'taxRate',
    'taxAmount', 'totalNetAmount', 'totalGrossAmount',
  ] as const
  for (const line of persisted.lines) {
    for (const field of lineDecimalFields) line[field] = Number(line[field]).toFixed(4)
    line.normalizedQuantity = Number(line.normalizedQuantity).toFixed(6)
  }
  return persisted
}

function createWorld(amounts: number[] = [10, 20]): TestWorld {
  return {
    graphs: new Map([[ORDER_ID, seedGraph(ORDER_ID, amounts)]]),
    trace: [],
    heldOrders: new Set(),
    lockTails: new Map(),
    lockQueries: [],
    refreshedHeaders: [],
    events: [],
    firstCalculation: deferred(),
    releaseFirstCalculation: deferred(),
    secondProgress: deferred(),
    startedFirstCalculation: false,
    pauseFirst: true,
    failFlush: false,
    deleteBeforeLock: false,
    version: Date.parse(INITIAL_VERSION),
  }
}

function orderIdFromWhere(where: Record<string, unknown>): string {
  const order = where.order
  if (typeof order === 'string') return order
  if (order instanceof SalesOrder) return order.id
  return typeof where.id === 'string' ? where.id : ORDER_ID
}

function createEntityManager(world: TestWorld, label: string): TestEntityManager {
  let active = false
  let graph: Graph | undefined
  let flushedGraph: Graph | undefined
  let releaseLock: (() => void) | undefined
  let flushed = false
  const persistedLines = new Map<string, SalesOrderLine>()
  const createdLineIds = new Set<string>()
  const removedLineIds = new Set<string>()
  const getGraph = (orderId: string): Graph | undefined => {
    if (!graph || graph.order.id !== orderId) {
      const stored = flushedGraph?.order.id === orderId ? flushedGraph : world.graphs.get(orderId)
      graph = stored ? cloneGraph(stored) : undefined
    }
    return graph
  }
  const finish = () => {
    active = false
    releaseLock?.()
    releaseLock = undefined
  }
  const acquireLock = async (orderId: string) => {
    if (!active) throw new Error('[internal] Parent lock requires a transaction')
    world.trace.push(`${label}:lock-request`)
    const previous = world.lockTails.get(orderId) ?? Promise.resolve()
    const next = deferred()
    world.lockTails.set(orderId, previous.then(() => next.promise))
    if (label === 'second' && world.heldOrders.has(orderId)) world.secondProgress.resolve()
    await previous
    world.heldOrders.add(orderId)
    releaseLock = () => { world.heldOrders.delete(orderId); next.resolve() }
    world.trace.push(`${label}:lock-acquired`)
  }
  const em: TestEntityManager = {
    fork: () => createEntityManager(world, label),
    begin: async () => { active = true; world.trace.push(`${label}:begin`) },
    isInTransaction: () => active,
    commit: async () => {
      if (graph) {
        const stored = world.graphs.get(graph.order.id)!
        const lines = new Map(stored.lines.filter((line) => !removedLineIds.has(line.id)).map((line) => [line.id, line]))
        for (const [lineId, line] of persistedLines) {
          if (lines.has(lineId) || createdLineIds.has(lineId)) lines.set(lineId, line)
        }
        world.graphs.set(graph.order.id, normalizePersistedDecimals({ order: graph.order, lines: [...lines.values()] }))
      }
      world.trace.push(`${label}:commit`)
      finish()
    },
    rollback: async () => { world.trace.push(`${label}:rollback`); finish() },
    clear: () => {
      if (!active || !releaseLock) throw new Error('[internal] Audit reload must preserve the active order transaction')
      world.trace.push(`${label}:clear`)
      graph = undefined
    },
    findOne: async (entity, where, options) => {
      if (entity !== SalesOrder) return null
      const orderId = orderIdFromWhere(where)
      if (options?.refresh) {
        world.trace.push(`${label}:header-refresh`)
        world.refreshedHeaders.push({ label, where, locked: Boolean(releaseLock) })
        graph = undefined
      }
      const current = getGraph(orderId)
      if (!current) return null
      if (active) {
        let version = current.order.updatedAt
        Object.defineProperty(current.order, 'updatedAt', {
          enumerable: true,
          configurable: true,
          get: () => { world.trace.push(`${label}:version-read`); return version },
          set: (value: Date) => { version = value },
        })
      }
      return current.order
    },
    getKysely: () => ({
      selectFrom: (table) => {
        const record: LockQueryRecord = {
          label, table, column: '', predicates: [], noKeyUpdate: false, inTransaction: active,
        }
        world.lockQueries.push(record)
        const query: LockQuery = {
          select: (column) => { record.column = column; return query },
          where: (column, operator, value) => { record.predicates.push({ column, operator, value }); return query },
          forNoKeyUpdate: () => { record.noKeyUpdate = true; return query },
          executeTakeFirst: async () => {
            const orderId = record.predicates.find((predicate) => predicate.column === 'id')?.value
            if (!orderId) return undefined
            if (record.noKeyUpdate) await acquireLock(orderId)
            const stored = world.graphs.get(orderId)
            if (!stored) return undefined
            if (world.deleteBeforeLock) stored.order.deletedAt = new Date()
            const columns: Record<string, string | Date | null> = {
              id: stored.order.id,
              tenant_id: stored.order.tenantId,
              organization_id: stored.order.organizationId,
              deleted_at: stored.order.deletedAt ?? null,
            }
            if (!record.predicates.every((predicate) => columns[predicate.column] === predicate.value)) return undefined
            return { id: orderId }
          },
        }
        return query
      },
    }),
    find: async (entity, where) => {
      if (entity !== SalesOrderLine) return []
      const current = getGraph(orderIdFromWhere(where))
      world.trace.push(`${label}:lines-read`)
      if (label === 'second' && !releaseLock && world.startedFirstCalculation) world.secondProgress.resolve()
      return current?.lines ?? []
    },
    count: async () => 0,
    create: (entity, data) => {
      const created = Object.assign(new entity(), data)
      if (created instanceof SalesOrderLine) createdLineIds.add(created.id)
      return created
    },
    persist: (entity) => {
      if (!(entity instanceof SalesOrderLine) || !graph) return
      persistedLines.set(entity.id, entity)
      const existing = graph.lines.findIndex((line) => line.id === entity.id)
      if (existing === -1) graph.lines.push(entity)
      else graph.lines[existing] = entity
    },
    remove: (entity) => {
      if (entity instanceof SalesOrderLine && graph) {
        removedLineIds.add(entity.id)
        graph.lines = graph.lines.filter((line) => line.id !== entity.id)
      }
    },
    flush: async () => {
      if (world.failFlush) throw new Error('[internal] Injected flush failure')
      world.trace.push(`${label}:flush`)
      if (graph && !flushed) {
        graph.order.updatedAt = new Date(++world.version)
        flushed = true
      }
      if (graph) flushedGraph = normalizePersistedDecimals(graph)
    },
  }
  return em
}

function createContext(world: TestWorld, label: string, expectedVersion?: string): CommandRuntimeContext {
  const calculations = new DefaultSalesCalculationService(null)
  const service: SalesCalculationService = {
    calculateLine: (input) => calculations.calculateLine(input),
    calculateDocumentTotals: async (input) => {
      if (label === 'first' && world.pauseFirst) {
        world.startedFirstCalculation = true
        world.firstCalculation.resolve()
        await world.releaseFirstCalculation.promise
      }
      return calculations.calculateDocumentTotals(input)
    },
  }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(createEntityManager(world, label)),
    salesCalculationService: asValue(service),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
    eventBus: asValue({
      emitEvent: async (_event: string, payload: { documentId: string; totals: { grandTotalNetAmount: number } }) => {
        world.trace.push(`${label}:event`)
        world.events.push({ orderId: payload.documentId, total: payload.totals.grandTotalNetAmount })
      },
    }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORGANIZATION_ID, sub: 'user-1' },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/sales/order-lines', {
      method: 'PUT',
      headers: expectedVersion ? { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedVersion } : undefined,
    }),
  }
}

function lineInput(overrides: Record<string, unknown> = {}): LineInput {
  return { body: {
    orderId: ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    currencyCode: 'USD',
    kind: 'product',
    quantity: 1,
    unitPriceNet: 5,
    unitPriceGross: 5,
    taxRate: 0,
    ...overrides,
  } }
}

function handler(command = 'upsert') {
  const registered = commandRegistry.get<LineInput, LineResult>(`sales.orders.lines.${command}`)
  if (!registered) throw new Error('[internal] Line command is not registered')
  return registered
}

async function overlap(world: TestWorld, firstInput: LineInput, secondInput: LineInput, secondCommand = 'upsert', firstCommand = 'upsert') {
  const first = Promise.resolve(handler(firstCommand).execute(firstInput, createContext(world, 'first')))
  await world.firstCalculation.promise
  const second = Promise.resolve(handler(secondCommand).execute(secondInput, createContext(world, 'second')))
  await world.secondProgress.promise
  world.releaseFirstCalculation.resolve()
  return Promise.all([first, second])
}

function expectConsistentGraph(world: TestWorld, expectedTotal: number, expectedCount: number) {
  const current = world.graphs.get(ORDER_ID)!
  expect(current.lines).toHaveLength(expectedCount)
  expect(current.lines.map((line) => line.lineNumber)).toEqual(Array.from({ length: expectedCount }, (_value, index) => index + 1))
  expect(current.order.lineItemCount).toBe(expectedCount)
  expect(Number(current.order.grandTotalNetAmount)).toBe(expectedTotal)
  expect(current.lines.reduce((total, line) => total + Number(line.totalNetAmount), 0)).toBe(expectedTotal)
}

describe('sales order line transaction serialization (#6463)', () => {
  beforeAll(async () => {
    commandRegistry.clear()
    await import('../documents')
  })

  it('keeps both headerless parallel appends and assigns distinct positions', async () => {
    const world = createWorld()
    const [first, second] = await overlap(world, lineInput(), lineInput({ unitPriceNet: 7, unitPriceGross: 7 }))
    expect(first.lineId).not.toBe(second.lineId)
    expectConsistentGraph(world, 42, 4)
    expect(world.trace.indexOf('second:lines-read')).toBeGreaterThan(world.trace.indexOf('first:commit'))
    expect(world.trace.indexOf('first:event')).toBeGreaterThan(world.trace.indexOf('first:commit'))
    expect(world.trace.indexOf('second:event')).toBeGreaterThan(world.trace.indexOf('second:commit'))
  })

  it('preserves edits to different existing lines', async () => {
    const world = createWorld()
    await overlap(world, lineInput({ id: FIRST_LINE_ID, quantity: 2, unitPriceNet: 10, unitPriceGross: 10 }),
      lineInput({ id: SECOND_LINE_ID, quantity: 3, unitPriceNet: 20, unitPriceGross: 20 }))
    expectConsistentGraph(world, 80, 2)
    expect(world.graphs.get(ORDER_ID)!.lines.map((line) => Number(line.quantity))).toEqual([2, 3])
  })

  it('calculates a parallel delete from the committed edit', async () => {
    const world = createWorld([10, 20, 30])
    await overlap(world, lineInput({ id: FIRST_LINE_ID, quantity: 2, unitPriceNet: 10, unitPriceGross: 10 }),
      lineInput({ id: SECOND_LINE_ID }), 'delete')
    expectConsistentGraph(world, 50, 2)
    expect(world.graphs.get(ORDER_ID)!.lines.map((line) => line.id)).toEqual([FIRST_LINE_ID, THIRD_LINE_ID])
  })

  it('keeps the totals and positions consistent when different lines are deleted in parallel', async () => {
    const world = createWorld([10, 20, 30])
    await overlap(world, lineInput({ id: FIRST_LINE_ID }), lineInput({ id: SECOND_LINE_ID }), 'delete', 'delete')
    expectConsistentGraph(world, 30, 1)
    expect(world.graphs.get(ORDER_ID)!.lines.map((line) => line.id)).toEqual([THIRD_LINE_ID])
  })

  it('rejects a waiting delete that would remove the last remaining line', async () => {
    const world = createWorld()
    await expect(overlap(world, lineInput({ id: FIRST_LINE_ID }), lineInput({ id: SECOND_LINE_ID }), 'delete', 'delete'))
      .rejects.toMatchObject({ status: 409 })
    expectConsistentGraph(world, 20, 1)
    expect(world.events).toHaveLength(1)
    expect(world.trace).toContain('second:rollback')
  })

  it('takes a scoped transaction-bound no-key-update lock before refreshing the version or reading lines', async () => {
    const world = createWorld()
    world.pauseFirst = false
    await handler().execute(lineInput(), createContext(world, 'first', INITIAL_VERSION))
    const lockedAt = world.trace.indexOf('first:lock-acquired')
    expect(lockedAt).toBeGreaterThan(world.trace.indexOf('first:begin'))
    expect(world.trace.indexOf('first:version-read')).toBeGreaterThan(lockedAt)
    expect(world.trace.indexOf('first:lines-read')).toBeGreaterThan(lockedAt)
    expect(world.trace.indexOf('first:header-refresh')).toBeGreaterThan(lockedAt)
    expect(world.lockQueries).toEqual([{
      label: 'first', table: 'sales_orders', column: 'id', noKeyUpdate: true, inTransaction: true,
      predicates: [
        { column: 'id', operator: '=', value: ORDER_ID },
        { column: 'tenant_id', operator: '=', value: TENANT_ID },
        { column: 'organization_id', operator: '=', value: ORGANIZATION_ID },
        { column: 'deleted_at', operator: 'is', value: null },
      ],
    }])
    expect(world.refreshedHeaders).toEqual([{
      label: 'first', locked: true,
      where: { id: ORDER_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null },
    }])
  })

  it('stops when the initially visible order is deleted before the scoped lock query', async () => {
    const world = createWorld()
    world.pauseFirst = false
    world.deleteBeforeLock = true
    await expect(handler().execute(lineInput(), createContext(world, 'first'))).rejects.toMatchObject({ status: 404 })
    expect(world.trace).not.toContain('first:lines-read')
    expect(world.trace).not.toContain('first:flush')
    expect(world.trace).toContain('first:rollback')
    expect(world.events).toEqual([])
  })

  it('rechecks a waiting request against the committed parent version', async () => {
    const world = createWorld()
    const first = Promise.resolve(handler().execute(lineInput(), createContext(world, 'first', INITIAL_VERSION)))
    await world.firstCalculation.promise
    const second = Promise.resolve(handler().execute(lineInput(), createContext(world, 'second', INITIAL_VERSION)))
    const settledSecond = second.then(() => null, (error: unknown) => error)
    await world.secondProgress.promise
    world.releaseFirstCalculation.resolve()
    await first
    const error = await settledSecond
    expect(isCrudHttpError(error)).toBe(true)
    if (isCrudHttpError(error)) expect(error.status).toBe(409)
    expectConsistentGraph(world, 35, 3)
    expect(world.events).toHaveLength(1)
  })

  it('does not block a different order while the first order is calculating', async () => {
    const world = createWorld()
    world.graphs.set(OTHER_ORDER_ID, seedGraph(OTHER_ORDER_ID, [3]))
    const first = Promise.resolve(handler().execute(lineInput(), createContext(world, 'first')))
    await world.firstCalculation.promise
    await handler().execute(lineInput({ orderId: OTHER_ORDER_ID }), createContext(world, 'other'))
    expect(world.trace).not.toContain('first:commit')
    expect(Number(world.graphs.get(OTHER_ORDER_ID)!.order.grandTotalNetAmount)).toBe(8)
    world.releaseFirstCalculation.resolve()
    await first
  })

  it.each(['upsert', 'delete'])('rolls back %s and emits no totals event when persistence fails', async (command) => {
    const world = createWorld()
    world.pauseFirst = false
    world.failFlush = true
    await expect(handler(command).execute(lineInput({ id: FIRST_LINE_ID }), createContext(world, 'first')))
      .rejects.toThrow('Injected flush failure')
    expectConsistentGraph(world, 30, 2)
    expect(world.trace).toContain('first:rollback')
    expect(world.heldOrders.size).toBe(0)
    expect(world.events).toEqual([])
  })

  it('keeps each command audit graph at its own locked boundary', async () => {
    const world = createWorld()
    const firstInput = lineInput()
    const secondInput = lineInput({ unitPriceNet: 7, unitPriceGross: 7 })
    const firstContext = createContext(world, 'first')
    const secondContext = createContext(world, 'second')
    const command = handler()
    const firstPrepared = await command.prepare?.(firstInput, firstContext)
    const secondPrepared = await command.prepare?.(secondInput, secondContext)
    const firstExecution = Promise.resolve(command.execute(firstInput, firstContext))
    await world.firstCalculation.promise
    const secondExecution = Promise.resolve(command.execute(secondInput, secondContext))
    await world.secondProgress.promise
    world.releaseFirstCalculation.resolve()
    const [firstResult, secondResult] = await Promise.all([firstExecution, secondExecution])
    const firstAfter = await command.captureAfter?.(firstInput, firstResult, firstContext)
    const secondAfter = await command.captureAfter?.(secondInput, secondResult, secondContext)
    const firstLog = await command.buildLog?.({ input: firstInput, result: firstResult, ctx: firstContext,
      snapshots: { ...firstPrepared, after: firstAfter } })
    const secondLog = await command.buildLog?.({ input: secondInput, result: secondResult, ctx: secondContext,
      snapshots: { ...secondPrepared, after: secondAfter } })
    const firstBeforeSnapshot = firstLog?.snapshotBefore as GraphSnapshot
    const firstAfterSnapshot = firstLog?.snapshotAfter as GraphSnapshot
    const secondBeforeSnapshot = secondLog?.snapshotBefore as GraphSnapshot
    const secondAfterSnapshot = secondLog?.snapshotAfter as GraphSnapshot
    expect(firstBeforeSnapshot.lines).toHaveLength(2)
    expect(firstAfterSnapshot.lines).toHaveLength(3)
    expect(secondBeforeSnapshot.lines).toHaveLength(3)
    expect(secondAfterSnapshot.lines).toHaveLength(4)
    expect(secondBeforeSnapshot.lines.map((line) => line.id)).toContain(firstResult.lineId)
    expect(firstAfterSnapshot.lines.map((line) => line.id)).not.toContain(secondResult.lineId)
    expect(Object.keys(firstResult).sort()).toEqual(['lineId', 'orderId'])
    expect(Object.keys(secondResult).sort()).toEqual(['lineId', 'orderId'])
    expect(firstLog?.payload).toEqual({ undo: { before: firstBeforeSnapshot, after: firstAfterSnapshot } })
    expect(secondLog?.payload).toEqual({ undo: { before: secondBeforeSnapshot, after: secondAfterSnapshot } })
  })

  it('reports only quantity when managed decimals normalize to fixed-scale persisted values', async () => {
    const world = createWorld()
    world.pauseFirst = false
    const input: LineInput = { body: {
      id: FIRST_LINE_ID,
      orderId: ORDER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      currencyCode: 'USD',
      quantity: 2,
    } }
    const ctx = createContext(world, 'first')
    const command = handler()
    const prepared = await command.prepare?.(input, ctx)
    const result = await command.execute(input, ctx)
    const after = await command.captureAfter?.(input, result, ctx)
    const log = await command.buildLog?.({ input, result, ctx, snapshots: { ...prepared, after } })
    const actionLog = Object.assign(new ActionLog(), log, { commandId: command.id })

    expectConsistentGraph(world, 40, 2)
    expect(deriveHistoryChangedFields(actionLog)).toEqual(['quantity'])
    expect(world.trace.indexOf('first:clear')).toBeGreaterThan(world.trace.indexOf('first:flush'))
    expect(world.trace.indexOf('first:commit')).toBeGreaterThan(world.trace.indexOf('first:clear'))
  })
})
