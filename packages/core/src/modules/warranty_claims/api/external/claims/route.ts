import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../../../data/entities'
import {
  externalClaimIntakeSchema,
  externalClaimLookupQuerySchema,
  type ClaimCreateInput,
  type ExternalClaimIntakeInput,
  type ExternalClaimLookupQuery,
} from '../../../data/validators'
import { resolveEffectiveWarrantyClaimSettings } from '../../../lib/settings'
import {
  buildExternalClaimCreateInput,
  createAndSubmitExternalClaim,
  createExternalIntakeDeps,
  resolveExternalReferences,
  resolveSkuProduct,
  type ExternalIntakeCommandBus,
} from '../../../lib/externalIntake'
import { WARRANTY_CLAIM_RESOURCE_KIND } from '../../../commands/shared'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

type ActionRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  em: EntityManager
  translate: (key: string, fallback?: string) => string
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.external.submit'] },
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.external.view'] },
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

async function resolveActionContext(req: Request): Promise<ActionRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }
  const commandAuth = auth.isApiKey === true && typeof auth.keyId === 'string' && auth.keyId.length > 0
    ? { ...auth, sub: auth.keyId }
    : auth
  return {
    ctx: {
      container,
      auth: commandAuth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    em: (container.resolve('em') as EntityManager).fork(),
    translate,
  }
}

async function runCreateGuard(
  req: Request,
  context: ActionRouteContext,
  input: ExternalClaimIntakeInput,
): Promise<RouteMutationGuardResult> {
  const userId = context.ctx.auth?.sub
  if (!userId) {
    throw new CrudHttpError(401, { error: context.translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
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
      resourceKind: WARRANTY_CLAIM_RESOURCE_KIND,
      resourceId: null,
      operation: 'create',
      mutationPayload: { ...input },
    },
  })
}

async function loadClaimByExternalRef(
  context: ActionRouteContext,
  externalRef: string,
): Promise<WarrantyClaim | null> {
  return findOneWithDecryption(
    context.em,
    WarrantyClaim,
    {
      externalRef,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      deletedAt: null,
    },
    {},
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
}

async function loadClaimByLookup(
  context: ActionRouteContext,
  query: ExternalClaimLookupQuery,
): Promise<WarrantyClaim | null> {
  const where: Record<string, unknown> = {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    deletedAt: null,
  }
  if (query.id) where.id = query.id
  else if (query.claimNumber) where.claimNumber = query.claimNumber
  else if (query.externalRef) where.externalRef = query.externalRef
  return findOneWithDecryption(
    context.em,
    WarrantyClaim,
    where,
    {},
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
}

async function loadClaimLines(
  context: ActionRouteContext,
  claimId: string,
): Promise<WarrantyClaimLine[]> {
  return findWithDecryption(
    context.em,
    WarrantyClaimLine,
    {
      claim: claimId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      deletedAt: null,
    },
    { orderBy: { lineNo: 'ASC' } },
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
}

async function loadCustomerVisibleEvents(
  context: ActionRouteContext,
  claimId: string,
): Promise<WarrantyClaimEvent[]> {
  return findWithDecryption(
    context.em,
    WarrantyClaimEvent,
    {
      claim: claimId,
      visibility: 'customer',
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    },
    { orderBy: { createdAt: 'ASC' } },
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
}

function serializeSubmitResponse(claim: WarrantyClaim, lines: WarrantyClaimLine[]) {
  return {
    ok: true,
    id: claim.id,
    claimNumber: claim.claimNumber,
    status: claim.status,
    externalRef: claim.externalRef ?? null,
    lines: lines.map((line) => ({
      id: line.id,
      warrantyStatus: line.warrantyStatus ?? null,
    })),
  }
}

function serializeLookupResponse(
  claim: WarrantyClaim,
  lines: WarrantyClaimLine[],
  events: WarrantyClaimEvent[],
) {
  return {
    ok: true,
    claim: {
      id: claim.id,
      claimNumber: claim.claimNumber,
      externalRef: claim.externalRef ?? null,
      status: claim.status,
      claimType: claim.claimType,
      channel: claim.channel,
      priority: claim.priority,
      createdAt: toIso(claim.createdAt),
      updatedAt: toIso(claim.updatedAt),
      submittedAt: toIso(claim.submittedAt),
      resolvedAt: toIso(claim.resolvedAt),
      closedAt: toIso(claim.closedAt),
      totalClaimedAmount: claim.totalClaimedAmount ?? null,
      totalApprovedAmount: claim.totalApprovedAmount ?? null,
      currencyCode: claim.currencyCode ?? null,
      resolutionSummary: claim.resolutionSummary ?? null,
    },
    lines: lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      productId: line.productId ?? null,
      sku: line.sku ?? null,
      productName: line.productName ?? null,
      serialNumber: line.serialNumber ?? null,
      qtyClaimed: line.qtyClaimed ?? null,
      qtyApproved: line.qtyApproved ?? null,
      lineStatus: line.lineStatus,
      disposition: line.disposition ?? null,
      warrantyStatus: line.warrantyStatus ?? null,
    })),
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      body: event.body ?? null,
      createdAt: toIso(event.createdAt),
    })),
  }
}

async function submitResponseForClaim(
  context: ActionRouteContext,
  claim: WarrantyClaim,
  status: 200 | 201,
) {
  const lines = await loadClaimLines(context, claim.id)
  return NextResponse.json(serializeSubmitResponse(claim, lines), { status })
}


function resolveEncryptionService(context: ActionRouteContext): TenantDataEncryptionService | null {
  try {
    return context.ctx.container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  } catch {
    return null
  }
}

