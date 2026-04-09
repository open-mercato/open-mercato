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
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.coerce.number().int().min(1).max(1440),
  excludeId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
})

const conflictItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  type: z.string(),
})

const responseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    hasConflicts: z.boolean(),
    conflicts: z.array(conflictItemSchema),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.interactions.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'Detect scheduling conflicts',
      description: 'Checks for overlapping planned interactions within the requested time window.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Conflict detection result',
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

    const windowStart = new Date(`${query.date}T${query.startTime}:00`)
    const windowEnd = new Date(windowStart.getTime() + query.duration * 60_000)

    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
      throw new CrudHttpError(400, { error: 'Invalid date/time' })
    }

    const checkUserId = query.userId ?? auth.userId
    const em = (container.resolve('em') as EntityManager).fork()
    const knex = em.getKnex()

    const baseQuery = knex('customer_interactions')
      .where('tenant_id', auth.tenantId)
      .where('status', 'planned')
      .whereNotNull('scheduled_at')
      .whereNull('deleted_at')

    if (organizationIds.length === 1) {
      baseQuery.where('organization_id', organizationIds[0])
    } else if (organizationIds.length > 1) {
      baseQuery.whereIn('organization_id', organizationIds)
    }

    if (checkUserId) {
      baseQuery.where(function () {
        this.where('author_user_id', checkUserId).orWhere('owner_user_id', checkUserId)
      })
    }

    if (query.excludeId) {
      baseQuery.whereNot('id', query.excludeId)
    }

    // Overlap condition: existing.start < windowEnd AND existing.end > windowStart
    // end = scheduled_at + duration_minutes (default 30 if null)
    baseQuery.where(function () {
      this.where('scheduled_at', '<', windowEnd.toISOString())
        .andWhere(
          knex.raw(
            '(scheduled_at + make_interval(mins => COALESCE(duration_minutes, 30))) > ?',
            [windowStart.toISOString()],
          ),
        )
    })

    const rows = await baseQuery
      .select('id', 'title', 'scheduled_at', 'duration_minutes', 'interaction_type')
      .orderBy('scheduled_at', 'asc')
      .limit(10) as Array<{
        id: string
        title: string | null
        scheduled_at: string | Date
        duration_minutes: number | null
        interaction_type: string
      }>

    const conflicts = rows.map((row) => {
      const start = new Date(row.scheduled_at)
      const durationMin = row.duration_minutes ?? 30
      const end = new Date(start.getTime() + durationMin * 60_000)
      return {
        id: row.id,
        title: row.title,
        startTime: start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        endTime: end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        type: row.interaction_type,
      }
    })

    return NextResponse.json({
      ok: true,
      result: { hasConflicts: conflicts.length > 0, conflicts },
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
