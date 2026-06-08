import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeProjectMember, StaffTeamMember } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.view'] },
}

/**
 * GET /api/staff/timesheets/my-projects
 *
 * Spec N+1 Mitigation — Query 1:
 * Returns staff_time_project_members for the authenticated staff member.
 * Used by "My Timesheets" grid to resolve assigned project IDs.
 */
export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.') })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const scopeCtx = { tenantId, organizationId }

    const staffMember = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { userId: auth.sub, tenantId, organizationId, deletedAt: null },
      {},
      scopeCtx,
    )
    if (!staffMember) {
      throw new CrudHttpError(403, { error: translate('staff.timesheets.errors.noStaffMember', 'No staff member linked to your account.') })
    }

    const assignments = await findWithDecryption(
      em,
      StaffTimeProjectMember,
      { staffMemberId: staffMember.id, tenantId, organizationId, deletedAt: null, status: 'active' },
      {},
      scopeCtx,
    )

    const items = assignments.map((assignment) => ({
      id: assignment.id,
      time_project_id: assignment.timeProjectId,
      staff_member_id: assignment.staffMemberId,
      role: assignment.role ?? null,
      status: assignment.status ?? null,
      assigned_start_date: assignment.assignedStartDate ?? null,
      assigned_end_date: assignment.assignedEndDate ?? null,
      show_in_grid: assignment.showInGrid ?? false,
    }))

    return NextResponse.json({ items, total: items.length }, { status: 200 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('staff.timesheets.my-projects failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('staff.timesheets.errors.myProjects', 'Failed to load your projects.') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'My assigned time projects',
  methods: {
    GET: {
      summary: 'List assigned time project memberships for the current user',
      description: 'Returns staff_time_project_members where the authenticated user is an active member. Used by the My Timesheets grid to resolve assigned project IDs (spec N+1 mitigation query 1).',
      responses: [
        {
          status: 200,
          description: 'Assigned project memberships',
          schema: z.object({
            items: z.array(z.object({
              id: z.string().uuid(),
              time_project_id: z.string().uuid(),
              staff_member_id: z.string().uuid(),
              role: z.string().nullable(),
              status: z.string().nullable(),
              assigned_start_date: z.string().nullable(),
              assigned_end_date: z.string().nullable(),
              show_in_grid: z.boolean(),
            })),
            total: z.number(),
          }),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'No staff member linked', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
