import { LockMode } from '@mikro-orm/core'
import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../data/entities'
import type { ClaimLineUpdateInput, ClaimUpdateInput, WarrantyClaimStatus } from '../data/validators'
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
const OTHER_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORDER_LINE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SALES_RETURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PREVIOUS_CUSTOMER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

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
let mockFindOneCalls: Array<{ entity: string; where: Record<string, unknown>; options: Record<string, unknown> }> = []
let mockBeforeClaimLock: (() => void) | null = null

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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (_em: unknown, entity: unknown, where: unknown, options?: unknown, scope?: unknown) =>
    mockFindOne(entity, where, scope, options),
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
import {
  createClaimLineCommand,
  deleteClaimLineCommand,
  receiveClaimLineCommand,
  releaseClaimLineQuarantineCommand,
  setClaimLineAssessmentCommand,
  updateClaimLineCommand,
} from '../commands/claim-lines'

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

function filterIncludes(query: Record<string, unknown>, key: string, value: string): boolean {
  const filter = asRecord(asRecord(query.filters)[key])
  return Array.isArray(filter.$in) && filter.$in.includes(value)
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
    return (id === USER_ID || filterIncludes(query, 'id', USER_ID))
      ? [{ id: USER_ID, name: 'Warranty Manager', organization_id: ORG_ID, is_confirmed: true }]
      : []
  }
  if (entityId === 'staff:staff_team_member') {
    return filterEquals(query, 'user_id') === USER_ID
      && filterEquals(query, 'organization_id') === ORG_ID
      ? [{ id: 'staff-member-1', user_id: USER_ID, organization_id: ORG_ID, is_active: true }]
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

async function mockFindOne(entity: unknown, where: unknown, scope: unknown, options?: unknown): Promise<unknown> {
  mockFindOneCalls.push({ entity: entityName(entity), where: asRecord(where), options: asRecord(options) })
  if (entityName(entity) === 'WarrantyClaim' && asRecord(options).lockMode === LockMode.PESSIMISTIC_WRITE) {
    const beforeLock = mockBeforeClaimLock
    mockBeforeClaimLock = null
    beforeLock?.()
  }
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
          return idWhere && (idWhere[2] === ORDER_ID || idWhere[2] === OTHER_ORDER_ID)
            ? [{ id: idWhere[2], order_number: 'SO-1042', customer_entity_id: CUSTOMER_ID }]
            : []
        }
        if (table === 'sales_order_lines') {
          const requestedIds = idWhere?.[1] === 'in' ? idWhere[2] : [idWhere?.[2]]
          return Array.isArray(requestedIds) && requestedIds.includes(ORDER_LINE_ID)
            ? [{ id: ORDER_LINE_ID, order_id: ORDER_ID }]
            : []
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
        forUpdate: () => builder,
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
  dataEngine: { markOrmEntityChange: jest.Mock }
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
  return { ctx, numberGenerator, queryEngine, dataEngine }
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
    conditionGrade: fields.conditionGrade ?? null,
    quarantineStatus: fields.quarantineStatus ?? 'none',
    inspectionNotes: fields.inspectionNotes ?? null,
    assessmentPayload: fields.assessmentPayload ?? null,
    disposition: fields.disposition ?? null,
    lineStatus: fields.lineStatus ?? 'pending',
    creditAmount: fields.creditAmount ?? null,
    restockingFee: fields.restockingFee ?? null,
    coreChargeAmount: fields.coreChargeAmount ?? null,
    coreCreditAmount: fields.coreCreditAmount ?? null,
    vendorClaimLineId: fields.vendorClaimLineId ?? null,
    vendorName: fields.vendorName ?? null,
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
  mockFindOneCalls = []
  mockBeforeClaimLock = null
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

  test('undo restores the command delta when the captured aggregate and lines are unchanged', async () => {
    jest.useFakeTimers()
    try {
      const { ctx } = makeContext()
      const claim = makeClaim('draft', { notes: 'before' })
      const line = makeLine(claim)
      mockClaims.push(claim)
      mockLines.push(line)
      const input = { id: CLAIM_ID, notes: 'after' }
      const prepared = await updateClaimCommand.prepare!(input, ctx)
      jest.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
      const result = await updateClaimCommand.execute(input, ctx)
      const after = await updateClaimCommand.captureAfter!(input, result, ctx)
      const logEntry = await updateClaimCommand.buildLog!({
        input,
        result,
        ctx,
        snapshots: { before: prepared?.before, after },
      })

      await updateClaimCommand.undo!({ input, logEntry: logEntry as never, ctx })

      expect(claim.notes).toBe('before')
      expect(line.inspectionNotes).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  test.each(['aggregate', 'line'] as const)('undo rejects an intervening %s edit without overwriting it', async (target) => {
    jest.useFakeTimers()
    try {
      const { ctx } = makeContext()
      const claim = makeClaim('draft', { notes: 'before' })
      const line = makeLine(claim)
      mockClaims.push(claim)
      mockLines.push(line)
      const input = { id: CLAIM_ID, notes: 'after' }
      const prepared = await updateClaimCommand.prepare!(input, ctx)
      jest.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
      const result = await updateClaimCommand.execute(input, ctx)
      const after = await updateClaimCommand.captureAfter!(input, result, ctx)
      const logEntry = await updateClaimCommand.buildLog!({
        input,
        result,
        ctx,
        snapshots: { before: prepared?.before, after },
      })

      if (target === 'aggregate') {
        claim.customerName = 'Intervening customer name'
        claim.updatedAt = new Date('2026-07-03T00:00:00.000Z')
      } else {
        line.inspectionNotes = 'Intervening inspection'
        line.updatedAt = new Date('2026-07-03T00:00:00.000Z')
      }

      await expect(updateClaimCommand.undo!({ input, logEntry: logEntry as never, ctx }))
        .rejects.toMatchObject({
          status: 409,
          body: { error: 'This claim changed while you were editing it.', code: 'warranty_claims.errors.conflict' },
        })
      expect(claim.notes).toBe('after')
      if (target === 'aggregate') expect(claim.customerName).toBe('Intervening customer name')
      else expect(line.inspectionNotes).toBe('Intervening inspection')
    } finally {
      jest.useRealTimers()
    }
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
    expect(emitWarrantyClaimsEventMock).toHaveBeenCalledWith(
      'warranty_claims.claim.submitted',
      expect.objectContaining({ claimId: CLAIM_ID }),
      { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(emitWarrantyClaimsEventMock).toHaveBeenCalledWith(
      'warranty_claims.claim.status_changed',
      expect.objectContaining({ claimId: CLAIM_ID, toStatus: 'submitted' }),
      { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
    )
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

  test('vendor recovery emits an updated index side effect for each linked source line', async () => {
    const { ctx, dataEngine } = makeContext()
    const claim = makeClaim('resolved')
    const line = makeLine(claim, { lineStatus: 'resolved', qtyApproved: '1' })
    mockClaims.push(claim)
    mockLines.push(line)

    await createVendorRecoveryCommand.execute({
      claimId: CLAIM_ID,
      lineIds: [LINE_ID],
      vendorName: 'Vendor',
    }, ctx)

    expect(line.vendorClaimLineId).toEqual(expect.any(String))
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'updated',
      entity: line,
      identifiers: { id: LINE_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
      indexer: { entityType: 'warranty_claims:warranty_claim_line' },
    }))
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
        { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
      )
      expect(emitWarrantyClaimsEventMock).toHaveBeenCalledWith(
        'warranty_claims.claim.portal_status_changed',
        expect.objectContaining({ fromStatus: 'info_requested', toStatus: 'in_review', recipientUserIds: [PORTAL_USER_ID] }),
        { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
      )
    } finally {
      jest.useRealTimers()
    }
  })

  test('line update recomputes header rollups (return claim applies restock/core)', async () => {
    const { ctx } = makeContext()
    // Return-family claims apply the restocking-fee and core-credit adjustments.
    const claim = makeClaim('approved', { claimType: 'return' })
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
    // (30 - 5 + 2) + (20 - 3 + 1) = 45
    expect(claim.totalApprovedAmount).toBe('45')
  })

  test('warranty claim rollups ignore restocking fee and core credit', async () => {
    const { ctx } = makeContext()
    // Warranty claims settle on the credit amount alone — restock/core must not move the total.
    const claim = makeClaim('approved', { claimType: 'warranty' })
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
    // Credit only: 30 + 20 = 50 (restock/core ignored for warranty claims).
    expect(claim.totalApprovedAmount).toBe('50')
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

  test('line create and update persist vendorName', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)

    const created = await createClaimLineCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimId: CLAIM_ID,
      qtyClaimed: 1,
      vendorName: 'Pump Vendor GmbH',
    }, ctx)

    const line = mockLines.find((candidate) => candidate.id === created.lineId)
    expect(line?.vendorName).toBe('Pump Vendor GmbH')

    await updateClaimLineCommand.execute({ id: created.lineId, vendorName: 'Hydraulics Co' }, ctx)
    expect(line?.vendorName).toBe('Hydraulics Co')

    await updateClaimLineCommand.execute({ id: created.lineId, vendorName: null }, ctx)
    expect(line?.vendorName).toBeNull()
  })

  test('line update cannot restock a D-graded line via a client-supplied grade', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('inspecting')
    const line = makeLine(claim, { lineStatus: 'received', disposition: 'scrap' })
    line.conditionGrade = 'D'
    mockClaims.push(claim)
    mockLines.push(line)

    const clientSuppliedGradePayload: Record<string, unknown> = {
      id: LINE_ID,
      disposition: 'restock',
      conditionGrade: null,
    }
    await expect(updateClaimLineCommand.execute(clientSuppliedGradePayload as unknown as ClaimLineUpdateInput, ctx))
      .rejects
      .toMatchObject({ status: 400, body: { error: '[internal] invalid warranty claim line command input' } })

    await expect(updateClaimLineCommand.execute({ id: LINE_ID, disposition: 'restock' }, ctx))
      .rejects
      .toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.dispositionGradeConflict' } })

    expect(line.disposition).toBe('scrap')
    expect(line.conditionGrade).toBe('D')
  })

  test.each([
    ['warranty', 'A', 'restock'],
    ['warranty', 'B', 'repair'],
    ['warranty', 'C', 'scrap'],
    ['warranty', 'D', 'scrap'],
    ['return', 'A', 'restock'],
    ['return', 'B', null],
    ['return', 'C', null],
    ['return', 'D', null],
    ['core_return', 'A', 'restock'],
    ['core_return', 'B', null],
    ['core_return', 'C', 'scrap'],
    ['core_return', 'D', 'scrap'],
    ['vendor_recovery', 'A', null],
    ['vendor_recovery', 'B', null],
    ['vendor_recovery', 'C', null],
    ['vendor_recovery', 'D', null],
  ] as const)('receiving %s grade %s keeps the line editable with disposition %s', async (claimType, conditionGrade, disposition) => {
    const { ctx } = makeContext()
    const claim = makeClaim('received', { claimType })
    const line = makeLine(claim)
    mockClaims.push(claim)
    mockLines.push(line)

    await receiveClaimLineCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, id: LINE_ID, conditionGrade }, ctx)

    expect(line.conditionGrade).toBe(conditionGrade)
    expect(line.disposition).toBe(disposition)
    expect(mockEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ action: 'line_received', disposition }) }),
    ]))

    await updateClaimLineCommand.execute({
      id: LINE_ID,
      claimId: CLAIM_ID,
      disposition: line.disposition,
      qtyClaimed: 1,
      inspectionNotes: 'Updated after receiving',
    }, ctx)

    expect(line.inspectionNotes).toBe('Updated after receiving')
    expect(line.disposition).toBe(disposition)
  })

  test.each(['C', 'D'] as const)('receiving return grade %s preserves the chosen refund disposition', async (conditionGrade) => {
    const { ctx } = makeContext()
    const claim = makeClaim('received', { claimType: 'return' })
    const line = makeLine(claim, { disposition: 'refund' })
    mockClaims.push(claim)
    mockLines.push(line)

    await receiveClaimLineCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, id: LINE_ID, conditionGrade }, ctx)

    expect(line.disposition).toBe('refund')
    await expect(updateClaimLineCommand.execute({ id: LINE_ID, disposition: 'scrap' }, ctx))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.dispositionTypeConflict' } })
    await expect(updateClaimLineCommand.execute({ id: LINE_ID, disposition: 'restock' }, ctx))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.dispositionGradeConflict' } })
    expect(line.disposition).toBe('refund')
  })

  test.each(['C', 'D'] as const)('a quarantined return grade %s stays editable before and after release', async (conditionGrade) => {
    const { ctx } = makeContext()
    const claim = makeClaim('received', { claimType: 'return' })
    const line = makeLine(claim)
    mockClaims.push(claim)
    mockLines.push(line)
    resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValue({ ...defaultSettings, quarantineGrades: ['C', 'D'] })

    await receiveClaimLineCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, id: LINE_ID, conditionGrade }, ctx)

    expect(line.quarantineStatus).toBe('held')
    expect(line.disposition).toBeNull()
    expect(emitWarrantyClaimsEventMock).toHaveBeenCalledWith(
      'warranty_claims.claim_line.quarantined',
      expect.objectContaining({ lineId: LINE_ID, grade: conditionGrade }),
      expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID }),
    )

    await updateClaimLineCommand.execute({ id: LINE_ID, disposition: line.disposition, inspectionNotes: 'Held edit' }, ctx)
    expect(line.inspectionNotes).toBe('Held edit')
    await releaseClaimLineQuarantineCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, id: LINE_ID }, ctx)
    expect(line.quarantineStatus).toBe('released')
    await updateClaimLineCommand.execute({ id: LINE_ID, disposition: line.disposition, inspectionNotes: 'Released edit' }, ctx)
    expect(line.inspectionNotes).toBe('Released edit')
  })

  test('receiving and quarantine release version the line, not the parent claim', async () => {
    const { ctx } = makeContext()
    const claimUpdatedAt = new Date('2026-07-05T12:00:00.000Z')
    const lineUpdatedAt = new Date('2026-07-02T09:30:00.000Z')
    const claim = makeClaim('received', { updatedAt: claimUpdatedAt })
    const line = makeLine(claim, { updatedAt: lineUpdatedAt })
    mockClaims.push(claim)
    mockLines.push(line)

    await receiveClaimLineCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      id: LINE_ID,
      conditionGrade: 'B',
      updatedAt: lineUpdatedAt.toISOString(),
    }, ctx)

    expect(enforceWithGuardsMock).toHaveBeenCalledWith(
      ctx.container,
      expect.objectContaining({
        resourceKind: 'warranty_claims.claim_line',
        resourceId: LINE_ID,
        current: lineUpdatedAt,
        expected: lineUpdatedAt.toISOString(),
      }),
    )

    const receivedAt = line.updatedAt
    enforceWithGuardsMock.mockClear()

    await releaseClaimLineQuarantineCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      id: LINE_ID,
      updatedAt: receivedAt?.toISOString() ?? null,
    }, ctx)

    expect(line.quarantineStatus).toBe('released')
    expect(enforceWithGuardsMock).toHaveBeenCalledWith(
      ctx.container,
      expect.objectContaining({
        resourceKind: 'warranty_claims.claim_line',
        resourceId: LINE_ID,
        current: receivedAt,
      }),
    )
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
    const { ctx, queryEngine } = makeContext()

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

    await expect(assignClaimCommand.execute({ id: CLAIM_ID, assigneeUserId: USER_ID }, ctx))
      .resolves.toEqual({ claimId: CLAIM_ID })
    expect(claim.assigneeUserId).toBe(USER_ID)
    const staffLookup = queryEngine.query.mock.calls.find(([entityId, query]) => (
      entityId === 'staff:staff_team_member' && asRecord(query.filters).user_id === USER_ID
    ))
    expect(staffLookup?.[1].filters).toMatchObject({
      user_id: USER_ID,
      organization_id: ORG_ID,
      deleted_at: null,
      is_active: true,
    })
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

  test('update refreshes the customer name snapshot when only the customer id changes', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { customerId: PREVIOUS_CUSTOMER_ID, customerName: 'Previous Customer Ltd' })
    mockClaims.push(claim)

    await updateClaimCommand.execute({
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerId: CUSTOMER_ID,
    } as ClaimUpdateInput, ctx)
    expect(claim.customerId).toBe(CUSTOMER_ID)
    expect(claim.customerName).toBe('Acme Distribution')
  })

  test('update refreshes a stale customer name snapshot when the customer id is unchanged', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { customerName: 'Stale Name' })
    mockClaims.push(claim)

    await updateClaimCommand.execute({
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerId: CUSTOMER_ID,
    } as ClaimUpdateInput, ctx)
    expect(claim.customerId).toBe(CUSTOMER_ID)
    expect(claim.customerName).toBe('Acme Distribution')
  })

  test('update keeps the linked customer name on a name-only edit and stores a typed name for an unlinked claim', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { customerName: 'Stale Name' })
    mockClaims.push(claim)

    await updateClaimCommand.execute({
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerName: 'Typed Name',
    } as ClaimUpdateInput, ctx)
    expect(claim.customerId).toBe(CUSTOMER_ID)
    expect(claim.customerName).toBe('Acme Distribution')

    claim.customerId = null
    await updateClaimCommand.execute({
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerName: 'Walk-in Buyer',
    } as ClaimUpdateInput, ctx)
    expect(claim.customerId).toBeNull()
    expect(claim.customerName).toBe('Walk-in Buyer')
  })

  test('update clears the customer name snapshot when the customer link is cleared', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)

    await updateClaimCommand.execute({
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerId: null,
    } as ClaimUpdateInput, ctx)
    expect(claim.customerId).toBeNull()
    expect(claim.customerName).toBeNull()
  })

  test('update stores the typed customer name when the customer link is cleared', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)

    await updateClaimCommand.execute({
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerId: null,
      customerName: 'Walk-in Buyer',
    } as ClaimUpdateInput, ctx)
    expect(claim.customerId).toBeNull()
    expect(claim.customerName).toBe('Walk-in Buyer')
  })

  test('update clears the customer link even when the previous customer no longer exists', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { customerId: PREVIOUS_CUSTOMER_ID, customerName: 'Previous Customer Ltd' })
    mockClaims.push(claim)

    await updateClaimCommand.execute({
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      customerId: null,
    } as ClaimUpdateInput, ctx)
    expect(claim.customerId).toBeNull()
    expect(claim.customerName).toBeNull()
  })

  test.each([OTHER_ORDER_ID, null])('rejects changing order to %s while retaining a linked line without partial writes', async (orderId) => {
    const { ctx, dataEngine } = makeContext()
    const claim = makeClaim('draft', { orderId: ORDER_ID, orderNumber: 'SO-original', notes: 'Original notes' })
    const line = makeLine(claim, { orderLineId: ORDER_LINE_ID })
    mockClaims.push(claim)
    mockLines.push(line)
    const beforeClaim = { ...claim }
    const beforeLine = { ...line }

    await expect(updateClaimCommand.execute({ id: CLAIM_ID, orderId, notes: 'Must not persist' }, ctx))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.invalidReference' } })

    expect(claim).toEqual(beforeClaim)
    expect(line).toEqual(beforeLine)
    expect(mockEvents).toHaveLength(0)
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
    expect(emitWarrantyClaimsEventMock).not.toHaveBeenCalled()
  })

  test.each([ORDER_ID, OTHER_ORDER_ID])('validates retained lines when linking an unlinked header to %s', async (orderId) => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft')
    mockClaims.push(claim)
    mockLines.push(makeLine(claim, { orderLineId: ORDER_LINE_ID }))

    const update = updateClaimCommand.execute({ id: CLAIM_ID, orderId }, ctx)
    if (orderId === ORDER_ID) {
      await expect(update).resolves.toEqual({ claimId: CLAIM_ID })
      expect(claim.orderId).toBe(ORDER_ID)
    } else {
      await expect(update).rejects.toMatchObject({ status: 400 })
      expect(claim.orderId).toBeNull()
    }
  })

  test('checks every retained line, including a reference after an unlinked line', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { orderId: ORDER_ID })
    mockClaims.push(claim)
    mockLines.push(makeLine(claim), makeLine(claim, { id: LINE_TWO_ID, orderLineId: ORDER_LINE_ID }))

    await expect(updateClaimCommand.execute({ id: CLAIM_ID, orderId: OTHER_ORDER_ID }, ctx))
      .rejects.toMatchObject({ status: 400 })
    expect(claim.orderId).toBe(ORDER_ID)
  })

  test('ignores deleted, other-claim, and other-scope lines when changing an order', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { orderId: ORDER_ID })
    const otherClaim = makeClaim('draft', { id: LINE_TWO_ID, orderId: ORDER_ID })
    mockClaims.push(claim, otherClaim)
    mockLines.push(
      makeLine(claim, { orderLineId: ORDER_LINE_ID, deletedAt: new Date() }),
      makeLine(otherClaim, { id: LINE_TWO_ID, orderLineId: ORDER_LINE_ID }),
      { ...makeLine(claim, { orderLineId: ORDER_LINE_ID }), tenantId: LINE_TWO_ID },
      { ...makeLine(claim, { orderLineId: ORDER_LINE_ID }), organizationId: LINE_TWO_ID },
      makeLine(claim),
    )

    await expect(updateClaimCommand.execute({ id: CLAIM_ID, orderId: OTHER_ORDER_ID }, ctx))
      .resolves.toEqual({ claimId: CLAIM_ID })
    await expect(updateClaimCommand.execute({ id: CLAIM_ID, orderId: null }, ctx))
      .resolves.toEqual({ claimId: CLAIM_ID })
    expect(claim.orderId).toBeNull()
  })

  test('preserves ordinary header edits with historical missing references', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { orderId: ORDER_ID })
    mockClaims.push(claim)
    mockLines.push(makeLine(claim, { orderLineId: LINE_TWO_ID }))

    await expect(updateClaimCommand.execute({ id: CLAIM_ID, orderId: ORDER_ID, notes: 'Updated notes' }, ctx))
      .resolves.toEqual({ claimId: CLAIM_ID })
    expect(claim.notes).toBe('Updated notes')
  })

  test.each([undefined, ORDER_LINE_ID])('rejects a retained mismatched reference on a line save with orderLineId %s', async (orderLineId) => {
    const { ctx, dataEngine } = makeContext()
    const claim = makeClaim('draft', { orderId: OTHER_ORDER_ID })
    const line = makeLine(claim, { orderLineId: ORDER_LINE_ID })
    mockClaims.push(claim)
    mockLines.push(line)
    const beforeClaim = { ...claim }
    const beforeLine = { ...line }

    await expect(updateClaimLineCommand.execute({ id: LINE_ID, ...(orderLineId ? { orderLineId } : {}), faultDescription: 'Must not persist' }, ctx))
      .rejects.toMatchObject({ status: 400, body: { error: 'warranty_claims.errors.invalidReference' } })
    expect(claim).toEqual(beforeClaim)
    expect(line).toEqual(beforeLine)
    expect(mockEvents).toHaveLength(0)
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })

  test('allows line saves with matching references and explicit detachment of a mismatched line', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { orderId: ORDER_ID })
    const line = makeLine(claim, { orderLineId: ORDER_LINE_ID })
    mockClaims.push(claim)
    mockLines.push(line)

    await expect(updateClaimLineCommand.execute({ id: LINE_ID, faultDescription: 'Updated fault' }, ctx))
      .resolves.toEqual({ claimId: CLAIM_ID, lineId: LINE_ID })
    claim.orderId = OTHER_ORDER_ID
    await expect(updateClaimLineCommand.execute({ id: LINE_ID, orderLineId: null }, ctx))
      .resolves.toEqual({ claimId: CLAIM_ID, lineId: LINE_ID })
    expect(line.orderLineId).toBeNull()
  })

  test('preserves line edits with an unchanged historical missing reference', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { orderId: ORDER_ID })
    const line = makeLine(claim, { orderLineId: LINE_TWO_ID })
    mockClaims.push(claim)
    mockLines.push(line)

    await expect(updateClaimLineCommand.execute({ id: LINE_ID, faultDescription: 'Updated fault' }, ctx))
      .resolves.toEqual({ claimId: CLAIM_ID, lineId: LINE_ID })
    expect(line.orderLineId).toBe(LINE_TWO_ID)
    expect(line.faultDescription).toBe('Updated fault')
    await expect(updateClaimLineCommand.execute({ id: LINE_ID, orderLineId: SALES_RETURN_ID }, ctx))
      .rejects.toMatchObject({ status: 400 })
  })

  test('validates retained lines after acquiring the header lock', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('draft', { orderId: ORDER_ID })
    mockClaims.push(claim)
    mockBeforeClaimLock = () => mockLines.push(makeLine(claim, { orderLineId: ORDER_LINE_ID }))

    await expect(updateClaimCommand.execute({ id: CLAIM_ID, orderId: OTHER_ORDER_ID }, ctx))
      .rejects.toMatchObject({ status: 400 })
    expect(claim.orderId).toBe(ORDER_ID)
    expect(mockFindOneCalls).toContainEqual(expect.objectContaining({
      entity: 'WarrantyClaim',
      options: { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    }))
  })

  test.each(['create', 'update'])('validates the refreshed parent order under the lock on line %s', async (operation) => {
    const { ctx, dataEngine } = makeContext()
    const claim = makeClaim('draft', { orderId: ORDER_ID })
    const line = makeLine(claim, { orderLineId: ORDER_LINE_ID })
    mockClaims.push(claim)
    if (operation === 'update') mockLines.push(line)
    mockBeforeClaimLock = () => { claim.orderId = OTHER_ORDER_ID }

    const result = operation === 'create'
      ? createClaimLineCommand.execute({ claimId: CLAIM_ID, orderLineId: ORDER_LINE_ID, qtyClaimed: 1 }, ctx)
      : updateClaimLineCommand.execute({ id: LINE_ID, faultDescription: 'Must not persist' }, ctx)

    await expect(result).rejects.toMatchObject({ status: 400 })
    expect(mockLines).toHaveLength(operation === 'create' ? 0 : 1)
    expect(line.faultDescription).toBeNull()
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
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

function lineReplayScenario<TInput extends { id: string; updatedAt?: string | Date | null }>(
  command: CommandHandler<TInput, { lineId: string; claimId: string }>,
  input: TInput,
  expectedFields: Partial<WarrantyClaimLine>,
) {
  return {
    name: command.id,
    expectedFields,
    execute: (ctx: CommandRuntimeContext) => command.execute(input, ctx),
    prepare: (ctx: CommandRuntimeContext) => command.prepare!(input, ctx),
    captureAfter: (ctx: CommandRuntimeContext, result: { lineId: string; claimId: string }) => command.captureAfter!(input, result, ctx),
    undo: (ctx: CommandRuntimeContext, logEntry: CommandUndoLogEntry) => command.undo!({ input, ctx, logEntry }),
    redo: (ctx: CommandRuntimeContext, logEntry: CommandUndoLogEntry = {}) => command.redo!({ input, ctx, logEntry }),
  }
}

const replayInput = {
  id: LINE_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  updatedAt: '2026-07-01T00:00:00.000Z',
}

const lineReplayScenarios = [
  lineReplayScenario(receiveClaimLineCommand, {
    ...replayInput,
    conditionGrade: 'B',
    inspectionNotes: 'Receiving inspection',
  }, { conditionGrade: 'B', inspectionNotes: 'Receiving inspection' }),
  lineReplayScenario(releaseClaimLineQuarantineCommand, replayInput, { quarantineStatus: 'released' }),
  lineReplayScenario(setClaimLineAssessmentCommand, {
    ...replayInput,
    assessmentPayload: { recommendation: 'repair', confidence: 0.9 },
  }, { assessmentPayload: { recommendation: 'repair', confidence: 0.9 } }),
]

describe.each(lineReplayScenarios)('$name redo version handling', (scenario) => {
  beforeEach(() => {
    const actual = jest.requireActual<typeof import('@open-mercato/shared/lib/crud/optimistic-lock-command')>(
      '@open-mercato/shared/lib/crud/optimistic-lock-command',
    )
    enforceWithGuardsMock.mockImplementation(async (_container, input) => {
      actual.enforceCommandOptimisticLock({
        ...input,
        envValue: 'all',
      } as Parameters<typeof actual.enforceCommandOptimisticLock>[0])
    })
  })

  test('reapplies legacy input after undo without replaying its expired body version', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('received')
    const line = makeLine(claim, { quarantineStatus: 'held', creditAmount: '9' })
    mockClaims.push(claim)
    mockLines.push(line)
    const prepared = await scenario.prepare(ctx)
    const result = await scenario.execute(ctx)
    expect(line).toMatchObject(scenario.expectedFields)
    const logEntry = { snapshotBefore: prepared?.before, snapshotAfter: await scenario.captureAfter(ctx, result) }

    await scenario.undo(ctx, logEntry)
    expect(line.updatedAt?.toISOString()).not.toBe(replayInput.updatedAt)
    await expect(scenario.execute(ctx)).rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })

    await scenario.redo(ctx, logEntry)
    expect(line).toMatchObject(scenario.expectedFields)
    expect(line.creditAmount).toBe('9')
    expect(line.tenantId).toBe(TENANT_ID)
    expect(line.organizationId).toBe(ORG_ID)
    expect(mockEvents).toHaveLength(2)
  })

  test('accepts a current version supplied on the redo request', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('received')
    const line = makeLine(claim, { updatedAt: new Date('2026-10-13T10:00:00.000Z') })
    mockClaims.push(claim)
    mockLines.push(line)
    ctx.request = new Request('http://localhost/api/audit_logs/audit-logs/actions/redo', {
      method: 'POST',
      headers: { 'x-om-ext-optimistic-lock-expected-updated-at': line.updatedAt!.toISOString() },
    })

    await scenario.redo(ctx)
    expect(line).toMatchObject(scenario.expectedFields)
  })

  test('rejects a stale redo request header before writing', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('received')
    const line = makeLine(claim, { updatedAt: new Date('2026-10-13T10:00:00.000Z') })
    mockClaims.push(claim)
    mockLines.push(line)
    ctx.request = new Request('http://localhost/api/audit_logs/audit-logs/actions/redo', {
      method: 'POST',
      headers: { 'x-om-ext-optimistic-lock-expected-updated-at': replayInput.updatedAt },
    })
    const before = { ...line }

    await expect(scenario.redo(ctx)).rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
    expect(line).toEqual(before)
    expect(mockEvents).toHaveLength(0)
  })

  test('still rejects a locked parent claim on redo', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('closed')
    const line = makeLine(claim)
    mockClaims.push(claim)
    mockLines.push(line)
    const before = { ...line }

    await expect(scenario.redo(ctx)).rejects.toMatchObject({ status: 400 })
    expect(line).toEqual(before)
    expect(mockEvents).toHaveLength(0)
  })

  test('does not replay a line outside the caller organization', async () => {
    const { ctx } = makeContext()
    const claim = makeClaim('received')
    const line = makeLine(claim)
    line.organizationId = '99999999-9999-4999-8999-999999999999'
    mockClaims.push(claim)
    mockLines.push(line)
    const before = { ...line }

    await expect(scenario.redo(ctx)).rejects.toMatchObject({ status: 404 })
    expect(line).toEqual(before)
    expect(mockEvents).toHaveLength(0)
  })
})

