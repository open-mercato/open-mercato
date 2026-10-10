import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { toTripDateString } from '../../lib/dates'
import { resolveStudentActionContext } from '../../lib/apiAction'

export const metadata = {
  path: '/student_transport/children',
  GET: { requireAuth: true, requireFeatures: ['student_transport.parents.view'] },
}

type ChildRow = {
  subscription_id: string
  subscription_number: string
  student_name: string
  student_grade: string | null
  account_type: string
  direction: string
  status: string
  guardian_name: string | null
  guardian_phone: string | null
  pickup_point: string | null
  dropoff_point: string | null
  period_price: string
  currency_code: string
  customer_snapshot: Record<string, unknown> | null
  school_snapshot: Record<string, unknown> | null
  route_snapshot: Record<string, unknown> | null
  vehicle_snapshot: Record<string, unknown> | null
  driver_snapshot: Record<string, unknown> | null
  pickup_status: string | null
  pickup_origin: string | null
  pickup_recorded_at: string | null
  dropoff_status: string | null
  dropoff_origin: string | null
  dropoff_recorded_at: string | null
}

/**
 * The parent-facing view of the day.
 *
 * One row per child, with both legs and their marks, whether the family pays
 * directly (B2C) or the school is billed (B2B) — the parent sees the same
 * boarding state either way. `customerId` narrows it to one payer so a parent's
 * screen can ask only for their own children.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const context = await resolveStudentActionContext(req)
    const url = new URL(req.url)
    const tripDate = toTripDateString(url.searchParams.get('tripDate'))
    const customerId = url.searchParams.get('customerId')
    const em = (context.ctx.container.resolve('em') as EntityManager).fork()

    // Placeholder order: the two leg joins, then the scope, then the filters.
    const params: unknown[] = [tripDate, tripDate, context.tenantId, context.organizationId]
    const filters: string[] = []
    if (customerId) {
      filters.push('and (s.customer_id = ? or s.school_customer_id = ?)')
      params.push(customerId, customerId)
    }

    const rows = await em.getConnection().execute<ChildRow[]>(
      `
        select
          s.id as subscription_id, s.subscription_number, s.student_name, s.student_grade,
          s.account_type, s.direction, s.status, s.guardian_name, s.guardian_phone,
          s.pickup_point, s.dropoff_point, s.period_price, s.currency_code,
          s.customer_snapshot, s.school_snapshot, s.route_snapshot, s.vehicle_snapshot, s.driver_snapshot,
          pick.status as pickup_status, pick.origin as pickup_origin, pick.recorded_at::text as pickup_recorded_at,
          drop_off.status as dropoff_status, drop_off.origin as dropoff_origin, drop_off.recorded_at::text as dropoff_recorded_at
        from student_subscriptions s
        left join student_trip_attendance pick
          on pick.subscription_id = s.id and pick.trip_date = ? and pick.leg = 'pickup' and pick.deleted_at is null
        left join student_trip_attendance drop_off
          on drop_off.subscription_id = s.id and drop_off.trip_date = ? and drop_off.leg = 'dropoff' and drop_off.deleted_at is null
        where s.tenant_id = ? and s.organization_id = ? and s.deleted_at is null
          and s.status in ('active', 'suspended')
          ${filters.join(' ')}
        order by s.student_name asc
      `,
      params,
    )

    return NextResponse.json({
      tripDate,
      items: rows.map((row) => ({
        subscriptionId: row.subscription_id,
        subscriptionNumber: row.subscription_number,
        studentName: row.student_name,
        studentGrade: row.student_grade,
        accountType: row.account_type,
        direction: row.direction,
        status: row.status,
        guardianName: row.guardian_name,
        guardianPhone: row.guardian_phone,
        pickupPoint: row.pickup_point,
        dropoffPoint: row.dropoff_point,
        periodPrice: row.period_price,
        currencyCode: row.currency_code,
        payer: row.customer_snapshot,
        school: row.school_snapshot,
        route: row.route_snapshot,
        vehicle: row.vehicle_snapshot,
        driver: row.driver_snapshot,
        legs: [
          { leg: 'pickup', status: row.pickup_status, origin: row.pickup_origin, recordedAt: row.pickup_recorded_at },
          { leg: 'dropoff', status: row.dropoff_status, origin: row.dropoff_origin, recordedAt: row.dropoff_recorded_at },
        ].filter((entry) => row.direction === 'two_way'
          || (row.direction === 'one_way_pickup' && entry.leg === 'pickup')
          || (row.direction === 'one_way_drop' && entry.leg === 'dropoff')),
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: 'Unable to load the children view.' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Student Transport',
  summary: 'Children of the day with both legs',
  methods: {
    GET: {
      summary: 'Every subscribed child with today’s boarding state, for parents and staff',
      responses: [{
        status: 200,
        description: 'Child rows',
        schema: z.object({
          tripDate: z.string(),
          items: z.array(z.object({
            subscriptionId: z.string().uuid(),
            subscriptionNumber: z.string(),
            studentName: z.string(),
            accountType: z.string(),
            direction: z.string(),
            status: z.string(),
            guardianName: z.string().nullable(),
            guardianPhone: z.string().nullable(),
            pickupPoint: z.string().nullable(),
            dropoffPoint: z.string().nullable(),
            periodPrice: z.string(),
            currencyCode: z.string(),
            legs: z.array(z.object({
              leg: z.string(),
              status: z.string().nullable(),
              origin: z.string().nullable(),
              recordedAt: z.string().nullable(),
            })),
          })),
        }),
      }],
    },
  },
}
