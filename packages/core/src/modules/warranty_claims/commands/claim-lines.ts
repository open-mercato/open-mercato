import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import {
  claimLineCreateSchema,
  claimLineReceiveSchema,
  claimLineReleaseQuarantineSchema,
  claimLineUpdateSchema,
  type ClaimLineCreateInput,
  type ClaimLineReceiveInput,
  type ClaimLineReleaseQuarantineInput,
  type ClaimLineUpdateInput,
  type WarrantyClaimDisposition,
  type WarrantyClaimLineStatus,
  type WarrantyClaimWarrantyStatus,
} from '../data/validators'
import { emitWarrantyClaimsEvent } from '../events'
import {
  assertDispositionAllowedForGrade,
  suggestedDispositionForGrade,
  type ConditionGrade,
} from '../lib/grading'
import { assertDispositionAllowedForType } from '../lib/claimTypeConfig'
import { resolveEffectiveWarrantyClaimSettings } from '../lib/settings'
import { computeHeaderRollups, lineStatusGuards } from '../lib/stateMachine'
import {
  WARRANTY_CLAIM_LINE_RESOURCE_KIND,
  WARRANTY_CLAIM_RESOURCE_KIND,
  appendClaimEvent,
  enforceWarrantyClaimOptimisticLock,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  requireScopedClaim,
  type WarrantyClaimScope,
} from './shared'
import { assertClaimedQtyWithinSold, validateClaimReferences } from './claims'

const claimCrudEvents: CrudEventsConfig = {
  module: 'warranty_claims',
  entity: 'claim',
  persistent: true,
}

const lineDeleteSchema = z
  .object({
    id: z.string().uuid(),
    claimId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
  })
  .strict()

type LineDeleteInput = z.infer<typeof lineDeleteSchema>

const lineSetAssessmentSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
    assessmentPayload: z.record(z.string(), z.unknown()),
    updatedAt: z.union([z.string().datetime(), z.date()]).nullable().optional(),
  })
  .strict()

type LineSetAssessmentInput = z.infer<typeof lineSetAssessmentSchema>

type ScopeInput = {
  organizationId?: string | null
  tenantId?: string | null
}

type LineSnapshot = {
  id: string
  claimId: string
  organizationId: string
  tenantId: string
  lineNo: number
  productId: string | null
  variantId: string | null
  sku: string | null
  productName: string | null
  orderLineId: string | null
  serialNumber: string | null
  lotNumber: string | null
  purchaseDate: string | null
  warrantyMonths: number | null
  warrantyExpiresAt: string | null
  warrantyStatus: WarrantyClaimWarrantyStatus
  faultCode: string | null
  faultDescription: string | null
  qtyClaimed: string
  qtyApproved: string | null
  qtyReceived: string | null
  conditionOnReceipt: string | null
  conditionGrade: string | null
  quarantineStatus: string
  inspectionNotes: string | null
  assessmentPayload: Record<string, unknown> | null
  disposition: WarrantyClaimDisposition | null
  lineStatus: WarrantyClaimLineStatus
  creditAmount: string | null
  restockingFee: string | null
  coreChargeAmount: string | null
  coreCreditAmount: string | null
  vendorClaimLineId: string | null
  vendorName: string | null
  deletedAt: string | null
  updatedAt: string | null
}

type LineUndoPayload = {
  before?: LineSnapshot | null
  after?: LineSnapshot | null
}

const mutableParentStatuses = new Set([
  'draft',
  'submitted',
  'in_review',
  'info_requested',
  'approved',
  'received',
  'inspecting',
])

function parseCommandInput<T>(schema: z.ZodType<T>, rawInput: unknown): T {
  const result = schema.safeParse(rawInput ?? {})
  if (!result.success) {
    throw new CrudHttpError(400, { error: '[internal] invalid warranty claim line command input' })
  }
  return result.data
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function resolveScope(ctx: CommandRuntimeContext, input: ScopeInput): WarrantyClaimScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: '[internal] tenant scope required for warranty claim line command' })
  if (!organizationId) throw new CrudHttpError(400, { error: '[internal] organization scope required for warranty claim line command' })
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toDateOnlyIso(value: Date | string | null | undefined): string | null {
  const iso = toIso(value)
  return iso ? iso.slice(0, 10) : null
}

function toDateOnly(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function amountString(value: number | string | null | undefined, fallback = '0'): string | null {
  if (value === null) return null
  if (value === undefined) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return String(parsed)
}

function nullableAmountString(value: number | string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return amountString(value, '0')
}

function numberValue(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const copy = new Date(date.getTime())
  copy.setUTCDate(1)
  copy.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay))
  return copy
}

