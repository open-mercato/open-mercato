import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const querySchema = z.object({
  entityId: z.string().uuid(),
  status: z.enum(['done', 'planned']).optional(),
})

const responseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    call: z.number(),
    email: z.number(),
    meeting: z.number(),
    note: z.number(),
    total: z.number(),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.interactions.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'Get interaction counts by type',
      description: 'Returns per-type interaction counts scoped to an entity.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Counts by interaction type',
          schema: responseSchema,
        },
      ],
    },
  },
}

export async function GET(req: Request) {
  try {
    const queryUrl = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(queryUrl.searchParams))
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, {
        error: translate('customers.errors.unauthorized', 'Unauthorized'),
      })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationIds = Array.isArray(scope?.filterIds) && scope.filterIds.length > 0
      ? scope.filterIds
      : auth.orgId
        ? [auth.orgId]
        : []
    const em = (container.resolve('em') as EntityManager).fork()
    const knex = em.getKnex()

    const baseQuery = knex('customer_interactions')
      .where('entity_id', query.entityId)
      .where('tenant_id', auth.tenantId)
      .whereNull('deleted_at')

    if (organizationIds.length === 1) {
      baseQuery.where('organization_id', organizationIds[0])
    } else if (organizationIds.length > 1) {
      baseQuery.whereIn('organization_id', organizationIds)
    }

    if (query.status) {
      baseQuery.where('status', query.status)
    }

    const rows = await baseQuery
      .select('interaction_type')
      .count('* as count')
      .groupBy('interaction_type') as Array<{ interaction_type: string; count: string | number }>

    const counts: Record<string, number> = { call: 0, email: 0, meeting: 0, note: 0 }
    let total = 0
    for (const row of rows) {
      const count = typeof row.count === 'string' ? parseInt(row.count, 10) : row.count
      const type = row.interaction_type
      if (type in counts) {
        counts[type] = count
      }
      total += count
    }

    return NextResponse.json({ ok: true, result: { ...counts, total } })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
