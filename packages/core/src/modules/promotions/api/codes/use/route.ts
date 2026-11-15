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
import { codeUseInputSchema } from '../../../data/validators'
import type { PromotionsService, UseCodeInput } from '../../../lib/types'

const logger = createLogger('promotions')

// SPEC-055 §Cart-Facing Endpoints `POST /api/promotions/codes/use` (Release 4 PLAN.md
// Step 6.7) — thin HTTP adapter over `promotionsService.useCode()` (Step 6.2). The row
// lock (`SELECT ... FOR UPDATE`) and the re-read-under-lock eligibility check live in
// `lib/code-service.ts`; this route only translates the HTTP wire body and the eventual
// result/error, same split as `codes/reserve`/`codes/release` below.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['promotions.codes.redeem'] },
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

    let input: UseCodeInput
    try {
      input = codeUseInputSchema.parse(body) as UseCodeInput
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid codes/use payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    // State-changing action endpoint, mapped to `update` per `packages/core/AGENTS.md` →
    // "API Routes" — same operation `codes/[id]/generate/route.ts` uses for its own
    // `promotions.code` mutation. `resourceId` is the caller-supplied `codeId`, already
    // known from the body (unlike `codes/reserve`, which has none yet).
    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId, tenantId, organizationId },
      input: { resourceKind: 'promotions.code', resourceId: input.codeId, operation: 'update', mutationPayload: input as unknown as Record<string, unknown> },
    })
    if (!guarded.ok) return guarded.response

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    const result = await promotionsService.useCode(input)

    await guarded.runAfterSuccess()

    return NextResponse.json(result)
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.codes.use failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.code_use_failed', 'Failed to use the promotion code') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Redeem a reserved promotion code',
  methods: {
    POST: {
      summary: 'Use (redeem) a promotion code',
      description:
        'Locks the code row, re-reads eligibility under the lock, deactivates the dynamic code (or increments the static code use count), writes a CodeUsage row, and deletes the (code, cart) CodeReservation.',
      requestBody: { contentType: 'application/json', schema: codeUseInputSchema },
      responses: [{ status: 200, description: 'Code redeemed' }],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 422, description: 'Unknown, inactive, or exhausted code; or a per-customer-limited code with no identified customer' },
      ],
    },
  },
}
