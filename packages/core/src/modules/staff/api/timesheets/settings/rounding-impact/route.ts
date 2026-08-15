/**
 * `GET /api/staff/timesheets/settings/rounding-impact` — screen 16's 90-day preview (T7.2).
 *
 * Rounding is the one setting on that screen that moves money, and its effect is
 * invisible until an invoice goes out. This route answers "what would the last 90
 * days have billed under the rule I am about to save" before the Save button is
 * pressed, so changing it stops being a blind shot at client amounts.
 *
 * Three deliberate properties:
 *
 *  * **Locked entries are excluded.** An entry frozen into a closed report cannot
 *    be restated, so counting it in the projection would promise a change that the
 *    retro-rounding job would then refuse to make. They are counted separately and
 *    returned as `lockedEntryCount`, which is what lets the screen say "closed
 *    reports stay as they are" from data rather than as boilerplate.
 *  * **The projection is per entry** (D-7) — the database groups identical
 *    durations and `projectRoundingImpact` rounds each distinct duration once,
 *    through the same `roundMinutes` the write path uses.
 *  * **The candidate rule comes from the query string**, defaulting to what is
 *    stored, so the card recomputes as the toggles move without saving anything.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { readTimeTrackingSettings } from '../../../../lib/time-tracking/settings'
import type { RoundingDirection, RoundingSettings, RoundingUnitMinutes } from '../../../../lib/time-tracking/rounding'
import { projectRoundingImpact, type DurationBucket } from '../../../../lib/time-tracking/roundingImpact'

const logger = createLogger('staff').child({ component: 'api/timesheets/settings/rounding-impact' })

const MANAGE_FEATURE = 'staff.timesheets.settings.manage'

export const DEFAULT_IMPACT_WINDOW_DAYS = 90
const MAX_IMPACT_WINDOW_DAYS = 365

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
}

const querySchema = z.object({
  unitMinutes: z.coerce.number().optional(),
  direction: z.enum(['up', 'nearest']).optional(),
  windowDays: z.coerce.number().int().min(1).max(MAX_IMPACT_WINDOW_DAYS).optional(),
})

const impactSchema = z.object({
  entryCount: z.number().int(),
  rawMinutes: z.number().int(),
  roundedMinutes: z.number().int(),
  deltaMinutes: z.number().int(),
})

const responseSchema = z.object({
  windowDays: z.number().int(),
  from: z.string(),
  to: z.string(),
  rounding: z.object({
    unitMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15)]),
    direction: z.enum(['up', 'nearest']),
  }),
  /** The projection under the requested (or stored) rule, locked entries excluded. */
  projected: impactSchema,
  /** The same window under the rule currently stored, so the screen can show the move. */
  current: impactSchema,
  /** Entries in the window that a rounding change can never restate. */
  lockedEntryCount: z.number().int(),
})

const ROUNDING_UNITS: readonly number[] = [0, 5, 10, 15]

type BucketRow = {
  duration_minutes: string | number | null
  entry_count: string | number | null
}

type LockedRow = {
  locked_count: string | number | null
}

function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const url = new URL(req.url)
    const parsedQuery = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsedQuery.success) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.invalid_request', 'Invalid request'),
        details: parsedQuery.error.issues,
      })
    }

    const configService = container.resolve('moduleConfigService') as ModuleConfigService
    const stored = await readTimeTrackingSettings(configService, { tenantId })

    const requestedUnit = parsedQuery.data.unitMinutes
    const candidate: RoundingSettings = {
      unitMinutes:
        typeof requestedUnit === 'number' && ROUNDING_UNITS.includes(requestedUnit)
          ? (requestedUnit as RoundingUnitMinutes)
          : stored.rounding.unitMinutes,
      direction: (parsedQuery.data.direction ?? stored.rounding.direction) as RoundingDirection,
    }

    const windowDays = parsedQuery.data.windowDays ?? DEFAULT_IMPACT_WINDOW_DAYS
    const to = new Date()
    const from = new Date(to.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000)
    const fromDate = toDateOnlyString(from)
    const toDate = toDateOnlyString(to)

    // Organizations narrow the same way every other read in the module does; a null
    // filter list means "every organization of this tenant", which is what a
    // tenant-global setting is asking about.
    const organizationIds = scope?.filterIds ?? null
    const orgClause = organizationIds ? ' AND organization_id = ANY(?)' : ''
    const orgParams = organizationIds ? [organizationIds] : []

    const em = container.resolve('em') as EntityManager
    const connection = em.getConnection()

    const bucketRows = (await connection.execute(
      `
        SELECT duration_minutes, COUNT(*)::bigint AS entry_count
        FROM staff_time_entries
        WHERE tenant_id = ?
          AND deleted_at IS NULL
          AND locked_report_id IS NULL
          AND date >= ?::date
          AND date <= ?::date${orgClause}
        GROUP BY duration_minutes
      `,
      [tenantId, fromDate, toDate, ...orgParams],
    )) as BucketRow[]

    const lockedRows = (await connection.execute(
      `
        SELECT COUNT(*)::bigint AS locked_count
        FROM staff_time_entries
        WHERE tenant_id = ?
          AND deleted_at IS NULL
          AND locked_report_id IS NOT NULL
          AND date >= ?::date
          AND date <= ?::date${orgClause}
      `,
      [tenantId, fromDate, toDate, ...orgParams],
    )) as LockedRow[]

    const buckets: DurationBucket[] = (bucketRows ?? []).map((row) => ({
      durationMinutes: Number(row.duration_minutes ?? 0),
      entryCount: Number(row.entry_count ?? 0),
    }))

    const lockedRaw = Number(lockedRows?.[0]?.locked_count ?? 0)

    return NextResponse.json(
      {
        windowDays,
        from: fromDate,
        to: toDate,
        rounding: candidate,
        projected: projectRoundingImpact(buckets, candidate),
        current: projectRoundingImpact(buckets, stored.rounding),
        lockedEntryCount: Number.isFinite(lockedRaw) ? lockedRaw : 0,
      },
      { status: 200 },
    )
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('staff.timesheets.settings.rounding-impact failed', { err })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Rounding impact preview',
  methods: {
    GET: {
      summary: 'Project the billing impact of a rounding rule over a recent window',
      description:
        'Answers what the last `windowDays` (default 90) would have billed under a candidate rounding rule, before it is saved. Entries already locked into a closed report are excluded from the projection — they cannot be restated — and reported separately as `lockedEntryCount`. Rounding is applied per entry (D-7) through the same helper the write path uses.',
      query: querySchema,
      responses: [
        { status: 200, description: 'Rounding impact projection', schema: responseSchema },
        { status: 400, description: 'Invalid request or missing scope', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Missing staff.timesheets.settings.manage' },
        { status: 500, description: 'Projection failure', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
