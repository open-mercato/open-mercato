import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { AiChatRequestContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/attachment-bridge-types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { checkAttachmentAccess } from '@open-mercato/core/modules/attachments/lib/access'
import { readAttachmentMetadata } from '@open-mercato/core/modules/attachments/lib/metadata'
import { WarrantyClaimLine } from '../../../data/entities'
import {
  assessDamagePhoto,
  extractProofOfPurchase,
  isWarrantyAiNotConfiguredError,
  isWarrantyAiUnavailableError,
} from '../../../lib/aiAssist'
import {
  WARRANTY_CLAIM_LINE_RESOURCE_KIND,
  requireScopedClaim,
  type WarrantyClaimScope,
} from '../../../commands/shared'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

const uuid = z.string().uuid()
const optimisticLockTokenSchema = z.union([z.string().datetime(), z.date()]).nullable().optional()
const CLAIM_ATTACHMENT_ENTITY_ID = 'warranty_claims:warranty_claim'
const LINE_ATTACHMENT_ENTITY_ID = 'warranty_claims:warranty_claim_line'

const assessBodySchema = z
  .object({
    claimId: uuid,
    lineId: uuid.optional(),
    attachmentId: uuid,
    kind: z.enum(['damage', 'proof']),
    organizationId: uuid.optional(),
    tenantId: uuid.optional(),
    updatedAt: optimisticLockTokenSchema,
  })
  .strict()

type AssessBodyInput = z.infer<typeof assessBodySchema>

type AssessRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  container: AwilixContainer
  em: EntityManager
  translate: (key: string, fallback?: string) => string
}

type SetAssessmentCommandInput = {
  id: string
  organizationId: string
  tenantId: string
  assessmentPayload: Record<string, unknown>
  updatedAt?: string | Date | null
}

const damageAssessmentSchema = z.object({
  damageType: z.string(),
  severity: z.enum(['minor', 'moderate', 'severe', 'unknown']),
  probableCause: z.string(),
  misuseSuspected: z.boolean(),
  confidence: z.number(),
  summary: z.string(),
})

const proofExtractionSchema = z.object({
  purchaseDate: z.string().nullable(),
  serialNumber: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  merchant: z.string().nullable(),
  confidence: z.number(),
})

const assessResponseSchema = z.union([
  z.object({
    status: z.literal('ok'),
    assessment: damageAssessmentSchema.optional(),
    extraction: proofExtractionSchema.optional(),
  }),
  z.object({ status: z.literal('notConfigured') }),
  z.object({ status: z.literal('aiUnavailable') }),
])

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isSuperAdmin(auth: CommandRuntimeContext['auth']): boolean {
  return Boolean(auth && toRecord(auth).isSuperAdmin === true)
}

function buildAuthContext(context: AssessRouteContext): AiChatRequestContext {
  const userId = context.ctx.auth?.sub
  if (!userId) {
    throw new CrudHttpError(401, { error: 'warranty_claims.errors.unauthorized' })
  }
  return {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    userId,
    features: [],
    isSuperAdmin: isSuperAdmin(context.ctx.auth),
  }
}

function buildAttachmentAuthContext(context: AssessRouteContext): Exclude<AuthContext, null> {
  const auth = context.ctx.auth
  if (!auth?.sub) {
    throw new CrudHttpError(401, { error: 'warranty_claims.errors.unauthorized' })
  }
  return {
    ...auth,
    sub: auth.sub,
    tenantId: context.tenantId,
    orgId: context.organizationId,
  }
}

async function resolveAssessContext(req: Request): Promise<AssessRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'warranty_claims.errors.unauthorized' })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.organization_required' })
  }
  return {
    ctx: {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    container,
    em: container.resolve<EntityManager>('em').fork(),
    translate: (key: string) => key,
  }
}

function toAssessInput(payload: Record<string, unknown>, context: AssessRouteContext): AssessBodyInput {
  return assessBodySchema.parse(withScopedPayload(payload, context.ctx, context.translate))
}

async function runGuard(
  req: Request,
  context: AssessRouteContext,
  input: AssessBodyInput & { lineId: string },
): Promise<RouteMutationGuardResult> {
  const userId = context.ctx.auth?.sub
  if (!userId) {
    throw new CrudHttpError(401, { error: 'warranty_claims.errors.unauthorized' })
  }
  return runRouteMutationGuards({
    container: context.ctx.container,
    req,
    auth: {
      userId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    },
    input: {
      resourceKind: WARRANTY_CLAIM_LINE_RESOURCE_KIND,
      resourceId: input.lineId,
      operation: 'custom',
      mutationPayload: { ...input },
    },
  })
}