type LineCommandResult = { lineId: string; claimId: string }

type LineSnapshots = { before: Record<string, unknown> | null; after: Record<string, unknown> | null }

type RecordedLineCommand = {
  lineId: string
  snapshots: LineSnapshots
  undo: () => Promise<void>
  undoWithSnapshots: (snapshots: LineSnapshots) => Promise<void>
}

type LineUndoScenario = {
  name: string
  claimStatus: WarrantyClaimStatus
  lineFields?: Partial<WarrantyClaimLine>
  run: (ctx: CommandRuntimeContext) => Promise<RecordedLineCommand>
  expectRestored: (line: WarrantyClaimLine) => void
}

const CONFLICT_REFUSAL = {
  status: 409,
  body: { error: 'This claim changed while you were editing it.', code: 'warranty_claims.errors.conflict' },
}

const LINE_LOCKED_REFUSAL = {
  status: 409,
  body: { error: 'This line is locked in the current claim status.', code: 'warranty_claims.errors.lineLocked' },
}

const RECEIVING_STATUS_REFUSAL = {
  status: 409,
  body: {
    error: 'Receiving details can only be saved when the claim is received or under inspection.',
    code: 'warranty_claims.errors.receivingStatusInvalid',
  },
}

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : null
}

async function recordLineCommand<TInput>(
  handler: CommandHandler<TInput, LineCommandResult>,
  input: TInput,
  ctx: CommandRuntimeContext,
): Promise<RecordedLineCommand> {
  const prepared = handler.prepare ? await handler.prepare(input, ctx) : null
  jest.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
  const result = await handler.execute(input, ctx)
  const after = await handler.captureAfter!(input, result, ctx)
  const snapshots: LineSnapshots = { before: snapshotRecord(prepared?.before), after: snapshotRecord(after) }
  const undoWithSnapshots = async (override: LineSnapshots) => {
    const logEntry = await handler.buildLog!({ input, result, ctx, snapshots: override })
    await handler.undo!({ input, logEntry: logEntry as never, ctx })
  }
  return {
    lineId: result.lineId,
    snapshots,
    undo: () => undoWithSnapshots(snapshots),
    undoWithSnapshots,
  }
}

