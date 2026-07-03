import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../data/entities'
import type { ClaimUpdateInput, WarrantyClaimStatus } from '../data/validators'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const CLAIM_ID = '44444444-4444-4444-8444-444444444444'
const LINE_ID = '55555555-5555-4555-8555-555555555555'
const LINE_TWO_ID = '66666666-6666-4666-8666-666666666666'
const USER_ID = '77777777-7777-4777-8777-777777777777'

let mockClaims: WarrantyClaim[] = []
let mockLines: WarrantyClaimLine[] = []
let mockEvents: WarrantyClaimEvent[] = []

const enforceWithGuardsMock = jest.fn<Promise<void>, [unknown, Record<string, unknown>]>()
const emitWarrantyClaimsEventMock = jest.fn<Promise<void>, [string, unknown, unknown?]>()

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (container: unknown, input: Record<string, unknown>) =>
    enforceWithGuardsMock(container, input),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) {
      await phase()
    }
  },
}))

jest.mock('../events', () => ({
  emitWarrantyClaimsEvent: (eventId: string, payload: unknown, options?: unknown) =>
    emitWarrantyClaimsEventMock(eventId, payload, options),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (_em: unknown, entity: unknown, where: unknown, _options?: unknown, scope?: unknown) =>
    mockFindOne(entity, where, scope),
  findWithDecryption: async (_em: unknown, entity: unknown, where: unknown, _options?: unknown, scope?: unknown) =>
    mockFindMany(entity, where, scope),
}))

import {
  createClaimCommand,
  deleteClaimCommand,
  submitClaimCommand,
  transitionClaimCommand,
  updateClaimCommand,
  createVendorRecoveryCommand,
} from '../commands/claims'
import { updateClaimLineCommand } from '../commands/claim-lines'

type ScopeRecord = {
  tenantId?: unknown
  organizationId?: unknown
}

type NumberGenerator = {
  generate: jest.Mock<Promise<{ number: string; prefix: string; sequence: number }>, [Record<string, unknown>]>
}

type QueryEngineMock = {
  query: jest.Mock<Promise<{ items: Array<Record<string, unknown>>; page: number; pageSize: number; total: number }>, [string, Record<string, unknown>]>
}

