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
import { codeValidateInputSchema } from '../../../data/validators'
import type { PromotionsService, ReserveCodeInput } from '../../../lib/types'

const logger = createLogger('promotions')

// SPEC-055 §Cart-Facing Endpoints `POST /api/promotions/codes/validate` (Release 4
// PLAN.md Step 6.7) — thin HTTP adapter over `promotionsService.validateCode()` (Step
// 6.2). A plain read, same as `api/evaluate/route.ts` — no mutation guard wiring (nothing
// is written). "Response: `{ valid: boolean, reason?: string }`" — ALWAYS 200: an
// ineligible code is a validation RESULT, not an HTTP error, so this route never 422s on
// `valid: false`, unlike `codes/reserve`/`codes/use`.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['promotions.codes.redeem'] },
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
  container.register({ auth: asValue({ ...auth, orgId: organizationId }) })
  return { container, translate }
}

export async function POST(req: Request) {
  try {
    const { container } = await resolveRouteContext(req)
    const body = await readJsonSafe(req, {})

    let input: ReserveCodeInput
    try {
      input = codeValidateInputSchema.parse(body) as ReserveCodeInput
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid codes/validate payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    const result = await promotionsService.validateCode(input)
    return NextResponse.json(result)
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.codes.validate failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.code_validate_failed', 'Failed to validate the promotion code') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Validate a promotion code against a cart, without reserving it',
  methods: {
    POST: {
      summary: 'Validate a promotion code',
      description:
        'Resolves a code string and checks eligibility (active, remaining global uses, per-customer limit) against the same reservation `codes/reserve` would extend. Always answers 200 with { valid, reason? } — never 422 on an ineligible code.',
      requestBody: { contentType: 'application/json', schema: codeValidateInputSchema },
      responses: [{ status: 200, description: 'Validation result' }],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
