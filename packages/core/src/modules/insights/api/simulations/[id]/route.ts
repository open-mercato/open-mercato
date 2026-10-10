import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { simulationErrorSchema, simulationRunPathParamsSchema, simulationRunResponseSchema } from '../../../data/validators'
import { SIMULATION_VIEW_FEATURE } from '../../../lib/simulation/constants'
import { createFeatureCheck } from '../../../lib/simulation/context'
import { storedRunFeatures } from '../../../lib/simulation/features'
import { getSimulationKind } from '../../../lib/simulation/registry'
import {
  readSimulationRouteParam,
  resolveSimulationRouteContext,
  simulationJson,
  simulationRouteFailure,
  simulationRunNotFound,
  type SimulationRouteParams,
} from '../../../lib/simulation/routes'
import { findSimulationDecisions, findSimulationRun } from '../../../lib/simulation/store'
import { buildSimulationRunDetail } from '../../../lib/simulation/views'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [SIMULATION_VIEW_FEATURE] },
}

/**
 * The caller's own run (S10): the same 404 for an unknown, foreign, other-organization or expired
 * run, and for a run whose kind features the caller no longer holds. Sample ids are re-checked
 * live (S14).
 */
export async function GET(req: Request, routeContext: SimulationRouteParams) {
  let translate: TranslateFn | null = null
  try {
    const context = await resolveSimulationRouteContext(req)
    if (context instanceof NextResponse) return context
    translate = context.translate
    const params = simulationRunPathParamsSchema.safeParse({ id: await readSimulationRouteParam(routeContext, 'id') })
    if (!params.success) return simulationRunNotFound(context.translate)
    const em = (context.container.resolve('em') as EntityManager).fork()
    const run = await findSimulationRun(em, { scope: context.scope, runId: params.data.id.toLowerCase(), requesterUserId: context.userId })
    const kind = run ? getSimulationKind(run.kind) : null
    if (!run || !kind) return simulationRunNotFound(context.translate)
    const hasFeatures = createFeatureCheck(context.container, context.userId, context.scope)
    if (!(await hasFeatures(storedRunFeatures(kind.definition, run.inputJson)))) return simulationRunNotFound(context.translate)
    const decisions = await findSimulationDecisions(em, context.scope, run.id)
    const result = await buildSimulationRunDetail({ container: context.container, em, run, kind, viewerUserId: context.userId, hasFeatures, decisions })
    return simulationJson({ ok: true, result })
  } catch (error) {
    return simulationRouteFailure(error, 'simulations.detail', translate)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Change simulation run',
  pathParams: simulationRunPathParamsSchema,
  methods: {
    GET: {
      summary: 'Read one of my simulation runs',
      description: 'Status, k-suppressed result (aggregates only; counts below k are `null` with `suppressed`), coverage, caveats (i18n keys), decisions and sample record ids that the caller can still read. Unknown, foreign, other-organization and expired runs, and runs whose kind features the caller lost, answer the same 404 (`run_not_found`).',
      responses: [{ status: 200, description: 'Run', schema: simulationRunResponseSchema }],
      errors: [
        { status: 400, description: 'No organization selected (`organization_scope_required`)', schema: simulationErrorSchema },
        { status: 401, description: 'Authentication required', schema: simulationErrorSchema },
        { status: 403, description: 'Missing `insights.simulator.view`', schema: simulationErrorSchema },
        { status: 404, description: 'Run not found (identical body for every reason)', schema: simulationErrorSchema },
      ],
    },
  },
}
