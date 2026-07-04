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
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { DEFAULT_SLA_HOURS } from '../data/constants'
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
  commentClaimInputSchema,
  transitionClaimInputSchema,
  vendorRecoveryInputSchema,
  type ClaimCreateInput,
  type ClaimInitialLineCreateInput,
  type ClaimUpdateInput,
  type AssignClaimInput,
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
import {
  WARRANTY_CLAIM_RESOURCE_KIND,
  appendClaimEvent,
  enforceWarrantyClaimOptimisticLock,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  loadScopedClaim,
  requireScopedClaim,
  type WarrantyClaimScope,
} from './shared'

const claimCrudEvents: CrudEventsConfig = {
  module: 'warranty_claims',
  entity: 'claim',
  persistent: true,
}

const claimDeleteSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
  })
  .strict()

const submitClaimSchema = claimDeleteSchema

type ClaimDeleteInput = z.infer<typeof claimDeleteSchema>
type SubmitClaimInput = z.infer<typeof submitClaimSchema>

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
  vendorName: string | null
  vendorRef: string | null
  orderId: string | null
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
  claimType: WarrantyClaimType
  status: WarrantyClaimStatus
  customerId: string | null
  organizationId: string
  tenantId: string
  recipientUserIds?: string[]
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
    throw new CrudHttpError(400, { error: '[internal] invalid warranty claim command input' })
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
  const copy = new Date(date.getTime())
  copy.setUTCMonth(copy.getUTCMonth() + months)
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
    warrantyExpiresAt: computedWarranty.warrantyExpiresAt,
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
    vendorName: claim.vendorName ?? null,
    vendorRef: claim.vendorRef ?? null,
    orderId: claim.orderId ?? null,
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
  claim.vendorName = snapshot.vendorName
  claim.vendorRef = snapshot.vendorRef
  claim.orderId = snapshot.orderId
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
  const payload: ClaimEventPayload = {
    id: claim.id,
    claimId: claim.id,
    claimNumber: claim.claimNumber,
    claimType: claim.claimType,
    status: claim.status,
    customerId: claim.customerId ?? null,
    organizationId: claim.organizationId,
    tenantId: claim.tenantId,
  }
  if (claim.customerId) payload.recipientUserIds = [claim.customerId]
  return payload
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
  const candidates = [row.displayName, row.display_name, row.name, row.label]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  return null
}

async function resolveCustomerName(
  em: EntityManager,
  customerId: string | null | undefined,
  scope: WarrantyClaimScope,
  fallback: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return fallback ?? null
  const customer = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: customerId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
  if (!customer) throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidInput' })
  return readCustomerName(customer as unknown as Record<string, unknown>) ?? fallback ?? null
}

const PORTAL_NO_RECIPIENTS = ['__no_portal_recipients__']

