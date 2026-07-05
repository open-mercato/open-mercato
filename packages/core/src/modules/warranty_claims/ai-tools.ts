import type { AwilixContainer } from 'awilix'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from './data/entities'
import {
  claimStatusSchema,
  claimTypeSchema,
  transitionClaimInputSchema,
  type TransitionClaimInput,
} from './data/validators'
import {
  assessDamagePhoto,
  buildClaimReplyDraft,
  buildClaimSummary,
  extractProofOfPurchase,
  isWarrantyAiNotConfiguredError,
  isWarrantyAiUnavailableError,
} from './lib/aiAssist'
import type { AiChatRequestContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/attachment-bridge-types'
import { buildWarrantyClaimTriageSuggestion } from './lib/triage'

export interface WarrantyClaimsToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
  apiKeySecret?: string
  sessionId?: string
}

export interface WarrantyClaimsToolLoadBeforeSingleRecord {
  recordId: string
  entityType: string
  recordVersion: string | null
  before: Record<string, unknown>
  after?: Record<string, unknown>
  display?: {
    fieldLabels?: Record<string, string>
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  }
}

export interface WarrantyClaimsAiToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures?: string[]
  tags?: string[]
  isMutation?: boolean
  isDestructive?: boolean | ((input: TInput) => boolean)
  maxCallsPerTurn?: number
  supportsAttachments?: boolean
  handler: (input: TInput, context: WarrantyClaimsToolContext) => Promise<TOutput>
  loadBeforeRecord?: (
    input: TInput,
    context: WarrantyClaimsToolContext,
  ) => Promise<WarrantyClaimsToolLoadBeforeSingleRecord | null>
}

type Scope = {
  tenantId: string
  organizationId: string
}

type ClaimSummary = {
  id: string
  claimNumber: string
  claimType: string
  status: string
  priority: string
  customerId: string | null
  customerName: string | null
  orderId: string | null
  assigneeUserId: string | null
  updatedAt: string | null
}

function assertScope(ctx: WarrantyClaimsToolContext): Scope {
  if (!ctx.tenantId) {
    throw new Error('Tenant context is required for warranty_claims.* tools')
  }
  if (!ctx.organizationId) {
    throw new Error('Organization context is required for warranty_claims.* tools')
  }
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

function resolveEm(ctx: WarrantyClaimsToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildAttachmentAuthContext(ctx: WarrantyClaimsToolContext, scope: Scope): AiChatRequestContext {
  if (!ctx.userId) {
    throw new Error('User context is required for warranty_claims attachment-aware tools.')
  }
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    userId: ctx.userId,
    features: ctx.userFeatures,
    isSuperAdmin: ctx.isSuperAdmin,
  }
}

function toIso(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}

function recordVersionFromUpdatedAt(updatedAt: Date | null | undefined): string | null {
  return toIso(updatedAt)
}

function serializeClaimSummary(claim: WarrantyClaim): ClaimSummary {
  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    claimType: claim.claimType,
    status: claim.status,
    priority: claim.priority,
    customerId: claim.customerId ?? null,
    customerName: claim.customerName ?? null,
    orderId: claim.orderId ?? null,
    assigneeUserId: claim.assigneeUserId ?? null,
    updatedAt: toIso(claim.updatedAt),
  }
}

function serializeLine(line: WarrantyClaimLine): Record<string, unknown> {
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
    purchaseDate: toIso(line.purchaseDate)?.slice(0, 10) ?? null,
    warrantyMonths: line.warrantyMonths ?? null,
    warrantyExpiresAt: toIso(line.warrantyExpiresAt)?.slice(0, 10) ?? null,
    warrantyStatus: line.warrantyStatus,
    faultCode: line.faultCode ?? null,
    faultDescription: line.faultDescription ?? null,
    qtyClaimed: line.qtyClaimed,
    qtyApproved: line.qtyApproved ?? null,
    qtyReceived: line.qtyReceived ?? null,
    disposition: line.disposition ?? null,
    lineStatus: line.lineStatus,
    creditAmount: line.creditAmount ?? null,
    restockingFee: line.restockingFee ?? null,
    coreChargeAmount: line.coreChargeAmount ?? null,
    coreCreditAmount: line.coreCreditAmount ?? null,
  }
}

