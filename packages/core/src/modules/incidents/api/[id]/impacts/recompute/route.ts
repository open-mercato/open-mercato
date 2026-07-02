import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentImpact } from '../../../../data/entities'
import { recomputeIncidentRevenue } from '../../../../commands/impacts'
import {
  impactErrorResponseSchema,
  incidentImpactPathParamsSchema,
  runImpactGuardAfterSuccessCallbacks,
  runImpactGuards,
  scopedImpactPayload,
  resolveIncidentImpactRequestContext,
} from '../route'
import { emitIncidentSideEffects, resolveCommandScope } from '../../../../commands/incident'
import { assertIncidentMutable } from '../../../../commands/actions'

const recomputeResponseSchema = z.object({
  ok: z.boolean(),
  revenueAtRiskMinor: z.string().nullable(),
  revenueAtRiskCurrency: z.string().nullable(),
  refreshedAt: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = incidentImpactPathParamsSchema.parse(params)
    const { ctx } = await resolveIncidentImpactRequestContext(req)
    const { translate } = await resolveTranslations()
    const scoped = scopedImpactPayload({ id }, ctx, translate)
    const scope = resolveCommandScope(ctx, scoped)
    const guardInput = {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? '',
      resourceKind: 'incidents.incident',
      resourceId: id,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { ...scoped },
    }
    const guardResult = await runImpactGuards(ctx, guardInput)
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, { status: guardResult.errorStatus ?? 422 })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!incident) throw new CrudHttpError(404, { error: '[internal] incident not found' })

    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: 'incidents.incident',
      resourceId: incident.id,
      current: incident.updatedAt,
      request: ctx.request ?? null,
    })
    assertIncidentMutable(incident)

    const refreshedAt = new Date()
    await withAtomicFlush(em, [
      async () => {
        const impacts = await em.find(IncidentImpact, {
          incidentId: incident.id,
          ...scope,
          deletedAt: null,
        })
        for (const impact of impacts) {
          impact.revenueRefreshedAt = refreshedAt
          impact.updatedAt = refreshedAt
          em.persist(impact)
        }
        incident.updatedAt = refreshedAt
        em.persist(incident)
      },
      async () => {
        // TODO(packet-w4a): re-query live order/ARR totals from sales/customers when available
        await recomputeIncidentRevenue(em, scope, incident)
      },
    ], { transaction: true, label: 'incidents.impacts.recompute' })

    await emitIncidentSideEffects(ctx, 'updated', incident)

    if (guardResult.afterSuccessCallbacks.length) {
      await runImpactGuardAfterSuccessCallbacks(guardResult.afterSuccessCallbacks, {
        tenantId: ctx.auth?.tenantId ?? '',
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
        userId: ctx.auth?.sub ?? '',
        resourceKind: 'incidents.incident',
        resourceId: id,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    return NextResponse.json({
      ok: true,
      revenueAtRiskMinor: incident.revenueAtRiskMinor == null ? null : String(incident.revenueAtRiskMinor),
      revenueAtRiskCurrency: incident.revenueAtRiskCurrency ?? null,
      refreshedAt: refreshedAt.toISOString(),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('incidents.impacts recompute failed', err)
    return NextResponse.json(
      { error: translate('incidents.errors.impact_recompute_failed', 'Failed to recompute incident impact revenue.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Incidents',
  summary: 'Recompute incident impact revenue',
  pathParams: incidentImpactPathParamsSchema,
  methods: {
    POST: {
      summary: 'Recompute impact revenue rollup',
      description: 'Re-stamps active impact revenue snapshots, recomputes the parent incident revenue-at-risk rollup, and bumps the aggregate version.',
      responses: [
        { status: 200, description: 'Revenue rollup recomputed', schema: recomputeResponseSchema },
        { status: 400, description: 'Invalid request', schema: impactErrorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: impactErrorResponseSchema },
        { status: 403, description: 'Forbidden', schema: impactErrorResponseSchema },
        { status: 404, description: 'Incident not found', schema: impactErrorResponseSchema },
        { status: 409, description: 'Conflict detected', schema: impactErrorResponseSchema },
        { status: 423, description: 'Record locked', schema: impactErrorResponseSchema },
      ],
    },
  },
}