const lineUndoScenarios: LineUndoScenario[] = [
  {
    name: 'create',
    claimStatus: 'approved',
    run: (ctx) => recordLineCommand(createClaimLineCommand, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      claimId: CLAIM_ID,
      qtyClaimed: 1,
      creditAmount: 40,
    }, ctx),
    expectRestored: (line) => expect(line.deletedAt).toBeInstanceOf(Date),
  },
  {
    name: 'update',
    claimStatus: 'approved',
    run: (ctx) => recordLineCommand(updateClaimLineCommand, { id: LINE_ID, creditAmount: 30 }, ctx),
    expectRestored: (line) => expect(line.creditAmount).toBe('10'),
  },
  {
    name: 'delete',
    claimStatus: 'approved',
    run: (ctx) => recordLineCommand(deleteClaimLineCommand, { id: LINE_ID }, ctx),
    expectRestored: (line) => expect(line.deletedAt).toBeNull(),
  },
  {
    name: 'receive',
    claimStatus: 'received',
    run: (ctx) => recordLineCommand(receiveClaimLineCommand, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      id: LINE_ID,
      conditionGrade: 'B',
    }, ctx),
    expectRestored: (line) => expect(line.conditionGrade).toBeNull(),
  },
  {
    name: 'release_quarantine',
    claimStatus: 'received',
    lineFields: { quarantineStatus: 'held' },
    run: (ctx) => recordLineCommand(releaseClaimLineQuarantineCommand, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      id: LINE_ID,
    }, ctx),
    expectRestored: (line) => expect(line.quarantineStatus).toBe('held'),
  },
  {
    name: 'set_assessment',
    claimStatus: 'approved',
    run: (ctx) => recordLineCommand(setClaimLineAssessmentCommand, {
      id: LINE_ID,
      assessmentPayload: { verdict: 'covered' },
    }, ctx),
    expectRestored: (line) => expect(line.assessmentPayload).toBeNull(),
  },
]

