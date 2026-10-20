import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  simulationDecisionResponseSchema,
  simulationDecisionSchema,
  simulationErrorSchema,
  simulationRunPathParamsSchema,
  type SimulationDecisionCommandInput,
} from '../../../../data/validators'
import { SIMULATION_DECISION_COMMAND_ID, type SimulationDecisionResult } from '../../../../commands/simulations'
import { SIMULATION_DECISION_RESOURCE_KIND, SIMULATION_RUN_FEATURE } from '../../../../lib/simulation/constants'
import { createFeatureCheck } from '../../../../lib/simulation/context'
import { storedRunFeatures } from '../../../../lib/simulation/features'
import { getSimulationKind } from '../../../../lib/simulation/registry'
import {
  readSimulationRouteParam,
  resolveSimulationRouteContext,
  runAfterSuccessSafely,
  simulationError,
  simulationJson,
  simulationRouteFailure,
  simulationRunNotFound,
  type SimulationRouteParams,
} from '../../../../lib/simulation/routes'
import { findSimulationRun } from '../../../../lib/simulation/store'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [SIMULATION_RUN_FEATURE] },
}

/**
 * Records `applied` or `discarded` for the caller's completed run (S15/S16). The body carries the
 * decision only; for `applied` the server verifies the live artifact against the simulated
 * proposal. A mutation guard may transform the decision: the guarded payload is validated like a
 * body, and since it is strict, the run stays the one this route resolved and authorized.
 */
export async function POST(req: Request, routeContext: SimulationRouteParams) {
  let translate: TranslateFn | null = null
  try {
    const context = await resolveSimulationRouteContext(req)
    if (context instanceof NextResponse) return context
    translate = context.translate
    const params = simulationRunPathParamsSchema.safeParse({ id: await readSimulationRouteParam(routeContext, 'id') })
    if (!params.success) return simulationRunNotFound(context.translate)
    const runId = params.data.id.toLowerCase()
    const body = await readJsonSafe<unknown>(req, null)
    const parsed = simulationDecisionSchema.safeParse(body && typeof body === 'object' && !Array.isArray(body) ? body : {})
    if (!parsed.success) return simulationError(context.translate, 'invalid_request', 400)
    const em = (context.container.resolve('em') as EntityManager).fork()
    const run = await findSimulationRun(em, { scope: context.scope, runId, requesterUserId: context.userId })
    const kind = run ? getSimulationKind(run.kind) : null
    if (!run || !kind) return simulationRunNotFound(context.translate)
    const hasFeatures = createFeatureCheck(context.container, context.userId, context.scope)
    if (!(await hasFeatures(storedRunFeatures(kind.definition, run.inputJson)))) return simulationRunNotFound(context.translate)
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.userId, tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      input: { resourceKind: SIMULATION_DECISION_RESOURCE_KIND, resourceId: run.id, operation: 'create', mutationPayload: { ...parsed.data } },
    })
    if (!guarded.ok) return guarded.response
    const decision = guarded.modifiedPayload
      ? simulationDecisionSchema.safeParse({ ...parsed.data, ...guarded.modifiedPayload })
      : parsed
    if (!decision.success) return simulationError(context.translate, 'invalid_request', 400)
    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<SimulationDecisionCommandInput, SimulationDecisionResult>(SIMULATION_DECISION_COMMAND_ID, {
      input: {
        tenantId: context.scope.tenantId,
        organizationId: context.scope.organizationId,
        runId: run.id,
        userId: context.userId,
        decision: decision.data.decision,
      },
      ctx: context.commandContext,
    })
    const response = simulationJson({ ok: true, decision: result.decision }, 201)
    await runAfterSuccessSafely(guarded, 'simulations.decision')
    return response
  } catch (error) {
    const rejection = getCommandInterceptorHttpRejection(error)
    if (rejection) return NextResponse.json(rejection.body, { status: rejection.status })
    return simulationRouteFailure(error, 'simulations.decision', translate)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Simulation decision',
  pathParams: simulationRunPathParamsSchema,
  methods: {
    POST: {
      summary: 'Record a decision on one of my completed simulations',
      description: 'Body `{ decision: "applied" | "discarded" }` only. Apply happens in the owning module\'s own API (with its optimistic lock); afterwards `applied` is verified on the server: `verified` is true only when the live artifact was written after the simulated version and its definition fingerprint equals the simulated proposal (else the UI shows "applied — differs from the simulation"). Append-only: one decision of each kind per run (409 `decision_exists`). Runs the registered mutation guards (`insights.simulation_decision`).',
      requestBody: { contentType: 'application/json', schema: simulationDecisionSchema },
      responses: [{ status: 201, description: 'Decision recorded', schema: simulationDecisionResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid body or no organization selected (`organization_scope_required`)', schema: simulationErrorSchema },
        { status: 401, description: 'Authentication required', schema: simulationErrorSchema },
        { status: 403, description: 'Missing `insights.simulator.run`', schema: simulationErrorSchema },
        { status: 404, description: 'Run not found (identical body for every reason)', schema: simulationErrorSchema },
        { status: 409, description: 'The run is not completed (`run_not_completed`) or the decision exists (`decision_exists`)', schema: simulationErrorSchema },
        { status: 422, description: 'Blocked by a mutation guard', schema: simulationErrorSchema },
      ],
    },
  },
}
