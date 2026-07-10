import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../data/entities'
import type { ClaimUpdateInput, WarrantyClaimStatus } from '../data/validators'
import type { WarrantyClaimEffectiveSettings } from '../lib/settings'
import type { ClaimRiskAssessment } from '../lib/risk'
import { createWarrantyAdjudicationEvaluator } from '../services/adjudicationEvaluator'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const CLAIM_ID = '44444444-4444-4444-8444-444444444444'
const LINE_ID = '55555555-5555-4555-8555-555555555555'
const LINE_TWO_ID = '66666666-6666-4666-8666-666666666666'
const USER_ID = '77777777-7777-4777-8777-777777777777'
const PORTAL_USER_ID = '88888888-8888-4888-8888-888888888888'
const ORDER_ID = '99999999-9999-4999-8999-999999999999'
const ORDER_LINE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SALES_RETURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const defaultSettings: WarrantyClaimEffectiveSettings = {
  slaHours: 48,
  slaPauseOnInfoRequested: true,
  slaAtRiskThresholdPct: 75,
  autoApproveEnabled: false,
  autoApproveMaxAmount: null,
  autoApproveCurrencyCode: null,
  autoApproveRequireInWarranty: true,
  defaultWarrantyMonths: null,
  businessHours: null,
  escalationTiers: null,
  adjudicationUseRules: false,
  quarantineGrades: null,
  returnLabelProvider: null,
}

const noRisk: ClaimRiskAssessment = { level: 'none', signals: [] }

let mockClaims: WarrantyClaim[] = []
let mockLines: WarrantyClaimLine[] = []
let mockEvents: WarrantyClaimEvent[] = []

const enforceWithGuardsMock = jest.fn<Promise<void>, [unknown, Record<string, unknown>]>()
const emitWarrantyClaimsEventMock = jest.fn<Promise<void>, [string, unknown, unknown?]>()
const resolveEffectiveWarrantyClaimSettingsMock = jest.fn<Promise<WarrantyClaimEffectiveSettings>, [EntityManager, { tenantId: string; organizationId: string | null }]>()
const evaluateClaimRiskMock = jest.fn<Promise<ClaimRiskAssessment>, [EntityManager, WarrantyClaim, WarrantyClaimLine[]]>()

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

jest.mock('../lib/settings', () => ({
  resolveEffectiveWarrantyClaimSettings: (em: EntityManager, scope: { tenantId: string; organizationId: string | null }) =>
    resolveEffectiveWarrantyClaimSettingsMock(em, scope),
}))

jest.mock('../lib/risk', () => ({
  evaluateClaimRisk: (em: EntityManager, claim: WarrantyClaim, lines: WarrantyClaimLine[]) =>
    evaluateClaimRiskMock(em, claim, lines),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (_em: unknown, entity: unknown, where: unknown, _options?: unknown, scope?: unknown) =>
    mockFindOne(entity, where, scope),
  findWithDecryption: async (_em: unknown, entity: unknown, where: unknown, _options?: unknown, scope?: unknown) =>
    mockFindMany(entity, where, scope),
}))

import {
  claimCrudEvents,
  createClaimCommand,
  deleteClaimCommand,
  submitClaimCommand,
  transitionClaimCommand,
  updateClaimCommand,
  createVendorRecoveryCommand,
  assignClaimCommand,
  commentClaimCommand,
} from '../commands/claims'
import { createClaimLineCommand, updateClaimLineCommand } from '../commands/claim-lines'

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