function computeWarrantyDates(
  purchaseDate: Date | null | undefined,
  warrantyMonths: number | null | undefined,
): { warrantyExpiresAt: Date | null; warrantyStatus: WarrantyClaimWarrantyStatus } {
  if (!purchaseDate || warrantyMonths === null || warrantyMonths === undefined) {
    return { warrantyExpiresAt: null, warrantyStatus: 'unknown' }
  }
  const warrantyExpiresAt = addMonths(purchaseDate, warrantyMonths)
  const warrantyStatus = warrantyExpiresAt.getTime() >= Date.now() ? 'in_warranty' : 'out_of_warranty'
  return { warrantyExpiresAt, warrantyStatus }
}

function claimIdOf(line: WarrantyClaimLine): string {
  const claim = line.claim
  if (typeof claim === 'object' && claim && 'id' in claim && typeof claim.id === 'string') return claim.id
  return String(claim)
}

function claimOf(line: WarrantyClaimLine): WarrantyClaim | null {
  const claim = line.claim
  if (typeof claim === 'object' && claim && 'id' in claim && typeof claim.id === 'string') return claim as WarrantyClaim
  return null
}

function sameDateValue(left: Date | null | undefined, right: Date | null | undefined): boolean {
  const leftTime = left instanceof Date ? left.getTime() : null
  const rightTime = right instanceof Date ? right.getTime() : null
  return leftTime === rightTime
}

function assertParentMutable(claim: WarrantyClaim): void {
  if (!mutableParentStatuses.has(claim.status)) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.lineLocked' })
  }
}

function assertReceivingStatus(claim: WarrantyClaim): void {
  if (claim.status !== 'received' && claim.status !== 'inspecting') {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.receivingStatusInvalid' })
  }
}

function toConditionGrade(value: string | null | undefined): ConditionGrade | null {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D') return value
  return null
}

function assertLineQuantities(line: WarrantyClaimLine): void {
  const qtyClaimed = numberValue(line.qtyClaimed)
  const qtyApproved = line.qtyApproved === null || line.qtyApproved === undefined ? null : numberValue(line.qtyApproved)
  const qtyReceived = line.qtyReceived === null || line.qtyReceived === undefined ? null : numberValue(line.qtyReceived)
  if (qtyClaimed < 0 || (qtyApproved !== null && qtyApproved < 0) || (qtyReceived !== null && qtyReceived < 0)) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.lineLocked' })
  }
  if (qtyApproved !== null && qtyApproved > qtyClaimed) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.lineLocked' })
  }
  if (qtyReceived !== null && qtyReceived > qtyClaimed) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.lineLocked' })
  }
}

function assertLineStatusMove(from: WarrantyClaimLineStatus, to: WarrantyClaimLineStatus): void {
  if (from === to) return
  if (lineStatusGuards[from].includes(to)) return
  throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidTransition' })
}

