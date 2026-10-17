import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  simulationCancelResponseSchema,
  simulationErrorSchema,
  simulationRunPathParamsSchema,
  type SimulationCancelCommandInput,
} from '../../../../data/validators'
import { SIMULATION_CANCEL_COMMAND_ID, type SimulationCancelResult } from '../../../../commands/simulations'
import {
  SIMULATION_PROGRESS_MANAGE_FEATURE,
  SIMULATION_RUN_FEATURE,
  SIMULATION_RUN_RESOURCE_KIND,
} from '../../../../lib/simulation/constants'
import { createFeatureCheck } from '../../../../lib/simulation/context'
import {
  readSimulationRouteParam,
  resolveSimulationRouteContext,
  runAfterSuccessSafely,
  simulationJson,
  simulationRouteFailure,
  simulationRunNotFound,
  type SimulationRouteParams,
} from '../../../../lib/simulation/routes'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [SIMULATION_RUN_FEATURE] },
}

/** Cancels a queued or running run: the requester only, or a holder of `progress.manage` (S13). */
export async function POST(req: Request, routeContext: SimulationRouteParams) {
  let translate: TranslateFn | null = null
  try {
    const context = await resolveSimulationRouteContext(req)
    if (context instanceof NextResponse) return context
    translate = context.translate
    const params = simulationRunPathParamsSchema.safeParse({ id: await readSimulationRouteParam(routeContext, 'id') })
    if (!params.success) return simulationRunNotFound(context.translate)
    const runId = params.data.id.toLowerCase()
    const hasFeatures = createFeatureCheck(context.container, context.userId, context.scope)
    const allowForeign = await hasFeatures([SIMULATION_PROGRESS_MANAGE_FEATURE])
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.userId, tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      input: { resourceKind: SIMULATION_RUN_RESOURCE_KIND, resourceId: runId, operation: 'custom', mutationPayload: { action: 'cancel' } },
    })
    if (!guarded.ok) return guarded.response
    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<SimulationCancelCommandInput, SimulationCancelResult>(SIMULATION_CANCEL_COMMAND_ID, {
      input: {
        tenantId: context.scope.tenantId,
        organizationId: context.scope.organizationId,
        runId,
        userId: context.userId,
        allowForeign,
      },
      ctx: context.commandContext,
    })
    const response = simulationJson({ ok: true, runId: result.runId, status: result.status })
    await runAfterSuccessSafely(guarded, 'simulations.cancel')
    return response
  } catch (error) {
    const rejection = getCommandInterceptorHttpRejection(error)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return simulationRouteFailure(error, 'simulations.cancel', translate)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Cancel a change simulation',
  pathParams: simulationRunPathParamsSchema,
  methods: {
    POST: {
      summary: 'Cancel a queued or running simulation',
      description: 'Allowed for the requester only (or a holder of `progress.manage` in the organization); any other caller gets the same 404 as for an unknown run. The run and its ProgressJob become `cancelled`. Runs the registered mutation guards (`insights.simulation_run`).',
      responses: [{ status: 200, description: 'Cancelled', schema: simulationCancelResponseSchema }],
      errors: [
        { status: 400, description: 'No organization selected (`organization_scope_required`)', schema: simulationErrorSchema },
        { status: 401, description: 'Authentication required', schema: simulationErrorSchema },
        { status: 403, description: 'Missing `insights.simulator.run`', schema: simulationErrorSchema },
        { status: 404, description: 'Run not found (identical body for every reason)', schema: simulationErrorSchema },
        { status: 409, description: 'The run already finished (`run_not_active`)', schema: simulationErrorSchema },
        { status: 422, description: 'Blocked by a mutation guard', schema: simulationErrorSchema },
      ],
    },
  },
}
