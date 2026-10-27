import { NextResponse } from 'next/server'
import { z } from 'zod'
import { asValue } from 'awilix'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { revertUsageInputSchema } from '../../../data/validators'
import type { PromotionsService, RevertUsageInput } from '../../../lib/types'

const logger = createLogger('promotions')

// SPEC-055 §Cart-Facing Endpoints `POST /api/promotions/usage/revert` (Release 4
// PLAN.md Step 6.7) — thin HTTP adapter over `promotionsService.revertUsage()` (Step
// 6.3). Called by the cart integration when an order is cancelled or a quote is
// rejected/expired.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['promotions.usage.manage'] },
}

type RouteContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  userId: string
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId || !auth.sub) {
    throw new CrudHttpError(401, { error: translate('promotions.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('promotions.errors.organization_required', 'Organization context is required'),
    })
  }
  container.register({ auth: asValue({ ...auth, orgId: organizationId }) })
  return { container, userId: auth.sub, tenantId: auth.tenantId, organizationId, translate }
}

export async function POST(req: Request) {
  try {
    const { container, userId, tenantId, organizationId } = await resolveRouteContext(req)
    const body = await readJsonSafe(req, {})

    let input: RevertUsageInput
    try {
      input = revertUsageInputSchema.parse(body) as RevertUsageInput
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid usage/revert payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    // State-changing action endpoint mapped to `update` — rows are never deleted,
    // `reverted_at` is set (§Data Models: a ledger row must outlive the promotion it
    // audited). The batch may revert several promotions' rows for one `orderId`, so
    // there is no single resource id to report, same as `usage/register` above.
    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId, tenantId, organizationId },
      input: { resourceKind: 'promotions.promotion', resourceId: null, operation: 'update', mutationPayload: input as unknown as Record<string, unknown> },
    })
    if (!guarded.ok) return guarded.response

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    const result = await promotionsService.revertUsage(input)

    await guarded.runAfterSuccess()

    return NextResponse.json(result)
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.usage.revert failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.usage_revert_failed', 'Failed to revert promotion usage') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Revert registered promotion usage for a cancelled order or rejected/expired quote',
  methods: {
    POST: {
      summary: 'Revert promotion usage',
      description:
        'Marks every matching PromotionUsage row for the given orderId as reverted (reverted_at set, never deleted) and invalidates the promotion cache.',
      requestBody: { contentType: 'application/json', schema: revertUsageInputSchema },
      responses: [{ status: 200, description: 'Usage reverted' }],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
