import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { SalesOrder, SalesOrderLine, SalesShipment, SalesShipmentItem } from '../../data/entities'
import { createSalesDocumentWorkflowPolicy } from '../../lib/documentWorkflowPolicy'
import { createSalesDocumentLockKyselyFixture } from './salesDocumentLockFixture'
import { LockMode } from '@mikro-orm/core'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key, t: (key: string) => key }),
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({ invalidateCrudCache: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({ loadCustomFieldValues: jest.fn(async () => ({})) }))
jest.mock('../../lib/dictionaries', () => ({ resolveDictionaryEntryValue: jest.fn(async () => null) }))
jest.mock('../../services/salesDocumentNumberGenerator', () => ({
  SalesDocumentNumberGenerator: class { async generate() { return { number: 'DOC-TEST-1' } } },
}))

const TENANT = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LINE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SHIPMENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const previousFlag = process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS

function harness(status = 'draft', shipmentStatus = 'shipped', returnedQuantity = '0') {
  const order = { id: ORDER, tenantId: TENANT, organizationId: ORG, status, currencyCode: 'USD', updatedAt: new Date() }
  const line = { id: LINE, quantity: '2', returnedQuantity, totalNetAmount: '20', totalGrossAmount: '24', unitPriceNet: '10', unitPriceGross: '12' }
  const created: Array<Record<string, unknown>> = []
  const transactionStates: string[] = []
  let transactionDepth = 0
  const manager = {
    fork: (): object => manager,
    transactional: jest.fn(async <T,>(operation: (transaction: object) => Promise<T>): Promise<T> => {
      transactionStates.push('begin')
      transactionDepth += 1
      try {
        const result = await operation(manager)
        transactionStates.push('commit')
        return result
      } catch (error) {
        transactionStates.push('rollback')
        throw error
      } finally {
        transactionDepth -= 1
      }
    }),
    isInTransaction: () => transactionDepth > 0,
    begin: async () => { transactionDepth += 1 },
    commit: async () => { transactionDepth -= 1 },
    rollback: async () => { transactionDepth -= 1 },
    getKysely: () => createSalesDocumentLockKyselyFixture(ORDER),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
    getReference: (_entity: unknown, id: string) => ({ id }),
    getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return data
    }),
  }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity) => entity === SalesOrder ? order as never : null)
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity) => {
    if (entity === SalesOrderLine) return [line] as never
    if (entity === SalesShipment) return [{ id: SHIPMENT, status: shipmentStatus }] as never
    if (entity === SalesShipmentItem) return [{ shipment: SHIPMENT, orderLine: LINE, quantity: '2' }] as never
    return []
  })
  const resolve = jest.fn((name: string): unknown => {
    if (name === 'em') return manager
    if (name === 'salesDocumentWorkflowPolicy') return createSalesDocumentWorkflowPolicy()
    if (name === 'salesCalculationService') return { calculateDocumentTotals: jest.fn(async () => ({ totals: {}, lines: [] })) }
    if (name === 'salesDocumentNumberGenerator') return { generate: async () => ({ number: 'INV-TEST-1' }) }
    return {}
  })
  const ctx = {
    container: { resolve }, auth: { tenantId: TENANT, orgId: ORG, sub: TENANT },
    selectedOrganizationId: ORG, organizationIds: [ORG], organizationScope: null,
    request: new Request('https://example.test/api/sales/returns', { method: 'POST' }),
  } as unknown as CommandRuntimeContext
  return { ctx, manager, created, transactionStates, order }
}

function execute(command: string, ctx: CommandRuntimeContext, extra: Record<string, unknown> = {}) {
  return commandRegistry.get(command)!.execute({
    tenantId: TENANT, organizationId: ORG, orderId: ORDER,
    invoiceNumber: 'INV-TEST-1', currencyCode: 'USD',
    items: [{ orderLineId: LINE, quantity: 1 }], lines: [{ orderLineId: LINE, quantity: 1, currencyCode: 'USD' }], ...extra,
  }, ctx)
}

beforeAll(async () => {
  await import('../documents')
  await import('../returns')
  await import('../shipments')
})
beforeEach(() => {
  process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS = 'on'
  jest.clearAllMocks()
})
afterEach(() => {
  if (previousFlag === undefined) delete process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS
  else process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS = previousFlag
})

it.each(['sales.returns.create', 'sales.shipments.create', 'sales.invoices.create'])('rejects %s on a draft with no created document or event', async (command) => {
  const world = harness()
  await expect(execute(command, world.ctx)).rejects.toMatchObject({ status: 409, body: { code: 'sales_document_workflow_restricted' } })
  expect(world.created).toHaveLength(0)
  expect(emitCrudSideEffects).not.toHaveBeenCalled()
  expect(world.transactionStates).toContain('rollback')
})

it.each(['pending', 'canceled'])('refuses a new return against only %s shipments', async (status) => {
  const world = harness('confirmed', status)
  await expect(execute('sales.returns.create', world.ctx)).rejects.toMatchObject({ status: 400 })
  expect(world.created).toHaveLength(0)
})

it('accepts a return against a confirmed order and shipped quantity', async () => {
  const world = harness('confirmed')
  await expect(execute('sales.returns.create', world.ctx)).resolves.toMatchObject({ returnId: expect.any(String) })
})

