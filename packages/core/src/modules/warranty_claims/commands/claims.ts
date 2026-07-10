import { randomUUID } from 'crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import {
  WarrantyClaim,
  WarrantyClaimLine,
} from '../data/entities'
import {
  CLAIM_FULFILLMENT_UPDATE_FIELDS,
  CLAIM_INTAKE_UPDATE_FIELDS,
  claimCreateSchema,
  claimUpdateSchema,
  assignClaimInputSchema,
  claimSetReturnLabelSchema,
  commentClaimInputSchema,
  transitionClaimInputSchema,
  vendorRecoveryInputSchema,
  type ClaimCreateInput,
  type ClaimInitialLineCreateInput,
  type ClaimUpdateInput,
  type AssignClaimInput,
  type ClaimSetReturnLabelInput,
  type CommentClaimInput,
  type TransitionClaimInput,
  type VendorRecoveryInput,
  type WarrantyClaimChannel,
  type WarrantyClaimLineStatus,
  type WarrantyClaimPriority,
  type WarrantyClaimDisposition,
  type WarrantyClaimStatus,
  type WarrantyClaimType,
  type WarrantyClaimWarrantyStatus,
} from '../data/validators'
import { WarrantyClaimNumberGenerator } from '../services/claimNumberGenerator'
import { emitWarrantyClaimsEvent } from '../events'
import { assertTransition, canResolveWithLineStatuses, computeHeaderRollups } from '../lib/stateMachine'
import { resolveEffectiveWarrantyClaimSettings, type WarrantyClaimEffectiveSettings } from '../lib/settings'
import { evaluateClaimRisk } from '../lib/risk'
import type { WarrantyAdjudicationEvaluator } from '../services/adjudicationEvaluator'
import type { WarrantyEntitlementInput, WarrantyEntitlementResolver } from '../services/entitlementResolver'
import {
  WARRANTY_CLAIM_RESOURCE_KIND,
  appendClaimEvent,
  enforceWarrantyClaimOptimisticLock,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  requireScopedClaim,
  type WarrantyClaimScope,
} from './shared'

const claimCrudEvents: CrudEventsConfig = {
  module: 'warranty_claims',
  entity: 'claim',
  persistent: true,
  buildPayload: (ctx) => {
    const claim = ctx.entity as WarrantyClaim | null
    return {
      id: ctx.identifiers.id,
      organizationId: ctx.identifiers.organizationId,
      tenantId: ctx.identifiers.tenantId,
      claimType: claim?.claimType ?? null,
      status: claim?.status ?? null,
    }
  },
}

const claimDeleteSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
  })
  .strict()

const submitClaimSchema = claimDeleteSchema.extend({
  actorCustomerId: z.string().uuid().optional(),
})
const escalateClaimInputSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    tenantId: z.string().uuid(),
    toLevel: z.coerce.number().int().min(1).max(1000),
    reassignToUserId: z.string().uuid().optional(),
  })
  .strict()

type ClaimDeleteInput = z.infer<typeof claimDeleteSchema>
type SubmitClaimInput = z.infer<typeof submitClaimSchema>
type EscalateClaimInput = z.infer<typeof escalateClaimInputSchema>
type EscalateClaimResult = { claimId: string; escalationLevel: number; escalated: boolean }
type ClaimSetReturnLabelResult = {
  claimId: string
  labelUrl: string | null
  trackingNumber: string | null
  carrier: string | null
}

type ScopeInput = {
  organizationId?: string | null
  tenantId?: string | null
}

type ClaimUpdateField =
  | (typeof CLAIM_INTAKE_UPDATE_FIELDS)[number]
  | (typeof CLAIM_FULFILLMENT_UPDATE_FIELDS)[number]

type ClaimLineSnapshot = {
  id: string
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
  inspectionNotes: string | null
  disposition: WarrantyClaimDisposition | null
  lineStatus: WarrantyClaimLineStatus
  creditAmount: string | null
  restockingFee: string | null
  coreChargeAmount: string | null
  coreCreditAmount: string | null
  vendorClaimLineId: string | null
  deletedAt: string | null
}

type ClaimSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  claimNumber: string
  claimType: WarrantyClaimType
  status: WarrantyClaimStatus
  channel: WarrantyClaimChannel
  priority: WarrantyClaimPriority
  customerId: string | null
  customerName: string | null
  externalRef: string | null
  intakeMessageRef: string | null
  contactEmail: string | null
  returnLabelUrl: string | null
  returnTrackingNumber: string | null
  returnCarrier: string | null
  vendorName: string | null
  vendorRef: string | null
  orderId: string | null
  orderNumber: string | null
  awaitingStaffReply: boolean
  salesReturnId: string | null
  replacementOrderId: string | null
  sourceClaimId: string | null
  advanceReplacement: boolean
  advanceShippedAt: string | null
  reasonCode: string | null
  rejectionReasonCode: string | null
  resolutionSummary: string | null
  notes: string | null
  currencyCode: string | null
  totalClaimedAmount: string | null
  totalApprovedAmount: string | null
  totalRecoveredAmount: string | null
  slaDueAt: string | null
  slaPausedAt: string | null
  submittedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  assigneeUserId: string | null
  deletedAt: string | null
  updatedAt: string | null
  lines: ClaimLineSnapshot[]
}

type ClaimUndoPayload = {
  before?: ClaimSnapshot | null
  after?: ClaimSnapshot | null
}

type ClaimEventPayload = {
  id: string
  claimId: string
  claimNumber: string
  externalRef: string | null
  claimType: WarrantyClaimType
  status: WarrantyClaimStatus
  customerId: string | null
  organizationId: string
  tenantId: string
}

type ReferenceLookupResult = 'missing' | 'unknown'

type ReferenceValidationInput = {
  orderId?: string | null
  salesReturnId?: string | null
  replacementOrderId?: string | null
  lineOrderRefs?: Array<{ orderLineId: string; orderId: string | null }>
}

const intakeStatuses = new Set<WarrantyClaimStatus>(['draft', 'submitted', 'in_review', 'info_requested'])
const fulfillmentStatuses = new Set<WarrantyClaimStatus>(['approved', 'awaiting_return', 'received', 'inspecting'])
const deletableStatuses = new Set<WarrantyClaimStatus>(['draft', 'cancelled'])
const preReceivedStatuses = new Set<WarrantyClaimStatus>([
  'draft',
  'submitted',
  'in_review',
  'info_requested',
  'approved',
  'awaiting_return',
])

function parseCommandInput<T>(schema: z.ZodType<T>, rawInput: unknown): T {
  const result = schema.safeParse(rawInput ?? {})
  if (!result.success) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidInput' })
  }
  return result.data
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function resolveScope(ctx: CommandRuntimeContext, input: ScopeInput): WarrantyClaimScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: '[internal] tenant scope required for warranty claim command' })
  if (!organizationId) throw new CrudHttpError(400, { error: '[internal] organization scope required for warranty claim command' })
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

function buildCreateEntitlementInput(input: ClaimCreateInput): WarrantyEntitlementInput | null {
  const lines = input.lines ?? []
  const sourceLine = lines.find((line) => typeof line.serialNumber === 'string' && line.serialNumber.trim().length > 0)
    ?? lines.find((line) => Boolean(line.productId))
    ?? lines.find((line) => typeof line.sku === 'string' && line.sku.trim().length > 0)
    ?? (input.orderId ? lines.find((line) => Boolean(line.purchaseDate)) : null)
    ?? null

  const serialNumber = sourceLine?.serialNumber?.trim() || null
  const orderId = input.orderId ?? null
  const productId = sourceLine?.productId ?? null
  const sku = sourceLine?.sku?.trim() || null

  if (!serialNumber && !orderId && !productId && !sku) return null

  return {
    serialNumber,
    orderId,
    productId,
    sku,
    purchaseDate: toDateOnlyIso(sourceLine?.purchaseDate),
  }
}