async function resolveLineProducts(
  context: ActionRouteContext,
  input: ExternalClaimIntakeInput,
): Promise<ExternalClaimIntakeInput> {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const deps = createExternalIntakeDeps(context.em, context.translate, scope, resolveEncryptionService(context))
  const lines = await Promise.all(input.lines.map(async (line) => {
    if (line.productId || !line.sku) return line
    const product = await resolveSkuProduct(deps, line.sku)
    if (!product) return line
    return {
      ...line,
      productId: product.productId,
      productName: line.productName ?? product.productName,
    }
  }))
  return { ...input, lines }
}

async function buildCreateInput(
  context: ActionRouteContext,
  input: ExternalClaimIntakeInput,
): Promise<ClaimCreateInput> {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const deps = createExternalIntakeDeps(context.em, context.translate, scope, resolveEncryptionService(context))
  const resolvedReferences = await resolveExternalReferences(deps, input)
  const effectiveInput = await resolveLineProducts(context, input)
  const settings = await resolveEffectiveWarrantyClaimSettings(context.em, scope)
  return buildExternalClaimCreateInput(effectiveInput, resolvedReferences, settings, scope)
}

export async function POST(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const payload = toRecord(await readJsonSafe(req, {}))
    const input = externalClaimIntakeSchema.parse(payload)

    const existing = await loadClaimByExternalRef(context, input.externalRef)
    if (existing) return submitResponseForClaim(context, existing, 200)

    const guarded = await runCreateGuard(req, context, input)
    if (!guarded.ok) {
      return guarded.response
    }
    const guardedInput = guarded.modifiedPayload
      ? externalClaimIntakeSchema.parse(guarded.modifiedPayload)
      : input
    const createInput = await buildCreateInput(context, guardedInput)

    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const execution = await createAndSubmitExternalClaim({
      commandBus: commandBus as unknown as ExternalIntakeCommandBus,
      commandCtx: context.ctx,
      createInput,
      scope: { tenantId: context.tenantId, organizationId: context.organizationId },
      externalRef: guardedInput.externalRef,
      hasExistingByExternalRef: async (externalRef) => Boolean(await loadClaimByExternalRef(context, externalRef)),
      saveFailedError: () => new CrudHttpError(400, { error: context.translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') }),
    })
    if (execution.outcome === 'existing') {
      const winner = await loadClaimByExternalRef(context, guardedInput.externalRef)
      if (winner) return submitResponseForClaim(context, winner, 200)
      throw new CrudHttpError(400, { error: context.translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') })
    }
    const claimId = execution.claimId

    await guarded.runAfterSuccess()

    const claim = await findOneWithDecryption(
      context.em,
      WarrantyClaim,
      {
        id: claimId,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      {},
      { tenantId: context.tenantId, organizationId: context.organizationId },
    )
    if (!claim) {
      throw new CrudHttpError(400, { error: context.translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') })
    }
    return submitResponseForClaim(context, claim, 201)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.external.claims.post failed', { err })
    return NextResponse.json({ error: translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') }, { status: 400 })
  }
}

export async function GET(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const url = new URL(req.url)
    const query = externalClaimLookupQuerySchema.parse(Object.fromEntries(url.searchParams))
    const claim = await loadClaimByLookup(context, query)
    if (!claim) {
      return NextResponse.json(
        { error: context.translate('warranty_claims.errors.notFound', 'Claim not found.') },
        { status: 404 },
      )
    }
    const [lines, events] = await Promise.all([
      loadClaimLines(context, claim.id),
      loadCustomerVisibleEvents(context, claim.id),
    ])
    return NextResponse.json(serializeLookupResponse(claim, lines, events))
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.external.claims.get failed', { err })
    return NextResponse.json({ error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

const submitLineSchema = z.object({
  id: z.string().uuid(),
  warrantyStatus: z.string().nullable(),
})

const submitResponseSchema = z.object({
  ok: z.literal(true),
  id: z.string().uuid(),
  claimNumber: z.string(),
  status: z.string(),
  externalRef: z.string().nullable(),
  lines: z.array(submitLineSchema),
})

const lookupClaimSchema = z.object({
  id: z.string().uuid(),
  claimNumber: z.string(),
  externalRef: z.string().nullable(),
  status: z.string(),
  claimType: z.string(),
  channel: z.string(),
  priority: z.string(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  totalClaimedAmount: z.string().nullable(),
  totalApprovedAmount: z.string().nullable(),
  currencyCode: z.string().nullable(),
  resolutionSummary: z.string().nullable(),
})

const lookupLineSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number().int(),
  productId: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  productName: z.string().nullable(),
  serialNumber: z.string().nullable(),
  qtyClaimed: z.string().nullable(),
  qtyApproved: z.string().nullable(),
  lineStatus: z.string(),
  disposition: z.string().nullable(),
  warrantyStatus: z.string().nullable(),
})

const lookupEventSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  body: z.string().nullable(),
  createdAt: z.string().nullable(),
})

const lookupResponseSchema = z.object({
  ok: z.literal(true),
  claim: lookupClaimSchema,
  lines: z.array(lookupLineSchema),
  events: z.array(lookupEventSchema),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims External',
  summary: 'External warranty claim intake',
  methods: {
    POST: {
      summary: 'Submit an external warranty claim intake',
      requestBody: { contentType: 'application/json', schema: externalClaimIntakeSchema },
      responses: [
        {
          status: 201,
          description: 'Claim created and submitted',
          schema: submitResponseSchema,
        },
        {
          status: 200,
          description: 'Existing idempotent claim',
          schema: submitResponseSchema,
        },
      ],
    },
    GET: {
      summary: 'Get an external claim status by id, claim number, or external reference',
      query: externalClaimLookupQuerySchema,
      responses: [
        {
          status: 200,
          description: 'External claim status',
          schema: lookupResponseSchema,
        },
      ],
    },
  },
}