it('locks the parent and commits an eligible linked invoice before emitting its event', async () => {
  const world = harness('confirmed')
  jest.mocked(emitCrudSideEffects).mockImplementationOnce(async () => {
    expect(world.transactionStates.at(-1)).toBe('commit')
  })
  await expect(execute('sales.invoices.create', world.ctx, { lines: [] })).resolves.toMatchObject({ invoiceId: expect.any(String) })
  expect(findOneWithDecryption).toHaveBeenCalledWith(
    world.manager, SalesOrder, expect.objectContaining({ id: ORDER, tenantId: TENANT, organizationId: ORG }),
    { lockMode: LockMode.PESSIMISTIC_WRITE }, { tenantId: TENANT, organizationId: ORG },
  )
})

it('keeps standalone invoices available when enforcement is enabled', async () => {
  const world = harness()
  await expect(execute('sales.invoices.create', world.ctx, { orderId: undefined, lines: [] })).resolves.toMatchObject({ invoiceId: expect.any(String) })
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})

it('preserves draft-linked invoice creation when enforcement is disabled', async () => {
  process.env.OM_SALES_DOCUMENT_WORKFLOW_GUARDS = 'off'
  const world = harness()
  await expect(execute('sales.invoices.create', world.ctx, { lines: [] })).resolves.toMatchObject({ invoiceId: expect.any(String) })
  expect(world.ctx.container.resolve).not.toHaveBeenCalledWith('salesDocumentWorkflowPolicy')
})

it('refuses a shipment when every positive line has already been fully returned', async () => {
  const world = harness('confirmed')
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity) => {
    if (entity === SalesOrderLine) return [{ id: LINE, quantity: '2', returnedQuantity: '2' }] as never
    return []
  })
  await expect(execute('sales.shipments.create', world.ctx)).rejects.toMatchObject({
    status: 409, body: { code: 'sales_document_workflow_restricted', action: 'shipment' },
  })
  expect(world.created).toHaveLength(0)
})

it('ignores deleted unreturned lines when the active order is fully returned', async () => {
  const world = harness('confirmed')
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity) => {
    if (entity === SalesOrderLine) return [
      { id: LINE, quantity: '2', returnedQuantity: '2', deletedAt: null },
      { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', quantity: '1', returnedQuantity: '0', deletedAt: new Date() },
    ] as never
    return []
  })
  await expect(execute('sales.shipments.create', world.ctx)).rejects.toMatchObject({
    status: 409, body: { code: 'sales_document_workflow_restricted', action: 'shipment' },
  })
  expect(world.created).toHaveLength(0)
})


function deferredSignal() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

function contenderLock() {
  let held = false
  const waiters: Array<(release: () => void) => void> = []
  const release = () => {
    const next = waiters.shift()
    if (next) next(release)
    else held = false
  }
  return {
    acquire: () => new Promise<() => void>((resolve) => {
      if (held) waiters.push(resolve)
      else { held = true; resolve(release) }
    }),
  }
}

it.each(['sales.invoices.create', 'sales.shipments.create'])(
  '%s waits for a competing status commit and refuses deterministically on retry',
  async (command) => {
    const world = harness('confirmed')
    const lock = contenderLock()
    const releaseStatusTransition = await lock.acquire()
    const documentWaiting = deferredSignal()
    let committedStatus = 'confirmed'
    let releaseDocument: (() => void) | null = null
    const acquireDocument = async () => {
      documentWaiting.resolve()
      releaseDocument = await lock.acquire()
    }
    const transaction = world.manager.transactional.getMockImplementation()!
    world.manager.transactional.mockImplementation(async (operation) => {
      try { return await transaction(operation) }
      finally { releaseDocument?.(); releaseDocument = null }
    })
    jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity, _query, options) => {
      if (entity !== SalesOrder) return null
      if (command === 'sales.invoices.create' && options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
        await acquireDocument()
      }
      return { ...world.order, status: committedStatus } as never
    })
    if (command === 'sales.shipments.create') {
      const kysely = createSalesDocumentLockKyselyFixture(ORDER)
      const query = kysely.selectFrom()
      query.executeTakeFirst = async () => { await acquireDocument(); return { id: ORDER } }
      world.manager.getKysely = () => kysely
      jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity) => {
        if (entity === SalesOrderLine) return [{ id: LINE, quantity: '2', returnedQuantity: '0' }] as never
        return []
      })
    }
    const creation = execute(command, world.ctx, { lines: [] }).then(
      (value) => ({ kind: 'created', value }),
      (error: unknown) => ({ kind: 'rejected', error }),
    )
    const first = await Promise.race([
      documentWaiting.promise.then(() => 'waiting'),
      creation.then((result) => result.kind),
    ])
    committedStatus = 'draft'
    releaseStatusTransition()
    const outcome = await creation
    expect(first).toBe('waiting')
    expect(outcome).toMatchObject({ kind: 'rejected', error: { status: 409, body: { code: 'sales_document_workflow_restricted' } } })
    await expect(execute(command, world.ctx, { lines: [] })).rejects.toMatchObject({
      status: 409, body: { code: 'sales_document_workflow_restricted' },
    })
    expect(world.created).toHaveLength(0)
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
    expect(world.transactionStates.filter((state) => state === 'rollback')).toHaveLength(2)
  },
  5000,
)
