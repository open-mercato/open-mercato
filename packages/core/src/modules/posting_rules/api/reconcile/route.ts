import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { reconcileCostRingSchema, type ReconcileCostRingInput } from '../../data/validators'
import type { ReconcileCostRingResult } from '../../commands/reconcileCostRing'

// `/api/posting_rules/reconcile` — triggers `reconcileCostRing` on demand
// (see the spec's API Contracts: "for an operator who doesn't want to wait
// for the next scheduled run"). Returns the count of lines reconciled and
// the lines that could not be, each with its named error.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['posting_rules.reconcile.run'] },
}

const postBodySchema = z.object({
  periodId: z.uuid().nullable().optional(),
})

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('posting_rules.errors.unauthorized', 'Unauthorized') })
    }
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('posting_rules.errors.organizationRequired', 'Organization context is required.') })
    }
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const body = postBodySchema.parse(await readJsonSafe(req, {}))
    const commandInput: ReconcileCostRingInput = reconcileCostRingSchema.parse({
      organizationId,
      tenantId: auth.tenantId,
      periodId: body.periodId ?? null,
    })

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    // `commandBus.execute` resolves `CommandExecuteResult<TResult>`
    // (`{ result, logEntry }`) — unwrap `.result` before returning it as
    // this route's own `result` field.
    const executed = await commandBus.execute<ReconcileCostRingInput, ReconcileCostRingResult>(
      'posting_rules.reconcileCostRing',
      { input: commandInput, ctx },
    )
    return NextResponse.json({ ok: true, result: executed.result })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('posting_rules.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    return NextResponse.json({ error: translate('posting_rules.errors.reconcileFailed', 'Failed to run the posting rules reconciliation sweep.') }, { status: 500 })
  }
}

const reconcileResultSchema = z.object({
  entriesInspected: z.number(),
  linesReclassified: z.number(),
  failures: z.array(z.object({ entryId: z.string(), lineId: z.string(), error: z.string() })),
})
const reconcileResponseSchema = z.object({ ok: z.boolean(), result: reconcileResultSchema })
const reconcileErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Posting Rules Engine',
  summary: 'Run the cost-reclassification reconciliation sweeper on demand',
  methods: {
    POST: {
      summary: 'Run reconcileCostRing',
      requestBody: { contentType: 'application/json', schema: postBodySchema },
      responses: [
        { status: 200, description: 'Reconciliation completed', schema: reconcileResponseSchema },
        { status: 400, description: 'Invalid payload', schema: reconcileErrorSchema },
        { status: 401, description: 'Unauthorized', schema: reconcileErrorSchema },
        { status: 422, description: 'PostingRulesSettings.clearingAccountId is not configured', schema: reconcileErrorSchema },
      ],
    },
  },
}
