import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CustomerInteraction } from '../../../data/entities'

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  duration: z.coerce.number().int().min(1).max(1440),
  excludeId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  timezoneOffsetMinutes: z.coerce.number().int().min(-900).max(900).optional(),
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
  const { translate } = await resolveTranslations()
  try {
    const queryUrl = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(queryUrl.searchParams))
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)

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

    const offsetMinutes = query.timezoneOffsetMinutes ?? 0
    const offsetSign = offsetMinutes >= 0 ? '+' : '-'
    const absMinutes = Math.abs(offsetMinutes)
    const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, '0')
    const offsetMins = String(absMinutes % 60).padStart(2, '0')
    const offsetSuffix = `${offsetSign}${offsetHours}:${offsetMins}`
    const windowStart = new Date(`${query.date}T${query.startTime}:00${offsetSuffix}`)
    const windowEnd = new Date(windowStart.getTime() + query.duration * 60_000)

    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
      throw new CrudHttpError(400, { error: translate('customers.errors.invalid_date_time', 'Invalid date/time') })
    }

    const checkUserId = query.userId ?? auth.userId
    const em = (container.resolve('em') as EntityManager).fork()
    const kysely = em.getKysely<any>()

    let baseQuery = (kysely as any)
      .selectFrom('customer_interactions')
      .select(['id', 'scheduled_at', 'duration_minutes', 'interaction_type'])
      .where('tenant_id', '=', auth.tenantId)
      .where('status', '=', 'planned')
      .where('scheduled_at', 'is not', null)
      .where('deleted_at', 'is', null)

    if (organizationIds.length === 1) {
      baseQuery = baseQuery.where('organization_id', '=', organizationIds[0])
    } else if (organizationIds.length > 1) {
      baseQuery = baseQuery.where('organization_id', 'in', organizationIds)
    }

    if (checkUserId) {
      baseQuery = baseQuery.where((eb: any) =>
        eb.or([
          eb('author_user_id', '=', checkUserId),
          eb('owner_user_id', '=', checkUserId),
        ])
      )
    }

    if (query.excludeId) {
      baseQuery = baseQuery.where('id', '!=', query.excludeId)
    }

    // Overlap condition: existing.start < windowEnd AND existing.end > windowStart
    // end = scheduled_at + duration_minutes (default 30 if null)
    baseQuery = baseQuery.where((eb: any) =>
      eb.and([
        eb('scheduled_at', '<', windowEnd.toISOString()),
        eb(sql`(scheduled_at + make_interval(mins => COALESCE(duration_minutes, 30)))`, '>', windowStart.toISOString()),
      ])
    )

    // Raw SELECT: reads only unencrypted columns (id, scheduled_at, duration_minutes, interaction_type); title is excluded to avoid ciphertext leakage and is resolved below via findWithDecryption.
    const rows = await baseQuery
      .orderBy('scheduled_at', 'asc')
      .limit(10)
      .execute() as Array<{
        id: string
        scheduled_at: string | Date
        duration_minutes: number | null
        interaction_type: string
      }>

    const decryptionScope = {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    }
    const conflictIds = rows.map((row) => row.id)
    const interactionFilter: Record<string, unknown> = {
      id: { $in: conflictIds },
      tenantId: auth.tenantId,
      deletedAt: null,
    }
    if (organizationIds.length === 1) {
      interactionFilter.organizationId = organizationIds[0]
    } else if (organizationIds.length > 1) {
      interactionFilter.organizationId = { $in: organizationIds }
    }
    const decryptedInteractions = conflictIds.length > 0
      ? await findWithDecryption(
          em,
          CustomerInteraction,
          interactionFilter as any,
          undefined,
          decryptionScope,
        )
      : []
    const titleById = new Map<string, string | null>()
    for (const record of decryptedInteractions) {
      titleById.set((record as any).id, ((record as any).title ?? null) as string | null)
    }

    const conflicts = rows.map((row) => {
      const start = new Date(row.scheduled_at)
      const durationMin = row.duration_minutes ?? 30
      const end = new Date(start.getTime() + durationMin * 60_000)
      return {
        id: row.id,
        title: titleById.has(row.id) ? titleById.get(row.id) ?? null : null,
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
    console.error('[customers/interactions/conflicts] GET failed', err)
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}
