import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { toTripDateString } from '../../lib/dates'
import { resolveStudentActionContext } from '../../lib/apiAction'

export const metadata = {
  path: '/student_transport/dashboard-summary',
  GET: { requireAuth: true, requireFeatures: ['student_transport.read'] },
}

/**
 * The morning picture: how many children ride today, how many are marked, how
 * many absences were reported ahead of the run, and the month's subscription
 * value split by who pays.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const context = await resolveStudentActionContext(req)
    const em = (context.ctx.container.resolve('em') as EntityManager).fork()
    const tripDate = toTripDateString(new URL(req.url).searchParams.get('tripDate'))

    const rows = await em.getConnection().execute<Array<Record<string, unknown>>>(
      `
        select
          count(*) filter (where s.status = 'active') as active_subscriptions,
          count(*) filter (where s.status = 'suspended') as suspended_subscriptions,
          count(*) filter (where s.status = 'active' and s.account_type = 'b2c') as b2c_children,
          count(*) filter (where s.status = 'active' and s.account_type = 'b2b') as b2b_children,
          coalesce(sum(s.period_price) filter (where s.status = 'active' and s.account_type = 'b2c'), 0) as b2c_month_value,
          coalesce(sum(s.period_price) filter (where s.status = 'active' and s.account_type = 'b2b'), 0) as b2b_month_value
        from student_subscriptions s
        where s.tenant_id = ? and s.organization_id = ? and s.deleted_at is null
      `,
      [context.tenantId, context.organizationId],
    )
    const attendance = await em.getConnection().execute<Array<Record<string, unknown>>>(
      `
        select
          count(*) filter (where a.leg = 'pickup' and a.status in ('boarded', 'alighted')) as pickup_marked,
          count(*) filter (where a.leg = 'dropoff' and a.status in ('boarded', 'alighted')) as dropoff_marked,
          count(*) filter (where a.status = 'absent_notified') as absences_notified,
          count(*) filter (where a.status = 'absent_unnotified') as absences_unnotified
        from student_trip_attendance a
        where a.tenant_id = ? and a.organization_id = ? and a.trip_date = ? and a.deleted_at is null
      `,
      [context.tenantId, context.organizationId, tripDate],
    )

    const summary = rows[0] ?? {}
    const marks = attendance[0] ?? {}
    return NextResponse.json({
      tripDate,
      activeSubscriptions: Number(summary.active_subscriptions ?? 0),
      suspendedSubscriptions: Number(summary.suspended_subscriptions ?? 0),
      b2cChildren: Number(summary.b2c_children ?? 0),
      b2bChildren: Number(summary.b2b_children ?? 0),
      b2cMonthValue: String(summary.b2c_month_value ?? '0'),
      b2bMonthValue: String(summary.b2b_month_value ?? '0'),
      pickupMarked: Number(marks.pickup_marked ?? 0),
      dropoffMarked: Number(marks.dropoff_marked ?? 0),
      absencesNotified: Number(marks.absences_notified ?? 0),
      absencesUnnotified: Number(marks.absences_unnotified ?? 0),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: 'Unable to load the transport summary.' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Student Transport',
  summary: 'School transport dashboard summary',
  methods: {
    GET: {
      summary: 'Subscriptions by account type and today’s boarding marks',
      responses: [{
        status: 200,
        description: 'Transport counters',
        schema: z.object({
          tripDate: z.string(),
          activeSubscriptions: z.number(),
          suspendedSubscriptions: z.number(),
          b2cChildren: z.number(),
          b2bChildren: z.number(),
          b2cMonthValue: z.string(),
          b2bMonthValue: z.string(),
          pickupMarked: z.number(),
          dropoffMarked: z.number(),
          absencesNotified: z.number(),
          absencesUnnotified: z.number(),
        }),
      }],
    },
  },
}
