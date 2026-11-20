import { NextResponse } from 'next/server'
import { z } from 'zod'
import { asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
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
import { codeReserveInputSchema } from '../../../data/validators'
import { resolveCodeByString } from '../../../lib/code-service'
import type { PromotionsService, ReserveCodeInput } from '../../../lib/types'

const logger = createLogger('promotions')

// SPEC-055 §Cart-Facing Endpoints `POST /api/promotions/codes/release` (Release 4
// PLAN.md Step 6.7). Request body is `{ codeString, cartId, customerId }` — the IDENTICAL
// shape `codes/reserve` validates (`customerId` rides along unused by this route's own
// logic, but is part of the documented wire contract) — reuses `codeReserveInputSchema`
// rather than inventing a near-duplicate schema. `PromotionsService.releaseCode(codeId,
// cartId)` itself takes a resolved `codeId`, not a `codeString` (`lib/types.ts`), so this
// route resolves the string first via `lib/code-service.ts`'s own exported
// `resolveCodeByString` — the SAME function `reserveCode`/`useCode` already use — rather
// than re-deriving "what counts as a code" a fourth time.
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

    let input: ReserveCodeInput
    try {
      input = codeReserveInputSchema.parse(body) as ReserveCodeInput
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid codes/release payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const em = container.resolve<EntityManager>('em').fork()
    const resolved = await resolveCodeByString(em, input.codeString, { tenantId, organizationId })
    // An unknown code string has no `CodeReservation` row that could possibly exist for
    // it (a reservation is always created against a resolved `Code.id`) — releasing it is
    // an idempotent no-op, same as `PromotionCodeService.releaseCode`'s own
    // `nativeDelete` being a no-op against a non-matching row. No mutation happens, so no
    // guard needs to run.
    if (!resolved) return NextResponse.json({ ok: true })

    // State-changing action endpoint, mapped to `delete` — this route's own mutation is
    // removing the `(code_id, cart_id)` `CodeReservation` row.
    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId, tenantId, organizationId },
      input: { resourceKind: 'promotions.code', resourceId: resolved.code.id, operation: 'delete', mutationPayload: input as unknown as Record<string, unknown> },
    })
    if (!guarded.ok) return guarded.response

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    await promotionsService.releaseCode(resolved.code.id, input.cartId)

    await guarded.runAfterSuccess()

    return NextResponse.json({ ok: true })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.codes.release failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.code_release_failed', 'Failed to release the promotion code') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Release a cart\'s reservation on a promotion code',
  methods: {
    POST: {
      summary: 'Release a promotion code reservation',
      description:
        'Deletes the CodeReservation for the (code, cartId) pair only, never another cart\'s. An unknown code string is a no-op (nothing to release).',
      requestBody: { contentType: 'application/json', schema: codeReserveInputSchema },
      responses: [{ status: 200, description: 'Reservation released (or nothing to release)' }],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