function entityName(entity: unknown): string {
  return typeof entity === 'function' && 'name' in entity ? String(entity.name) : ''
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function matchesScope(record: ScopeRecord, scope: unknown): boolean {
  const scoped = asRecord(scope)
  const tenantId = scoped.tenantId
  const organizationId = scoped.organizationId
  if (typeof tenantId === 'string' && record.tenantId !== tenantId) return false
  if (typeof organizationId === 'string' && record.organizationId !== organizationId) return false
  return true
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  return typeof record.id === 'string' ? record.id : null
}

function matchesWhere(record: Record<string, unknown>, where: unknown): boolean {
  const filters = asRecord(where)
  for (const [key, expected] of Object.entries(filters)) {
    const actual = key === 'claim' ? relationId(record.claim) : record[key]
    if (key === 'deletedAt' && expected === null) {
      if (record.deletedAt !== null && record.deletedAt !== undefined) return false
      continue
    }
    const expectedRecord = asRecord(expected)
    if (Array.isArray(expectedRecord.$in)) {
      if (!expectedRecord.$in.includes(actual)) return false
      continue
    }
    if ('$eq' in expectedRecord) {
      if (actual !== expectedRecord.$eq) return false
      continue
    }
    if (actual !== expected) return false
  }
  return true
}

function mockFindMany(entity: unknown, where: unknown, scope: unknown): unknown[] {
  const name = entityName(entity)
  if (name === 'WarrantyClaim') {
    return mockClaims.filter((claim) => matchesScope(claim, scope) && matchesWhere(claim as unknown as Record<string, unknown>, where))
  }
  if (name === 'WarrantyClaimLine') {
    return mockLines.filter((line) => matchesScope(line, scope) && matchesWhere(line as unknown as Record<string, unknown>, where))
  }
  if (name === 'CustomerEntity') {
    const filter = asRecord(where)
    if (filter.id && filter.id !== CUSTOMER_ID) return []
    return [{ id: CUSTOMER_ID, displayName: 'Acme Distribution', tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null }]
  }
  return []
}

async function mockFindOne(entity: unknown, where: unknown, scope: unknown): Promise<unknown> {
  return mockFindMany(entity, where, scope)[0] ?? null
}

function persistEntity(entity: unknown): void {
  const record = asRecord(entity)
  if ('claimNumber' in record) {
    const claim = entity as WarrantyClaim
    if (!mockClaims.some((existing) => existing.id === claim.id)) mockClaims.push(claim)
    return
  }
  if ('lineNo' in record && 'claim' in record) {
    const line = entity as WarrantyClaimLine
    if (!mockLines.some((existing) => existing.id === line.id)) mockLines.push(line)
    return
  }
  if ('kind' in record && 'visibility' in record) {
    mockEvents.push(entity as WarrantyClaimEvent)
  }
}

function makeFork(): EntityManager {
  const fork = {
    create: (_entity: unknown, data: Record<string, unknown>) => data,
    persist: (entity: unknown) => persistEntity(entity),
    flush: jest.fn(async () => undefined),
    transactional: async (fn: (tx: EntityManager) => Promise<unknown>) => fn(fork as unknown as EntityManager),
  }
  return fork as unknown as EntityManager
}

function makeContext(): {
  ctx: CommandRuntimeContext
  numberGenerator: NumberGenerator
  queryEngine: QueryEngineMock
} {
  const fork = makeFork()
  const numberGenerator: NumberGenerator = {
    generate: jest.fn(async (input) => {
      const claimType = typeof input.claimType === 'string' ? input.claimType : 'warranty'
      const prefix = claimType === 'vendor_recovery' ? 'VRC' : 'WTY'
      return { number: `${prefix}-000123`, prefix, sequence: 123 }
    }),
  }
  const queryEngine: QueryEngineMock = {
    query: jest.fn(async () => ({
      items: [{ id: CUSTOMER_ID, displayName: 'Acme Distribution' }],
      page: 1,
      pageSize: 1,
      total: 1,
    })),
  }
  const dataEngine = { markOrmEntityChange: jest.fn() }
  const ctx = {
    container: {
      resolve: (key: string) => {
        if (key === 'em') return { fork: () => fork }
        if (key === 'dataEngine') return dataEngine
        if (key === 'warrantyClaimNumberGenerator') return numberGenerator
        if (key === 'queryEngine') return queryEngine
        throw new Error(`[internal] unregistered test dependency ${key}`)
      },
    },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: true, sub: USER_ID },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: [ORG_ID],
    request: new Request('http://localhost/api/warranty_claims', { method: 'POST' }),
  } as unknown as CommandRuntimeContext
  return { ctx, numberGenerator, queryEngine }
}

function makeClaim(status: WarrantyClaimStatus, fields: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id: fields.id ?? CLAIM_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    claimNumber: fields.claimNumber ?? 'WTY-000001',
    claimType: fields.claimType ?? 'warranty',
    status,
    channel: fields.channel ?? 'staff',
    priority: fields.priority ?? 'normal',
    customerId: fields.customerId ?? CUSTOMER_ID,
    customerName: fields.customerName ?? 'Acme Distribution',
    vendorName: fields.vendorName ?? null,
    vendorRef: fields.vendorRef ?? null,
    orderId: fields.orderId ?? null,
    salesReturnId: fields.salesReturnId ?? null,
    replacementOrderId: fields.replacementOrderId ?? null,
    sourceClaimId: fields.sourceClaimId ?? null,
    advanceReplacement: fields.advanceReplacement ?? false,
    advanceShippedAt: fields.advanceShippedAt ?? null,
    reasonCode: fields.reasonCode ?? null,
    rejectionReasonCode: fields.rejectionReasonCode ?? null,
    resolutionSummary: fields.resolutionSummary ?? null,
    notes: fields.notes ?? null,
    currencyCode: fields.currencyCode ?? 'USD',
    totalClaimedAmount: fields.totalClaimedAmount ?? '0',
    totalApprovedAmount: fields.totalApprovedAmount ?? '0',
    totalRecoveredAmount: fields.totalRecoveredAmount ?? '0',
    slaDueAt: fields.slaDueAt ?? null,
    submittedAt: fields.submittedAt ?? null,
    resolvedAt: fields.resolvedAt ?? null,
    closedAt: fields.closedAt ?? null,
    assigneeUserId: fields.assigneeUserId ?? null,
    createdAt: fields.createdAt ?? new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: fields.updatedAt ?? new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: fields.deletedAt ?? null,
  } as unknown as WarrantyClaim
}

