import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { simulationCapabilitiesResponseSchema, simulationErrorSchema } from '../../../data/validators'
import { SIMULATION_LIMITS, SIMULATION_RUN_FEATURE, SIMULATION_VIEW_FEATURE } from '../../../lib/simulation/constants'
import { createFeatureCheck } from '../../../lib/simulation/context'
import { listSimulationKinds } from '../../../lib/simulation/registry'
import { resolveSimulationRouteContext, simulationJson, simulationRouteFailure } from '../../../lib/simulation/routes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [SIMULATION_VIEW_FEATURE] },
}

/** Kinds the caller may run in the selected organization (each kind's features, wildcard-aware). */
export async function GET(req: Request) {
  let translate: TranslateFn | null = null
  try {
    const context = await resolveSimulationRouteContext(req)
    if (context instanceof NextResponse) return context
    translate = context.translate
    const hasFeatures = createFeatureCheck(context.container, context.userId, context.scope)
    const canRun = await hasFeatures([SIMULATION_RUN_FEATURE])
    const kinds = []
    if (canRun) {
      for (const registered of listSimulationKinds()) {
        const definition = registered.definition
        if (!(await hasFeatures(definition.requiredFeatures))) continue
        kinds.push({ kind: definition.kind, artifactKind: definition.artifactKind, labelKey: definition.labelKey, cellKeys: [...definition.cellKeys] })
      }
    }
    return simulationJson({
      canRun,
      kinds,
      limits: {
        defaultWindowDays: SIMULATION_LIMITS.defaultWindowDays,
        maxWindowDays: SIMULATION_LIMITS.maxWindowDays,
        maxRecords: SIMULATION_LIMITS.maxRecords,
        maxDurationMs: SIMULATION_LIMITS.maxDurationMs,
      },
    })
  } catch (error) {
    return simulationRouteFailure(error, 'simulations.capabilities', translate)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Change simulator capabilities',
  methods: {
    GET: {
      summary: 'List the simulation kinds the caller may run',
      description: 'Kinds whose `requiredFeatures` the caller holds in the selected organization (wildcard-aware), and whether the caller holds `insights.simulator.run`, plus the run limits.',
      responses: [{ status: 200, description: 'Capabilities', schema: simulationCapabilitiesResponseSchema }],
      errors: [
        { status: 400, description: 'No organization selected (`organization_scope_required`)', schema: simulationErrorSchema },
        { status: 401, description: 'Authentication required', schema: simulationErrorSchema },
        { status: 403, description: 'Missing `insights.simulator.view`', schema: simulationErrorSchema },
      ],
    },
  },
}
