/**
 * `POST /api/ledger/fiscal-periods/generate`.
 *
 * "Generate 12 months" (PR #5663 review, point 3): creates twelve consecutive
 * calendar-month periods starting on the first day of the month in the body's
 * `startDate`. A custom write route rather than a `makeCrudRoute` action,
 * because one request creates several rows. All or nothing — an overlap with
 * an existing period answers 409 and creates nothing. Requires
 * `ledger.periods.manage`, like `createFiscalPeriod`.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { badRequest, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { generateFiscalPeriodsSchema } from '../../../data/validators'

const logger = createLogger('ledger').child({ component: 'api/fiscal-periods/generate' })

const GENERATE_FEATURE = 'ledger.periods.manage'
const RESOURCE_KIND = 'ledger.fiscal_period'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [GENERATE_FEATURE] },
}

const bodySchema = z.object({ startDate: z.string().min(1) })

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.sub || !auth.tenantId) {
      return NextResponse.json({ error: translate('ledger.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const body = bodySchema.safeParse(await req.json().catch(() => null))
    if (!body.success) {
      throw badRequest(translate('ledger.errors.fiscalPeriodStartRequired', 'A start date is required.'))
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

    const startDateNotFirstOfMonth = () =>
      NextResponse.json(
        { error: translate('ledger.errors.fiscalPeriodStartNotFirstOfMonth', 'startDate must be the first day of a month.') },
        { status: 400 },
      )
    const requested = generateFiscalPeriodsSchema.safeParse({ organizationId, tenantId, startDate: body.data.startDate })
    if (!requested.success) return startDateNotFirstOfMonth()

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: auth.sub, tenantId, organizationId },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: `${organizationId}:${body.data.startDate}`,
        operation: 'create',
        mutationPayload: { startDate: body.data.startDate },
      },
    })
    if (!guardResult.ok) return guardResult.response

    // A guard may rewrite the payload. Only `startDate` can be rewritten: the
    // organization and tenant always come from the server-side scope, and the
    // rewritten value goes through the same validation as the original.
    let startDate = body.data.startDate
    if (guardResult.modifiedPayload && 'startDate' in guardResult.modifiedPayload) {
      const modified = guardResult.modifiedPayload.startDate
      if (typeof modified !== 'string') return startDateNotFirstOfMonth()
      const revalidated = generateFiscalPeriodsSchema.safeParse({ organizationId, tenantId, startDate: modified })
      if (!revalidated.success) return startDateNotFirstOfMonth()
      startDate = modified
    }
    const input = { organizationId, tenantId, startDate }

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof input, { fiscalPeriodIds: string[] }>(
      'ledger.generateFiscalPeriods',
      { input, ctx },
    )

    await guardResult.runAfterSuccess()

    return NextResponse.json({ ids: result.fiscalPeriodIds }, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('ledger.fiscal_periods.generate failed', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'ledger',
      attributes: { route: 'fiscal-periods.generate', errorName: err instanceof Error ? err.name : undefined },
    })
    return NextResponse.json({ error: translate('ledger.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const generateBodySchema = z.object({ startDate: z.string() })
const generateResponseSchema = z.object({ ids: z.array(z.uuid()) })

export const openApi: OpenApiRouteDoc = {
  tag: 'Ledger',
  summary: 'Generate 12 fiscal periods',
  methods: {
    POST: {
      summary: 'Generate 12 fiscal periods',
      description:
        'Creates twelve consecutive calendar-month fiscal periods, unlocked, starting on the first day of the month in startDate. All or nothing: the span must not overlap an existing period. Requires ledger.periods.manage.',
      requestBody: { contentType: 'application/json', schema: generateBodySchema },
      responses: [{ status: 201, description: 'Twelve fiscal periods created', schema: generateResponseSchema }],
      errors: [
        { status: 400, description: 'Missing start date, start date is not the first of a month, or no organization context' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing ledger.periods.manage' },
        { status: 409, description: 'The span overlaps an existing fiscal period' },
      ],
    },
  },
}
