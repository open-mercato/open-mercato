import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildWarrantyClaimTriageSuggestion } from '../../../lib/triage'
import {
  claimDispositionSchema,
  claimPrioritySchema,
  claimTypeSchema,
  claimWarrantyStatusSchema,
} from '../../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

const suggestSchema = z.object({
  claimId: z.string().uuid(),
}).strict()

const triageReasonSchema = z.object({
  messageKey: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})

const triageSuggestionSchema = z.object({
  claim: z.object({
    id: z.string().uuid(),
    claimNumber: z.string(),
    claimType: claimTypeSchema,
    status: z.string(),
    customerName: z.string().nullable(),
    submittedAt: z.string().nullable(),
    slaDueAt: z.string().nullable(),
  }),
  eligibility: z.object({
    status: z.enum(['fast_track_candidate', 'review_required']),
    reason: triageReasonSchema,
  }),
  priority: z.object({
    currentPriority: claimPrioritySchema,
    suggestedPriority: claimPrioritySchema,
    ageHours: z.number().nullable(),
    slaDueAt: z.string().nullable(),
    overdue: z.boolean(),
    reason: triageReasonSchema,
  }),
  lines: z.array(z.object({
    lineId: z.string().uuid(),
    lineNo: z.number().int(),
    sku: z.string().nullable(),
    productName: z.string().nullable(),
    serialNumber: z.string().nullable(),
    qtyClaimed: z.number(),
    eligibility: z.object({
      status: claimWarrantyStatusSchema,
      purchaseDate: z.string().nullable(),
      warrantyMonths: z.number().int().nullable(),
      warrantyExpiresAt: z.string().nullable(),
      reason: triageReasonSchema,
    }),
    suggestedDisposition: claimDispositionSchema,
    suggestedPath: z.enum(['replace', 'repair_review', 'deny', 'credit_with_restocking_fee', 'core_accept']),
    reason: triageReasonSchema,
    restockingFeePercent: z.number().nullable(),
  })),
  risk: z.object({
    level: z.enum(['none', 'low', 'medium', 'high']),
    signals: z.array(z.object({
      id: z.enum(['duplicate_serial', 'duplicate_order_claim', 'outside_return_window', 'over_quantity_claim', 'repeat_claimer', 'value_velocity']),
      level: z.enum(['low', 'medium', 'high']),
      messageKey: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      relatedClaimNumbers: z.array(z.string()).optional(),
    })),
  }),
  generatedAt: z.string(),
})

type SuggestRouteContext = {
  tenantId: string
  organizationId: string
  em: EntityManager
  translate: (key: string, fallback?: string) => string
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.claim.view'] },
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.view'] },
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function resolveSuggestContext(req: Request): Promise<SuggestRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }
  return {
    tenantId: auth.tenantId,
    organizationId,
    em: container.resolve<EntityManager>('em').fork(),
    translate,
  }
}

async function buildResponse(context: SuggestRouteContext, input: z.infer<typeof suggestSchema>) {
  const suggestions = await buildWarrantyClaimTriageSuggestion({
    em: context.em,
    claimId: input.claimId,
    scope: { tenantId: context.tenantId, organizationId: context.organizationId },
  })
  return NextResponse.json(suggestions)
}

export async function GET(req: Request) {
  try {
    const context = await resolveSuggestContext(req)
    const url = new URL(req.url)
    const input = suggestSchema.parse({ claimId: url.searchParams.get('claimId') ?? undefined })
    return buildResponse(context, input)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.ai.suggest.get failed', { err })
    return NextResponse.json({ error: translate('warranty_claims.errors.notFound', 'Warranty claim not found.') }, { status: 404 })
  }
}

export async function POST(req: Request) {
  try {
    const context = await resolveSuggestContext(req)
    const input = suggestSchema.parse(toRecord(await readJsonSafe(req, {})))
    return buildResponse(context, input)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.ai.suggest.post failed', { err })
    return NextResponse.json({ error: translate('warranty_claims.errors.notFound', 'Warranty claim not found.') }, { status: 404 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Suggest warranty claim triage',
  methods: {
    GET: {
      summary: 'Return deterministic triage suggestions for a claim',
      query: suggestSchema,
      responses: [
        {
          status: 200,
          description: 'Triage suggestions',
          schema: triageSuggestionSchema,
        },
      ],
    },
    POST: {
      summary: 'Return deterministic triage suggestions for a claim',
      requestBody: { contentType: 'application/json', schema: suggestSchema },
      responses: [
        {
          status: 200,
          description: 'Triage suggestions',
          schema: triageSuggestionSchema,
        },
      ],
    },
  },
}
