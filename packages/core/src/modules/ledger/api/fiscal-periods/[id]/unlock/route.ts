/**
 * `POST /api/ledger/fiscal-periods/[id]/unlock` (OM-11).
 *
 * Mirror of `../lock/route.ts` — see that file's header comment for the
 * mutation-guard-registry rationale. Same feature gate
 * (`ledger.periods.manage`): this module has no separate unlock grant,
 * unlike staff timesheets' deliberately split lock/unlock features (see
 * spec's Design decisions — no equivalent four-eyes requirement here).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { FiscalPeriodDto } from '../../../commands/fiscalPeriods'

const logger = createLogger('ledger').child({ component: 'api/fiscal-periods/unlock' })

const UNLOCK_FEATURE = 'ledger.periods.manage'
const RESOURCE_KIND = 'ledger.fiscal_period'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [UNLOCK_FEATURE] },
}

interface RouteContext {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

export async function POST(req: Request, context: RouteContext) {
  const { translate } = await resolveTranslations()
  try {
    const params = await context.params
    const idResult = idSchema.safeParse(params.id)
    if (!idResult.success) {
      return NextResponse.json({ error: translate('ledger.errors.invalidId', 'Invalid fiscal period id') }, { status: 400 })
    }
    const fiscalPeriodId = idResult.data

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.sub || !auth.tenantId) {
      return NextResponse.json({ error: translate('ledger.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      return NextResponse.json(
        { error: translate('ledger.errors.organizationRequired', 'Organization context is required') },
        { status: 400 },
      )
    }
    const tenantId = auth.tenantId

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: auth.sub, tenantId, organizationId },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: fiscalPeriodId,
        operation: 'update',
        mutationPayload: { id: fiscalPeriodId },
      },
    })
    if (!guardResult.ok) return guardResult.response

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<{ id: string; organizationId: string; tenantId: string }, FiscalPeriodDto>(
      'ledger.unlockFiscalPeriod',
      { input: { id: fiscalPeriodId, organizationId, tenantId }, ctx },
    )

    await guardResult.runAfterSuccess()

    return NextResponse.json(result)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('ledger.fiscal_periods.unlock failed', { err })
    return NextResponse.json({ error: translate('ledger.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const unlockResponseSchema = z.object({
  id: z.uuid(),
  isLocked: z.literal(false),
  updatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Ledger',
  summary: 'Unlock a fiscal period',
  methods: {
    POST: {
      summary: 'Unlock a fiscal period',
      description: 'Sets isLocked to false, re-opening the period for posting. Requires ledger.periods.manage.',
      responses: [{ status: 200, description: 'Fiscal period unlocked', schema: unlockResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid id or missing organization context' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing ledger.periods.manage' },
        { status: 404, description: 'Fiscal period not found or not accessible' },
        { status: 409, description: 'Optimistic-lock conflict (stale updatedAt) or a concurrent delete' },
      ],
    },
  },
}
