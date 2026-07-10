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
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

const suggestSchema = z.object({
  claimId: z.string().uuid(),
}).strict()

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
          schema: z.unknown(),
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
          schema: z.unknown(),
        },
      ],
    },
  },
}