async function stampEntitlementSourceIfResolvable(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  claim: WarrantyClaim,
  input: ClaimCreateInput,
  scope: WarrantyClaimScope,
): Promise<void> {
  const entitlementInput = buildCreateEntitlementInput(input)
  if (!entitlementInput) return

  try {
    const resolver = ctx.container.resolve<WarrantyEntitlementResolver>('warrantyEntitlementResolver')
    const result = await resolver.resolveEntitlement(entitlementInput, scope, em)
    claim.entitlementSource = result.source ?? null
  } catch {
    claim.entitlementSource = null
  }
}

function buildInitialLineData(
  claim: WarrantyClaim,
  input: ClaimInitialLineCreateInput,
  index: number,
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
    lineNo: input.lineNo ?? index + 1,
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
    vendorName: input.vendorName ?? null,
    lineStatus: 'pending',
    creditAmount: nullableAmountString(input.creditAmount),
    restockingFee: nullableAmountString(input.restockingFee),
    coreChargeAmount: nullableAmountString(input.coreChargeAmount),
    coreCreditAmount: nullableAmountString(input.coreCreditAmount),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function snapshotLine(line: WarrantyClaimLine): ClaimLineSnapshot {
  return {
    id: line.id,
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
    inspectionNotes: line.inspectionNotes ?? null,
    disposition: line.disposition ?? null,
    lineStatus: line.lineStatus,
    creditAmount: line.creditAmount ?? null,
    restockingFee: line.restockingFee ?? null,
    coreChargeAmount: line.coreChargeAmount ?? null,
    coreCreditAmount: line.coreCreditAmount ?? null,
    vendorClaimLineId: line.vendorClaimLineId ?? null,
    deletedAt: toIso(line.deletedAt),
  }
}

function snapshotClaim(claim: WarrantyClaim, lines: readonly WarrantyClaimLine[]): ClaimSnapshot {
  return {
    id: claim.id,
    organizationId: claim.organizationId,
    tenantId: claim.tenantId,
    claimNumber: claim.claimNumber,
    claimType: claim.claimType,
    status: claim.status,
    channel: claim.channel,
    priority: claim.priority,
    customerId: claim.customerId ?? null,
    customerName: claim.customerName ?? null,
    externalRef: claim.externalRef ?? null,
    intakeMessageRef: claim.intakeMessageRef ?? null,
    contactEmail: claim.contactEmail ?? null,
    returnLabelUrl: claim.returnLabelUrl ?? null,
    returnTrackingNumber: claim.returnTrackingNumber ?? null,
    returnCarrier: claim.returnCarrier ?? null,
    vendorName: claim.vendorName ?? null,
    vendorRef: claim.vendorRef ?? null,
    orderId: claim.orderId ?? null,
    orderNumber: claim.orderNumber ?? null,
    awaitingStaffReply: claim.awaitingStaffReply === true,
    salesReturnId: claim.salesReturnId ?? null,
    replacementOrderId: claim.replacementOrderId ?? null,
    sourceClaimId: claim.sourceClaimId ?? null,
    advanceReplacement: claim.advanceReplacement,
    advanceShippedAt: toIso(claim.advanceShippedAt),
    reasonCode: claim.reasonCode ?? null,
    rejectionReasonCode: claim.rejectionReasonCode ?? null,
    resolutionSummary: claim.resolutionSummary ?? null,
    notes: claim.notes ?? null,
    currencyCode: claim.currencyCode ?? null,
    totalClaimedAmount: claim.totalClaimedAmount ?? null,
    totalApprovedAmount: claim.totalApprovedAmount ?? null,
    totalRecoveredAmount: claim.totalRecoveredAmount ?? null,
    slaDueAt: toIso(claim.slaDueAt),
    slaPausedAt: toIso(claim.slaPausedAt),
    submittedAt: toIso(claim.submittedAt),
    resolvedAt: toIso(claim.resolvedAt),
    closedAt: toIso(claim.closedAt),
    assigneeUserId: claim.assigneeUserId ?? null,
    deletedAt: toIso(claim.deletedAt),
    updatedAt: toIso(claim.updatedAt),
    lines: lines.map(snapshotLine),
  }
}

async function loadClaimSnapshot(
  em: EntityManager,
  claimId: string,
  scope: WarrantyClaimScope,
): Promise<ClaimSnapshot | null> {
  const claim = await findOneWithDecryption(em, WarrantyClaim, { id: claimId, tenantId: scope.tenantId, organizationId: scope.organizationId }, {}, scope)
  if (!claim) return null
  const lines = await findWithDecryption(
    em,
    WarrantyClaimLine,
    { claim: claim.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
  return snapshotClaim(claim, lines)
}

function restoreClaimFromSnapshot(claim: WarrantyClaim, snapshot: ClaimSnapshot): void {
  claim.claimNumber = snapshot.claimNumber
  claim.claimType = snapshot.claimType
  claim.status = snapshot.status
  claim.channel = snapshot.channel
  claim.priority = snapshot.priority
  claim.customerId = snapshot.customerId
  claim.customerName = snapshot.customerName
  claim.externalRef = snapshot.externalRef
  claim.intakeMessageRef = snapshot.intakeMessageRef
  claim.contactEmail = snapshot.contactEmail
  claim.returnLabelUrl = snapshot.returnLabelUrl
  claim.returnTrackingNumber = snapshot.returnTrackingNumber
  claim.returnCarrier = snapshot.returnCarrier
  claim.vendorName = snapshot.vendorName
  claim.vendorRef = snapshot.vendorRef
  claim.orderId = snapshot.orderId
  claim.orderNumber = snapshot.orderNumber
  claim.awaitingStaffReply = snapshot.awaitingStaffReply === true
  claim.salesReturnId = snapshot.salesReturnId
  claim.replacementOrderId = snapshot.replacementOrderId
  claim.sourceClaimId = snapshot.sourceClaimId
  claim.advanceReplacement = snapshot.advanceReplacement
  claim.advanceShippedAt = toDate(snapshot.advanceShippedAt)
  claim.reasonCode = snapshot.reasonCode
  claim.rejectionReasonCode = snapshot.rejectionReasonCode
  claim.resolutionSummary = snapshot.resolutionSummary
  claim.notes = snapshot.notes
  claim.currencyCode = snapshot.currencyCode
  claim.totalClaimedAmount = snapshot.totalClaimedAmount
  claim.totalApprovedAmount = snapshot.totalApprovedAmount
  claim.totalRecoveredAmount = snapshot.totalRecoveredAmount
  claim.slaDueAt = toDate(snapshot.slaDueAt)
  claim.slaPausedAt = toDate(snapshot.slaPausedAt)
  claim.submittedAt = toDate(snapshot.submittedAt)
  claim.resolvedAt = toDate(snapshot.resolvedAt)
  claim.closedAt = toDate(snapshot.closedAt)
  claim.assigneeUserId = snapshot.assigneeUserId
  claim.deletedAt = toDate(snapshot.deletedAt)
}

function restoreLineFromSnapshot(line: WarrantyClaimLine, snapshot: ClaimLineSnapshot): void {
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
  line.inspectionNotes = snapshot.inspectionNotes
  line.disposition = snapshot.disposition
  line.lineStatus = snapshot.lineStatus
  line.creditAmount = snapshot.creditAmount
  line.restockingFee = snapshot.restockingFee
  line.coreChargeAmount = snapshot.coreChargeAmount
  line.coreCreditAmount = snapshot.coreCreditAmount
  line.vendorClaimLineId = snapshot.vendorClaimLineId
  line.deletedAt = toDate(snapshot.deletedAt)
}

async function restoreSnapshot(em: EntityManager, snapshot: ClaimSnapshot): Promise<WarrantyClaim> {
  const scope = { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId }
  let claim = await findOneWithDecryption(em, WarrantyClaim, { id: snapshot.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, {}, scope)
  if (!claim) {
    claim = em.create(WarrantyClaim, {
      id: snapshot.id,
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
      claimNumber: snapshot.claimNumber,
      claimType: snapshot.claimType,
      status: snapshot.status,
      channel: snapshot.channel,
      priority: snapshot.priority,
      advanceReplacement: snapshot.advanceReplacement,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(claim)
  }
  restoreClaimFromSnapshot(claim, snapshot)
  const existingLines = await findWithDecryption(
    em,
    WarrantyClaimLine,
    { claim: snapshot.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
  const existingById = new Map(existingLines.map((line) => [line.id, line]))
  for (const lineSnapshot of snapshot.lines) {
    let line = existingById.get(lineSnapshot.id)
    if (!line) {
      line = em.create(WarrantyClaimLine, {
        id: lineSnapshot.id,
        claim,
        organizationId: snapshot.organizationId,
        tenantId: snapshot.tenantId,
        lineNo: lineSnapshot.lineNo,
        qtyClaimed: lineSnapshot.qtyClaimed,
        lineStatus: lineSnapshot.lineStatus,
        warrantyStatus: lineSnapshot.warrantyStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(line)
    }
    restoreLineFromSnapshot(line, lineSnapshot)
  }
  return claim
}

function claimEventPayload(claim: WarrantyClaim): ClaimEventPayload {
  return {
    id: claim.id,
    claimId: claim.id,
    claimNumber: claim.claimNumber,
    externalRef: claim.externalRef ?? null,
    claimType: claim.claimType,
    status: claim.status,
    customerId: claim.customerId ?? null,
    organizationId: claim.organizationId,
    tenantId: claim.tenantId,
  }
}

async function emitClaimCrud(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  claim: WarrantyClaim,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
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
    `warranty_claims.claim.${action}`,
  )
}

async function emitClaimUndoCrud(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  claim: WarrantyClaim,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
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
    `warranty_claims.claim.undo.${action}`,
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

function resolveClaimNumberGenerator(ctx: CommandRuntimeContext, em: EntityManager): WarrantyClaimNumberGenerator {
  try {
    return ctx.container.resolve('warrantyClaimNumberGenerator') as WarrantyClaimNumberGenerator
  } catch {
    return new WarrantyClaimNumberGenerator(em)
  }
}

function readCustomerName(row: Record<string, unknown>): string | null {
  const candidates = [row.display_name, row.displayName, row.name, row.label]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  return null
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

type SalesReferenceTable = 'sales_orders' | 'sales_returns' | 'sales_order_lines'

type SalesReferenceDb = {
  sales_orders: {
    id: string
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
  sales_returns: {
    id: string
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
  sales_order_lines: {
    id: string
    order_id: string
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
}

function isMissingReferenceTableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as { code?: unknown; message?: unknown }
  return candidate.code === '42P01'
    || (typeof candidate.message === 'string' && candidate.message.includes('does not exist'))
}

async function querySalesReferenceRow(
  ctx: CommandRuntimeContext,
  table: SalesReferenceTable,
  scope: WarrantyClaimScope,
  id: string,
  select: string[],
): Promise<Record<string, unknown> | null | undefined> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const db = em.getKysely<SalesReferenceDb>()
  try {
    const row = await db
      .selectFrom(table)
      .select(select as never[])
      .where('id' as never, '=', id as never)
      .where('tenant_id' as never, '=', scope.tenantId as never)
      .where('organization_id' as never, '=', scope.organizationId as never)
      .where('deleted_at' as never, 'is', null)
      .executeTakeFirst()
    return (row as Record<string, unknown> | undefined) ?? null
  } catch (err) {
    if (isMissingReferenceTableError(err)) return undefined
    return undefined
  }
}

type CustomerEntitiesDb = {
  customer_entities: {
    id: string
    display_name: string | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
}

function isMissingCustomerTableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as { code?: unknown; message?: unknown }
  return candidate.code === '42P01'
    || (typeof candidate.message === 'string'
      && candidate.message.includes('customer_entities')
      && candidate.message.includes('does not exist'))
}

async function assertCustomerExists(
  ctx: CommandRuntimeContext,
  customerId: string,
  scope: WarrantyClaimScope,
): Promise<void> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const db = em.getKysely<CustomerEntitiesDb>()
  let row: { id: string } | undefined
  try {
    row = await db
      .selectFrom('customer_entities')
      .select('id')
      .where('id', '=', customerId)
      .where('tenant_id', '=', scope.tenantId)
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  } catch (err) {
    if (isMissingCustomerTableError(err)) return
    throw err
  }
  if (!row) throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidInput' })
}

async function resolveCustomerName(
  ctx: CommandRuntimeContext,
  customerId: string | null | undefined,
  scope: WarrantyClaimScope,
  fallback: string | null | undefined,
  options: { strict: boolean } = { strict: false },
): Promise<string | null> {
  if (!customerId) return fallback ?? null
  if (options.strict) await assertCustomerExists(ctx, customerId, scope)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const db = em.getKysely<CustomerEntitiesDb>()
  let customer: Record<string, unknown> | undefined
  try {
    customer = await db
      .selectFrom('customer_entities')
      .select(['id', 'display_name'] as never[])
      .where('id' as never, '=', customerId as never)
      .where('tenant_id' as never, '=', scope.tenantId as never)
      .where('organization_id' as never, '=', scope.organizationId as never)
      .where('deleted_at' as never, 'is', null)
      .executeTakeFirst() as Record<string, unknown> | undefined
  } catch (err) {
    if (!isMissingCustomerTableError(err)) throw err
    return fallback ?? null
  }
  if (!customer) return fallback ?? null
  let encryption: {
    decryptEntityPayload: (entityId: string, payload: Record<string, unknown>, tenantId: string | null, organizationId?: string | null) => Promise<Record<string, unknown>>
  } | null = null
  try {
    encryption = ctx.container.resolve('tenantEncryptionService')
  } catch {
    encryption = null
  }
  if (encryption) {
    try {
      customer = await encryption.decryptEntityPayload('customers:customer_entity', customer, scope.tenantId, scope.organizationId)
    } catch {
      // keep the raw row — decryptEntityPayload already no-ops when encryption is disabled
    }
  }
  return readCustomerName(customer) ?? fallback ?? null
}

async function resolveOrderNumber(
  ctx: CommandRuntimeContext,
  orderId: string | null | undefined,
  scope: WarrantyClaimScope,
  fallback: string | null | undefined,
): Promise<string | null> {
  if (!orderId) return null
  const row = await querySalesReferenceRow(ctx, 'sales_orders', scope, orderId, ['id', 'order_number'])
  if (!row) return fallback ?? null
  return readString(row, 'order_number') ?? fallback ?? null
}

type CustomerUsersDb = {
  customer_users: {
    id: string
    tenant_id: string | null
    organization_id: string | null
    customer_entity_id: string | null
    is_active: boolean
    deleted_at: Date | null
  }
}

async function resolvePortalRecipientUserIds(
  ctx: CommandRuntimeContext,
  claim: WarrantyClaim,
): Promise<string[]> {
  if (!claim.customerId) return []
  try {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const db = em.getKysely<CustomerUsersDb>()
    const rows = await db
      .selectFrom('customer_users')
      .select('id')
      .where('tenant_id', '=', claim.tenantId)
      .where('organization_id', '=', claim.organizationId)
      .where('customer_entity_id', '=', claim.customerId)
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .limit(100)
      .execute()
    return rows.map((row) => row.id)
  } catch {
    return []
  }
}

async function emitClaimStatusChanged(
  ctx: CommandRuntimeContext,
  claim: WarrantyClaim,
  fromStatus: WarrantyClaimStatus,
  toStatus: WarrantyClaimStatus,
): Promise<void> {
  const payload = {
    ...claimEventPayload(claim),
    fromStatus,
    toStatus,
  }
  await emitWarrantyClaimsEvent('warranty_claims.claim.status_changed', payload, { persistent: true })
  const recipientUserIds = await resolvePortalRecipientUserIds(ctx, claim)
  if (recipientUserIds.length === 0) return
  await emitWarrantyClaimsEvent('warranty_claims.claim.portal_status_changed', {
    ...payload,
    recipientUserIds,
  }, { persistent: true })
}

async function emitCustomerVisibleCommentAdded(
  ctx: CommandRuntimeContext,
  claim: WarrantyClaim,
  input: CommentClaimInput,
): Promise<void> {
  const recipientUserIds = await resolvePortalRecipientUserIds(ctx, claim)
  if (recipientUserIds.length === 0) return
  await emitWarrantyClaimsEvent('warranty_claims.claim.comment_added', {
    ...claimEventPayload(claim),
    visibility: input.visibility,
    actorCustomerId: input.actorCustomerId ?? null,
    recipientUserIds,
  }, { persistent: true })
}

function applySlaPause(
  em: EntityManager,
  claim: WarrantyClaim,
  fromStatus: WarrantyClaimStatus,
  toStatus: WarrantyClaimStatus,
  now: Date,
  effectiveSettings: WarrantyClaimEffectiveSettings,
): void {
  if (fromStatus === toStatus || toStatus !== 'info_requested' || !effectiveSettings.slaPauseOnInfoRequested) return
  claim.slaPausedAt = now
  appendClaimEvent(em, claim, 'system', {
    visibility: 'customer',
    payload: { action: 'sla_paused' },
    actorUserId: null,
  })
}

function applySlaResume(
  em: EntityManager,
  claim: WarrantyClaim,
  fromStatus: WarrantyClaimStatus,
  toStatus: WarrantyClaimStatus,
  now: Date,
): void {
  if (fromStatus !== 'info_requested' || toStatus === 'info_requested' || !claim.slaPausedAt) return
  if (claim.slaDueAt) {
    claim.slaDueAt = new Date(claim.slaDueAt.getTime() + Math.max(0, now.getTime() - claim.slaPausedAt.getTime()))
  }
  claim.slaPausedAt = null
  claim.slaAtRiskNotifiedAt = null
  claim.slaBreachedNotifiedAt = null
  appendClaimEvent(em, claim, 'system', {
    visibility: 'customer',
    payload: { action: 'sla_resumed' },
    actorUserId: null,
  })
}

function resolveOptionalEntityId(moduleId: string, entity: string): EntityId | null {
  const registry = E as unknown as Record<string, Record<string, string> | undefined>
  const value = registry[moduleId]?.[entity]
  return typeof value === 'string' ? (value as EntityId) : null
}

async function lookupSalesReference(
  ctx: CommandRuntimeContext,
  entityId: EntityId | null,
  table: SalesReferenceTable,
  scope: WarrantyClaimScope,
  id: string,
  select: string[],
): Promise<Record<string, unknown> | ReferenceLookupResult> {
  if (!entityId) return 'unknown'
  const row = await querySalesReferenceRow(ctx, table, scope, id, select)
  if (row === undefined) return 'unknown'
  return row ?? 'missing'
}

function assertValidSalesReference(result: Record<string, unknown> | ReferenceLookupResult): asserts result is Record<string, unknown> | 'unknown' {
  if (result === 'missing') {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidReference' })
  }
}

export async function validateClaimReferences(
  ctx: CommandRuntimeContext,
  scope: WarrantyClaimScope,
  input: ReferenceValidationInput,
): Promise<void> {
  if (input.orderId) {
    const result = await lookupSalesReference(ctx, resolveOptionalEntityId('sales', 'sales_order'), 'sales_orders', scope, input.orderId, ['id'])
    assertValidSalesReference(result)
  }
  if (input.replacementOrderId) {
    const result = await lookupSalesReference(ctx, resolveOptionalEntityId('sales', 'sales_order'), 'sales_orders', scope, input.replacementOrderId, ['id'])
    assertValidSalesReference(result)
  }
  if (input.salesReturnId) {
    const result = await lookupSalesReference(ctx, resolveOptionalEntityId('sales', 'sales_return'), 'sales_returns', scope, input.salesReturnId, ['id'])
    assertValidSalesReference(result)
  }
  for (const lineRef of input.lineOrderRefs ?? []) {
    const result = await lookupSalesReference(ctx, resolveOptionalEntityId('sales', 'sales_order_line'), 'sales_order_lines', scope, lineRef.orderLineId, ['id', 'order_id'])
    assertValidSalesReference(result)
    if (result === 'unknown' || !lineRef.orderId) continue
    if (readString(result, 'order_id') !== lineRef.orderId) {
      throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidReference' })
    }
  }
}

type AssigneeUsersDb = {
  users: {
    id: string
    tenant_id: string | null
    deleted_at: Date | null
    is_confirmed: boolean
  }
}

async function validateAssigneeUser(
  ctx: CommandRuntimeContext,
  scope: WarrantyClaimScope,
  assigneeUserId: string | null | undefined,
): Promise<void> {
  if (!assigneeUserId) return
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const db = em.getKysely<AssigneeUsersDb>()
  const row = await db
    .selectFrom('users')
    .select('id')
    .where('id', '=', assigneeUserId)
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
    .where('is_confirmed', '=', true)
    .executeTakeFirst()
  if (!row) throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidAssignee' })
}

function applyClaimAssignment(
  em: EntityManager,
  claim: WarrantyClaim,
  assigneeUserId: string | null,
  actorUserId: string | null,
  now: Date,
): void {
  claim.assigneeUserId = assigneeUserId
  claim.updatedAt = now
  appendClaimEvent(em, claim, 'assignment', {
    visibility: 'internal',
    payload: { assigneeUserId: claim.assigneeUserId },
    actorUserId,
  })
}

function allowedUpdateFields(status: WarrantyClaimStatus): Set<ClaimUpdateField> {
  if (intakeStatuses.has(status)) return new Set(CLAIM_INTAKE_UPDATE_FIELDS)
  if (fulfillmentStatuses.has(status)) return new Set(CLAIM_FULFILLMENT_UPDATE_FIELDS)
  return new Set()
}

function assertClaimUpdateFields(claim: WarrantyClaim, input: ClaimUpdateInput): void {
  const keys = [...CLAIM_INTAKE_UPDATE_FIELDS, ...CLAIM_FULFILLMENT_UPDATE_FIELDS]
  const requested = keys.filter((key) => hasOwn(input, key))
  if (!requested.length) return
  const allowed = allowedUpdateFields(claim.status)
  const disallowed = requested.filter((key) => !allowed.has(key))
  if (disallowed.length > 0) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.fieldLocked' })
  }
}

function applyClaimUpdate(claim: WarrantyClaim, input: ClaimUpdateInput, customerName: string | null, orderNumber: string | null): void {
  if (hasOwn(input, 'customerId')) claim.customerId = input.customerId ?? null
  if (hasOwn(input, 'customerName')) claim.customerName = customerName
  if (hasOwn(input, 'orderId')) {
    claim.orderId = input.orderId ?? null
    claim.orderNumber = orderNumber
  }
  if (hasOwn(input, 'reasonCode')) claim.reasonCode = input.reasonCode ?? null
  if (hasOwn(input, 'priority') && input.priority) claim.priority = input.priority
  if (hasOwn(input, 'notes')) claim.notes = input.notes ?? null
  if (hasOwn(input, 'advanceReplacement')) claim.advanceReplacement = input.advanceReplacement ?? false
  if (hasOwn(input, 'replacementOrderId')) claim.replacementOrderId = input.replacementOrderId ?? null
  if (hasOwn(input, 'advanceShippedAt')) claim.advanceShippedAt = input.advanceShippedAt ?? null
  if (hasOwn(input, 'salesReturnId')) claim.salesReturnId = input.salesReturnId ?? null
  if (hasOwn(input, 'vendorName')) claim.vendorName = input.vendorName ?? null
  if (hasOwn(input, 'vendorRef')) claim.vendorRef = input.vendorRef ?? null
  if (hasOwn(input, 'resolutionSummary')) claim.resolutionSummary = input.resolutionSummary ?? null
  claim.updatedAt = new Date()
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
}

function assertCanResolve(lines: readonly WarrantyClaimLine[]): void {
  if (!canResolveWithLineStatuses(lines)) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidTransition' })
  }
}

function assertVendorRecoveryLines(lines: readonly WarrantyClaimLine[], requestedLineIds: readonly string[]): void {
  if (lines.length !== requestedLineIds.length) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.vendorRecoveryNeedsResolvedLines' })
  }
  for (const line of lines) {
    if (line.lineStatus !== 'resolved' || line.vendorClaimLineId) {
      throw new CrudHttpError(400, { error: 'warranty_claims.errors.vendorRecoveryNeedsResolvedLines' })
    }
  }
}

function buildClaimLog(
  actionLabel: string,
  resourceId: string,
  snapshots: { before?: unknown; after?: unknown },
): {
  actionLabel: string
  resourceKind: string
  resourceId: string
  tenantId: string | null
  organizationId: string | null
  snapshotBefore: unknown
  snapshotAfter: unknown
  payload: { undo: ClaimUndoPayload }
} {
  const after = snapshots.after as ClaimSnapshot | null | undefined
  const before = snapshots.before as ClaimSnapshot | null | undefined
  return {
    actionLabel,
    resourceKind: WARRANTY_CLAIM_RESOURCE_KIND,
    resourceId,
    tenantId: after?.tenantId ?? before?.tenantId ?? null,
    organizationId: after?.organizationId ?? before?.organizationId ?? null,
    snapshotBefore: before ?? null,
    snapshotAfter: after ?? null,
    payload: { undo: { before: before ?? null, after: after ?? null } },
  }
}

const createClaimCommand: CommandHandler<ClaimCreateInput, { claimId: string }> = {
  id: 'warranty_claims.claim.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = parseCommandInput(claimCreateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await validateClaimReferences(ctx, scope, {
      orderId: input.orderId ?? null,
      salesReturnId: input.salesReturnId ?? null,
      replacementOrderId: input.replacementOrderId ?? null,
      lineOrderRefs: (input.lines ?? [])
        .filter((line): line is ClaimInitialLineCreateInput & { orderLineId: string } => typeof line.orderLineId === 'string')
        .map((line) => ({ orderLineId: line.orderLineId, orderId: input.orderId ?? null })),
    })
    const numberGenerator = resolveClaimNumberGenerator(ctx, em)
    const generated = await numberGenerator.generate({
      claimType: input.claimType,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const customerName = await resolveCustomerName(ctx, input.customerId, scope, input.customerName, { strict: true })
    const orderNumber = await resolveOrderNumber(ctx, input.orderId, scope, null)
    const claimId = randomUUID()
    let claim!: WarrantyClaim
    let createdLines: WarrantyClaimLine[] = []

    await withAtomicFlush(em, [
      () => {
        claim = em.create(WarrantyClaim, {
          id: claimId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          claimNumber: generated.number,
          claimType: input.claimType,
          status: 'draft',
          channel: input.channel ?? 'staff',
          priority: input.priority ?? 'normal',
          customerId: input.customerId ?? null,
          customerName,
          externalRef: input.externalRef ?? null,
          intakeMessageRef: input.intakeMessageRef ?? null,
          contactEmail: input.contactEmail ?? null,
          vendorName: input.vendorName ?? null,
          vendorRef: input.vendorRef ?? null,
          orderId: input.orderId ?? null,
          orderNumber,
          salesReturnId: input.salesReturnId ?? null,
          replacementOrderId: input.replacementOrderId ?? null,
          sourceClaimId: null,
          advanceReplacement: input.advanceReplacement ?? false,
          advanceShippedAt: input.advanceShippedAt ?? null,
          reasonCode: input.reasonCode ?? null,
          rejectionReasonCode: input.rejectionReasonCode ?? null,
          resolutionSummary: input.resolutionSummary ?? null,
          notes: input.notes ?? null,
          currencyCode: input.currencyCode ?? null,
          totalClaimedAmount: '0',
          totalApprovedAmount: '0',
          totalRecoveredAmount: '0',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(claim)
        createdLines = (input.lines ?? []).map((lineInput, index) => {
          const line = em.create(WarrantyClaimLine, buildInitialLineData(claim, lineInput, index))
          em.persist(line)
          return line
        })
        const totals = computeHeaderRollups(createdLines)
        claim.totalClaimedAmount = String(totals.totalClaimedAmount)
        claim.totalApprovedAmount = String(totals.totalApprovedAmount)
        appendClaimEvent(em, claim, 'system', {
          visibility: 'internal',
          payload: { action: 'created' },
          actorUserId: ctx.auth?.sub ?? null,
        })
      },
      () => stampEntitlementSourceIfResolvable(ctx, em, claim, input, scope),
    ], { transaction: true, label: 'warranty_claims.claim.create' })

    await emitClaimCrud(ctx, 'created', claim)
    await Promise.all(createdLines.map((line) => emitLineCrud(ctx, 'created', line)))
    return { claimId: claim.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(claimCreateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadClaimSnapshot(em, result.claimId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildClaimLog('warranty_claims.audit.claim.create', result.claimId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ClaimUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
    const claim = await findOneWithDecryption(em, WarrantyClaim, { id: after.id, tenantId: scope.tenantId, organizationId: scope.organizationId }, {}, scope)
    if (!claim) return
    const lines = await findWithDecryption(
      em,
      WarrantyClaimLine,
      { claim: after.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      {},
      scope,
    )
    await withAtomicFlush(em, [
      () => {
        const now = new Date()
        claim.deletedAt = now
        claim.updatedAt = now
        for (const line of lines) {
          line.deletedAt = now
          line.updatedAt = now
        }
      },
    ], { transaction: true, label: 'warranty_claims.claim.create.undo' })
    await emitClaimUndoCrud(ctx, 'deleted', claim)
  },
}

const updateClaimCommand: CommandHandler<ClaimUpdateInput, { claimId: string }> = {
  id: 'warranty_claims.claim.update',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(claimUpdateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: await loadClaimSnapshot(em, input.id, scope) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(claimUpdateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const claim = await requireScopedClaim(em, input.id, scope)
    await enforceWarrantyClaimOptimisticLock(ctx, claim)
    assertClaimUpdateFields(claim, input)
    await validateClaimReferences(ctx, scope, {
      orderId: hasOwn(input, 'orderId') && (input.orderId ?? null) !== (claim.orderId ?? null) ? input.orderId ?? null : null,
      salesReturnId: hasOwn(input, 'salesReturnId') && (input.salesReturnId ?? null) !== (claim.salesReturnId ?? null) ? input.salesReturnId ?? null : null,
      replacementOrderId: hasOwn(input, 'replacementOrderId') && (input.replacementOrderId ?? null) !== (claim.replacementOrderId ?? null) ? input.replacementOrderId ?? null : null,
    })
    const customerChanged = hasOwn(input, 'customerId') && (input.customerId ?? null) !== (claim.customerId ?? null)
    const shouldRefreshCustomerName = hasOwn(input, 'customerId') || hasOwn(input, 'customerName')
    const customerName = shouldRefreshCustomerName
      ? await resolveCustomerName(ctx, input.customerId ?? claim.customerId, scope, input.customerName ?? claim.customerName, { strict: customerChanged })
      : claim.customerName ?? null
    const orderNumber = hasOwn(input, 'orderId')
      ? await resolveOrderNumber(ctx, input.orderId, scope, (input.orderId ?? null) === (claim.orderId ?? null) ? claim.orderNumber : null)
      : claim.orderNumber ?? null
    await withAtomicFlush(em, [
      () => applyClaimUpdate(claim, input, customerName, orderNumber),
    ], { transaction: true, label: 'warranty_claims.claim.update' })
    await emitClaimCrud(ctx, 'updated', claim)
    return { claimId: claim.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(claimUpdateSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadClaimSnapshot(em, result.claimId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildClaimLog('warranty_claims.audit.claim.update', result.claimId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ClaimUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let claim!: WarrantyClaim
    await withAtomicFlush(em, [
      async () => {
        claim = await restoreSnapshot(em, before)
      },
    ], { transaction: true, label: 'warranty_claims.claim.update.undo' })
    await emitClaimUndoCrud(ctx, 'updated', claim)
  },
}

const deleteClaimCommand: CommandHandler<ClaimDeleteInput, { claimId: string }> = {
  id: 'warranty_claims.claim.delete',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(claimDeleteSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: await loadClaimSnapshot(em, input.id, scope) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(claimDeleteSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const claim = await requireScopedClaim(em, input.id, scope)
    await enforceWarrantyClaimOptimisticLock(ctx, claim)
    if (!deletableStatuses.has(claim.status)) {
      throw new CrudHttpError(400, { error: 'warranty_claims.errors.deleteNotAllowed' })
    }
    const lines = await findWithDecryption(
      em,
      WarrantyClaimLine,
      { claim: claim.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      {},
      scope,
    )
    await withAtomicFlush(em, [
      () => {
        const now = new Date()
        claim.deletedAt = now
        claim.updatedAt = now
        for (const line of lines) {
          line.deletedAt = now
          line.updatedAt = now
        }
      },
    ], { transaction: true, label: 'warranty_claims.claim.delete' })
    await emitClaimCrud(ctx, 'deleted', claim)
    await Promise.all(lines.map((line) => emitLineCrud(ctx, 'deleted', line)))
    return { claimId: claim.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(claimDeleteSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadClaimSnapshot(em, result.claimId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildClaimLog('warranty_claims.audit.claim.delete', result.claimId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ClaimUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let claim!: WarrantyClaim
    await withAtomicFlush(em, [
      async () => {
        claim = await restoreSnapshot(em, before)
        claim.deletedAt = null
        claim.updatedAt = new Date()
      },
    ], { transaction: true, label: 'warranty_claims.claim.delete.undo' })
    await emitClaimUndoCrud(ctx, 'created', claim)
    const restoredLines = await findWithDecryption(
      em,
      WarrantyClaimLine,
      { claim: claim.id, tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
      {},
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    await Promise.all(restoredLines.map((line) => emitLineCrud(ctx, 'created', line)))
  },
}

const submitClaimCommand: CommandHandler<SubmitClaimInput, { claimId: string }> = {
  id: 'warranty_claims.claim.submit',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(submitClaimSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const claim = await requireScopedClaim(em, input.id, scope)
    await enforceWarrantyClaimOptimisticLock(ctx, claim)
    if (claim.status !== 'draft') {
      throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidTransition' })
    }
    const fromStatus = claim.status
    let autoApproved = false
    let effectiveSettings: WarrantyClaimEffectiveSettings | null = null
    await withAtomicFlush(em, [
      async () => {
        effectiveSettings = await resolveEffectiveWarrantyClaimSettings(em, scope)
        const submittedAt = new Date()
        claim.status = 'submitted'
        claim.submittedAt = submittedAt
        claim.slaDueAt = new Date(submittedAt.getTime() + effectiveSettings.slaHours * 60 * 60 * 1000)
        claim.slaAtRiskNotifiedAt = null
        claim.slaBreachedNotifiedAt = null
        claim.updatedAt = submittedAt
        appendClaimEvent(em, claim, 'status_changed', {
          visibility: 'customer',
          payload: { from: fromStatus, to: 'submitted' },
          actorUserId: input.actorCustomerId ? null : (ctx.auth?.sub ?? null),
          actorCustomerId: input.actorCustomerId ?? null,
        })
      },
      async () => {
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
          scope,
        )
        const risk = await evaluateClaimRisk(em, claim, lines)
        const settings = effectiveSettings ?? await resolveEffectiveWarrantyClaimSettings(em, scope)
        const evaluator = ctx.container.resolve<WarrantyAdjudicationEvaluator>('warrantyAdjudicationEvaluator')
        const { decision } = await evaluator.evaluate({
          claim,
          lines,
          settings,
          risk,
          container: ctx.container,
          em,
          scope,
        })
        if (decision === 'auto_approve') {
          claim.status = 'approved'
          claim.updatedAt = new Date()
          autoApproved = true
          appendClaimEvent(em, claim, 'status_changed', {
            visibility: 'customer',
            payload: { from: 'submitted', to: 'approved' },
            actorUserId: null,
          })
          appendClaimEvent(em, claim, 'system', {
            visibility: 'internal',
            payload: {
              action: 'auto_approved',
              maxAmount: settings.autoApproveMaxAmount,
              currencyCode: settings.autoApproveCurrencyCode,
            },
            actorUserId: null,
          })
        }
      },
    ], { transaction: true, label: 'warranty_claims.claim.submit' })
    await emitClaimCrud(ctx, 'updated', claim)
    const payload = claimEventPayload(claim)
    await emitWarrantyClaimsEvent('warranty_claims.claim.submitted', payload, { persistent: true })
    await emitClaimStatusChanged(ctx, claim, autoApproved ? 'submitted' : fromStatus, autoApproved ? 'approved' : 'submitted')
    return { claimId: claim.id }
  },
}

const transitionClaimCommand: CommandHandler<TransitionClaimInput, { claimId: string }> = {
  id: 'warranty_claims.claim.transition',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(transitionClaimInputSchema, rawInput)
    const scope = resolveScope(ctx, {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: await loadClaimSnapshot(em, input.id, scope) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(transitionClaimInputSchema, rawInput)
    const scope = resolveScope(ctx, {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const claim = await requireScopedClaim(em, input.id, scope)
    await enforceWarrantyClaimOptimisticLock(ctx, claim)
    const fromStatus = claim.status
    assertTransition(fromStatus, input.toStatus)
    if (input.toStatus === 'cancelled' && !preReceivedStatuses.has(fromStatus)) {
      throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidTransition' })
    }
    if (input.toStatus === 'rejected' && !input.rejectionReasonCode) {
      throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidTransition' })
    }
    const lines = input.toStatus === 'resolved'
      ? await findWithDecryption(
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
      : []
    if (input.toStatus === 'resolved') assertCanResolve(lines)
    await withAtomicFlush(em, [
      async () => {
        const effectiveSettings = await resolveEffectiveWarrantyClaimSettings(em, scope)
        const now = new Date()
        claim.status = input.toStatus
        if (input.toStatus === 'rejected') claim.rejectionReasonCode = input.rejectionReasonCode ?? null
        if (input.toStatus === 'resolved') {
          claim.resolvedAt = now
          if (hasOwn(input, 'resolutionSummary')) claim.resolutionSummary = input.resolutionSummary ?? null
        }
        if (input.toStatus === 'closed') claim.closedAt = now
        applySlaResume(em, claim, fromStatus, input.toStatus, now)
        applySlaPause(em, claim, fromStatus, input.toStatus, now, effectiveSettings)
        claim.awaitingStaffReply = false
        claim.updatedAt = now
        appendClaimEvent(em, claim, 'status_changed', {
          visibility: 'customer',
          payload: { from: fromStatus, to: input.toStatus },
          actorUserId: input.actorCustomerId ? null : (ctx.auth?.sub ?? null),
          actorCustomerId: input.actorCustomerId ?? null,
        })
      },
    ], { transaction: true, label: 'warranty_claims.claim.transition' })
    await emitClaimCrud(ctx, 'updated', claim)
    await emitClaimStatusChanged(ctx, claim, fromStatus, input.toStatus)
    return { claimId: claim.id }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const scope = resolveScope(ctx, {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadClaimSnapshot(em, result.claimId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildClaimLog('warranty_claims.audit.claim.transition', result.claimId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ClaimUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let claim!: WarrantyClaim
    await withAtomicFlush(em, [
      async () => {
        claim = await restoreSnapshot(em, before)
        appendClaimEvent(em, claim, 'system', {
          visibility: 'internal',
          payload: { action: 'undo_status_transition' },
          actorUserId: ctx.auth?.sub ?? null,
        })
      },
    ], { transaction: true, label: 'warranty_claims.claim.transition.undo' })
    await emitClaimUndoCrud(ctx, 'updated', claim)
  },
}

const assignClaimCommand: CommandHandler<AssignClaimInput, { claimId: string }> = {
  id: 'warranty_claims.claim.assign',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(assignClaimInputSchema, rawInput)
    const scope = resolveScope(ctx, {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const claim = await requireScopedClaim(em, input.id, scope)
    await enforceWarrantyClaimOptimisticLock(ctx, claim)
    await validateAssigneeUser(ctx, scope, input.assigneeUserId ?? null)
    await withAtomicFlush(em, [
      () => {
        applyClaimAssignment(em, claim, input.assigneeUserId ?? null, ctx.auth?.sub ?? null, new Date())
      },
    ], { transaction: true, label: 'warranty_claims.claim.assign' })
    await emitClaimCrud(ctx, 'updated', claim)
    await emitWarrantyClaimsEvent('warranty_claims.claim.assigned', {
      ...claimEventPayload(claim),
      assigneeUserId: claim.assigneeUserId,
    }, { persistent: true })
    return { claimId: claim.id }
  },
}

const setReturnLabelCommand: CommandHandler<ClaimSetReturnLabelInput, ClaimSetReturnLabelResult> = {
  id: 'warranty_claims.claim.set_return_label',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(claimSetReturnLabelSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return { before: await loadClaimSnapshot(em, input.id, scope) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(claimSetReturnLabelSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const claim = await requireScopedClaim(em, input.id, scope)
    await enforceWarrantyClaimOptimisticLock(ctx, claim, WARRANTY_CLAIM_RESOURCE_KIND, input.updatedAt ?? undefined)

    await withAtomicFlush(em, [
      () => {
        if (input.labelUrl !== undefined) claim.returnLabelUrl = input.labelUrl
        if (input.trackingNumber !== undefined) claim.returnTrackingNumber = input.trackingNumber
        if (input.carrier !== undefined) claim.returnCarrier = input.carrier
        claim.updatedAt = new Date()
        appendClaimEvent(em, claim, 'system', {
          visibility: 'internal',
          payload: {
            action: 'return_label_created',
            carrier: claim.returnCarrier ?? null,
            trackingNumber: claim.returnTrackingNumber ?? null,
          },
          actorUserId: ctx.auth?.sub ?? null,
        })
      },
    ], { transaction: true, label: 'warranty_claims.claim.set_return_label' })

    await emitClaimCrud(ctx, 'updated', claim)
    await emitWarrantyClaimsEvent('warranty_claims.claim.return_label_created', {
      id: claim.id,
      claimId: claim.id,
      carrier: claim.returnCarrier ?? null,
      trackingNumber: claim.returnTrackingNumber ?? null,
      scope,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    }, { persistent: true })

    return {
      claimId: claim.id,
      labelUrl: claim.returnLabelUrl ?? null,
      trackingNumber: claim.returnTrackingNumber ?? null,
      carrier: claim.returnCarrier ?? null,
    }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const input = parseCommandInput(claimSetReturnLabelSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadClaimSnapshot(em, result.claimId, scope)
  },
  buildLog: async ({ result, snapshots }) => buildClaimLog('warranty_claims.audit.claim.set_return_label', result.claimId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ClaimUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let claim!: WarrantyClaim
    await withAtomicFlush(em, [
      async () => {
        claim = await restoreSnapshot(em, before)
        appendClaimEvent(em, claim, 'system', {
          visibility: 'internal',
          payload: { action: 'undo_return_label' },
          actorUserId: ctx.auth?.sub ?? null,
        })
      },
    ], { transaction: true, label: 'warranty_claims.claim.set_return_label.undo' })
    await emitClaimUndoCrud(ctx, 'updated', claim)
  },
}

const escalateClaimCommand: CommandHandler<EscalateClaimInput, EscalateClaimResult> = {
  id: 'warranty_claims.claim.escalate',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(escalateClaimInputSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    if (input.reassignToUserId) {
      await validateAssigneeUser(ctx, scope, input.reassignToUserId)
    }

    let claim: WarrantyClaim | null = null
    let escalated = false
    await withAtomicFlush(em, [
      async () => {
        claim = await requireScopedClaim(em, input.id, scope, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if ((claim.escalationLevel ?? 0) >= input.toLevel) return

        const now = new Date()
        claim.escalationLevel = input.toLevel
        claim.escalatedAt = now
        claim.updatedAt = now
        appendClaimEvent(em, claim, 'system', {
          visibility: 'internal',
          payload: {
            action: 'sla_escalated',
            level: input.toLevel,
            reassignToUserId: input.reassignToUserId ?? null,
          },
          actorUserId: ctx.auth?.sub ?? null,
        })
        if (input.reassignToUserId) {
          applyClaimAssignment(em, claim, input.reassignToUserId, ctx.auth?.sub ?? null, now)
        }
        escalated = true
      },
    ], { transaction: true, label: 'warranty_claims.claim.escalate' })

    const escalatedClaim = claim as WarrantyClaim | null
    if (!escalatedClaim) {
      throw new CrudHttpError(404, { error: 'warranty_claims.errors.notFound' })
    }
    if (!escalated) {
      return { claimId: escalatedClaim.id, escalationLevel: escalatedClaim.escalationLevel ?? 0, escalated: false }
    }

    await emitClaimCrud(ctx, 'updated', escalatedClaim)
    if (input.reassignToUserId) {
      await emitWarrantyClaimsEvent('warranty_claims.claim.assigned', {
        ...claimEventPayload(escalatedClaim),
        assigneeUserId: escalatedClaim.assigneeUserId ?? null,
      }, { persistent: true })
    }
    await emitWarrantyClaimsEvent('warranty_claims.claim.escalated', {
      ...claimEventPayload(escalatedClaim),
      level: escalatedClaim.escalationLevel,
      escalationLevel: escalatedClaim.escalationLevel,
      reassignToUserId: input.reassignToUserId ?? null,
    }, { persistent: true })

    return { claimId: escalatedClaim.id, escalationLevel: escalatedClaim.escalationLevel, escalated: true }
  },
}

const commentClaimCommand: CommandHandler<CommentClaimInput, { claimId: string }> = {
  id: 'warranty_claims.claim.comment',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(commentClaimInputSchema, rawInput)
    const scope = resolveScope(ctx, {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const claim = await requireScopedClaim(em, input.claimId, scope)
    let autoResumed = false
    await withAtomicFlush(em, [
      () => {
        const fromStatus = claim.status
        appendClaimEvent(em, claim, 'comment', {
          visibility: input.visibility,
          body: input.body,
          actorUserId: input.actorCustomerId ? null : (ctx.auth?.sub ?? null),
          actorCustomerId: input.actorCustomerId ?? null,
        })
        claim.awaitingStaffReply = Boolean(input.actorCustomerId)
        claim.updatedAt = new Date()
        if (input.actorCustomerId && fromStatus === 'info_requested') {
          const now = new Date()
          claim.status = 'in_review'
          applySlaResume(em, claim, fromStatus, 'in_review', now)
          claim.updatedAt = now
          autoResumed = true
          appendClaimEvent(em, claim, 'status_changed', {
            visibility: 'customer',
            payload: { from: fromStatus, to: 'in_review' },
            actorUserId: null,
          })
        }
      },
    ], { transaction: true, label: 'warranty_claims.claim.comment' })
    if (input.visibility === 'customer') {
      await emitCustomerVisibleCommentAdded(ctx, claim, input)
    }
    if (autoResumed) {
      await emitClaimCrud(ctx, 'updated', claim)
      await emitClaimStatusChanged(ctx, claim, 'info_requested', 'in_review')
    }
    return { claimId: claim.id }
  },
}

const createVendorRecoveryCommand: CommandHandler<VendorRecoveryInput, { claimId: string }> = {
  id: 'warranty_claims.claim.create_vendor_recovery',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(vendorRecoveryInputSchema, rawInput)
    const scope = resolveScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const sourceClaim = await requireScopedClaim(em, input.claimId, scope)
    await enforceWarrantyClaimOptimisticLock(ctx, sourceClaim)
    const preflightLines = await findWithDecryption(
      em,
      WarrantyClaimLine,
      {
        id: { $in: input.lineIds },
        claim: sourceClaim.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      {},
      scope,
    )
    assertVendorRecoveryLines(preflightLines, input.lineIds)
    const numberGenerator = resolveClaimNumberGenerator(ctx, em)
    const generated = await numberGenerator.generate({
      claimType: 'vendor_recovery',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    let recoveryClaim!: WarrantyClaim
    let copiedLines: WarrantyClaimLine[] = []

    await em.transactional(async (tx) => {
      const lockedSource = await requireScopedClaim(tx, sourceClaim.id, scope, { lockMode: LockMode.PESSIMISTIC_WRITE })
      const lockedLines = await findWithDecryption(
        tx,
        WarrantyClaimLine,
        {
          id: { $in: input.lineIds },
          claim: lockedSource.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      assertVendorRecoveryLines(lockedLines, input.lineIds)
      recoveryClaim = tx.create(WarrantyClaim, {
        id: randomUUID(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        claimNumber: generated.number,
        claimType: 'vendor_recovery',
        status: 'draft',
        channel: 'staff',
        priority: lockedSource.priority,
        customerId: lockedSource.customerId ?? null,
        customerName: lockedSource.customerName ?? null,
        vendorName: input.vendorName,
        vendorRef: input.vendorRef ?? null,
        sourceClaimId: lockedSource.id,
        advanceReplacement: false,
        currencyCode: lockedSource.currencyCode ?? null,
        totalClaimedAmount: '0',
        totalApprovedAmount: '0',
        totalRecoveredAmount: '0',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      tx.persist(recoveryClaim)
      const lineOrder = new Map(input.lineIds.map((id, index) => [id, index]))
      copiedLines = [...lockedLines]
        .sort((left, right) => (lineOrder.get(left.id) ?? 0) - (lineOrder.get(right.id) ?? 0))
        .map((sourceLine, index) => {
          const copiedLine = tx.create(WarrantyClaimLine, {
            id: randomUUID(),
            claim: recoveryClaim,
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            lineNo: index + 1,
            productId: sourceLine.productId ?? null,
            variantId: sourceLine.variantId ?? null,
            sku: sourceLine.sku ?? null,
            productName: sourceLine.productName ?? null,
            orderLineId: sourceLine.orderLineId ?? null,
            serialNumber: sourceLine.serialNumber ?? null,
            lotNumber: sourceLine.lotNumber ?? null,
            purchaseDate: sourceLine.purchaseDate ?? null,
            warrantyMonths: sourceLine.warrantyMonths ?? null,
            warrantyExpiresAt: sourceLine.warrantyExpiresAt ?? null,
            warrantyStatus: sourceLine.warrantyStatus,
            faultCode: sourceLine.faultCode ?? null,
            faultDescription: sourceLine.faultDescription ?? null,
            qtyClaimed: sourceLine.qtyApproved ?? sourceLine.qtyClaimed,
            qtyApproved: sourceLine.qtyApproved ?? null,
            conditionOnReceipt: sourceLine.conditionOnReceipt ?? null,
            inspectionNotes: sourceLine.inspectionNotes ?? null,
            disposition: sourceLine.disposition ?? null,
            lineStatus: 'pending',
            creditAmount: sourceLine.creditAmount ?? null,
            restockingFee: sourceLine.restockingFee ?? null,
            coreChargeAmount: sourceLine.coreChargeAmount ?? null,
            coreCreditAmount: sourceLine.coreCreditAmount ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          sourceLine.vendorClaimLineId = copiedLine.id
          sourceLine.updatedAt = new Date()
          tx.persist(copiedLine)
          return copiedLine
        })
      const totals = computeHeaderRollups(copiedLines)
      recoveryClaim.totalClaimedAmount = String(totals.totalClaimedAmount)
      recoveryClaim.totalApprovedAmount = String(totals.totalApprovedAmount)
      appendClaimEvent(tx, lockedSource, 'system', {
        visibility: 'internal',
        payload: { action: 'vendor_recovery_created', recoveryClaimId: recoveryClaim.id },
        actorUserId: ctx.auth?.sub ?? null,
      })
      appendClaimEvent(tx, recoveryClaim, 'system', {
        visibility: 'internal',
        payload: { action: 'created_from_source_claim', sourceClaimId: lockedSource.id },
        actorUserId: ctx.auth?.sub ?? null,
      })
      await tx.flush()
    })

    await emitClaimCrud(ctx, 'created', recoveryClaim)
    await Promise.all(copiedLines.map((line) => emitLineCrud(ctx, 'created', line)))
    await Promise.all(input.lineIds.map((sourceLineId) => invalidateCrudCache(
      ctx.container,
      'warranty_claims.claim_line',
      { id: sourceLineId, organizationId: sourceClaim.organizationId, tenantId: sourceClaim.tenantId },
      ctx.auth?.tenantId ?? null,
      'warranty_claims.vendor_recovery.source_lines',
    )))
    return { claimId: recoveryClaim.id }
  },
}

registerCommand(createClaimCommand)
registerCommand(updateClaimCommand)
registerCommand(deleteClaimCommand)
registerCommand(submitClaimCommand)
registerCommand(transitionClaimCommand)
registerCommand(assignClaimCommand)
registerCommand(setReturnLabelCommand)
registerCommand(escalateClaimCommand)
registerCommand(commentClaimCommand)
registerCommand(createVendorRecoveryCommand)

export const claimCommands = [
  createClaimCommand,
  updateClaimCommand,
  deleteClaimCommand,
  submitClaimCommand,
  transitionClaimCommand,
  assignClaimCommand,
  setReturnLabelCommand,
  escalateClaimCommand,
  commentClaimCommand,
  createVendorRecoveryCommand,
]

export {
  claimCrudEvents,
  createClaimCommand,
  updateClaimCommand,
  deleteClaimCommand,
  submitClaimCommand,
  transitionClaimCommand,
  assignClaimCommand,
  setReturnLabelCommand,
  escalateClaimCommand,
  commentClaimCommand,
  createVendorRecoveryCommand,
}
