import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '44444444-4444-4444-8444-444444444444'
const LINE_ID = '55555555-5555-4555-8555-555555555555'
const LINE_NO_ORDER_ID = '66666666-6666-4666-8666-666666666666'
const USER_ID = '77777777-7777-4777-8777-777777777777'
const ORDER_ID = '99999999-9999-4999-8999-999999999999'
const ORDER_LINE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CREATED_RETURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FRACTIONAL_LINE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const RETURN_UPDATED_AT = '2026-07-16T10:00:00.000Z'

let mockClaims: Array<Record<string, unknown>> = []
let mockLines: Array<Record<string, unknown>> = []
let mockEvents: Array<Record<string, unknown>> = []
let mockReturnRow: Record<string, unknown> | null = null

const enforceWithGuardsMock = jest.fn(async () => undefined)
const commandBusExecuteMock = jest.fn<Promise<{ result: unknown }>, [string, { input: Record<string, unknown>; ctx: CommandRuntimeContext }]>()

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (...args: unknown[]) => enforceWithGuardsMock(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) {
      await phase()
    }
  },
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(async () => undefined),
}))

jest.mock('../events', () => ({
  emitWarrantyClaimsEvent: jest.fn(async () => undefined),
}))

function entityName(entity: unknown): string {
  return typeof entity === 'function' && 'name' in entity ? String(entity.name) : ''
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function matchesWhere(record: Record<string, unknown>, where: unknown): boolean {
  const filters = asRecord(where)
  for (const [key, expected] of Object.entries(filters)) {
    const actual = key === 'claim' ? (typeof record.claim === 'string' ? record.claim : asRecord(record.claim).id) : record[key]
    if (key === 'deletedAt' && expected === null) {
      if (record.deletedAt !== null && record.deletedAt !== undefined) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (_em: unknown, entity: unknown, where: unknown) => {
    const name = entityName(entity)
    if (name === 'WarrantyClaim') return mockClaims.find((claim) => matchesWhere(claim, where)) ?? null
    if (name === 'WarrantyClaimLine') return mockLines.find((line) => matchesWhere(line, where)) ?? null
    return null
  },
  findWithDecryption: async (_em: unknown, entity: unknown, where: unknown) => {
    const name = entityName(entity)
    if (name === 'WarrantyClaim') return mockClaims.filter((claim) => matchesWhere(claim, where))
    if (name === 'WarrantyClaimLine') return mockLines.filter((line) => matchesWhere(line, where))
    return []
  },
}))

import { createSalesReturnCommand } from '../commands/claims'

function makeKysely() {
  return {
    selectFrom: (table: string) => {
      const wheres: Array<[string, string, unknown]> = []
      const builder = {
        select: () => builder,
        where: (column: string, op: string, value: unknown) => {
          wheres.push([column, op, value])
          return builder
        },
        limit: () => builder,
        execute: async () => {
          if (table === 'sales_returns' && mockReturnRow) return [mockReturnRow]
          return []
        },
        executeTakeFirst: async () => {
          if (table !== 'sales_returns') return undefined
          const idWhere = wheres.find(([column]) => column === 'id')
          if (mockReturnRow && idWhere && idWhere[2] === mockReturnRow.id) return mockReturnRow
          return undefined
        },
      }
      return builder
    },
  }
}

function makeFork(): EntityManager {
  const fork = {
    create: (_entity: unknown, data: Record<string, unknown>) => data,
    persist: (entity: unknown) => {
      const record = asRecord(entity)
      if ('kind' in record && 'visibility' in record) mockEvents.push(record)
    },
    flush: jest.fn(async () => undefined),
    transactional: async (fn: (tx: EntityManager) => Promise<unknown>) => fn(fork as unknown as EntityManager),
    getKysely: () => makeKysely(),
    fork: () => fork,
  }
  return fork as unknown as EntityManager
}

function makeCtx(): CommandRuntimeContext {
  const fork = makeFork()
  return {
    container: {
      resolve: (key: string) => {
        if (key === 'em') return { fork: () => fork }
        if (key === 'commandBus') return { execute: commandBusExecuteMock }
        if (key === 'dataEngine') return { markOrmEntityChange: jest.fn() }
        throw new Error(`[internal] unregistered test dependency ${key}`)
      },
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: true, sub: USER_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: new Request('http://localhost/api/warranty_claims/sales-return', { method: 'POST' }),
  } as unknown as CommandRuntimeContext
}

function seedClaim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const claim = {
    id: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    claimNumber: 'WTY-000123',
    claimType: 'warranty',
    status: 'approved',
    channel: 'staff',
    priority: 'normal',
    orderId: ORDER_ID,
    salesReturnId: null,
    advanceReplacement: false,
    updatedAt: new Date('2026-07-16T09:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
  mockClaims.push(claim)
  return claim
}

function seedLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const line = {
    id: LINE_ID,
    claim: CLAIM_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    lineNo: 1,
    lineStatus: 'approved',
    orderLineId: ORDER_LINE_ID,
    qtyClaimed: '2.0000',
    qtyApproved: '1.0000',
    deletedAt: null,
    ...overrides,
  }
  mockLines.push(line)
  return line
}

beforeEach(() => {
  mockClaims = []
  mockLines = []
  mockEvents = []
  mockReturnRow = { id: CREATED_RETURN_ID, updated_at: RETURN_UPDATED_AT }
  enforceWithGuardsMock.mockClear()
  commandBusExecuteMock.mockReset()
  commandBusExecuteMock.mockResolvedValue({ result: { returnId: CREATED_RETURN_ID } })
})

describe('warranty_claims.claim.create_sales_return', () => {
  it('creates a sales return from eligible lines, scrubs the lock header, stamps and reports skipped lines', async () => {
    const claim = seedClaim()
    seedLine()
    seedLine({ id: LINE_NO_ORDER_ID, lineNo: 2, orderLineId: null })
    const ctx = makeCtx()

    const result = await createSalesReturnCommand.execute({ id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)

    expect(commandBusExecuteMock).toHaveBeenCalledTimes(1)
    const [commandId, dispatch] = commandBusExecuteMock.mock.calls[0]
    expect(commandId).toBe('sales.returns.create')
    expect(dispatch.input).toMatchObject({
      orderId: ORDER_ID,
      reason: 'WTY-000123',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      lines: [{ orderLineId: ORDER_LINE_ID, quantity: '1.0000' }],
    })
    expect(dispatch.ctx.request).toBeUndefined()
    expect(claim.salesReturnId).toBe(CREATED_RETURN_ID)
    expect(result).toMatchObject({
      claimId: CLAIM_ID,
      salesReturnId: CREATED_RETURN_ID,
      salesReturnUpdatedAt: RETURN_UPDATED_AT,
      skippedLineIds: [LINE_NO_ORDER_ID],
    })
    expect(mockEvents.some((event) => asRecord(event.payload).action === 'sales_return_created')).toBe(true)
  })

  it('rejects when the claim is already linked to a sales return', async () => {
    seedClaim({ salesReturnId: CREATED_RETURN_ID })
    seedLine()
    await expect(createSalesReturnCommand.execute({ id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.salesReturnAlreadyLinked' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('rejects ineligible claim statuses', async () => {
    seedClaim({ status: 'draft' })
    seedLine()
    await expect(createSalesReturnCommand.execute({ id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.salesReturnStatusNotEligible' } })
  })

  it('rejects claims without a linked order', async () => {
    seedClaim({ orderId: null })
    seedLine()
    await expect(createSalesReturnCommand.execute({ id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.salesReturnRequiresOrder' } })
  })

  it('rejects when no line is eligible', async () => {
    seedClaim()
    seedLine({ lineStatus: 'pending' })
    seedLine({ id: LINE_NO_ORDER_ID, lineNo: 2, orderLineId: null })
    await expect(createSalesReturnCommand.execute({ id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.salesReturnNoEligibleLines' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('skips approved-zero quantities and uses qtyClaimed when qtyApproved is null', async () => {
    seedClaim()
    seedLine({ qtyApproved: '0.0000' })
    seedLine({ id: LINE_NO_ORDER_ID, lineNo: 2, qtyApproved: null, qtyClaimed: '3.0000' })
    await createSalesReturnCommand.execute({ id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx())
    const [, dispatch] = commandBusExecuteMock.mock.calls[0]
    expect(dispatch.input.lines).toEqual([{ orderLineId: ORDER_LINE_ID, quantity: '3.0000' }])
  })

  it('skips fractional approved quantities without dispatching them to sales', async () => {
    seedClaim()
    seedLine()
    seedLine({ id: FRACTIONAL_LINE_ID, lineNo: 2, qtyApproved: '0.5000' })

    const result = await createSalesReturnCommand.execute(
      { id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      makeCtx(),
    )
    const [, dispatch] = commandBusExecuteMock.mock.calls[0]

    expect(result.skippedLineIds).toContain(FRACTIONAL_LINE_ID)
    expect(dispatch.input.lines).toEqual([{ orderLineId: ORDER_LINE_ID, quantity: '1.0000' }])
    expect(dispatch.input.lines).not.toContainEqual({ orderLineId: ORDER_LINE_ID, quantity: '0.5000' })
  })

  it('translates the sales shipped-quantity rejection', async () => {
    seedClaim()
    seedLine()
    commandBusExecuteMock.mockRejectedValueOnce(new CrudHttpError(400, { error: 'sales.returns.quantityExceedsShipped' }))
    await expect(createSalesReturnCommand.execute({ id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.salesReturnQuantityRejected' } })
  })

  it('compensates with a delete when the stamp loses a concurrent race', async () => {
    const claim = seedClaim()
    seedLine()
    commandBusExecuteMock.mockImplementation(async (commandId: string) => {
      if (commandId === 'sales.returns.create') {
        claim.salesReturnId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        return { result: { returnId: CREATED_RETURN_ID } }
      }
      return { result: { returnId: CREATED_RETURN_ID } }
    })
    await expect(createSalesReturnCommand.execute({ id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx()))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.salesReturnAlreadyLinked' } })
    const deleteCall = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.returns.delete')
    expect(deleteCall).toBeDefined()
    expect(deleteCall?.[1].input).toMatchObject({ id: CREATED_RETURN_ID, orderId: ORDER_ID })
  })

  it('undo aborts on a changed sales return and deletes on a matching token', async () => {
    const claim = seedClaim({ salesReturnId: CREATED_RETURN_ID })
    const before = { ...claim, salesReturnId: null, lines: [] }
    const logEntry = {
      payload: {
        undo: {
          before,
          after: { ...claim },
          salesReturn: { id: CREATED_RETURN_ID, orderId: ORDER_ID, updatedAt: RETURN_UPDATED_AT },
        },
      },
    }

    mockReturnRow = { id: CREATED_RETURN_ID, updated_at: '2026-07-16T11:30:00.000Z' }
    await expect(createSalesReturnCommand.undo?.({ logEntry, ctx: makeCtx() } as never))
      .rejects.toMatchObject({ status: 409, body: { error: 'warranty_claims.errors.salesReturnChangedUndoAborted' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()

    mockReturnRow = { id: CREATED_RETURN_ID, updated_at: RETURN_UPDATED_AT }
    await createSalesReturnCommand.undo?.({ logEntry, ctx: makeCtx() } as never)
    const deleteCall = commandBusExecuteMock.mock.calls.find(([commandId]) => commandId === 'sales.returns.delete')
    expect(deleteCall).toBeDefined()
    expect(claim.salesReturnId).toBeNull()
  })

  it('surfaces a 500-class orphan error and records the orphan when compensation also fails', async () => {
    const claim = seedClaim()
    seedLine()
    commandBusExecuteMock.mockImplementation(async (commandId: string) => {
      if (commandId === 'sales.returns.create') {
        claim.salesReturnId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        return { result: { returnId: CREATED_RETURN_ID } }
      }
      throw new Error('delete transport down')
    })
    await expect(createSalesReturnCommand.execute({ id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }, makeCtx()))
      .rejects.toMatchObject({ status: 500, body: { error: 'warranty_claims.errors.save_failed' } })
    expect(mockEvents.some((event) => asRecord(event.payload).action === 'sales_return_orphaned')).toBe(true)
  })

  it('undo aborts when the stored version token is missing but the return still exists', async () => {
    const claim = seedClaim({ salesReturnId: CREATED_RETURN_ID })
    const logEntry = {
      payload: {
        undo: {
          before: { ...claim, salesReturnId: null, lines: [] },
          after: { ...claim },
          salesReturn: { id: CREATED_RETURN_ID, orderId: ORDER_ID, updatedAt: null },
        },
      },
    }
    await expect(createSalesReturnCommand.undo?.({ logEntry, ctx: makeCtx() } as never))
      .rejects.toMatchObject({ status: 409, body: { error: 'warranty_claims.errors.salesReturnChangedUndoAborted' } })
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
  })

  it('declares both required route features', async () => {
    const routeModule = await import('../api/sales-return/route')
    expect(routeModule.metadata.POST.requireFeatures).toEqual(
      expect.arrayContaining(['warranty_claims.claim.manage', 'sales.returns.create']),
    )
  })

  it('undo skips the delete when the sales return no longer exists', async () => {
    const claim = seedClaim({ salesReturnId: CREATED_RETURN_ID })
    const logEntry = {
      payload: {
        undo: {
          before: { ...claim, salesReturnId: null, lines: [] },
          after: { ...claim },
          salesReturn: { id: CREATED_RETURN_ID, orderId: ORDER_ID, updatedAt: RETURN_UPDATED_AT },
        },
      },
    }
    mockReturnRow = null
    await createSalesReturnCommand.undo?.({ logEntry, ctx: makeCtx() } as never)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(claim.salesReturnId).toBeNull()
  })
})
