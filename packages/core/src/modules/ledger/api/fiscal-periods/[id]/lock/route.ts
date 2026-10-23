/**
 * `POST /api/ledger/fiscal-periods/[id]/lock`.
 *
 * Toggling `FiscalPeriod.isLocked` is not a field-level CRUD edit, so this
 * is a custom write route rather than a `makeCrudRoute` `update` action —
 * wired through the shared mutation-guard registry, mapped to the
 * `update` operation, per `packages/core/AGENTS.md` → API Routes (see
 * `route-mutation-guard.ts`'s own doc comment). Requires
 * `ledger.periods.manage` — the same feature `create`/list-adjacent write
 * on `FiscalPeriod` requires, since there is no separate "lock" grant in
 * this module's `acl.ts` (unlike staff timesheets' close/unlock split).
 *
 * The command (`ledger.lockFiscalPeriod`) itself enforces the optimistic
 * lock against `x-om-ext-optimistic-lock-expected-updated-at`, so this
 * route's only job is auth, scope, the mutation guard and turning the
 * command's refusals into a response body.
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
import type { FiscalPeriodDto } from '../../../../commands/fiscalPeriods'

const logger = createLogger('ledger').child({ component: 'api/fiscal-periods/lock' })

const LOCK_FEATURE = 'ledger.periods.manage'
const RESOURCE_KIND = 'ledger.fiscal_period'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [LOCK_FEATURE] },
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
      'ledger.lockFiscalPeriod',
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
    logger.error('ledger.fiscal_periods.lock failed', { err })
    return NextResponse.json({ error: translate('ledger.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const lockResponseSchema = z.object({
  id: z.uuid(),
  isLocked: z.literal(true),
  updatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Ledger',
  summary: 'Lock a fiscal period',
  methods: {
    POST: {
      summary: 'Lock a fiscal period',
      description:
        'Sets isLocked to true. Once locked, postJournalEntry refuses any entry whose operationDate falls inside this period. Requires ledger.periods.manage.',
      responses: [{ status: 200, description: 'Fiscal period locked', schema: lockResponseSchema }],
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