function makeLine(claim: WarrantyClaim, fields: Partial<WarrantyClaimLine> = {}): WarrantyClaimLine {
  return {
    id: fields.id ?? LINE_ID,
    claim,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    lineNo: fields.lineNo ?? 1,
    productId: fields.productId ?? null,
    variantId: fields.variantId ?? null,
    sku: fields.sku ?? 'SKU-1',
    productName: fields.productName ?? 'Widget',
    orderLineId: fields.orderLineId ?? null,
    serialNumber: fields.serialNumber ?? null,
    lotNumber: fields.lotNumber ?? null,
    purchaseDate: fields.purchaseDate ?? null,
    warrantyMonths: fields.warrantyMonths ?? null,
    warrantyExpiresAt: fields.warrantyExpiresAt ?? null,
    warrantyStatus: fields.warrantyStatus ?? 'unknown',
    faultCode: fields.faultCode ?? null,
    faultDescription: fields.faultDescription ?? null,
    qtyClaimed: fields.qtyClaimed ?? '1',
    qtyApproved: fields.qtyApproved ?? null,
    qtyReceived: fields.qtyReceived ?? null,
    conditionOnReceipt: fields.conditionOnReceipt ?? null,
    inspectionNotes: fields.inspectionNotes ?? null,
    disposition: fields.disposition ?? null,
    lineStatus: fields.lineStatus ?? 'pending',
    creditAmount: fields.creditAmount ?? null,
    restockingFee: fields.restockingFee ?? null,
    coreChargeAmount: fields.coreChargeAmount ?? null,
    coreCreditAmount: fields.coreCreditAmount ?? null,
    vendorClaimLineId: fields.vendorClaimLineId ?? null,
    createdAt: fields.createdAt ?? new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: fields.updatedAt ?? new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: fields.deletedAt ?? null,
  } as unknown as WarrantyClaimLine
}

beforeEach(() => {
  mockClaims = []
  mockLines = []
  mockEvents = []
  enforceWithGuardsMock.mockReset()
  enforceWithGuardsMock.mockResolvedValue(undefined)
  emitWarrantyClaimsEventMock.mockReset()
  emitWarrantyClaimsEventMock.mockResolvedValue(undefined)
})

