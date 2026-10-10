import { z } from 'zod'
import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { attendanceQuerySchema, recordAttendanceSchema } from '../../data/validators'
import { toTripDateString } from '../../lib/dates'
import { STUDENT_ATTENDANCE_ENTITY_ID } from '../../commands/entities'
import { ATTENDANCE_LEGS, ATTENDANCE_STATUSES } from '../../data/entities'

export const metadata = {
  path: '/student_transport/attendance',
  GET: { requireAuth: true, requireFeatures: ['student_transport.read'] },
  POST: { requireAuth: true, requireFeatures: ['student_transport.attendance.record'] },
}

type AttendanceRow = {
  id: string
  subscription_id: string
  subscription_number: string
  student_name: string
  account_type: string
  direction: string
  guardian_name: string | null
  guardian_phone: string | null
  pickup_point: string | null
  dropoff_point: string | null
  route_snapshot: Record<string, unknown> | null
  vehicle_snapshot: Record<string, unknown> | null
  driver_snapshot: Record<string, unknown> | null
  trip_date: string
  leg: string
  status: string | null
  origin: string | null
  notes: string | null
  recorded_at: string | null
}

/**
 * The day's run board.
 *
 * One query returns every active subscription of the day with its attendance
 * row where one exists — the board shows the children who have *not* been marked
 * yet just as prominently as the ones who have, because a missing mark is the
 * thing the driver has to act on.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })

    const url = new URL(req.url)
    const query = attendanceQuerySchema.parse({
      mode: url.searchParams.get('mode') ?? undefined,
      tripDate: url.searchParams.get('tripDate') ?? undefined,
      fromDate: url.searchParams.get('fromDate') ?? undefined,
      toDate: url.searchParams.get('toDate') ?? undefined,
      leg: url.searchParams.get('leg') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      subscriptionId: url.searchParams.get('subscriptionId') ?? undefined,
      routeId: url.searchParams.get('routeId') ?? undefined,
      vehicleId: url.searchParams.get('vehicleId') ?? undefined,
    })
    const tripDate = toTripDateString(query.tripDate ?? new Date())

    const em = (container.resolve('em') as EntityManager).fork()

    // History mode: the raw marks of one subscription over a range, newest
    // first — what a subscription detail shows as the boarding log.
    if (query.mode === 'history') {
      if (!query.subscriptionId) throw new CrudHttpError(400, { error: translate('student_transport.errors.subscription_required', 'A subscription is required for the history.') })
      const historyRows = await em.getConnection().execute<Array<Record<string, unknown>>>(
        `select a.id, a.trip_date::text as trip_date, a.leg, a.status, a.origin, a.notes,
                a.recorded_at::text as recorded_at
         from student_trip_attendance a
         where a.tenant_id = ? and a.organization_id = ? and a.subscription_id = ? and a.deleted_at is null
           ${query.fromDate ? 'and a.trip_date >= ?' : ''}
           ${query.toDate ? 'and a.trip_date <= ?' : ''}
         order by a.trip_date desc, a.leg asc
         limit 200`,
        [
          auth.tenantId,
          organizationId,
          query.subscriptionId,
          ...(query.fromDate ? [query.fromDate] : []),
          ...(query.toDate ? [query.toDate] : []),
        ],
      )
      return NextResponse.json({
        items: historyRows.map((row) => ({
          id: String(row.id),
          tripDate: String(row.trip_date),
          leg: String(row.leg),
          status: String(row.status),
          origin: String(row.origin),
          notes: row.notes === null || row.notes === undefined ? null : String(row.notes),
          recordedAt: row.recorded_at === null || row.recorded_at === undefined ? null : String(row.recorded_at),
        })),
      })
    }

    // Parameters in placeholder order: the join's date, then the scope, then the
    // optional filters appended after them in the same order they are pushed.
    const params: unknown[] = [tripDate, auth.tenantId, organizationId]
    const filters: string[] = []
    if (query.routeId) {
      filters.push('and s.transport_route_id = ?')
      params.push(query.routeId)
    }
    if (query.vehicleId) {
      filters.push('and s.vehicle_id = ?')
      params.push(query.vehicleId)
    }
    if (query.subscriptionId) {
      filters.push('and s.id = ?')
      params.push(query.subscriptionId)
    }
    if (query.leg) {
      filters.push('and a.leg = ?')
      params.push(query.leg)
    }
    if (query.status) {
      filters.push('and a.status = ?')
      params.push(query.status)
    }

    const rows = await em.getConnection().execute<AttendanceRow[]>(
      `
        select
          a.id, a.subscription_id, a.trip_date::text as trip_date, a.leg, a.status, a.origin, a.notes,
          a.recorded_at::text as recorded_at,
          s.subscription_number, s.student_name, s.account_type, s.direction,
          s.guardian_name, s.guardian_phone, s.pickup_point, s.dropoff_point,
          s.route_snapshot, s.vehicle_snapshot, s.driver_snapshot
        from student_subscriptions s
        left join student_trip_attendance a
          on a.subscription_id = s.id and a.trip_date = ? and a.deleted_at is null
        where s.tenant_id = ? and s.organization_id = ? and s.deleted_at is null
          and s.status in ('active', 'suspended')
          ${filters.join(' ')}
        order by s.student_name asc
      `,
      params,
    )

    // A two-way rider appears once per leg so the board can be worked per run;
    // a one-way rider only on their leg.
    const items = rows.flatMap((row) => {
      const legs = query.leg ? [query.leg] : legsOf(String(row.direction))
      return legs.map((leg) => ({
        id: `${row.subscription_id}:${leg}`,
        attendanceId: row.leg === leg ? row.id : null,
        subscriptionId: row.subscription_id,
        subscriptionNumber: row.subscription_number,
        studentName: row.student_name,
        accountType: row.account_type,
        direction: row.direction,
        guardianName: row.guardian_name,
        guardianPhone: row.guardian_phone,
        pickupPoint: row.pickup_point,
        dropoffPoint: row.dropoff_point,
        routeSnapshot: row.route_snapshot,
        vehicleSnapshot: row.vehicle_snapshot,
        driverSnapshot: row.driver_snapshot,
        tripDate,
        leg,
        status: row.leg === leg ? row.status : null,
        origin: row.leg === leg ? row.origin : null,
        notes: row.leg === leg ? row.notes : null,
        recordedAt: row.leg === leg ? row.recorded_at : null,
      }))
    })

    return NextResponse.json({ items, tripDate })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    return NextResponse.json({ error: 'Unable to load the attendance board.' }, { status: 400 })
  }
}

function legsOf(direction: string): string[] {
  if (direction === 'one_way_pickup') return ['pickup']
  if (direction === 'one_way_drop') return ['dropoff']
  return ['pickup', 'dropoff']
}

/** Records or corrects one leg of one day; the board and the parent screen both call this. */
export async function POST(req: Request): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    const raw = await readJsonSafe(req, {})
    const ctx = {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }
    const scoped = withScopedPayload((raw ?? {}) as Record<string, unknown>, ctx, translate)
    const input = recordAttendanceSchema.parse(scoped)
    const userId = auth.sub
    if (!userId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId, tenantId: auth.tenantId, organizationId },
      input: {
        resourceKind: STUDENT_ATTENDANCE_ENTITY_ID,
        resourceId: input.subscriptionId,
        operation: 'create',
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response
    const commandBus = container.resolve('commandBus') as CommandBus
    const commandInput = guarded.modifiedPayload ? recordAttendanceSchema.parse(guarded.modifiedPayload) : input
    const { result } = await commandBus.execute<Record<string, unknown>, { attendanceId: string }>(
      'student_transport.attendance.record',
      { input: commandInput, ctx },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, attendanceId: result.attendanceId })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    return NextResponse.json({ error: 'Unable to record the attendance.' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Student Transport',
  summary: 'Daily boarding attendance',
  methods: {
    GET: {
      summary: 'The run board: every active subscription of a day with its attendance mark',
      responses: [{
        status: 200,
        description: 'Attendance board rows, one per subscription and leg',
        schema: z.object({
          tripDate: z.string(),
          items: z.array(z.object({
            id: z.string(),
            attendanceId: z.string().uuid().nullable(),
            subscriptionId: z.string().uuid(),
            subscriptionNumber: z.string(),
            studentName: z.string(),
            accountType: z.string(),
            direction: z.string(),
            guardianName: z.string().nullable(),
            guardianPhone: z.string().nullable(),
            pickupPoint: z.string().nullable(),
            dropoffPoint: z.string().nullable(),
            routeSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
            vehicleSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
            driverSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
            tripDate: z.string(),
            leg: z.enum(ATTENDANCE_LEGS),
            status: z.enum(ATTENDANCE_STATUSES).nullable(),
            origin: z.enum(['staff', 'parent']).nullable(),
            notes: z.string().nullable(),
            recordedAt: z.string().nullable(),
          })),
        }),
      }],
    },
    POST: {
      summary: 'Record or correct one leg of one day',
      requestBody: { contentType: 'application/json', schema: recordAttendanceSchema },
      responses: [{
        status: 200,
        description: 'Attendance recorded',
        schema: z.object({ ok: z.boolean(), attendanceId: z.string().uuid() }),
      }],
    },
  },
}
