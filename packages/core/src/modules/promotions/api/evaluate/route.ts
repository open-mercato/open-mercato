import { NextResponse } from 'next/server'
import { z } from 'zod'
import { asValue } from 'awilix'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { evaluateInputSchema } from '../../data/validators'
import type { EvaluateInput, PromotionsService } from '../../lib/types'

const logger = createLogger('promotions')

// §Cart-Facing Endpoints `POST /api/promotions/evaluate` — "Authenticated per the
// standard API-key model stated above ... not a module-specific scheme" (D-R4-11/C3).
// Same `getAuthFromRequest(req)` call every other route in this codebase uses — API-key
// and cookie-session auth are already unified behind it, so this route needs no
// separate "API-key mode" branch.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['promotions.evaluate'] },
}

type RouteContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  translate: (key: string, fallback?: string) => string
}

async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('promotions.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('promotions.errors.organization_required', 'Organization context is required'),
    })
  }
  // `organizationId`/`tenantId` are never read from the request body (D-R4-11/C3) —
  // they come from `auth`, resolved above. `promotionsService.evaluate()`'s signature is
  // frozen with no scope parameter (§Public TypeScript Contract); it resolves scope from
  // whatever `auth` is registered on ITS OWN container at call time
  // (`lib/promotions-service.ts`'s `resolvePromotionsServiceScope`). This route is
  // therefore the documented in-process caller contract that file anticipates: register
  // `auth` (with `orgId` pinned to the resolved single-organization scope, not necessarily
  // the raw `auth.orgId` a super-admin's "all organizations" cookie would carry) before
  // resolving `promotionsService`.
  container.register({ auth: asValue({ ...auth, orgId: organizationId }) })
  return { container, translate }
}

export async function POST(req: Request) {
  try {
    const { container } = await resolveRouteContext(req)
    const body = await readJsonSafe(req, {})

    let input: EvaluateInput
    try {
      input = evaluateInputSchema.parse(body) as EvaluateInput
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid evaluate payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    // No catalog visibility/assortment filtering here by design — `evaluate` operates on
    // an already-resolved cart's own line items, not a product listing (§Cart-Facing
    // Endpoints: this route's docstring intentionally omits the visibility note the
    // listing/badge-shaped routes below carry).
    const result = await promotionsService.evaluate(input)
    return NextResponse.json(result)
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.evaluate failed', { err })
    return NextResponse.json({ error: translate('promotions.errors.evaluate_failed', 'Failed to evaluate promotions') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Evaluate active promotions against a cart context',
  methods: {
    POST: {
      summary: 'Evaluate promotions for a cart',
      description:
        'Resolves which active promotions apply to the given cart line items and returns their resolved effects. No catalog visibility filtering — operates on an already-resolved cart, not a product listing.',
      requestBody: { contentType: 'application/json', schema: evaluateInputSchema },
      responses: [{ status: 200, description: 'Applied promotions and their resolved effects' }],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