type EntitlementResolverMock = {
  resolveEntitlement: jest.Mock<Promise<{
    warrantyStatus: 'in_warranty' | 'out_of_warranty' | 'unknown'
    coverageType: 'standard' | 'extended' | 'none' | null
    expiresAt: string | null
    source: 'registration' | 'order' | 'manual' | 'resolver' | null
  }>, [Record<string, unknown>, { tenantId: string; organizationId: string }, EntityManager]>
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

function filterEquals(query: Record<string, unknown>, key: string): unknown {
  const filters = asRecord(query.filters)
  const value = asRecord(filters[key])
  return '$eq' in value ? value.$eq : filters[key]
}

function queryItems(entityId: string, query: Record<string, unknown>): Array<Record<string, unknown>> {
  const id = filterEquals(query, 'id')
  if (entityId === 'customers:customer_entity') {
    return id === CUSTOMER_ID
      ? [{ id: CUSTOMER_ID, display_name: 'Acme Distribution' }]
      : []
  }
  if (entityId === 'customer_accounts:customer_user') {
    return filterEquals(query, 'customer_entity_id') === CUSTOMER_ID
      ? [{ id: PORTAL_USER_ID }]
      : []
  }
  if (entityId === 'sales:sales_order') {
    return id === ORDER_ID
      ? [{ id: ORDER_ID }]
      : []
  }
  if (entityId === 'sales:sales_order_line') {
    return id === ORDER_LINE_ID
      ? [{ id: ORDER_LINE_ID, order_id: ORDER_ID }]
      : []
  }
  if (entityId === 'sales:sales_return') {
    return id === SALES_RETURN_ID
      ? [{ id: SALES_RETURN_ID }]
      : []
  }
  if (entityId === 'auth:user') {
    return id === USER_ID
      ? [{ id: USER_ID }]
      : []
  }
  return []
}

function mockFindMany(entity: unknown, where: unknown, scope: unknown): unknown[] {
  const name = entityName(entity)
  if (name === 'WarrantyClaim') {
    return mockClaims.filter((claim) => matchesScope(claim, scope) && matchesWhere(claim as unknown as Record<string, unknown>, where))
  }
  if (name === 'WarrantyClaimLine') {
    return mockLines.filter((line) => matchesScope(line, scope) && matchesWhere(line as unknown as Record<string, unknown>, where))
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

let mockSalesTablesAbsent = false

function makeUsersKysely() {
  return {
    selectFrom: (table: string) => {
      const wheres: Array<[string, string, unknown]> = []
      const rowsFor = (): Array<Record<string, unknown>> => {
        if (mockSalesTablesAbsent && (table === 'sales_orders' || table === 'sales_order_lines' || table === 'sales_returns')) {
          throw Object.assign(new Error(`relation "${table}" does not exist`), { code: '42P01' })
        }
        const idWhere = wheres.find(([column]) => column === 'id')
        if (table === 'users') {
          return idWhere && idWhere[2] === USER_ID ? [{ id: USER_ID }] : []
        }
        if (table === 'customer_entities') {
          return idWhere && idWhere[2] === CUSTOMER_ID ? [{ id: CUSTOMER_ID, display_name: 'Acme Distribution' }] : []
        }
        if (table === 'customer_users') {
          const customerWhere = wheres.find(([column]) => column === 'customer_entity_id')
          return customerWhere && customerWhere[2] === CUSTOMER_ID ? [{ id: PORTAL_USER_ID }] : []
        }
        if (table === 'sales_orders') {
          return idWhere && idWhere[2] === ORDER_ID ? [{ id: ORDER_ID, order_number: 'SO-1042' }] : []
        }
        if (table === 'sales_order_lines') {
          return idWhere && idWhere[2] === ORDER_LINE_ID ? [{ id: ORDER_LINE_ID, order_id: ORDER_ID }] : []
        }
        if (table === 'sales_returns') {
          return idWhere && idWhere[2] === SALES_RETURN_ID ? [{ id: SALES_RETURN_ID }] : []
        }
        return []
      }
      const builder = {
        select: () => builder,
        where: (column: string, op: string, value: unknown) => {
          wheres.push([column, op, value])
          return builder
        },
        limit: () => builder,
        execute: async () => rowsFor(),
        executeTakeFirst: async () => rowsFor()[0],
      }
      return builder
    },
  }
}

function makeFork(): EntityManager {
  const fork = {
    create: (_entity: unknown, data: Record<string, unknown>) => data,
    persist: (entity: unknown) => persistEntity(entity),
    flush: jest.fn(async () => undefined),
    transactional: async (fn: (tx: EntityManager) => Promise<unknown>) => fn(fork as unknown as EntityManager),
    getKysely: () => makeUsersKysely(),
    fork: () => fork,
  }
  return fork as unknown as EntityManager
}

function makeContext(options: { entitlementResolver?: EntitlementResolverMock } = {}): {
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
    query: jest.fn(async (entityId, query) => ({
      items: queryItems(entityId, query),
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
        if (key === 'warrantyAdjudicationEvaluator') return createWarrantyAdjudicationEvaluator()
        if (key === 'warrantyEntitlementResolver' && options.entitlementResolver) return options.entitlementResolver
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
    orderNumber: fields.orderNumber ?? null,
    awaitingStaffReply: fields.awaitingStaffReply ?? false,
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
    slaPausedAt: fields.slaPausedAt ?? null,
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
    mockSalesTablesAbsent = false
  mockClaims = []
  mockLines = []
  mockEvents = []
  enforceWithGuardsMock.mockReset()
  enforceWithGuardsMock.mockResolvedValue(undefined)
  emitWarrantyClaimsEventMock.mockReset()
  emitWarrantyClaimsEventMock.mockResolvedValue(undefined)
  resolveEffectiveWarrantyClaimSettingsMock.mockReset()
  resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValue({ ...defaultSettings })
  evaluateClaimRiskMock.mockReset()
  evaluateClaimRiskMock.mockResolvedValue(noRisk)
})

describe('warranty claim commands', () => {
  test('create generates a number, snapshots customer name, and creates initial lines', async () => {
    const { ctx, numberGenerator } = makeContext()

    const result = await createClaimCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimType: 'warranty',
      customerId: CUSTOMER_ID,
      lines: [{ sku: 'ABC', productName: 'Pump', qtyClaimed: 2, creditAmount: 25, vendorName: 'Pump Vendor GmbH' }],
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
    expect(mockLines[0]).toMatchObject({ sku: 'ABC', productName: 'Pump', qtyClaimed: '2', vendorName: 'Pump Vendor GmbH' })
    expect(mockEvents.some((event) => event.kind === 'system')).toBe(true)
  })

  test('create stamps entitlement source when resolver resolves a source', async () => {
    const entitlementResolver: EntitlementResolverMock = {
      resolveEntitlement: jest.fn(async () => ({
        warrantyStatus: 'in_warranty',
        coverageType: 'standard',
        expiresAt: '2027-07-01T00:00:00.000Z',
        source: 'registration',
      })),
    }
    const { ctx } = makeContext({ entitlementResolver })

    await createClaimCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimType: 'warranty',
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
      lines: [{
        sku: 'ABC',
        productName: 'Pump',
        serialNumber: 'SERIAL-1',
        purchaseDate: new Date('2026-07-01T00:00:00.000Z'),
        qtyClaimed: 1,
      }],
    }, ctx)

    expect(entitlementResolver.resolveEntitlement).toHaveBeenCalledWith(
      {
        serialNumber: 'SERIAL-1',
        orderId: ORDER_ID,
        productId: null,
        sku: 'ABC',
        purchaseDate: '2026-07-01',
      },
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      expect.anything(),
    )
    expect(mockClaims[0]?.entitlementSource).toBe('registration')
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
    resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValueOnce({ ...defaultSettings, slaHours: 12 })

    await submitClaimCommand.execute({ id: CLAIM_ID }, ctx)

    expect(claim.status).toBe('submitted')
    expect(claim.submittedAt).toBeInstanceOf(Date)
    expect(claim.slaDueAt).toBeInstanceOf(Date)
    expect(claim.slaDueAt!.getTime() - claim.submittedAt!.getTime()).toBe(12 * 60 * 60 * 1000)
  })

  test('submit with a customer actor attributes the timeline event to the customer, not the auth user', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)

    await submitClaimCommand.execute({ id: CLAIM_ID, actorCustomerId: CUSTOMER_ID }, ctx)

    expect(claim.status).toBe('submitted')
    const statusEvent = mockEvents.find((event) => event.kind === 'status_changed')
    expect(statusEvent?.actorCustomerId).toBe(CUSTOMER_ID)
    expect(statusEvent?.actorUserId).toBeNull()
  })

  test('transition to cancelled with a customer actor attributes the timeline event to the customer', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('submitted')
    mockClaims.push(claim)

    await transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'cancelled', actorCustomerId: CUSTOMER_ID }, ctx)

    expect(claim.status).toBe('cancelled')
    const statusEvent = mockEvents.find((event) => event.kind === 'status_changed')
    expect(statusEvent?.actorCustomerId).toBe(CUSTOMER_ID)
    expect(statusEvent?.actorUserId).toBeNull()
  })

  test('auto-adjudication stays inactive for incomplete or ineligible settings and approves eligible claims atomically', async () => {
    const cases: Array<{
      name: string
      settings: WarrantyClaimEffectiveSettings
      claimFields?: Partial<WarrantyClaim>
      lineFields?: Partial<WarrantyClaimLine>
      risk?: ClaimRiskAssessment
      expectedStatus: WarrantyClaimStatus
    }> = [
      {
        name: 'enabled null knobs',
        settings: { ...defaultSettings, autoApproveEnabled: true },
        expectedStatus: 'submitted',
      },
      {
        name: 'over max',
        settings: { ...defaultSettings, autoApproveEnabled: true, autoApproveMaxAmount: 10, autoApproveCurrencyCode: 'USD' },
        expectedStatus: 'submitted',
      },
      {
        name: 'currency mismatch',
        settings: { ...defaultSettings, autoApproveEnabled: true, autoApproveMaxAmount: 100, autoApproveCurrencyCode: 'EUR' },
        expectedStatus: 'submitted',
      },
      {
        name: 'out of warranty',
        settings: { ...defaultSettings, autoApproveEnabled: true, autoApproveMaxAmount: 100, autoApproveCurrencyCode: 'USD', autoApproveRequireInWarranty: true },
        lineFields: { warrantyStatus: 'out_of_warranty' },
        expectedStatus: 'submitted',
      },
      {
        name: 'risk flagged',
        settings: { ...defaultSettings, autoApproveEnabled: true, autoApproveMaxAmount: 100, autoApproveCurrencyCode: 'USD' },
        risk: {
          level: 'high',
          signals: [{ id: 'duplicate_serial', level: 'high', messageKey: 'risk' }],
        },
        expectedStatus: 'submitted',
      },
      {
        name: 'eligible',
        settings: { ...defaultSettings, autoApproveEnabled: true, autoApproveMaxAmount: 100, autoApproveCurrencyCode: 'USD' },
        expectedStatus: 'approved',
      },
    ]

    for (const testCase of cases) {
      mockClaims = []
      mockLines = []
      mockEvents = []
      emitWarrantyClaimsEventMock.mockClear()
      resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValueOnce(testCase.settings)
      evaluateClaimRiskMock.mockResolvedValueOnce(testCase.risk ?? noRisk)
      const { ctx } = makeContext()
      const claim = makeClaim('draft', { totalClaimedAmount: '50', currencyCode: 'USD', ...testCase.claimFields })
      mockClaims.push(claim)
      mockLines.push(makeLine(claim, { creditAmount: '50', warrantyStatus: 'in_warranty', ...testCase.lineFields }))

      await submitClaimCommand.execute({ id: CLAIM_ID }, ctx)

      expect(claim.status).toBe(testCase.expectedStatus)
      if (testCase.name === 'eligible') {
        expect(mockEvents.filter((event) => event.kind === 'status_changed').map((event) => event.payload)).toEqual([
          { from: 'draft', to: 'submitted' },
          { from: 'submitted', to: 'approved' },
        ])
        const statusPayloads = emitWarrantyClaimsEventMock.mock.calls
          .filter(([eventId]) => eventId === 'warranty_claims.claim.status_changed')
          .map(([, payload]) => asRecord(payload))
        expect(statusPayloads).toHaveLength(1)
        expect(statusPayloads[0]).toMatchObject({ fromStatus: 'submitted', toStatus: 'approved', status: 'approved' })
      }
    }
  })

  test('transition pauses and resumes SLA with due-date shift math', async () => {
    jest.useFakeTimers()
    try {
      const { ctx } = makeContext()
      const dueAt = new Date('2026-07-03T00:00:00.000Z')
      const claim = makeClaim('in_review', {
        submittedAt: new Date('2026-07-01T00:00:00.000Z'),
        slaDueAt: dueAt,
      })
      mockClaims.push(claim)

      jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))
      await transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'info_requested' }, ctx)

      expect(claim.status).toBe('info_requested')
      expect(claim.slaPausedAt?.toISOString()).toBe('2026-07-01T12:00:00.000Z')
      expect(claim.slaDueAt?.toISOString()).toBe('2026-07-03T00:00:00.000Z')

      jest.setSystemTime(new Date('2026-07-01T18:00:00.000Z'))
      await transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'in_review' }, ctx)

      expect(claim.status).toBe('in_review')
      expect(claim.slaPausedAt).toBeNull()
      expect(claim.slaDueAt?.toISOString()).toBe('2026-07-03T06:00:00.000Z')
      expect(mockEvents.map((event) => event.payload)).toEqual([
        { action: 'sla_paused' },
        { from: 'in_review', to: 'info_requested' },
        { action: 'sla_resumed' },
        { from: 'info_requested', to: 'in_review' },
      ])
    } finally {
      jest.useRealTimers()
    }
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

  test('customer reply auto-resumes info-requested claims and emits status events', async () => {
    jest.useFakeTimers()
    try {
      const { ctx } = makeContext()
      const claim = makeClaim('info_requested', {
        slaDueAt: new Date('2026-07-03T00:00:00.000Z'),
        slaPausedAt: new Date('2026-07-01T12:00:00.000Z'),
      })
      mockClaims.push(claim)
      jest.setSystemTime(new Date('2026-07-01T14:00:00.000Z'))

      await commentClaimCommand.execute({
        claimId: CLAIM_ID,
        body: 'Here is the missing serial number.',
        visibility: 'customer',
        actorCustomerId: CUSTOMER_ID,
      }, ctx)

      expect(claim.status).toBe('in_review')
      expect(claim.slaPausedAt).toBeNull()
      expect(claim.slaDueAt?.toISOString()).toBe('2026-07-03T02:00:00.000Z')
      expect(mockEvents.map((event) => event.kind)).toEqual(['comment', 'system', 'status_changed'])
      expect(emitWarrantyClaimsEventMock).toHaveBeenCalledWith(
        'warranty_claims.claim.status_changed',
        expect.objectContaining({ fromStatus: 'info_requested', toStatus: 'in_review' }),
        { persistent: true },
      )
      expect(emitWarrantyClaimsEventMock).toHaveBeenCalledWith(
        'warranty_claims.claim.portal_status_changed',
        expect.objectContaining({ fromStatus: 'info_requested', toStatus: 'in_review', recipientUserIds: [PORTAL_USER_ID] }),
        { persistent: true },
      )
    } finally {
      jest.useRealTimers()
    }
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

  test('line update enforces merged quantity bounds', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('approved')
    const line = makeLine(claim, { qtyClaimed: '1', qtyApproved: '1', qtyReceived: null })
    mockClaims.push(claim)
    mockLines.push(line)

    await expect(updateClaimLineCommand.execute({ id: LINE_ID, qtyReceived: 2 }, ctx))
      .rejects
      .toMatchObject({ status: 400 })

    line.qtyReceived = null
    line.qtyApproved = '5'
    await expect(updateClaimLineCommand.execute({ id: LINE_ID, qtyClaimed: 4 }, ctx))
      .rejects
      .toMatchObject({ status: 400 })
  })

  test('line create clamps month-end warranty dates and increments line numbers', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)
    mockLines.push(makeLine(claim, { lineNo: 1 }), makeLine(claim, { id: LINE_TWO_ID, lineNo: 3 }))

    const result = await createClaimLineCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimId: CLAIM_ID,
      purchaseDate: new Date('2024-01-31T00:00:00.000Z'),
      warrantyMonths: 1,
      qtyClaimed: 1,
    }, ctx)

    const created = mockLines.find((line) => line.id === result.lineId)
    expect(created?.lineNo).toBe(4)
    expect(created?.warrantyExpiresAt?.toISOString()).toBe('2024-02-29T00:00:00.000Z')
  })

  test('delete is allowed only for draft or cancelled claims', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('submitted')
    const line = makeLine(claim)
    mockClaims.push(claim)
    mockLines.push(line)

    await expect(deleteClaimCommand.execute({ id: CLAIM_ID }, ctx)).rejects.toMatchObject({ status: 400 })

    claim.status = 'cancelled'
    await deleteClaimCommand.execute({ id: CLAIM_ID }, ctx)

    expect(claim.deletedAt).toBeInstanceOf(Date)
    expect(line.deletedAt).toBeInstanceOf(Date)
  })

  test('claim create validates sales references and assign validates assignee user', async () => {
    const { ctx } = makeContext()

    await expect(createClaimCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimType: 'warranty',
      orderId: LINE_ID,
    }, ctx)).rejects.toMatchObject({ status: 400 })

    const claim = makeClaim('draft')
    mockClaims.push(claim)
    await expect(assignClaimCommand.execute({ id: CLAIM_ID, assigneeUserId: LINE_ID }, ctx))
      .rejects
      .toMatchObject({ status: 400 })
  })

  test('claim crud event payload carries claimType and status for subscriber gating', () => {
    const claim = makeClaim('resolved', { claimType: 'vendor_recovery' })
    const payload = claimCrudEvents.buildPayload?.({
      action: 'updated',
      entity: claim,
      identifiers: { id: claim.id, organizationId: ORG_ID, tenantId: TENANT_ID },
    }) as Record<string, unknown>
    expect(payload.claimType).toBe('vendor_recovery')
    expect(payload.status).toBe('resolved')
    expect(payload.id).toBe(claim.id)
    expect(payload.tenantId).toBe(TENANT_ID)
    expect(payload.organizationId).toBe(ORG_ID)
  })

  test('claim create skips sales reference validation when the sales module is absent', async () => {
    const { ctx } = makeContext()
    mockSalesTablesAbsent = true

    const result = await createClaimCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimType: 'warranty',
      orderId: ORDER_ID,
    }, ctx)

    expect(result).toMatchObject({ claimId: expect.any(String) })
    expect(mockClaims.some((record) => record.orderId === ORDER_ID)).toBe(true)
    expect(mockClaims[0]?.orderNumber ?? null).toBeNull()
  })

  test('create snapshots the order number from the referenced sales order', async () => {
    const { ctx } = makeContext()

    await createClaimCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimType: 'warranty',
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
    }, ctx)

    expect(mockClaims).toHaveLength(1)
    expect(mockClaims[0]).toMatchObject({ orderId: ORDER_ID, orderNumber: 'SO-1042' })
  })

  test('update refreshes and clears the order number snapshot with the order reference', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)

    await updateClaimCommand.execute({
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      orderId: ORDER_ID,
    } as ClaimUpdateInput, ctx)
    expect(claim.orderNumber).toBe('SO-1042')

    await updateClaimCommand.execute({
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      orderId: null,
    } as ClaimUpdateInput, ctx)
    expect(claim.orderId).toBeNull()
    expect(claim.orderNumber).toBeNull()
  })

  test('customer replies raise the awaiting-staff-reply flag and staff actions clear it', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('in_review')
    mockClaims.push(claim)
    const dataEngine = ctx.container.resolve('dataEngine') as { markOrmEntityChange: jest.Mock }

    await commentClaimCommand.execute({
      claimId: CLAIM_ID,
      body: 'Any update on my claim?',
      visibility: 'customer',
      actorCustomerId: CUSTOMER_ID,
    }, ctx)
    expect(claim.awaitingStaffReply).toBe(true)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalled()

    dataEngine.markOrmEntityChange.mockClear()
    await commentClaimCommand.execute({
      claimId: CLAIM_ID,
      body: 'We are inspecting the unit today.',
      visibility: 'customer',
    }, ctx)
    expect(claim.awaitingStaffReply).toBe(false)
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalled()

    await commentClaimCommand.execute({
      claimId: CLAIM_ID,
      body: 'Thanks, waiting for the outcome.',
      visibility: 'customer',
      actorCustomerId: CUSTOMER_ID,
    }, ctx)
    expect(claim.awaitingStaffReply).toBe(true)

    await transitionClaimCommand.execute({ id: CLAIM_ID, toStatus: 'approved' }, ctx)
    expect(claim.awaitingStaffReply).toBe(false)
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