async function resolvePortalRecipientUserIds(
  ctx: CommandRuntimeContext,
  claim: WarrantyClaim,
): Promise<string[]> {
  if (!claim.customerId) return PORTAL_NO_RECIPIENTS
  try {
    const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
    const result = await queryEngine.query<Record<string, unknown>>(E.customer_accounts.customer_user as EntityId, {
      tenantId: claim.tenantId,
      organizationId: claim.organizationId,
      filters: {
        customer_entity_id: { $eq: claim.customerId },
        deleted_at: { $eq: null },
        is_active: { $eq: true },
      },
      fields: ['id'],
      page: { page: 1, pageSize: 100 },
    })
    const ids = result.items
      .map((item) => (typeof item.id === 'string' ? item.id : null))
      .filter((id): id is string => Boolean(id))
    return ids.length > 0 ? ids : PORTAL_NO_RECIPIENTS
  } catch {
    return PORTAL_NO_RECIPIENTS
  }
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

function applyClaimUpdate(claim: WarrantyClaim, input: ClaimUpdateInput, customerName: string | null): void {
  if (hasOwn(input, 'customerId')) claim.customerId = input.customerId ?? null
  if (hasOwn(input, 'customerName')) claim.customerName = customerName
  if (hasOwn(input, 'orderId')) claim.orderId = input.orderId ?? null
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
    const numberGenerator = resolveClaimNumberGenerator(ctx, em)
    const generated = await numberGenerator.generate({
      claimType: input.claimType,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const customerName = await resolveCustomerName(em, input.customerId, scope, input.customerName)
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
          vendorName: input.vendorName ?? null,
          vendorRef: input.vendorRef ?? null,
          orderId: input.orderId ?? null,
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
    const shouldRefreshCustomerName = hasOwn(input, 'customerId') || hasOwn(input, 'customerName')
    const customerName = shouldRefreshCustomerName
      ? await resolveCustomerName(em, input.customerId ?? claim.customerId, scope, input.customerName ?? claim.customerName)
      : claim.customerName ?? null
    await withAtomicFlush(em, [
      () => applyClaimUpdate(claim, input, customerName),
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
    await withAtomicFlush(em, [
      () => {
        claim.deletedAt = new Date()
        claim.updatedAt = new Date()
      },
    ], { transaction: true, label: 'warranty_claims.claim.delete' })
    await emitClaimCrud(ctx, 'deleted', claim)
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
    await withAtomicFlush(em, [
      () => {
        const submittedAt = new Date()
        claim.status = 'submitted'
        claim.submittedAt = submittedAt
        claim.slaDueAt = new Date(submittedAt.getTime() + DEFAULT_SLA_HOURS * 60 * 60 * 1000)
        claim.updatedAt = submittedAt
        appendClaimEvent(em, claim, 'status_changed', {
          visibility: 'customer',
          payload: { from: fromStatus, to: 'submitted' },
          actorUserId: ctx.auth?.sub ?? null,
        })
      },
    ], { transaction: true, label: 'warranty_claims.claim.submit' })
    await emitClaimCrud(ctx, 'updated', claim)
    const payload = claimEventPayload(claim)
    await emitWarrantyClaimsEvent('warranty_claims.claim.submitted', payload, { persistent: true })
    await emitWarrantyClaimsEvent('warranty_claims.claim.status_changed', {
      ...payload,
      fromStatus,
      toStatus: 'submitted',
      recipientUserIds: await resolvePortalRecipientUserIds(ctx, claim),
    }, { persistent: true })
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
      () => {
        const now = new Date()
        claim.status = input.toStatus
        if (input.toStatus === 'rejected') claim.rejectionReasonCode = input.rejectionReasonCode ?? null
        if (input.toStatus === 'resolved') {
          claim.resolvedAt = now
          if (hasOwn(input, 'resolutionSummary')) claim.resolutionSummary = input.resolutionSummary ?? null
        }
        if (input.toStatus === 'closed') claim.closedAt = now
        claim.updatedAt = now
        appendClaimEvent(em, claim, 'status_changed', {
          visibility: 'customer',
          payload: { from: fromStatus, to: input.toStatus },
          actorUserId: ctx.auth?.sub ?? null,
        })
      },
    ], { transaction: true, label: 'warranty_claims.claim.transition' })
    await emitClaimCrud(ctx, 'updated', claim)
    await emitWarrantyClaimsEvent('warranty_claims.claim.status_changed', {
      ...claimEventPayload(claim),
      fromStatus,
      toStatus: input.toStatus,
      recipientUserIds: await resolvePortalRecipientUserIds(ctx, claim),
    }, { persistent: true })
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
    await withAtomicFlush(em, [
      () => {
        claim.assigneeUserId = input.assigneeUserId ?? null
        claim.updatedAt = new Date()
        appendClaimEvent(em, claim, 'assignment', {
          visibility: 'internal',
          payload: { assigneeUserId: claim.assigneeUserId },
          actorUserId: ctx.auth?.sub ?? null,
        })
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

const commentClaimCommand: CommandHandler<CommentClaimInput, { claimId: string }> = {
  id: 'warranty_claims.claim.comment',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(commentClaimInputSchema, rawInput)
    const scope = resolveScope(ctx, {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const claim = await requireScopedClaim(em, input.claimId, scope)
    await withAtomicFlush(em, [
      () => {
        appendClaimEvent(em, claim, 'comment', {
          visibility: input.visibility,
          body: input.body,
          actorUserId: input.actorCustomerId ? null : (ctx.auth?.sub ?? null),
          actorCustomerId: input.actorCustomerId ?? null,
        })
      },
    ], { transaction: true, label: 'warranty_claims.claim.comment' })
    if (input.visibility === 'customer') {
      await emitWarrantyClaimsEvent('warranty_claims.claim.comment_added', {
        ...claimEventPayload(claim),
        visibility: input.visibility,
        recipientUserIds: await resolvePortalRecipientUserIds(ctx, claim),
      }, { persistent: true })
    }
    return { claimId: claim.id }
  },
}

const createVendorRecoveryCommand: CommandHandler<VendorRecoveryInput, { claimId: string }> = {
  id: 'warranty_claims.claim.create_vendor_recovery',
  async execute(rawInput, ctx) {
    const input = parseCommandInput(vendorRecoveryInputSchema, rawInput)
    const scope = resolveScope(ctx, {})
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
registerCommand(commentClaimCommand)
registerCommand(createVendorRecoveryCommand)

export const claimCommands = [
  createClaimCommand,
  updateClaimCommand,
  deleteClaimCommand,
  submitClaimCommand,
  transitionClaimCommand,
  assignClaimCommand,
  commentClaimCommand,
  createVendorRecoveryCommand,
]

export {
  createClaimCommand,
  updateClaimCommand,
  deleteClaimCommand,
  submitClaimCommand,
  transitionClaimCommand,
  assignClaimCommand,
  commentClaimCommand,
  createVendorRecoveryCommand,
}