function buildLineCreateData(
  claim: WarrantyClaim,
  input: ClaimLineCreateInput,
  lineNo: number,
): Partial<WarrantyClaimLine> & {
  id: string
  claim: WarrantyClaim
  organizationId: string
  tenantId: string
  lineNo: number
  qtyClaimed: string
  lineStatus: WarrantyClaimLineStatus
  warrantyStatus: WarrantyClaimWarrantyStatus
  createdAt: Date
  updatedAt: Date
} {
  const purchaseDate = input.purchaseDate ?? null
  const warrantyMonths = input.warrantyMonths ?? null
  const computedWarranty = computeWarrantyDates(purchaseDate, warrantyMonths)
  return {
    id: randomUUID(),
    claim,
    organizationId: claim.organizationId,
    tenantId: claim.tenantId,
    lineNo,
    productId: input.productId ?? null,
    variantId: input.variantId ?? null,
    sku: input.sku ?? null,
    productName: input.productName ?? null,
    orderLineId: input.orderLineId ?? null,
    serialNumber: input.serialNumber ?? null,
    lotNumber: input.lotNumber ?? null,
    purchaseDate,
    warrantyMonths,
    warrantyExpiresAt: input.warrantyExpiresAt ?? computedWarranty.warrantyExpiresAt,
    warrantyStatus: input.warrantyStatus ?? computedWarranty.warrantyStatus,
    faultCode: input.faultCode ?? null,
    faultDescription: input.faultDescription ?? null,
    qtyClaimed: amountString(input.qtyClaimed, '1') ?? '1',
    qtyApproved: nullableAmountString(input.qtyApproved),
    qtyReceived: nullableAmountString(input.qtyReceived),
    conditionOnReceipt: input.conditionOnReceipt ?? null,
    inspectionNotes: input.inspectionNotes ?? null,
    disposition: input.disposition ?? null,
    lineStatus: 'pending',
    creditAmount: nullableAmountString(input.creditAmount),
    restockingFee: nullableAmountString(input.restockingFee),
    coreChargeAmount: nullableAmountString(input.coreChargeAmount),
    coreCreditAmount: nullableAmountString(input.coreCreditAmount),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function applyLineUpdate(line: WarrantyClaimLine, input: ClaimLineUpdateInput): void {
  const purchaseDateChanged = hasOwn(input, 'purchaseDate') && !sameDateValue(line.purchaseDate ?? null, input.purchaseDate ?? null)
  const warrantyMonthsChanged = hasOwn(input, 'warrantyMonths') && (line.warrantyMonths ?? null) !== (input.warrantyMonths ?? null)
  const hasExplicitWarranty = hasOwn(input, 'warrantyExpiresAt') || hasOwn(input, 'warrantyStatus')
  if (hasOwn(input, 'lineNo') && input.lineNo !== undefined) line.lineNo = input.lineNo
  if (hasOwn(input, 'productId')) line.productId = input.productId ?? null
  if (hasOwn(input, 'variantId')) line.variantId = input.variantId ?? null
  if (hasOwn(input, 'sku')) line.sku = input.sku ?? null
  if (hasOwn(input, 'productName')) line.productName = input.productName ?? null
  if (hasOwn(input, 'orderLineId')) line.orderLineId = input.orderLineId ?? null
  if (hasOwn(input, 'serialNumber')) line.serialNumber = input.serialNumber ?? null
  if (hasOwn(input, 'lotNumber')) line.lotNumber = input.lotNumber ?? null
  if (hasOwn(input, 'purchaseDate')) line.purchaseDate = input.purchaseDate ?? null
  if (hasOwn(input, 'warrantyMonths')) line.warrantyMonths = input.warrantyMonths ?? null
  if (hasOwn(input, 'warrantyExpiresAt')) line.warrantyExpiresAt = input.warrantyExpiresAt ?? null
  if (hasOwn(input, 'warrantyStatus') && input.warrantyStatus) line.warrantyStatus = input.warrantyStatus
  if (hasOwn(input, 'faultCode')) line.faultCode = input.faultCode ?? null
  if (hasOwn(input, 'faultDescription')) line.faultDescription = input.faultDescription ?? null
  if (hasOwn(input, 'qtyClaimed') && input.qtyClaimed !== undefined) line.qtyClaimed = amountString(input.qtyClaimed, '1') ?? '1'
  if (hasOwn(input, 'qtyApproved')) line.qtyApproved = nullableAmountString(input.qtyApproved)
  if (hasOwn(input, 'qtyReceived')) line.qtyReceived = nullableAmountString(input.qtyReceived)
  if (hasOwn(input, 'conditionOnReceipt')) line.conditionOnReceipt = input.conditionOnReceipt ?? null
  if (hasOwn(input, 'inspectionNotes')) line.inspectionNotes = input.inspectionNotes ?? null
  if (hasOwn(input, 'disposition')) line.disposition = input.disposition ?? null
  if (hasOwn(input, 'lineStatus') && input.lineStatus) {
    assertLineStatusMove(line.lineStatus, input.lineStatus)
    line.lineStatus = input.lineStatus
  }
  if (hasOwn(input, 'creditAmount')) line.creditAmount = nullableAmountString(input.creditAmount)
  if (hasOwn(input, 'restockingFee')) line.restockingFee = nullableAmountString(input.restockingFee)
  if (hasOwn(input, 'coreChargeAmount')) line.coreChargeAmount = nullableAmountString(input.coreChargeAmount)
  if (hasOwn(input, 'coreCreditAmount')) line.coreCreditAmount = nullableAmountString(input.coreCreditAmount)
  if ((purchaseDateChanged || warrantyMonthsChanged) && !hasExplicitWarranty) {
    const computedWarranty = computeWarrantyDates(line.purchaseDate ?? null, line.warrantyMonths ?? null)
    line.warrantyExpiresAt = computedWarranty.warrantyExpiresAt
    line.warrantyStatus = computedWarranty.warrantyStatus
  }
  line.updatedAt = new Date()
}

function snapshotLine(line: WarrantyClaimLine): LineSnapshot {
  return {
    id: line.id,
    claimId: claimIdOf(line),
    organizationId: line.organizationId,
    tenantId: line.tenantId,
    lineNo: line.lineNo,
    productId: line.productId ?? null,
    variantId: line.variantId ?? null,
    sku: line.sku ?? null,
    productName: line.productName ?? null,
    orderLineId: line.orderLineId ?? null,
    serialNumber: line.serialNumber ?? null,
    lotNumber: line.lotNumber ?? null,
    purchaseDate: toDateOnlyIso(line.purchaseDate),
    warrantyMonths: line.warrantyMonths ?? null,
    warrantyExpiresAt: toDateOnlyIso(line.warrantyExpiresAt),
    warrantyStatus: line.warrantyStatus,
    faultCode: line.faultCode ?? null,
    faultDescription: line.faultDescription ?? null,
    qtyClaimed: line.qtyClaimed,
    qtyApproved: line.qtyApproved ?? null,
    qtyReceived: line.qtyReceived ?? null,
    conditionOnReceipt: line.conditionOnReceipt ?? null,
    conditionGrade: line.conditionGrade ?? null,
    quarantineStatus: line.quarantineStatus,
    inspectionNotes: line.inspectionNotes ?? null,
    assessmentPayload: line.assessmentPayload ?? null,
    disposition: line.disposition ?? null,
    lineStatus: line.lineStatus,
    creditAmount: line.creditAmount ?? null,
    restockingFee: line.restockingFee ?? null,
    coreChargeAmount: line.coreChargeAmount ?? null,
    coreCreditAmount: line.coreCreditAmount ?? null,
    vendorClaimLineId: line.vendorClaimLineId ?? null,
    vendorName: line.vendorName ?? null,
    deletedAt: toIso(line.deletedAt),
    updatedAt: toIso(line.updatedAt),
  }
}

async function loadLineSnapshot(
  em: EntityManager,
  lineId: string,
  scope: WarrantyClaimScope,
): Promise<LineSnapshot | null> {
  const line = await findOneWithDecryption(
    em,
    WarrantyClaimLine,
    { id: lineId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { populate: ['claim'] },
    scope,
  )
  return line ? snapshotLine(line) : null
}

function restoreLineFromSnapshot(line: WarrantyClaimLine, snapshot: LineSnapshot): void {
  line.lineNo = snapshot.lineNo
  line.productId = snapshot.productId
  line.variantId = snapshot.variantId
  line.sku = snapshot.sku
  line.productName = snapshot.productName
  line.orderLineId = snapshot.orderLineId
  line.serialNumber = snapshot.serialNumber
  line.lotNumber = snapshot.lotNumber
  line.purchaseDate = toDateOnly(snapshot.purchaseDate)
  line.warrantyMonths = snapshot.warrantyMonths
  line.warrantyExpiresAt = toDateOnly(snapshot.warrantyExpiresAt)
  line.warrantyStatus = snapshot.warrantyStatus
  line.faultCode = snapshot.faultCode
  line.faultDescription = snapshot.faultDescription
  line.qtyClaimed = snapshot.qtyClaimed
  line.qtyApproved = snapshot.qtyApproved
  line.qtyReceived = snapshot.qtyReceived
  line.conditionOnReceipt = snapshot.conditionOnReceipt
  line.conditionGrade = snapshot.conditionGrade
  line.quarantineStatus = snapshot.quarantineStatus
  line.inspectionNotes = snapshot.inspectionNotes
  line.assessmentPayload = snapshot.assessmentPayload
  line.disposition = snapshot.disposition
  line.lineStatus = snapshot.lineStatus
  line.creditAmount = snapshot.creditAmount
  line.restockingFee = snapshot.restockingFee
  line.coreChargeAmount = snapshot.coreChargeAmount
  line.coreCreditAmount = snapshot.coreCreditAmount
  line.vendorClaimLineId = snapshot.vendorClaimLineId
  line.vendorName = snapshot.vendorName
  line.deletedAt = toDate(snapshot.deletedAt)
  line.updatedAt = new Date()
}

async function recomputeClaimRollups(em: EntityManager, claim: WarrantyClaim): Promise<void> {
  const lines = await findWithDecryption(
    em,
    WarrantyClaimLine,
    {
      claim: claim.id,
      tenantId: claim.tenantId,
      organizationId: claim.organizationId,
      deletedAt: null,
    },
    {},
    { tenantId: claim.tenantId, organizationId: claim.organizationId },
  )
  const totals = computeHeaderRollups(lines)
  claim.totalClaimedAmount = String(totals.totalClaimedAmount)
  claim.totalApprovedAmount = String(totals.totalApprovedAmount)
  claim.updatedAt = new Date()
}

async function requireScopedLine(
  em: EntityManager,
  lineId: string,
  scope: WarrantyClaimScope,
): Promise<WarrantyClaimLine> {
  const line = await findOneWithDecryption(
    em,
    WarrantyClaimLine,
    { id: lineId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { populate: ['claim'] },
    scope,
  )
  if (!line) throw new CrudHttpError(404, { error: 'warranty_claims.errors.notFound' })
  return line
}

async function emitClaimUpdated(ctx: CommandRuntimeContext, claim: WarrantyClaim): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: claim,
    identifiers: { id: claim.id, organizationId: claim.organizationId, tenantId: claim.tenantId },
    indexer: { entityType: E.warranty_claims.warranty_claim },
    events: claimCrudEvents,
  })
  await invalidateCrudCache(
    ctx.container,
    'warranty_claims.claim',
    { id: claim.id, organizationId: claim.organizationId, tenantId: claim.tenantId },
    ctx.auth?.tenantId ?? null,
    'warranty_claims.claim_line.rollup',
  )
}

async function emitLineCrud(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  line: WarrantyClaimLine,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: line,
    identifiers: { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
    indexer: { entityType: E.warranty_claims.warranty_claim_line },
  })
  await invalidateCrudCache(
    ctx.container,
    'warranty_claims.claim_line',
    { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
    ctx.auth?.tenantId ?? null,
    `warranty_claims.claim_line.${action}`,
  )
}

async function emitLineUndoCrud(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  line: WarrantyClaimLine,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
    entity: line,
    identifiers: { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
    indexer: { entityType: E.warranty_claims.warranty_claim_line },
  })
  await invalidateCrudCache(
    ctx.container,
    'warranty_claims.claim_line',
    { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
    ctx.auth?.tenantId ?? null,
    `warranty_claims.claim_line.undo.${action}`,
  )
}

function buildLineLog(
  actionLabel: string,
  resourceId: string,
  snapshots: { before?: unknown; after?: unknown },
): {
  actionLabel: string
  resourceKind: string
  resourceId: string
  parentResourceKind: string | null
  parentResourceId: string | null
  tenantId: string | null
  organizationId: string | null
  snapshotBefore: unknown
  snapshotAfter: unknown
  payload: { undo: LineUndoPayload }
} {
  const after = snapshots.after as LineSnapshot | null | undefined
  const before = snapshots.before as LineSnapshot | null | undefined
  return {
    actionLabel,
    resourceKind: WARRANTY_CLAIM_LINE_RESOURCE_KIND,
    resourceId,
    parentResourceKind: WARRANTY_CLAIM_RESOURCE_KIND,
    parentResourceId: after?.claimId ?? before?.claimId ?? null,
    tenantId: after?.tenantId ?? before?.tenantId ?? null,
    organizationId: after?.organizationId ?? before?.organizationId ?? null,
    snapshotBefore: before ?? null,
    snapshotAfter: after ?? null,
    payload: { undo: { before: before ?? null, after: after ?? null } },
  }
}

const createClaimLineCommand: CommandHandler<ClaimLineCreateInput, { lineId: string; claimId: string }> = {
  id: 'warranty_claims.claim_line.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = parseCommandInput(claimLineCreateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const claim = await requireScopedClaim(em, input.claimId, scope)
    assertDispositionAllowedForType(claim.claimType, input.disposition ?? null)
    await enforceWarrantyClaimOptimisticLock(ctx, claim)
    assertParentMutable(claim)
    if (input.orderLineId) {
      await validateClaimReferences(ctx, scope, {
        lineOrderRefs: [{ orderLineId: input.orderLineId, orderId: claim.orderId ?? null }],
      })
    }
    const existingLines = await findWithDecryption(
      em,
      WarrantyClaimLine,
      {
        claim: claim.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      {},
      scope,
    )
    await assertClaimedQtyWithinSold(ctx, scope, existingLines, {
      orderLineId: input.orderLineId ?? null,
      qtyClaimed: amountString(input.qtyClaimed, '1') ?? '1',
    })
    const nextLineNo = input.lineNo ?? existingLines.reduce((max, line) => Math.max(max, line.lineNo), 0) + 1
    let line!: WarrantyClaimLine
    await withAtomicFlush(em, [
      () => {
        line = em.create(WarrantyClaimLine, buildLineCreateData(claim, input, nextLineNo))
        assertLineQuantities(line)
        em.persist(line)
      },
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.create' })
    await emitClaimUpdated(ctx, claim)
    await emitLineCrud(ctx, 'created', line)
    return { lineId: line.id, claimId: claim.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(claimLineCreateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadLineSnapshot(em, result.lineId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildLineLog('warranty_claims.audit.claim_line.create', result.lineId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LineUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await findOneWithDecryption(em, WarrantyClaimLine, { id: after.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, { populate: ['claim'] }, scope)
    const claim = line ? claimOf(line) : null
    if (!line || !claim) return
    await withAtomicFlush(em, [
      () => {
        line.deletedAt = new Date()
        line.updatedAt = new Date()
      },
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.create.undo' })
    await emitClaimUpdated(ctx, claim)
    await emitLineUndoCrud(ctx, 'deleted', line)
  },
}

const updateClaimLineCommand: CommandHandler<ClaimLineUpdateInput, { lineId: string; claimId: string }> = {
  id: 'warranty_claims.claim_line.update',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(claimLineUpdateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: await loadLineSnapshot(em, input.id, scope) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(claimLineUpdateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await requireScopedLine(em, input.id, scope)
    const claim = claimOf(line) ?? await requireScopedClaim(em, input.claimId ?? claimIdOf(line), scope)
    if (input.claimId && input.claimId !== claim.id) {
      throw new CrudHttpError(400, { error: 'warranty_claims.errors.notFound' })
    }
    assertParentMutable(claim)
    await enforceWarrantyClaimOptimisticLock(ctx, line, WARRANTY_CLAIM_LINE_RESOURCE_KIND)
    if (hasOwn(input, 'orderLineId') && input.orderLineId && (input.orderLineId ?? null) !== (line.orderLineId ?? null)) {
      await validateClaimReferences(ctx, scope, {
        lineOrderRefs: [{ orderLineId: input.orderLineId, orderId: claim.orderId ?? null }],
      })
    }
    if (hasOwn(input, 'disposition')) {
      assertDispositionAllowedForType(claim.claimType, input.disposition ?? null)
      const grade = hasOwn(input, 'conditionGrade') ? toConditionGrade(input.conditionGrade ?? null) : toConditionGrade(line.conditionGrade)
      assertDispositionAllowedForGrade(grade, input.disposition ?? null)
    }
    if (hasOwn(input, 'qtyClaimed') || hasOwn(input, 'orderLineId')) {
      await assertClaimedQtyWithinSold(ctx, scope, claim.id, {
        id: line.id,
        orderLineId: hasOwn(input, 'orderLineId') ? (input.orderLineId ?? null) : (line.orderLineId ?? null),
        qtyClaimed: hasOwn(input, 'qtyClaimed')
          ? (amountString(input.qtyClaimed, '1') ?? '1')
          : line.qtyClaimed,
      })
    }
    await withAtomicFlush(em, [
      () => {
        applyLineUpdate(line, input)
        assertLineQuantities(line)
      },
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.update' })
    await emitClaimUpdated(ctx, claim)
    await emitLineCrud(ctx, 'updated', line)
    return { lineId: line.id, claimId: claim.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(claimLineUpdateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadLineSnapshot(em, result.lineId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildLineLog('warranty_claims.audit.claim_line.update', result.lineId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LineUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await findOneWithDecryption(em, WarrantyClaimLine, { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, { populate: ['claim'] }, scope)
    if (!line) return
    const claim = claimOf(line) ?? await requireScopedClaim(em, before.claimId, scope)
    await withAtomicFlush(em, [
      () => restoreLineFromSnapshot(line, before),
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.update.undo' })
    await emitClaimUpdated(ctx, claim)
    await emitLineUndoCrud(ctx, 'updated', line)
  },
}

const deleteClaimLineCommand: CommandHandler<LineDeleteInput, { lineId: string; claimId: string }> = {
  id: 'warranty_claims.claim_line.delete',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(lineDeleteSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: await loadLineSnapshot(em, input.id, scope) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(lineDeleteSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await requireScopedLine(em, input.id, scope)
    const claim = claimOf(line) ?? await requireScopedClaim(em, input.claimId ?? claimIdOf(line), scope)
    if (input.claimId && input.claimId !== claim.id) {
      throw new CrudHttpError(400, { error: 'warranty_claims.errors.notFound' })
    }
    assertParentMutable(claim)
    await enforceWarrantyClaimOptimisticLock(ctx, line, WARRANTY_CLAIM_LINE_RESOURCE_KIND)
    await withAtomicFlush(em, [
      () => {
        line.deletedAt = new Date()
        line.updatedAt = new Date()
      },
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.delete' })
    await emitClaimUpdated(ctx, claim)
    await emitLineCrud(ctx, 'deleted', line)
    return { lineId: line.id, claimId: claim.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(lineDeleteSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadLineSnapshot(em, result.lineId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildLineLog('warranty_claims.audit.claim_line.delete', result.lineId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LineUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let line = await findOneWithDecryption(em, WarrantyClaimLine, { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, { populate: ['claim'] }, scope)
    const claim = (line ? claimOf(line) : null) ?? await requireScopedClaim(em, before.claimId, scope)
    await withAtomicFlush(em, [
      () => {
        if (!line) {
          line = em.create(WarrantyClaimLine, {
            id: before.id,
            claim,
            organizationId: before.organizationId,
            tenantId: before.tenantId,
            lineNo: before.lineNo,
            qtyClaimed: before.qtyClaimed,
            lineStatus: before.lineStatus,
            warrantyStatus: before.warrantyStatus,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          em.persist(line)
        }
        restoreLineFromSnapshot(line, before)
        line.deletedAt = null
      },
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.delete.undo' })
    if (!line) return
    await emitClaimUpdated(ctx, claim)
    await emitLineUndoCrud(ctx, 'created', line)
  },
}

const receiveClaimLineCommand: CommandHandler<ClaimLineReceiveInput, { lineId: string; claimId: string }> = {
  id: 'warranty_claims.claim_line.receive',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(claimLineReceiveSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: await loadLineSnapshot(em, input.id, scope) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(claimLineReceiveSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await requireScopedLine(em, input.id, scope)
    const claim = await requireScopedClaim(em, claimIdOf(line), scope)
    assertReceivingStatus(claim)
    await enforceWarrantyClaimOptimisticLock(ctx, claim, WARRANTY_CLAIM_RESOURCE_KIND, input.updatedAt ?? undefined)

    const grade: ConditionGrade = input.conditionGrade
    const effectiveSettings = await resolveEffectiveWarrantyClaimSettings(em, scope)
    const shouldQuarantine = Boolean(effectiveSettings.quarantineGrades?.includes(grade))

    await withAtomicFlush(em, [
      () => {
        line.conditionGrade = grade
        if (input.inspectionNotes !== undefined) line.inspectionNotes = input.inspectionNotes ?? null

        const suggestedDisposition = suggestedDispositionForGrade(grade)
        if (!line.disposition && suggestedDisposition) {
          assertDispositionAllowedForGrade(grade, suggestedDisposition)
          if (suggestedDisposition === 'restock' || suggestedDisposition === 'repair' || suggestedDisposition === 'scrap') {
            line.disposition = suggestedDisposition
          }
        }
        assertDispositionAllowedForGrade(grade, line.disposition ?? null)

        if (shouldQuarantine) line.quarantineStatus = 'held'
        line.updatedAt = new Date()
        appendClaimEvent(em, claim, 'system', {
          visibility: 'internal',
          payload: {
            action: 'line_received',
            lineId: line.id,
            conditionGrade: grade,
            disposition: line.disposition ?? null,
            quarantineStatus: line.quarantineStatus,
            quarantineHeld: shouldQuarantine,
          },
          actorUserId: ctx.auth?.sub ?? null,
        })
      },
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.receive' })

    await emitClaimUpdated(ctx, claim)
    await emitLineCrud(ctx, 'updated', line)
    if (shouldQuarantine) {
      await emitWarrantyClaimsEvent('warranty_claims.claim_line.quarantined', {
        id: line.id,
        claimId: claim.id,
        lineId: line.id,
        grade,
        scope,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      }, { persistent: true })
    }
    return { lineId: line.id, claimId: claim.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(claimLineReceiveSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadLineSnapshot(em, result.lineId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildLineLog('warranty_claims.audit.claim_line.receive', result.lineId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LineUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await findOneWithDecryption(em, WarrantyClaimLine, { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, { populate: ['claim'] }, scope)
    if (!line) return
    const claim = await requireScopedClaim(em, before.claimId, scope)
    await withAtomicFlush(em, [
      () => restoreLineFromSnapshot(line, before),
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.receive.undo' })
    await emitClaimUpdated(ctx, claim)
    await emitLineUndoCrud(ctx, 'updated', line)
  },
}

const releaseClaimLineQuarantineCommand: CommandHandler<ClaimLineReleaseQuarantineInput, { lineId: string; claimId: string }> = {
  id: 'warranty_claims.claim_line.release_quarantine',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(claimLineReleaseQuarantineSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: await loadLineSnapshot(em, input.id, scope) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(claimLineReleaseQuarantineSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await requireScopedLine(em, input.id, scope)
    const claim = await requireScopedClaim(em, claimIdOf(line), scope)
    assertReceivingStatus(claim)
    await enforceWarrantyClaimOptimisticLock(ctx, claim, WARRANTY_CLAIM_RESOURCE_KIND, input.updatedAt ?? undefined)

    await withAtomicFlush(em, [
      () => {
        line.quarantineStatus = 'released'
        line.updatedAt = new Date()
        appendClaimEvent(em, claim, 'system', {
          visibility: 'internal',
          payload: {
            action: 'line_quarantine_released',
            lineId: line.id,
            quarantineStatus: line.quarantineStatus,
          },
          actorUserId: ctx.auth?.sub ?? null,
        })
      },
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.release_quarantine' })

    await emitClaimUpdated(ctx, claim)
    await emitLineCrud(ctx, 'updated', line)
    return { lineId: line.id, claimId: claim.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(claimLineReleaseQuarantineSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadLineSnapshot(em, result.lineId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildLineLog('warranty_claims.audit.claim_line.release_quarantine', result.lineId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LineUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await findOneWithDecryption(em, WarrantyClaimLine, { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, { populate: ['claim'] }, scope)
    if (!line) return
    const claim = await requireScopedClaim(em, before.claimId, scope)
    await withAtomicFlush(em, [
      () => restoreLineFromSnapshot(line, before),
      () => recomputeClaimRollups(em, claim),
    ], { transaction: true, label: 'warranty_claims.claim_line.release_quarantine.undo' })
    await emitClaimUpdated(ctx, claim)
    await emitLineUndoCrud(ctx, 'updated', line)
  },
}

const setClaimLineAssessmentCommand: CommandHandler<LineSetAssessmentInput, { lineId: string; claimId: string }> = {
  id: 'warranty_claims.claim_line.set_assessment',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(lineSetAssessmentSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: await loadLineSnapshot(em, input.id, scope) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(lineSetAssessmentSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await requireScopedLine(em, input.id, scope)
    const claim = claimOf(line) ?? await requireScopedClaim(em, claimIdOf(line), scope)
    await enforceWarrantyClaimOptimisticLock(ctx, claim, WARRANTY_CLAIM_RESOURCE_KIND, input.updatedAt ?? undefined)

    await withAtomicFlush(em, [
      () => {
        line.assessmentPayload = input.assessmentPayload
        line.updatedAt = new Date()
        claim.updatedAt = new Date()
        appendClaimEvent(em, claim, 'system', {
          visibility: 'internal',
          body: 'AI assessment recorded',
          payload: {
            action: 'ai_assessment_recorded',
            lineId: line.id,
          },
          actorUserId: ctx.auth?.sub ?? null,
        })
      },
    ], { transaction: true, label: 'warranty_claims.claim_line.set_assessment' })

    await emitClaimUpdated(ctx, claim)
    await emitLineCrud(ctx, 'updated', line)
    return { lineId: line.id, claimId: claim.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(lineSetAssessmentSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadLineSnapshot(em, result.lineId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildLineLog('warranty_claims.audit.claim_line.set_assessment', result.lineId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LineUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await findOneWithDecryption(em, WarrantyClaimLine, { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, { populate: ['claim'] }, scope)
    if (!line) return
    const claim = claimOf(line) ?? await requireScopedClaim(em, before.claimId, scope)
    await withAtomicFlush(em, [
      () => restoreLineFromSnapshot(line, before),
    ], { transaction: true, label: 'warranty_claims.claim_line.set_assessment.undo' })
    await emitClaimUpdated(ctx, claim)
    await emitLineUndoCrud(ctx, 'updated', line)
  },
}

registerCommand(createClaimLineCommand)
registerCommand(updateClaimLineCommand)
registerCommand(deleteClaimLineCommand)
registerCommand(receiveClaimLineCommand)
registerCommand(releaseClaimLineQuarantineCommand)
registerCommand(setClaimLineAssessmentCommand)

export const claimLineCommands = [
  createClaimLineCommand,
  updateClaimLineCommand,
  deleteClaimLineCommand,
  receiveClaimLineCommand,
  releaseClaimLineQuarantineCommand,
  setClaimLineAssessmentCommand,
]

export {
  createClaimLineCommand,
  updateClaimLineCommand,
  deleteClaimLineCommand,
  receiveClaimLineCommand,
  releaseClaimLineQuarantineCommand,
  setClaimLineAssessmentCommand,
}