const mutableParentScenarios = lineUndoScenarios.filter((scenario) => scenario.claimStatus === 'approved')
const receivingScenarios = lineUndoScenarios.filter((scenario) => scenario.claimStatus === 'received')

function seedLineUndoScenario(scenario: LineUndoScenario): WarrantyClaim {
  const claim = makeClaim(scenario.claimStatus, { totalClaimedAmount: '10', totalApprovedAmount: '10' })
  mockClaims.push(claim)
  mockLines.push(makeLine(claim, { lineStatus: 'approved', creditAmount: '10', ...scenario.lineFields }))
  return claim
}

function lineById(lineId: string): WarrantyClaimLine {
  const line = mockLines.find((candidate) => candidate.id === lineId)
  if (!line) throw new Error(`[internal] test line ${lineId} missing`)
  return line
}

describe('warranty claim line undo staleness guard', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test.each(lineUndoScenarios.map((scenario) => [scenario.name, scenario] as const))(
    '%s undo rejects an intervening line edit without overwriting it or the header totals',
    async (_name, scenario) => {
      const { ctx } = makeContext()
      const claim = seedLineUndoScenario(scenario)
      const recorded = await scenario.run(ctx)
      const line = lineById(recorded.lineId)
      jest.setSystemTime(new Date('2026-07-03T00:00:00.000Z'))
      line.inspectionNotes = 'Intervening inspection'
      line.updatedAt = new Date('2026-07-03T00:00:00.000Z')
      claim.totalClaimedAmount = '999'
      claim.totalApprovedAmount = '888'
      const lineBeforeUndo = { ...line }

      await expect(recorded.undo()).rejects.toMatchObject(CONFLICT_REFUSAL)

      expect(line).toEqual(lineBeforeUndo)
      expect(line.inspectionNotes).toBe('Intervening inspection')
      expect(claim.totalClaimedAmount).toBe('999')
      expect(claim.totalApprovedAmount).toBe('888')
    },
  )

  test.each(lineUndoScenarios.map((scenario) => [scenario.name, scenario] as const))(
    '%s undo restores the before snapshot and recomputes the header totals',
    async (_name, scenario) => {
      const { ctx } = makeContext()
      const claim = seedLineUndoScenario(scenario)
      const recorded = await scenario.run(ctx)
      const line = lineById(recorded.lineId)
      claim.totalClaimedAmount = '999'
      claim.totalApprovedAmount = '888'

      await recorded.undo()

      scenario.expectRestored(line)
      expect(claim.totalClaimedAmount).toBe('10')
      expect(claim.totalApprovedAmount).toBe('10')
    },
  )

  test.each(lineUndoScenarios.map((scenario) => [scenario.name, scenario] as const))(
    '%s undo fails closed when the log entry has no after snapshot',
    async (_name, scenario) => {
      const { ctx } = makeContext()
      seedLineUndoScenario(scenario)
      const recorded = await scenario.run(ctx)
      const line = lineById(recorded.lineId)
      const lineBeforeUndo = { ...line }

      await expect(recorded.undoWithSnapshots({ before: recorded.snapshots.before, after: null }))
        .rejects.toMatchObject(CONFLICT_REFUSAL)

      expect(line).toEqual(lineBeforeUndo)
    },
  )

  test.each(lineUndoScenarios.map((scenario) => [scenario.name, scenario] as const))(
    '%s undo refuses when the parent claim was soft-deleted',
    async (_name, scenario) => {
      const { ctx } = makeContext()
      const claim = seedLineUndoScenario(scenario)
      const recorded = await scenario.run(ctx)
      const line = lineById(recorded.lineId)
      claim.deletedAt = new Date('2026-07-03T00:00:00.000Z')
      const lineBeforeUndo = { ...line }
      const totalsBeforeUndo = [claim.totalClaimedAmount, claim.totalApprovedAmount]

      await expect(recorded.undo()).rejects.toMatchObject(CONFLICT_REFUSAL)

      expect(line).toEqual(lineBeforeUndo)
      expect([claim.totalClaimedAmount, claim.totalApprovedAmount]).toEqual(totalsBeforeUndo)
    },
  )

  test.each(mutableParentScenarios.map((scenario) => [scenario.name, scenario] as const))(
    '%s undo refuses with lineLocked once the claim is closed',
    async (_name, scenario) => {
      const { ctx } = makeContext()
      const claim = seedLineUndoScenario(scenario)
      const recorded = await scenario.run(ctx)
      const line = lineById(recorded.lineId)
      claim.status = 'closed'
      const lineBeforeUndo = { ...line }
      const totalsBeforeUndo = [claim.totalClaimedAmount, claim.totalApprovedAmount]

      await expect(recorded.undo()).rejects.toMatchObject(LINE_LOCKED_REFUSAL)

      expect(line).toEqual(lineBeforeUndo)
      expect([claim.totalClaimedAmount, claim.totalApprovedAmount]).toEqual(totalsBeforeUndo)
    },
  )

  test.each(receivingScenarios.map((scenario) => [scenario.name, scenario] as const))(
    '%s undo refuses with receivingStatusInvalid once the claim left receiving',
    async (_name, scenario) => {
      const { ctx } = makeContext()
      const claim = seedLineUndoScenario(scenario)
      const recorded = await scenario.run(ctx)
      const line = lineById(recorded.lineId)
      claim.status = 'resolved'
      const lineBeforeUndo = { ...line }

      await expect(recorded.undo()).rejects.toMatchObject(RECEIVING_STATUS_REFUSAL)

      expect(line).toEqual(lineBeforeUndo)
    },
  )

  test('update undo after a quarantining receive keeps grade D and the hold', async () => {
    const { ctx } = makeContext()
    resolveEffectiveWarrantyClaimSettingsMock.mockResolvedValue({ ...defaultSettings, quarantineGrades: ['D'] })
    const claim = makeClaim('received', { totalClaimedAmount: '10', totalApprovedAmount: '10' })
    const line = makeLine(claim, { lineStatus: 'approved', creditAmount: '10' })
    mockClaims.push(claim)
    mockLines.push(line)

    const recorded = await recordLineCommand(updateClaimLineCommand, { id: LINE_ID, inspectionNotes: 'Bench tested' }, ctx)
    jest.setSystemTime(new Date('2026-07-03T00:00:00.000Z'))
    await receiveClaimLineCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, id: LINE_ID, conditionGrade: 'D' }, ctx)
    expect(line.conditionGrade).toBe('D')
    expect(line.quarantineStatus).toBe('held')

    await expect(recorded.undo()).rejects.toMatchObject(CONFLICT_REFUSAL)

    expect(line.conditionGrade).toBe('D')
    expect(line.quarantineStatus).toBe('held')
    expect(line.inspectionNotes).toBe('Bench tested')
  })

  test('set_assessment undo recomputes the header totals from restored amounts', async () => {
    const { ctx } = makeContext()
    const scenario = lineUndoScenarios.find((candidate) => candidate.name === 'set_assessment')!
    const claim = seedLineUndoScenario(scenario)
    const recorded = await scenario.run(ctx)
    const line = lineById(recorded.lineId)

    await recorded.undoWithSnapshots({
      before: { ...recorded.snapshots.before, creditAmount: '100' },
      after: recorded.snapshots.after,
    })

    expect(line.creditAmount).toBe('100')
    expect(line.assessmentPayload).toBeNull()
    expect(claim.totalClaimedAmount).toBe('100')
    expect(claim.totalApprovedAmount).toBe('100')
  })

  test('delete undo refuses instead of re-creating a missing line row', async () => {
    const { ctx } = makeContext()
    const scenario = lineUndoScenarios.find((candidate) => candidate.name === 'delete')!
    const claim = seedLineUndoScenario(scenario)
    const recorded = await scenario.run(ctx)
    mockLines = mockLines.filter((candidate) => candidate.id !== LINE_ID)

    await expect(recorded.undo()).rejects.toMatchObject(CONFLICT_REFUSAL)

    expect(mockLines.some((candidate) => candidate.id === LINE_ID)).toBe(false)
    expect(claim.totalClaimedAmount).toBe('0')
  })

  test('undo locks the live claim before the line, both scoped by tenant and organization', async () => {
    const { ctx } = makeContext()
    const scenario = lineUndoScenarios.find((candidate) => candidate.name === 'update')!
    seedLineUndoScenario(scenario)
    const recorded = await scenario.run(ctx)
    mockFindOneCalls = []

    await recorded.undo()

    const claimLockIndex = mockFindOneCalls.findIndex((call) => call.entity === 'WarrantyClaim')
    const lineLockIndex = mockFindOneCalls.findIndex((call) => call.entity === 'WarrantyClaimLine')
    expect(claimLockIndex).toBeGreaterThanOrEqual(0)
    expect(lineLockIndex).toBeGreaterThan(claimLockIndex)
    expect(mockFindOneCalls[claimLockIndex]).toMatchObject({
      where: { id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
      options: { lockMode: LockMode.PESSIMISTIC_WRITE },
    })
    expect(mockFindOneCalls[lineLockIndex]).toMatchObject({
      where: { id: LINE_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      options: { lockMode: LockMode.PESSIMISTIC_WRITE },
    })
    expect(mockFindOneCalls[lineLockIndex].where).not.toHaveProperty('deletedAt')
  })

  test('undo refuses a snapshot whose line lies outside the logged organization scope', async () => {
    const { ctx } = makeContext()
    const scenario = lineUndoScenarios.find((candidate) => candidate.name === 'update')!
    seedLineUndoScenario(scenario)
    const recorded = await scenario.run(ctx)
    const line = lineById(LINE_ID)
    const lineBeforeUndo = { ...line }
    const foreignOrgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

    await expect(recorded.undoWithSnapshots({
      before: { ...recorded.snapshots.before, organizationId: foreignOrgId },
      after: { ...recorded.snapshots.after, organizationId: foreignOrgId },
    })).rejects.toMatchObject(CONFLICT_REFUSAL)

    expect(line).toEqual(lineBeforeUndo)
  })
})
