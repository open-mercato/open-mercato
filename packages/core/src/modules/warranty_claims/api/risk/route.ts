import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarrantyClaimLine } from '../../data/entities'
import { requireScopedClaim, type WarrantyClaimScope } from '../../commands/shared'
import { evaluateClaimRisk } from '../../lib/risk'

const querySchema = z.object({
  claimId: z.string().uuid(),
}).strict()

const riskSignalSchema = z.object({
  id: z.enum(['duplicate_serial', 'repeat_claimer', 'value_velocity']),
  level: z.enum(['low', 'medium', 'high']),
  messageKey: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  relatedClaimNumbers: z.array(z.string()).optional(),
})

const responseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    level: z.enum(['none', 'low', 'medium', 'high']),
    signals: z.array(riskSignalSchema),
  }),
})

type RiskRouteContext = {
  tenantId: string
  organizationId: string
  scope: WarrantyClaimScope
  em: EntityManager
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.claim.view'] },
}

async function resolveRiskContext(req: Request): Promise<RiskRouteContext> {
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
  const em = container.resolve('em') as EntityManager
  return {
    tenantId: auth.tenantId,
    organizationId,
    scope: { tenantId: auth.tenantId, organizationId },
    em,
  }
}

export async function GET(req: Request) {
  try {
    const context = await resolveRiskContext(req)
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const claim = await requireScopedClaim(context.em, query.claimId, context.scope)
    const lines = await findWithDecryption(
      context.em,
      WarrantyClaimLine,
      { claim: claim.id, tenantId: context.tenantId, organizationId: context.organizationId, deletedAt: null },
      { orderBy: { lineNo: 'ASC' } },
      context.scope,
    )
    const result = await evaluateClaimRisk(context.em, claim, lines)
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    console.error('warranty_claims.risk.get failed', err)
    return NextResponse.json({ error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Evaluate warranty claim risk',
  methods: {
    GET: {
      summary: 'Evaluate deterministic risk signals for a claim',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Risk assessment',
          schema: responseSchema,
        },
      ],
    },
  },
}