function serializeTimelineEvent(event: WarrantyClaimEvent): Record<string, unknown> {
  return {
    id: event.id,
    claimId: relationId(event.claim),
    kind: event.kind,
    visibility: event.visibility,
    body: event.body ?? null,
    payload: event.payload ?? null,
    actorUserId: event.actorUserId ?? null,
    actorCustomerId: event.actorCustomerId ?? null,
    createdAt: toIso(event.createdAt),
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveClaimId(em: EntityManager, scope: Scope, ref: string): Promise<string | null> {
  const trimmed = ref.trim()
  if (!trimmed) return null
  if (UUID_PATTERN.test(trimmed)) return trimmed
  const claim = await findOneWithDecryption(
    em,
    WarrantyClaim,
    { claimNumber: trimmed, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
  return claim?.id ?? null
}

async function loadClaim(em: EntityManager, scope: Scope, claimId: string): Promise<WarrantyClaim | null> {
  return findOneWithDecryption(
    em,
    WarrantyClaim,
    { id: claimId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
}

async function loadLines(em: EntityManager, scope: Scope, claimId: string): Promise<WarrantyClaimLine[]> {
  return findWithDecryption(
    em,
    WarrantyClaimLine,
    { claim: claimId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { lineNo: 'ASC' } },
    scope,
  )
}

async function loadTimeline(em: EntityManager, scope: Scope, claimId: string): Promise<WarrantyClaimEvent[]> {
  return findWithDecryption(
    em,
    WarrantyClaimEvent,
    { claim: claimId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { createdAt: 'ASC' } },
    scope,
  )
}

const listClaimsInput = z.object({
  q: z.string().trim().max(300).optional(),
  status: z.union([claimStatusSchema, z.array(claimStatusSchema).min(1).max(12)]).optional(),
  claimType: claimTypeSchema.optional(),
  customerId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
}).passthrough()

type ListClaimsInput = z.infer<typeof listClaimsInput>

const listClaimsTool: WarrantyClaimsAiToolDefinition = {
  name: 'warranty_claims.list_claims',
  displayName: 'List warranty claims',
  description: 'Search and list warranty/RMA claims for the current tenant and organization. Supports status, type, customer, order, and text filters.',
  inputSchema: listClaimsInput as z.ZodType<unknown>,
  requiredFeatures: ['warranty_claims.claim.view'],
  tags: ['read', 'warranty_claims'],
  handler: async (rawInput, ctx) => {
    const scope = assertScope(ctx)
    const input = listClaimsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const filters: Record<string, unknown> = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    }
    if (input.status) {
      filters.status = Array.isArray(input.status) ? { $in: input.status } : input.status
    }
    if (input.claimType) filters.claimType = input.claimType
    if (input.customerId) filters.customerId = input.customerId
    if (input.orderId) filters.orderId = input.orderId
    if (input.q?.trim()) {
      const pattern = buildIlikeTerm(input.q.trim())
      filters.$or = [
        { claimNumber: { $ilike: pattern } },
        { customerName: { $ilike: pattern } },
        { vendorName: { $ilike: pattern } },
        { vendorRef: { $ilike: pattern } },
      ]
    }
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const [claims, total] = await Promise.all([
      findWithDecryption(
        em,
        WarrantyClaim,
        filters as FilterQuery<WarrantyClaim>,
        { limit, offset, orderBy: { updatedAt: 'DESC' } },
        scope,
      ),
      em.count(WarrantyClaim, filters as FilterQuery<WarrantyClaim>),
    ])
    return {
      items: claims.map(serializeClaimSummary),
      total,
      limit,
      offset,
    }
  },
}

const claimRefSchema = z
  .string()
  .trim()
  .min(1)
  .describe('Claim UUID or human-readable claim number (e.g. WTY-000123).')

const getClaimInput = z.object({
  claimId: claimRefSchema,
  includeTimeline: z.boolean().optional(),
}).passthrough()

type GetClaimInput = z.infer<typeof getClaimInput>

const getClaimTool: WarrantyClaimsAiToolDefinition = {
  name: 'warranty_claims.get_claim',
  displayName: 'Get warranty claim',
  description: 'Fetch one claim with header fields, lines, and optional timeline summary. Accepts a claim UUID or the human-readable claim number (e.g. WTY-000123). Returns { found: false } when outside scope.',
  inputSchema: getClaimInput as z.ZodType<unknown>,
  requiredFeatures: ['warranty_claims.claim.view'],
  tags: ['read', 'warranty_claims'],
  handler: async (rawInput, ctx) => {
    const scope = assertScope(ctx)
    const input = getClaimInput.parse(rawInput)
    const em = resolveEm(ctx)
    const claimId = await resolveClaimId(em, scope, input.claimId)
    const claim = claimId ? await loadClaim(em, scope, claimId) : null
    if (!claim) return { found: false, claimId: input.claimId }
    const [lines, timeline] = await Promise.all([
      loadLines(em, scope, claim.id),
      input.includeTimeline ? loadTimeline(em, scope, claim.id) : Promise.resolve([]),
    ])
    return {
      found: true,
      claim: {
        ...serializeClaimSummary(claim),
        channel: claim.channel,
        vendorName: claim.vendorName ?? null,
        vendorRef: claim.vendorRef ?? null,
        salesReturnId: claim.salesReturnId ?? null,
        replacementOrderId: claim.replacementOrderId ?? null,
        sourceClaimId: claim.sourceClaimId ?? null,
        advanceReplacement: claim.advanceReplacement,
        reasonCode: claim.reasonCode ?? null,
        rejectionReasonCode: claim.rejectionReasonCode ?? null,
        resolutionSummary: claim.resolutionSummary ?? null,
        currencyCode: claim.currencyCode ?? null,
        totalClaimedAmount: claim.totalClaimedAmount ?? null,
        totalApprovedAmount: claim.totalApprovedAmount ?? null,
        totalRecoveredAmount: claim.totalRecoveredAmount ?? null,
        slaDueAt: toIso(claim.slaDueAt),
        submittedAt: toIso(claim.submittedAt),
        resolvedAt: toIso(claim.resolvedAt),
        closedAt: toIso(claim.closedAt),
        createdAt: toIso(claim.createdAt),
      },
      lines: lines.map(serializeLine),
      timeline: timeline.map(serializeTimelineEvent),
    }
  },
}

const suggestTriageInput = z.object({
  claimId: claimRefSchema,
}).passthrough()

type SuggestTriageInput = z.infer<typeof suggestTriageInput>

const suggestTriageTool: WarrantyClaimsAiToolDefinition = {
  name: 'warranty_claims.suggest_triage',
  displayName: 'Suggest warranty claim triage',
  description: 'Read-only deterministic triage heuristics: warranty eligibility, line disposition suggestions, and priority/SLA recommendation. Accepts a claim UUID or the human-readable claim number (e.g. WTY-000123).',
  inputSchema: suggestTriageInput as z.ZodType<unknown>,
  requiredFeatures: ['warranty_claims.claim.view'],
  tags: ['read', 'warranty_claims'],
  handler: async (rawInput, ctx) => {
    const scope = assertScope(ctx)
    const input = suggestTriageInput.parse(rawInput)
    const em = resolveEm(ctx)
    const claimId = await resolveClaimId(em, scope, input.claimId)
    if (!claimId) return { found: false, claimId: input.claimId }
    return buildWarrantyClaimTriageSuggestion({
      em,
      claimId,
      scope,
    })
  },
}

const draftCustomerReplyInput = z.object({
  claimId: claimRefSchema,
  tone: z.enum(['formal', 'friendly', 'concise']).optional(),
}).passthrough()

const draftCustomerReplyTool: WarrantyClaimsAiToolDefinition = {
  name: 'warranty_claims.draft_customer_reply',
  displayName: 'Draft customer reply',
  description: 'Generate a suggested customer-facing warranty claim reply for the operator to review, edit, and send manually. Accepts a claim UUID or the human-readable claim number (e.g. WTY-000123).',
  inputSchema: draftCustomerReplyInput as z.ZodType<unknown>,
  requiredFeatures: ['warranty_claims.claim.manage'],
  tags: ['read', 'warranty_claims'],
  handler: async (rawInput, ctx) => {
    const scope = assertScope(ctx)
    const input = draftCustomerReplyInput.parse(rawInput)
    const em = resolveEm(ctx)
    const claimId = await resolveClaimId(em, scope, input.claimId)
    if (!claimId) return { found: false, claimId: input.claimId }
    try {
      return await buildClaimReplyDraft({
        em,
        container: ctx.container,
        scope,
        claimId,
        tone: input.tone,
      })
    } catch (err) {
      if (isWarrantyAiNotConfiguredError(err)) {
        return { notConfigured: true }
      }
      if (isWarrantyAiUnavailableError(err)) {
        return { unavailable: true }
      }
      throw err
    }
  },
}

const summarizeClaimInput = z.object({
  claimId: claimRefSchema,
}).passthrough()

const summarizeClaimTool: WarrantyClaimsAiToolDefinition = {
  name: 'warranty_claims.summarize_claim',
  displayName: 'Summarize warranty claim',
  description: 'Generate a concise internal summary of a warranty claim, including timeline history and open questions. Accepts a claim UUID or the human-readable claim number (e.g. WTY-000123).',
  inputSchema: summarizeClaimInput as z.ZodType<unknown>,
  requiredFeatures: ['warranty_claims.claim.view'],
  tags: ['read', 'warranty_claims'],
  handler: async (rawInput, ctx) => {
    const scope = assertScope(ctx)
    const input = summarizeClaimInput.parse(rawInput)
    const em = resolveEm(ctx)
    const claimId = await resolveClaimId(em, scope, input.claimId)
    if (!claimId) return { found: false, claimId: input.claimId }
    try {
      return await buildClaimSummary({
        em,
        container: ctx.container,
        scope,
        claimId,
      })
    } catch (err) {
      if (isWarrantyAiNotConfiguredError(err)) {
        return { notConfigured: true }
      }
      if (isWarrantyAiUnavailableError(err)) {
        return { unavailable: true }
      }
      throw err
    }
  },
}

const assessDamagePhotoInput = z.object({
  claimId: z.string().uuid(),
  lineId: z.string().uuid(),
  attachmentId: z.string().uuid(),
}).passthrough()

const assessDamagePhotoTool: WarrantyClaimsAiToolDefinition = {
  name: 'warranty_claims.assess_damage_photo',
  displayName: 'Assess damage photo',
  description: 'Assess a warranty claim line damage photo and return structured facts without mutating amounts.',
  inputSchema: assessDamagePhotoInput as z.ZodType<unknown>,
  requiredFeatures: ['warranty_claims.claim.manage'],
  tags: ['read', 'warranty_claims', 'attachments'],
  isMutation: false,
  supportsAttachments: true,
  handler: async (rawInput, ctx) => {
    const scope = assertScope(ctx)
    const input = assessDamagePhotoInput.parse(rawInput)
    const em = resolveEm(ctx)
    try {
      return await assessDamagePhoto({
        em,
        container: ctx.container,
        scope,
        claimId: input.claimId,
        lineId: input.lineId,
        attachmentId: input.attachmentId,
        authContext: buildAttachmentAuthContext(ctx, scope),
      })
    } catch (err) {
      if (isWarrantyAiNotConfiguredError(err)) {
        return { notConfigured: true }
      }
      if (isWarrantyAiUnavailableError(err)) {
        return { unavailable: true }
      }
      throw err
    }
  },
}

const extractProofOfPurchaseInput = z.object({
  claimId: z.string().uuid(),
  attachmentId: z.string().uuid(),
}).passthrough()

const extractProofOfPurchaseTool: WarrantyClaimsAiToolDefinition = {
  name: 'warranty_claims.extract_proof_of_purchase',
  displayName: 'Extract proof of purchase',
  description: 'Extract purchase date, serial, amount string, currency, and merchant facts from a receipt image or PDF.',
  inputSchema: extractProofOfPurchaseInput as z.ZodType<unknown>,
  requiredFeatures: ['warranty_claims.claim.manage'],
  tags: ['read', 'warranty_claims', 'attachments'],
  isMutation: false,
  supportsAttachments: true,
  handler: async (rawInput, ctx) => {
    const scope = assertScope(ctx)
    const input = extractProofOfPurchaseInput.parse(rawInput)
    const em = resolveEm(ctx)
    const claim = await loadClaim(em, scope, input.claimId)
    if (!claim) {
      throw new Error(`Warranty claim "${input.claimId}" is not accessible to the caller.`)
    }
    try {
      return await extractProofOfPurchase({
        em,
        container: ctx.container,
        scope,
        attachmentId: input.attachmentId,
        authContext: buildAttachmentAuthContext(ctx, scope),
      })
    } catch (err) {
      if (isWarrantyAiNotConfiguredError(err)) {
        return { notConfigured: true }
      }
      if (isWarrantyAiUnavailableError(err)) {
        return { unavailable: true }
      }
      throw err
    }
  },
}

const transitionClaimToolInput = transitionClaimInputSchema.passthrough()

type TransitionClaimToolInput = z.infer<typeof transitionClaimToolInput>

function toTransitionCommandInput(input: TransitionClaimToolInput): TransitionClaimInput {
  return transitionClaimInputSchema.parse({
    id: input.id,
    toStatus: input.toStatus,
    rejectionReasonCode: input.rejectionReasonCode,
    resolutionSummary: input.resolutionSummary,
  })
}

function buildCommandContext(ctx: WarrantyClaimsToolContext, scope: Scope): CommandRuntimeContext {
  if (!ctx.userId) {
    throw new Error('User context is required to transition warranty claims.')
  }
  return {
    container: ctx.container,
    auth: {
      sub: ctx.userId,
      userId: ctx.userId,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
    },
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
}

const transitionClaimTool: WarrantyClaimsAiToolDefinition = {
  name: 'warranty_claims.transition_claim',
  displayName: 'Transition warranty claim',
  description: 'Move a warranty/RMA claim through the lifecycle. Mutation tool — goes through the AI pending-action approval gate.',
  inputSchema: transitionClaimToolInput as z.ZodType<unknown>,
  requiredFeatures: ['warranty_claims.claim.manage'],
  tags: ['write', 'warranty_claims'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx) => {
    const scope = assertScope(ctx)
    const input = transitionClaimToolInput.parse(rawInput)
    const em = resolveEm(ctx)
    const claim = await loadClaim(em, scope, input.id)
    if (!claim) return null
    return {
      recordId: claim.id,
      entityType: 'warranty_claims.claim',
      recordVersion: recordVersionFromUpdatedAt(claim.updatedAt),
      before: {
        status: claim.status,
        rejectionReasonCode: claim.rejectionReasonCode ?? null,
        resolutionSummary: claim.resolutionSummary ?? null,
      },
      after: {
        status: input.toStatus,
        rejectionReasonCode: input.rejectionReasonCode ?? claim.rejectionReasonCode ?? null,
        resolutionSummary: input.resolutionSummary ?? claim.resolutionSummary ?? null,
      },
      display: {
        fieldLabels: {
          status: 'Status',
          rejectionReasonCode: 'Rejection reason',
          resolutionSummary: 'Resolution summary',
        },
        before: {
          status: claim.status,
          rejectionReasonCode: claim.rejectionReasonCode ?? null,
          resolutionSummary: claim.resolutionSummary ?? null,
        },
        after: {
          status: input.toStatus,
          rejectionReasonCode: input.rejectionReasonCode ?? claim.rejectionReasonCode ?? null,
          resolutionSummary: input.resolutionSummary ?? claim.resolutionSummary ?? null,
        },
      },
    }
  },
  handler: async (rawInput, ctx) => {
    const scope = assertScope(ctx)
    const input = transitionClaimToolInput.parse(rawInput)
    const em = resolveEm(ctx)
    const before = await loadClaim(em, scope, input.id)
    if (!before) {
      throw new Error(`Warranty claim "${input.id}" is not accessible to the caller.`)
    }
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const commandCtx = buildCommandContext(ctx, scope)
    const commandInput = toTransitionCommandInput(input)
    const { result } = await commandBus.execute<TransitionClaimInput, { claimId: string }>(
      'warranty_claims.claim.transition',
      { input: commandInput, ctx: commandCtx },
    )
    const after = await loadClaim(em, scope, result?.claimId ?? input.id)
    return {
      recordId: input.id,
      commandName: 'warranty_claims.claim.transition',
      before: serializeClaimSummary(before),
      after: after ? serializeClaimSummary(after) : null,
    }
  },
}

export const aiTools: WarrantyClaimsAiToolDefinition[] = [
  listClaimsTool,
  getClaimTool,
  suggestTriageTool,
  draftCustomerReplyTool,
  summarizeClaimTool,
  assessDamagePhotoTool,
  extractProofOfPurchaseTool,
  transitionClaimTool,
]

export default aiTools
