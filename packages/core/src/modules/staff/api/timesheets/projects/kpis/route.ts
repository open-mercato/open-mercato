import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { StaffTeamMember } from '../../../../data/entities'
import {
  computeCollabProjectsKpis,
  computePmProjectsKpis,
} from '../../../../lib/timesheets-projects/computeProjectsKpis'

const VIEW_FEATURE = 'staff.timesheets.projects.view'
const MANAGE_FEATURE = 'staff.timesheets.projects.manage'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const deltaSchema = z.object({
  current: z.number(),
  previous: z.number(),
  deltaPct: z.number().nullable(),
})

const pmResponseSchema = z.object({
  role: z.literal('pm'),
  totals: z.object({
    total: z.number().int(),
    active: z.number().int(),
    onHold: z.number().int(),
    completed: z.number().int(),
  }),
  hoursWeek: deltaSchema,
  hoursMonth: deltaSchema,
  teamActive: z.object({ count: z.number().int() }),
  assignedToMe: z.object({ total: z.number().int(), active: z.number().int() }),
})

const collabResponseSchema = z.object({
  role: z.literal('collab'),
  myProjects: z.object({
    total: z.number().int(),
    active: z.number().int(),
  }),
  myHoursWeek: deltaSchema,
  myHoursMonth: deltaSchema,
})

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth) {
      throw new CrudHttpError(401, {
        error: translate('staff.errors.unauthorized', 'Unauthorized'),
      })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const em = container.resolve('em') as EntityManager
    const rbac = container.resolve('rbacService') as RbacService
    const isPm = await rbac.userHasAllFeatures(auth.sub, [MANAGE_FEATURE], {
      tenantId,
      organizationId,
    })

    const staffMember = await findOneWithDecryption(
      em.fork(),
      StaffTeamMember,
      { userId: auth.sub, tenantId, organizationId, deletedAt: null },
      {},
      { tenantId, organizationId },
    )

    if (isPm) {
      const result = await computePmProjectsKpis({
        em,
        tenantId,
        organizationId,
        callerStaffMemberId: staffMember?.id ?? null,
      })
      return NextResponse.json(result, { status: 200 })
    }

    if (!staffMember) {
      throw new CrudHttpError(403, {
        error: translate(
          'staff.timesheets.errors.noStaffMember',
          'No staff member linked to your account.',
        ),
      })
    }

    const result = await computeCollabProjectsKpis({
      em,
      tenantId,
      organizationId,
      staffMemberId: staffMember.id,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('staff.timesheets.projects.kpis failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      {
        error: translate(
          'staff.timesheets.errors.projectsKpis',
          'Failed to load project KPIs.',
        ),
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Timesheet projects KPIs',
  methods: {
    GET: {
      summary: 'Aggregate KPIs for the timesheets Projects page',
      description:
        'Returns a role-aware KPI payload. Users with `staff.timesheets.projects.manage` get the PM shape (portfolio totals, monthly team hours, active team member count). Other viewers get the Collaborator shape scoped to their own memberships and hours.',
      responses: [
        {
          status: 200,
          description: 'PM or Collaborator KPIs',
          schema: z.union([pmResponseSchema, collabResponseSchema]),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        {
          status: 403,
          description: 'Missing viewing feature or no staff member linked',
          schema: z.object({ error: z.string() }),
        },
        { status: 500, description: 'Aggregation failure', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