async function loadScopedLine(
  em: EntityManager,
  scope: WarrantyClaimScope,
  claimId: string,
  lineId: string,
): Promise<WarrantyClaimLine> {
  const line = await findOneWithDecryption(
    em,
    WarrantyClaimLine,
    {
      id: lineId,
      claim: claimId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )
  if (!line) {
    throw new CrudHttpError(404, { error: 'warranty_claims.errors.notFound' })
  }
  return line
}

function attachmentMatchesTarget(
  attachment: Attachment,
  claimId: string,
  lineId: string | null | undefined,
): boolean {
  const metadata = readAttachmentMetadata(attachment.storageMetadata)
  const assignedToClaim =
    (attachment.entityId === CLAIM_ATTACHMENT_ENTITY_ID && attachment.recordId === claimId) ||
    metadata.assignments?.some((assignment) => (
      assignment.type === CLAIM_ATTACHMENT_ENTITY_ID && assignment.id === claimId
    )) === true
  if (assignedToClaim) return true
  if (!lineId) return false
  return (
    (attachment.entityId === LINE_ATTACHMENT_ENTITY_ID && attachment.recordId === lineId) ||
    metadata.assignments?.some((assignment) => (
      assignment.type === LINE_ATTACHMENT_ENTITY_ID && assignment.id === lineId
    )) === true
  )
}

async function verifyAttachmentLinkedToTarget(
  context: AssessRouteContext,
  input: { attachmentId: string; claimId: string; lineId?: string | null },
): Promise<void> {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const attachment = await findOneWithDecryption(
    context.em,
    Attachment,
    {
      id: input.attachmentId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    },
    {},
    scope,
  )
  if (!attachment) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.attachmentNotLinked' })
  }

  const partition = await context.em.findOne(AttachmentPartition, { code: attachment.partitionCode })
  if (!partition) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.attachmentNotLinked' })
  }

  const access = checkAttachmentAccess(buildAttachmentAuthContext(context), attachment, partition, {
    requireAuthForPublic: true,
  })
  if (!access.ok || !attachmentMatchesTarget(attachment, input.claimId, input.lineId)) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.attachmentNotLinked' })
  }
}

function mergeAssessmentPayload(
  current: Record<string, unknown> | null | undefined,
  key: 'damage' | 'proof',
  value: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    [key]: value,
    generatedAt: new Date().toISOString(),
  }
}

async function persistAssessmentPayload(
  context: AssessRouteContext,
  line: WarrantyClaimLine,
  key: 'damage' | 'proof',
  value: Record<string, unknown>,
  updatedAt: string | Date | null | undefined,
): Promise<void> {
  const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
  const assessmentPayload = mergeAssessmentPayload(line.assessmentPayload ?? null, key, value)
  await commandBus.execute<SetAssessmentCommandInput, { lineId: string; claimId: string }>(
    'warranty_claims.claim_line.set_assessment',
    {
      input: {
        id: line.id,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
        assessmentPayload,
        updatedAt,
      },
      ctx: context.ctx,
    },
  )
}

export async function POST(req: Request) {
  try {
    const context = await resolveAssessContext(req)
    const payload = toRecord(await readJsonSafe(req, {}))
    const parsed = toAssessInput(payload, context)
    if (parsed.kind === 'damage' && !parsed.lineId) {
      throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidInput' })
    }

    const guarded = parsed.lineId ? await runGuard(req, context, parsed as AssessBodyInput & { lineId: string }) : null
    if (guarded && !guarded.ok) {
      return guarded.response
    }
    const input = guarded?.modifiedPayload ? toAssessInput(guarded.modifiedPayload, context) : parsed
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }

    if (input.kind === 'damage') {
      if (!input.lineId) {
        throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidInput' })
      }
      const line = await loadScopedLine(context.em, scope, input.claimId, input.lineId)
      await verifyAttachmentLinkedToTarget(context, {
        attachmentId: input.attachmentId,
        claimId: input.claimId,
        lineId: input.lineId,
      })
      const assessment = await assessDamagePhoto({
        em: context.em,
        container: context.container,
        scope,
        claimId: input.claimId,
        lineId: input.lineId,
        attachmentId: input.attachmentId,
        authContext: buildAuthContext(context),
      })
      await persistAssessmentPayload(context, line, 'damage', assessment, input.updatedAt)
      await guarded?.runAfterSuccess()
      return NextResponse.json({ status: 'ok', assessment })
    }

    await requireScopedClaim(context.em, input.claimId, scope)
    const line = input.lineId ? await loadScopedLine(context.em, scope, input.claimId, input.lineId) : null
    await verifyAttachmentLinkedToTarget(context, {
      attachmentId: input.attachmentId,
      claimId: input.claimId,
      lineId: input.lineId ?? null,
    })
    const extraction = await extractProofOfPurchase({
      em: context.em,
      container: context.container,
      scope,
      attachmentId: input.attachmentId,
      authContext: buildAuthContext(context),
    })
    if (line) {
      await persistAssessmentPayload(context, line, 'proof', extraction, input.updatedAt)
      await guarded?.runAfterSuccess()
    }
    return NextResponse.json({ status: 'ok', extraction })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (isWarrantyAiNotConfiguredError(err)) {
      return NextResponse.json({ status: 'notConfigured' })
    }
    if (isWarrantyAiUnavailableError(err)) {
      return NextResponse.json({ status: 'aiUnavailable' })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'warranty_claims.errors.invalidInput' }, { status: 400 })
    }
    logger.error('warranty_claims.ai.assess.post failed', { err })
    return NextResponse.json({ error: 'warranty_claims.errors.save_failed' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Assess warranty claim attachment with AI',
  methods: {
    POST: {
      summary: 'Assess a damage photo or extract proof-of-purchase facts',
      requestBody: { contentType: 'application/json', schema: assessBodySchema },
      responses: [
        {
          status: 200,
          description: 'Assessment completed or AI gracefully degraded',
          schema: assessResponseSchema,
        },
      ],
    },
  },
}