describe('warranty claim commands', () => {
  test('create generates a number, snapshots customer name, and creates initial lines', async () => {
    const { ctx, numberGenerator } = makeContext()

    const result = await createClaimCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimType: 'warranty',
      customerId: CUSTOMER_ID,
      lines: [{ sku: 'ABC', productName: 'Pump', qtyClaimed: 2, creditAmount: 25 }],
    }, ctx)

    expect(result.claimId).toBeTruthy()
    expect(numberGenerator.generate).toHaveBeenCalledWith({ claimType: 'warranty', tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(mockClaims).toHaveLength(1)
    expect(mockClaims[0]).toMatchObject({
      claimNumber: 'WTY-000123',
      customerName: 'Acme Distribution',
      totalClaimedAmount: '25',
    })
    expect(mockLines).toHaveLength(1)
    expect(mockLines[0]).toMatchObject({ sku: 'ABC', productName: 'Pump', qtyClaimed: '2' })
    expect(mockEvents.some((event) => event.kind === 'system')).toBe(true)
  })

  test('create rejects an initial line whose approved quantity exceeds the claimed quantity', async () => {
    const { ctx } = makeContext()
    await expect(createClaimCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimType: 'warranty',
      lines: [{ sku: 'ABC', qtyClaimed: 1, qtyApproved: 2 }],
    }, ctx)).rejects.toThrow()
    expect(mockClaims).toHaveLength(0)
  })

  test('update rejects status, claimType, and fields outside the current status whitelist', async () => {
    const { ctx } = makeContext()
    const draftClaim = makeClaim('draft')
    mockClaims.push(draftClaim)

    await expect(updateClaimCommand.execute({ id: CLAIM_ID, status: 'closed' } as unknown as ClaimUpdateInput, ctx))
      .rejects
      .toMatchObject({ status: 400 })
    await expect(updateClaimCommand.execute({ id: CLAIM_ID, claimType: 'return' } as unknown as ClaimUpdateInput, ctx))
      .rejects
      .toMatchObject({ status: 400 })
    await expect(updateClaimCommand.execute({ id: CLAIM_ID, advanceReplacement: true }, ctx))
      .rejects
      .toMatchObject({ status: 400 })

    draftClaim.status = 'approved'
    await expect(updateClaimCommand.execute({ id: CLAIM_ID, notes: 'late note' }, ctx))
      .rejects
      .toMatchObject({ status: 400 })
  })

  test('submit stamps submitted and SLA timestamps', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)

    await submitClaimCommand.execute({ id: CLAIM_ID }, ctx)

    expect(claim.status).toBe('submitted')
    expect(claim.submittedAt).toBeInstanceOf(Date)
    expect(claim.slaDueAt).toBeInstanceOf(Date)
    expect(claim.slaDueAt!.getTime() - claim.submittedAt!.getTime()).toBe(48 * 60 * 60 * 1000)
  })

  test('transition rejects illegal moves, rejected without a reason, and unresolved lines on resolve', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)

    await expect(transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'approved' }, ctx))
      .rejects
      .toMatchObject({ status: 400 })

    claim.status = 'in_review'
    await expect(transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'rejected' }, ctx))
      .rejects
      .toMatchObject({ status: 400 })

    claim.status = 'approved'
    mockLines.push(makeLine(claim, { lineStatus: 'approved' }))
    await expect(transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'resolved' }, ctx))
      .rejects
      .toMatchObject({ status: 400 })
  })

  test('vendor recovery rejects non-resolved and already-linked source lines', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('resolved')
    const line = makeLine(claim, { lineStatus: 'approved' })
    mockClaims.push(claim)
    mockLines.push(line)

    await expect(createVendorRecoveryCommand.execute({
      claimId: CLAIM_ID,
      lineIds: [LINE_ID],
      vendorName: 'Vendor',
    }, ctx)).rejects.toMatchObject({ status: 400 })

    line.lineStatus = 'resolved'
    line.vendorClaimLineId = LINE_TWO_ID
    await expect(createVendorRecoveryCommand.execute({
      claimId: CLAIM_ID,
      lineIds: [LINE_ID],
      vendorName: 'Vendor',
    }, ctx)).rejects.toMatchObject({ status: 400 })
  })

  test('line update recomputes header rollups', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('approved')
    const line = makeLine(claim, { lineStatus: 'pending', creditAmount: '10' })
    const secondLine = makeLine(claim, {
      id: LINE_TWO_ID,
      lineNo: 2,
      lineStatus: 'resolved',
      creditAmount: '20',
      restockingFee: '3',
      coreCreditAmount: '1',
    })
    mockClaims.push(claim)
    mockLines.push(line, secondLine)

    await updateClaimLineCommand.execute({
      id: LINE_ID,
      lineStatus: 'approved',
      creditAmount: 30,
      restockingFee: 5,
      coreCreditAmount: 2,
    }, ctx)

    expect(claim.totalClaimedAmount).toBe('50')
    expect(claim.totalApprovedAmount).toBe('45')
  })

  test('delete is allowed only for draft or cancelled claims', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('submitted')
    mockClaims.push(claim)

    await expect(deleteClaimCommand.execute({ id: CLAIM_ID }, ctx)).rejects.toMatchObject({ status: 400 })

    claim.status = 'cancelled'
    await deleteClaimCommand.execute({ id: CLAIM_ID }, ctx)

    expect(claim.deletedAt).toBeInstanceOf(Date)
  })

  test('lock enforcement failures abort mutations', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)
    enforceWithGuardsMock.mockRejectedValueOnce(new CrudHttpError(409, { error: 'conflict' }))

    await expect(updateClaimCommand.execute({ id: CLAIM_ID, notes: 'new' }, ctx)).rejects.toMatchObject({ status: 409 })
    expect(claim.notes).toBeNull()
  })
})
